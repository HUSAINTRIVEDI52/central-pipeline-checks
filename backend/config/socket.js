const socketIo = require('socket.io');
const { authenticateSocket, handleConnection } = require('../socket/socketHandlers');

const initializeSocket = (server) => {
  const io = socketIo(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3001",
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Apply authentication middleware
  io.use(authenticateSocket);

  // Handle connections
  io.on('connection', handleConnection(io));

  // Global error handler
  io.engine.on("connection_error", (err) => {
    console.log('Socket connection error:', err.req);
    console.log('Error code:', err.code);
    console.log('Error message:', err.message);
    console.log('Error context:', err.context);
  });

  return io;
};

module.exports = initializeSocket;
