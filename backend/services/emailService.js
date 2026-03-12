const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = this.createTransporter();
  }

  createTransporter() {
    return nodemailer.createTransporter({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_PORT == 465, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  async sendEmail({ to, subject, html, text, attachments }) {
    try {
      const mailOptions = {
        from: `"LocalIt" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
        text,
        attachments
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('Email sending failed:', error);
      throw error;
    }
  }

  async sendWelcomeEmail(user) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Welcome to LocalIt!</h2>
        <p>Hello ${user.fullName},</p>
        <p>Welcome to LocalIt - your hyperlocal delivery platform! We're excited to have you on board.</p>
        <p>With LocalIt, you can:</p>
        <ul>
          <li>Shop from local stores in your area</li>
          <li>Get fast delivery from trusted partners</li>
          <li>Discover new businesses in your neighborhood</li>
          <li>Enjoy secure and convenient payments</li>
        </ul>
        <p>Get started by exploring shops near you!</p>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `;

    return await this.sendEmail({
      to: user.email,
      subject: 'Welcome to LocalIt!',
      html
    });
  }

  async sendOrderConfirmation(user, order) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Order Confirmed!</h2>
        <p>Hello ${user.fullName},</p>
        <p>Your order has been confirmed and is being prepared.</p>
        
        <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px;">
          <h3>Order Details</h3>
          <p><strong>Order ID:</strong> ${order.orderId}</p>
          <p><strong>Shop:</strong> ${order.shopName}</p>
          <p><strong>Total Amount:</strong> ₹${order.pricing.total}</p>
          <p><strong>Delivery Address:</strong> ${order.deliveryAddress.fullAddress}</p>
        </div>
        
        <p>You can track your order status in the app.</p>
        <p>Thank you for choosing LocalIt!</p>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `;

    return await this.sendEmail({
      to: user.email,
      subject: `Order Confirmed - ${order.orderId}`,
      html
    });
  }

  async sendOrderStatusUpdate(user, order, status) {
    const statusMessages = {
      confirmed: 'Your order has been confirmed by the shop',
      preparing: 'Your order is being prepared',
      ready_for_pickup: 'Your order is ready for pickup',
      out_for_delivery: 'Your order is out for delivery',
      delivered: 'Your order has been delivered successfully',
      cancelled: 'Your order has been cancelled'
    };

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Order Update</h2>
        <p>Hello ${user.fullName},</p>
        <p>${statusMessages[status] || 'Your order status has been updated'}.</p>
        
        <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px;">
          <p><strong>Order ID:</strong> ${order.orderId}</p>
          <p><strong>Status:</strong> ${status.replace(/_/g, ' ').toUpperCase()}</p>
        </div>
        
        <p>You can track your order in the app for real-time updates.</p>
        <p>Thank you for choosing LocalIt!</p>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `;

    return await this.sendEmail({
      to: user.email,
      subject: `Order Update - ${order.orderId}`,
      html
    });
  }

  async sendPasswordReset(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Password Reset Request</h2>
        <p>Hello ${user.fullName},</p>
        <p>You requested a password reset for your LocalIt account.</p>
        <p>Click the button below to reset your password:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a>
        </div>
        
        <p>This link will expire in 1 hour for security reasons.</p>
        <p>If you didn't request this password reset, please ignore this email.</p>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `;

    return await this.sendEmail({
      to: user.email,
      subject: 'Password Reset Request - LocalIt',
      html
    });
  }

  async sendShopVerificationNotification(shop, isApproved) {
    const subject = isApproved ? 'Shop Verified Successfully!' : 'Shop Verification Update';
    const statusColor = isApproved ? '#4CAF50' : '#FF9800';
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${statusColor};">${subject}</h2>
        <p>Hello ${shop.ownerName},</p>
        
        ${isApproved ? 
          `<p>Congratulations! Your shop "${shop.name}" has been verified and is now live on LocalIt.</p>
           <p>You can now start receiving orders from customers in your area.</p>` :
          `<p>We've reviewed your shop "${shop.name}" and need some additional information.</p>
           <p>Please check your shop dashboard for more details.</p>`
        }
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL}/shop/dashboard" style="background: ${statusColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Go to Dashboard</a>
        </div>
        
        <p>Thank you for joining LocalIt!</p>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `;

    return await this.sendEmail({
      to: shop.contact.email,
      subject,
      html
    });
  }

  async sendDeliveryPartnerWelcome(partner) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Welcome to LocalIt Delivery Network!</h2>
        <p>Hello ${partner.fullName},</p>
        <p>Welcome to the LocalIt delivery partner network! We're excited to have you on board.</p>
        
        <p>As a delivery partner, you can:</p>
        <ul>
          <li>Earn flexible income by delivering orders</li>
          <li>Choose your own working hours</li>
          <li>Get instant payments for completed deliveries</li>
          <li>Access dedicated partner support</li>
        </ul>
        
        <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px;">
          <h3>Next Steps:</h3>
          <p>1. Complete your profile verification</p>
          <p>2. Upload required documents</p>
          <p>3. Go online and start accepting deliveries</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL}/delivery/dashboard" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Get Started</a>
        </div>
        
        <p>Happy delivering!</p>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `;

    return await this.sendEmail({
      to: partner.email,
      subject: 'Welcome to LocalIt Delivery Network!',
      html
    });
  }

  async sendMonthlyReport(user, reportData) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Your Monthly LocalIt Report</h2>
        <p>Hello ${user.fullName},</p>
        <p>Here's your activity summary for this month:</p>
        
        <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px;">
          <h3>This Month's Activity</h3>
          <p><strong>Orders Placed:</strong> ${reportData.ordersCount}</p>
          <p><strong>Total Spent:</strong> ₹${reportData.totalSpent}</p>
          <p><strong>Money Saved:</strong> ₹${reportData.totalSaved}</p>
          <p><strong>Favorite Shop:</strong> ${reportData.favoriteShop}</p>
        </div>
        
        <p>Thank you for being a valued LocalIt customer!</p>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `;

    return await this.sendEmail({
      to: user.email,
      subject: 'Your Monthly LocalIt Report',
      html
    });
  }

  async sendPromotionalEmail(user, promotion) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">${promotion.title}</h2>
        <p>Hello ${user.fullName},</p>
        <p>${promotion.description}</p>
        
        ${promotion.couponCode ? 
          `<div style="background: #4CAF50; color: white; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center;">
            <h3>Use Coupon Code: ${promotion.couponCode}</h3>
            <p>Valid until ${new Date(promotion.validUntil).toLocaleDateString()}</p>
          </div>` : ''
        }
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL}/shops" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Shop Now</a>
        </div>
        
        <p>Happy shopping!</p>
        <p>Best regards,<br>The LocalIt Team</p>
      </div>
    `;

    return await this.sendEmail({
      to: user.email,
      subject: promotion.title,
      html
    });
  }
}

module.exports = new EmailService();
