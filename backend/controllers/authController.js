const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');
const { logAuth } = require('../utils/logger');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password, role } = req.body;

  const result = await authService.register({
    fullName,
    email,
    phone,
    password,
    role
  });

  logAuth('user_registered', result.userId, { email, role });

  res.status(201).json(apiResponse(true, result.message, {
    userId: result.userId,
    needsVerification: result.needsVerification
  }));
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await authService.login(email, password);

  if (result.success) {
    logAuth('user_login_success', result.user._id, { email });
    
    res.json(apiResponse(true, 'Login successful', {
      user: result.user,
      token: result.token
    }));
  } else {
    logAuth('user_login_verification_required', result.userId, { email });
    
    res.status(200).json(apiResponse(false, result.message, {
      userId: result.userId,
      phoneNumber: result.phoneNumber,
      needsVerification: result.needsVerification
    }));
  }
});

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOTP = asyncHandler(async (req, res) => {
  const { userId, otp } = req.body;

  const result = await authService.verifyOTP(userId, otp);

  logAuth('otp_verified', result.user._id, { userId });

  res.json(apiResponse(true, 'OTP verified successfully', {
    user: result.user,
    token: result.token
  }));
});

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
const resendOTP = asyncHandler(async (req, res) => {
  const { userId } = req.body;

  await authService.resendOTP(userId);

  logAuth('otp_resent', userId);

  res.json(apiResponse(true, 'OTP sent successfully'));
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  await authService.forgotPassword(email);

  logAuth('password_reset_requested', null, { email });

  res.json(apiResponse(true, 'Password reset email sent successfully'));
});

// @desc    Reset password
// @route   POST /api/auth/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  await authService.resetPassword(token, password);

  logAuth('password_reset_completed', null, { token });

  res.json(apiResponse(true, 'Password reset successfully'));
});

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  await authService.changePassword(req.user.id, currentPassword, newPassword);

  logAuth('password_changed', req.user.id);

  res.json(apiResponse(true, 'Password changed successfully'));
});

// @desc    Refresh token
// @route   POST /api/auth/refresh
// @access  Private
const refreshToken = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  
  if (!user) {
    return res.status(401).json(apiResponse(false, 'User not found'));
  }

  const token = authService.generateToken(user);

  logAuth('token_refreshed', req.user.id);

  res.json(apiResponse(true, 'Token refreshed successfully', { token }));
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res) => {
  // For JWT tokens, logout is mainly client-side
  // But we can log the event and implement token blacklisting if needed
  
  logAuth('user_logout', req.user.id);

  res.json(apiResponse(true, 'Logged out successfully'));
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  
  res.json(apiResponse(true, 'User profile retrieved', user));
});

module.exports = {
  register,
  login,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  changePassword,
  refreshToken,
  logout,
  getMe
};
