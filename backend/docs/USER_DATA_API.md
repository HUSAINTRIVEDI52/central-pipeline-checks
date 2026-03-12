# User-Specific Data API Documentation

Complete API reference for user-specific data endpoints including addresses, favorites, notes, and settings.

## Base URL
```
http://localhost:5000/api
```

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

---

## 📍 Addresses API

### Get All Addresses
```http
GET /api/addresses
```

**Response:**
```json
{
  "success": true,
  "message": "Addresses retrieved successfully",
  "data": {
    "addresses": [
      {
        "_id": "address_id",
        "userId": "user_id",
        "label": "home",
        "fullName": "John Doe",
        "phone": "9876543210",
        "addressLine1": "123 Main Street",
        "addressLine2": "Apartment 4B",
        "landmark": "Near Central Park",
        "city": "Mumbai",
        "state": "Maharashtra",
        "pincode": "400001",
        "coordinates": {
          "latitude": 19.0760,
          "longitude": 72.8777
        },
        "isDefault": true,
        "isActive": true,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

### Get Default Address
```http
GET /api/addresses/default
```

### Get Single Address
```http
GET /api/addresses/:id
```

### Create Address
```http
POST /api/addresses
Content-Type: application/json

{
  "label": "home",
  "fullName": "John Doe",
  "phone": "9876543210",
  "addressLine1": "123 Main Street",
  "addressLine2": "Apartment 4B",
  "landmark": "Near Central Park",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400001",
  "coordinates": {
    "latitude": 19.0760,
    "longitude": 72.8777
  },
  "isDefault": false
}
```

### Update Address
```http
PUT /api/addresses/:id
Content-Type: application/json

{
  "fullName": "Jane Doe",
  "phone": "9876543211"
}
```

### Set as Default
```http
PUT /api/addresses/:id/default
```

### Delete Address (Soft Delete)
```http
DELETE /api/addresses/:id
```

### Permanent Delete
```http
DELETE /api/addresses/:id/permanent
```

---

## ❤️ Favorites API

### Get All Favorites
```http
GET /api/favorites
GET /api/favorites?type=product
GET /api/favorites?type=shop
```

**Response:**
```json
{
  "success": true,
  "message": "Favorites retrieved successfully",
  "data": {
    "favorites": [
      {
        "itemType": "product",
        "itemId": {
          "_id": "product_id",
          "name": "Fresh Apples",
          "price": 120,
          "discountPrice": 100,
          "images": ["url1", "url2"]
        },
        "addedAt": "2024-01-01T00:00:00.000Z",
        "notes": "Buy on weekend"
      }
    ],
    "totalCount": 5,
    "productsCount": 3,
    "shopsCount": 2
  }
}
```

### Add to Favorites
```http
POST /api/favorites
Content-Type: application/json

{
  "itemType": "product",
  "itemId": "product_id",
  "notes": "My favorite product"
}
```

### Toggle Favorite
```http
POST /api/favorites/toggle
Content-Type: application/json

{
  "itemType": "product",
  "itemId": "product_id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Added to favorites",
  "data": {
    "isFavorite": true,
    "totalCount": 6
  }
}
```

### Check if Favorited
```http
GET /api/favorites/check/:itemType/:itemId
```

**Response:**
```json
{
  "success": true,
  "message": "Favorite status checked",
  "data": {
    "isFavorite": true
  }
}
```

### Update Favorite Notes
```http
PUT /api/favorites/:itemType/:itemId/notes
Content-Type: application/json

{
  "notes": "Updated notes"
}
```

### Remove from Favorites
```http
DELETE /api/favorites/:itemType/:itemId
```

### Clear All Favorites
```http
DELETE /api/favorites/clear
DELETE /api/favorites/clear?type=product
```

---

## 📝 Notes API

### Get All Notes
```http
GET /api/notes
GET /api/notes?category=shopping_list
GET /api/notes?isArchived=false
GET /api/notes?isPinned=true
GET /api/notes?tags=urgent,grocery
GET /api/notes?search=milk
```

**Response:**
```json
{
  "success": true,
  "message": "Notes retrieved successfully",
  "data": {
    "notes": [
      {
        "_id": "note_id",
        "userId": "user_id",
        "title": "Shopping List",
        "content": "Buy milk, eggs, bread",
        "category": "shopping_list",
        "tags": ["grocery", "urgent"],
        "color": "yellow",
        "isPinned": true,
        "isArchived": false,
        "reminder": {
          "date": "2024-01-15T10:00:00.000Z",
          "notified": false
        },
        "linkedItems": [],
        "attachments": [],
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

### Get Single Note
```http
GET /api/notes/:id
```

### Get Notes by Category
```http
GET /api/notes/category/:category
```

### Get Notes by Tag
```http
GET /api/notes/tag/:tag
```

### Get All Tags
```http
GET /api/notes/tags/all
```

**Response:**
```json
{
  "success": true,
  "message": "Tags retrieved successfully",
  "data": {
    "tags": [
      { "tag": "grocery", "count": 5 },
      { "tag": "urgent", "count": 3 }
    ],
    "count": 2
  }
}
```

### Create Note
```http
POST /api/notes
Content-Type: application/json

{
  "title": "Shopping List",
  "content": "Buy milk, eggs, bread",
  "category": "shopping_list",
  "tags": ["grocery", "urgent"],
  "color": "yellow",
  "isPinned": false,
  "reminder": {
    "date": "2024-01-15T10:00:00.000Z"
  }
}
```

### Update Note
```http
PUT /api/notes/:id
Content-Type: application/json

{
  "title": "Updated Shopping List",
  "content": "Buy milk, eggs, bread, butter"
}
```

### Toggle Pin
```http
PUT /api/notes/:id/pin
```

### Toggle Archive
```http
PUT /api/notes/:id/archive
```

### Add Tag
```http
POST /api/notes/:id/tags
Content-Type: application/json

{
  "tag": "important"
}
```

### Remove Tag
```http
DELETE /api/notes/:id/tags/:tag
```

### Set Reminder
```http
PUT /api/notes/:id/reminder
Content-Type: application/json

{
  "date": "2024-01-15T10:00:00.000Z"
}
```

### Clear Reminder
```http
DELETE /api/notes/:id/reminder
```

### Link Item
```http
POST /api/notes/:id/link
Content-Type: application/json

{
  "itemType": "product",
  "itemId": "product_id"
}
```

### Unlink Item
```http
DELETE /api/notes/:id/link/:itemType/:itemId
```

### Delete Note
```http
DELETE /api/notes/:id
```

---

## ⚙️ Settings API

### Get All Settings
```http
GET /api/settings
```

**Response:**
```json
{
  "success": true,
  "message": "Settings retrieved successfully",
  "data": {
    "settings": {
      "_id": "settings_id",
      "userId": "user_id",
      "notifications": {
        "push": {
          "enabled": true,
          "orderUpdates": true,
          "promotions": true,
          "deliveryUpdates": true
        },
        "email": {
          "enabled": true,
          "orderUpdates": true
        },
        "sms": {
          "enabled": true,
          "orderUpdates": true
        }
      },
      "privacy": {
        "showProfile": true,
        "showOrders": false,
        "allowDataCollection": true
      },
      "preferences": {
        "language": "en",
        "currency": "INR",
        "theme": "auto"
      },
      "delivery": {
        "preferredDeliveryTime": "anytime",
        "contactlessDelivery": false
      },
      "payment": {
        "defaultPaymentMethod": "cash"
      },
      "shopping": {
        "sortBy": "relevance",
        "showOutOfStock": true
      }
    }
  }
}
```

### Get Settings Category
```http
GET /api/settings/:category
GET /api/settings/notifications
GET /api/settings/privacy
GET /api/settings/preferences
```

### Update Notifications
```http
PUT /api/settings/notifications
Content-Type: application/json

{
  "type": "push",
  "enabled": true,
  "orderUpdates": true,
  "promotions": false
}
```

### Update Privacy
```http
PUT /api/settings/privacy
Content-Type: application/json

{
  "showProfile": false,
  "allowDataCollection": true
}
```

### Update Preferences
```http
PUT /api/settings/preferences
Content-Type: application/json

{
  "language": "hi",
  "theme": "dark",
  "currency": "INR"
}
```

### Update Delivery Settings
```http
PUT /api/settings/delivery
Content-Type: application/json

{
  "preferredDeliveryTime": "evening",
  "contactlessDelivery": true,
  "leaveAtDoor": false
}
```

### Update Payment Settings
```http
PUT /api/settings/payment
Content-Type: application/json

{
  "defaultPaymentMethod": "upi",
  "preferredUPI": "user@upi"
}
```

### Update Shopping Preferences
```http
PUT /api/settings/shopping
Content-Type: application/json

{
  "sortBy": "price_low",
  "showOutOfStock": false,
  "preferredCategories": ["fruits", "vegetables"]
}
```

### Update Security
```http
PUT /api/settings/security
Content-Type: application/json

{
  "twoFactorAuth": true,
  "biometricAuth": true
}
```

### Toggle Setting
```http
PUT /api/settings/toggle
Content-Type: application/json

{
  "category": "notifications",
  "setting": "push.enabled"
}
```

### Reset to Defaults
```http
POST /api/settings/reset
```

---

## 🔐 Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error message here",
  "error": "Detailed error information (in development mode only)"
}
```

### Common HTTP Status Codes

- **200** - Success
- **201** - Created
- **400** - Bad Request (validation error)
- **401** - Unauthorized (invalid/missing token)
- **403** - Forbidden (insufficient permissions)
- **404** - Not Found
- **500** - Internal Server Error

---

## 📱 Flutter Integration Example

### Address Service Example

```dart
class AddressService {
  final Dio _dio;
  
  Future<List<Address>> getAddresses() async {
    final token = await getToken(); // Get from secure storage
    
    final response = await _dio.get(
      '/api/addresses',
      options: Options(
        headers: {'Authorization': 'Bearer $token'},
      ),
    );
    
    if (response.data['success']) {
      return (response.data['data']['addresses'] as List)
          .map((json) => Address.fromJson(json))
          .toList();
    }
    throw Exception(response.data['message']);
  }
  
  Future<Address> createAddress(Address address) async {
    final token = await getToken();
    
    final response = await _dio.post(
      '/api/addresses',
      data: address.toJson(),
      options: Options(
        headers: {'Authorization': 'Bearer $token'},
      ),
    );
    
    if (response.data['success']) {
      return Address.fromJson(response.data['data']['address']);
    }
    throw Exception(response.data['message']);
  }
}
```

### Favorites Service Example

```dart
class FavoriteService {
  Future<bool> toggleFavorite(String itemType, String itemId) async {
    final token = await getToken();
    
    final response = await _dio.post(
      '/api/favorites/toggle',
      data: {
        'itemType': itemType,
        'itemId': itemId,
      },
      options: Options(
        headers: {'Authorization': 'Bearer $token'},
      ),
    );
    
    return response.data['data']['isFavorite'];
  }
  
  Future<List<Product>> getFavoriteProducts() async {
    final token = await getToken();
    
    final response = await _dio.get(
      '/api/favorites?type=product',
      options: Options(
        headers: {'Authorization': 'Bearer $token'},
      ),
    );
    
    return (response.data['data']['favorites'] as List)
        .map((item) => Product.fromJson(item['itemId']))
        .toList();
  }
}
```

---

## 🎯 Best Practices

1. **Always check token expiry** before making requests
2. **Handle errors gracefully** with user-friendly messages
3. **Use retry logic** for network failures
4. **Cache responses** where appropriate (addresses, settings)
5. **Show loading states** during API calls
6. **Validate data** before sending to backend
7. **Use secure storage** for sensitive data (tokens, user info)
8. **Implement pagination** for large lists
9. **Add request/response interceptors** for logging and token refresh
10. **Use environment variables** for API base URLs

---

## 📊 Rate Limiting

Default rate limits (configurable in server):
- **General endpoints**: 100 requests per 15 minutes
- **Auth endpoints**: 5 requests per 15 minutes

Rate limit headers in response:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1234567890
```
