const Order = require('../models/Order');
const User = require('../models/User');

// Get tracking status for an order
exports.getTrackingStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const mongoose = require('mongoose');

    // Check if orderId is a valid ObjectId
    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const query = isObjectId ? { _id: orderId } : { orderId };

    const order = await Order.findOne(query)
      .populate('deliveryPartnerId', 'fullName phone vehicleNumber vehicleType')
      .populate('shopId', 'name address coordinates');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Calculate ETA based on distance (mock logic for now)
    let etaMinutes = 0;
    if (order.status === 'out_for_delivery' && order.deliveryTracking && order.deliveryTracking.currentLocation) {
      // Mock calculation: 1 minute per km (very rough)
      // In a real app, use Google Maps Distance Matrix API
      etaMinutes = Math.floor(Math.random() * 20) + 5; // Random 5-25 mins
    } else if (order.status === 'preparing') {
      etaMinutes = 30;
    } else if (order.status === 'confirmed') {
      etaMinutes = 45;
    }

    res.json({
      orderId: order.orderId,
      status: order.status,
      deliveryPartner: order.deliveryPartnerId,
      shop: {
        name: order.shopId.name,
        address: order.shopId.address,
        coordinates: order.shopId.coordinates
      },
      deliveryAddress: order.deliveryAddress,
      currentLocation: order.deliveryTracking?.currentLocation,
      eta: etaMinutes,
      timeline: order.timeline
    });
  } catch (error) {
    console.error('Get tracking status error:', error);
    res.status(500).json({ message: 'Error fetching tracking status' });
  }
};

// Update driver location (called by driver app or simulation)
exports.updateLocation = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { latitude, longitude } = req.body;

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.deliveryTracking) {
      order.deliveryTracking = {};
    }

    order.deliveryTracking.currentLocation = {
      latitude,
      longitude,
      timestamp: new Date()
    };

    // Add to route history
    if (!order.deliveryTracking.route) {
      order.deliveryTracking.route = [];
    }
    order.deliveryTracking.route.push({
      latitude,
      longitude,
      timestamp: new Date()
    });

    await order.save();

    res.json({ message: 'Location updated successfully' });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ message: 'Error updating location' });
  }
};

// Simulate driver movement (for demo purposes)
exports.simulateMovement = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { progress } = req.body; // 0.0 to 1.0 (0% to 100% of the way)

    const order = await Order.findOne({ orderId }).populate('shopId');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Simple linear interpolation between shop and delivery address
    const startLat = order.shopId.coordinates.latitude || 19.0760; // Default Mumbai
    const startLng = order.shopId.coordinates.longitude || 72.8777;
    
    const endLat = order.deliveryAddress.coordinates.latitude;
    const endLng = order.deliveryAddress.coordinates.longitude;

    const currentLat = startLat + (endLat - startLat) * progress;
    const currentLng = startLng + (endLng - startLng) * progress;

    if (!order.deliveryTracking) {
      order.deliveryTracking = {};
    }

    order.deliveryTracking.currentLocation = {
      latitude: currentLat,
      longitude: currentLng,
      timestamp: new Date()
    };
    
    // If progress is 1.0, mark as delivered
    if (progress >= 1.0 && order.status !== 'delivered') {
        order.status = 'delivered';
        order.timeline.push({
            status: 'delivered',
            timestamp: new Date(),
            note: 'Order delivered successfully'
        });
    } else if (progress > 0 && order.status !== 'out_for_delivery' && order.status !== 'delivered') {
        order.status = 'out_for_delivery';
        order.timeline.push({
            status: 'out_for_delivery',
            timestamp: new Date(),
            note: 'Order is out for delivery'
        });
    }

    await order.save();

    res.json({ 
      message: 'Simulation updated',
      currentLocation: order.deliveryTracking.currentLocation,
      status: order.status
    });
  } catch (error) {
    console.error('Simulation error:', error);
    res.status(500).json({ message: 'Error simulating movement' });
  }
};
