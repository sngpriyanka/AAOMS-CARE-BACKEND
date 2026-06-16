🚀 Bombay Trooper - Backend Server

This is the backend server for the Bombay Trooper E-commerce platform. It's built with Express.js and uses JSON files for data storage (can be replaced with MongoDB or any other database).

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm

### Setup Steps

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. The `.env` file is already configured with default values. For production, update:
```
JWT_SECRET=your_secure_secret_key
FRONTEND_URL=your_frontend_url
```

4. Start the server:
```bash
npm run dev    # Development mode with hot reload
npm start      # Production mode
```

The server will start on `http://localhost:5000`

---

## ✨ Key Features

- ✅ RESTful API endpoints
- ✅ User authentication with JWT
- ✅ Product management
- ✅ Shopping cart
- ✅ Order management
- ✅ Admin panel support
- ✅ Role-based access control (Customer, Admin, Super Admin)
- ✅ Order tracking
- ✅ User management
- ✅ Customization options for products

---

## 📂 Project Structure

```
backend/
├── controllers/          # Business logic
│   ├── authController.js      # Authentication logic
│   ├── productController.js   # Product operations
│   ├── cartController.js      # Shopping cart logic
│   ├── orderController.js     # Order operations
│   └── userController.js      # User management
├── routes/               # API endpoints
│   ├── authRoutes.js          # Auth endpoints
│   ├── productRoutes.js       # Product endpoints
│   ├── cartRoutes.js          # Cart endpoints
│   ├── orderRoutes.js         # Order endpoints
│   └── userRoutes.js          # User endpoints
├── models/               # Data models
│   └── Database.js            # JSON database layer
├── middleware/           # Custom middleware
│   └── authMiddleware.js      # JWT verification
├── utils/                # Utility functions
│   ├── constants.js           # App constants
│   └── validators.js          # Input validators
├── data/                 # JSON data storage
│   ├── users.json
│   ├── products.json
│   ├── orders.json
│   └── carts.json
├── server.js             # Main server file
├── .env                  # Environment variables
└── package.json          # Dependencies
```

---

## 🔗 API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user (Protected)
- `POST /api/auth/logout` - Logout (Protected)

### Products
- `GET /api/products` - Get all products (with filters)
- `GET /api/products/id/:id` - Get product by ID
- `GET /api/products/slug/:slug` - Get product by slug
- `GET /api/products/customization/options` - Get customization options
- `POST /api/products` - Create product (Admin only)
- `PUT /api/products/:id` - Update product (Admin only)
- `DELETE /api/products/:id` - Delete product (Admin only)

### Cart
- `GET /api/cart` - Get user's cart (Protected)
- `POST /api/cart/add` - Add item to cart (Protected)
- `PUT /api/cart/:itemId` - Update cart item (Protected)
- `DELETE /api/cart/:itemId` - Remove from cart (Protected)
- `DELETE /api/cart` - Clear entire cart (Protected)

### Orders
- `GET /api/orders` - Get user's orders (Protected)
- `POST /api/orders` - Create order from cart (Protected)
- `GET /api/orders/:orderId` - Get specific order (Protected)
- `PATCH /api/orders/:orderId/cancel` - Cancel order (Protected)
- `GET /api/orders/track/:trackingNumber` - Track order (Public)
- `GET /api/orders/admin/all` - Get all orders (Admin only)
- `PATCH /api/orders/:orderId/status` - Update order status (Admin only)

### Users
- `GET /api/users/:userId` - Get user profile (Protected)
- `PUT /api/users/:userId` - Update user profile (Protected)
- `POST /api/users/:userId/change-password` - Change password (Protected)
- `GET /api/users` - Get all users (Admin only)
- `DELETE /api/users/:userId` - Delete user (Admin only)
- `POST /api/users/:userId/promote` - Promote to admin (Super Admin only)
- `POST /api/users/:userId/demote` - Demote admin (Super Admin only)

---

## 🔐 Authentication

The API uses JWT (JSON Web Tokens) for authentication.

### How it works:
1. User signs up or logs in
2. Server returns a JWT token
3. Client stores the token
4. For protected endpoints, include token in header: `Authorization: Bearer <token>`
5. Server verifies token and processes request

### Token Format:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 👥 User Roles

### 1. Customer
- Browse and search products
- Customize products
- Manage cart
- Place and track orders
- Manage profile

### 2. Admin
- All customer features +
- Manage products (CRUD)
- Manage users
- View all orders
- Update order status
- View analytics

### 3. Super Admin
- All admin features +
- Promote/demote admins
- System configuration
- Advanced user management
- Full system access

---

## 📋 Request/Response Format

### Success Response:
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { /* response data */ }
}
```

### Error Response:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Additional error details"
}
```

---

## 🧪 Testing the API

### Using cURL

**Signup:**
```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

**Get Products:**
```bash
curl http://localhost:5000/api/products
```

**Get Products with Filters:**
```bash
curl "http://localhost:5000/api/products?category=t-shirts&minPrice=500&maxPrice=2000"
```

### Using Postman

1. Import the collection (if available)
2. Set up environment variables
3. Use the endpoints in the collection

---

## 🔄 Data Storage

The application uses a **unified Database adapter** (`models/DatabaseAdapter.js`).

Supported backends (set via `DATABASE_TYPE` in `.env`):

| Type       | Value          | When to use                     |
|------------|----------------|---------------------------------|
| JSON       | `json`         | Local development, quick tests  |
| MongoDB    | `mongodb`      | Existing MongoDB Atlas setups   |
| **PostgreSQL / Neon** | `postgres` | **Recommended for production** |

### Connecting to Neon PostgreSQL (recommended)

1. Create a free project at [Neon](https://neon.tech)
2. Copy the connection string (it ends with `?sslmode=require`)
3. In `backend/.env`:
   ```env
   DATABASE_TYPE=postgres
   DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
4. Run `npm install` (the `pg` driver is already listed)
5. Start the server — tables are created automatically on first connection.

All existing controllers continue to work unchanged thanks to the adapter layer.

---

## 🛡️ Security Best Practices

1. Change JWT_SECRET in production
2. Use HTTPS in production
3. Implement rate limiting
4. Validate all user inputs
5. Use environment variables for sensitive data
6. Implement CORS properly
7. Add request logging
8. Regular security audits
9. Implement password hashing (already done with bcrypt)
10. Add 2FA for admin accounts

---

## 🚀 Deployment

### Deploy to Heroku:
```bash
heroku create aaxoms-api
git push heroku main
```

### Deploy to AWS:
- Use EC2 or Elastic Beanstalk
- Set up environment variables in deployment
- Configure security groups

### Deploy to DigitalOcean:
- SSH into droplet
- Clone repository
- Install dependencies
- Use PM2 for process management
- Configure Nginx reverse proxy

---

## 📊 Database Schema

### Users Collection:
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "password": "hashed_password",
  "name": "John Doe",
  "role": "customer|admin|super_admin",
  "phone": "1234567890",
  "address": "123 Main St",
  "city": "Mumbai",
  "state": "Maharashtra",
  "zipcode": "400001",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Products Collection:
```json
{
  "id": "uuid",
  "name": "Product Name",
  "slug": "product-slug",
  "price": 1999,
  "category": "t-shirts|apron|scrub|pants|hoppers|accessories",
  "description": { "tagline": "..." },
  "images": ["url1", "url2"],
  "sizes": ["S", "M", "L"],
  "colors": [{ "name": "Red", "code": "#FF0000" }],
  "productInfo": [],
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Orders Collection:
```json
{
  "id": "uuid",
  "userId": "uuid",
  "items": [
    {
      "productId": "uuid",
      "quantity": 1,
      "price": 1999,
      "customization": {}
    }
  ],
  "shippingAddress": "123 Main St, Mumbai",
  "total": 1999,
  "status": "pending|confirmed|processing|shipped|delivered|cancelled",
  "paymentStatus": "pending|completed|failed|refunded",
  "trackingNumber": "BT1234567890",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Kill process on port 5000
Windows: netstat -ano | findstr :5000
Mac/Linux: lsof -i :5000
```

### JWT Token Expired
- Token expires in 30 days
- User needs to login again
- Or implement refresh token logic

### CORS Issues
- Update FRONTEND_URL in .env
- Add correct origin in CORS middleware

### Database Not Saving
- Check `/data` folder exists
- Verify write permissions
- Check disk space

---

## 📝 Environment Variables

```
PORT=5000                          # Server port
NODE_ENV=development               # Environment
JWT_SECRET=your_secret_key        # JWT signing key
FRONTEND_URL=http://localhost:3000 # Frontend URL
DATABASE_TYPE=postgres             # json | mongodb | postgres (Neon)
```

---

## 🚀 Next Steps

1. ✅ Replace JSON with actual database
2. ✅ Add payment gateway integration
3. ✅ Implement email notifications
4. ✅ Add image upload functionality
5. ✅ Implement advanced search & filters
6. ✅ Add analytics dashboard
7. ✅ Set up automated backups
8. ✅ Implement rate limiting
9. ✅ Add logging system
10. ✅ Deploy to production

---

## 📞 Support

For issues and questions:
1. Check the documentation
2. Review error messages
3. Check console logs
4. Review API responses

---

**Backend API Server Ready! 🎉**

Your Bombay Trooper backend is fully functional and ready to serve your frontend application.
