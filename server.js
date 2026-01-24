import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

/* --- CONFIGURATION --- */
const { ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !JWT_SECRET) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/* --- MULTER SETUP --- */
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

/* --- MIDDLEWARE --- */
app.use(cors({
  origin: true,           // Accept requests from frontend
  credentials: true       // Allow cookies
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* --- AUTH MIDDLEWARE --- */
const authShield = (req, res, next) => {
  const token = req.cookies.nova_auth;
  if (!token) return res.status(401).redirect('/login.html');

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('nova_auth');
    res.status(401).redirect('/login.html');
  }
};

/* --- AUTH ROUTES --- */
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('nova_auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'Invalid credentials' });
});

app.get('/api/logout', (req, res) => {
  res.clearCookie('nova_auth');
  res.redirect('/login.html');
});

/* --- PROTECTED HTML ROUTES --- */
app.get('/', authShield, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/photos.html', authShield, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'photos.html'));
});

/* --- VIDEO API --- */
app.get('/api/videos', authShield, async (req, res) => {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'video',
      prefix: 'video-streaming-app/',
      max_results: 100,
      context: true
    });

    res.json(result.resources.map(v => ({
      id: v.public_id,
      url: v.secure_url,
      title: v.context?.custom?.title || 'Untitled',
      description: v.context?.custom?.description || '',
      thumbnail: v.context?.custom?.thumbnail || null,
      size: v.bytes,
      uploadedAt: v.created_at
    })));
  } catch (err) {
    console.error('Error fetching videos:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* --- VIDEO UPLOAD --- */
const multiUpload = upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]);

app.post('/api/upload', authShield, multiUpload, async (req, res) => {
  try {
    const videoFile = req.files['video']?.[0];
    const thumbFile = req.files['thumbnail']?.[0];
    if (!videoFile) return res.status(400).json({ message: 'Missing video file' });

    let thumbUrl = '';
    if (thumbFile) {
      const thumbRes = await cloudinary.uploader.upload(thumbFile.path, {
        folder: 'video-streaming-app/thumbs'
      });
      thumbUrl = thumbRes.secure_url;
      fs.unlinkSync(thumbFile.path);
    }

    cloudinary.uploader.upload_large(videoFile.path, {
      resource_type: 'video',
      folder: 'video-streaming-app',
      context: `title=${req.body.title || 'Untitled'}|description=${req.body.description || ''}|thumbnail=${thumbUrl}`
    }, (error, result) => {
      fs.unlinkSync(videoFile.path);
      if (error) {
        console.error('Cloudinary upload error:', error);
        return res.status(500).json({ message: error.message });
      }
      res.json({ success: true, video: result });
    });

  } catch (err) {
    console.error('Video upload error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* --- VIDEO DELETE --- */
app.delete('/api/videos/*', authShield, async (req, res) => {
  try {
    const publicId = req.params[0];
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
      invalidate: true
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Video delete error:', err);
    res.status(500).json({ message: 'Delete failed' });
  }
});

/* --- IMAGE API --- */
app.get('/api/images', authShield, async (req, res) => {
  try {
    const result = await cloudinary.api.resources({
      resource_type: 'image',
      type: 'upload',
      prefix: 'nova-collections/',
      max_results: 100,
      tags: true,
      context: true
    });

    res.json(result.resources.map(img => ({
      id: img.public_id,
      url: img.secure_url,
      title: img.context?.custom?.title || 'Untitled',
      collection: img.tags?.[0] || 'General',
      uploadedAt: img.created_at
    })));
  } catch (err) {
    console.error('Error fetching images:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/upload-image', authShield, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' });

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'nova-collections',
      tags: [req.body.collection || 'General'],
      context: `title=${req.body.title || 'Untitled'}`
    });

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.json({ success: true, image: result });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/images/*', authShield, async (req, res) => {
  try {
    const publicId = req.params[0];
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Image delete error:', err);
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
});

/* --- SERVER START --- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 NovaStream Running on Port ${PORT}`);
  console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
}).timeout = 600000; // 10 minutes for large uploads




// import express from 'express';
// import cors from 'cors';
// import dotenv from 'dotenv';
// import { v2 as cloudinary } from 'cloudinary';
// import multer from 'multer';
// import jwt from 'jsonwebtoken';
// import cookieParser from 'cookie-parser';
// import path from 'path';
// import fs from 'fs';
// import { fileURLToPath } from 'url';

// dotenv.config();
// const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const app = express();
// const PORT = process.env.PORT || 3000;

// // Ensure local storage exists for temporary Multer processing
// const uploadDir = './uploads';
// if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// /* --- CONFIGURATION --- */
// const { ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET } = process.env;
// if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !JWT_SECRET) {
//   console.error('❌ Missing environment variables');
//   process.exit(1);
// }

// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
//   secure: true
// });

// /* --- MULTER SETUP --- */
// const storage = multer.diskStorage({
//   destination: 'uploads/',
//   filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
// });
// const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB limit

// /* --- MIDDLEWARE --- */
// app.use(cors({ origin: true, credentials: true }));
// app.use(express.json());
// app.use(cookieParser());
// app.use(express.static('public'));

// // Auth middleware
// const authShield = (req, res, next) => {
//   const token = req.cookies.nova_auth;
//   if (!token) return res.status(401).redirect('/login.html');
//   try {
//     req.user = jwt.verify(token, JWT_SECRET);
//     next();
//   } catch {
//     res.clearCookie('nova_auth');
//     res.status(401).redirect('/login.html');
//   }
// };

// /* --- AUTH ROUTES --- */
// app.post('/api/login', (req, res) => {
//   const { email, password } = req.body;
//   if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
//     const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
//     res.cookie('nova_auth', token, {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === 'production',
//       sameSite: 'strict',
//       maxAge: 30 * 24 * 60 * 60 * 1000
//     });
//     return res.json({ success: true });
//   }
//   res.status(401).json({ success: false, message: "Invalid credentials" });
// });

// app.get('/api/logout', (req, res) => {
//   res.clearCookie('nova_auth');
//   res.redirect('/login.html');
// });

// /* --- PROTECTED HTML ROUTES --- */
// app.get('/', authShield, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });
// app.get('/photos.html', authShield, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'photos.html'));
// });

// /* --- VIDEO API --- */
// app.get('/api/videos', authShield, async (req, res) => {
//   try {
//     const result = await cloudinary.api.resources({
//       type: 'upload',           // ✅ required
//       resource_type: 'video',   // ✅ required
//       prefix: 'video-streaming-app/',
//       max_results: 100,
//       context: true
//     });

//     res.json(result.resources.map(v => ({
//       id: v.public_id,
//       url: v.secure_url,
//       title: v.context?.custom?.title || 'Untitled',
//       description: v.context?.custom?.description || '',
//       thumbnail: v.context?.custom?.thumbnail || null,
//       size: v.bytes,
//       uploadedAt: v.created_at
//     })));
//   } catch (err) {
//     console.error('Error fetching videos:', err);
//     res.status(500).json({ success: false });
//   }
// });

// /* --- VIDEO UPLOAD --- */
// const multiUpload = upload.fields([
//   { name: 'video', maxCount: 1 },
//   { name: 'thumbnail', maxCount: 1 }
// ]);

// app.post('/api/upload', authShield, multiUpload, async (req, res) => {
//   try {
//     const videoFile = req.files['video']?.[0];
//     const thumbFile = req.files['thumbnail']?.[0];
//     if (!videoFile) return res.status(400).json({ message: "Missing video" });

//     let thumbUrl = '';
//     if (thumbFile) {
//       const thumbRes = await cloudinary.uploader.upload(thumbFile.path, { 
//         folder: 'video-streaming-app/thumbs' 
//       });
//       thumbUrl = thumbRes.secure_url;
//       fs.unlinkSync(thumbFile.path);
//     }

//     cloudinary.uploader.upload_large(videoFile.path, {
//       resource_type: 'video',
//       folder: 'video-streaming-app',
//       context: `title=${req.body.title || 'Untitled'}|description=${req.body.description || ''}|thumbnail=${thumbUrl}`
//     }, (error, result) => {
//       fs.unlinkSync(videoFile.path);
//       if (error) {
//         console.error('Cloudinary upload error:', error);
//         return res.status(500).json({ message: error.message });
//       }
//       res.json({ success: true, video: result });
//     });

//   } catch (err) {
//     console.error('Upload error:', err);
//     res.status(500).json({ message: err.message });
//   }
// });

// /* --- VIDEO DELETE --- */
// app.delete('/api/videos/*', authShield, async (req, res) => {
//   try {
//     const publicId = req.params[0];
//     await cloudinary.uploader.destroy(publicId, { 
//       resource_type: 'video', 
//       invalidate: true 
//     });
//     res.json({ success: true });
//   } catch (err) {
//     console.error('Delete error:', err);
//     res.status(500).json({ message: "Delete failed" });
//   }
// });

// /* --- SERVER START --- */
// const server = app.listen(PORT, () => {
//   console.log(`🚀 NovaStream Running on Port ${PORT}`);
//   console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
// });
// server.timeout = 600000; // 10 minutes for large uploads




