const mongoose = require('mongoose');
const Product = require('../models/Product');
const Review = require('../models/Review');
const Shop = require('../models/Shop');
const Category = require('../models/Category');
const User = require('../models/User');
require('dotenv').config();

const generatePDP = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/localit');
    console.log('Connected to MongoDB');

    // 0. Cleanup Indexes (Fix for duplicate key error on email: null and phoneNumber: null)
    try {
      await Shop.collection.dropIndex('email_1');
      console.log('Dropped email_1 index from shops collection');
    } catch (e) {
      // Index might not exist, ignore
    }
    try {
      await Shop.collection.dropIndex('phoneNumber_1');
      console.log('Dropped phoneNumber_1 index from shops collection');
    } catch (e) {
      // Index might not exist, ignore
    }

    // 1. Find or Create Dependencies
    let owner = await User.findOne();
    if (!owner) {
      owner = await User.create({
        name: 'Admin User',
        email: 'admin@localit.com',
        password: 'password123', // In real app this should be hashed
        role: 'admin',
        phone: '9999999999'
      });
      console.log('Created Dummy Owner:', owner.name);
    }

    let shop = await Shop.findOne({ name: 'TechHaven Electronics' });
    if (!shop) {
      shop = await Shop.create({
        ownerId: owner._id,
        name: 'TechHaven Electronics',
        category: 'electronics',
        address: {
          street: '123 Tech Park',
          city: 'Bangalore',
          state: 'Karnataka',
          pincode: '560001',
          coordinates: { latitude: 12.9716, longitude: 77.5946 }
        },
        contact: { phone: '9876543210', email: 'contact@techhaven.com' },
        deliveryRadius: 10,
        deliveryFee: 50,
        minimumOrderAmount: 500
      });
      console.log('Created Shop:', shop.name);
    }

    let category = await Category.findOne({ name: 'Smartphones' });
    if (!category) {
      category = await Category.create({
        name: 'Smartphones',
        description: 'Latest mobile phones',
        image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500&q=80'
      });
      console.log('Created Category:', category.name);
    }

    // 2. Create Product
    const productData = {
      shopId: shop._id,
      categoryId: category._id,
      name: 'Aura X Pro Smartphone',
      brand: 'Aura',
      description: 'The Aura X Pro redefines smartphone photography with its revolutionary 200MP triple-camera system. Powered by the latest Snapdragon 8 Gen 3 processor, it delivers blazing fast performance for gaming and multitasking. The 6.8-inch AMOLED display with 120Hz refresh rate offers an immersive viewing experience, while the 5000mAh battery ensures all-day usage. With 100W super-fast charging, you can get back to 100% in just 25 minutes.',
      shortDescription: '200MP Camera, Snapdragon 8 Gen 3, 120Hz AMOLED Display',
      price: 69999,
      discountPrice: 64999,
      unit: 'piece',
      stock: {
        available: 50,
        lowStockThreshold: 5
      },
      images: [
        { url: 'https://images.unsplash.com/photo-1616348436168-de43ad0db179?w=800&q=80', isPrimary: true },
        { url: 'https://images.unsplash.com/photo-1592750475338-74b7b2191392?w=800&q=80' },
        { url: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=80' },
        { url: 'https://images.unsplash.com/photo-1598327773204-3c34295f12d9?w=800&q=80' },
        { url: 'https://images.unsplash.com/photo-1565849904461-04a58ad377e0?w=800&q=80' }
      ],
      features: [
        '200MP Main Camera with OIS',
        'Snapdragon 8 Gen 3 Processor',
        '6.8" QHD+ AMOLED Display, 120Hz',
        '5000mAh Battery with 100W Charging',
        'IP68 Water & Dust Resistance',
        'Gorilla Glass Victus 2 Protection'
      ],
      specifications: [
        { key: 'Display', value: '6.8 inch LTPO AMOLED' },
        { key: 'Processor', value: 'Snapdragon 8 Gen 3' },
        { key: 'RAM', value: '12GB LPDDR5X' },
        { key: 'Storage', value: '256GB UFS 4.0' },
        { key: 'Camera', value: '200MP + 50MP + 12MP' },
        { key: 'Battery', value: '5000mAh' },
        { key: 'OS', value: 'Android 14 with AuraUI' }
      ],
      boxContent: [
        'Aura X Pro Smartphone',
        '100W Power Adapter',
        'USB-C to USB-C Cable',
        'SIM Ejector Tool',
        'Protective Case',
        'Quick Start Guide'
      ],
      warranty: {
        text: '1 Year Manufacturer Warranty for Device and 6 Months for In-box Accessories',
        type: 'Brand Warranty',
        duration: '1 Year'
      },
      deliveryInfo: {
        standardDeliveryDays: 3,
        expressDeliveryDays: 1,
        isExpressAvailable: true
      },
      offers: [
        { code: 'WELCOME500', description: 'Flat ₹500 off on first order', discountPercentage: 0 },
        { code: 'BANK10', description: '10% Instant Discount on HDFC Cards', discountPercentage: 10 }
      ],
      tags: ['smartphone', 'electronics', '5g', 'camera phone', 'gaming'],
      isFeatured: true,
      status: 'in_stock'
    };

    // Check if product exists
    let product = await Product.findOne({ name: productData.name });
    if (product) {
      // Update existing
      Object.assign(product, productData);
      await product.save();
      console.log('Updated Product:', product.name);
    } else {
      // Create new
      product = await Product.create(productData);
      console.log('Created Product:', product.name);
    }

    // 3. Create Reviews
    const reviewsData = [
      {
        userName: 'Rahul Sharma',
        rating: 5,
        comment: 'Absolutely stunning phone! The camera is a beast, especially in low light. Battery lasts easily a day and a half.',
        isVerifiedPurchase: true,
        date: new Date('2023-10-15')
      },
      {
        userName: 'Priya Patel',
        rating: 4,
        comment: 'Great performance and display. The only downside is the size, it is a bit heavy. But otherwise a flagship killer.',
        isVerifiedPurchase: true,
        date: new Date('2023-10-20')
      },
      {
        userName: 'Amit Kumar',
        rating: 5,
        comment: 'Fastest charging I have ever seen. 0 to 100 in 25 mins is real! Gaming performance is top notch.',
        isVerifiedPurchase: true,
        date: new Date('2023-10-25')
      },
      {
        userName: 'Sneha Gupta',
        rating: 5,
        comment: 'Love the design and the screen quality. Watching movies is a treat. Highly recommended!',
        isVerifiedPurchase: true,
        date: new Date('2023-11-01')
      },
      {
        userName: 'Vikram Singh',
        rating: 3,
        comment: 'Good phone but gets a bit warm during heavy gaming. Camera is great though.',
        isVerifiedPurchase: true,
        date: new Date('2023-11-05')
      }
    ];

    // Get a user for reviews (or create dummy users if needed, but for now use the owner or find users)
    const users = await User.find().limit(5);
    
    // Clear existing reviews for this product
    await Review.deleteMany({ productId: product._id });

    for (let i = 0; i < reviewsData.length; i++) {
      const review = reviewsData[i];
      const user = users[i % users.length] || users[0]; // Fallback to first user
      
      await Review.create({
        productId: product._id,
        userId: user._id,
        userName: review.userName,
        rating: review.rating,
        comment: review.comment,
        isVerifiedPurchase: review.isVerifiedPurchase,
        createdAt: review.date
      });
    }
    console.log(`Created ${reviewsData.length} reviews`);

    // 4. Output Full Dataset
    const fullProduct = await Product.findById(product._id)
      .populate('shopId')
      .populate('categoryId');
    
    const reviews = await Review.find({ productId: product._id });

    const dataset = {
      product: fullProduct.toObject(),
      reviews: reviews.map(r => r.toObject()),
      relatedProducts: [] // Placeholder
    };

    console.log('---------------------------------------------------------');
    console.log('PDP DATASET GENERATED SUCCESSFULLY');
    console.log('---------------------------------------------------------');
    // console.log(JSON.stringify(dataset, null, 2));

  } catch (error) {
    console.error('Error generating PDP data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

generatePDP();
