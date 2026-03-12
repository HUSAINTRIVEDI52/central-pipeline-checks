const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferMaxEntries: 0,
      bufferCommands: false,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}:${conn.connection.port}`);
    console.log(`Database Name: ${conn.connection.name}`);

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });

    return conn;

  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

// Create database indexes for better performance
const createIndexes = async () => {
  try {
    const db = mongoose.connection.db;

    // Text search indexes
    await db.collection('products').createIndex({
      name: 'text',
      description: 'text'
    }, { background: true });

    await db.collection('shops').createIndex({
      name: 'text',
      description: 'text'
    }, { background: true });

    // Geospatial indexes
    await db.collection('shops').createIndex({
      'address.coordinates': '2dsphere'
    }, { background: true });

    await db.collection('deliverypartnerprofiles').createIndex({
      'currentLocation': '2dsphere'
    }, { background: true });

    await db.collection('orders').createIndex({
      'deliveryAddress.coordinates': '2dsphere'
    }, { background: true });

    // Compound indexes for better query performance
    await db.collection('products').createIndex({
      shopId: 1,
      isActive: 1,
      status: 1
    }, { background: true });

    await db.collection('orders').createIndex({
      customerId: 1,
      createdAt: -1
    }, { background: true });

    await db.collection('orders').createIndex({
      shopId: 1,
      status: 1,
      createdAt: -1
    }, { background: true });

    await db.collection('notifications').createIndex({
      recipientId: 1,
      isRead: 1,
      createdAt: -1
    }, { background: true });

    console.log('Database indexes created successfully');

  } catch (error) {
    console.error('Error creating database indexes:', error);
  }
};

// Graceful database disconnection
const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log('Database disconnected successfully');
  } catch (error) {
    console.error('Error disconnecting from database:', error);
  }
};

module.exports = {
  connectDB,
  createIndexes,
  disconnectDB
};
