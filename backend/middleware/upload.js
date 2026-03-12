const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'uploads/';
    
    // Create subfolders based on file type
    if (file.fieldname === 'profileImage') {
      folder += 'profiles/';
    } else if (file.fieldname === 'images') {
      folder += 'products/';
    } else if (file.fieldname === 'shopImages') {
      folder += 'shops/';
    } else if (file.fieldname === 'documents') {
      folder += 'documents/';
    } else {
      folder += 'general/';
    }
    
    // Create folder if it doesn't exist
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    // Create unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = {
    image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    document: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'],
    all: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
  };

  let allowed = allowedTypes.all;
  
  // Set specific allowed types based on field
  if (file.fieldname === 'profileImage' || file.fieldname === 'images' || file.fieldname === 'shopImages') {
    allowed = allowedTypes.image;
  } else if (file.fieldname === 'documents') {
    allowed = allowedTypes.document;
  }

  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed types: ${allowed.join(', ')}`), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // Default 5MB
    files: 10 // Maximum 10 files
  }
});

// Error handling middleware for multer
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 5MB.'
      });
    }
    
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 10 files allowed.'
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field.'
      });
    }
  }
  
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  // Pass other errors to global error handler
  next(error);
};

// Helper function to delete file
const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
};

// Helper function to get file info
const getFileInfo = (file) => {
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    url: `/${file.path}`,
    uploadedAt: new Date()
  };
};

// Cleanup old files (utility function)
const cleanupOldFiles = (directory, maxAge = 7 * 24 * 60 * 60 * 1000) => {
  try {
    const files = fs.readdirSync(directory);
    const now = Date.now();
    
    files.forEach(file => {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`Deleted old file: ${filePath}`);
      }
    });
  } catch (error) {
    console.error('Error cleaning up files:', error);
  }
};

// Image optimization middleware (basic version)
const optimizeImage = async (req, res, next) => {
  try {
    if (!req.files && !req.file) {
      return next();
    }

    const files = req.files || [req.file];
    
    // In a production environment, you would use libraries like sharp
    // to resize and optimize images here
    
    // For now, just add optimization metadata
    files.forEach(file => {
      if (file.mimetype.startsWith('image/')) {
        file.optimized = true;
        file.originalSize = file.size;
      }
    });
    
    next();
  } catch (error) {
    console.error('Image optimization error:', error);
    next(error);
  }
};

module.exports = {
  upload,
  handleUploadError,
  deleteFile,
  getFileInfo,
  cleanupOldFiles,
  optimizeImage
};
