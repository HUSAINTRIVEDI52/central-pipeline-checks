const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Setting up LocalIt Backend...');

// Check Node.js version
const nodeVersion = process.version;
const requiredVersion = 16;
const currentVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

if (currentVersion < requiredVersion) {
  console.error(`❌ Node.js version ${requiredVersion} or higher is required. Current version: ${nodeVersion}`);
  process.exit(1);
}

console.log(`✅ Node.js version check passed: ${nodeVersion}`);

// Create necessary directories
const directories = [
  'uploads',
  'uploads/images',
  'uploads/documents',
  'logs',
  'temp'
];

directories.forEach(dir => {
  const dirPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// Check for .env file
const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('📝 Created .env file from .env.example');
    console.log('⚠️  Please update the .env file with your actual configuration values');
  } else {
    console.error('❌ .env.example file not found');
  }
}

// Install dependencies
try {
  console.log('📦 Installing dependencies...');
  execSync('npm install', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('✅ Dependencies installed successfully');
} catch (error) {
  console.error('❌ Failed to install dependencies:', error.message);
  process.exit(1);
}

// Create gitignore if it doesn't exist
const gitignorePath = path.join(__dirname, '..', '.gitignore');
const gitignoreContent = `
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.production

# Logs
logs/
*.log

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# Uploads
uploads/
temp/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Build
dist/
build/
`;

if (!fs.existsSync(gitignorePath)) {
  fs.writeFileSync(gitignorePath, gitignoreContent.trim());
  console.log('📝 Created .gitignore file');
}

// Create startup scripts
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Add additional scripts if not present
const additionalScripts = {
  "seed": "node seeds/seedData.js",
  "setup": "node scripts/setup.js",
  "lint": "eslint .",
  "prod": "NODE_ENV=production node server.js"
};

Object.keys(additionalScripts).forEach(script => {
  if (!packageJson.scripts[script]) {
    packageJson.scripts[script] = additionalScripts[script];
  }
});

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
console.log('📝 Updated package.json with additional scripts');

console.log('\n🎉 Setup completed successfully!');
console.log('\n📋 Next steps:');
console.log('1. Update .env file with your configuration');
console.log('2. Start MongoDB service');
console.log('3. Run: npm run seed (optional - to add sample data)');
console.log('4. Run: npm run dev (for development)');
console.log('5. Run: npm start (for production)');
console.log('\n🔗 Available endpoints will be at: http://localhost:3000');
console.log('📚 API Documentation: http://localhost:3000/api/health');
