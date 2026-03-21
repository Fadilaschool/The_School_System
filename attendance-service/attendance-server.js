/**
 * Main Attendance Service Server
 * Integrates all attendance routes and provides complete backend API
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'attendance_db',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to the PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Database connection error:', err);
});

// Middleware
// CORS: allow localhost (dev) and production domain
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser clients
    const isLocal = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    const isProduction = /^https?:\/\/(.*\.)?elfadila\.com$/.test(origin);
    if (isLocal || isProduction) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // Do not hardcode allowedHeaders: let cors reflect Access-Control-Request-Headers
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving
app.use(express.static(path.join(__dirname)));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/frontend', express.static(path.join(__dirname, '../frontend')));

// Serve frontend assets for login page
app.use('/assets', express.static(path.join(__dirname, '../frontend/assets')));
app.use('/components', express.static(path.join(__dirname, '../frontend/components')));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow common file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, and documents are allowed.'));
    }
  }
});

// Make pool available to routes
app.locals.pool = pool;
app.locals.upload = upload;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: 'connected'
  });
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance-master.html'));
});

app.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance-master.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/daily/:employeeId?', (req, res) => {
  res.sendFile(path.join(__dirname, 'daily-attendance.html'));
});

app.get('/submit-exception', (req, res) => {
  res.sendFile(path.join(__dirname, 'submit-exception.html'));
});

app.get('/exceptions', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/pages/exceptions.html'));
});

// Import and use route modules
try {
  // JWT verification middleware
  const jwt = require('jsonwebtoken');

  const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      req.user = {
        userId: decoded.userId,
        employeeId: decoded.employeeId
      };
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

  // Combine all attendance-related routes under a single main router
  const mainAttendanceRouter = express.Router();

  // Core attendance routes
  const attendanceRoutes = require('./attendance-routes');
  attendanceRoutes.setAuthMiddleware(verifyToken);
  mainAttendanceRouter.use(attendanceRoutes.initializeRoutes(app.locals.pool));

  // Extra attendance features routes
  const attendanceExtraRoutes = require('./attendance-extra-routes');
  attendanceExtraRoutes.setAuthMiddleware(verifyToken);
  mainAttendanceRouter.use(attendanceExtraRoutes.initializeRoutes(app.locals.pool));

  // Export and processing routes
  const attendanceExportRoutes = require('./attendance-export-routes');
  attendanceExportRoutes.setAuthMiddleware(verifyToken);
  mainAttendanceRouter.use(attendanceExportRoutes.initializeRoutes(app.locals.pool));

  app.use('/api/attendance', mainAttendanceRouter);

  // Exception routes (existing)
  const exceptionRoutes = require('./exceptions-routes');
  exceptionRoutes.setAuthMiddleware(verifyToken);
  app.use('/api/exceptions', exceptionRoutes.initializeRoutes(app.locals.pool));

  // Substitutions routes (new)
  const substitutionsRoutes = require('./substitutions-routes');
  substitutionsRoutes.setAuthMiddleware(verifyToken);
  app.use('/api/substitutions', substitutionsRoutes.initializeRoutes(app.locals.pool));

  // Punch routes (for file upload and raw punches management)
  const punchRoutes = require('./punch-routes');
  punchRoutes.setAuthMiddleware(verifyToken);
  app.use('/api/punches', punchRoutes.initializeRoutes(app.locals.pool));

  // Dashboard routes (optimized stats for dashboard)
  const dashboardRoutes = require('./dashboard-routes');
  dashboardRoutes.setAuthMiddleware(verifyToken);
  mainAttendanceRouter.use(dashboardRoutes.initializeRoutes(app.locals.pool));

  console.log('✓ All route modules loaded successfully');
} catch (error) {
  console.error('Error loading route modules:', error);
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 5MB.'
      });
    }
    return res.status(400).json({
      success: false,
      error: `File upload error: ${error.message}`
    });
  }

  res.status(error.status || 500).json({
    success: false,
    error: error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  try {
    await pool.end();
    console.log('Database pool closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  try {
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    ATTENDANCE SERVICE SERVER                 ║
╠══════════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${PORT}                     ║
║                                                              ║
║  Available Pages:                                            ║
║  • Master Attendance Log: http://localhost:${PORT}/master        ║
║  • Daily Attendance:      http://localhost:${PORT}/daily         ║
║  • Submit Exception:      http://localhost:${PORT}/submit-exception ║
║  • Manage Exceptions:     http://localhost:${PORT}/exceptions    ║
║                                                              ║
║  API Base URL: http://localhost:${PORT}/api                      ║
║  Health Check: http://localhost:${PORT}/health                   ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;