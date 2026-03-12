const express = require('express');
const path = require('path');
const { authenticate, requireVerification } = require('../middleware/auth');
const { upload, optimizeImage, getFileInfo, deleteFile } = require('../middleware/upload');

const router = express.Router();

// @desc    Upload single file
// @route   POST /api/upload/single
// @access  Private
const uploadSingle = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const fileInfo = getFileInfo(req.file);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      file: fileInfo
    });

  } catch (error) {
    console.error('Upload single file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file'
    });
  }
};

// @desc    Upload multiple files
// @route   POST /api/upload/multiple
// @access  Private
const uploadMultiple = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const filesInfo = req.files.map(file => getFileInfo(file));

    res.json({
      success: true,
      message: `${req.files.length} files uploaded successfully`,
      files: filesInfo
    });

  } catch (error) {
    console.error('Upload multiple files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload files'
    });
  }
};

// @desc    Delete uploaded file
// @route   DELETE /api/upload/:filename
// @access  Private
const deleteUploadedFile = async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Security check: prevent directory traversal
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join('uploads', sanitizedFilename);
    
    const deleted = deleteFile(filePath);
    
    if (deleted) {
      res.json({
        success: true,
        message: 'File deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'File not found or already deleted'
      });
    }

  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file'
    });
  }
};

// Apply middleware and routes
router.post('/single', 
  authenticate, 
  requireVerification,
  upload.single('file'),
  optimizeImage,
  uploadSingle
);

router.post('/multiple', 
  authenticate, 
  requireVerification,
  upload.array('files', 10),
  optimizeImage,
  uploadMultiple
);

router.delete('/:filename', 
  authenticate, 
  requireVerification,
  deleteUploadedFile
);

module.exports = router;
