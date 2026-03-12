const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const {
  authenticate,
  createActionLimiter,
  logActivity,
} = require("../middleware/auth");
const {
  validateUserRegistration,
  validateUserLogin,
  validateOTP,
} = require("../middleware/validation");
const { sendOTPEmail, sendEmail } = require("../utils/notifications");

const router = express.Router();

// Rate limiters
const otpLimiter = createActionLimiter(
  15 * 60 * 1000,
  5,
  "Too many OTP requests"
);
const loginLimiter = createActionLimiter(
  15 * 60 * 1000,
  10,
  "Too many login attempts"
);

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    const { fullName, email, phone, password, role = "customer" } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          existingUser.email === email
            ? "Email already registered"
            : "Phone number already registered",
      });
    }

    // Create new user
    const user = new User({
      fullName,
      email,
      phone,
      password,
      role,
    });

    // Generate and send OTP
    const otp = user.generateOTP();
    await user.save();

    // Send OTP via Email only
    try {
      await sendOTPEmail(email, otp, fullName);
    } catch (otpError) {
      console.error("OTP email sending failed:", otpError);
      // Continue registration even if OTP fails
    }

    res.status(201).json({
      success: true,
      message:
        "Registration successful. Please verify your account with the OTP sent to your email.",
      userId: user._id,
      needsVerification: true,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: "User ID and OTP are required",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Account is already verified",
      });
    }

    if (!user.verifyOTP(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Mark user as verified
    user.isVerified = true;
    user.clearOTP();
    await user.save();

    // Generate JWT token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: "Account verified successfully",
      data: {
        token,
        user: {
          _id: user._id,
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
        },
      },
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({
      success: false,
      message: "OTP verification failed",
    });
  }
};

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
const resendOTP = [
  otpLimiter,
  async (req, res) => {
    try {
      const { userId } = req.body;

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.isVerified) {
        return res.status(400).json({
          success: false,
          message: "Account is already verified",
        });
      }

      // Generate new OTP
      const otp = user.generateOTP();
      await user.save();

      // Send OTP via email
      await sendOTPEmail(user.email, otp, user.fullName);

      res.json({
        success: true,
        message: "New OTP sent successfully",
      });
    } catch (error) {
      console.error("Resend OTP error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to resend OTP",
      });
    }
  },
];

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = [
  loginLimiter,
  logActivity("login"),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find user with password field
      const user = await User.findOne({ email }).select("+password");

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      // Check password
      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: "Account has been deactivated",
        });
      }

      // Check if user needs verification
      if (!user.isVerified) {
        // Generate new OTP for unverified users
        const otp = user.generateOTP();
        await user.save();

        try {
          await sendOTPEmail(user.email, otp, user.fullName);
        } catch (otpError) {
          console.error("OTP sending failed:", otpError);
        }

        return res.status(403).json({
          success: false,
          message: "Account not verified. OTP sent to your email.",
          needsVerification: true,
          userId: user._id,
        });
      }

      // Generate token
      const token = generateToken(user._id);

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      res.json({
        success: true,
        message: "Login successful",
        data: {
          token,
          user: {
            _id: user._id,
            id: user._id,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            role: user.role,
            isVerified: user.isVerified,
            profileImage: user.profileImage,
          },
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Login failed",
      });
    }
  },
];

// @desc    Get current user profile
// @route   GET /api/auth/profile
// @access  Private
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("address")
      .select("-password");

    res.json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get profile",
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = async (req, res) => {
  try {
    const allowedUpdates = ["fullName", "profileImage", "address", "fcmToken"];
    const updates = {};

    // Filter allowed updates
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    // Get user with password
    const user = await User.findById(req.user._id).select("+password");

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  }
};

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email",
      });
    }

    // Generate OTP for password reset
    const otp = user.generateOTP();
    await user.save();

    // Send reset OTP
    try {
      // await sendOTP(user.phone, otp);
      await sendEmail({
        to: user.email,
        subject: "Password Reset OTP",
        template: "forgot-password",
        data: { fullName: user.fullName, otp },
      });
    } catch (error) {
      console.error("Reset OTP sending failed:", error);
    }

    res.json({
      success: true,
      message: "Password reset OTP sent to your phone and email",
      userId: user._id,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process forgot password request",
    });
  }
};

// @desc    Reset password with OTP
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { userId, otp, newPassword } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.verifyOTP(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Update password
    user.password = newPassword;
    user.clearOTP();
    await user.save();

    res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset password",
    });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    // Verify the refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // Generate new access token
    const newAccessToken = generateToken(user._id);

    res.json({
      success: true,
      accessToken: newAccessToken,
      message: "Token refreshed successfully",
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
    });
  }
};

// @desc    Logout user (client-side token removal)
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res) => {
  try {
    // Clear FCM token to stop push notifications
    if (req.body.fcmToken) {
      await User.findByIdAndUpdate(req.user._id, {
        $unset: { fcmToken: 1 },
      });
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

// Apply validation middleware and route handlers
router.post("/register", validateUserRegistration, register); // done
router.post("/verify-otp", validateOTP, verifyOTP); // done
router.post("/resend-otp", resendOTP); // done
router.post("/login", validateUserLogin, login); // done
router.post("/refresh", refreshToken); // done - Token refresh
router.get("/profile", authenticate, getProfile); // done
router.put("/profile", authenticate, updateProfile); // done
router.put("/change-password", authenticate, changePassword); // done
router.post("/forgot-password", forgotPassword); // done
router.post("/reset-password", resetPassword); // done
router.post("/logout", authenticate, logout); // done

module.exports = router;
