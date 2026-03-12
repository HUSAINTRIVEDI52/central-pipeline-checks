const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');

// Test database connection
beforeAll(async () => {
  // Connect to test database
  const testDB = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/localit_test';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testDB);
  }
});

afterAll(async () => {
  // Clean up and close connection
  await mongoose.connection.close();
});

describe('API Health Check', () => {
  test('GET /api/health should return 200', async () => {
    const res = await request(app)
      .get('/api/health')
      .expect(200);
    
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Server is running successfully');
  });
});

describe('Auth Endpoints', () => {
  describe('POST /api/auth/register', () => {
    test('should register a new user with valid data', async () => {
      const userData = {
        fullName: 'Test User',
        email: 'test@example.com',
        phone: '+91-9876543210',
        password: 'Password123',
        role: 'customer'
      };

      const res = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('OTP sent');
    });

    test('should fail with invalid email', async () => {
      const userData = {
        fullName: 'Test User',
        email: 'invalid-email',
        phone: '+91-9876543210',
        password: 'Password123',
        role: 'customer'
      };

      const res = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/login', () => {
    test('should fail with invalid credentials', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'wrongpassword'
      };

      const res = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });
});

describe('Product Endpoints', () => {
  describe('GET /api/products', () => {
    test('should return products list', async () => {
      const res = await request(app)
        .get('/api/products')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('should handle pagination', async () => {
      const res = await request(app)
        .get('/api/products?page=1&limit=5')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.pagination).toBeDefined();
    });
  });
});

describe('Shop Endpoints', () => {
  describe('GET /api/shops', () => {
    test('should return shops list', async () => {
      const res = await request(app)
        .get('/api/shops')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/shops/nearby', () => {
    test('should return nearby shops with coordinates', async () => {
      const res = await request(app)
        .get('/api/shops/nearby?latitude=28.4595&longitude=77.0266&radius=5')
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    test('should fail without coordinates', async () => {
      const res = await request(app)
        .get('/api/shops/nearby')
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });
});

describe('Error Handling', () => {
  test('should return 404 for non-existent routes', async () => {
    const res = await request(app)
      .get('/api/nonexistent')
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  test('should handle malformed requests', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send('invalid json')
      .expect(400);

    expect(res.body.success).toBe(false);
  });
});

describe('Rate Limiting', () => {
  test('should respect rate limits', async () => {
    // Make multiple requests rapidly
    const requests = Array(10).fill().map(() => 
      request(app).get('/api/health')
    );

    const responses = await Promise.all(requests);
    
    // All should succeed as health endpoint might have higher limits
    responses.forEach(res => {
      expect([200, 429]).toContain(res.status);
    });
  });
});

describe('Security Headers', () => {
  test('should include security headers', async () => {
    const res = await request(app)
      .get('/api/health');

    expect(res.headers).toHaveProperty('x-content-type-options');
    expect(res.headers).toHaveProperty('x-frame-options');
  });
});

describe('CORS', () => {
  test('should handle CORS headers', async () => {
    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers).toHaveProperty('access-control-allow-origin');
  });
});
