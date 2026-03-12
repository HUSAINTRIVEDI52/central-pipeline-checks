const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/Product');
const Review = require('../models/Review');

dotenv.config();

const deleteDummyProduct = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const productName = 'Aura X Pro Smartphone';
    const product = await Product.findOne({ name: productName });

    if (!product) {
      console.log(`Product '${productName}' not found.`);
    } else {
      // Delete reviews associated with the product
      const reviewsResult = await Review.deleteMany({ productId: product._id });
      console.log(`Deleted ${reviewsResult.deletedCount} reviews.`);

      // Delete the product
      await Product.findByIdAndDelete(product._id);
      console.log(`Deleted product: ${productName}`);
    }

    console.log('---------------------------------------------------------');
    console.log('DUMMY PRODUCT DELETED SUCCESSFULLY');
    console.log('---------------------------------------------------------');

  } catch (error) {
    console.error('Error deleting product:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
};

deleteDummyProduct();
