const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Coupon = require('../models/Coupon');

const seedData = async () => {
  try {
    console.log('🌱 Starting database seeding...');

    // Clear existing data
    await User.deleteMany({});
    await Shop.deleteMany({});
    await Product.deleteMany({});
    await Category.deleteMany({});
    await Coupon.deleteMany({});
    
    console.log('🧹 Cleared existing data');

    // Create Categories
    const categories = [
      {
        name: 'Grocery & Daily Needs',
        description: 'Fresh fruits, vegetables, dairy & essentials',
        isActive: true
      },
      {
        name: 'Restaurants & Food',
        description: 'Delicious meals from local restaurants',
        isActive: true
      },
      {
        name: 'Pharmacy & Health',
        description: 'Medicines, health products & wellness',
        isActive: true
      },
      {
        name: 'Electronics & Gadgets',
        description: 'Mobile phones, accessories & electronics',
        isActive: true
      },
      {
        name: 'Fashion & Clothing',
        description: 'Trendy clothes, shoes & accessories',
        isActive: true
      }
    ];

    const createdCategories = await Category.insertMany(categories);
    console.log('📂 Created categories');

    // Create Admin User
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = await User.create({
      fullName: 'System Administrator',
      email: 'admin@localit.app',
      phone: '+91-9999999999',
      password: adminPassword,
      role: 'admin',
      isVerified: true,
      isActive: true,
      addresses: []
    });

    // Create Sample Customer
    const customerPassword = await bcrypt.hash('customer123', 10);
    const customer = await User.create({
      fullName: 'John Doe',
      email: 'customer@localit.app',
      phone: '+91-9876543210',
      password: customerPassword,
      role: 'customer',
      isVerified: true,
      isActive: true,
      addresses: [{
        type: 'home',
        addressLine1: '123 Main Street',
        addressLine2: 'Apartment 4B',
        city: 'Gurgaon',
        state: 'Haryana',
        postalCode: '122001',
        country: 'India',
        coordinates: {
          type: 'Point',
          coordinates: [77.0266, 28.4595]
        }
      }]
    });

    // Create Sample Shop Owner
    const shopOwnerPassword = await bcrypt.hash('shopowner123', 10);
    const shopOwner = await User.create({
      fullName: 'Raj Patel',
      email: 'shopowner@localit.app',
      phone: '+91-9876543211',
      password: shopOwnerPassword,
      role: 'shop_owner',
      isVerified: true,
      isActive: true,
      addresses: [{
        type: 'business',
        addressLine1: '456 Business Street',
        addressLine2: 'Shop No. 12',
        city: 'Gurgaon',
        state: 'Haryana',
        postalCode: '122002',
        country: 'India',
        coordinates: {
          type: 'Point',
          coordinates: [77.0300, 28.4600]
        }
      }]
    });

    // Create Sample Delivery Partner
    const deliveryPassword = await bcrypt.hash('delivery123', 10);
    const deliveryPartner = await User.create({
      fullName: 'Delivery Partner',
      email: 'delivery@localit.app',
      phone: '+91-9876543212',
      password: deliveryPassword,
      role: 'delivery_partner',
      isVerified: true,
      isActive: true,
      addresses: [{
        type: 'home',
        addressLine1: '789 Delivery Street',
        city: 'Gurgaon',
        state: 'Haryana',
        postalCode: '122003',
        country: 'India',
        coordinates: {
          type: 'Point',
          coordinates: [77.0250, 28.4580]
        }
      }]
    });

    console.log('👥 Created sample users');

    // Create Sample Shops
    const shops = [
      {
        name: 'Fresh Mart',
        description: 'Your neighborhood grocery store with fresh products daily',
        category: createdCategories[0]._id, // Grocery
        owner: shopOwner._id,
        contact: {
          email: 'freshmart@localit.app',
          phone: '+91-9999888877',
          whatsapp: '+91-9999888877'
        },
        address: {
          addressLine1: '456 Business Street',
          addressLine2: 'Shop No. 12',
          city: 'Gurgaon',
          state: 'Haryana',
          postalCode: '122002',
          country: 'India',
          coordinates: {
            type: 'Point',
            coordinates: [77.0300, 28.4600]
          }
        },
        operatingHours: {
          monday: { open: '08:00', close: '22:00', isOpen: true },
          tuesday: { open: '08:00', close: '22:00', isOpen: true },
          wednesday: { open: '08:00', close: '22:00', isOpen: true },
          thursday: { open: '08:00', close: '22:00', isOpen: true },
          friday: { open: '08:00', close: '22:00', isOpen: true },
          saturday: { open: '08:00', close: '22:00', isOpen: true },
          sunday: { open: '09:00', close: '21:00', isOpen: true }
        },
        deliveryRadius: 5,
        minimumOrderAmount: 100,
        deliveryFee: 25,
        deliveryTime: 30,
        isActive: true,
        isVerified: true
      },
      {
        name: 'Digital Electronics',
        description: 'Latest gadgets and electronics at best prices',
        category: createdCategories[3]._id, // Electronics
        owner: shopOwner._id,
        contact: {
          email: 'electronics@localit.app',
          phone: '+91-9999888878',
          whatsapp: '+91-9999888878'
        },
        address: {
          addressLine1: '789 Tech Street',
          addressLine2: 'Electronic Market',
          city: 'Gurgaon',
          state: 'Haryana',
          postalCode: '122004',
          country: 'India',
          coordinates: {
            type: 'Point',
            coordinates: [77.0320, 28.4620]
          }
        },
        operatingHours: {
          monday: { open: '10:00', close: '21:00', isOpen: true },
          tuesday: { open: '10:00', close: '21:00', isOpen: true },
          wednesday: { open: '10:00', close: '21:00', isOpen: true },
          thursday: { open: '10:00', close: '21:00', isOpen: true },
          friday: { open: '10:00', close: '21:00', isOpen: true },
          saturday: { open: '10:00', close: '21:00', isOpen: true },
          sunday: { open: '11:00', close: '20:00', isOpen: true }
        },
        deliveryRadius: 8,
        minimumOrderAmount: 200,
        deliveryFee: 50,
        deliveryTime: 45,
        isActive: true,
        isVerified: true
      }
    ];

    const createdShops = await Shop.insertMany(shops);
    console.log('🏪 Created sample shops');

    // Create Sample Products
    const products = [
      // Grocery Products
      {
        name: 'Fresh Red Apples',
        description: 'Premium quality red apples - sweet and crispy',
        category: createdCategories[0]._id,
        shop: createdShops[0]._id,
        price: {
          original: 180,
          discounted: 150,
          currency: 'INR'
        },
        images: ['https://example.com/apple.jpg'],
        inventory: {
          quantity: 100,
          unit: 'kg',
          lowStockThreshold: 10
        },
        specifications: {
          brand: 'Fresh Farm',
          weight: '1 kg',
          origin: 'Himachal Pradesh'
        },
        tags: ['fresh', 'fruit', 'healthy'],
        isActive: true,
        isAvailable: true
      },
      {
        name: 'Full Cream Milk',
        description: 'Fresh full cream milk - rich and nutritious',
        category: createdCategories[0]._id,
        shop: createdShops[0]._id,
        price: {
          original: 65,
          discounted: 60,
          currency: 'INR'
        },
        images: ['https://example.com/milk.jpg'],
        inventory: {
          quantity: 50,
          unit: 'liter',
          lowStockThreshold: 5
        },
        specifications: {
          brand: 'Daily Fresh',
          volume: '1 liter',
          fatContent: '6%'
        },
        tags: ['dairy', 'fresh', 'daily'],
        isActive: true,
        isAvailable: true
      },
      // Electronics Products
      {
        name: 'Wireless Bluetooth Headphones',
        description: 'Premium quality wireless headphones with noise cancellation',
        category: createdCategories[3]._id,
        shop: createdShops[1]._id,
        price: {
          original: 3999,
          discounted: 2999,
          currency: 'INR'
        },
        images: ['https://example.com/headphones.jpg'],
        inventory: {
          quantity: 25,
          unit: 'piece',
          lowStockThreshold: 3
        },
        specifications: {
          brand: 'TechSound',
          connectivity: 'Bluetooth 5.0',
          batteryLife: '30 hours',
          warranty: '1 year'
        },
        tags: ['wireless', 'bluetooth', 'music', 'electronics'],
        isActive: true,
        isAvailable: true
      },
      {
        name: 'Smartphone Mobile Cover',
        description: 'Durable mobile phone case with shock protection',
        category: createdCategories[3]._id,
        shop: createdShops[1]._id,
        price: {
          original: 299,
          discounted: 249,
          currency: 'INR'
        },
        images: ['https://example.com/cover.jpg'],
        inventory: {
          quantity: 100,
          unit: 'piece',
          lowStockThreshold: 10
        },
        specifications: {
          brand: 'GuardPro',
          material: 'Silicone + PC',
          compatibility: 'Universal',
          colors: 'Black, Blue, Red'
        },
        tags: ['mobile', 'protection', 'case', 'accessories'],
        isActive: true,
        isAvailable: true
      }
    ];

    const createdProducts = await Product.insertMany(products);
    console.log('📦 Created sample products');

    // Create Sample Coupons
    const coupons = [
      {
        code: 'WELCOME20',
        title: 'Welcome Offer',
        description: 'Get 20% off on your first order',
        discountType: 'percentage',
        discountValue: 20,
        minOrderAmount: 100,
        maxDiscountAmount: 100,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        usageLimit: 1000,
        usedCount: 0,
        userUsageLimit: 1,
        applicableOn: 'all',
        createdBy: admin._id,
        isActive: true
      },
      {
        code: 'SAVE50',
        title: 'Flat ₹50 Off',
        description: 'Save ₹50 on orders above ₹200',
        discountType: 'fixed',
        discountValue: 50,
        minOrderAmount: 200,
        maxDiscountAmount: 50,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days
        usageLimit: 500,
        usedCount: 0,
        userUsageLimit: 3,
        applicableOn: 'shop',
        applicableShops: [createdShops[0]._id],
        createdBy: admin._id,
        isActive: true
      }
    ];

    await Coupon.insertMany(coupons);
    console.log('🎫 Created sample coupons');

    console.log('✅ Database seeding completed successfully!');
    console.log('\n📋 Sample Credentials:');
    console.log('Admin: admin@localit.app / admin123');
    console.log('Customer: customer@localit.app / customer123');
    console.log('Shop Owner: shopowner@localit.app / shopowner123');
    console.log('Delivery Partner: delivery@localit.app / delivery123');

  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
  }
};

module.exports = seedData;

// Run seeding if called directly
if (require.main === module) {
  const connectDB = require('../config/database');
  
  connectDB()
    .then(() => seedData())
    .then(() => {
      console.log('🎉 Seeding process completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Seeding process failed:', error);
      process.exit(1);
    });
}
