/**
 * @swagger
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - fullName
 *         - email
 *         - phone
 *         - password
 *         - role
 *       properties:
 *         fullName:
 *           type: string
 *           description: User's full name
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         phone:
 *           type: string
 *           description: User's phone number
 *         password:
 *           type: string
 *           minLength: 8
 *           description: User's password
 *         role:
 *           type: string
 *           enum: [customer, shop_owner, delivery_partner, admin]
 *           description: User role
 *     
 *     Product:
 *       type: object
 *       required:
 *         - name
 *         - price
 *         - shop
 *         - category
 *       properties:
 *         name:
 *           type: string
 *           description: Product name
 *         description:
 *           type: string
 *           description: Product description
 *         price:
 *           type: object
 *           properties:
 *             original:
 *               type: number
 *             discounted:
 *               type: number
 *             currency:
 *               type: string
 *               default: INR
 *         images:
 *           type: array
 *           items:
 *             type: string
 *         inventory:
 *           type: object
 *           properties:
 *             quantity:
 *               type: number
 *             unit:
 *               type: string
 *             lowStockThreshold:
 *               type: number
 *     
 *     Order:
 *       type: object
 *       required:
 *         - items
 *         - deliveryAddress
 *         - paymentMethod
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               product:
 *                 type: string
 *               quantity:
 *                 type: number
 *               price:
 *                 type: number
 *         status:
 *           type: string
 *           enum: [pending, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, cancelled]
 *         paymentMethod:
 *           type: string
 *           enum: [cod, online]
 *         deliveryAddress:
 *           type: object
 *           properties:
 *             addressLine1:
 *               type: string
 *             city:
 *               type: string
 *             postalCode:
 *               type: string
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       201:
 *         description: User registered successfully, OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid input data
 *       409:
 *         description: User already exists
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *       401:
 *         description: Invalid credentials
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get all products
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: shop
 *         schema:
 *           type: string
 *         description: Filter by shop ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search products
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 pagination:
 *                   type: object
 */

/**
 * @swagger
 * /api/shops/nearby:
 *   get:
 *     summary: Get nearby shops
 *     tags: [Shops]
 *     parameters:
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema:
 *           type: number
 *         description: User's latitude
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema:
 *           type: number
 *         description: User's longitude
 *       - in: query
 *         name: radius
 *         schema:
 *           type: number
 *           default: 5
 *         description: Search radius in km
 *     responses:
 *       200:
 *         description: Nearby shops retrieved successfully
 *       400:
 *         description: Missing location parameters
 */

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Create a new order
 *     tags: [Orders]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Order'
 *     responses:
 *       201:
 *         description: Order created successfully
 *       400:
 *         description: Invalid order data
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/cart:
 *   get:
 *     summary: Get user's cart
 *     tags: [Cart]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Cart retrieved successfully
 *       401:
 *         description: Unauthorized
 *   
 *   post:
 *     summary: Add item to cart
 *     tags: [Cart]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *               - quantity
 *             properties:
 *               productId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Item added to cart
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Get admin dashboard data
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied (admin only)
 */

/**
 * @swagger
 * /api/delivery/tasks:
 *   get:
 *     summary: Get available delivery tasks
 *     tags: [Delivery]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: radius
 *         schema:
 *           type: number
 *           default: 5
 *     responses:
 *       200:
 *         description: Available tasks retrieved
 *       403:
 *         description: Delivery partner access only
 */

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server is running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 uptime:
 *                   type: number
 */

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'LocalIt API',
    version: '1.0.0',
    description: 'API documentation for LocalIt hyperlocal delivery platform',
    contact: {
      name: 'LocalIt Team',
      email: 'api@localit.app',
      url: 'https://localit.app'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server'
    },
    {
      url: 'https://api.localit.app',
      description: 'Production server'
    }
  ],
  tags: [
    {
      name: 'Authentication',
      description: 'User authentication endpoints'
    },
    {
      name: 'Products',
      description: 'Product management endpoints'
    },
    {
      name: 'Shops',
      description: 'Shop management endpoints'
    },
    {
      name: 'Orders',
      description: 'Order management endpoints'
    },
    {
      name: 'Cart',
      description: 'Shopping cart endpoints'
    },
    {
      name: 'Admin',
      description: 'Admin panel endpoints'
    },
    {
      name: 'Delivery',
      description: 'Delivery partner endpoints'
    },
    {
      name: 'System',
      description: 'System monitoring endpoints'
    }
  ]
};

module.exports = swaggerDefinition;
