const DeliveryPartnerProfile = require('../models/DeliveryPartnerProfile');
const Order = require('../models/Order');
const Notification = require('../models/Notification');

// Calculate distance between two coordinates using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

// Find available delivery partners near a location
const findNearbyDeliveryPartners = async (latitude, longitude, maxDistance = 10) => {
  try {
    const availablePartners = await DeliveryPartnerProfile.findNearbyAvailable(
      latitude, 
      longitude, 
      maxDistance
    );

    // Filter partners based on additional criteria
    const eligiblePartners = availablePartners.filter(partner => {
      // Check if partner is currently available during working hours
      const isAvailable = partner.isCurrentlyAvailable;
      
      // Check if partner has capacity (not already on a delivery)
      const hasCapacity = !partner.currentTask.orderId;
      
      return isAvailable && hasCapacity;
    });

    // Sort by distance and rating
    eligiblePartners.forEach(partner => {
      partner._doc.distance = calculateDistance(
        latitude,
        longitude,
        partner.currentLocation.latitude,
        partner.currentLocation.longitude
      );
    });

    eligiblePartners.sort((a, b) => {
      // Primary sort by distance
      const distanceDiff = a._doc.distance - b._doc.distance;
      if (distanceDiff !== 0) return distanceDiff;
      
      // Secondary sort by rating (higher is better)
      return b.rating.average - a.rating.average;
    });

    return eligiblePartners;

  } catch (error) {
    console.error('Error finding nearby delivery partners:', error);
    throw error;
  }
};

// Assign delivery partner to an order
const assignDeliveryPartner = async (order) => {
  try {
    const { latitude, longitude } = order.deliveryAddress.coordinates;
    
    // Find nearby delivery partners
    const availablePartners = await findNearbyDeliveryPartners(latitude, longitude);
    
    if (availablePartners.length === 0) {
      console.log(`No available delivery partners found for order ${order.orderId}`);
      return null;
    }

    // Get the best available partner (closest with good rating)
    const selectedPartner = availablePartners[0];
    
    // Assign order to delivery partner
    await selectedPartner.acceptTask(order._id);
    
    // Update order with delivery partner
    order.deliveryPartnerId = selectedPartner.userId;
    await order.save();

    // Send notification to delivery partner
    try {
      await Notification.createNotification({
        recipientId: selectedPartner.userId,
        title: 'New Delivery Assignment',
        message: `You have been assigned a new delivery task for order ${order.orderId}`,
        type: 'delivery',
        priority: 'high',
        data: {
          orderId: order._id,
          orderNumber: order.orderId,
          pickupAddress: order.shopId.address,
          deliveryAddress: order.deliveryAddress,
          estimatedEarnings: order.pricing.deliveryFee
        },
        relatedId: order._id,
        relatedType: 'order',
        actionRequired: true,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // Expires in 10 minutes
        channels: {
          push: { status: 'pending' },
          sms: { status: 'pending' }
        }
      });
    } catch (notificationError) {
      console.error('Failed to send assignment notification:', notificationError);
    }

    console.log(`Order ${order.orderId} assigned to delivery partner ${selectedPartner.userId}`);
    return selectedPartner;

  } catch (error) {
    console.error('Error assigning delivery partner:', error);
    throw error;
  }
};

// Reassign delivery partner if current one becomes unavailable
const reassignDeliveryPartner = async (orderId, reason = 'Partner unavailable') => {
  try {
    const order = await Order.findById(orderId).populate('shopId deliveryPartnerId');
    
    if (!order) {
      throw new Error('Order not found');
    }

    if (!['confirmed', 'preparing', 'ready_for_pickup'].includes(order.status)) {
      throw new Error('Order cannot be reassigned at this stage');
    }

    // Clear current delivery partner assignment
    if (order.deliveryPartnerId) {
      const currentPartner = await DeliveryPartnerProfile.findOne({
        userId: order.deliveryPartnerId
      });
      
      if (currentPartner && currentPartner.currentTask.orderId) {
        currentPartner.currentTask = undefined;
        currentPartner.availabilityStatus = 'available';
        await currentPartner.save();
      }
    }

    // Find new delivery partner
    const newPartner = await assignDeliveryPartner(order);
    
    if (!newPartner) {
      // No partners available, notify shop owner
      await Notification.createNotification({
        recipientId: order.shopId.ownerId,
        title: 'Delivery Partner Unavailable',
        message: `No delivery partners available for order ${order.orderId}. Please contact support.`,
        type: 'alert',
        priority: 'urgent',
        data: { orderId: order._id, reason },
        relatedId: order._id,
        relatedType: 'order',
        actionRequired: true,
        channels: {
          push: { status: 'pending' },
          email: { status: 'pending' }
        }
      });
      
      return null;
    }

    // Log reassignment in order timeline
    order.timeline.push({
      status: 'partner_reassigned',
      timestamp: new Date(),
      note: `Delivery partner reassigned. Reason: ${reason}`,
      updatedBy: null
    });
    
    await order.save();

    return newPartner;

  } catch (error) {
    console.error('Error reassigning delivery partner:', error);
    throw error;
  }
};

// Get optimal route for delivery partner
const getOptimalRoute = async (partnerId, waypoints = []) => {
  try {
    const partner = await DeliveryPartnerProfile.findOne({ userId: partnerId });
    
    if (!partner || !partner.currentLocation.latitude) {
      throw new Error('Partner location not available');
    }

    // This is a simplified version - in production, you'd use Google Maps Directions API
    // or other routing services for real-time traffic and optimal routes
    
    const origin = {
      latitude: partner.currentLocation.latitude,
      longitude: partner.currentLocation.longitude
    };

    // Calculate distances to all waypoints
    const routePoints = waypoints.map((point, index) => ({
      ...point,
      index,
      distanceFromOrigin: calculateDistance(
        origin.latitude,
        origin.longitude,
        point.latitude,
        point.longitude
      )
    }));

    // Simple nearest-first ordering (in production, use proper TSP algorithms)
    routePoints.sort((a, b) => a.distanceFromOrigin - b.distanceFromOrigin);

    const route = {
      origin,
      waypoints: routePoints,
      totalDistance: routePoints.reduce((sum, point) => sum + point.distanceFromOrigin, 0),
      estimatedDuration: Math.ceil(
        routePoints.reduce((sum, point) => sum + point.distanceFromOrigin, 0) * 3 // Assume 3 min per km
      )
    };

    return route;

  } catch (error) {
    console.error('Error calculating route:', error);
    throw error;
  }
};

// Update delivery partner location
const updatePartnerLocation = async (partnerId, latitude, longitude, accuracy = null) => {
  try {
    const partner = await DeliveryPartnerProfile.findOne({ userId: partnerId });
    
    if (!partner) {
      throw new Error('Delivery partner profile not found');
    }

    await partner.updateLocation(latitude, longitude, accuracy);

    // If partner has an active delivery, broadcast location to order room
    if (partner.currentTask && partner.currentTask.orderId) {
      const io = require('../server').io;
      if (io) {
        io.to(`order_${partner.currentTask.orderId}`).emit('delivery_location_update', {
          latitude,
          longitude,
          accuracy,
          timestamp: new Date(),
          partnerId
        });
      }
    }

    return partner.currentLocation;

  } catch (error) {
    console.error('Error updating partner location:', error);
    throw error;
  }
};

// Calculate delivery fee based on distance and other factors
const calculateDeliveryFee = (distance, baseRate = 20, perKmRate = 5, peakMultiplier = 1) => {
  try {
    // Base calculation: base rate + (distance * per km rate)
    let fee = baseRate + (distance * perKmRate);
    
    // Apply peak hour multiplier (would be determined by time of day, demand, etc.)
    fee *= peakMultiplier;
    
    // Round to nearest rupee
    return Math.round(fee);

  } catch (error) {
    console.error('Error calculating delivery fee:', error);
    return baseRate; // Return minimum fee on error
  }
};

// Get delivery analytics for a partner
const getDeliveryAnalytics = async (partnerId, startDate, endDate) => {
  try {
    const partner = await DeliveryPartnerProfile.findOne({ userId: partnerId });
    
    if (!partner) {
      throw new Error('Delivery partner not found');
    }

    // Get orders delivered by this partner in date range
    const orders = await Order.find({
      deliveryPartnerId: partnerId,
      status: 'delivered',
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const analytics = {
      totalDeliveries: orders.length,
      totalEarnings: orders.reduce((sum, order) => sum + order.pricing.deliveryFee, 0),
      averageDeliveryTime: 0,
      totalDistance: 0,
      customerRatings: {
        average: 0,
        count: 0
      }
    };

    if (orders.length > 0) {
      // Calculate average delivery time
      const deliveryTimes = orders
        .filter(order => order.deliveryTime)
        .map(order => order.deliveryTime);
        
      if (deliveryTimes.length > 0) {
        analytics.averageDeliveryTime = Math.round(
          deliveryTimes.reduce((sum, time) => sum + time, 0) / deliveryTimes.length
        );
      }

      // Calculate customer ratings
      const ratingsData = orders
        .filter(order => order.rating && order.rating.delivery)
        .map(order => order.rating.delivery);
        
      if (ratingsData.length > 0) {
        analytics.customerRatings = {
          average: Math.round(
            (ratingsData.reduce((sum, rating) => sum + rating, 0) / ratingsData.length) * 10
          ) / 10,
          count: ratingsData.length
        };
      }
    }

    return analytics;

  } catch (error) {
    console.error('Error getting delivery analytics:', error);
    throw error;
  }
};

// Auto-assign delivery partners based on AI/ML preferences (simplified version)
const intelligentAssignment = async (order, preferences = {}) => {
  try {
    const {
      prioritizeDistance = true,
      prioritizeRating = true,
      prioritizeCompletionRate = true,
      maxDistance = 10
    } = preferences;

    const { latitude, longitude } = order.deliveryAddress.coordinates;
    const availablePartners = await findNearbyDeliveryPartners(latitude, longitude, maxDistance);

    if (availablePartners.length === 0) {
      return null;
    }

    // Calculate scores for each partner
    const scoredPartners = availablePartners.map(partner => {
      let score = 0;
      
      // Distance score (closer is better, max 40 points)
      if (prioritizeDistance) {
        const distanceScore = Math.max(0, 40 - (partner._doc.distance * 4));
        score += distanceScore;
      }
      
      // Rating score (max 30 points)
      if (prioritizeRating) {
        const ratingScore = (partner.rating.average / 5) * 30;
        score += ratingScore;
      }
      
      // Completion rate score (max 30 points)
      if (prioritizeCompletionRate) {
        const completionRate = partner.completionRate / 100;
        const completionScore = completionRate * 30;
        score += completionScore;
      }

      return {
        ...partner,
        assignmentScore: score
      };
    });

    // Sort by score (highest first)
    scoredPartners.sort((a, b) => b.assignmentScore - a.assignmentScore);

    // Return the best scoring partner
    return scoredPartners[0];

  } catch (error) {
    console.error('Error in intelligent assignment:', error);
    throw error;
  }
};

module.exports = {
  findNearbyDeliveryPartners,
  assignDeliveryPartner,
  reassignDeliveryPartner,
  getOptimalRoute,
  updatePartnerLocation,
  calculateDeliveryFee,
  getDeliveryAnalytics,
  intelligentAssignment,
  calculateDistance
};
