const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const ExcelJS = require('exceljs');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
require('dotenv').config({ path: '../.env' });

/**
 * Creates a default contract template .docx with placeholders already in place.
 * Save this to contract-templates/ or let user download it — no manual editing needed.
 */
function createDefaultContractTemplateBuffer() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const documentBody = `
  <w:body>
    <w:p><w:r><w:t>عقد عمل — CONTRACT</w:t></w:r></w:p>
    <w:p><w:r><w:t>الرقم: {Contract_Number}</w:t></w:r></w:p>
    <w:p><w:r><w:t>يتم التعاقد مع العامل (ة): {Full_Name}</w:t></w:r></w:p>
    <w:p><w:r><w:t>رقم بطاقة التعريف: {ID_No} — الصادرة في: {Issue_Date} — عن: {Issue_Authority}</w:t></w:r></w:p>
    <w:p><w:r><w:t>المولود (ة) في: {Birth_Date} — بـ: {Birth_Place}</w:t></w:r></w:p>
    <w:p><w:r><w:t>جنسية: {Nationality} — الساكن (ة) بـ: {Address}</w:t></w:r></w:p>
    <w:p><w:r><w:t>الوظيفة: {Position}</w:t></w:r></w:p>
    <w:p><w:r><w:t>مدة العقد: {Duration} — من: {Start_Date} إلى: {End_Date}</w:t></w:r></w:p>
    <w:p><w:r><w:t>الراتب الشهري: {Salary}</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:docGrid w:linePitch="360"/></w:sectPr>
  </w:body>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${documentBody}
</w:document>`;

  const zip = new PizZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', documentXml);

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Converts a sample contract .docx (حليمي اسلام / عمي لينة) into a template by replacing
 * sample data with placeholders. Keeps the exact layout and formatting of the sample.
 */
function convertSampleToTemplate(sampleBuffer) {
  const zip = new PizZip(sampleBuffer);
  const nameReplacements = [
    ['حليمي اسلام', '{Full_Name}'],
    ['إسلام حليمي', '{Full_Name}'],
    ['عمي لينة', '{Full_Name}'],
    ['لينة عمي', '{Full_Name}']
  ];
  const xmlFiles = ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/header3.xml', 'word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml'];
  xmlFiles.forEach((fileName) => {
    const f = zip.file(fileName);
    if (f) {
      let xml = f.asText();
      nameReplacements.forEach(([from, to]) => {
        if (xml.indexOf(from) !== -1) xml = xml.split(from).join(to);
      });
      zip.file(fileName, xml);
    }
  });
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const app = express();
const PORT = process.env.USER_MANAGEMENT_SERVICE_PORT || 3002;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 }, // 10MB default (increased for Excel files)
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'profile_picture') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for profile pictures'));
      }
    } else if (file.fieldname === 'cv') {
      if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only PDF and image files are allowed for CV'));
      }
    } else if (file.fieldname === 'excel_file') {
      // Allow Excel files (.xlsx, .xls)
      const allowedMimes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/vnd.ms-excel', // .xls
        'application/octet-stream' // Sometimes Excel files are sent with this
      ];
      const allowedExts = ['.xlsx', '.xls'];
      const ext = path.extname(file.originalname).toLowerCase();
      
      if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
      }
    } else {
      cb(new Error('Unexpected field'));
    }
  }
});

// CORS configuration - this is the key fix
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allow localhost on any port for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Add your production domains here
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:8080',
      // Add your production domain here
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for development - change this in production
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept'],
};

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin resource sharing
}));
app.use(cors(corsOptions));
app.use(morgan('combined'));
app.use(express.json());

// Serve static uploads with proper CORS headers
app.use('/uploads', (req, res, next) => {
  // Set CORS headers for static files
  const origin = req.headers.origin;
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(uploadsDir));

// JWT verification middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Helper function to get employee by user ID
async function getEmployeeByUserId(userId) {
  const result = await pool.query(`
    SELECT e.*, p.name as position_name, u.username, u.role
    FROM employees e
    LEFT JOIN positions p ON e.position_id = p.id
    LEFT JOIN users u ON e.user_id = u.id
    WHERE u.id = $1
  `, [userId]);
  
  return result.rows[0] || null;
}

// Helper function to get employee by ID
async function getEmployeeById(employeeId) {
  const result = await pool.query(`
    SELECT e.*, p.name as position_name, u.username, u.role
    FROM employees e
    LEFT JOIN positions p ON e.position_id = p.id
    LEFT JOIN users u ON e.user_id = u.id
    WHERE e.id = $1
  `, [employeeId]);
  
  return result.rows[0] || null;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'User Management Service' });
});

// Get current user's profile
app.get('/profile', verifyToken, async (req, res) => {
  try {
    const employee = await getEmployeeByUserId(req.user.userId);
    
    if (!employee) {
      // If no employee record exists, return user data from token
      // This handles cases like Directors who may not have employee records
      return res.json({
        id: req.user.userId,
        username: req.user.username,
        role: req.user.role,
        first_name: req.user.firstName || '',
        last_name: req.user.lastName || '',
        email: '',
        phone: '',
        position_name: null,
        department: null
      });
    }
    
    // Remove sensitive information
    const { password_hash, ...profileData } = employee;
    
    res.json(profileData);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password endpoint (must come before /profile route)
app.put('/profile/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    // Get user from database
    const userResult = await pool.query('SELECT id, password_hash FROM users WHERE id = $1', [req.user.userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, req.user.userId]
    );

    res.json({
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update current user's profile
app.put('/profile', verifyToken, upload.single('profile_picture'), async (req, res) => {
  try {
    const employee = await getEmployeeByUserId(req.user.userId);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }

    const updateFields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = [
      'first_name', 'last_name', 'gender', 'birth_date', 'phone', 
      'email', 'nationality', 'address', 'marital_status', 
      'language_preference', 'theme_preference'
    ];

    // Handle regular fields
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateFields.push(`${field} = $${paramCount}`);
        let value = req.body[field];
        
        if (value === '') {
          value = null;
        }
        
        values.push(value);
        paramCount++;
      }
    }

    // Handle notification preferences
    if (req.body.notification_preferences) {
      updateFields.push(`notification_preferences = $${paramCount}`);
      values.push(JSON.stringify(req.body.notification_preferences));
      paramCount++;
    }

    // Handle profile picture upload
    if (req.file) {
      // Delete old profile picture if it exists
      if (employee.profile_picture_url) {
        const oldImagePath = path.join(__dirname, employee.profile_picture_url);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      
      updateFields.push(`profile_picture_url = $${paramCount}`);
      values.push(`/uploads/${req.file.filename}`);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(employee.id);
    const query = `UPDATE employees SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Get updated profile with position and user info
    const updatedEmployee = await getEmployeeById(result.rows[0].id);

    res.json({
      message: 'Profile updated successfully',
      profile: updatedEmployee
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload profile picture only
app.post('/profile/picture', verifyToken, upload.single('profile_picture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const employee = await getEmployeeByUserId(req.user.userId);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }

    // Delete old profile picture if it exists
    if (employee.profile_picture_url) {
      const oldImagePath = path.join(__dirname, employee.profile_picture_url);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    const profilePictureUrl = `/uploads/${req.file.filename}`;

    // Update profile picture URL in database
    await pool.query(
      'UPDATE employees SET profile_picture_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [profilePictureUrl, employee.id]
    );

    res.json({
      message: 'Profile picture updated successfully',
      profile_picture_url: profilePictureUrl
    });
  } catch (error) {
    console.error('Upload profile picture error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Profile image endpoint with proper CORS handling
app.get('/profile-image/:employeeId', verifyToken, async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    // Get employee data
    const employee = await getEmployeeById(employeeId);
    if (!employee || !employee.profile_picture_url) {
      return res.status(404).json({ error: 'Profile image not found' });
    }
    
    let imagePath;
    if (employee.profile_picture_url.startsWith('/uploads/')) {
      imagePath = path.join(__dirname, employee.profile_picture_url);
    } else if (employee.profile_picture_url.startsWith('uploads/')) {
      imagePath = path.join(__dirname, employee.profile_picture_url);
    } else {
      imagePath = path.join(__dirname, 'uploads', employee.profile_picture_url);
    }
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Image file not found' });
    }
    
    // Set proper headers with CORS
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    
    res.setHeader('Content-Type', mimeTypes[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    
    // Set CORS headers
    const origin = req.headers.origin;
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Stream the file
    const fileStream = fs.createReadStream(imagePath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Error serving profile image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all employees
app.get('/employees', verifyToken, async (req, res) => {
  try {
    const { search, sort_by = 'first_name', user_id } = req.query;
    
    let query = `
      SELECT e.*, p.name as position_name, u.username, u.role
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
      LEFT JOIN users u ON e.user_id = u.id
    `;
    
    const params = [];
    const conditions = [];
    
    if (search) {
      conditions.push(`(e.first_name ILIKE $${params.length + 1} OR e.last_name ILIKE $${params.length + 1} OR p.name ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    
    if (user_id) {
      conditions.push(`u.id = $${params.length + 1}`);
      params.push(user_id);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY e.${sort_by}`;
    
    const result = await pool.query(query, params);
    
    // Add contract information to each employee
    for (let employee of result.rows) {
      try {
        const contractResult = await pool.query(`
          SELECT id, start_date, end_date, is_active, position_id
          FROM employee_contracts
          WHERE employee_id = $1
          ORDER BY start_date DESC, created_at DESC
          LIMIT 1
        `, [employee.id]);
        
        if (contractResult.rows.length > 0) {
          const contract = contractResult.rows[0];
          employee.contract_start_date = contract.start_date;
          employee.contract_end_date = contract.end_date;
          employee.contract_id = contract.id;
          employee.contract_is_active = contract.is_active;
        }
      } catch (e) {
        // Contract table might not exist, skip silently
        console.warn('Contract query skipped for employee:', employee.id, e.message);
      }
    }
    res.json(result.rows);
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download Excel template for employee import (MUST come before /employees/:id)
app.get('/employees/import-template', verifyToken, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Employees');

    // Define columns with Arabic and English headers
    // Note: Dropdown/select fields (Role, Gender, Position, Institution, Marital Status) are excluded
    // Education Level is included and can be imported (values: None, High School, Bachelor, Master, PhD, Diploma, Technical)
    worksheet.columns = [
      { header: 'First Name (الاسم الأول)', key: 'first_name', width: 20 },
      { header: 'Last Name (اسم العائلة)', key: 'last_name', width: 20 },
      { header: 'Arabic First Name (الاسم الأول)', key: 'foreign_name', width: 25 },
      { header: 'Arabic Last Name (اسم العائلة)', key: 'foreign_last_name', width: 25 },
      { header: 'Email (البريد الإلكتروني)', key: 'email', width: 30 },
      { header: 'Phone (الهاتف)', key: 'phone', width: 15 },
      { header: 'Birth Date (mm/dd/yyyy)', key: 'birth_date', width: 18 },
      { header: 'Place Of Birth', key: 'place_of_birth', width: 20 },
      { header: 'Social Security Number', key: 'social_security_number', width: 20 },
      { header: 'Join Date (mm/dd/yyyy)', key: 'join_date', width: 18 },
      { header: 'Contract Start Date (mm/dd/yyyy)', key: 'contract_start_date', width: 25 },
      { header: 'Contract End Date (mm/dd/yyyy)', key: 'contract_end_date', width: 25 },
      { header: 'Contract Salary (Monthly)', key: 'contract_salary', width: 20 },
      { header: 'Probation Months', key: 'probation_months', width: 15 },
      { header: 'Education Level (المستوى التعليمي)', key: 'education_level', width: 20 },
      { header: 'Address (French)', key: 'address', width: 30 },
      { header: 'ID Card Number', key: 'id_card_number', width: 20 },
      { header: 'ID Issue Date (mm/dd/yyyy)', key: 'id_issue_date', width: 20 },
      { header: 'ID Issue Authority', key: 'id_issue_authority', width: 30 },
      { header: 'Arabic Place of Birth', key: 'arabic_place_of_birth', width: 25 },
      { header: 'Arabic Address', key: 'arabic_address', width: 30 },
      { header: 'Arabic Nationality', key: 'arabic_nationality', width: 20 },
      { header: 'Basic Salary (Monthly)', key: 'base_salary', width: 18 },
      { header: 'Regular Hour Price', key: 'hourly_rate', width: 20 },
      { header: 'Overtime Hour Price', key: 'overtime_rate', width: 20 },
      { header: 'Salary Effective Date (mm/dd/yyyy)', key: 'salary_effective_date', width: 25 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add example row (excluding dropdown fields - they must be set manually)
    worksheet.addRow({
      first_name: 'John',
      last_name: 'Doe',
      foreign_name: 'جون',
      foreign_last_name: 'دو',
      email: 'john.doe@example.com',
      phone: '+213123456789',
      birth_date: '01/15/1990',
      place_of_birth: 'ALGIERS',
      social_security_number: '00 1234 5678 90',
      join_date: '01/01/2024',
      contract_start_date: '01/01/2024',
      contract_end_date: '',
      contract_salary: '50000',
      probation_months: '0',
      education_level: 'Bachelor',
      address: '123 Main Street, Algiers',
      id_card_number: '1234567890123456',
      id_issue_date: '01/01/2010',
      id_issue_authority: 'دائرة أولاد موسى ولاية بومرداس',
      arabic_place_of_birth: 'الجزائر',
      arabic_address: 'شارع الرئيسي، الجزائر',
      arabic_nationality: 'جزائرية',
      base_salary: '50000',
      hourly_rate: '25',
      overtime_rate: '37.5',
      salary_effective_date: '01/01/2024'
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=employee_import_template.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating template:', error);
    res.status(500).json({ error: 'Failed to generate template', details: error.message });
  }
});

app.get('/employees/generate-ats-zip', verifyToken, async (req, res) => {
  try {
    // Get all active employees
    const employeeResult = await pool.query(`
      SELECT DISTINCT ON (e.id)
        e.id, e.first_name, e.last_name, e.gender, e.birth_date, e.place_of_birth,
        e.address, e.social_security_number, e.institution,
        b.name as branch_name, b.description as branch_description,
        b.address as branch_address, b.wilaya, b.registration_number,
        p.name as position_name,
        c.start_date as contract_start_date
      FROM employees e
      LEFT JOIN employee_contracts c ON e.id = c.employee_id 
        AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
        AND c.is_active = true
      LEFT JOIN positions p ON c.position_id = p.id
      LEFT JOIN branches b ON e.institution = b.name
      WHERE c.id IS NOT NULL
      ORDER BY e.id, c.start_date DESC
    `);

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active employees found' });
    }

    const employees = employeeResult.rows;

    // Set response headers for ZIP file
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=ats_all_active_employees_${new Date().toISOString().split('T')[0]}.zip`);

    // Create archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create ZIP file' });
      }
    });

    // Pipe archive data to response
    archive.pipe(res);

    // Generate ATS for each employee and add to archive
    for (const emp of employees) {
      try {
        const pdfBuffer = await generateATSPDFBuffer(emp);
        const fileName = `ATS_${(emp.last_name || '').toUpperCase()}_${(emp.first_name || '').toUpperCase()}_${emp.id}.pdf`;
        archive.append(pdfBuffer, { name: fileName });
      } catch (error) {
        console.error(`Error generating ATS for employee ${emp.id}:`, error);
        // Continue with other employees even if one fails
      }
    }

    // Finalize the archive
    await archive.finalize();
  } catch (error) {
    console.error('Error generating ATS ZIP:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate ATS ZIP file' });
    }
  }
});

// Export all employees with credentials to Excel (MUST come before /employees/:id)
app.get('/employees/export-with-credentials', verifyToken, async (req, res) => {
  try {
    // Only HR Manager can export credentials
    if (req.user.role !== 'HR_Manager') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all employees with user accounts (active accounts = employees with user_id)
    const employeeResult = await pool.query(`
      SELECT DISTINCT ON (e.id)
        e.id, e.first_name, e.last_name, e.foreign_name, e.foreign_last_name,
        e.email, e.phone, e.gender, e.birth_date, e.place_of_birth,
        e.social_security_number, e.institution,
        e.address, e.join_date, e.education_level,
        u.username, u.role,
        p.name as position_name,
        c.start_date as contract_start_date,
        c.end_date as contract_end_date,
        c.contract_number, c.contract_salary, c.probation_months
      FROM employees e
      INNER JOIN users u ON e.user_id = u.id
      LEFT JOIN employee_contracts c ON e.id = c.employee_id 
        AND c.is_active = true
      LEFT JOIN positions p ON COALESCE(c.position_id, e.position_id) = p.id
      ORDER BY e.id, c.start_date DESC NULLS LAST
    `);

    // Get compensation and identity data for each employee separately
    const employeesWithData = await Promise.all(
      employeeResult.rows.map(async (emp) => {
        try {
          // Get compensation
          const compResult = await pool.query(`
            SELECT base_salary, hourly_rate, overtime_rate, effective_date
            FROM employee_compensations
            WHERE employee_id = $1
            ORDER BY effective_date DESC NULLS LAST
            LIMIT 1
          `, [emp.id]);
          
          if (compResult.rows.length > 0) {
            emp.base_salary = compResult.rows[0].base_salary;
            emp.hourly_rate = compResult.rows[0].hourly_rate;
            emp.overtime_rate = compResult.rows[0].overtime_rate;
            emp.salary_effective_date = compResult.rows[0].effective_date;
          }
          
          // Get identity
          const identityResult = await pool.query(`
            SELECT id_card_number, id_issue_date, id_issue_authority,
                   arabic_place_of_birth, arabic_address, arabic_nationality
            FROM employee_identities
            WHERE employee_id = $1
          `, [emp.id]);
          
          if (identityResult.rows.length > 0) {
            emp.id_card_number = identityResult.rows[0].id_card_number;
            emp.id_issue_date = identityResult.rows[0].id_issue_date;
            emp.id_issue_authority = identityResult.rows[0].id_issue_authority;
            emp.arabic_place_of_birth = identityResult.rows[0].arabic_place_of_birth;
            emp.arabic_address = identityResult.rows[0].arabic_address;
            emp.arabic_nationality = identityResult.rows[0].arabic_nationality;
          }
        } catch (e) {
          console.warn(`Failed to get additional data for employee ${emp.id}:`, e.message);
        }
        return emp;
      })
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Employees');

    // Define columns
    worksheet.columns = [
      { header: 'First Name (الاسم الأول)', key: 'first_name', width: 20 },
      { header: 'Last Name (اسم العائلة)', key: 'last_name', width: 20 },
      { header: 'Arabic First Name (الاسم الأول)', key: 'foreign_name', width: 25 },
      { header: 'Arabic Last Name (اسم العائلة)', key: 'foreign_last_name', width: 25 },
      { header: 'Email (البريد الإلكتروني)', key: 'email', width: 30 },
      { header: 'Phone (الهاتف)', key: 'phone', width: 15 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Birth Date', key: 'birth_date', width: 18 },
      { header: 'Place Of Birth', key: 'place_of_birth', width: 20 },
      { header: 'Social Security Number', key: 'social_security_number', width: 20 },
      { header: 'Institution (اختر المؤسسة)', key: 'institution', width: 25 },
      { header: 'Position Name', key: 'position_name', width: 25 },
      { header: 'Join Date', key: 'join_date', width: 18 },
      { header: 'Contract Start Date', key: 'contract_start_date', width: 18 },
      { header: 'Contract End Date', key: 'contract_end_date', width: 18 },
      { header: 'Contract Number', key: 'contract_number', width: 18 },
      { header: 'Contract Salary (Monthly)', key: 'contract_salary', width: 20 },
      { header: 'Probation Months', key: 'probation_months', width: 15 },
      { header: 'Education Level (المستوى التعليمي)', key: 'education_level', width: 20 },
      { header: 'Address (French)', key: 'address', width: 30 },
      { header: 'ID Card Number', key: 'id_card_number', width: 20 },
      { header: 'ID Issue Date', key: 'id_issue_date', width: 18 },
      { header: 'ID Issue Authority', key: 'id_issue_authority', width: 30 },
      { header: 'Arabic Place of Birth', key: 'arabic_place_of_birth', width: 25 },
      { header: 'Arabic Address', key: 'arabic_address', width: 30 },
      { header: 'Arabic Nationality', key: 'arabic_nationality', width: 20 },
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Password', key: 'password', width: 20 },
      { header: 'Role', key: 'role', width: 15 },
      { header: 'Basic Salary (Monthly)', key: 'base_salary', width: 18 },
      { header: 'Regular Hour Price', key: 'hourly_rate', width: 20 },
      { header: 'Overtime Hour Price', key: 'overtime_rate', width: 20 },
      { header: 'Salary Effective Date', key: 'salary_effective_date', width: 18 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Format date helper
    const formatDate = (date) => {
      if (!date) return '';
      const d = new Date(date);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      return `${month}/${day}/${year}`;
    };

    // Add employee data
    employeesWithData.forEach(emp => {
      // Generate password using the same algorithm as import
      // Note: This generates the password based on the same logic, but actual stored password may differ
      // if it was changed after import
      const generatedPassword = generatePassword(emp.first_name || '', emp.last_name || '');
      
      worksheet.addRow({
        first_name: emp.first_name || '',
        last_name: emp.last_name || '',
        foreign_name: emp.foreign_name || '',
        foreign_last_name: emp.foreign_last_name || '',
        email: emp.email || '',
        phone: emp.phone || '',
        gender: emp.gender || '',
        birth_date: formatDate(emp.birth_date),
        place_of_birth: emp.place_of_birth || '',
        social_security_number: emp.social_security_number || '',
        institution: emp.institution || '',
        position_name: emp.position_name || '',
        join_date: formatDate(emp.join_date),
        contract_start_date: formatDate(emp.contract_start_date),
        contract_end_date: formatDate(emp.contract_end_date),
        contract_number: emp.contract_number || '',
        contract_salary: emp.contract_salary || '',
        probation_months: emp.probation_months || 0,
        education_level: emp.education_level || '',
        address: emp.address || '',
        id_card_number: emp.id_card_number || '',
        id_issue_date: formatDate(emp.id_issue_date),
        id_issue_authority: emp.id_issue_authority || '',
        arabic_place_of_birth: emp.arabic_place_of_birth || '',
        arabic_address: emp.arabic_address || '',
        arabic_nationality: emp.arabic_nationality || '',
        username: emp.username || '',
        password: generatedPassword,
        role: emp.role || '',
        base_salary: emp.base_salary || '',
        hourly_rate: emp.hourly_rate || '',
        overtime_rate: emp.overtime_rate || '',
        salary_effective_date: formatDate(emp.salary_effective_date)
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=employees_export_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting employees:', error);
    console.error('Error stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export employees', details: error.message });
    }
  }
});

// Get employee by ID
app.get('/employees/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT e.*, p.name as position_name, u.username, u.role
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    const employee = result.rows[0];
    
    // Get the most recent contract (active or latest)
    try {
      const contractResult = await pool.query(`
        SELECT id, start_date, end_date, is_active, position_id,
               contract_number, contract_salary, probation_months, duration_months
        FROM employee_contracts
        WHERE employee_id = $1
        ORDER BY start_date DESC, created_at DESC
        LIMIT 1
      `, [id]);
      
      if (contractResult.rows.length > 0) {
        const contract = contractResult.rows[0];
        employee.contract_start_date = contract.start_date;
        employee.contract_end_date = contract.end_date;
        employee.contract_id = contract.id;
        employee.contract = {
          id: contract.id,
          start_date: contract.start_date,
          end_date: contract.end_date,
          is_active: contract.is_active,
          position_id: contract.position_id,
          contract_number: contract.contract_number,
          contract_salary: contract.contract_salary,
          probation_months: contract.probation_months,
          duration_months: contract.duration_months
        };
      }
    } catch (e) {
      console.warn('Contract query skipped (table might not exist):', e.message);
    }
    
    // Get identity information
    try {
      const identityResult = await pool.query(`
        SELECT id_card_number, id_issue_date, id_issue_authority,
               arabic_place_of_birth, arabic_address, arabic_nationality
        FROM employee_identities
        WHERE employee_id = $1
      `, [id]);
      
      if (identityResult.rows.length > 0) {
        employee.identity = identityResult.rows[0];
      }
    } catch (e) {
      console.warn('Identity query skipped (table might not exist):', e.message);
    }
    
    // Get the most recent compensation data
    try {
      const compensationResult = await pool.query(`
        SELECT base_salary, hourly_rate, overtime_rate, effective_date
        FROM employee_compensations
        WHERE employee_id = $1
        ORDER BY effective_date DESC NULLS LAST
        LIMIT 1
      `, [id]);
      
      if (compensationResult.rows.length > 0) {
        const compensation = compensationResult.rows[0];
        employee.base_salary = compensation.base_salary;
        employee.hourly_rate = compensation.hourly_rate;
        employee.overtime_rate = compensation.overtime_rate;
        employee.effective_date = compensation.effective_date;
      }
    } catch (e) {
      console.warn('Compensation query skipped (table might not exist):', e.message);
    }
    
    // Debug: Log all employee fields to verify they're being returned
    console.log('📥 [Get Employee] Returning employee data:', {
      employeeId: id,
      role: employee.role,
      username: employee.username,
      user_id: employee.user_id,
      place_of_birth: employee.place_of_birth,
      social_security_number: employee.social_security_number,
      contract_start_date: employee.contract_start_date,
      contract_end_date: employee.contract_end_date,
      allFields: Object.keys(employee)
    });
    
    res.json(employee);
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all positions
app.get('/positions', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM positions ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get positions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new position (HR only)
app.post('/positions', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ error: 'Position name is required' });
    }

    const insert = await pool.query(
      'INSERT INTO positions (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );

    res.status(201).json({ success: true, position: insert.rows[0] });
  } catch (error) {
    if (error && error.code === '23505') { // unique violation
      return res.status(409).json({ error: 'Position name already exists' });
    }
    console.error('Create position error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a position name (HR only)
app.put('/positions/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { name } = req.body;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ error: 'Position name is required' });
    }

    const upd = await pool.query(
      'UPDATE positions SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [name.trim(), id]
    );

    if (upd.rows.length === 0) {
      return res.status(404).json({ error: 'Position not found' });
    }

    res.json({ success: true, position: upd.rows[0] });
  } catch (error) {
    if (error && error.code === '23505') { // unique violation
      return res.status(409).json({ error: 'Position name already exists' });
    }
    console.error('Update position error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a position (HR only)
app.delete('/positions/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    // Prevent delete if any employees still reference this position
    const ref = await pool.query('SELECT 1 FROM employees WHERE position_id = $1 LIMIT 1', [id]);
    if (ref.rows.length > 0) {
      return res.status(409).json({ error: 'Cannot delete: position is assigned to employees' });
    }

    const del = await pool.query('DELETE FROM positions WHERE id = $1 RETURNING *', [id]);
    if (del.rows.length === 0) {
      return res.status(404).json({ error: 'Position not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete position error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new employee with user account
app.post('/employees', verifyToken, upload.fields([
  { name: 'profile_picture', maxCount: 1 },
  { name: 'cv', maxCount: 1 }
]), async (req, res) => {
  // Log immediately when endpoint is hit
  console.log('🚀 [Create Employee] Endpoint called - Request received');
  console.log('🚀 [Create Employee] req.body keys:', Object.keys(req.body || {}));
  console.log('🚀 [Create Employee] req.body.contract_start_date:', req.body.contract_start_date);
  console.log('🚀 [Create Employee] req.body.contract_end_date:', req.body.contract_end_date);
  console.log('🚀 [Create Employee] req.body.position_id:', req.body.position_id);
  
  const client = await pool.connect();
  
  try {
    // Only HR Manager can add employees
    if (req.user.role !== 'HR_Manager') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const {
      username, password, role = 'Employee',
      position_id, institution, first_name, last_name,
      foreign_name, foreign_last_name, gender, birth_date, phone,
      email, address, join_date,
      marital_status, visible_to_parents_in_chat, education_level,
      place_of_birth, social_security_number, contract_start_date, contract_end_date,
      contract_salary, probation_months,
      // Identity fields
      id_card_number, id_issue_date, id_issue_authority,
      arabic_place_of_birth, arabic_address, arabic_nationality
    } = req.body;
    
    // Debug: Log all received data to help diagnose contract creation issues
    console.log('📥 [Create Employee] Received request data:', {
      username,
      first_name,
      last_name,
      position_id,
      contract_start_date,
      contract_end_date,
      place_of_birth,
      social_security_number,
      allBodyKeys: Object.keys(req.body)
    });

    if (!username || !password || !first_name || !last_name || !email) {
      return res.status(400).json({ 
        error: 'Username, password, first name, last name, and email are required' 
      });
    }

    await client.query('BEGIN');

    // Generate unique username if the provided one already exists
    const uniqueUsername = await generateUniqueUsername(username, client);
    const usernameChanged = uniqueUsername !== username;
    if (usernameChanged) {
      console.log(`ℹ️ [Create Employee] Username "${username}" already exists, using "${uniqueUsername}" instead`);
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user account with unique username
    const userResult = await client.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [uniqueUsername, passwordHash, role]
    );

    const userId = userResult.rows[0].id;

    let profile_picture_url = null;
    let cv_url = null;

    if (req.files) {
      if (req.files.profile_picture) {
        profile_picture_url = `/uploads/${req.files.profile_picture[0].filename}`;
      }
      if (req.files.cv) {
        cv_url = `/uploads/${req.files.cv[0].filename}`;
      }
    }

    // Create employee record
    // Note: If place_of_birth or social_security_number columns don't exist, 
    // PostgreSQL will throw an error. We catch it and provide a helpful message.
    let employeeResult;
    try {
      employeeResult = await client.query(`
        INSERT INTO employees (
          user_id, position_id, institution, first_name, last_name,
          foreign_name, foreign_last_name, gender, birth_date, phone,
          email, address, join_date,
          marital_status, visible_to_parents_in_chat, profile_picture_url,
          cv_url, education_level, place_of_birth, social_security_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING *
      `, [
        userId, position_id || null, institution, first_name, last_name,
        foreign_name, foreign_last_name, gender || null, birth_date || null, phone,
        email, address, join_date || null,
        marital_status || null, visible_to_parents_in_chat === 'true', profile_picture_url,
        cv_url, education_level, place_of_birth || null, social_security_number || null
      ]);
    } catch (dbError) {
      // Check if error is due to missing columns
      if (dbError.code === '42703' || dbError.message.includes('column') && dbError.message.includes('does not exist')) {
        await client.query('ROLLBACK');
        console.error('❌ [Create Employee] Database columns missing. Please run the migration:', dbError.message);
        return res.status(500).json({ 
          error: 'Database schema is missing required columns. Please run the migration: database/add_document_generation_fields.sql',
          details: dbError.message
        });
      }
      throw dbError; // Re-throw if it's a different error
    }

    // Create initial contract if contract_start_date is provided
    // IMPORTANT: This must happen BEFORE the COMMIT, within the same transaction
    try {
      // Use values directly from req.body if extracted values are undefined (FormData parsing issue)
      const finalContractStartDate = contract_start_date || req.body.contract_start_date;
      const finalContractEndDate = contract_end_date || req.body.contract_end_date || null;
      const finalPositionId = position_id || req.body.position_id;
      
      // Debug: Log what we received - check both extracted and req.body
      console.log('📋 [Create Employee] Contract data check:', {
        contract_start_date_extracted: contract_start_date,
        contract_start_date_from_body: req.body.contract_start_date,
        finalContractStartDate: finalContractStartDate,
        contract_end_date_extracted: contract_end_date,
        contract_end_date_from_body: req.body.contract_end_date,
        finalContractEndDate: finalContractEndDate,
        position_id_extracted: position_id,
        position_id_from_body: req.body.position_id,
        finalPositionId: finalPositionId,
        employee_id: employeeResult.rows[0]?.id,
        allReqBodyKeys: Object.keys(req.body).filter(k => k.includes('contract') || k.includes('position'))
      });
      
      if (finalContractStartDate && finalPositionId) {
        // Determine if contract is active: if end_date is provided and in the past, it's inactive
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDateObj = finalContractEndDate ? new Date(finalContractEndDate) : null;
        const isActive = !finalContractEndDate || (endDateObj && endDateObj >= today);
        
        console.log('📋 [Create Employee] Inserting contract:', {
          employee_id: employeeResult.rows[0].id,
          position_id: finalPositionId,
          start_date: finalContractStartDate,
          end_date: finalContractEndDate,
          is_active: isActive
        });
        
        // Generate contract number
        const contractNumberResult = await client.query(
          'SELECT generate_contract_number($1) as contract_number',
          [finalContractStartDate]
        );
        const contractNumber = contractNumberResult.rows[0].contract_number;
        
        const contractResult = await client.query(`
          INSERT INTO employee_contracts (
            employee_id, position_id, start_date, end_date, is_active,
            contract_number, contract_salary, probation_months
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, start_date, end_date, is_active, contract_number, contract_salary, probation_months
        `, [
          employeeResult.rows[0].id,
          finalPositionId,
          finalContractStartDate,
          finalContractEndDate,
          isActive,
          contractNumber,
          contract_salary ? parseFloat(contract_salary) : null,
          probation_months ? parseInt(probation_months) : 0
        ]);
        
        console.log('✅ [Create Employee] Contract created successfully:', contractResult.rows[0]);
      } else {
        console.warn('⚠️ [Create Employee] Contract not created - missing data:', {
          has_start_date: !!finalContractStartDate,
          contract_start_date_value: finalContractStartDate,
          has_position_id: !!finalPositionId,
          position_id_value: finalPositionId,
          extracted_start_date: contract_start_date,
          body_start_date: req.body.contract_start_date
        });
      }
      
      // Create identity record if ID card info is provided
      if (id_card_number && id_issue_date && id_issue_authority) {
        try {
          await client.query(`
            INSERT INTO employee_identities (
              employee_id, id_card_number, id_issue_date, id_issue_authority,
              arabic_place_of_birth, arabic_address, arabic_nationality
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            employeeResult.rows[0].id,
            id_card_number,
            id_issue_date,
            id_issue_authority,
            arabic_place_of_birth || null,
            arabic_address || null,
            arabic_nationality || 'جزائرية'
          ]);
          console.log('✅ [Create Employee] Identity created successfully');
        } catch (identityError) {
          console.error('❌ [Create Employee] Identity insert failed:', identityError.message);
          // Continue even if identity creation fails
        }
      }
    } catch (e) {
      // Log the full error details
      console.error('❌ [Create Employee] Contract insert FAILED:', {
        error: e.message,
        code: e.code,
        detail: e.detail,
        hint: e.hint,
        position: e.position,
        stack: e.stack?.split('\n').slice(0, 5).join('\n')
      });
      
      // If contract creation fails, we should still commit the employee
      // but log the error clearly
      console.error('⚠️ [Create Employee] Employee will be created but contract was not. Error:', e.message);
    }

    // Optionally insert an employee-specific compensation row if provided
    try {
      const compBase = req.body.base_salary;
      const compHourly = req.body.hourly_rate;
      const compOvertime = req.body.overtime_rate;
      const compEffective = req.body.effective_date;

      if (compBase || compHourly || compOvertime) {
        await client.query(`
          INSERT INTO employee_compensations (
            employee_id, base_salary, hourly_rate, overtime_rate, effective_date
          ) VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE))
        `, [
          employeeResult.rows[0].id,
          compBase ? parseFloat(compBase) : null,
          compHourly ? parseFloat(compHourly) : null,
          compOvertime ? parseFloat(compOvertime) : null,
          compEffective || null
        ]);
      }
    } catch (e) {
      console.warn('Compensation insert skipped (table might not exist or bad input):', e.message);
    }

    await client.query('COMMIT');

    const response = {
      message: 'Employee and user account created successfully',
      employee: employeeResult.rows[0],
      user: userResult.rows[0]
    };
    
    // If username was changed, include that information
    if (usernameChanged) {
      response.username_changed = true;
      response.original_username = username;
      response.actual_username = uniqueUsername;
    }
    
    res.status(201).json(response);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update employee
app.put('/employees/:id', verifyToken, upload.fields([
  { name: 'profile_picture', maxCount: 1 },
  { name: 'cv', maxCount: 1 }
]), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Debug: Log incoming request
    console.log('📥 [Update Employee] Request received:', {
      employeeId: id,
      role: req.body.role,
      bodyKeys: Object.keys(req.body)
    });
    
    // Check if user can update this employee
    if (req.user.role === 'Employee') {
      // Get employee's user_id to check if it matches the current user
      const employeeCheck = await pool.query('SELECT user_id FROM employees WHERE id = $1', [id]);
      if (employeeCheck.rows.length === 0 || employeeCheck.rows[0].user_id !== req.user.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const updateFields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = [
      'position_id', 'institution', 'first_name', 'last_name',
      'gender', 'birth_date', 'phone', 'email', 
      'address', 'join_date', 'marital_status', 'education_level',
      'place_of_birth', 'social_security_number', 'foreign_name', 'foreign_last_name'
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateFields.push(`${field} = $${paramCount}`);
        let value = req.body[field];
        
        if (value === '') {
          value = null;
        }
        
        values.push(value);
        paramCount++;
      }
    }

    if (req.files) {
      if (req.files.profile_picture) {
        updateFields.push(`profile_picture_url = $${paramCount}`);
        values.push(`/uploads/${req.files.profile_picture[0].filename}`);
        paramCount++;
      }
      if (req.files.cv) {
        updateFields.push(`cv_url = $${paramCount}`);
        values.push(`/uploads/${req.files.cv[0].filename}`);
        paramCount++;
      }
    }

    // Handle role update - role is stored in users table, not employees table
    // Check both req.body.role (from JSON) and req.body.role (from form)
    const roleValue = req.body.role;
    console.log('🔍 [Update Employee] Role value check:', {
      roleValue: roleValue,
      roleType: typeof roleValue,
      roleUndefined: roleValue === undefined,
      roleNull: roleValue === null,
      bodyKeys: Object.keys(req.body || {}),
      rawBody: JSON.stringify(req.body).substring(0, 200)
    });
    
    if (roleValue !== undefined && roleValue !== null && roleValue !== '') {
      // Get the employee's user_id
      const employeeCheck = await pool.query('SELECT user_id FROM employees WHERE id = $1', [id]);
      console.log('🔍 [Update Employee] Employee check result:', {
        found: employeeCheck.rows.length > 0,
        user_id: employeeCheck.rows[0]?.user_id
      });
      
      if (employeeCheck.rows.length > 0 && employeeCheck.rows[0].user_id) {
        const userId = employeeCheck.rows[0].user_id;
        
        // Validate role
        const validRoles = ['Employee', 'Department_Responsible', 'HR_Manager', 'Director'];
        if (!validRoles.includes(roleValue)) {
          console.error('❌ [Update Employee] Invalid role:', roleValue);
          return res.status(400).json({ error: 'Invalid role. Must be one of: ' + validRoles.join(', ') });
        }
        
        // Update user role
        const updateResult = await pool.query(
          'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, role',
          [roleValue, userId]
        );
        
        console.log(`✅ [Update Employee] Updated user role to ${roleValue} for employee ${id} (user_id: ${userId})`, {
          updateResult: updateResult.rows[0]
        });
      } else {
        console.warn(`⚠️ [Update Employee] Employee ${id} has no user_id linked, cannot update role`);
      }
    } else {
      console.log('⚠️ [Update Employee] Role not provided or empty, skipping role update');
    }

    if (updateFields.length === 0 && !req.body.role) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    let result;
    if (updateFields.length > 0) {
      values.push(id);
      const query = `UPDATE employees SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
      result = await pool.query(query, values);
    } else {
      // If only role was updated, fetch the employee record
      result = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Handle contract updates if contract dates are provided
    try {
      const contractStartDate = req.body.contract_start_date;
      const contractEndDate = req.body.contract_end_date || null;
      const positionId = req.body.position_id || result.rows[0]?.position_id;
      
      // Check if there's an existing contract for this employee
      const existingContract = await pool.query(`
        SELECT id, start_date, end_date
        FROM employee_contracts
        WHERE employee_id = $1
        ORDER BY start_date DESC, created_at DESC
        LIMIT 1
      `, [id]);
      
      if (contractStartDate && positionId) {
        // Update or create contract with start date
        if (existingContract.rows.length > 0) {
          // Update existing contract
          const existing = existingContract.rows[0];
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const endDateObj = contractEndDate ? new Date(contractEndDate) : null;
          const isActive = !contractEndDate || (endDateObj && endDateObj >= today);
          
          await pool.query(`
            UPDATE employee_contracts
            SET start_date = $1, end_date = $2, is_active = $3, position_id = $4, updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
          `, [
            contractStartDate,
            contractEndDate,
            isActive,
            positionId,
            existing.id
          ]);
        } else {
          // Create new contract if none exists
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const endDateObj = contractEndDate ? new Date(contractEndDate) : null;
          const isActive = !contractEndDate || (endDateObj && endDateObj >= today);
          
          await pool.query(`
            INSERT INTO employee_contracts (
              employee_id, position_id, start_date, end_date, is_active
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            id,
            positionId,
            contractStartDate,
            contractEndDate,
            isActive
          ]);
        }
      } else if (contractEndDate && existingContract.rows.length > 0) {
        // Only update end date if provided (without start date change)
        const existing = existingContract.rows[0];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDateObj = new Date(contractEndDate);
        const isActive = endDateObj >= today;
        
        await pool.query(`
          UPDATE employee_contracts
          SET end_date = $1, is_active = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [
          contractEndDate,
          isActive,
          existing.id
        ]);
      }
    } catch (e) {
      console.warn('Contract update skipped (table might not exist or bad input):', e.message);
    }

    // Optionally append a new compensation snapshot if provided
    try {
      const compBase = req.body.base_salary;
      const compHourly = req.body.hourly_rate;
      const compOvertime = req.body.overtime_rate;
      const compEffective = req.body.effective_date;

      if (compBase || compHourly || compOvertime) {
        await pool.query(`
          INSERT INTO employee_compensations (
            employee_id, base_salary, hourly_rate, overtime_rate, effective_date
          ) VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE))
        `, [
          id,
          compBase ? parseFloat(compBase) : null,
          compHourly ? parseFloat(compHourly) : null,
          compOvertime ? parseFloat(compOvertime) : null,
          compEffective || null
        ]);
      }
    } catch (e) {
      console.warn('Compensation insert skipped (table might not exist or bad input):', e.message);
    }

    // Handle identity update/insert
    try {
      const idCardNumber = req.body.id_card_number;
      const idIssueDate = req.body.id_issue_date;
      const idIssueAuthority = req.body.id_issue_authority;
      const arabicPlaceOfBirth = req.body.arabic_place_of_birth;
      const arabicAddress = req.body.arabic_address;
      const arabicNationality = req.body.arabic_nationality;

      if (idCardNumber && idIssueDate && idIssueAuthority) {
        // Check if identity exists
        const existingIdentity = await pool.query(
          'SELECT id FROM employee_identities WHERE employee_id = $1',
          [id]
        );

        if (existingIdentity.rows.length > 0) {
          // Update existing identity
          await pool.query(`
            UPDATE employee_identities
            SET id_card_number = $1, id_issue_date = $2, id_issue_authority = $3,
                arabic_place_of_birth = $4, arabic_address = $5, arabic_nationality = $6,
                updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = $7
          `, [
            idCardNumber,
            idIssueDate,
            idIssueAuthority,
            arabicPlaceOfBirth || null,
            arabicAddress || null,
            arabicNationality || 'جزائرية',
            id
          ]);
        } else {
          // Insert new identity
          await pool.query(`
            INSERT INTO employee_identities (
              employee_id, id_card_number, id_issue_date, id_issue_authority,
              arabic_place_of_birth, arabic_address, arabic_nationality
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            id,
            idCardNumber,
            idIssueDate,
            idIssueAuthority,
            arabicPlaceOfBirth || null,
            arabicAddress || null,
            arabicNationality || 'جزائرية'
          ]);
        }
      }
    } catch (e) {
      console.warn('Identity update skipped (table might not exist or bad input):', e.message);
    }

    // Fetch updated employee with role from users table
    const updatedEmployee = await pool.query(`
      SELECT e.*, p.name as position_name, u.username, u.role
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.id = $1
    `, [id]);
    
    res.json({
      message: 'Employee updated successfully',
      employee: updatedEmployee.rows[0] || result.rows[0]
    });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete employee
app.delete('/employees/:id', verifyToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Only HR Manager can delete employees
    if (req.user.role !== 'HR_Manager') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    await client.query('BEGIN');

    // Get employee's user_id before deletion
    const employeeResult = await client.query('SELECT user_id FROM employees WHERE id = $1', [id]);
    
    if (employeeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Employee not found' });
    }

    const userId = employeeResult.rows[0].user_id;

    // Delete employee (this will cascade to delete user due to foreign key constraint)
    await client.query('DELETE FROM employees WHERE id = $1', [id]);

    // Delete user account if it exists
    if (userId) {
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    }

    await client.query('COMMIT');

    res.json({ message: 'Employee and user account deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Generate Attestation de Travail (ATS) PDF
app.get('/employees/:id/generate-ats', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Query employee data with contract and branch info (including gender)
    const employeeResult = await pool.query(`
      SELECT 
        e.id, e.first_name, e.last_name, e.gender, e.birth_date, e.place_of_birth,
        e.address, e.social_security_number, e.institution,
        b.name as branch_name, b.description as branch_description,
        b.address as branch_address, b.wilaya, b.registration_number,
        p.name as position_name,
        c.start_date as contract_start_date
      FROM employees e
      LEFT JOIN employee_contracts c ON e.id = c.employee_id 
        AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
        AND c.is_active = true
      LEFT JOIN positions p ON c.position_id = p.id
      LEFT JOIN branches b ON e.institution = b.name
      WHERE e.id = $1
      ORDER BY c.start_date DESC
      LIMIT 1
    `, [id]);

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const emp = employeeResult.rows[0];

    // Create PDF with proper margins
    const doc = new PDFDocument({ 
      margin: { top: 60, bottom: 60, left: 50, right: 50 },
      size: 'A4'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=attestation_travail_${id}.pdf`);
    doc.pipe(res);

    // Format dates in DD/MM/YYYY format
    const formatDate = (date) => {
      if (!date) return '';
      const d = new Date(date);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // Set default font
    doc.font('Helvetica');

    // Get page width once (A4 width in points) - used for date and signature positioning
    const pageWidth = doc.page.width || 595.28;

    // Header - Left side: Company info (left-aligned, matching image layout)
    const startY = doc.y;
    const leftMargin = 50;
    
    // Company name in bold, uppercase
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor('black')
       .text((emp.branch_name || 'SARL EL FADILA').toUpperCase(), leftMargin, startY);
    doc.moveDown(0.4);

    // Branch description
    doc.fontSize(12)
       .font('Helvetica')
       .text(emp.branch_description || 'ECOLE PRIVE ENT FOURMATION ET CONSEIL', leftMargin);
    doc.moveDown(0.4);

    // Address lines
    if (emp.branch_address) {
      doc.fontSize(11).text(emp.branch_address, leftMargin);
      doc.moveDown(0.3);
    }
    if (emp.wilaya) {
      doc.fontSize(11).text(emp.wilaya, leftMargin);
      doc.moveDown(0.3);
    }
    
    // Adherent number (no underline)
    if (emp.registration_number) {
      doc.fontSize(11);
      doc.text(`N° Adhérent: ${emp.registration_number}`, leftMargin);
    }
    
    // --- FIX 1: DATE POSITIONING ---
    // Date at top right. 
    // In Image 1, the date is roughly aligned with the bottom of the company header, not the very top.
    const currentDate = formatDate(new Date());
    const wilayaText = (emp.wilaya || 'BOUMEDRES').toUpperCase();
    const fullDateText = `${wilayaText} le ${currentDate}`;
    
    doc.fontSize(11).font('Helvetica');
    
    const dateWidth = doc.widthOfString(fullDateText);
    const dateX = pageWidth - 50 - dateWidth;
    // Let's push the date down slightly so it's not floating too high
    const dateY = startY + 45; 

    doc.text(fullDateText, dateX, dateY);

    // --- CRITICAL FIX 2: RESET CURSOR ---
    // Reset X to left margin so the rest of the document uses the full width
    doc.x = leftMargin; 
    
    // Move down to body content area
    doc.y = startY + 130; 

    // --- FIX 3: MATCHING IMAGE 1 LAYOUT ---

    // Title
    doc.fontSize(18) // Slightly larger to match Image 1
       .font('Helvetica-Bold')
       .text('ATTESTATION DE TRAVAIL', { align: 'center' });
    doc.moveDown(2);

    // Intro Paragraph
    doc.fontSize(11);
    doc.font('Helvetica')
       .text('Nous, Soussignés ', { continued: true })
       .font('Helvetica-Bold')
       .text((emp.branch_name || 'SARL EL FADILA').toUpperCase(), { continued: true })
       .font('Helvetica')
       .text(' sise à ', { continued: true })
       .font('Helvetica-Bold')
       .text(`${emp.branch_address || ''} ${emp.wilaya || ''}`);
    
    doc.moveDown(0.5);

    const genderPrefix = (emp.gender === 'F' || emp.gender === 'Female') ? 'Mlle' : 'M.';
    doc.font('Helvetica')
       .text('attestons que ' + genderPrefix + ':');
    
    doc.moveDown(0.5);

    // --- LEFT-ALIGNED EMPLOYEE DETAILS ---
    
    // Name (Left-aligned, Bold, Uppercase)
    const employeeName = `${(emp.last_name || '').toUpperCase()} ${(emp.first_name || '').toUpperCase()}`;
    doc.x = leftMargin; // Ensure left alignment
    doc.font('Helvetica-Bold')
       .fontSize(11)
       .text(employeeName, { align: 'left' });
    
    doc.moveDown(0.4);

    // Birth Info (Left-aligned)
    let birthText = (emp.gender === 'M' || emp.gender === 'Male') ? 'né' : 'née';
    
    doc.font('Helvetica').fontSize(11);
    doc.text(`${birthText} le `, { align: 'left', continued: true })
       .font('Helvetica-Bold')
       .text(formatDate(emp.birth_date), { continued: true })
       .font('Helvetica')
       .text(' à ', { continued: true })
       .font('Helvetica-Bold')
       .text((emp.place_of_birth || '').toUpperCase());
    
    doc.moveDown(0.4);

    // Address (Left-aligned)
    if (emp.address) {
        doc.font('Helvetica')
           .text('Demeurant à : ', { align: 'left', continued: true })
           .font('Helvetica-Bold')
           .text((emp.address || '').toUpperCase());
        doc.moveDown(0.4);
    }

    // SSN (Left-aligned)
    if (emp.social_security_number) {
        doc.font('Helvetica')
           .text('N° Sécurité sociale : ', { align: 'left', continued: true })
           .font('Helvetica-Bold')
           .text(emp.social_security_number);
        doc.moveDown(0.4);
    }

    doc.moveDown(1);

    // Job Details (Left aligned again)
    // Reset to left margin just in case
    doc.x = leftMargin; 
    
    const positionText = (emp.position_name || '').toUpperCase();
    const startDateText = emp.contract_start_date ? formatDate(emp.contract_start_date) : '';
    
    doc.font('Helvetica')
       .text('Est employé au sein de notre entreprise depuis le ', { continued: true })
       .font('Helvetica-Bold')
       .text(startDateText, { continued: true })
       .font('Helvetica')
       .text(' à ce jour en qualité d\' ', { continued: true })
       .font('Helvetica-Bold')
       .text(positionText);

    doc.moveDown(2);

    // Closing
    doc.fontSize(11).font('Helvetica')
       .text('La présente attestation lui est délivrée pour servir et valoir ce que de droit.');
    
    doc.moveDown(3);

    // Signature (right-aligned, no underline)
    doc.fontSize(11)
       .font('Helvetica')
       .text('Le Directeur', { align: 'right' });

    doc.end();
  } catch (error) {
    console.error('Error generating ATS:', error);
    res.status(500).json({ error: 'Failed to generate ATS' });
  }
});

// Helper function to generate ATS PDF as buffer
async function generateATSPDFBuffer(emp) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: { top: 60, bottom: 60, left: 50, right: 50 },
        size: 'A4'
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Format dates in DD/MM/YYYY format
      const formatDate = (date) => {
        if (!date) return '';
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      };

      // Set default font
      doc.font('Helvetica');

      // Get page width once (A4 width in points)
      const pageWidth = doc.page.width || 595.28;

      // Header - Left side: Company info
      const startY = doc.y;
      const leftMargin = 50;
      
      // Company name in bold, uppercase
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .fillColor('black')
         .text((emp.branch_name || 'SARL EL FADILA').toUpperCase(), leftMargin, startY);
      doc.moveDown(0.4);

      // Branch description
      doc.fontSize(12)
         .font('Helvetica')
         .text(emp.branch_description || 'ECOLE PRIVE ENT FOURMATION ET CONSEIL', leftMargin);
      doc.moveDown(0.4);

      // Address lines
      if (emp.branch_address) {
        doc.fontSize(11).text(emp.branch_address, leftMargin);
        doc.moveDown(0.3);
      }
      if (emp.wilaya) {
        doc.fontSize(11).text(emp.wilaya, leftMargin);
        doc.moveDown(0.3);
      }
      
      // Adherent number
      if (emp.registration_number) {
        doc.fontSize(11);
        doc.text(`N° Adhérent: ${emp.registration_number}`, leftMargin);
      }
      
      // Date at top right
      const currentDate = formatDate(new Date());
      const wilayaText = (emp.wilaya || 'BOUMEDRES').toUpperCase();
      const fullDateText = `${wilayaText} le ${currentDate}`;
      
      doc.fontSize(11).font('Helvetica');
      
      const dateWidth = doc.widthOfString(fullDateText);
      const dateX = pageWidth - 50 - dateWidth;
      const dateY = startY + 45; 

      doc.text(fullDateText, dateX, dateY);

      // Reset cursor
      doc.x = leftMargin; 
      doc.y = startY + 130; 

      // Title
      doc.fontSize(18)
         .font('Helvetica-Bold')
         .text('ATTESTATION DE TRAVAIL', { align: 'center' });
      doc.moveDown(2);

      // Intro Paragraph
      doc.fontSize(11);
      doc.font('Helvetica')
         .text('Nous, Soussignés ', { continued: true })
         .font('Helvetica-Bold')
         .text((emp.branch_name || 'SARL EL FADILA').toUpperCase(), { continued: true })
         .font('Helvetica')
         .text(' sise à ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${emp.branch_address || ''} ${emp.wilaya || ''}`);
      
      doc.moveDown(0.5);

      const genderPrefix = (emp.gender === 'F' || emp.gender === 'Female') ? 'Mlle' : 'M.';
      doc.font('Helvetica')
         .text('attestons que ' + genderPrefix + ':');
      
      doc.moveDown(0.5);

      // Employee Details
      const employeeName = `${(emp.last_name || '').toUpperCase()} ${(emp.first_name || '').toUpperCase()}`;
      doc.x = leftMargin;
      doc.font('Helvetica-Bold')
         .fontSize(11)
         .text(employeeName, { align: 'left' });
      
      doc.moveDown(0.4);

      let birthText = (emp.gender === 'M' || emp.gender === 'Male') ? 'né' : 'née';
      
      doc.font('Helvetica').fontSize(11);
      doc.text(`${birthText} le `, { align: 'left', continued: true })
         .font('Helvetica-Bold')
         .text(formatDate(emp.birth_date), { continued: true })
         .font('Helvetica')
         .text(' à ', { continued: true })
         .font('Helvetica-Bold')
         .text((emp.place_of_birth || '').toUpperCase());
      
      doc.moveDown(0.4);

      if (emp.address) {
          doc.font('Helvetica')
             .text('Demeurant à : ', { align: 'left', continued: true })
             .font('Helvetica-Bold')
             .text((emp.address || '').toUpperCase());
          doc.moveDown(0.4);
      }

      if (emp.social_security_number) {
          doc.font('Helvetica')
             .text('N° Sécurité sociale : ', { align: 'left', continued: true })
             .font('Helvetica-Bold')
             .text(emp.social_security_number);
          doc.moveDown(0.4);
      }

      doc.moveDown(1);

      doc.x = leftMargin; 
      
      const positionText = (emp.position_name || '').toUpperCase();
      const startDateText = emp.contract_start_date ? formatDate(emp.contract_start_date) : '';
      
      doc.font('Helvetica')
         .text('Est employé au sein de notre entreprise depuis le ', { continued: true })
         .font('Helvetica-Bold')
         .text(startDateText, { continued: true })
         .font('Helvetica')
         .text(' à ce jour en qualité d\' ', { continued: true })
         .font('Helvetica-Bold')
         .text(positionText);

      doc.moveDown(2);

      doc.fontSize(11).font('Helvetica')
         .text('La présente attestation lui est délivrée pour servir et valoir ce que de droit.');
      
      doc.moveDown(3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Le Directeur', { align: 'right' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Generate Certificat de Travail PDF
app.get('/employees/:id/generate-certificat', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { contract_id } = req.query; // Optional: specify which contract
    
    // Query employee data with contract and branch info (including gender)
    let query = `
      SELECT 
        e.id, e.first_name, e.last_name, e.gender, e.birth_date, e.place_of_birth,
        e.address, e.social_security_number, e.institution,
        b.name as branch_name, b.description as branch_description,
        b.address as branch_address, b.wilaya, b.registration_number,
        p.name as position_name,
        c.id as contract_id,
        c.start_date as contract_start_date,
        c.end_date as contract_end_date
      FROM employees e
      LEFT JOIN employee_contracts c ON e.id = c.employee_id
      LEFT JOIN positions p ON c.position_id = p.id
      LEFT JOIN branches b ON e.institution = b.name
      WHERE e.id = $1
    `;
    
    const params = [id];
    if (contract_id) {
      query += ' AND c.id = $2';
      params.push(contract_id);
    } else {
      // Get the most recent contract with an end_date (inactive contract)
      query += ' AND c.end_date IS NOT NULL';
    }
    
    query += ' ORDER BY c.end_date DESC, c.start_date DESC LIMIT 1';

    const employeeResult = await pool.query(query, params);

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee or contract not found' });
    }

    const emp = employeeResult.rows[0];

    // Check if contract has end_date (required for certificat)
    if (!emp.contract_end_date) {
      return res.status(400).json({ error: 'Certificat can only be generated for completed contracts' });
    }

    // Create PDF with proper margins
    const doc = new PDFDocument({ 
      margin: { top: 60, bottom: 60, left: 50, right: 50 },
      size: 'A4'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=certificat_travail_${id}.pdf`);
    doc.pipe(res);

    // Format dates in DD/MM/YYYY format
    const formatDate = (date) => {
      if (!date) return '';
      const d = new Date(date);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // Set default font
    doc.font('Helvetica');

    // Get page width once (A4 width in points) - used for date and signature positioning
    const pageWidth = doc.page.width || 595.28;

    // Header - Left side: Company info (left-aligned, matching image layout)
    const startY = doc.y;
    const leftMargin = 50;
    
    // Company name in bold, uppercase
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor('black')
       .text((emp.branch_name || 'SARL EL FADILA').toUpperCase(), leftMargin, startY);
    doc.moveDown(0.4);

    // Branch description
    doc.fontSize(12)
       .font('Helvetica')
       .text(emp.branch_description || 'ECOLE PRIVE ENT FOURMATION ET CONSEIL', leftMargin);
    doc.moveDown(0.4);

    // Address lines
    if (emp.branch_address) {
      doc.fontSize(11).text(emp.branch_address, leftMargin);
      doc.moveDown(0.3);
    }
    if (emp.wilaya) {
      doc.fontSize(11).text(emp.wilaya, leftMargin);
      doc.moveDown(0.3);
    }
    
    // Adherent number (no underline)
    if (emp.registration_number) {
      doc.fontSize(11);
      doc.text(`N° Adhérent: ${emp.registration_number}`, leftMargin);
    }
    
    // --- FIX 1: DATE POSITIONING ---
    // Date at top right. 
    // In Image 1, the date is roughly aligned with the bottom of the company header, not the very top.
    const currentDate = formatDate(new Date());
    const wilayaText = (emp.wilaya || 'BOUMEDRES').toUpperCase();
    const fullDateText = `${wilayaText} le ${currentDate}`;
    
    doc.fontSize(11).font('Helvetica');
    
    const dateWidth = doc.widthOfString(fullDateText);
    const dateX = pageWidth - 50 - dateWidth;
    // Let's push the date down slightly so it's not floating too high
    const dateY = startY + 45; 

    doc.text(fullDateText, dateX, dateY);

    // --- CRITICAL FIX 2: RESET CURSOR ---
    // Reset X to left margin so the rest of the document uses the full width
    doc.x = leftMargin; 
    
    // Move down to body content area
    doc.y = startY + 130; 

    // --- FIX 3: MATCHING IMAGE 1 LAYOUT ---

    // Title
    doc.fontSize(18) // Slightly larger to match Image 1
       .font('Helvetica-Bold')
       .text('CERTIFICAT DE TRAVAIL', { align: 'center' });
    doc.moveDown(2);

    // Intro Paragraph
    doc.fontSize(11);
    doc.font('Helvetica')
       .text('Nous, Soussignés ', { continued: true })
       .font('Helvetica-Bold')
       .text((emp.branch_name || 'SARL EL FADILA').toUpperCase(), { continued: true })
       .font('Helvetica')
       .text(' sise à ', { continued: true })
       .font('Helvetica-Bold')
       .text(`${emp.branch_address || ''} ${emp.wilaya || ''}`);
    
    doc.moveDown(0.5);

    const genderPrefix = (emp.gender === 'F' || emp.gender === 'Female') ? 'Mlle' : 'M.';
    doc.font('Helvetica')
       .text('certifions que ' + genderPrefix + ':');
    
    doc.moveDown(0.5);

    // --- LEFT-ALIGNED EMPLOYEE DETAILS ---
    
    // Name (Left-aligned, Bold, Uppercase)
    const employeeName = `${(emp.last_name || '').toUpperCase()} ${(emp.first_name || '').toUpperCase()}`;
    doc.x = leftMargin; // Ensure left alignment
    doc.font('Helvetica-Bold')
       .fontSize(11)
       .text(employeeName, { align: 'left' });
    
    doc.moveDown(0.4);

    // Birth Info (Left-aligned)
    let birthText = (emp.gender === 'M' || emp.gender === 'Male') ? 'né' : 'née';
    
    doc.font('Helvetica').fontSize(11);
    doc.text(`${birthText} le `, { align: 'left', continued: true })
       .font('Helvetica-Bold')
       .text(formatDate(emp.birth_date), { continued: true })
       .font('Helvetica')
       .text(' à ', { continued: true })
       .font('Helvetica-Bold')
       .text((emp.place_of_birth || '').toUpperCase());
    
    doc.moveDown(0.4);

    // Address (Left-aligned)
    if (emp.address) {
        doc.font('Helvetica')
           .text('Demeurant à : ', { align: 'left', continued: true })
           .font('Helvetica-Bold')
           .text((emp.address || '').toUpperCase());
        doc.moveDown(0.4);
    }

    // SSN (Left-aligned)
    if (emp.social_security_number) {
        doc.font('Helvetica')
           .text('N° Sécurité sociale : ', { align: 'left', continued: true })
           .font('Helvetica-Bold')
           .text(emp.social_security_number);
        doc.moveDown(0.4);
    }

    doc.moveDown(1);

    // Job Details (Left aligned again)
    // Reset to left margin just in case
    doc.x = leftMargin; 
    
    const positionText = (emp.position_name || '').toUpperCase();
    const startDateText = emp.contract_start_date ? formatDate(emp.contract_start_date) : '';
    const endDateText = emp.contract_end_date ? formatDate(emp.contract_end_date) : '';
    
    doc.font('Helvetica')
       .text('A travaillé au sein de notre entreprise du ', { continued: true })
       .font('Helvetica-Bold')
       .text(startDateText, { continued: true })
       .font('Helvetica')
       .text(' au ', { continued: true })
       .font('Helvetica-Bold')
       .text(endDateText, { continued: true })
       .font('Helvetica')
       .text(' en qualité d\' ', { continued: true })
       .font('Helvetica-Bold')
       .text(positionText);

    doc.moveDown(2);

    // Closing
    doc.fontSize(11).font('Helvetica')
       .text('La présente attestation lui est délivrée pour servir et valoir ce que de droit.');
    
    doc.moveDown(3);

    // Signature (right-aligned, no underline)
    doc.fontSize(11)
       .font('Helvetica')
       .text('Le Directeur', { align: 'right' });

    doc.end();
  } catch (error) {
    console.error('Error generating Certificat:', error);
    res.status(500).json({ error: 'Failed to generate Certificat' });
  }
});

// Get dashboard statistics
app.get('/dashboard/stats', verifyToken, async (req, res) => {
  try {
    const stats = {};

    // Total employees
    const employeeCount = await pool.query('SELECT COUNT(*) as count FROM employees');
    stats.totalEmployees = parseInt(employeeCount.rows[0].count);

    // Active employees (those with user accounts)
    const activeEmployees = await pool.query(`
      SELECT COUNT(*) as count 
      FROM employees e 
      INNER JOIN users u ON e.user_id = u.id
    `);
    stats.activeEmployees = parseInt(activeEmployees.rows[0].count);

    // Employees by department
    const departmentStats = await pool.query(`
      SELECT d.name, COUNT(ed.employee_id) as count
      FROM departments d
      LEFT JOIN employee_departments ed ON d.id = ed.department_id
      GROUP BY d.id, d.name
      ORDER BY count DESC
    `);
    stats.departmentBreakdown = departmentStats.rows;

    // Employees by position
    const positionStats = await pool.query(`
      SELECT p.name, COUNT(e.id) as count
      FROM positions p
      LEFT JOIN employees e ON p.id = e.position_id
      GROUP BY p.id, p.name
      ORDER BY count DESC
    `);
    stats.positionBreakdown = positionStats.rows;

    res.json(stats);
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Helper function to generate username from first and last name
function generateUsername(firstName, lastName) {
  if (!firstName || !lastName) return null;
  const first = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const last = lastName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${first}.${last}`;
}

// Helper function to generate a unique username (appends number if duplicate)
async function generateUniqueUsername(baseUsername, client) {
  let username = baseUsername;
  let counter = 1;
  
  while (true) {
    const existingUser = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length === 0) {
      return username; // Username is available
    }
    // Username exists, try with a number appended
    username = `${baseUsername}${counter}`;
    counter++;
    
    // Safety check to prevent infinite loop
    if (counter > 1000) {
      // Fallback: use timestamp
      username = `${baseUsername}${Date.now()}`;
      break;
    }
  }
  
  return username;
}

// Helper function to generate password from first and last name
function generatePassword(firstName, lastName) {
  if (!firstName || !lastName) return 'Password123!';
  const first = firstName.substring(0, 3).toLowerCase();
  const last = lastName.substring(0, 3).toLowerCase();
  const year = new Date().getFullYear();
  return `${first}${last}${year}!`;
}

// Import employees from Excel file
app.post('/employees/import', verifyToken, upload.single('excel_file'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Only HR Manager can import employees
    if (req.user.role !== 'HR_Manager') {
      await client.release();
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!req.file) {
      await client.release();
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let workbook;
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
    } catch (fileError) {
      await client.release();
      console.error('Error reading Excel file:', fileError);
      // Delete uploaded file
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {}
      }
      return res.status(400).json({ error: 'Failed to read Excel file', details: fileError.message });
    }

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      await client.release();
      // Delete uploaded file
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {}
      }
      return res.status(400).json({ error: 'Excel file is empty or invalid' });
    }

    const results = {
      success: [],
      errors: [],
      total: 0
    };

    await client.query('BEGIN');

    // Get all positions and institutions for validation
    const positionsResult = await client.query('SELECT id, name FROM positions');
    const positionsMap = new Map(positionsResult.rows.map(p => [p.name.toLowerCase(), p.id]));

    const branchesResult = await client.query('SELECT name FROM branches');
    const institutionsSet = new Set(branchesResult.rows.map(b => b.name));

    // Parse date helper
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      if (dateStr instanceof Date) return dateStr;
      // Try mm/dd/yyyy format
      const parts = String(dateStr).split('/');
      if (parts.length === 3) {
        const month = parseInt(parts[0]) - 1;
        const day = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        return new Date(year, month, day);
      }
      // Try other formats
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    };

    // Read header row to map columns dynamically by header name
    const headerRow = worksheet.getRow(1);
    const columnMap = {};
    const headerDebug = {};
    
    // First, try to use ExcelJS column keys if available (from template)
    if (worksheet.columns && worksheet.columns.length > 0) {
      worksheet.columns.forEach((col, index) => {
        if (col.key) {
          columnMap[col.key] = index + 1; // ExcelJS uses 1-based indexing
        }
      });
    }
    
    // Also map by header text (in case user edited headers)
    // IMPORTANT: Check more specific headers FIRST before general ones
    headerRow.eachCell((cell, colNumber) => {
      if (cell.value) {
        const header = String(cell.value).trim();
        headerDebug[colNumber] = header;
        const normalizedHeader = header.toLowerCase();
        
        // Remove Arabic text in parentheses for matching
        const headerWithoutArabic = normalizedHeader.replace(/\([^)]*\)/g, '').trim();
        
        // Map headers to field names - check specific patterns FIRST
        // Arabic fields first (more specific)
        if (headerWithoutArabic.includes('arabic first name') || (normalizedHeader.includes('arabic') && normalizedHeader.includes('first name'))) {
          columnMap['foreign_name'] = colNumber;
        } else if (headerWithoutArabic.includes('arabic last name') || (normalizedHeader.includes('arabic') && normalizedHeader.includes('last name'))) {
          columnMap['foreign_last_name'] = colNumber;
        } else if (normalizedHeader.includes('arabic place of birth')) {
          columnMap['arabic_place_of_birth'] = colNumber;
        } else if (normalizedHeader.includes('arabic address')) {
          columnMap['arabic_address'] = colNumber;
        } else if (normalizedHeader.includes('arabic nationality')) {
          columnMap['arabic_nationality'] = colNumber;
        }
        // Regular first/last name (after checking Arabic) - must NOT include arabic
        else if ((normalizedHeader.includes('first name') || headerWithoutArabic.includes('first name')) && !normalizedHeader.includes('arabic')) {
          if (!columnMap['first_name']) columnMap['first_name'] = colNumber;
        } else if ((normalizedHeader.includes('last name') || headerWithoutArabic.includes('last name')) && !normalizedHeader.includes('arabic')) {
          if (!columnMap['last_name']) columnMap['last_name'] = colNumber;
        }
        // Email
        else if (normalizedHeader.includes('email') || headerWithoutArabic.includes('email')) {
          columnMap['email'] = colNumber;
        }
        // Phone
        else if (normalizedHeader.includes('phone') || headerWithoutArabic.includes('phone')) {
          columnMap['phone'] = colNumber;
        }
        // Dates - check specific ones first
        else if (normalizedHeader.includes('birth date') && !normalizedHeader.includes('place') && !normalizedHeader.includes('issue')) {
          columnMap['birth_date'] = colNumber;
        } else if (normalizedHeader.includes('join date')) {
          columnMap['join_date'] = colNumber;
        } else if (normalizedHeader.includes('contract start date')) {
          columnMap['contract_start_date'] = colNumber;
        } else if (normalizedHeader.includes('contract end date')) {
          columnMap['contract_end_date'] = colNumber;
        } else if (normalizedHeader.includes('id issue date')) {
          columnMap['id_issue_date'] = colNumber;
        } else if (normalizedHeader.includes('salary effective date') || (normalizedHeader.includes('effective date') && normalizedHeader.includes('salary'))) {
          columnMap['effective_date'] = colNumber;
        }
        // Other fields
        else if (normalizedHeader.includes('place of birth') && !normalizedHeader.includes('arabic')) {
          columnMap['place_of_birth'] = colNumber;
        } else if (normalizedHeader.includes('social security')) {
          columnMap['social_security_number'] = colNumber;
        } else if (normalizedHeader.includes('contract salary')) {
          columnMap['contract_salary'] = colNumber;
        } else if (normalizedHeader.includes('probation months')) {
          columnMap['probation_months'] = colNumber;
        } else if (normalizedHeader.includes('education level') || header.includes('المستوى التعليمي')) {
          columnMap['education_level'] = colNumber;
        } else if ((normalizedHeader.includes('address') || headerWithoutArabic.includes('address')) && !normalizedHeader.includes('arabic')) {
          // Match "Address (French)" or just "Address" but not "Arabic Address"
          // Note: "Address (French)" should match - we allow "french" in the header
          if (!columnMap['address']) columnMap['address'] = colNumber;
        } else if (normalizedHeader.includes('id card number')) {
          columnMap['id_card_number'] = colNumber;
        } else if (normalizedHeader.includes('id issue authority')) {
          columnMap['id_issue_authority'] = colNumber;
        } else if (normalizedHeader.includes('basic salary') || normalizedHeader.includes('base salary')) {
          columnMap['base_salary'] = colNumber;
        } else if (normalizedHeader.includes('regular hour price')) {
          columnMap['hourly_rate'] = colNumber;
        } else if (normalizedHeader.includes('overtime hour price')) {
          columnMap['overtime_rate'] = colNumber;
        }
      }
    });
    
    // Log column mapping for debugging with actual headers
    console.log('📋 [Import] Headers found:', headerDebug);
    console.log('📋 [Import] Column mapping:', columnMap);
    
    // Validate that required columns are found
    const requiredColumns = ['first_name', 'last_name', 'email'];
    const missingColumns = requiredColumns.filter(col => !columnMap[col]);
    if (missingColumns.length > 0) {
      await client.query('ROLLBACK');
      await client.release();
      if (req.file && req.file.path) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(400).json({ 
        error: 'Invalid Excel template', 
        details: `Missing required columns: ${missingColumns.join(', ')}` 
      });
    }

    // Process each row (skip header) - convert to array first for async processing
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      rows.push({ row, rowNumber });
    });

    // Process rows sequentially
    for (const { row, rowNumber } of rows) {
      results.total++;

      try {
        // Get cell value by field name (using column map)
        const getCellValue = (fieldName) => {
          const colNumber = columnMap[fieldName];
          if (!colNumber) return null;
          const cell = row.getCell(colNumber);
          if (!cell || cell.value === null || cell.value === undefined) return '';
          const value = cell.value;
          // Handle numeric values directly
          if (typeof value === 'number') return String(value);
          return String(value).trim();
        };
        
        // Helper to parse numeric values from Excel
        const parseNumeric = (value) => {
          if (!value || value === '') return null;
          const num = parseFloat(value);
          return isNaN(num) ? null : num;
        };
        
        // Debug: Log raw cell values for first row to verify mapping
        if (rowNumber === 2) {
          const addressValue = getCellValue('address');
          const addressColNum = columnMap['address'];
          console.log(`🔍 [Import Row ${rowNumber}] Address field debug:`, {
            address_column_mapped: addressColNum,
            address_value: addressValue,
            address_value_length: addressValue ? addressValue.length : 0
          });
        }
        
        // Debug: Log raw cell values for compensation columns
        const baseSalaryRaw = getCellValue('base_salary');
        const hourlyRateRaw = getCellValue('hourly_rate');
        const overtimeRateRaw = getCellValue('overtime_rate');
        if (rowNumber === 2) {
          console.log(`📊 [Import Row ${rowNumber}] Compensation raw values:`, {
            base_salary_raw: baseSalaryRaw,
            hourly_rate_raw: hourlyRateRaw,
            overtime_rate_raw: overtimeRateRaw
          });
        }
        
        const data = {
          first_name: getCellValue('first_name'),
          last_name: getCellValue('last_name'),
          foreign_name: getCellValue('foreign_name') || null,
          foreign_last_name: getCellValue('foreign_last_name') || null,
          email: getCellValue('email'),
          phone: getCellValue('phone') || null,
          birth_date: parseDate(getCellValue('birth_date')),
          place_of_birth: getCellValue('place_of_birth') || null,
          social_security_number: getCellValue('social_security_number') || null,
          join_date: parseDate(getCellValue('join_date')),
          contract_start_date: parseDate(getCellValue('contract_start_date')),
          contract_end_date: parseDate(getCellValue('contract_end_date')),
          contract_salary: parseNumeric(getCellValue('contract_salary')),
          probation_months: parseInt(getCellValue('probation_months')) || 0,
          education_level: getCellValue('education_level') || null,
          address: getCellValue('address') || null,
          // Identity fields
          id_card_number: getCellValue('id_card_number') || null,
          id_issue_date: parseDate(getCellValue('id_issue_date')),
          id_issue_authority: getCellValue('id_issue_authority') || null,
          arabic_place_of_birth: getCellValue('arabic_place_of_birth') || null,
          arabic_address: getCellValue('arabic_address') || null,
          arabic_nationality: getCellValue('arabic_nationality') || 'جزائرية',
          // Compensation fields
          base_salary: parseNumeric(getCellValue('base_salary')),
          hourly_rate: parseNumeric(getCellValue('hourly_rate')),
          overtime_rate: parseNumeric(getCellValue('overtime_rate')),
          effective_date: parseDate(getCellValue('effective_date')),
          // Dropdown fields - set to null/default, must be edited manually
          gender: null,
          institution: null,
          position_name: null,
          role: 'Employee' // Default role
        };

        // Validate required fields
        if (!data.first_name || !data.last_name || !data.email) {
          results.errors.push({ row: rowNumber, error: 'Missing required fields (first_name, last_name, email)' });
          continue;
        }

        // Generate username and password
        const username = generateUsername(data.first_name, data.last_name);
        const password = generatePassword(data.first_name, data.last_name);

        // Check if username already exists
        const existingUser = await client.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
          results.errors.push({ row: rowNumber, error: `Username ${username} already exists` });
          continue;
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user account (role defaults to 'Employee', must be edited manually)
        const userResult = await client.query(
          'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
          [username, passwordHash, data.role]
        );

        const userId = userResult.rows[0].id;

        // Position and Institution are excluded from import - set to null
        // These must be set manually after import to avoid mismatches
        let positionId = null;

        // Truncate long values to prevent VARCHAR overflow errors
        const truncateString = (str, maxLength) => {
          if (!str) return null;
          const s = String(str).trim();
          return s.length > maxLength ? s.substring(0, maxLength) : s;
        };

        // Validate and truncate fields that might be too long
        const safeEducationLevel = data.education_level ? truncateString(data.education_level, 50) : null;
        const safePlaceOfBirth = data.place_of_birth ? truncateString(data.place_of_birth, 255) : null;
        const safeSocialSecurity = data.social_security_number ? truncateString(data.social_security_number, 50) : null;
        const safeAddress = data.address ? truncateString(data.address, 500) : null;
        const safeFirstName = truncateString(data.first_name, 100);
        const safeLastName = truncateString(data.last_name, 100);
        const safeForeignName = data.foreign_name ? truncateString(data.foreign_name, 100) : null;
        const safeForeignLastName = data.foreign_last_name ? truncateString(data.foreign_last_name, 100) : null;
        const safePhone = data.phone ? truncateString(data.phone, 20) : null;
        const safeEmail = truncateString(data.email, 255);

        // Create employee record (dropdown fields set to null - must be edited manually)
        let employeeId;
        try {
          const employeeResult = await client.query(`
            INSERT INTO employees (
              user_id, position_id, institution, first_name, last_name,
              foreign_name, foreign_last_name, gender, birth_date, phone,
              email, address, join_date, education_level,
              place_of_birth, social_security_number
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id
          `, [
            userId, positionId, data.institution, safeFirstName, safeLastName,
            safeForeignName, safeForeignLastName, data.gender, data.birth_date, safePhone,
            safeEmail, safeAddress, data.join_date, safeEducationLevel,
            safePlaceOfBirth, safeSocialSecurity
          ]);
          employeeId = employeeResult.rows[0].id;
        } catch (dbError) {
          console.error(`❌ [Import Row ${rowNumber}] Employee insert failed:`, {
            error: dbError.message,
            code: dbError.code,
            detail: dbError.detail,
            hint: dbError.hint,
            data_lengths: {
              first_name: safeFirstName?.length,
              last_name: safeLastName?.length,
              email: safeEmail?.length,
              education_level: safeEducationLevel?.length,
              place_of_birth: safePlaceOfBirth?.length,
              social_security_number: safeSocialSecurity?.length,
              address: safeAddress?.length,
              phone: safePhone?.length
            }
          });
          throw dbError; // Re-throw to be caught by outer try-catch
        }

        // Create contract if contract_start_date is provided
        // Note: position_id is null - must be set manually after import
        if (data.contract_start_date) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const endDateObj = data.contract_end_date ? new Date(data.contract_end_date) : null;
          const isActive = !data.contract_end_date || (endDateObj && endDateObj >= today);

          // Generate contract number
          const contractNumberResult = await client.query(
            'SELECT generate_contract_number($1) as contract_number',
            [data.contract_start_date]
          );
          const contractNumber = contractNumberResult.rows[0].contract_number;

          await client.query(`
            INSERT INTO employee_contracts (
              employee_id, position_id, start_date, end_date, is_active,
              contract_number, contract_salary, probation_months
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            employeeId, positionId, data.contract_start_date, data.contract_end_date, isActive,
            contractNumber, data.contract_salary, data.probation_months
          ]);
        }
        
        // Create identity record if ID card info is provided
        if (data.id_card_number && data.id_issue_date && data.id_issue_authority) {
          try {
            // Truncate identity fields to prevent overflow
            const safeIdCardNumber = truncateString(data.id_card_number, 100);
            const safeIssueAuthority = truncateString(data.id_issue_authority, 255);
            const safeArabicPlaceOfBirth = data.arabic_place_of_birth ? truncateString(data.arabic_place_of_birth, 255) : null;
            const safeArabicNationality = data.arabic_nationality ? truncateString(data.arabic_nationality, 100) : 'جزائرية';
            
            await client.query(`
              INSERT INTO employee_identities (
                employee_id, id_card_number, id_issue_date, id_issue_authority,
                arabic_place_of_birth, arabic_address, arabic_nationality
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
              employeeId,
              safeIdCardNumber,
              data.id_issue_date,
              safeIssueAuthority,
              safeArabicPlaceOfBirth,
              data.arabic_address || null, // TEXT field, no truncation needed
              safeArabicNationality
            ]);
          } catch (identityError) {
            console.error(`❌ [Import] Failed to create identity for employee ${employeeId}:`, identityError.message);
            console.error(`❌ [Import] Identity data that failed:`, {
              id_card_number: data.id_card_number?.length,
              id_issue_authority: data.id_issue_authority?.length,
              arabic_place_of_birth: data.arabic_place_of_birth?.length,
              arabic_nationality: data.arabic_nationality?.length
            });
            // Continue even if identity creation fails
          }
        }

        // Create employee compensation record if salary data is provided
        // Check if any compensation value is provided (including 0, but not null/undefined)
        const hasCompensation = (data.base_salary !== null && data.base_salary !== undefined) ||
                                (data.hourly_rate !== null && data.hourly_rate !== undefined) ||
                                (data.overtime_rate !== null && data.overtime_rate !== undefined);
        
        if (hasCompensation) {
          try {
            const compResult = await client.query(`
              INSERT INTO employee_compensations (
                employee_id, base_salary, hourly_rate, overtime_rate, effective_date
              ) VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE))
              RETURNING id
            `, [
              employeeId,
              data.base_salary || null,
              data.hourly_rate || null,
              data.overtime_rate || null,
              data.salary_effective_date || data.contract_start_date || new Date()
            ]);
            console.log(`✅ [Import] Created compensation for employee ${employeeId}:`, {
              base_salary: data.base_salary,
              hourly_rate: data.hourly_rate,
              overtime_rate: data.overtime_rate,
              effective_date: data.salary_effective_date || data.contract_start_date
            });
          } catch (compError) {
            console.error(`❌ [Import] Failed to create compensation for employee ${employeeId}:`, compError.message);
            console.error('Compensation data:', {
              base_salary: data.base_salary,
              hourly_rate: data.hourly_rate,
              overtime_rate: data.overtime_rate,
              effective_date: data.salary_effective_date || data.contract_start_date
            });
            // Continue even if compensation creation fails
          }
        } else {
          console.log(`ℹ️ [Import] No compensation data for employee ${employeeId} (row ${rowNumber})`);
        }

        results.success.push({
          row: rowNumber,
          employee: `${data.first_name} ${data.last_name}`,
          username: username,
          password: password
        });

      } catch (error) {
        console.error(`Error processing row ${rowNumber}:`, error);
        results.errors.push({ row: rowNumber, error: error.message });
      }
    }

    await client.query('COMMIT');

    // Delete uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      message: `Import completed: ${results.success.length} successful, ${results.errors.length} errors. Note: Dropdown fields (Role, Gender, Position, Institution) must be set manually after import.`,
      results: results
    });

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error rolling back transaction:', rollbackError);
    }
    console.error('Error importing employees:', error);
    console.error('Error stack:', error.stack);
    
    // Delete uploaded file if exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.error('Error deleting uploaded file:', e);
      }
    }
    
    // Ensure response hasn't been sent
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to import employees', details: error.message });
    } else {
      console.error('Response already sent, cannot send error response');
    }
  } finally {
    if (client) {
      await client.release();
    }
  }
});

// Start server
// ============================================================================
// CONTRACT MANAGEMENT ENDPOINTS
// ============================================================================

// Get all contracts with filters
app.get('/contracts', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { employee_name, year, status, employee_id, branch } = req.query;
    let query = `
      SELECT 
        c.id, c.contract_number, c.start_date, c.end_date, c.is_active,
        c.contract_salary, c.probation_months, c.duration_months, c.document_path,
        c.created_at, c.updated_at,
        e.id as employee_id, e.first_name, e.last_name, e.foreign_name, e.foreign_last_name,
        e.institution as branch_name,
        p.name as position_name, p.id as position_id
      FROM employee_contracts c
      INNER JOIN employees e ON c.employee_id = e.id
      LEFT JOIN positions p ON c.position_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (employee_id) {
      query += ` AND e.id = $${paramCount}`;
      params.push(employee_id);
      paramCount++;
    }

    if (branch) {
      query += ` AND TRIM(LOWER(COALESCE(e.institution, ''))) = TRIM(LOWER($${paramCount}))`;
      params.push(branch);
      paramCount++;
    }

    if (employee_name) {
      query += ` AND (e.first_name ILIKE $${paramCount} OR e.last_name ILIKE $${paramCount} OR e.foreign_name ILIKE $${paramCount} OR e.foreign_last_name ILIKE $${paramCount})`;
      params.push(`%${employee_name}%`);
      paramCount++;
    }

    if (year) {
      query += ` AND EXTRACT(YEAR FROM c.start_date) = $${paramCount}`;
      params.push(parseInt(year));
      paramCount++;
    }

    if (status === 'active') {
      query += ` AND c.is_active = true AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)`;
    } else if (status === 'expired') {
      query += ` AND (c.is_active = false OR (c.end_date IS NOT NULL AND c.end_date < CURRENT_DATE))`;
    }

    query += ` ORDER BY c.start_date DESC, c.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching contracts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get distinct branch/institution names for contract filter (from all employees)
app.get('/contracts/branches', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await pool.query(`
      SELECT DISTINCT TRIM(e.institution) AS name
      FROM employees e
      WHERE e.institution IS NOT NULL AND TRIM(e.institution) != ''
      ORDER BY name
    `);
    const branches = (result.rows || []).map(r => ({ name: r.name || '', id: r.name || '' })).filter(b => b.name);
    res.json(branches);
  } catch (error) {
    console.error('Error fetching contract branches:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download the contract template (same one used for generation: converted sample or default)
app.get('/contracts/download-template', verifyToken, (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const templatesDir = path.join(__dirname, 'contract-templates');
    const templatePath = path.join(templatesDir, 'template.docx');
    const samplePaths = [
      path.join(templatesDir, 'حليمي اسلام.docx'),
      path.join(templatesDir, 'عمي لينة.docx'),
      path.join(__dirname, '..', 'حليمي اسلام.docx'),
      path.join(__dirname, '..', 'عمي لينة.docx')
    ];
    let buf;
    if (fs.existsSync(templatePath)) {
      buf = fs.readFileSync(templatePath);
    } else {
      let samplePath = null;
      for (const p of samplePaths) {
        if (fs.existsSync(p)) { samplePath = p; break; }
      }
      if (samplePath) {
        buf = convertSampleToTemplate(fs.readFileSync(samplePath));
      } else {
        buf = createDefaultContractTemplateBuffer();
      }
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="contract-template.docx"');
    res.send(buf);
  } catch (error) {
    console.error('Error serving contract template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contract by ID
app.get('/contracts/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const result = await pool.query(`
      SELECT 
        c.*,
        e.id as employee_id, e.first_name, e.last_name, e.foreign_name, e.foreign_last_name,
        e.birth_date, e.email, e.phone,
        p.name as position_name, p.id as position_id,
        ei.id_card_number, ei.id_issue_date, ei.id_issue_authority,
        ei.arabic_place_of_birth, ei.arabic_address, ei.arabic_nationality
      FROM employee_contracts c
      INNER JOIN employees e ON c.employee_id = e.id
      LEFT JOIN positions p ON c.position_id = p.id
      LEFT JOIN employee_identities ei ON e.id = ei.employee_id
      WHERE c.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching contract:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contract history for an employee
app.get('/employees/:id/contracts', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const result = await pool.query(`
      SELECT 
        c.*,
        p.name as position_name
      FROM employee_contracts c
      LEFT JOIN positions p ON c.position_id = p.id
      WHERE c.employee_id = $1
      ORDER BY c.start_date DESC, c.created_at DESC
    `, [id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching contract history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new contract
app.post('/contracts', verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { employee_id, position_id, start_date, end_date, contract_salary, probation_months } = req.body;

    if (!employee_id || !start_date) {
      return res.status(400).json({ error: 'Employee ID and start date are required' });
    }

    await client.query('BEGIN');

    // Generate contract number
    const contractNumberResult = await client.query(
      'SELECT generate_contract_number($1) as contract_number',
      [start_date]
    );
    const contractNumber = contractNumberResult.rows[0].contract_number;

    // Determine if contract is active
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDateObj = end_date ? new Date(end_date) : null;
    const isActive = !end_date || (endDateObj && endDateObj >= today);

    const result = await client.query(`
      INSERT INTO employee_contracts (
        employee_id, position_id, start_date, end_date, is_active,
        contract_number, contract_salary, probation_months
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      employee_id,
      position_id || null,
      start_date,
      end_date || null,
      isActive,
      contractNumber,
      contract_salary ? parseFloat(contract_salary) : null,
      probation_months ? parseInt(probation_months) : 0
    ]);

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating contract:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update contract
app.put('/contracts/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { position_id, start_date, end_date, contract_salary, probation_months } = req.body;

    // Determine if contract is active
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDateObj = end_date ? new Date(end_date) : null;
    const isActive = !end_date || (endDateObj && endDateObj >= today);

    const result = await pool.query(`
      UPDATE employee_contracts
      SET position_id = COALESCE($1, position_id),
          start_date = COALESCE($2, start_date),
          end_date = $3,
          is_active = $4,
          contract_salary = COALESCE($5, contract_salary),
          probation_months = COALESCE($6, probation_months),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `, [
      position_id || null,
      start_date || null,
      end_date || null,
      isActive,
      contract_salary ? parseFloat(contract_salary) : null,
      probation_months ? parseInt(probation_months) : null,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating contract:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Renew contracts (bulk renewal)
app.post('/contracts/renew', verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { employee_ids, start_date, end_date, contract_salary, probation_months, position_id } = req.body;

    if (!employee_ids || !Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ error: 'Employee IDs array is required' });
    }

    if (!start_date) {
      return res.status(400).json({ error: 'Start date is required' });
    }

    await client.query('BEGIN');

    const results = [];
    const errors = [];

    for (const employeeId of employee_ids) {
      try {
        // Deactivate old contract
        await client.query(`
          UPDATE employee_contracts
          SET is_active = false, updated_at = CURRENT_TIMESTAMP
          WHERE employee_id = $1 AND is_active = true
        `, [employeeId]);

        // Generate contract number
        const contractNumberResult = await client.query(
          'SELECT generate_contract_number($1) as contract_number',
          [start_date]
        );
        const contractNumber = contractNumberResult.rows[0].contract_number;

        // Determine if contract is active
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDateObj = end_date ? new Date(end_date) : null;
        const isActive = !end_date || (endDateObj && endDateObj >= today);

        // Create new contract
        const contractResult = await client.query(`
          INSERT INTO employee_contracts (
            employee_id, position_id, start_date, end_date, is_active,
            contract_number, contract_salary, probation_months
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          employeeId,
          position_id || null,
          start_date,
          end_date || null,
          isActive,
          contractNumber,
          contract_salary ? parseFloat(contract_salary) : null,
          probation_months ? parseInt(probation_months) : 0
        ]);

        results.push(contractResult.rows[0]);
      } catch (error) {
        errors.push({ employee_id: employeeId, error: error.message });
      }
    }

    await client.query('COMMIT');

    res.json({
      message: `Renewed ${results.length} contract(s)`,
      success: results,
      errors: errors
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error renewing contracts:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete contract
app.delete('/contracts/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const result = await pool.query('DELETE FROM employee_contracts WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    res.json({ message: 'Contract deleted successfully' });
  } catch (error) {
    console.error('Error deleting contract:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate contract document from Word template
app.get('/contracts/:id/generate-document', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    
    // Get contract with all related data (employee, position, identity for document)
    const contractResult = await pool.query(`
      SELECT 
        c.*,
        e.id as employee_id, e.first_name, e.last_name, e.foreign_name, e.foreign_last_name,
        e.gender, e.birth_date, e.email, e.phone, e.address, e.place_of_birth,
        p.name as position_name, p.id as position_id,
        ei.id_card_number, ei.id_issue_date, ei.id_issue_authority,
        ei.arabic_place_of_birth, ei.arabic_address, ei.arabic_nationality
      FROM employee_contracts c
      INNER JOIN employees e ON c.employee_id = e.id
      LEFT JOIN positions p ON c.position_id = p.id
      LEFT JOIN employee_identities ei ON e.id = ei.employee_id
      WHERE c.id = $1
    `, [id]);

    if (contractResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const contract = contractResult.rows[0];
    
    // Determine gender for template (use Arabic forms)
    const isFemale = contract.gender === 'Female';
    const workerLabel = isFemale ? 'العاملة' : 'العامل';
    const bornLabel = isFemale ? 'المولودة' : 'المولود';
    const residentLabel = isFemale ? 'الساكنة' : 'الساكن';
    
    // Format dates in Arabic format (DD/MM/YYYY)
    const formatArabicDate = (dateStr) => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // Convert duration months to Arabic text
    const convertMonthsToArabic = (months) => {
      if (!months) return '';
      // Simple conversion - can be enhanced
      return `${months} شهر`;
    };

    // Prepare template data - replaces {placeholder} or {{placeholder}} in Word with real employee/contract data
    const fullName = `${(contract.foreign_name || contract.first_name || '').trim()} ${(contract.foreign_last_name || contract.last_name || '').trim()}`.trim();
    const birthPlace = contract.arabic_place_of_birth || contract.place_of_birth || '';
    const address = contract.arabic_address || contract.address || '';
    const salaryStr = contract.contract_salary ? String(contract.contract_salary.toLocaleString('ar-DZ')) : '';
    const durationStr = convertMonthsToArabic(contract.duration_months);
    const contractNum = contract.contract_number || '';
    const idCard = contract.id_card_number || '';
    const nationality = contract.arabic_nationality || 'جزائرية';
    const issueDate = formatArabicDate(contract.id_issue_date);
    const issueAuthority = contract.id_issue_authority || '';
    const birthDateStr = formatArabicDate(contract.birth_date);
    const startDateStr = formatArabicDate(contract.start_date);
    const endDateStr = formatArabicDate(contract.end_date);
    const probationMonths = contract.probation_months != null ? parseInt(contract.probation_months, 10) : 0;
    const probationStr = probationMonths > 0 ? convertMonthsToArabic(probationMonths) : (contract.probation_months === 0 ? '0' : '');

    // All possible placeholder keys (so both {x} and {{x}} and variants get replaced)
    const templateData = {
      'العامل (ة)': fullName,
      'المولود (ة)': birthDateStr,
      'بـ (Birth Place)': birthPlace,
      'جنسية': nationality,
      'الساكن (ة) بـ': address,
      'رقم بطاقة التعريف': idCard,
      'الصادرة في': issueDate,
      'عن': issueAuthority,
      'مدة محددة بـ': durationStr,
      'الراتب الشهري': salaryStr,
      'الرقم': contractNum,
      'Full_Name': fullName,
      'Full Name': fullName,
      'FullName': fullName,
      'ID_No': idCard,
      'ID No': idCard,
      'IDNo': idCard,
      'Duration': durationStr,
      'Probation_Months': probationStr,
      'Probation Months': probationStr,
      'Trial_Duration': probationStr,
      'Trial Duration': probationStr,
      'مدة التجربة': probationStr,
      'Salary': salaryStr,
      'Contract_Number': contractNum,
      'Contract Number': contractNum,
      'ContractNumber': contractNum,
      'Birth_Date': birthDateStr,
      'Birth Date': birthDateStr,
      'Birth_Place': birthPlace,
      'Birth Place': birthPlace,
      'Nationality': nationality,
      'Address': address,
      'Issue_Date': issueDate,
      'Issue Date': issueDate,
      'Issue_Authority': issueAuthority,
      'Issue Authority': issueAuthority,
      'Worker_Label': workerLabel,
      'Worker Label': workerLabel,
      'Born_Label': bornLabel,
      'Born Label': bornLabel,
      'Resident_Label': residentLabel,
      'Resident Label': residentLabel,
      'Position': contract.position_name || '',
      'Start_Date': startDateStr,
      'Start Date': startDateStr,
      'End_Date': endDateStr,
      'End Date': endDateStr
    };

    // Use the user's two templates: no-trial vs with-trial, based on contract probation_months.
    const templatesDir = path.join(__dirname, 'contract-templates');
    const projectRoot = path.join(__dirname, '..');
    const noTrialPaths = [
      path.join(projectRoot, 'contrat_template.docx'),
      path.join(templatesDir, 'contrat_template.docx')
    ];
    const withTrialPaths = [
      path.join(projectRoot, 'contrat_with_trial_template.docx'),
      path.join(templatesDir, 'contrat_with_trial_template.docx')
    ];

    const useNoTrial = probationMonths === 0 || contract.probation_months == null;
    const chosenPaths = useNoTrial ? noTrialPaths : withTrialPaths;
    let templateFile;
    let foundTemplatePath = null;

    for (const p of chosenPaths) {
      if (fs.existsSync(p)) {
        templateFile = fs.readFileSync(p, 'binary');
        foundTemplatePath = p;
        console.log(`✅ Using ${useNoTrial ? 'no-trial' : 'with-trial'} template: ${foundTemplatePath}`);
        break;
      }
    }

    if (!templateFile) {
      const fallbackPaths = useNoTrial ? withTrialPaths : noTrialPaths;
      for (const p of fallbackPaths) {
        if (fs.existsSync(p)) {
          templateFile = fs.readFileSync(p, 'binary');
          foundTemplatePath = p;
          console.log(`✅ Chosen template not found; using fallback: ${foundTemplatePath}`);
          break;
        }
      }
    }

    if (!templateFile) {
      return res.status(404).json({
        error: 'Contract template not found.',
        detail: useNoTrial
          ? 'Place contrat_template.docx (no trial) in project root or user-management-service/contract-templates/'
          : 'Place contrat_with_trial_template.docx (with trial) in project root or user-management-service/contract-templates/',
        searched_no_trial: noTrialPaths,
        searched_with_trial: withTrialPaths
      });
    }

    console.log(`📄 Generating contract document for: ${fullName} (contract ${contractNum})`);

    // Process template: two-pass so both {{placeholder}} and {placeholder} get replaced
    const opts = { paragraphLoop: true, linebreaks: true };
    let zip = new PizZip(templateFile);

    try {
      // Pass 1: replace {{ ... }} placeholders
      const doc1 = new Docxtemplater(zip, { ...opts, delimiters: { start: '{{', end: '}}' } });
      doc1.setData(templateData);
      doc1.render();
      zip = doc1.getZip();

      // Pass 2: replace { ... } placeholders (default delimiter)
      const doc2 = new Docxtemplater(zip, opts);
      doc2.setData(templateData);
      doc2.render();
      zip = doc2.getZip();
    } catch (error) {
      console.error('Template rendering error:', error);
      return res.status(500).json({ error: 'Error rendering template', details: error.message });
    }

    // Fallback: if template has no placeholders, replace sample names literally in document XML
    const xmlFiles = ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/header3.xml', 'word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml'];
    xmlFiles.forEach((fileName) => {
      const f = zip.file(fileName);
      if (f) {
        let xml = f.asText();
        const literalReplacements = [
          ['حليمي اسلام', fullName],
          ['إسلام حليمي', fullName],
          ['عمي لينة', fullName],
          ['لينة عمي', fullName]
        ];
        literalReplacements.forEach(([from, to]) => {
          if (from && to && xml.indexOf(from) !== -1) xml = xml.split(from).join(to);
        });
        zip.file(fileName, xml);
      }
    });

    // Generate output buffer (this is the actual contract with employee data)
    const buf = zip.generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    // Save document path to contract
    const documentsDir = path.join(__dirname, 'contracts');
    if (!fs.existsSync(documentsDir)) {
      fs.mkdirSync(documentsDir, { recursive: true });
    }

    const safeName = fullName.replace(/[\s\/\\:*?"<>|]/g, '_').replace(/_+/g, '_') || 'contract';
    const contractNumForFile = (contract.contract_number || contract.id || '').toString().replace(/[\s\/\\:*?"<>|]/g, '_');
    const fileName = `${safeName}_${contractNumForFile}.docx`;
    const filePath = path.join(documentsDir, fileName);
    fs.writeFileSync(filePath, buf);

    // Update contract with document path
    await pool.query(
      'UPDATE employee_contracts SET document_path = $1 WHERE id = $2',
      [filePath, id]
    );

    // Send file to client
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buf);
  } catch (error) {
    console.error('Error generating contract document:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`User Management Service running on port ${PORT}`);
});

module.exports = app;

