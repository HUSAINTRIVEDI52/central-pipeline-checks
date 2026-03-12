#!/bin/bash

# LocalIt Backend Deployment Script
# This script handles deployment to production environment

set -e  # Exit on any error

echo "🚀 Starting LocalIt Backend Deployment..."

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Configuration
NODE_ENV="${NODE_ENV:-production}"
PORT="${PORT:-3000}"
PM2_APP_NAME="${PM2_APP_NAME:-localit-backend}"

echo "📋 Deployment Configuration:"
echo "  Environment: $NODE_ENV"
echo "  Port: $PORT"
echo "  PM2 App Name: $PM2_APP_NAME"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command_exists node; then
    echo "❌ Node.js is not installed"
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm is not installed"
    exit 1
fi

if ! command_exists pm2; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version 16+ required. Current: $(node -v)"
    exit 1
fi

echo "✅ Prerequisites check passed"

# Install/Update dependencies
echo "📦 Installing dependencies..."
npm ci --production

# Run database migrations/setup if needed
if [ -f "scripts/migrate.js" ]; then
    echo "🗃️  Running database migrations..."
    node scripts/migrate.js
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs uploads uploads/images uploads/documents temp

# Set proper permissions
chmod 755 logs uploads temp
chmod +x scripts/*.sh || true

# Build documentation
if command_exists swagger-jsdoc; then
    echo "📚 Building API documentation..."
    npm run docs || echo "⚠️  Documentation build failed (optional)"
fi

# Health check before deployment
echo "🏥 Running health checks..."

# Check if MongoDB is accessible
if [ -n "$MONGODB_URI" ]; then
    echo "Testing MongoDB connection..."
    node -e "
        const mongoose = require('mongoose');
        mongoose.connect('$MONGODB_URI')
            .then(() => { console.log('✅ MongoDB connection successful'); process.exit(0); })
            .catch(err => { console.error('❌ MongoDB connection failed:', err.message); process.exit(1); });
    "
fi

# Check if required environment variables are set
REQUIRED_VARS=("JWT_SECRET" "MONGODB_URI")
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Required environment variable $var is not set"
        exit 1
    fi
done

echo "✅ Health checks passed"

# Stop existing application
echo "🛑 Stopping existing application..."
pm2 stop $PM2_APP_NAME 2>/dev/null || echo "No existing app to stop"

# Start application with PM2
echo "🚀 Starting application with PM2..."

pm2 start server.js \
    --name "$PM2_APP_NAME" \
    --instances max \
    --exec-mode cluster \
    --env production \
    --log-date-format="YYYY-MM-DD HH:mm:ss Z" \
    --merge-logs \
    --output ./logs/app.log \
    --error ./logs/error.log

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup || echo "⚠️  PM2 startup setup failed (run manually if needed)"

# Wait for application to start
echo "⏳ Waiting for application to start..."
sleep 5

# Health check after deployment
echo "🏥 Post-deployment health check..."
HEALTH_URL="http://localhost:$PORT/api/health"

for i in {1..5}; do
    if curl -f -s "$HEALTH_URL" > /dev/null; then
        echo "✅ Application is running successfully"
        break
    else
        echo "⏳ Waiting for application to respond... (attempt $i/5)"
        sleep 3
    fi
    
    if [ $i -eq 5 ]; then
        echo "❌ Application health check failed"
        pm2 logs $PM2_APP_NAME --lines 20
        exit 1
    fi
done

# Display application status
echo "📊 Application Status:"
pm2 show $PM2_APP_NAME

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Application Details:"
echo "  URL: http://localhost:$PORT"
echo "  Health Check: $HEALTH_URL"
echo "  PM2 Status: pm2 status"
echo "  Logs: pm2 logs $PM2_APP_NAME"
echo "  Restart: pm2 restart $PM2_APP_NAME"
echo "  Stop: pm2 stop $PM2_APP_NAME"
echo ""
echo "🔧 Useful Commands:"
echo "  Monitor: pm2 monit"
echo "  Reload: pm2 reload $PM2_APP_NAME"
echo "  Delete: pm2 delete $PM2_APP_NAME"
