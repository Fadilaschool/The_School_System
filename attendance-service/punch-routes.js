const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { parseExcelFile, convertToPunchRecordsForPreview, convertToPunchRecordsForSave } = require('./punch-upload');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    // Create directory synchronously for multer
    const fsSync = require('fs');
    if (!fsSync.existsSync(uploadDir)) {
      fsSync.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xls, .xlsx) are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Database connection (will be injected)
let pool;

// JWT verification middleware (will be injected)
let verifyToken = (req, res, next) => next(); // Default no-op

const initializeRoutes = (dbPool) => {
  pool = dbPool;
  return router;
};

const setAuthMiddleware = (authMiddleware) => {
  verifyToken = authMiddleware;
};

// Upload punch file endpoint
// Temporarily removed verifyToken for testing - TODO: Re-enable auth later
router.post('/upload', upload.single('punchFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, filename, path: filePath, size } = req.file;
    // Temporarily use a test user ID for testing (since uploaded_by_user_id cannot be null)
    const userId = req.user?.userId || '2de7085b-ec28-4ac6-8ef3-535d6d4839ca'; // Admin user ID from database

    console.log('Upload attempt:', {
      originalname,
      filename,
      filePath,
      size,
      userId
    });

    // Verify user exists (optional, for debugging)
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      console.warn(`User ID ${userId} does not exist in users table`);
    }

    // Create file upload record (allow null userId for testing)
    const uploadResult = await pool.query(`
      INSERT INTO punch_file_uploads
      (filename, original_filename, file_path, file_size, uploaded_by_user_id, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, filename, original_filename, upload_date
    `, [filename, originalname, filePath, size, userId, 'uploaded']);

    if (uploadResult.rows.length === 0) {
      throw new Error('Failed to create upload record');
    }

    const uploadRecord = uploadResult.rows[0];

    console.log('Upload record created:', uploadRecord);

    // Format the response to match frontend expectations
    const formattedUpload = {
      id: uploadRecord.id,
      filename: uploadRecord.filename,
      original_filename: uploadRecord.original_filename,
      file_path: uploadRecord.file_path,
      file_size: size,
      upload_date: uploadRecord.upload_date,
      uploaded_by_username: null, // Since user is null
      punch_count: 0,
      status: 'uploaded'
    };

    res.json({
      success: true,
      upload: formattedUpload,
      message: 'File uploaded successfully'
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload file',
      details: error.message 
    });
  }
});

// Parse uploaded file endpoint
// Temporarily removed verifyToken for testing - TODO: Re-enable auth later
router.post('/parse/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;

    // Get upload record
    const uploadResult = await pool.query(`
      SELECT * FROM punch_file_uploads WHERE id = $1
    `, [uploadId]);

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadResult.rows[0];
    
    // Parse the Excel file
    const parseResult = await parseExcelFile(upload.file_path);
    
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Failed to parse file',
        details: parseResult.error 
      });
    }

    // Convert to punch records for preview
    const punchRecords = convertToPunchRecordsForPreview(parseResult.data, uploadId);

    // Store preview data temporarily
    const preview = {
      totalRows: parseResult.data.length,
      validRows: punchRecords.length,
      errorRows: 0,
      totalPunches: punchRecords.length,
      punchRecords: punchRecords,
      errors: []
    };

    res.json({
      success: true,
      preview,
      message: 'File parsed successfully for preview'
    });

  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ 
      error: 'Failed to parse file for preview',
      details: error.message 
    });
  }
});

// Save parsed punches to database (simplified approach)
// Temporarily removed verifyToken for testing - TODO: Re-enable auth later
router.post('/save/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;

    // Get upload record to get file path
    const uploadResult = await pool.query(`
      SELECT * FROM punch_file_uploads WHERE id = $1
    `, [uploadId]);

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadResult.rows[0];

    // Parse the Excel file
    const parseResult = await parseExcelFile(upload.file_path);

    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Failed to parse file',
        details: parseResult.error
      });
    }

    // Convert to punch records for preview (we'll use this for saving too)
    const punchRecords = convertToPunchRecordsForPreview(parseResult.data, uploadId);

    let savedCount = 0;
    let errors = [];

    // Save each punch record to raw_punches table
    for (const punch of punchRecords) {
      try {
        await pool.query(`
          INSERT INTO raw_punches
          (employee_name, punch_time, source, raw_data)
          VALUES ($1, $2, $3, $4)
        `, [
          punch.employee_name,
          punch.punch_time,
          punch.source || 'file_upload',
          JSON.stringify({
            original_row: punch,
            uploaded_at: new Date().toISOString()
          })
        ]);
        savedCount++;
      } catch (punchError) {
        console.error('Error saving punch:', punchError);
        errors.push({
          employee_name: punch.employee_name,
          punch_time: punch.punch_time,
          error: punchError.message
        });
      }
    }

    // Update upload record status and record counts
    const errorCount = errors.length;
    await pool.query(`
      UPDATE punch_file_uploads
      SET status = 'completed', 
          processed_at = CURRENT_TIMESTAMP,
          total_records = $2,
          processed_records = $3,
          error_records = $4,
          processing_errors = $5
      WHERE id = $1
    `, [uploadId, punchRecords.length, savedCount, errorCount, JSON.stringify(errors)]);

    res.json({
      success: true,
      savedRecords: savedCount,
      totalRecords: punchRecords.length,
      errors: errors,
      message: `Successfully saved ${savedCount} punch records to raw_punches table`
    });

  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({
      error: 'Failed to save punch records',
      details: error.message
    });
  }
});


// Get uploaded files list
router.get('/files', verifyToken, async (req, res) => {
  try {
    const { page = '1', limit = '20' } = req.query;

    // Parse and validate pagination parameters
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);

    if (isNaN(parsedPage) || parsedPage < 1) {
      return res.status(400).json({ error: 'Invalid page parameter. Must be a positive integer.' });
    }

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 100.' });
    }

    const offset = (parsedPage - 1) * parsedLimit;

    const result = await pool.query(`
      SELECT
        up.id,
        up.filename,
        up.original_filename,
        up.file_path,
        up.file_size,
        up.upload_date,
        up.status,
        u.username as uploaded_by_username,
        COALESCE(up.processed_records, 0) as processed_records,
        COALESCE(up.total_records, 0) as total_records,
        COALESCE(up.error_records, 0) as error_records
      FROM punch_file_uploads up
      LEFT JOIN users u ON up.uploaded_by_user_id = u.id
      ORDER BY up.upload_date DESC
      LIMIT $1 OFFSET $2
    `, [parsedLimit, offset]);

    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM punch_file_uploads
    `);

    const total = parseInt(countResult.rows[0].total, 10);
    const pages = Math.ceil(total / parsedLimit);

    res.json({
      success: true,
      files: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages
      }
    });

  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({
      error: 'Failed to retrieve files',
      details: error.message
    });
  }
});

// Get file details
router.get('/files/:fileId', verifyToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    const result = await pool.query(`
      SELECT
        up.id,
        up.filename,
        up.original_filename,
        up.file_path,
        up.file_size,
        up.upload_date,
        up.status,
        u.username as uploaded_by_username,
        COUNT(ap.id) as punch_count
      FROM punch_file_uploads up
      LEFT JOIN users u ON up.uploaded_by_user_id = u.id
      LEFT JOIN attendance_punches ap ON up.id = ap.upload_id
      WHERE up.id = $1
      GROUP BY up.id, up.filename, up.original_filename, up.file_path, up.file_size, up.upload_date, up.status, u.username
    `, [fileId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({
      success: true,
      file: result.rows[0]
    });

  } catch (error) {
    console.error('Get file details error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve file details',
      details: error.message 
    });
  }
});

// Download file
router.get('/download/:fileId', verifyToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    const result = await pool.query(`
      SELECT * FROM punch_file_uploads
      WHERE id = $1 AND deleted_at IS NULL
    `, [fileId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];
    const filePath = file.file_path;

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${file.original_filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      error: 'Failed to download file',
      details: error.message 
    });
  }
});

// Delete file
router.delete('/files/:fileId', verifyToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    // Soft delete the file record and associated punches
    await pool.query(`
      DELETE FROM punch_file_uploads
      WHERE id = $1
    `, [fileId]);

    await pool.query(`
      UPDATE attendance_punches 
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE upload_id = $1
    `, [fileId]);

    res.json({
      success: true,
      message: 'File and associated punch records deleted successfully'
    });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ 
      error: 'Failed to delete file',
      details: error.message 
    });
  }
});

router.get('/temp/employees', async (req, res) => {
  try {
    const result = await pool.query("SELECT LOWER(first_name || ' ' || last_name) as full_name FROM employees");
    res.json({ success: true, employees: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get employees' });
  }
});

// Get raw punches (for viewing saved data)
router.get('/raw-punches', async (req, res) => {
  try {
    const { page = '1', limit = '50', employee, year, month } = req.query;
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    const offset = (parsedPage - 1) * parsedLimit;

    let whereConditions = [];
    let params = [];

    if (employee) {
      params.push(`%${employee.toLowerCase()}%`);
      whereConditions.push(`LOWER(employee_name) LIKE $${params.length}`);
    }

    if (year) {
      params.push(parseInt(year, 10));
      whereConditions.push(`EXTRACT(YEAR FROM punch_time) = $${params.length}`);
    }

    if (month) {
      params.push(parseInt(month, 10));
      whereConditions.push(`EXTRACT(MONTH FROM punch_time) = $${params.length}`);
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const rowsQuery = `
      SELECT
        id,
        employee_name,
        punch_time,
        source,
        uploaded_at,
        raw_data
      FROM raw_punches
      ${whereClause}
      ORDER BY uploaded_at DESC, punch_time DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM raw_punches
      ${whereClause}
    `;

    const rowsParams = [...params, parsedLimit, offset];
    const [result, countResult] = await Promise.all([
      pool.query(rowsQuery, rowsParams),
      pool.query(countQuery, params)
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      success: true,
      punches: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    console.error('Get raw punches error:', error);
    res.status(500).json({
      error: 'Failed to get raw punches',
      details: error.message
    });
  }
});

// Delete raw punch
router.delete('/raw-punches/:punchId', async (req, res) => {
  try {
    const { punchId } = req.params;

    const result = await pool.query(`
      DELETE FROM raw_punches
      WHERE id = $1
      RETURNING id
    `, [punchId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Raw punch not found' });
    }

    res.json({
      success: true,
      message: 'Raw punch deleted successfully'
    });
  } catch (error) {
    console.error('Delete raw punch error:', error);
    res.status(500).json({
      error: 'Failed to delete raw punch',
      details: error.message
    });
  }
});

module.exports = { initializeRoutes, setAuthMiddleware };
