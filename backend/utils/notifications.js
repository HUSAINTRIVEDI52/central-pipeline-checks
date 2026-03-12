const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

// Initialize services
let emailTransporter = null;
let firebaseApp = null;

// Initialize email service
const initializeEmail = async () => {
  try {
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('Email configuration missing, running in development mode');
      console.log('Required env vars: EMAIL_HOST, EMAIL_USER, EMAIL_PASS');
      return;
    }

    emailTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Verify the connection with timeout
    const verifyPromise = emailTransporter.verify();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Email verification timed out')), 5000)
    );
    
    await Promise.race([verifyPromise, timeoutPromise]);
    console.log('✅ Email service initialized and verified successfully');
  } catch (error) {
    console.error('❌ Email service initialization failed:', error.message);
    console.log('📧 Falling back to development mode (console logging)');
    emailTransporter = null;
  }
};


// Initialize Firebase for push notifications
const initializeFirebase = () => {
  try {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      };

      if (!admin.apps.length) {
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID
        });
      } else {
        firebaseApp = admin.app();
      }
      console.log('✅ Firebase service initialized successfully');
    } else {
      console.log('🔥 Firebase configuration missing, push notifications disabled');
    }
  } catch (error) {
    console.error('❌ Firebase service initialization failed:', error.message);
    console.log('🔥 Push notifications will be disabled');
  }
};

// Initialize all notification services
const initializeNotificationServices = async () => {
  await initializeEmail();
  initializeFirebase();
};

// Send OTP via Email
const sendOTPEmail = async (email, otp, fullName) => {
  try {
    return await sendEmail({
      to: email,
      subject: 'LocalIt Verification Code',
      template: 'welcome',
      data: { fullName, otp }
    });
  } catch (error) {
    console.error('OTP email sending failed:', error);
    
    // Fallback to console log in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV] OTP email for ${email}: ${otp}`);
      return {
        success: true,
        messageId: 'dev-mode',
        status: 'development'
      };
    }
    
    throw error;
  }
};

// Send email
const sendEmail = async ({ to, subject, template, data, html, text }) => {
  try {
    if (!emailTransporter) {
      // In development mode, just log to console
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV] Email to ${to}: ${subject}`);
        if (template && data) {
          const templates = getEmailTemplates();
          if (templates[template] && data.otp) {
            console.log(`[DEV] OTP for ${to}: ${data.otp}`);
          }
        }
        return {
          success: true,
          messageId: 'dev-mode',
          status: 'development'
        };
      }
      throw new Error('Email service not initialized');
    }

    let emailHtml = html;
    let emailText = text;

    // Use template if provided
    if (template && data) {
      const templates = getEmailTemplates();
      if (templates[template]) {
        emailHtml = templates[template](data);
        emailText = generateTextFromTemplate(template, data);
      }
    }

    const mailOptions = {
      from: `"LocalIt" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: emailHtml,
      text: emailText
    };

    const result = await emailTransporter.sendMail(mailOptions);
    
    console.log(`Email sent successfully to ${to}`);
    return {
      success: true,
      messageId: result.messageId,
      status: 'sent'
    };

  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};

// Send push notification
const sendPushNotification = async ({ token, title, message, data = {} }) => {
  try {
    if (!firebaseApp) {
      throw new Error('Firebase service not initialized');
    }

    const payload = {
      notification: {
        title: title,
        body: message
      },
      data: {
        ...data,
        timestamp: Date.now().toString()
      },
      token: token
    };

    const result = await admin.messaging().send(payload);
    
    console.log('Push notification sent successfully');
    return {
      success: true,
      messageId: result,
      status: 'sent'
    };

  } catch (error) {
    console.error('Push notification sending failed:', error);
    
    // Don't throw error for push notification failures
    return {
      success: false,
      error: error.message,
      status: 'failed'
    };
  }
};

// Send notification to multiple users
const sendBulkNotification = async (users, { title, message, data = {} }) => {
  try {
    if (!firebaseApp || !users.length) {
      throw new Error('Firebase service not initialized or no users provided');
    }

    // Filter users with valid FCM tokens
    const validTokens = users
      .filter(user => user.fcmToken)
      .map(user => user.fcmToken);

    if (validTokens.length === 0) {
      console.log('No valid FCM tokens found for bulk notification');
      return {
        success: false,
        error: 'No valid tokens'
      };
    }

    const payload = {
      notification: {
        title: title,
        body: message
      },
      data: {
        ...data,
        timestamp: Date.now().toString()
      },
      tokens: validTokens
    };

    const result = await admin.messaging().sendMulticast(payload);
    
    console.log(`Bulk notification sent: ${result.successCount}/${validTokens.length} successful`);
    return {
      success: true,
      successCount: result.successCount,
      failureCount: result.failureCount,
      results: result.responses
    };

  } catch (error) {
    console.error('Bulk notification sending failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Email templates
const getEmailTemplates = () => {
  return {
    welcome: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Welcome to LocalIt!</h2>
        <p>Hi ${data.fullName},</p>
        <p>Thank you for joining LocalIt! Your account has been created successfully.</p>
        <p>Your verification code is: <strong style="font-size: 24px; color: #4CAF50;">${data.otp}</strong></p>
        <p>This code will expire in 10 minutes.</p>
        <p>Start exploring local shops and products in your area!</p>
        <br>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `,
    
    'forgot-password': (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #FF9800;">Password Reset Request</h2>
        <p>Hi ${data.fullName},</p>
        <p>We received a request to reset your password for your LocalIt account.</p>
        <p>Your password reset code is: <strong style="font-size: 24px; color: #FF9800;">${data.otp}</strong></p>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't request this password reset, please ignore this email.</p>
        <br>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `,
    
    'order-confirmation': (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Order Confirmed!</h2>
        <p>Hi ${data.customerName},</p>
        <p>Your order <strong>#${data.orderNumber}</strong> has been confirmed!</p>
        <div style="background: #f5f5f5; padding: 15px; margin: 15px 0; border-radius: 5px;">
          <h3>Order Details:</h3>
          <p><strong>Shop:</strong> ${data.shopName}</p>
          <p><strong>Total Amount:</strong> ₹${data.totalAmount}</p>
          <p><strong>Estimated Delivery:</strong> ${data.estimatedDelivery}</p>
        </div>
        <p>You can track your order in the LocalIt app.</p>
        <br>
        <p>Thank you for choosing LocalIt!</p>
      </div>
    `,
    
    'delivery-update': (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2196F3;">Delivery Update</h2>
        <p>Hi ${data.customerName},</p>
        <p>Your order <strong>#${data.orderNumber}</strong> is ${data.status}!</p>
        ${data.deliveryPartner ? `<p><strong>Delivery Partner:</strong> ${data.deliveryPartner}</p>` : ''}
        ${data.trackingUrl ? `<p><a href="${data.trackingUrl}" style="color: #2196F3;">Track your order</a></p>` : ''}
        <p>Estimated delivery time: ${data.estimatedDelivery}</p>
        <br>
        <p>Thank you for choosing LocalIt!</p>
      </div>
    `
  };
};

// Generate plain text from template
const generateTextFromTemplate = (template, data) => {
  const templates = {
    welcome: (data) => `
      Welcome to LocalIt!
      
      Hi ${data.fullName},
      
      Thank you for joining LocalIt! Your verification code is: ${data.otp}
      This code will expire in 10 minutes.
      
      Best regards,
      The LocalIt Team
    `,
    
    'forgot-password': (data) => `
      Password Reset Request
      
      Hi ${data.fullName},
      
      Your password reset code is: ${data.otp}
      This code will expire in 10 minutes.
      
      Best regards,
      The LocalIt Team
    `
  };
  
  return templates[template] ? templates[template](data) : '';
};


// Validate email address
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Notification queue processor (for handling high volume)
class NotificationQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxRetries = 3;
  }

  async add(notification) {
    this.queue.push({
      ...notification,
      attempts: 0,
      createdAt: new Date()
    });
    
    if (!this.processing) {
      this.process();
    }
  }

  async process() {
    this.processing = true;
    
    while (this.queue.length > 0) {
      const notification = this.queue.shift();
      
      try {
        await this.sendNotification(notification);
      } catch (error) {
        notification.attempts++;
        
        if (notification.attempts < this.maxRetries) {
          // Retry with exponential backoff
          setTimeout(() => {
            this.queue.push(notification);
          }, Math.pow(2, notification.attempts) * 1000);
        } else {
          console.error('Notification failed after max retries:', error);
        }
      }
    }
    
    this.processing = false;
  }

  async sendNotification(notification) {
    const { type, recipient, data } = notification;
    
    switch (type) {
      case 'email':
        return await sendEmail(data);
      case 'push':
        return await sendPushNotification(data);
      default:
        throw new Error(`Unknown notification type: ${type}`);
    }
  }
}

// Create singleton notification queue
const notificationQueue = new NotificationQueue();

module.exports = {
  initializeNotificationServices,
  sendOTPEmail,
  sendEmail,
  sendPushNotification,
  sendBulkNotification,
  validateEmail,
  notificationQueue
};
