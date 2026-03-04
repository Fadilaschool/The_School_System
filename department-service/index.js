const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const app = express();
const PORT = process.env.DEPARTMENT_SERVICE_PORT || 3003;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Allow both /departments and /api/departments paths (frontend calls /api/*)
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    req.url = req.url.replace(/^\/api/, '');
  }
  next();
});

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Department Service' });
});

// Get all departments
app.get('/departments', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        d.*,
        e.first_name as responsible_first_name,
        e.last_name as responsible_last_name,
        COUNT(ed.employee_id) as employee_count
      FROM departments d
      LEFT JOIN employees e ON d.responsible_id = e.id
      LEFT JOIN employee_departments ed ON d.id = ed.department_id
      GROUP BY d.id, e.first_name, e.last_name
      ORDER BY d.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get department by ID with employees
app.get('/departments/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get department info
    const deptResult = await pool.query(`
      SELECT 
        d.*,
        e.first_name as responsible_first_name,
        e.last_name as responsible_last_name
      FROM departments d
      LEFT JOIN employees e ON d.responsible_id = e.id
      WHERE d.id = $1
    `, [id]);

    if (deptResult.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Get employees in this department
    const employeesResult = await pool.query(`
      SELECT e.*, p.name as position_name
      FROM employees e
      JOIN employee_departments ed ON e.id = ed.employee_id
      LEFT JOIN positions p ON e.position_id = p.id
      WHERE ed.department_id = $1
      ORDER BY e.first_name, e.last_name
    `, [id]);

    const department = deptResult.rows[0];
    department.employees = employeesResult.rows;

    res.json(department);
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new department
app.post('/departments', verifyToken, async (req, res) => {
  try {
    // Only HR Manager can create departments
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });

    const { name, responsible_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    const result = await pool.query(
      'INSERT INTO departments (name, responsible_id) VALUES ($1, $2) RETURNING *',
      [name, responsible_id || null]
    );

    res.status(201).json({
      message: 'Department created successfully',
      department: result.rows[0]
    });
  } catch (error) {
    console.error('Create department error:', error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'Department name already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Update department
app.put('/departments/:id', verifyToken, async (req, res) => {
  try {
    // Only HR Manager can update departments
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });

    const { id } = req.params;
    const { name, responsible_id } = req.body;

    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (responsible_id !== undefined) {
      updateFields.push(`responsible_id = $${paramCount}`);
      values.push(responsible_id || null);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const query = `UPDATE departments SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json({
      message: 'Department updated successfully',
      department: result.rows[0]
    });
  } catch (error) {
    console.error('Update department error:', error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'Department name already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Delete department
app.delete('/departments/:id', verifyToken, async (req, res) => {
  try {
    // Only HR Manager can delete departments
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });

    const { id } = req.params;

    const result = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign employee to department
app.post('/departments/:id/employees', verifyToken, async (req, res) => {
  try {
    // Only HR Manager can assign employees to departments
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });

    const { id: departmentId } = req.params;
    const { employee_id } = req.body;

    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // Check if department exists
    const deptCheck = await pool.query('SELECT id FROM departments WHERE id = $1', [departmentId]);
    if (deptCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Check if employee exists
    const empCheck = await pool.query('SELECT id FROM employees WHERE id = $1', [employee_id]);
    if (empCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Check if assignment already exists
    const existingAssignment = await pool.query(
      'SELECT * FROM employee_departments WHERE employee_id = $1 AND department_id = $2',
      [employee_id, departmentId]
    );

    if (existingAssignment.rows.length > 0) {
      return res.status(409).json({ error: 'Employee is already assigned to this department' });
    }

    // Create assignment
    await pool.query(
      'INSERT INTO employee_departments (employee_id, department_id) VALUES ($1, $2)',
      [employee_id, departmentId]
    );

    res.status(201).json({ message: 'Employee assigned to department successfully' });
  } catch (error) {
    console.error('Assign employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove employee from department
app.delete('/departments/:id/employees/:employeeId', verifyToken, async (req, res) => {
  try {
    // Only HR Manager can remove employees from departments
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });

    const { id: departmentId, employeeId } = req.params;

    const result = await pool.query(
      'DELETE FROM employee_departments WHERE employee_id = $1 AND department_id = $2 RETURNING *',
      [employeeId, departmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee assignment not found' });
    }

    res.json({ message: 'Employee removed from department successfully' });
  } catch (error) {
    console.error('Remove employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get employees not assigned to any department
app.get('/employees/unassigned', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, p.name as position_name
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
      LEFT JOIN employee_departments ed ON e.id = ed.employee_id
      WHERE ed.employee_id IS NULL
      ORDER BY e.first_name, e.last_name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Get unassigned employees error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all employees for assignment dropdown
app.get('/employees/for-assignment', verifyToken, async (req, res) => {
  try {
    const { department_id } = req.query;

    let query = `
      SELECT e.id, e.first_name, e.last_name, p.name as position_name,
             CASE WHEN ed.department_id IS NOT NULL THEN true ELSE false END as is_assigned
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
      LEFT JOIN employee_departments ed ON e.id = ed.employee_id
    `;

    const params = [];

    if (department_id) {
      query += ` WHERE ed.department_id != $1 OR ed.department_id IS NULL`;
      params.push(department_id);
    }

    query += ` ORDER BY e.first_name, e.last_name`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get employees for assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== Subjects CRUD =====
app.get('/subjects', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM subjects ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/subjects', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager') return res.status(403).json({ error: 'Access denied' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Subject name is required' });
    const result = await pool.query('INSERT INTO subjects (name) VALUES ($1) RETURNING id, name', [name]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create subject error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Subject name already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/subjects/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Subject name is required' });
    const result = await pool.query('UPDATE subjects SET name=$1 WHERE id=$2 RETURNING id, name', [name, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update subject error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Subject name already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/subjects/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });
    const { id } = req.params;
    await pool.query('DELETE FROM level_subjects WHERE subject_id=$1', [id]);
    const result = await pool.query('DELETE FROM subjects WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });
    res.json({ message: 'Subject deleted' });
  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== Levels CRUD (with subjects assignment) =====
app.get('/levels', verifyToken, async (req, res) => {
  try {
    const levels = await pool.query('SELECT id, name FROM levels ORDER BY name');
    const map = new Map(levels.rows.map(l => [l.id, { ...l, subjects: [] }]));
    const rel = await pool.query(`
      SELECT ls.level_id, s.id as subject_id, s.name as subject_name
      FROM level_subjects ls
      JOIN subjects s ON s.id = ls.subject_id
    `);
    for (const r of rel.rows) {
      const lvl = map.get(r.level_id);
      if (lvl) lvl.subjects.push({ id: r.subject_id, name: r.subject_name });
    }
    res.json(Array.from(map.values()));
  } catch (error) {
    console.error('Get levels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/levels', verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });
    const { name, subject_ids = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'Level name is required' });
    await client.query('BEGIN');
    const ins = await client.query('INSERT INTO levels (name) VALUES ($1) RETURNING id, name', [name]);
    const levelId = ins.rows[0].id;
    for (const sid of subject_ids) {
      await client.query('INSERT INTO level_subjects (level_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [levelId, sid]);
    }
    await client.query('COMMIT');
    res.status(201).json({ id: levelId, name, subjects: [] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create level error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Level name already exists' });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.put('/levels/:id', verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });
    const { id } = req.params;
    const { name, subject_ids = [] } = req.body;
    await client.query('BEGIN');
    if (name !== undefined) {
      const upd = await client.query('UPDATE levels SET name=$1 WHERE id=$2 RETURNING id', [name, id]);
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Level not found' });
      }
    }
    await client.query('DELETE FROM level_subjects WHERE level_id=$1', [id]);
    for (const sid of subject_ids) {
      await client.query('INSERT INTO level_subjects (level_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, sid]);
    }
    await client.query('COMMIT');
    res.json({ message: 'Level updated' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update level error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Level name already exists' });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.delete('/levels/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });
    const { id } = req.params;
    await pool.query('DELETE FROM level_subjects WHERE level_id=$1', [id]);
    const result = await pool.query('DELETE FROM levels WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Level not found' });
    res.json({ message: 'Level deleted' });
  } catch (error) {
    console.error('Delete level error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== Branches CRUD (with levels assignment) =====
app.get('/branches', verifyToken, async (req, res) => {
  try {
    const branches = await pool.query('SELECT id, name, description, website, phone, address, wilaya, registration_number FROM branches ORDER BY name');
    const map = new Map(branches.rows.map(b => [b.id, { ...b, levels: [] }]));
    const rel = await pool.query(`
      SELECT bl.branch_id, l.id as level_id, l.name as level_name
      FROM branch_levels bl
      JOIN levels l ON l.id = bl.level_id
    `);
    for (const r of rel.rows) {
      const br = map.get(r.branch_id);
      if (br) br.levels.push({ id: r.level_id, name: r.level_name });
    }
    res.json(Array.from(map.values()));
  } catch (error) {
    console.error('Get branches error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/branches', verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });
    const { name, description = null, website = null, phone = null, address = null, wilaya = null, registration_number = null, level_ids = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'Branch name is required' });
    await client.query('BEGIN');
    const ins = await client.query('INSERT INTO branches (name, description, website, phone, address, wilaya, registration_number) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name', [name, description, website, phone, address, wilaya, registration_number]);
    const branchId = ins.rows[0].id;
    for (const lid of level_ids) {
      await client.query('INSERT INTO branch_levels (branch_id, level_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [branchId, lid]);
    }
    await client.query('COMMIT');
    res.status(201).json({ id: branchId, name });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create branch error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Branch name already exists' });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.put('/branches/:id', verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });
    const { id } = req.params;
    const { name, description = null, website = null, phone = null, address = null, wilaya = null, registration_number = null, level_ids = [] } = req.body;
    await client.query('BEGIN');
    const fields = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name=$${idx++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description=$${idx++}`); values.push(description); }
    if (website !== undefined) { fields.push(`website=$${idx++}`); values.push(website); }
    if (phone !== undefined) { fields.push(`phone=$${idx++}`); values.push(phone); }
    if (address !== undefined) { fields.push(`address=$${idx++}`); values.push(address); }
    if (wilaya !== undefined) { fields.push(`wilaya=$${idx++}`); values.push(wilaya); }
    if (registration_number !== undefined) { fields.push(`registration_number=$${idx++}`); values.push(registration_number); }
    if (fields.length) {
      values.push(id);
      const upd = await client.query(`UPDATE branches SET ${fields.join(', ')} WHERE id=$${idx} RETURNING id`, values);
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Branch not found' });
      }
    }
    await client.query('DELETE FROM branch_levels WHERE branch_id=$1', [id]);
    for (const lid of level_ids) {
      await client.query('INSERT INTO branch_levels (branch_id, level_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, lid]);
    }
    await client.query('COMMIT');
    res.json({ message: 'Branch updated' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update branch error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Branch name already exists' });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.delete('/branches/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'HR_Manager' && req.user.role !== 'Director') return res.status(403).json({ error: 'Access denied' });
    const { id } = req.params;
    await pool.query('DELETE FROM branch_levels WHERE branch_id=$1', [id]);
    const result = await pool.query('DELETE FROM branches WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Branch not found' });
    res.json({ message: 'Branch deleted' });
  } catch (error) {
    console.error('Delete branch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Department Service running on port ${PORT}`);
});

module.exports = app;

