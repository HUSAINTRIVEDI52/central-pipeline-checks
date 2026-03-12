const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendOTPEmail, sendEmail } = require('../utils/notifications');

class AuthService {
  // Register a new user
  async register(userData) {
    const { fullName, email, phone, password, role } = userData;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      throw new Error('User already exists with this email or phone');
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate OTP
    const otp = this.generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create user
    const user = new User({
      fullName,
      email,
      phone,
      password: hashedPassword,
      role,
      otp: {
        code: otp,
        expires: otpExpires,
        verified: false
      }
    });

    await user.save();

    // Send OTP via Email
    try {
      await sendOTPEmail(email, otp, fullName);
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      // Continue without throwing error
    }

    return {
      userId: user._id,
      message: 'User registered successfully. Please verify your email address.',
      needsVerification: true
    };
  }

  // Login user
  async login(email, password) {
    // Find user by email
    const user = await User.findOne({ email, isActive: true });

    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Check if user is verified
    if (!user.isVerified) {
      // Regenerate OTP for verification
      const otp = this.generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      user.otp = {
        code: otp,
        expires: otpExpires,
        verified: false
      };
      await user.save();

      // Send OTP via Email
      try {
        await sendOTPEmail(user.email, otp, user.fullName);
      } catch (error) {
        console.error('Failed to send OTP email:', error);
      }

      return {
        success: false,
        message: 'Please verify your email address to continue',
        userId: user._id,
        email: user.email,
        needsVerification: true
      };
    }

    // Generate JWT token
    const token = this.generateToken(user);

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    return {
      success: true,
      user: this.sanitizeUser(user),
      token
    };
  }

  // Verify OTP
  async verifyOTP(userId, otpCode) {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    if (!user.otp || user.otp.code !== otpCode) {
      throw new Error('Invalid OTP');
    }

    if (user.otp.expires < new Date()) {
      throw new Error('OTP has expired');
    }

    // Mark user as verified
    user.isVerified = true;
    user.otp = undefined; // Clear OTP
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = this.generateToken(user);

    return {
      user: this.sanitizeUser(user),
      token
    };
  }

  // Resend OTP
  async resendOTP(userId) {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    if (user.isVerified) {
      throw new Error('User is already verified');
    }

    // Generate new OTP
    const otp = this.generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    user.otp = {
      code: otp,
      expires: otpExpires,
      verified: false
    };
    await user.save();

    // Send OTP via Email
    try {
      await sendOTPEmail(user.email, otp, user.fullName);
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      throw new Error('Failed to send OTP');
    }

    return {
      message: 'OTP sent successfully'
    };
  }

  // Forgot password
  async forgotPassword(email) {
    const user = await User.findOne({ email, isActive: true });

    if (!user) {
      throw new Error('No account found with this email address');
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpires;
    await user.save();

    // Send reset email
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
      await sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        html: `
          <h2>Password Reset Request</h2>
          <p>You requested a password reset. Click the link below to reset your password:</p>
          <a href="${resetUrl}">Reset Password</a>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
        `
      });
    } catch (error) {
      console.error('Failed to send reset email:', error);
      throw new Error('Failed to send reset email');
    }

    return {
      message: 'Password reset email sent successfully'
    };
  }

  // Reset password
  async resetPassword(resetToken, newPassword) {
    const user = await User.findOne({
      resetPasswordToken: resetToken,
      resetPasswordExpires: { $gt: new Date() },
      isActive: true
    });

    if (!user) {
      throw new Error('Invalid or expired reset token');
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update user
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return {
      message: 'Password reset successfully'
    };
  }

  // Change password
  async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isCurrentPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    user.password = hashedPassword;
    await user.save();

    return {
      message: 'Password changed successfully'
    };
  }

  // Get user profile
  async getProfile(userId) {
    const user = await User.findById(userId).populate('addresses');

    if (!user) {
      throw new Error('User not found');
    }

    return this.sanitizeUser(user);
  }

  // Update user profile
  async updateProfile(userId, updateData) {
    const allowedUpdates = ['fullName', 'email', 'profileImage', 'addresses'];
    const updates = {};

    // Filter allowed updates
    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // If email is being updated, check for duplicates
    if (updates.email) {
      const existingUser = await User.findOne({
        email: updates.email,
        _id: { $ne: userId }
      });

      if (existingUser) {
        throw new Error('Email is already in use by another account');
      }
    }

    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).populate('addresses');

    if (!user) {
      throw new Error('User not found');
    }

    return this.sanitizeUser(user);
  }

  // Generate OTP
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Generate JWT token
  generateToken(user) {
    return jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
  }

  // Sanitize user data (remove sensitive information)
  sanitizeUser(user) {
    const userObject = user.toObject();
    delete userObject.password;
    delete userObject.otp;
    delete userObject.resetPasswordToken;
    delete userObject.resetPasswordExpires;
    return userObject;
  }

  // Verify JWT token
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (!user || !user.isActive) {
        throw new Error('Invalid token');
      }

      return this.sanitizeUser(user);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
}

module.exports = new AuthService();
