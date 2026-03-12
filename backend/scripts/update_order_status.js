const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
require('dotenv').config();

const updateOrderForTracking = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find the most recent order
    const order = await Order.findOne().sort({ createdAt: -1 });

    if (!order) {
      console.log('No orders found.');
      return;
    }

    console.log(`Found order: ${order.orderId} (Status: ${order.status})`);

    // Update status to out_for_delivery
    order.status = 'out_for_delivery';
    
    // Add dummy delivery partner if missing
    if (!order.deliveryPartnerId) {
        // Find a user to be the delivery partner (or create one)
        let partner = await User.findOne({ role: 'delivery_partner' });
        if (!partner) {
            // Just use the first user found for demo
            partner = await User.findOne();
        }
        order.deliveryPartnerId = partner._id;
    }

    // Initialize tracking data
    order.deliveryTracking = {
        currentLocation: {
            latitude: 19.0760, // Mumbai
            longitude: 72.8777,
            timestamp: new Date()
        },
        route: []
    };

    await order.save();
    console.log(`Updated order ${order.orderId} to 'out_for_delivery' with tracking data.`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
};

updateOrderForTracking();
