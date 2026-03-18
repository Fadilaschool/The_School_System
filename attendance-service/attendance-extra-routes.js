const express = require('express');
const { Pool } = require('pg');
const moment = require('moment-timezone');
// Using built-in fetch from Node.js 18+

// JWT verification middleware (will be injected)
let verifyToken;

const setAuthMiddleware = (authMiddleware) => {
  verifyToken = authMiddleware;
};

const initializeRoutes = (dbPool) => {
  
  const router = express.Router();
  const pool = dbPool;
  // Proxy route to fetch IP info from ipapi.co
  router.get('/api/ipinfo', async (req, res) => {
    try {
      const response = await fetch('https://ipapi.co/json/');
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch IP info' });
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  // ============================================================================
  // OVERTIME/EXCEPTION REQUESTS ROUTES
  // ============================================================================

  // Submit overtime request (extra hours)
  router.post('/overtime/submit', verifyToken, async (req, res) => {
    try {
      const {
        date,
        requested_hours,
        description,
        start_time,
        end_time,
        status
      } = req.body;

      const userId = req.user.userId;

      // Get employee ID for the current user
      const employeeResult = await pool.query(
        'SELECT id FROM employees WHERE user_id = $1',
        [userId]
      );

      if (employeeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employee record not found' });
      }

      const employeeId = employeeResult.rows[0].id;

      // Validate request
      if (!date || !requested_hours || !description) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (requested_hours <= 0 || requested_hours > 12) {
        return res.status(400).json({ error: 'Invalid hours amount' });
      }

      // Check if request already exists for this date
      const existingResult = await pool.query(
        'SELECT id FROM overtime_requests WHERE employee_id = $1 AND date = $2',
        [employeeId, date]
      );

      if (existingResult.rows.length > 0) {
        return res.status(400).json({ error: 'Request already exists for this date' });
      }

      // Create overtime request
      const requestStatus = status || 'Pending';
      const result = await pool.query(`
        INSERT INTO overtime_requests
        (employee_id, date, requested_hours, description, submitted_by_user_id, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [employeeId, date, requested_hours, description, userId, requestStatus]);

      const request = result.rows[0];

      // If status is Approved, add to employee overtime hours
      if (requestStatus === 'Approved') {
        await pool.query(`
          INSERT INTO employee_overtime_hours
          (employee_id, date, hours, description, created_by_user_id)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (employee_id, date)
          DO UPDATE SET
            hours = employee_overtime_hours.hours + EXCLUDED.hours,
            updated_at = CURRENT_TIMESTAMP
        `, [
          employeeId,
          date,
          requested_hours,
          `Approved overtime: ${description}`,
          userId
        ]);
      }

      // Log audit trail
      await pool.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'overtime_request',
        request.id,
        'submit',
        userId,
        JSON.stringify({
          date,
          requested_hours,
          description,
          start_time,
          end_time,
          status: requestStatus
        })
      ]);

      res.json({
        success: true,
        request,
        message: 'Overtime request submitted successfully'
      });

    } catch (error) {
      console.error('Submit overtime request error:', error);
      res.status(500).json({ 
        error: 'Failed to submit overtime request',
        details: error.message 
      });
    }
  });

  // List pending overtime requests (admin/manager view, merge-able with exceptions UI)
  router.get('/overtime/pending', verifyToken, async (req, res) => {
    try {
      const { page = 1, limit = 20, departmentId, employeeId, year, month } = req.query;
      const offset = (page - 1) * limit;
      
      console.log('🔍 [Overtime API] Received filter params:', { year, month, employeeId, departmentId });

      let whereConditions = ["ot.status = 'Pending'"];
      const params = [];
      let paramIndex = 1;

      if (employeeId) {
        whereConditions.push(`ot.employee_id = $${paramIndex}`);
        params.push(employeeId);
        paramIndex++;
      }

      // Filter by date range
      if (year && month) {
        // Month + Year: filter specific month
        whereConditions.push(`ot.date >= make_date($${paramIndex}, $${paramIndex + 1}, 1)`);
        whereConditions.push(`ot.date < (make_date($${paramIndex}, $${paramIndex + 1}, 1) + interval '1 month')`);
        params.push(parseInt(year), parseInt(month));
        paramIndex += 2;
      } else if (year) {
        // Year only: filter entire year
        whereConditions.push(`EXTRACT(YEAR FROM ot.date) = $${paramIndex}`);
        params.push(parseInt(year));
        paramIndex++;
      }
      // No date filter = all time

      // Always join departments; optionally filter by departmentId
      whereConditions = whereConditions; // no-op to keep style consistent
      if (departmentId) {
        whereConditions.push(`ed.department_id = $${paramIndex}`);
        params.push(departmentId);
        paramIndex++;
      }

      const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

      const query = `
        SELECT 
          ot.*,
          CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
          e.id AS employee_number,
          d.name AS department_name,
          COUNT(*) OVER() AS total_count
        FROM overtime_requests ot
        LEFT JOIN employees e ON ot.employee_id = e.id
        LEFT JOIN employee_departments ed ON e.id = ed.employee_id
        LEFT JOIN departments d ON ed.department_id = d.id
        ${whereClause}
        ORDER BY ot.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      params.push(parseInt(limit), parseInt(offset));
      
      console.log('📊 [Overtime API] WHERE conditions:', whereConditions);
      console.log('📊 [Overtime API] Query params:', params);

      const result = await pool.query(query, params);
      
      console.log(`✅ Pending overtime query returned ${result.rows.length} results`);
      const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count || 0) : 0;

      const data = result.rows.map(row => ({
        id: row.id,
        type: 'ExtraHours',
        date: row.date,
        end_date: null,
        status: row.status,
        description: row.description || '',
        requested_hours: row.requested_hours,
        employee_name: row.employee_name,
        employee_number: row.employee_number,
        department_name: row.department_name,
        created_at: row.created_at
      }));

      res.json({
        success: true,
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get pending overtime requests error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve pending overtime requests',
        details: error.message 
      });
    }
  });

  // Overtime history listing (Approved/Declined)
  router.get('/overtime/history', verifyToken, async (req, res) => {
    try {
      const { page = 1, limit = 20, departmentId, employeeId, status, startDate, endDate, year, month } = req.query;
      const offset = (page - 1) * limit;

      let whereConditions = [];
      const params = [];
      let paramIndex = 1;

      if (employeeId) {
        whereConditions.push(`ot.employee_id = $${paramIndex}`);
        params.push(employeeId);
        paramIndex++;
      }
      if (status) {
        whereConditions.push(`ot.status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }
      const ymYear = year ? parseInt(year) : null;
      const ymMonth = month ? parseInt(month) : null;
      if (ymYear && ymMonth && !startDate && !endDate) {
        whereConditions.push(`ot.date >= make_date($${paramIndex}, $${paramIndex + 1}, 1)`);
        whereConditions.push(`ot.date < (make_date($${paramIndex}, $${paramIndex + 1}, 1) + interval '1 month')`);
        params.push(ymYear, ymMonth);
        paramIndex += 2;
      }
      if (startDate) {
        whereConditions.push(`ot.date >= $${paramIndex}`);
        params.push(startDate);
        paramIndex++;
      }
      if (endDate) {
        whereConditions.push(`ot.date <= $${paramIndex}`);
        params.push(endDate);
        paramIndex++;
      }

      // Always join departments; optionally filter by departmentId
      if (departmentId) {
        whereConditions.push(`ed.department_id = $${paramIndex}`);
        params.push(departmentId);
      }

      const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

      const query = `
        SELECT 
          ot.*,
          CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
          e.id AS employee_number,
          d.name AS department_name,
          u.username AS reviewed_by_username,
          CONCAT(er.first_name, ' ', er.last_name) AS reviewed_by_name,
          COUNT(*) OVER() AS total_count
        FROM overtime_requests ot
        LEFT JOIN employees e ON ot.employee_id = e.id
        LEFT JOIN employee_departments ed ON e.id = ed.employee_id
        LEFT JOIN departments d ON ed.department_id = d.id
        LEFT JOIN users u ON ot.reviewed_by_user_id = u.id
        LEFT JOIN employees er ON u.id = er.user_id
        ${whereClause}
        ORDER BY ot.created_at DESC
        LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
      `;

      params.push(parseInt(limit), parseInt(offset));

      const result = await pool.query(query, params);
      const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count || 0) : 0;
      const data = result.rows.map(row => ({
        id: row.id,
        type: 'ExtraHours',
        date: row.date,
        status: row.status,
        description: row.description || '',
        requested_hours: row.requested_hours,
        employee_name: row.employee_name,
        employee_number: row.employee_number,
        department_name: row.department_name,
        reviewed_by: row.reviewed_by_name || row.reviewed_by_username,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at
      }));

      res.json({
        success: true,
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get overtime history error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve overtime history',
        details: error.message 
      });
    }
  });

  // Get my overtime requests
  router.get('/overtime/my-requests', verifyToken, async (req, res) => {
    try {
      const { limit = 10 } = req.query;
      const userId = req.user.userId;

      // Get employee ID
      const employeeResult = await pool.query(
        'SELECT id FROM employees WHERE user_id = $1',
        [userId]
      );

      if (employeeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employee record not found' });
      }

      const employeeId = employeeResult.rows[0].id;

      const query = `
        SELECT 
          ot.*,
          u_reviewer.username AS reviewed_by_username,
          CONCAT(e_reviewer.first_name, ' ', e_reviewer.last_name) AS reviewed_by_name
        FROM overtime_requests ot
        LEFT JOIN users u_reviewer ON ot.reviewed_by_user_id = u_reviewer.id
        LEFT JOIN employees e_reviewer ON u_reviewer.id = e_reviewer.user_id
        WHERE ot.employee_id = $1
        ORDER BY ot.created_at DESC
        LIMIT $2
      `;

      const result = await pool.query(query, [employeeId, parseInt(limit)]);

      const requests = result.rows.map(row => ({
        id: row.id,
        date: row.date,
        requested_hours: row.requested_hours,
        description: row.description,
        status: row.status,
        reviewed_by: row.reviewed_by_name || row.reviewed_by_username,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at
      }));

      res.json({
        success: true,
        requests
      });

    } catch (error) {
      console.error('Get my overtime requests error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve overtime requests',
        details: error.message 
      });
    }
  });

  // Get my monthly overtime stats
  router.get('/overtime/my-stats/:year/:month', verifyToken, async (req, res) => {
    try {
      const { year, month } = req.params;
      const userId = req.user.userId;

      // Get employee ID
      const employeeResult = await pool.query(
        'SELECT id FROM employees WHERE user_id = $1',
        [userId]
      );

      if (employeeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employee record not found' });
      }

      const employeeId = employeeResult.rows[0].id;

      const query = `
        SELECT 
          COUNT(*) AS total_requests,
          COALESCE(SUM(CASE WHEN status = 'Approved' THEN requested_hours ELSE 0 END), 0) AS approved_hours,
          COALESCE(SUM(CASE WHEN status = 'Pending' THEN requested_hours ELSE 0 END), 0) AS pending_hours,
          COALESCE(SUM(CASE WHEN status = 'Declined' THEN requested_hours ELSE 0 END), 0) AS declined_hours
        FROM overtime_requests
        WHERE employee_id = $1 
          AND EXTRACT(YEAR FROM date) = $2 
          AND EXTRACT(MONTH FROM date) = $3
      `;

      const result = await pool.query(query, [employeeId, parseInt(year), parseInt(month)]);
      const stats = result.rows[0] || {};

      res.json({
        success: true,
        stats: {
          total_requests: parseInt(stats.total_requests) || 0,
          approved_hours: parseFloat(stats.approved_hours) || 0,
          pending_hours: parseFloat(stats.pending_hours) || 0,
          declined_hours: parseFloat(stats.declined_hours) || 0
        }
      });

    } catch (error) {
      console.error('Get my overtime stats error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve overtime statistics',
        details: error.message 
      });
    }
  });

  // Get employee overtime requests (for admin/manager view)
  router.get('/overtime/employee/:employeeId', verifyToken, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { year, month } = req.query;

      let query = `
        SELECT 
          ot.*,
          u_reviewer.username AS reviewed_by_username,
          CONCAT(e_reviewer.first_name, ' ', e_reviewer.last_name) AS reviewed_by_name
        FROM overtime_requests ot
        LEFT JOIN users u_reviewer ON ot.reviewed_by_user_id = u_reviewer.id
        LEFT JOIN employees e_reviewer ON u_reviewer.id = e_reviewer.user_id
        WHERE ot.employee_id = $1
      `;

      const params = [employeeId];
      let paramIndex = 2;

      if (year) {
        query += ` AND EXTRACT(YEAR FROM ot.date) = $${paramIndex}`;
        params.push(parseInt(year));
        paramIndex++;
      }

      if (month) {
        query += ` AND EXTRACT(MONTH FROM ot.date) = $${paramIndex}`;
        params.push(parseInt(month));
        paramIndex++;
      }

      query += ' ORDER BY ot.date DESC, ot.created_at DESC';

      const result = await pool.query(query, params);

      const requests = result.rows.map(row => ({
        id: row.id,
        date: row.date,
        requested_hours: row.requested_hours,
        description: row.description,
        status: row.status,
        reviewed_by: row.reviewed_by_name || row.reviewed_by_username,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at
      }));

      res.json({
        success: true,
        data: requests
      });

    } catch (error) {
      console.error('Get employee overtime requests error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve employee overtime requests',
        details: error.message 
      });
    }
  });

  // Get recorded overtime hours (from employee_overtime_hours) for an employee/month
  router.get('/overtime-hours/employee/:employeeId', verifyToken, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { year, month } = req.query;

      let query = `
        SELECT id, employee_id, date, hours, description, created_at
        FROM employee_overtime_hours
        WHERE employee_id = $1
      `;

      const params = [employeeId];
      let paramIndex = 2;

      if (year) {
        query += ` AND EXTRACT(YEAR FROM date) = $${paramIndex}`;
        params.push(parseInt(year));
        paramIndex++;
      }

      if (month) {
        query += ` AND EXTRACT(MONTH FROM date) = $${paramIndex}`;
        params.push(parseInt(month));
        paramIndex++;
      }

      query += ' ORDER BY date DESC, created_at DESC';

      const result = await pool.query(query, params);

      res.json({
        success: true,
        data: result.rows
      });

    } catch (error) {
      console.error('Get employee overtime hours error:', error);
      res.status(500).json({
        error: 'Failed to retrieve employee overtime hours',
        details: error.message
      });
    }
  });

  // Delete a recorded overtime hours row and update monthly summary
  router.delete('/overtime-hours/:id', verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;

      await client.query('BEGIN');

      const recResult = await client.query(
        'SELECT id, employee_id, date FROM employee_overtime_hours WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (recResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Recorded overtime not found' });
      }

      const rec = recResult.rows[0];

      await client.query('DELETE FROM employee_overtime_hours WHERE id = $1', [id]);

      const recDateObj = new Date(rec.date);
      const year = recDateObj.getUTCFullYear();
      const month = recDateObj.getUTCMonth() + 1;
      const overtimeResult = await client.query(`
        SELECT COALESCE(SUM(hours), 0) AS total_overtime_hours
        FROM employee_overtime_hours
        WHERE employee_id = $1 
          AND date >= make_date($2, $3, 1)
          AND date < (make_date($2, $3, 1) + interval '1 month')
      `, [rec.employee_id, year, month]);
      const totalOvertimeHours = parseFloat(overtimeResult.rows[0].total_overtime_hours) || 0;

      const upd = await client.query(`
        UPDATE employee_monthly_summaries
        SET total_overtime_hours = $1, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = $2 AND year = $3 AND month = $4
      `, [totalOvertimeHours, rec.employee_id, year, month]);
      if (upd.rowCount === 0) {
        await client.query(`
          INSERT INTO employee_monthly_summaries (employee_id, year, month, total_overtime_hours)
          VALUES ($1, $2, $3, $4)
        `, [rec.employee_id, year, month, totalOvertimeHours]);
      }

      await client.query('COMMIT');

      res.json({ success: true, message: 'Recorded overtime deleted' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Delete recorded overtime error:', error);
      res.status(500).json({ error: 'Failed to delete recorded overtime', details: error.message });
    } finally {
      client.release();
    }
  });

  // Alias path for deleting recorded overtime (compatibility)
  router.delete('/overtime/recorded/:id', verifyToken, async (req, res) => {
    // Reuse the same logic by calling the handler above
    req.params.id = req.params.id;
    // Manually invoke the same procedure
    const client = await pool.connect();
    try {
      const { id } = req.params;
      await client.query('BEGIN');
      const recResult = await client.query(
        'SELECT id, employee_id, date FROM employee_overtime_hours WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (recResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Recorded overtime not found' });
      }
      const rec = recResult.rows[0];
      await client.query('DELETE FROM employee_overtime_hours WHERE id = $1', [id]);
      const recDateObj2 = new Date(rec.date);
      const year = recDateObj2.getUTCFullYear();
      const month = recDateObj2.getUTCMonth() + 1;
      const overtimeResult = await client.query(`
        SELECT COALESCE(SUM(hours), 0) AS total_overtime_hours
        FROM employee_overtime_hours
        WHERE employee_id = $1 AND EXTRACT(YEAR FROM date) = $2 AND EXTRACT(MONTH FROM date) = $3
      `, [rec.employee_id, year, month]);
      const totalOvertimeHours = parseFloat(overtimeResult.rows[0].total_overtime_hours) || 0;
      const upd = await client.query(`
        UPDATE employee_monthly_summaries
        SET total_overtime_hours = $1, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = $2 AND year = $3 AND month = $4
      `, [totalOvertimeHours, rec.employee_id, year, month]);
      if (upd.rowCount === 0) {
        await client.query(`
          INSERT INTO employee_monthly_summaries (employee_id, year, month, total_overtime_hours)
          VALUES ($1, $2, $3, $4)
        `, [rec.employee_id, year, month, totalOvertimeHours]);
      }
      await client.query('COMMIT');
      res.json({ success: true, message: 'Recorded overtime deleted' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Delete recorded overtime (alias) error:', error);
      res.status(500).json({ error: 'Failed to delete recorded overtime', details: error.message });
    } finally {
      client.release();
    }
  });

  // Approve overtime request
  router.post('/overtime/approve/:requestId', verifyToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const { requestId } = req.params;
      const { admin_notes } = req.body;
      const userId = req.user.userId;

      // Update request status
      const updateResult = await client.query(`
        UPDATE overtime_requests
        SET status = 'Approved',
            reviewed_by_user_id = $1,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND status = 'Pending'
        RETURNING *
      `, [userId, requestId]);

      if (updateResult.rows.length === 0) {
        throw new Error('Request not found or already processed');
      }

      const request = updateResult.rows[0];

      // Add to employee overtime hours
      await client.query(`
        INSERT INTO employee_overtime_hours
        (employee_id, date, hours, description, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (employee_id, date) 
        DO UPDATE SET 
          hours = employee_overtime_hours.hours + EXCLUDED.hours,
          updated_at = CURRENT_TIMESTAMP
      `, [
        request.employee_id,
        request.date,
        request.requested_hours,
        `Approved overtime: ${request.description}`,
        userId
      ]);

      // Recalculate monthly summary to reflect approved overtime immediately
      const reqDateObj = new Date(request.date);
      const year = reqDateObj.getUTCFullYear();
      const month = reqDateObj.getUTCMonth() + 1;
      const overtimeResult = await client.query(`
        SELECT COALESCE(SUM(hours), 0) AS total_overtime_hours
        FROM employee_overtime_hours
        WHERE employee_id = $1 
          AND date >= make_date($2, $3, 1)
          AND date < (make_date($2, $3, 1) + interval '1 month')
      `, [request.employee_id, year, month]);
      const totalOvertimeHours = parseFloat(overtimeResult.rows[0].total_overtime_hours) || 0;
      const summaryUpdate = await client.query(`
        UPDATE employee_monthly_summaries
        SET total_overtime_hours = $1, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = $2 AND year = $3 AND month = $4
      `, [totalOvertimeHours, request.employee_id, year, month]);
      if (summaryUpdate.rowCount === 0) {
        await client.query(`
          INSERT INTO employee_monthly_summaries (employee_id, year, month, total_overtime_hours)
          VALUES ($1, $2, $3, $4)
        `, [request.employee_id, year, month, totalOvertimeHours]);
      }

      // Log audit trail
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'overtime_request',
        requestId,
        'approve',
        userId,
        JSON.stringify({ 
          employee_id: request.employee_id,
          date: request.date,
          hours: request.requested_hours,
          admin_notes
        })
      ]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Overtime request approved successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Approve overtime request error:', error);
      res.status(500).json({ 
        error: 'Failed to approve overtime request',
        details: error.message 
      });
    } finally {
      client.release();
    }
  });

  // Decline overtime request
  router.post('/overtime/decline/:requestId', verifyToken, async (req, res) => {
    try {
      const { requestId } = req.params;
      const { admin_notes } = req.body;
      const userId = req.user.userId;

      const result = await pool.query(`
        UPDATE overtime_requests
        SET status = 'Declined',
            reviewed_by_user_id = $1,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND status = 'Pending'
        RETURNING *
      `, [userId, requestId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Request not found or already processed' });
      }

      // Log audit trail
      await pool.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'overtime_request',
        requestId,
        'decline',
        userId,
        JSON.stringify({ admin_notes })
      ]);

      res.json({
        success: true,
        message: 'Overtime request declined successfully'
      });

    } catch (error) {
      console.error('Decline overtime request error:', error);
      res.status(500).json({ 
        error: 'Failed to decline overtime request',
        details: error.message 
      });
    }
  });

  // Delete overtime request (remove recorded hours if approved and update summaries)
  router.delete('/overtime/:requestId', verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      const { requestId } = req.params;
      const userId = req.user.userId;

      await client.query('BEGIN');

      // Load request with owner and reviewer info
      const checkResult = await client.query(`
        SELECT ot.*, e.user_id AS owner_user_id
        FROM overtime_requests ot
        JOIN employees e ON ot.employee_id = e.id
        WHERE ot.id = $1
        FOR UPDATE
      `, [requestId]);

      if (checkResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Request not found' });
      }

      const request = checkResult.rows[0];

      // Authorization: owner or reviewer can delete
      if (request.owner_user_id !== userId && request.reviewed_by_user_id !== userId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not authorized to delete this request' });
      }

      // If approved, reverse recorded hours from employee_overtime_hours
      if (request.status === 'Approved') {
        // Get current recorded hours for that date
        const hoursResult = await client.query(`
          SELECT id, hours FROM employee_overtime_hours 
          WHERE employee_id = $1 AND date = $2
          FOR UPDATE
        `, [request.employee_id, request.date]);

        if (hoursResult.rows.length > 0) {
          const rec = hoursResult.rows[0];
          const remaining = parseFloat(rec.hours) - parseFloat(request.requested_hours);
          if (remaining <= 0) {
            await client.query('DELETE FROM employee_overtime_hours WHERE id = $1', [rec.id]);
          } else {
            await client.query('UPDATE employee_overtime_hours SET hours = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [remaining, rec.id]);
          }

          // Update monthly summary
          const reqDateObj2 = new Date(request.date);
          const year = reqDateObj2.getUTCFullYear();
          const month = reqDateObj2.getUTCMonth() + 1;
          const overtimeResult = await client.query(`
            SELECT COALESCE(SUM(hours), 0) AS total_overtime_hours
            FROM employee_overtime_hours
            WHERE employee_id = $1 AND EXTRACT(YEAR FROM date) = $2 AND EXTRACT(MONTH FROM date) = $3
          `, [request.employee_id, year, month]);
          const totalOvertimeHours = parseFloat(overtimeResult.rows[0].total_overtime_hours) || 0;
          const summaryUpdate2 = await client.query(`
            UPDATE employee_monthly_summaries
            SET total_overtime_hours = $1, updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = $2 AND year = $3 AND month = $4
          `, [totalOvertimeHours, request.employee_id, year, month]);
          if (summaryUpdate2.rowCount === 0) {
            await client.query(`
              INSERT INTO employee_monthly_summaries (employee_id, year, month, total_overtime_hours)
              VALUES ($1, $2, $3, $4)
            `, [request.employee_id, year, month, totalOvertimeHours]);
          }
        }
      }

      // Delete the overtime request itself
      await client.query('DELETE FROM overtime_requests WHERE id = $1', [requestId]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Overtime request and related records deleted successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Delete overtime request error:', error);
      res.status(500).json({
        error: 'Failed to delete overtime request',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // Add overtime hours directly (admin function)
  router.post('/overtime/add-admin', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const {
        employee_id,
        date,
        hours,
        description
      } = req.body;

      const userId = req.user.userId;

      // Validate required fields
      if (!employee_id || !date || !hours || !description) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (hours <= 0 || hours > 12) {
        return res.status(400).json({ error: 'Invalid hours amount' });
      }

      // If there is a pending overtime request for the same employee/date, auto-approve it.
      // Otherwise, create a normal overtime request with Approved status.
      const existingReq = await client.query(`
        SELECT id, status FROM overtime_requests 
        WHERE employee_id = $1 AND date = $2
        ORDER BY created_at DESC
        LIMIT 1
      `, [employee_id, date]);

      if (existingReq.rows.length > 0) {
        const reqRow = existingReq.rows[0];
        if (reqRow.status === 'Pending') {
          await client.query(`
            UPDATE overtime_requests
            SET status = 'Approved', reviewed_by_user_id = $1, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `, [userId, reqRow.id]);
        }
        // If already Approved/Declined, do not create a duplicate request; continue to add/merge hours below
      } else {
        // Create a new overtime request in Approved status (normal flow item)
        await client.query(`
          INSERT INTO overtime_requests
          (employee_id, date, requested_hours, description, submitted_by_user_id, status, reviewed_by_user_id, reviewed_at)
          VALUES ($1, $2, $3, $4, $5, 'Approved', $5, CURRENT_TIMESTAMP)
        `, [employee_id, date, hours, description, userId]);
      }

      // Add to employee overtime hours
      await client.query(`
        INSERT INTO employee_overtime_hours
        (employee_id, date, hours, description, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (employee_id, date)
        DO UPDATE SET
          hours = employee_overtime_hours.hours + EXCLUDED.hours,
          updated_at = CURRENT_TIMESTAMP
      `, [
        employee_id,
        date,
        hours,
        description,
        userId
      ]);

      // Extract year and month from date (YYYY-MM-DD) without timezone shifts
      const [year, month] = String(date).split('T')[0].split('-').map(Number).slice(0, 2);

      // Recalculate overtime hours for the month
      const overtimeResult = await client.query(`
        SELECT COALESCE(SUM(hours), 0) AS total_overtime_hours
        FROM employee_overtime_hours
        WHERE employee_id = $1
          AND EXTRACT(YEAR FROM date) = $2
          AND EXTRACT(MONTH FROM date) = $3
      `, [employee_id, year, month]);

      const totalOvertimeHours = parseFloat(overtimeResult.rows[0].total_overtime_hours) || 0;

      // Update employee_monthly_summaries (upsert)
      const updSum = await client.query(`
        UPDATE employee_monthly_summaries
        SET total_overtime_hours = $1, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = $2 AND year = $3 AND month = $4
      `, [totalOvertimeHours, employee_id, year, month]);
      if (updSum.rowCount === 0) {
        await client.query(`
          INSERT INTO employee_monthly_summaries (employee_id, year, month, total_overtime_hours)
          VALUES ($1, $2, $3, $4)
        `, [employee_id, year, month, totalOvertimeHours]);
      }

      // Log audit trail
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'overtime_admin_add',
        employee_id,
        'add_overtime_hours',
        userId,
        JSON.stringify({
          employee_id,
          date,
          hours,
          description
        })
      ]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Overtime hours added successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Add overtime admin error:', error);
      res.status(500).json({
        error: 'Failed to add overtime hours',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // ============================================================================
  // WAGE CHANGES ROUTES
  // ============================================================================

  // Get employee wage changes
  router.get('/wage-changes/employee/:employeeId', verifyToken, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { year, month, show_all } = req.query;

      let query = `
        SELECT 
          esa.*,
          esa.effective_date::text AS effective_date,
          u.username AS created_by_username,
          CONCAT(e.first_name, ' ', e.last_name) AS created_by_name
        FROM employee_salary_adjustments esa
        LEFT JOIN users u ON esa.created_by_user_id = u.id
        LEFT JOIN employees e ON u.id = e.user_id
        WHERE esa.employee_id = $1
      `;

      const params = [employeeId];
      let paramIndex = 2;

      // Only filter by year/month if show_all is not true
      if (year && month && show_all !== 'true') {
        query += ` AND EXTRACT(YEAR FROM esa.effective_date) = $${paramIndex}`;
        params.push(parseInt(year));
        paramIndex++;

        query += ` AND EXTRACT(MONTH FROM esa.effective_date) = $${paramIndex}`;
        params.push(parseInt(month));
        paramIndex++;
      }

      query += ' ORDER BY esa.effective_date DESC, esa.created_at DESC';

      const result = await pool.query(query, params);

      res.json({
        success: true,
        data: result.rows.map(row => ({
          id: row.id,
          adjustment_type: row.adjustment_type,
          amount: row.amount,
          description: row.description,
          effective_date: row.effective_date,
          created_by: row.created_by_name || row.created_by_username,
          created_at: row.created_at
        }))
      });

    } catch (error) {
      console.error('Get employee wage changes error:', error);
      res.status(500).json({
        error: 'Failed to retrieve wage changes',
        details: error.message
      });
    }
  });

  // Create wage change
  router.post('/wage-changes', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const {
        employee_id,
        adjustment_type,
        amount,
        description,
        effective_date
      } = req.body;

      const userId = req.user.userId;

      // Validate required fields
      if (!employee_id || !adjustment_type || !amount || !effective_date) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (amount <= 0) {
        return res.status(400).json({ error: 'Amount must be greater than 0' });
      }

      // Extract year and month from effective_date
      const effectiveDate = new Date(effective_date);
      const year = effectiveDate.getFullYear();
      const month = effectiveDate.getMonth() + 1; // JavaScript months are 0-indexed

      // Insert wage change
      const result = await client.query(`
        INSERT INTO employee_salary_adjustments
        (employee_id, adjustment_type, amount, description, effective_date, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [employee_id, adjustment_type, amount, description, effective_date, userId]);

      const wageChange = result.rows[0];

      // Recalculate wage changes for the month
      const wageChangesResult = await client.query(`
        SELECT COALESCE(SUM(
          CASE
            WHEN adjustment_type = 'decrease' THEN -amount
            WHEN adjustment_type = 'credit' THEN -amount
            WHEN adjustment_type = 'raise' THEN amount
            ELSE amount
          END
        ), 0) AS total_wage_changes
        FROM employee_salary_adjustments
        WHERE employee_id = $1
          AND effective_date >= make_date($2, $3, 1)
          AND effective_date < (make_date($2, $3, 1) + interval '1 month')
      `, [employee_id, year, month]);

      const totalWageChanges = parseFloat(wageChangesResult.rows[0].total_wage_changes) || 0;

      // Update employee_monthly_summaries if it exists
      await client.query(`
        UPDATE employee_monthly_summaries
        SET total_wage_changes = $1, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = $2 AND year = $3 AND month = $4
      `, [totalWageChanges, employee_id, year, month]);

      await client.query('COMMIT');

      res.json({
        success: true,
        data: wageChange,
        message: 'Wage change created successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Create wage change error:', error);
      res.status(500).json({
        error: 'Failed to create wage change',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // Update wage change
  router.put('/wage-changes/:id', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const {
        adjustment_type,
        amount,
        description,
        effective_date
      } = req.body;

      const userId = req.user.userId;

      // Get the old wage change to know which months to update
      const oldResult = await client.query(
        'SELECT employee_id, effective_date FROM employee_salary_adjustments WHERE id = $1',
        [id]
      );

      if (oldResult.rows.length === 0) {
        return res.status(404).json({ error: 'Wage change not found' });
      }

      const oldWageChange = oldResult.rows[0];
      const oldDate = new Date(oldWageChange.effective_date);
      const oldYear = oldDate.getFullYear();
      const oldMonth = oldDate.getMonth() + 1;

      // Update the wage change
      const result = await client.query(`
        UPDATE employee_salary_adjustments
        SET adjustment_type = $1,
            amount = $2,
            description = $3,
            effective_date = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING *
      `, [adjustment_type, amount, description, effective_date, id]);

      const updatedWageChange = result.rows[0];
      const newDate = new Date(effective_date);
      const newYear = newDate.getFullYear();
      const newMonth = newDate.getMonth() + 1;

      // Recalculate wage changes for old month
      const oldWageChangesResult = await client.query(`
        SELECT COALESCE(SUM(
          CASE
            WHEN adjustment_type = 'decrease' THEN -amount
            WHEN adjustment_type = 'credit' THEN -amount
            WHEN adjustment_type = 'raise' THEN amount
            ELSE amount
          END
        ), 0) AS total_wage_changes
        FROM employee_salary_adjustments
        WHERE employee_id = $1
          AND effective_date >= make_date($2, $3, 1)
          AND effective_date < (make_date($2, $3, 1) + interval '1 month')
      `, [oldWageChange.employee_id, oldYear, oldMonth]);

      const oldTotalWageChanges = parseFloat(oldWageChangesResult.rows[0].total_wage_changes) || 0;

      // Update employee_monthly_summaries for old month
      await client.query(`
        UPDATE employee_monthly_summaries
        SET total_wage_changes = $1, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = $2 AND year = $3 AND month = $4
      `, [oldTotalWageChanges, oldWageChange.employee_id, oldYear, oldMonth]);

      // If the effective date changed, recalculate for new month
      if (oldYear !== newYear || oldMonth !== newMonth) {
        const newWageChangesResult = await client.query(`
          SELECT COALESCE(SUM(
            CASE
              WHEN adjustment_type = 'decrease' THEN -amount
              WHEN adjustment_type = 'credit' THEN -amount
              WHEN adjustment_type = 'raise' THEN amount
              ELSE amount
            END
          ), 0) AS total_wage_changes
          FROM employee_salary_adjustments
          WHERE employee_id = $1
            AND effective_date >= make_date($2, $3, 1)
            AND effective_date < (make_date($2, $3, 1) + interval '1 month')
        `, [oldWageChange.employee_id, newYear, newMonth]);

        const newTotalWageChanges = parseFloat(newWageChangesResult.rows[0].total_wage_changes) || 0;

        // Update employee_monthly_summaries for new month
        await client.query(`
          UPDATE employee_monthly_summaries
          SET total_wage_changes = $1, updated_at = CURRENT_TIMESTAMP
          WHERE employee_id = $2 AND year = $3 AND month = $4
        `, [newTotalWageChanges, oldWageChange.employee_id, newYear, newMonth]);
      }

      await client.query('COMMIT');

      // Log audit trail
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'wage_change',
        id,
        'update',
        userId,
        JSON.stringify(req.body)
      ]);

      res.json({
        success: true,
        data: updatedWageChange,
        message: 'Wage change updated successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Update wage change error:', error);
      res.status(500).json({
        error: 'Failed to update wage change',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // Delete wage change
  router.delete('/wage-changes/:id', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const userId = req.user.userId;

      // Get the wage change before deleting to know which month to update
      const wageChangeResult = await client.query(
        'SELECT employee_id, effective_date FROM employee_salary_adjustments WHERE id = $1',
        [id]
      );

      if (wageChangeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Wage change not found' });
      }

      const wageChange = wageChangeResult.rows[0];
      const effectiveDate = new Date(wageChange.effective_date);
      const year = effectiveDate.getFullYear();
      const month = effectiveDate.getMonth() + 1;

      // Delete the wage change
      const result = await client.query(
        'DELETE FROM employee_salary_adjustments WHERE id = $1 RETURNING *',
        [id]
      );

      // Recalculate wage changes for the month
      const wageChangesResult = await client.query(`
        SELECT COALESCE(SUM(
          CASE
            WHEN adjustment_type = 'decrease' THEN -amount
            WHEN adjustment_type = 'credit' THEN -amount
            WHEN adjustment_type = 'raise' THEN amount
            ELSE amount
          END
        ), 0) AS total_wage_changes
        FROM employee_salary_adjustments
        WHERE employee_id = $1
          AND EXTRACT(YEAR FROM effective_date) = $2
          AND EXTRACT(MONTH FROM effective_date) = $3
      `, [wageChange.employee_id, year, month]);

      const totalWageChanges = parseFloat(wageChangesResult.rows[0].total_wage_changes) || 0;

      // Update employee_monthly_summaries if it exists
      await client.query(`
        UPDATE employee_monthly_summaries
        SET total_wage_changes = $1, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = $2 AND year = $3 AND month = $4
      `, [totalWageChanges, wageChange.employee_id, year, month]);

      await client.query('COMMIT');

      // Log audit trail
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'wage_change',
        id,
        'delete',
        userId,
        JSON.stringify({ deleted_record: result.rows[0] })
      ]);

      res.json({
        success: true,
        message: 'Wage change deleted successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Delete wage change error:', error);
      res.status(500).json({
        error: 'Failed to delete wage change',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // ============================================================================
  // SETTINGS ROUTES
  // ============================================================================

  // Get attendance settings
  router.get('/settings', verifyToken, async (req, res) => {
    try {
      const query = `
        SELECT * 
        FROM attendance_settings 
        WHERE scope = 'global' 
        ORDER BY created_at DESC 
        LIMIT 1
      `;

      const result = await pool.query(query);

      if (result.rows.length === 0) {
        // Return default settings
        res.json({
          success: true,
          settings: {
            grace_period_lateness_minutes: 15,
            grace_period_early_departure_minutes: 15,
            calculate_late_early_hours: true,
            auto_calculate_overtime: true,
            default_scheduled_work_hours: 8.0
          }
        });
      } else {
        res.json({
          success: true,
          settings: result.rows[0]
        });
      }

    } catch (error) {
      console.error('Get attendance settings error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve attendance settings',
        details: error.message 
      });
    }
  });

  // Update attendance settings
  router.put('/settings', verifyToken, async (req, res) => {
    try {
      const {
        grace_period_lateness_minutes,
        grace_period_early_departure_minutes,
        calculate_late_early_hours,
        auto_calculate_overtime,
        default_scheduled_work_hours
      } = req.body;

      const userId = req.user.userId;

      // Check if global settings exist
      const existingSettings = await pool.query(`
        SELECT id FROM attendance_settings WHERE scope = 'global' LIMIT 1
      `);

      let result;
      if (existingSettings.rows.length > 0) {
        // Update existing settings
        result = await pool.query(`
          UPDATE attendance_settings SET
            grace_period_lateness_minutes = $1,
            grace_period_early_departure_minutes = $2,
            calculate_late_early_hours = $3,
            auto_calculate_overtime = $4,
            default_scheduled_work_hours = $5,
            updated_at = CURRENT_TIMESTAMP
          WHERE scope = 'global'
          RETURNING *
        `, [
          grace_period_lateness_minutes || 15,
          grace_period_early_departure_minutes || 15,
          calculate_late_early_hours !== false,
          auto_calculate_overtime !== false,
          default_scheduled_work_hours || 8.0
        ]);
      } else {
        // Insert new settings
        result = await pool.query(`
          INSERT INTO attendance_settings
          (
            scope,
            grace_period_lateness_minutes,
            grace_period_early_departure_minutes,
            calculate_late_early_hours,
            auto_calculate_overtime,
            default_scheduled_work_hours
          )
          VALUES ('global', $1, $2, $3, $4, $5)
          RETURNING *
        `, [
          grace_period_lateness_minutes || 15,
          grace_period_early_departure_minutes || 15,
          calculate_late_early_hours !== false,
          auto_calculate_overtime !== false,
          default_scheduled_work_hours || 8.0
        ]);
      }

      // Log audit trail
      await pool.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'attendance_settings',
        result.rows[0].id,
        'upsert',
        userId,
        JSON.stringify(req.body)
      ]);

      res.json({
        success: true,
        settings: result.rows[0],
        message: 'Attendance settings updated successfully'
      });

    } catch (error) {
      console.error('Update attendance settings error:', error);
      res.status(500).json({ 
        error: 'Failed to update attendance settings',
        details: error.message 
      });
    }
  });

  // ============================================================================
  // UTILITY ROUTES
  // ============================================================================

  // Get departments
  router.get('/departments', verifyToken, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM departments ORDER BY name');

      res.json({
        success: true,
        departments: result.rows
      });

    } catch (error) {
      console.error('Get departments error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve departments',
        details: error.message 
      });
    }
  });

  // Get employee details
  router.get('/employee/:employeeId', verifyToken, async (req, res) => {
    try {
      const { employeeId } = req.params;

      const query = `
        SELECT 
          e.*,
          e.first_name || ' ' || e.last_name AS full_name,
          p.name AS position_name,
          d.name AS department_name
        FROM employees e
        LEFT JOIN positions p ON e.position_id = p.id
        LEFT JOIN employee_departments ed ON e.id = ed.employee_id
        LEFT JOIN departments d ON ed.department_id = d.id
        WHERE e.id = $1
      `;

      const result = await pool.query(query, [employeeId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      res.json({
        success: true,
        employee: result.rows[0]
      });

    } catch (error) {
      console.error('Get employee details error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve employee details',
        details: error.message 
      });
    }
  });

  // Get current employee (for logged-in user)
  router.get('/current-employee', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;

      const query = `
        SELECT 
          e.*,
          e.first_name || ' ' || e.last_name AS full_name,
          p.name AS position_name,
          d.name AS department_name
        FROM employees e
        LEFT JOIN positions p ON e.position_id = p.id
        LEFT JOIN employee_departments ed ON e.id = ed.employee_id
        LEFT JOIN departments d ON ed.department_id = d.id
        WHERE e.user_id = $1
      `;

      const result = await pool.query(query, [userId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Employee record not found' });
      }

      res.json({
        success: true,
        employee: result.rows[0]
      });

    } catch (error) {
      console.error('Get current employee error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve current employee',
        details: error.message 
      });
    }
  });

  // Revert day to calculated
  router.post('/daily/revert/:employeeId/:date', verifyToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const { employeeId, date } = req.params;
      const userId = req.user.userId;

      // Remove overrides for this day
      await client.query(
        'DELETE FROM attendance_overrides WHERE employee_id = $1 AND date = $2',
        [employeeId, date]
      );

      // Remove daily attendance record
      await client.query(
        'DELETE FROM employee_daily_attendance WHERE employee_id = $1 AND date = $2',
        [employeeId, date]
      );

      // Log audit trail
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'daily_attendance',
        employeeId,
        'revert_to_calculated',
        userId,
        JSON.stringify({ date })
      ]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Day record reverted to calculated values'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Revert to calculated error:', error);
      res.status(500).json({ 
        error: 'Failed to revert day record',
        details: error.message 
      });
    } finally {
      client.release();
    }
  });

  // Delete manual overrides for a specific day (without removing daily attendance record)
  router.delete('/overrides/:employeeId/:date', verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { employeeId, date } = req.params;
      const userId = req.user.userId;

      // Fetch overrides for this employee/day
      const existing = await client.query(
        'SELECT id, override_type, exception_id FROM attendance_overrides WHERE employee_id = $1 AND date = $2 FOR UPDATE',
        [employeeId, date]
      );

      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No overrides found for this day' });
      }

      // Only allow deletion for MissingPunch type overrides (override_type = 'punch_add')
      const nonPunch = existing.rows.find(r => String(r.override_type) !== 'punch_add');
      if (nonPunch) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only Missing Punch overrides can be deleted' });
      }

      const exceptionIds = existing.rows.map(r => r.exception_id).filter(Boolean);

      // Delete overrides
      const del = await client.query(
        'DELETE FROM attendance_overrides WHERE employee_id = $1 AND date = $2 AND override_type = $3 RETURNING id, override_type, exception_id',
        [employeeId, date, 'punch_add']
      );

      // Delete linked exceptions as well (if any)
      let deletedExceptions = { rowCount: 0, rows: [] };
      if (exceptionIds.length > 0) {
        deletedExceptions = await client.query(
          'DELETE FROM attendance_exceptions WHERE id = ANY($1::uuid[]) RETURNING id, type, status, date',
          [exceptionIds]
        );
      }

      // Log audit trail
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'attendance_override',
        employeeId,
        'delete_overrides_for_day',
        userId,
        JSON.stringify({ date, deleted_overrides: del.rowCount, deleted_exceptions: deletedExceptions.rowCount, overrides: del.rows, exception_ids: exceptionIds })
      ]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Missing punch overrides (and linked exceptions) deleted for the selected day',
        deleted_overrides: del.rowCount,
        deleted_exceptions: deletedExceptions.rowCount
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Delete day overrides error:', error);
      res.status(500).json({ 
        error: 'Failed to delete overrides for day',
        details: error.message 
      });
    } finally {
      client.release();
    }
  });

  // ============================================================================
  // EMPLOYEES ROUTES
  // ============================================================================

  // Get all employees
  router.get('/employees', verifyToken, async (req, res) => {
    try {
      const { search, sort_by = 'first_name', user_id } = req.query;
      
      let query = `
        SELECT e.*, 
               p.name as position_name, 
               u.username, 
               u.role,
               e.first_name || ' ' || e.last_name AS full_name,
               ps.base_salary,
               ps.hourly_rate,
               ps.overtime_rate,
               s.amount as salary_amount
        FROM employees e
        LEFT JOIN positions p ON e.position_id = p.id
        LEFT JOIN users u ON e.user_id = u.id
        LEFT JOIN position_salaries ps ON p.id = ps.position_id 
          AND ps.effective_date = (
            SELECT MAX(ps2.effective_date) 
            FROM position_salaries ps2 
            WHERE ps2.position_id = p.id 
            AND ps2.effective_date <= CURRENT_DATE
          )
        LEFT JOIN salaries s ON e.id = s.employee_id
          AND s.effective_date = (
            SELECT MAX(s2.effective_date)
            FROM salaries s2
            WHERE s2.employee_id = e.id
            AND s2.effective_date <= CURRENT_DATE
          )
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
      
      // Post-process to ensure salary data is always present and properly formatted
      const employees = result.rows.map(emp => {
        // Prioritize individual salary over position base salary
        const finalSalary = parseFloat(emp.salary_amount) || parseFloat(emp.base_salary) || 0;
        
        return {
          ...emp,
          // Ensure all salary fields are numbers (not null/undefined)
          salary_amount: parseFloat(emp.salary_amount) || parseFloat(emp.base_salary) || 0,
          base_salary: parseFloat(emp.base_salary) || 0,
          hourly_rate: parseFloat(emp.hourly_rate) || 0,
          overtime_rate: parseFloat(emp.overtime_rate) || 0,
          // Add computed flags for better frontend handling
          has_salary_data: finalSalary > 0,
          has_individual_salary: !!(emp.salary_amount),
          has_position_salary: !!(emp.base_salary)
        };
      });
      
      res.json({
        success: true,
        employees,
        // Add summary statistics
        stats: {
          total: employees.length,
          with_salary: employees.filter(e => e.has_salary_data).length,
          without_salary: employees.filter(e => !e.has_salary_data).length,
          with_individual_salary: employees.filter(e => e.has_individual_salary).length,
          with_position_salary_only: employees.filter(e => !e.has_individual_salary && e.has_position_salary).length
        }
      });
    } catch (error) {
      console.error('Get employees error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve employees',
        details: error.message 
      });
    }
  });

  // Get departments
  router.get('/departments', verifyToken, async (req, res) => {
    try {
      const query = `
        SELECT d.*, COUNT(ed.employee_id) as employee_count
        FROM departments d
        LEFT JOIN employee_departments ed ON d.id = ed.department_id
        GROUP BY d.id, d.name, d.description, d.created_at
        ORDER BY d.name
      `;
      
      const result = await pool.query(query);
      
      res.json({
        success: true,
        departments: result.rows
      });
    } catch (error) {
      console.error('Get departments error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve departments',
        details: error.message 
      });
    }
  });

  return router;
};

module.exports = {
  initializeRoutes,
  setAuthMiddleware
};