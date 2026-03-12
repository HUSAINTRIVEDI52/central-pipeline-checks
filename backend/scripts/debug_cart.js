const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const User = require('../models/User');
require('dotenv').config();

const debugCart = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/localit');
    console.log('Connected to MongoDB');

    // Find the most recently updated cart
    const cart = await Cart.findOne().sort({ updatedAt: -1 })
      .populate('items.productId')
      .populate('shopId');

    if (!cart) {
      console.log('No cart found');
      return;
    }

    console.log('--- Cart Details ---');
    console.log(`User ID: ${cart.userId}`);
    console.log(`Shop ID: ${cart.shopId?._id}`);
    console.log(`Shop Name: ${cart.shopId?.name}`);
    console.log(`Shop Active: ${cart.shopId?.isActive}`);
    console.log(`Shop Open: ${cart.shopId?.isOpen}`);
    
    // Check operating hours
    if (cart.shopId) {
        const now = new Date();
        const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
        const currentDay = days[now.getDay()];
        const hours = now.getHours().toString().padStart(2, "0");
        const minutes = now.getMinutes().toString().padStart(2, "0");
        const currentTime = `${hours}:${minutes}`;
        
        console.log(`Current Time: ${currentDay} ${currentTime}`);
        const todaysHours = cart.shopId.operatingHours.find(h => h.day.toLowerCase() === currentDay);
        console.log('Today\'s Hours:', todaysHours);
        
        // Manually check isCurrentlyOpen logic
        const isOpen = cart.shopId.isCurrentlyOpen();
        console.log(`isCurrentlyOpen() returns: ${isOpen}`);
    }

    console.log(`Items: ${cart.items.length}`);

    for (const item of cart.items) {
      console.log(`- Product: ${item.productId?.name}`);
      console.log(`  ID: ${item.productId?._id}`);
      console.log(`  Active: ${item.productId?.isActive}`);
      console.log(`  Status: ${item.productId?.status}`);
      console.log(`  Stock: ${item.productId?.stock?.available}`);
      console.log(`  Cart Qty: ${item.quantity}`);
    }

    console.log('\n--- Validation Simulation ---');
    const validation = await cart.validateForCheckout();
    console.log('Validation Result:', JSON.stringify(validation, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
};

debugCart();
