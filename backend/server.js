const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const dotenv = require("dotenv");
const http = require("http");
const socketIo = require("socket.io");
// const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');

// Load environment variables
dotenv.config();

// Connect to Database
// connectDB();

// Connect to Redis
connectRedis();

// Initialize notification services
const { initializeNotificationServices } = require("./utils/notifications");

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const shopRoutes = require("./routes/shops");
const productRoutes = require("./routes/products");
const categoryRoutes = require("./routes/categories");
const orderRoutes = require("./routes/orders");
const cartRoutes = require("./routes/cart");
const paymentRoutes = require("./routes/payments");
const couponRoutes = require("./routes/coupons");
const notificationRoutes = require("./routes/notifications");
const deliveryRoutes = require("./routes/delivery");
const adminRoutes = require("./routes/admin");
const uploadRoutes = require("./routes/upload");
const addressRoutes = require("./routes/addresses");
const favoriteRoutes = require("./routes/favorites");
const noteRoutes = require("./routes/notes");
const settingsRoutes = require("./routes/settings");
const supportRoutes = require("./routes/support");

// Initialize express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
    methods: ["GET", "POST"],
  },
});

// Trust proxy for production deployment
app.set("trust proxy", 1);

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Compression middleware
app.use(compression());

// CORS middleware
app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "development" ? 1000 : 10, // Higher limit for development
  message: {
    error: "Too many authentication attempts, please try again later.",
    retryAfter: "15 minutes",
  },
});

// Logging middleware
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Static files middleware
app.use("/uploads", express.static("uploads"));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// API routes
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/shops", shopRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/support", supportRoutes);

// Socket.IO connection handling for real-time features
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join user-specific room for notifications
  socket.on("join_user_room", (userId) => {
    socket.join(`user_${userId}`);
    console.log(`User ${userId} joined their room`);
  });

  // Join order-specific room for tracking
  socket.on("join_order_room", (orderId) => {
    socket.join(`order_${orderId}`);
    console.log(`User joined order room: ${orderId}`);
  });

  // Handle delivery partner location updates
  socket.on("update_location", (data) => {
    // Broadcast location update to order room
    if (data.orderId) {
      socket.to(`order_${data.orderId}`).emit("location_update", {
        latitude: data.latitude,
        longitude: data.longitude,
        timestamp: new Date(),
      });
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set("socketio", io);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors,
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`,
      field,
    });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token expired",
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// Database connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 30000, // Increased timeout
      socketTimeoutMS: 45000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Create indexes
    await createIndexes();
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
};

// Create database indexes
const createIndexes = async () => {
  try {
    // Text search indexes
    await mongoose.connection.db.collection("products").createIndex({
      name: "text",
      description: "text",
    });

    await mongoose.connection.db.collection("shops").createIndex({
      name: "text",
      description: "text",
    });

    console.log("Database indexes created successfully");
  } catch (error) {
    console.error("Error creating indexes:", error);
  }
};

// Graceful shutdown
const gracefulShutdown = () => {
  console.log("Received shutdown signal, closing server gracefully...");

  server.close(() => {
    console.log("HTTP server closed");

    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed");
      process.exit(0);
    });
  });

  // Force close after 30 seconds
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 30000);
};

// Handle shutdown signals
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  server.close(() => {
    process.exit(1);
  });
});

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  await connectDB();

  // Initialize notification services
  await initializeNotificationServices();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 LocalIt Backend Server Started
🌐 Environment: ${process.env.NODE_ENV || "development"}
📍 Port: ${PORT}
🔗 Health Check (PC Browser): http://localhost:${PORT}/health
🔗 Health Check (Emulator):  http://10.0.2.2:${PORT}/health
📖 API Base URL (PC):       http://localhost:${PORT}/api
📖 API Base URL (Emulator): http://10.0.2.2:${PORT}/api
    `);
  });
};

startServer().catch(console.error);
