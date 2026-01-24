// import express from 'express';
// import cors from 'cors';
// import dotenv from 'dotenv';
// import { v2 as cloudinary } from 'cloudinary';
// import multer from 'multer';
// import streamifier from 'streamifier';
// import jwt from 'jsonwebtoken';
// import cookieParser from 'cookie-parser';
// import path from 'path';
// import { fileURLToPath } from 'url';

// dotenv.config();

// const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const app = express();
// const PORT = process.env.PORT || 3000;

// // --- AUTHORIZATION CONFIG ---
// const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
// const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// const JWT_SECRET = process.env.JWT_SECRET;

// // Validate environment variables
// if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !JWT_SECRET) {
//   console.error('❌ Missing required environment variables');
//   process.exit(1);
// }

// // --- MIDDLEWARE ---
// app.use(cors());
// app.use(express.json());
// app.use(cookieParser());
// app.use(express.static('public', { index: false }));

// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
//   secure: true
// });

// // --- AUTH SHIELD (Middleware) ---
// const authShield = (req, res, next) => {
//   const token = req.cookies.nova_auth;
  
//   if (!token) {
//     return res.status(401).redirect('/login.html');
//   }
  
//   try {
//     const verified = jwt.verify(token, JWT_SECRET);
//     req.user = verified;
//     next();
//   } catch (err) {
//     res.clearCookie('nova_auth');
//     return res.status(401).redirect('/login.html');
//   }
// };

// // --- AUTH ROUTES ---

// // Login Endpoint
// app.post('/api/login', (req, res) => {
//   const { email, password } = req.body;
  
//   // Input validation
//   if (!email || !password) {
//     return res.status(400).json({ 
//       success: false, 
//       message: "Email and password required" 
//     });
//   }
  
//   if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
//     const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
    
//     res.cookie('nova_auth', token, {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === 'production',
//       maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
//       sameSite: 'strict'
//     });
    
//     return res.json({ success: true });
//   }
  
//   res.status(401).json({ 
//     success: false, 
//     message: "Invalid credentials" 
//   });
// });

// // Logout Endpoint
// app.get('/api/logout', (req, res) => {
//   res.clearCookie('nova_auth');
//   res.redirect('/login.html');
// });

// // --- PROTECTED CONTENT ROUTES ---

// // Redirect root to index.html ONLY IF authorized
// app.get('/', authShield, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });
// // Add this near your other protected routes (line ~85)
// app.get('/photos.html', authShield, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'photos.html'));
// });
// // Protect Video List
// app.get('/api/videos', authShield, async (req, res) => {
//   try {
//     const result = await cloudinary.api.resources({
//       type: 'upload',
//       resource_type: 'video',
//       prefix: 'video-streaming-app/',
//       max_results: 100,
//       context: true
//     });
    
//     const videos = result.resources.map(v => ({
//       id: v.public_id,
//       url: v.secure_url,
//       title: v.context?.custom?.title || v.public_id.split('/').pop(),
//       description: v.context?.custom?.description || '',
//       size: v.bytes,
//       uploadedAt: v.created_at
//     }));
    
//     res.json(videos);
//   } catch (err) {
//     console.error('Error fetching videos:', err);
//     res.status(500).json({ 
//       success: false, 
//       message: 'Failed to fetch videos' 
//     });
//   }
// });

// // Protect Upload
// const storage = multer.memoryStorage();
// const upload = multer({ 
//   storage, 
//   limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
// });

// app.post('/api/upload', authShield, upload.single('video'), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'No file uploaded' 
//       });
//     }
    
//     const cld_upload_stream = cloudinary.uploader.upload_stream(
//       {
//         resource_type: "video",
//         folder: "video-streaming-app",
//         context: `title=${req.body.title || 'Untitled'}|description=${req.body.description || ''}`,
//       },
//       (error, result) => {
//         if (result) {
//           res.json({ success: true, video: result });
//         } else {
//           console.error('Cloudinary upload error:', error);
//           res.status(500).json({ 
//             success: false, 
//             message: error.message 
//           });
//         }
//       }
//     );
    
//     streamifier.createReadStream(req.file.buffer).pipe(cld_upload_stream);
//   } catch (err) {
//     console.error('Upload error:', err);
//     res.status(500).json({ 
//       success: false, 
//       message: err.message 
//     });
//   }
// });

// // Delete Video
// app.delete('/api/videos/*', authShield, async (req, res) => {
//   try {
//     const publicId = req.params[0];
//     const result = await cloudinary.uploader.destroy(publicId, {
//       resource_type: 'video',
//       invalidate: true
//     });
    
//     res.json({ success: true, result });
//   } catch (err) {
//     console.error('Delete error:', err);
//     res.status(500).json({ 
//       success: false, 
//       message: 'Failed to delete video' 
//     });
//   }
// });
// // --- IMAGE COLLECTION API ---

// // 1. Fetch all images from Cloudinary
// app.get('/api/images', authShield, async (req, res) => {
//   try {
//     const result = await cloudinary.api.resources({
//       type: 'upload',
//       resource_type: 'image', // Tells Cloudinary to look for images
//       prefix: 'nova-collections/', // This organizes images in a separate folder
//       max_results: 100,
//       tags: true, // Used for "Collection" names
//       context: true // Used for "Titles"
//     });
    
//     const images = result.resources.map(img => ({
//       id: img.public_id,
//       url: img.secure_url,
//       title: img.context?.custom?.title || 'Untitled',
//       collection: img.tags[0] || 'General',
//       uploadedAt: img.created_at
//     }));
    
//     res.json(images);
//   } catch (err) {
//     console.error('Error fetching images:', err);
//     res.status(500).json({ success: false, message: 'Failed to fetch images' });
//   }
// });

// // 2. Upload an image to a Collection
// app.post('/api/upload-image', authShield, upload.single('image'), async (req, res) => {
//   try {
//     if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });

//     const cld_upload_stream = cloudinary.uploader.upload_stream(
//       {
//         resource_type: "image",
//         folder: "nova-collections",
//         tags: [req.body.collection || 'General'], // Using tags as collection names
//         context: `title=${req.body.title || 'Untitled'}`,
//       },
//       (error, result) => {
//         if (result) {
//           res.json({ success: true, image: result });
//         } else {
//           res.status(500).json({ success: false, message: error.message });
//         }
//       }
//     );
    
//     streamifier.createReadStream(req.file.buffer).pipe(cld_upload_stream);
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // 3. Delete an Image
// app.delete('/api/images/*', authShield, async (req, res) => {
//   try {
//     const publicId = req.params[0];
//     const result = await cloudinary.uploader.destroy(publicId, {
//       resource_type: 'image',
//       invalidate: true
//     });
//     res.json({ success: true, result });
//   } catch (err) {
//     res.status(500).json({ success: false, message: 'Delete failed' });
//   }
// });
// // Start Server
// const server = app.listen(PORT, () => {
//   console.log(`🚀 NovaStream Server Running on Port ${PORT}`);
//   console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
// });

// server.timeout = 600000; // 10 minutes for large uploads

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

/* ===================== ENV CHECK ===================== */
const { ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET } = process.env;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !JWT_SECRET) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

/* ===================== MIDDLEWARE ===================== */
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '2gb' }));
app.use(express.urlencoded({ extended: true, limit: '2gb' }));
app.use(cookieParser());
app.use(express.static('public', { index: false }));

/* ===================== CLOUDINARY ===================== */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/* ===================== AUTH MIDDLEWARE ===================== */
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

/* ===================== AUTH ROUTES ===================== */
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

  res.status(401).json({ success: false });
});

app.get('/api/logout', (req, res) => {
  res.clearCookie('nova_auth');
  res.redirect('/login.html');
});

/* ===================== PROTECTED PAGES ===================== */
app.get('/', authShield, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/photos.html', authShield, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'photos.html'));
});

/* ===================== MULTER (DISK STORAGE) ===================== */
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB
});

/* ===================== VIDEO UPLOAD (1GB SAFE) ===================== */
app.post('/api/upload', authShield, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file' });
    }

    cloudinary.uploader.upload_large(
      req.file.path,
      {
        resource_type: 'video',
        folder: 'video-streaming-app',
        chunk_size: 6 * 1024 * 1024,
        context: `title=${req.body.title || 'Untitled'}|description=${req.body.description || ''}`
      },
      (error, result) => {
        fs.unlinkSync(req.file.path); // cleanup

        if (error) {
          console.error(error);
          return res.status(500).json({ success: false, message: error.message });
        }

        res.json({
          success: true,
          video: {
            id: result.public_id,
            url: result.secure_url,
            size: result.bytes,
            duration: result.duration,
            uploadedAt: result.created_at
          }
        });
      }
    );

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ===================== FETCH VIDEOS ===================== */
app.get('/api/videos', authShield, async (req, res) => {
  try {
    const result = await cloudinary.api.resources({
      resource_type: 'video',
      prefix: 'video-streaming-app/',
      max_results: 100,
      context: true
    });

    const videos = result.resources.map(v => ({
      id: v.public_id,
      url: v.secure_url,
      title: v.context?.custom?.title || 'Untitled',
      description: v.context?.custom?.description || '',
      size: v.bytes,
      uploadedAt: v.created_at
    }));

    res.json(videos);
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ===================== DELETE VIDEO ===================== */
app.delete('/api/videos/*', authShield, async (req, res) => {
  try {
    const publicId = req.params[0];
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
      invalidate: true
    });

    res.json({ success: true, result });
  } catch {
    res.status(500).json({ success: false });
  }
});

/* ===================== START SERVER ===================== */
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

server.timeout = 600000; // 10 minutes
