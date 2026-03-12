const mongoose = require('mongoose');
const Shop = require('../models/Shop');
require('dotenv').config();

const updateShopHours = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/localit');
    console.log('Connected to MongoDB');

    const shops = await Shop.find({});
    console.log(`Found ${shops.length} shops`);

    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const operatingHours = days.map(day => ({
      day,
      openTime: "00:00",
      closeTime: "23:59",
      isClosed: false
    }));

    for (const shop of shops) {
      shop.operatingHours = operatingHours;
      shop.isOpen = true; // Force open
      await shop.save();
      console.log(`Updated hours for shop: ${shop.name}`);
    }

    console.log('All shops updated.');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
};

updateShopHours();
