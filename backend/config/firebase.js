const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
let firebaseApp = null;

const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Check if running in production with service account
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString()
      );
      
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID
      });
    } 
    // Development mode - use service account file
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID
      });
    }
    // Fallback for local development
    else {
      console.warn('⚠️ Firebase not configured. Push notifications will be disabled.');
      return null;
    }

    console.log('✅ Firebase Admin SDK initialized successfully');
    return firebaseApp;

  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    return null;
  }
};

const getFirebaseApp = () => {
  return firebaseApp || initializeFirebase();
};

// Send push notification
const sendPushNotification = async (tokens, notification, data = {}) => {
  const app = getFirebaseApp();
  if (!app) {
    console.warn('Firebase not configured. Skipping push notification.');
    return { success: false, error: 'Firebase not configured' };
  }

  try {
    const messaging = admin.messaging(app);
    
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl
      },
      data: {
        ...data,
        type: data.type || 'general',
        timestamp: new Date().toISOString()
      },
      tokens: Array.isArray(tokens) ? tokens : [tokens]
    };

    const response = await messaging.sendMulticast(message);
    
    console.log(`📱 Push notification sent: ${response.successCount}/${tokens.length} successful`);
    
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses
    };

  } catch (error) {
    console.error('❌ Push notification failed:', error.message);
    return { success: false, error: error.message };
  }
};

// Send notification to topic
const sendTopicNotification = async (topic, notification, data = {}) => {
  const app = getFirebaseApp();
  if (!app) {
    console.warn('Firebase not configured. Skipping topic notification.');
    return { success: false, error: 'Firebase not configured' };
  }

  try {
    const messaging = admin.messaging(app);
    
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl
      },
      data: {
        ...data,
        type: data.type || 'general',
        timestamp: new Date().toISOString()
      },
      topic: topic
    };

    const response = await messaging.send(message);
    
    console.log(`📢 Topic notification sent to ${topic}:`, response);
    
    return { success: true, messageId: response };

  } catch (error) {
    console.error('❌ Topic notification failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  initializeFirebase,
  getFirebaseApp,
  sendPushNotification,
  sendTopicNotification
};
