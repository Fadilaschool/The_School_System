const express = require('express');
const { Pool } = require('pg');
const moment = require('moment-timezone');

// Timezone handling removed - all times handled in UTC as stored in database

// JWT verification middleware (will be injected)
let verifyToken;

const setAuthMiddleware = (authMiddleware) => {
  verifyToken = authMiddleware;
};

const initializeRoutes = (dbPool) => {
  const router = express.Router();
  const pool = dbPool;

  // ============================================================================
  // MASTER ATTENDANCE LOG ROUTES
  // ============================================================================

  // Get monthly attendance statistics for all employees
  router.get('/monthly', verifyToken, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const { year, month, department, status, search } = req.query;

      // Validate required parameters
      if (!year || !month) {
        return res.status(400).json({
          error: 'Year and month are required parameters',
          details: `Received year: ${year}, month: ${month}`
        });
      }

      const yearInt = parseInt(year);
      const monthInt = parseInt(month);

      // Validate that year and month are valid numbers
      if (isNaN(yearInt) || isNaN(monthInt)) {
        return res.status(400).json({
          error: 'Year and month must be valid numbers',
          details: `Received year: ${year}, month: ${month}`
        });
      }

      // Validate month range (1-12)
      if (monthInt < 1 || monthInt > 12) {
        return res.status(400).json({
          error: 'Month must be between 1 and 12',
          details: `Received month: ${month}`
        });
      }

      // Validate year range (reasonable bounds)
      if (yearInt < 2000 || yearInt > 2100) {
        return res.status(400).json({
          error: 'Year must be between 2000 and 2100',
          details: `Received year: ${year}`
        });
      }

      const offset = (page - 1) * limit;
      let whereConditions = [];
      let queryParams = [limit, offset, yearInt, monthInt];
      let paramIndex = 5;

      // Get grace period settings
      const settingsQuery = `
        SELECT grace_period_lateness_minutes, grace_period_early_departure_minutes
        FROM attendance_settings 
        WHERE scope = 'global' 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const settingsResult = await pool.query(settingsQuery);
      const settings = settingsResult.rows[0] || { grace_period_lateness_minutes: 15, grace_period_early_departure_minutes: 15 };
      const latenessGrace = settings.grace_period_lateness_minutes || 15;
      const earlyGrace = settings.grace_period_early_departure_minutes || 15;

      // Add filters
      if (department) {
        whereConditions.push(`ed.department_id = $${paramIndex}`);
        queryParams.push(department);
        paramIndex++;
      }

      if (status) {
        if (status === 'Validated') {
          whereConditions.push(`cms.is_validated = true`);
        } else if (status === 'Calculated') {
          whereConditions.push(`(cms.is_validated = false OR cms.is_validated IS NULL)`);
        }
      }

      if (search) {
        whereConditions.push(`(
          LOWER(e.first_name || ' ' || e.last_name) LIKE LOWER($${paramIndex}) OR
          LOWER(e.last_name || ' ' || e.first_name) LIKE LOWER($${paramIndex})
        )`);
        queryParams.push(`%${search}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      const query = `
        WITH employee_stats AS (
          SELECT
            e.id as employee_id,
            e.first_name || ' ' || e.last_name AS employee_name,
            d.name AS department_name,
            p.name AS position_name,
            $3 AS year,
            $4 AS month,
            -- Calculate scheduled days from timetable
            (SELECT COUNT(DISTINCT gs.date)
            FROM generate_series(
              date_trunc('month', make_date($3::integer, $4::integer, 1))::date,
              (date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day')::date,
              '1 day'::interval
            ) AS gs(date)
            WHERE EXISTS (
              SELECT 1 FROM timetable_intervals ti
              JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
              WHERE et.employee_id = e.id
                AND (
                  EXTRACT(ISODOW FROM gs.date) = ti.weekday
                  OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM gs.date) = 7)
                )
                AND gs.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                AND COALESCE(et.effective_to, '2100-12-31')
            )
            ) AS scheduled_days,
            -- Calculate worked days (Present status) - excluding pending cases
            (
              SELECT COUNT(*)
              FROM (
                SELECT
                  d.date,
                  CASE
                    -- Treated pending cases (stored in details field)
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent'
                    -- Single punch cases go to Pending (if not treated)
                    WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
                    -- Other overrides
                    WHEN ao.override_type IS NOT NULL THEN 'Present'
                    -- Complete attendance (2+ punches)
                    WHEN dp.punch_count >= 2 THEN 'Present'
                    ELSE 'Absent'
                  END AS status
                FROM
                  generate_series(
                    date_trunc('month', make_date($3::integer, $4::integer, 1))::date,
                    (date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day')::date,
                    '1 day'::interval
                  ) AS d(date)
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $3
                    AND EXTRACT(MONTH FROM rp.punch_time) = $4
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
                WHERE EXISTS (
                  SELECT 1 FROM timetable_intervals ti
                  JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
                  WHERE et.employee_id = e.id
                    AND (
                      EXTRACT(ISODOW FROM d.date) = ti.weekday
                      OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date) = 7)
                    )
                    AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                )
              ) daily_records
              WHERE status = 'Present'
            ) AS worked_days,
            -- Calculate absence days
            (
              SELECT COUNT(*)
              FROM (
                SELECT
                  d.date,
                  CASE
                    -- Treated pending cases (stored in details field)
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent'
                    -- Single punch cases go to Pending (if not treated)
                    WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
                    -- Other overrides
                    WHEN ao.override_type IS NOT NULL THEN 'Present'
                    -- Complete attendance (2+ punches)
                    WHEN dp.punch_count >= 2 THEN 'Present'
                    ELSE 'Absent'
                  END AS status
                FROM
                  generate_series(
                    date_trunc('month', make_date($3::integer, $4::integer, 1)),
                    date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                    '1 day'::interval
                  ) AS d(date)
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $3
                    AND EXTRACT(MONTH FROM rp.punch_time) = $4
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
                WHERE EXISTS (
                  SELECT 1 FROM timetable_intervals ti
                  JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
                  WHERE et.employee_id = e.id
                    AND (
                      EXTRACT(ISODOW FROM d.date) = ti.weekday
                      OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date) = 7)
                    )
                    AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                )
              ) daily_records
              WHERE status = 'Absent'
            ) AS absence_days,
            -- Calculate pending days (NEW) - untreated single punch days
            (
              SELECT COUNT(*)
              FROM (
                SELECT
                  d.date,
                  CASE
                    -- Treated pending cases (stored in details field)
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent'
                    -- Single punch cases go to Pending (if not treated)
                    WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
                    -- Other overrides
                    WHEN ao.override_type IS NOT NULL THEN 'Present'
                    -- Complete attendance (2+ punches)
                    WHEN dp.punch_count >= 2 THEN 'Present'
                    ELSE 'Absent'
                  END AS status
                FROM
                  generate_series(
                    date_trunc('month', make_date($3::integer, $4::integer, 1)),
                    date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                    '1 day'::interval
                  ) AS d(date)
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $3
                    AND EXTRACT(MONTH FROM rp.punch_time) = $4
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
                WHERE EXISTS (
                  SELECT 1 FROM timetable_intervals ti
                  JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
                  WHERE et.employee_id = e.id
                    AND (
                      EXTRACT(ISODOW FROM d.date) = ti.weekday
                      OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date) = 7)
                    )
                    AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                )
              ) daily_records
              WHERE status = 'Pending'
            ) AS pending_days,
            -- Calculate late minutes
            (
              SELECT SUM(late_minutes)
              FROM (
                SELECT
                  d.date,
                  dp.punch_count,
                  (ao.override_type IS NOT NULL) AS is_overridden,
                  CASE
                    WHEN dp.entry_time_ts IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN
                      GREATEST(0,
                        EXTRACT(EPOCH FROM ((dp.entry_time_ts - (si.intervals->0->>'start_time')::time)))/60 - ${latenessGrace}
                      )::integer
                    ELSE 0
                  END AS late_minutes
                FROM
                  generate_series(
                    date_trunc('month', make_date($3::integer, $4::integer, 1)),
                    date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                    '1 day'::interval
                  ) AS d(date)
                JOIN (
                  SELECT
                    sd.date,
                    sd.day_of_week,
                    jsonb_agg(
                      jsonb_build_object(
                        'start_time', ti.start_time::text,
                        'end_time', ti.end_time::text,
                        'break_minutes', ti.break_minutes
                      ) ORDER BY ti.start_time
                    ) AS intervals
                  FROM (
                    SELECT
                      d.date,
                      EXTRACT(DOW FROM d.date)::integer AS day_of_week
                    FROM
                      generate_series(
                        date_trunc('month', make_date($3::integer, $4::integer, 1)),
                        date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                        '1 day'::interval
                      ) AS d(date)
                  ) sd
                  JOIN employee_timetables et ON et.employee_id = e.id
                    AND sd.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                  JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
                    AND ti.weekday = sd.day_of_week
                  GROUP BY sd.date, sd.day_of_week
                ) si ON d.date = si.date
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    CASE
                      WHEN COUNT(*) = 1 THEN
                        CASE
                          WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) < 12 THEN MIN(rp.punch_time)::time
                          ELSE NULL
                        END
                      ELSE MIN(rp.punch_time)::time
                    END AS entry_time_ts,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $3
                    AND EXTRACT(MONTH FROM rp.punch_time) = $4
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
              ) late_calc
              WHERE punch_count >= 1 AND NOT is_overridden
            ) AS late_minutes,
            -- Count of late days (days with positive late minutes)
            (
              SELECT COUNT(*)
              FROM (
                SELECT
                  d.date,
                  dp.punch_count,
                  (ao.override_type IS NOT NULL) AS is_overridden,
                  CASE
                    WHEN dp.entry_time_ts IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN
                      GREATEST(0,
                        EXTRACT(EPOCH FROM ((dp.entry_time_ts - (si.intervals->0->>'start_time')::time)))/60 - ${latenessGrace}
                      )::integer
                    ELSE 0
                  END AS late_minutes
                FROM
                  generate_series(
                    date_trunc('month', make_date($3::integer, $4::integer, 1)),
                    date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                    '1 day'::interval
                  ) AS d(date)
                JOIN (
                  SELECT
                    sd.date,
                    sd.day_of_week,
                    jsonb_agg(
                      jsonb_build_object(
                        'start_time', ti.start_time::text,
                        'end_time', ti.end_time::text,
                        'break_minutes', ti.break_minutes
                      ) ORDER BY ti.start_time
                    ) AS intervals
                  FROM (
                    SELECT
                      d.date,
                      EXTRACT(DOW FROM d.date)::integer AS day_of_week
                    FROM
                      generate_series(
                        date_trunc('month', make_date($3::integer, $4::integer, 1)),
                        date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                        '1 day'::interval
                      ) AS d(date)
                  ) sd
                  JOIN employee_timetables et ON et.employee_id = e.id
                    AND sd.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                  JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
                    AND ti.weekday = sd.day_of_week
                  GROUP BY sd.date, sd.day_of_week
                ) si ON d.date = si.date
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    CASE
                      WHEN COUNT(*) = 1 THEN
                        CASE
                          WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) < 12 THEN MIN(rp.punch_time)::time
                          ELSE NULL
                        END
                      ELSE MIN(rp.punch_time)::time
                    END AS entry_time_ts,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $3
                    AND EXTRACT(MONTH FROM rp.punch_time) = $4
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
              ) late_calc
              WHERE punch_count >= 1 AND NOT is_overridden AND late_minutes > 0
            ) AS late_count,
            -- Calculate early minutes
            (
              SELECT SUM(early_minutes)
              FROM (
                SELECT
                  d.date,
                  dp.punch_count,
                  (ao.override_type IS NOT NULL) AS is_overridden,
                  CASE
                    WHEN dp.exit_time_ts IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN
                      GREATEST(0,
                        EXTRACT(EPOCH FROM (((si.intervals->-1->>'end_time')::time - dp.exit_time_ts)))/60 - ${earlyGrace}
                      )::integer
                    ELSE 0
                  END AS early_minutes
                FROM
                  generate_series(
                    date_trunc('month', make_date($3::integer, $4::integer, 1)),
                    date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                    '1 day'::interval
                  ) AS d(date)
                JOIN (
                  SELECT
                    sd.date,
                    sd.day_of_week,
                    jsonb_agg(
                      jsonb_build_object(
                        'start_time', ti.start_time::text,
                        'end_time', ti.end_time::text,
                        'break_minutes', ti.break_minutes
                      ) ORDER BY ti.start_time
                    ) AS intervals
                  FROM (
                    SELECT
                      d.date,
                      EXTRACT(DOW FROM d.date)::integer AS day_of_week
                    FROM
                      generate_series(
                        date_trunc('month', make_date($3::integer, $4::integer, 1)),
                        date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                        '1 day'::interval
                      ) AS d(date)
                  ) sd
                  JOIN employee_timetables et ON et.employee_id = e.id
                    AND sd.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                  JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
                    AND ti.weekday = sd.day_of_week
                  GROUP BY sd.date, sd.day_of_week
                ) si ON d.date = si.date
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    CASE
                      WHEN COUNT(*) = 1 THEN
                        CASE
                          WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) >= 12 THEN MIN(rp.punch_time)::time
                          ELSE NULL
                        END
                      ELSE MAX(rp.punch_time)::time
                    END AS exit_time_ts,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $3
                    AND EXTRACT(MONTH FROM rp.punch_time) = $4
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
              ) early_calc
              WHERE punch_count >= 1 AND NOT is_overridden
            ) AS early_minutes,
            -- Count of early-leave days (days with positive early minutes)
            (
              SELECT COUNT(*)
              FROM (
                SELECT
                  d.date,
                  dp.punch_count,
                  (ao.override_type IS NOT NULL) AS is_overridden,
                  CASE
                    WHEN dp.exit_time_ts IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN
                      GREATEST(0,
                        EXTRACT(EPOCH FROM (((si.intervals->-1->>'end_time')::time - dp.exit_time_ts)))/60 - ${earlyGrace}
                      )::integer
                    ELSE 0
                  END AS early_minutes
                FROM
                  generate_series(
                    date_trunc('month', make_date($3::integer, $4::integer, 1)),
                    date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                    '1 day'::interval
                  ) AS d(date)
                JOIN (
                  SELECT
                    sd.date,
                    sd.day_of_week,
                    jsonb_agg(
                      jsonb_build_object(
                        'start_time', ti.start_time::text,
                        'end_time', ti.end_time::text,
                        'break_minutes', ti.break_minutes
                      ) ORDER BY ti.start_time
                    ) AS intervals
                  FROM (
                    SELECT
                      d.date,
                      EXTRACT(DOW FROM d.date)::integer AS day_of_week
                    FROM
                      generate_series(
                        date_trunc('month', make_date($3::integer, $4::integer, 1)),
                        date_trunc('month', make_date($3::integer, $4::integer, 1)) + interval '1 month - 1 day',
                        '1 day'::interval
                      ) AS d(date)
                  ) sd
                  JOIN employee_timetables et ON et.employee_id = e.id
                    AND sd.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                  JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
                    AND ti.weekday = sd.day_of_week
                  GROUP BY sd.date, sd.day_of_week
                ) si ON d.date = si.date
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    CASE
                      WHEN COUNT(*) = 1 THEN
                        CASE
                          WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) >= 12 THEN MIN(rp.punch_time)::time
                          ELSE NULL
                        END
                      ELSE MAX(rp.punch_time)::time
                    END AS exit_time_ts,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $3
                    AND EXTRACT(MONTH FROM rp.punch_time) = $4
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
              ) early_calc
              WHERE punch_count >= 1 AND NOT is_overridden AND early_minutes > 0
            ) AS early_count,
            -- Get overtime hours
            (
              SELECT SUM(hours)
              FROM employee_overtime_hours eoh
              WHERE eoh.employee_id = e.id
                AND EXTRACT(YEAR FROM eoh.date) = $3
                AND EXTRACT(MONTH FROM eoh.date) = $4
            ) AS overtime_hours,
            -- Get wage changes (raise - credit - decrease)
            (
              SELECT SUM(
                CASE
                  WHEN adjustment_type = 'decrease' THEN -amount
                  WHEN adjustment_type = 'credit' THEN -amount
                  WHEN adjustment_type = 'raise' THEN amount
                  ELSE amount
                END
              )
              FROM employee_salary_adjustments esa
              WHERE esa.employee_id = e.id
                AND EXTRACT(YEAR FROM esa.effective_date) = $3
                AND EXTRACT(MONTH FROM esa.effective_date) = $4
            ) AS wage_changes,
            -- Validation status
            cms.is_validated AS validation_status_bool,
            CASE WHEN cms.is_validated THEN 'Validated' ELSE 'Calculated' END AS validation_status
          FROM employees e
          LEFT JOIN comprehensive_monthly_statistics cms ON e.id = cms.employee_id AND cms.year = $3 AND cms.month = $4
          LEFT JOIN employee_departments ed ON e.id = ed.employee_id
          LEFT JOIN departments d ON ed.department_id = d.id
          LEFT JOIN positions p ON e.position_id = p.id
          ${whereClause}
        )
        SELECT
          employee_id,
          employee_name,
          department_name,
          position_name,
          year,
          month,
          scheduled_days,
          worked_days,
          absence_days,
          pending_days,
          late_minutes,
          early_minutes,
          overtime_hours,
          wage_changes,
          validation_status_bool,
          validation_status,
          COUNT(*) OVER() AS total_count
        FROM employee_stats
        ORDER BY employee_name, year DESC, month DESC
        LIMIT $1 OFFSET $2
      `;

      const result = await pool.query(query, queryParams);

      const data = result.rows.map(row => ({
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        department_name: row.department_name,
        position_name: row.position_name,
        year: row.year,
        month: row.month,
        scheduled_days: row.scheduled_days || 0,
        worked_days: row.worked_days || 0,
        absence_days: row.absence_days || 0,
        pending_days: parseInt(row.pending_days, 10) || 0,
        late_minutes: row.late_minutes || 0,
        early_minutes: row.early_minutes || 0,
        overtime_hours: row.overtime_hours || 0,
        wage_changes: row.wage_changes || 0,
        validation_status: row.validation_status || 'Not Applicable'
      }));

      const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

      // Get statistics (rebuild WHERE with correct parameter indices for this query)
      const statsParams = [yearInt, monthInt];
      const statsConditions = [];
      let statsParamIndex = 3; // $1,$2 used by year,month above

      if (department) {
        statsConditions.push(`ed.department_id = $${statsParamIndex}`);
        statsParams.push(department);
        statsParamIndex++;
      }

      if (status) {
        if (status === 'Validated') {
          statsConditions.push(`cms.is_validated = true`);
        } else if (status === 'Calculated') {
          statsConditions.push(`(cms.is_validated = false OR cms.is_validated IS NULL)`);
        }
      }

      if (search) {
        statsConditions.push(`(
          LOWER(e.first_name || ' ' || e.last_name) LIKE LOWER($${statsParamIndex}) OR
          LOWER(e.last_name || ' ' || e.first_name) LIKE LOWER($${statsParamIndex})
        )`);
        statsParams.push(`%${search}%`);
        statsParamIndex++;
      }

      const statsWhereClause = statsConditions.length > 0 ? `WHERE ${statsConditions.join(' AND ')}` : '';

      const statsQuery = `
        SELECT
          COUNT(DISTINCT e.id) AS total_employees,
          COUNT(CASE WHEN cms.is_validated THEN 1 END) AS validated_records,
          COUNT(CASE WHEN cms.is_validated = false THEN 1 END) AS pending_validation,
          COUNT(CASE WHEN cms.employee_id IS NULL THEN 1 END) AS missing_punches
        FROM employees e
        LEFT JOIN employee_departments ed ON e.id = ed.employee_id
        LEFT JOIN comprehensive_monthly_statistics cms ON e.id = cms.employee_id AND cms.year = $1 AND cms.month = $2
        ${statsWhereClause}
      `;

      const statsResult = await pool.query(statsQuery, statsParams);
      const statistics = statsResult.rows[0] || {};

      // Aggregate pending using per-employee data to match daily logic
      const aggregatedPending = data.reduce((sum, row) => (Number(sum) || 0) + (Number(row.pending_days) || 0), 0);

      // Use aggregatedPending to ensure parity with daily logic
      const pendingCases = aggregatedPending;

      res.json({
        success: true,
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        },
        statistics: {
          total_employees: parseInt(statistics.total_employees) || 0,
          validated_records: parseInt(statistics.validated_records) || 0,
          pending_validation: parseInt(statistics.pending_validation) || 0,
          pending_cases: pendingCases,
          missing_punches: parseInt(statistics.missing_punches) || 0
        }
      });

    } catch (error) {
      console.error('Get monthly attendance error:', {
        message: error.message,
        stack: error.stack,
        query: { year, month, page, limit, department, status, search },
        yearInt: typeof yearInt !== 'undefined' ? yearInt : 'not defined',
        monthInt: typeof monthInt !== 'undefined' ? monthInt : 'not defined'
      });
      res.status(500).json({
        error: 'Failed to retrieve monthly attendance data',
        details: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  });

  // Get available years for filtering
  router.get('/years', verifyToken, async (req, res) => {
    try {
      const query = `
        SELECT DISTINCT year 
        FROM comprehensive_monthly_statistics 
        ORDER BY year DESC
      `;

      const result = await pool.query(query);
      const years = result.rows.map(row => row.year);

      res.json({
        success: true,
        years
      });

    } catch (error) {
      console.error('Get available years error:', error);
      res.status(500).json({
        error: 'Failed to retrieve available years',
        details: error.message
      });
    }
  });

  // Get monthly statistics (aggregate data for dashboard)
  router.get('/monthly-statistics', verifyToken, async (req, res) => {
    try {
      const { year, month, department } = req.query;

      if (!year || !month) {
        return res.status(400).json({ error: 'Year and month are required' });
      }

      const y = parseInt(year);
      const m = parseInt(month);

      let departmentCondition = '';
      let queryParams = [y, m];

      if (department) {
        departmentCondition = 'AND ed.department_id = $3';
        queryParams.push(department);
      }

      // Calculate aggregate statistics for the month
      const statsQuery = `
        WITH employee_stats AS (
          SELECT
            e.id as employee_id,
            -- Calculate scheduled days from timetable
            (SELECT COUNT(DISTINCT gs.date)
            FROM generate_series(
              date_trunc('month', make_date($1::integer, $2::integer, 1))::date,
              (date_trunc('month', make_date($1::integer, $2::integer, 1)) + interval '1 month - 1 day')::date,
              '1 day'::interval
            ) AS gs(date)
            WHERE EXISTS (
              SELECT 1 FROM timetable_intervals ti
              JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
              WHERE et.employee_id = e.id
                AND (
                  EXTRACT(ISODOW FROM gs.date) = ti.weekday
                  OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM gs.date) = 7)
                )
                AND gs.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                AND COALESCE(et.effective_to, '2100-12-31')
            )
            ) AS scheduled_days,
            -- Calculate worked days (Present status)
            (
              SELECT COUNT(*)
              FROM (
                SELECT
                  d.date,
                  CASE
                    -- Treated pending cases
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent'
                    -- Single punch cases go to Pending (if not treated)
                    WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
                    -- Other overrides
                    WHEN ao.override_type IS NOT NULL THEN 'Present'
                    -- Complete attendance (2+ punches)
                    WHEN dp.punch_count >= 2 THEN 'Present'
                    ELSE 'Absent'
                  END AS status
                FROM
                  generate_series(
                    date_trunc('month', make_date($1::integer, $2::integer, 1))::date,
                    (date_trunc('month', make_date($1::integer, $2::integer, 1)) + interval '1 month - 1 day')::date,
                    '1 day'::interval
                  ) AS d(date)
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $1
                    AND EXTRACT(MONTH FROM rp.punch_time) = $2
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
                WHERE EXISTS (
                  SELECT 1 FROM timetable_intervals ti
                  JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
                  WHERE et.employee_id = e.id
                    AND (
                      EXTRACT(ISODOW FROM d.date) = ti.weekday
                      OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date) = 7)
                    )
                    AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                )
              ) daily_records
              WHERE status = 'Present'
            ) AS worked_days,
            -- Calculate pending days
            (
              SELECT COUNT(*)
              FROM (
                SELECT
                  d.date,
                  CASE
                    -- Treated pending cases
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present'
                    WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent'
                    -- Single punch cases go to Pending (if not treated)
                    WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
                    -- Other overrides
                    WHEN ao.override_type IS NOT NULL THEN 'Present'
                    -- Complete attendance (2+ punches)
                    WHEN dp.punch_count >= 2 THEN 'Present'
                    ELSE 'Absent'
                  END AS status
                FROM
                  generate_series(
                    date_trunc('month', make_date($1::integer, $2::integer, 1)),
                    date_trunc('month', make_date($1::integer, $2::integer, 1)) + interval '1 month - 1 day',
                    '1 day'::interval
                  ) AS d(date)
                LEFT JOIN (
                  SELECT
                    rp.punch_time::date AS date,
                    COUNT(*) AS punch_count
                  FROM raw_punches rp
                  WHERE
                    lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
                      lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
                    )
                    AND EXTRACT(YEAR FROM rp.punch_time) = $1
                    AND EXTRACT(MONTH FROM rp.punch_time) = $2
                  GROUP BY rp.punch_time::date
                ) dp ON d.date = dp.date
                LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = d.date
                WHERE EXISTS (
                  SELECT 1 FROM timetable_intervals ti
                  JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
                  WHERE et.employee_id = e.id
                    AND (
                      EXTRACT(ISODOW FROM d.date) = ti.weekday
                      OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date) = 7)
                    )
                    AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                    AND COALESCE(et.effective_to, '2100-12-31')
                )
              ) daily_records
              WHERE status = 'Pending'
            ) AS pending_days
          FROM employees e
          LEFT JOIN employee_departments ed ON e.id = ed.employee_id
          WHERE 1=1
          ${departmentCondition}
        ),
        validation_stats AS (
          SELECT
            COUNT(DISTINCT CASE WHEN cms.is_validated = true THEN cms.employee_id END) AS validated_count,
            COUNT(DISTINCT CASE WHEN (cms.is_validated = false OR cms.is_validated IS NULL) THEN cms.employee_id END) AS pending_validation_count
          FROM comprehensive_monthly_statistics cms
          LEFT JOIN employee_departments ed ON cms.employee_id = ed.employee_id
          WHERE cms.year = $1 AND cms.month = $2
          ${departmentCondition}
        )
        SELECT
          COALESCE(SUM(es.scheduled_days), 0) AS total_scheduled_days,
          COALESCE(SUM(es.worked_days), 0) AS total_worked_days,
          COALESCE(SUM(es.pending_days), 0) AS total_pending_days,
          COUNT(DISTINCT es.employee_id) AS total_employees,
          vs.validated_count,
          vs.pending_validation_count,
          CASE 
            WHEN COALESCE(SUM(es.scheduled_days), 0) > 0 
            THEN ROUND((COALESCE(SUM(es.worked_days), 0)::numeric / SUM(es.scheduled_days)::numeric) * 100, 2)
            ELSE 0
          END AS attendance_rate
        FROM employee_stats es
        CROSS JOIN validation_stats vs
        GROUP BY vs.validated_count, vs.pending_validation_count
      `;

      const result = await pool.query(statsQuery, queryParams);
      const stats = result.rows[0] || {
        total_scheduled_days: 0,
        total_worked_days: 0,
        total_pending_days: 0,
        total_employees: 0,
        validated_count: 0,
        pending_validation_count: 0,
        attendance_rate: 0
      };

      res.json({
        success: true,
        attendance_rate: parseFloat(stats.attendance_rate) || 0,
        validated_records: parseInt(stats.validated_count) || 0,
        pending_validation: parseInt(stats.pending_validation_count) || 0,
        partial_pending: parseInt(stats.total_pending_days) || 0,
        total_employees: parseInt(stats.total_employees) || 0,
        total_scheduled_days: parseInt(stats.total_scheduled_days) || 0,
        total_worked_days: parseInt(stats.total_worked_days) || 0
      });

    } catch (error) {
      console.error('Get monthly statistics error:', error);
      res.status(500).json({
        error: 'Failed to retrieve monthly statistics',
        details: error.message
      });
    }
  });

  // ============================================================================
  // DAILY ATTENDANCE ROUTES
  // ============================================================================

  // Get employee daily attendance for a specific month
  router.get('/daily/:employeeId', verifyToken, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { year, month } = req.query;

      if (!year || !month) {
        return res.status(400).json({ error: 'Year and month are required' });
      }

      // Get grace period settings
      const settingsQuery = `
        SELECT grace_period_lateness_minutes, grace_period_early_departure_minutes
        FROM attendance_settings 
        WHERE scope = 'global' 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const settingsResult = await pool.query(settingsQuery);
      const settings = settingsResult.rows[0] || { grace_period_lateness_minutes: 15, grace_period_early_departure_minutes: 15 };
      const latenessGrace = settings.grace_period_lateness_minutes || 15;
      const earlyGrace = settings.grace_period_early_departure_minutes || 15;

      // Get employee details
      const employeeQuery = `
        SELECT
          e.id,
          e.first_name || ' ' || e.last_name AS full_name,
          e.first_name,
          e.last_name,
          p.name AS position_name,
          d.name AS department_name
        FROM employees e
        LEFT JOIN positions p ON e.position_id = p.id
        LEFT JOIN employee_departments ed ON e.id = ed.employee_id
        LEFT JOIN departments d ON ed.department_id = d.id
        WHERE e.id = $1
      `;

      const employeeResult = await pool.query(employeeQuery, [employeeId]);

      if (employeeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      const employee = employeeResult.rows[0];

      // Get daily attendance records with scheduled intervals
      const dailyQuery = `
        WITH month_days AS (
          SELECT 
            d.date::date AS date,
            EXTRACT(ISODOW FROM d.date)::integer AS day_of_week
          FROM generate_series(
            make_date($2, $3, 1),
            (make_date($2, $3, 1) + interval '1 month - 1 day')::date,
            '1 day'::interval
          ) AS d(date)
        ),
        scheduled_intervals AS (
          SELECT
            md.date,
            md.day_of_week,
            jsonb_agg(
              jsonb_build_object(
                'start_time', ti.start_time::text,
                'end_time', ti.end_time::text,
                'break_minutes', ti.break_minutes
              ) ORDER BY ti.start_time
            ) AS intervals
          FROM month_days md
          JOIN employee_timetables et ON et.employee_id = $1
            AND md.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
            AND COALESCE(et.effective_to, '2100-12-31')
          JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
            AND (
              ti.weekday = md.day_of_week
              OR (ti.weekday = 0 AND md.day_of_week = 7)
            )
          GROUP BY md.date, md.day_of_week
        ),
        daily_punches AS (
          SELECT
            rp.punch_time::date AS date,
            COUNT(*) AS punch_count,
            CASE
              WHEN COUNT(*) = 1 THEN
                CASE
                  WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) < 12 THEN
                    TO_CHAR(MIN(rp.punch_time), 'HH24:MI:SS')
                  ELSE NULL
                END
              ELSE
                TO_CHAR(MIN(rp.punch_time), 'HH24:MI:SS')
            END AS entry_time_str,
            CASE
              WHEN COUNT(*) = 1 THEN
                CASE
                  WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) >= 12 THEN
                    TO_CHAR(MIN(rp.punch_time), 'HH24:MI:SS')
                  ELSE NULL
                END
              ELSE
                TO_CHAR(MAX(rp.punch_time), 'HH24:MI:SS')
            END AS exit_time_str,
            CASE
              WHEN COUNT(*) = 1 THEN
                CASE
                  WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) < 12 THEN MIN(rp.punch_time)::time
                  ELSE NULL
                END
              ELSE MIN(rp.punch_time)::time
            END AS entry_time_ts,
            CASE
              WHEN COUNT(*) = 1 THEN
                CASE
                  WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) >= 12 THEN MIN(rp.punch_time)::time
                  ELSE NULL
                END
              ELSE MAX(rp.punch_time)::time
            END AS exit_time_ts
          FROM raw_punches rp
          WHERE
            lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
              lower(TRIM(BOTH FROM replace($4 || ' ' || $5, ' ', ''))),
              lower(TRIM(BOTH FROM replace($5 || ' ' || $4, ' ', ''))),
              lower(TRIM(BOTH FROM replace($4 || $5, ' ', ''))),
              lower(TRIM(BOTH FROM replace($5 || $4, ' ', '')))
            )
            AND EXTRACT(YEAR FROM rp.punch_time) = $2
            AND EXTRACT(MONTH FROM rp.punch_time) = $3
          GROUP BY rp.punch_time::date
        )
        SELECT
          md.date::text AS date,
          si.intervals AS scheduled_intervals,
          -- Entry/Exit/Punches: keep actual times for overridden days but mark them as overridden
          dp.entry_time_str AS entry_time,
          dp.exit_time_str AS exit_time,
          CASE
            WHEN ao.override_type IS NOT NULL THEN 0
            ELSE dp.punch_count
          END AS punch_count,
          -- Overtime hours aggregated per day to avoid duplicate/missing rows
          COALESCE(eoh.hours, 0) AS overtime_hours,
          -- Override type for display
          ao.override_type,
          -- Original status before override
          CASE
            WHEN dp.punch_count >= 1 THEN 'Present'
            ELSE 'Absent'
          END AS original_status,
          -- Effective status for counting (with Pending support)
          CASE
            -- Treated pending cases (stored in details field)
            WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present'
            WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present'
            WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent'
            -- Single punch cases go to Pending (if not treated)
            WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
            -- Other overrides
            WHEN ao.override_type IS NOT NULL THEN 'Present'
            -- Complete attendance (2+ punches)
            WHEN dp.punch_count >= 2 THEN 'Present'
            ELSE CASE WHEN si.intervals IS NULL THEN 'Day Off' ELSE 'Absent' END
          END AS status,
          -- Display status for UI (with Pending support)
          CASE
            -- Treated pending cases (stored in details field)
            WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present (Full)'
            WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present (Half)'
            WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent (Refused)'
            -- Single punch cases show as Pending (if not treated)
            WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
            WHEN ao.override_type IS NOT NULL AND LOWER(ao.override_type) = 'status_override' AND ao.details->>'status' = 'justified' THEN 'justified'
            WHEN ao.override_type IS NOT NULL THEN 'overridden'
            WHEN dp.punch_count >= 2 THEN 'Present'
            ELSE CASE WHEN si.intervals IS NULL THEN 'Day Off' ELSE 'Absent' END
          END AS display_status,
          -- Check if validated
          CASE
            WHEN eda.is_validated IS NOT NULL THEN eda.is_validated
            ELSE false
          END AS is_validated,
          -- Calculate late/early minutes (zero when overridden)
          CASE
            WHEN ao.override_type IS NOT NULL THEN 0
            WHEN dp.entry_time_ts IS NOT NULL AND si.intervals IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN
              GREATEST(0,
                EXTRACT(EPOCH FROM ((dp.entry_time_ts - (si.intervals->0->>'start_time')::time)))/60 - ${latenessGrace}
              )::integer
            ELSE 0
          END AS late_minutes,
          CASE
            WHEN ao.override_type IS NOT NULL THEN 0
            WHEN dp.exit_time_ts IS NOT NULL AND si.intervals IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN
              GREATEST(0,
                EXTRACT(EPOCH FROM (((si.intervals->-1->>'end_time')::time - dp.exit_time_ts)))/60 - ${earlyGrace}
              )::integer
            ELSE 0
          END AS early_minutes
        FROM month_days md
        LEFT JOIN scheduled_intervals si ON si.date = md.date
        LEFT JOIN daily_punches dp ON md.date = dp.date
        -- Aggregate overtime per day for stability
        LEFT JOIN (
          SELECT
            date::date AS date,
            SUM(hours) AS hours
          FROM employee_overtime_hours
          WHERE employee_id = $1
          GROUP BY date::date
        ) eoh ON eoh.date = md.date
        LEFT JOIN attendance_overrides ao ON ao.employee_id = $1 AND ao.date = md.date
        LEFT JOIN employee_daily_attendance eda ON eda.employee_id = $1 AND eda.date = md.date
        ORDER BY md.date
      `;

      const dailyResult = await pool.query(dailyQuery, [employeeId, parseInt(year), parseInt(month), employee.first_name, employee.last_name]);

      // Calculate monthly summary live from daily records
      const workedDaysQuery = `
        SELECT COUNT(*) AS worked_days
          FROM (
            SELECT
              d.date,
              CASE
                WHEN ao.override_type IS NOT NULL THEN 'Present'
                WHEN dp.punch_count >= 1 THEN 'Present'
                ELSE 'Absent'
              END AS status
          FROM
            generate_series(
              date_trunc('month', make_date($2, $3, 1)),
              date_trunc('month', make_date($2, $3, 1)) + interval '1 month - 1 day',
              '1 day'::interval
            ) AS d(date)
          LEFT JOIN (
            SELECT
              date(rp.punch_time) AS date,
              COUNT(*) AS punch_count
            FROM raw_punches rp
            WHERE
              lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                lower(TRIM(BOTH FROM replace($4 || ' ' || $5, ' ', ''))),
                lower(TRIM(BOTH FROM replace($5 || ' ' || $4, ' ', ''))),
                lower(TRIM(BOTH FROM replace($4 || $5, ' ', ''))),
                lower(TRIM(BOTH FROM replace($5 || $4, ' ', '')))
              )
              AND EXTRACT(YEAR FROM rp.punch_time) = $2
              AND EXTRACT(MONTH FROM rp.punch_time) = $3
            GROUP BY date(rp.punch_time)
          ) dp ON d.date = dp.date
          LEFT JOIN attendance_overrides ao ON ao.employee_id = $1 AND ao.date = d.date
          WHERE EXISTS (
            SELECT 1 FROM timetable_intervals ti
            JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
            WHERE et.employee_id = $1
              AND (
                ti.weekday = EXTRACT(ISODOW FROM d.date)::int
                OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date)::int = 7)
              )
              AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
              AND COALESCE(et.effective_to, '2100-12-31')
          )
        ) daily_records
        WHERE status = 'Present'
      `;

      const workedDaysResult = await pool.query(workedDaysQuery, [employeeId, parseInt(year), parseInt(month), employee.first_name, employee.last_name]);
      const workedDays = parseInt(workedDaysResult.rows[0]?.worked_days) || 0;

      // Get other summary data
      const summaryQuery = `
        WITH month_window AS (
          SELECT make_date($2, $3, 1)::date AS start_date,
                 (make_date($2, $3, 1) + interval '1 month - 1 day')::date AS end_date
        )
        SELECT
          cms.is_validated,
          (
            SELECT COALESCE(SUM(hours), 0)
            FROM employee_overtime_hours eoh, month_window mw
            WHERE eoh.employee_id = $1
              AND eoh.date BETWEEN mw.start_date AND mw.end_date
          ) AS overtime_hours,
          (
            SELECT COALESCE(SUM(
              CASE
                WHEN adjustment_type = 'decrease' THEN -amount
                WHEN adjustment_type = 'credit' THEN -amount
                WHEN adjustment_type = 'raise' THEN amount
                ELSE amount
              END
            ), 0)
            FROM employee_salary_adjustments esa
            WHERE esa.employee_id = $1
              AND EXTRACT(YEAR FROM esa.effective_date) = $2
              AND EXTRACT(MONTH FROM esa.effective_date) = $3
          ) AS wage_changes
        FROM (SELECT 1) base
        LEFT JOIN comprehensive_monthly_statistics cms 
          ON cms.employee_id = $1 AND cms.year = $2 AND cms.month = $3
      `;

      const summaryResult = await pool.query(summaryQuery, [employeeId, parseInt(year), parseInt(month)]);
      const summary = summaryResult.rows[0] || {};

      // Calculate scheduled days: count only days with scheduled intervals
      const scheduledDays = dailyResult.rows.reduce((count, record) => {
        return count + ((record.scheduled_intervals && record.scheduled_intervals.length > 0) ? 1 : 0);
      }, 0);

      // Calculate present days and absence days based on daily records
      // Only count days that have a scheduled shift so totals match scheduled_days
      let presentDays = 0;
      let absenceDays = 0;
      let pendingDays = 0;
      let totalLateMinutes = 0;
      let totalEarlyMinutes = 0;

      dailyResult.rows.forEach(record => {
        const hasSchedule = Array.isArray(record.scheduled_intervals) && record.scheduled_intervals.length > 0;
        if (hasSchedule) {
          // Worked/absence days according to status, only for scheduled days
          if (record.status === 'Present' || record.status === 'justified') {
            presentDays++;
          } else if (record.status === 'Absent') {
            absenceDays++;
          } else if (record.status === 'Pending') {
            pendingDays++;
          }
        }

        // Pre-validation late/early: ignore overridden days and require punches
        if (!record.override_type && (record.punch_count || 0) >= 1) {
          totalLateMinutes += record.late_minutes || 0;
          totalEarlyMinutes += record.early_minutes || 0;
        }
      });

      res.json({
        success: true,
        data: {
          employee: employee,
          daily_records: dailyResult.rows.map(record => ({
            date: record.date,
            scheduled_intervals: record.scheduled_intervals || [],
            entry_time: record.entry_time,
            exit_time: record.exit_time,
            overtime_hours: record.overtime_hours || 0,
            status: record.status,
            override_type: record.override_type,
            original_status: record.original_status,
            is_validated: record.is_validated,
            late_minutes: record.late_minutes || 0,
            early_minutes: record.early_minutes || 0,
            punch_count: record.punch_count || 0
          })),
          monthly_summary: {
            scheduled_days: scheduledDays,
            worked_days: presentDays,
            absence_days: absenceDays,
            pending_days: pendingDays,
            is_validated: summary.is_validated === true,
            // Always use computed totals from daily records to ensure consistency with table display
            late_minutes: totalLateMinutes,
            early_minutes: totalEarlyMinutes,
            overtime_hours: summary.overtime_hours || 0,
            wage_changes: summary.wage_changes || 0
          }
        }
      });

      // Helper function to format duration in minutes to "Xm" or "Xh Ym"
      function formatDuration(totalMinutes) {
        if (totalMinutes < 60) {
          return `${totalMinutes}m`;
        } else {
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
        }
      }

    } catch (error) {
      console.error('Get daily attendance error:', error);
      res.status(500).json({
        error: 'Failed to retrieve daily attendance data',
        details: error.message
      });
    }
  });

  // Save day record (override)
  router.post('/daily/save', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const {
        employee_id,
        date,
        entry_time,
        exit_time,
        validate = false
      } = req.body;

      const userId = req.user.userId;

      // Fix date format - always use only the YYYY-MM-DD part, no timezone conversion
      const cleanDate = (typeof date === 'string' && date.includes('T')) ? date.split('T')[0] : date;

      // Debug logging
      console.log('Backend received save request:', {
        employee_id,
        original_date: date,
        clean_date: cleanDate,
        entry_time,
        exit_time,
        validate,
        userId
      });

      // Check if there's already an override for this date
      const existingOverrideQuery = `
        SELECT ao.override_type, ao.id, ao.details
        FROM attendance_overrides ao
        WHERE ao.employee_id = $1 AND ao.date::text = $2
      `;
      const existingOverride = await client.query(existingOverrideQuery, [employee_id, cleanDate]);
      console.log('Existing override check result:', {
        employee_id,
        cleanDate,
        existingOverrideCount: existingOverride.rows.length,
        existingOverride: existingOverride.rows.length > 0 ? {
          id: existingOverride.rows[0].id,
          override_type: existingOverride.rows[0].override_type,
          details: existingOverride.rows[0].details
        } : null
      });

      // Also check for existing exception for this date to prevent duplicates
      const existingExceptionQuery = `
        SELECT ae.id, ae.type, ae.status, ae.payload
        FROM attendance_exceptions ae
        WHERE ae.employee_id = $1 AND ae.date::text = $2 AND ae.type = 'DayEdit' AND ae.status = 'Approved'
      `;
      const existingException = await client.query(existingExceptionQuery, [employee_id, cleanDate]);
      console.log('Existing exception check result:', {
        employee_id,
        cleanDate,
        existingExceptionCount: existingException.rows.length,
        existingException: existingException.rows.length > 0 ? {
          id: existingException.rows[0].id,
          type: existingException.rows[0].type,
          status: existingException.rows[0].status,
          payload: existingException.rows[0].payload
        } : null
      });

      // Allow updating existing day_edit overrides, but prevent conflicts with other types
      if (existingOverride.rows.length > 0) {
        const overrideType = existingOverride.rows[0].override_type;
        console.log('Existing override type:', overrideType);
        // Allow updating day_edit and extra-hour types, but prevent other conflicts
        if (overrideType !== 'day_edit' && overrideType !== 'extra-hour') {
          console.log('Preventing save due to conflicting override type:', overrideType);
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Cannot save changes',
            details: 'This day has a conflicting override type. Cannot apply day edit changes.'
          });
        }
      }

      // Create or update daily attendance record
      const attendanceData = {
        employee_id,
        date: cleanDate,
        entry_time: entry_time ? `${cleanDate} ${entry_time}` : null,
        exit_time: exit_time ? `${cleanDate} ${exit_time}` : null,
        absence_status: null,
        is_validated: validate,
        validated_by_user_id: validate ? userId : null,
        validated_at: validate ? 'CURRENT_TIMESTAMP' : null
      };

      console.log('Attendance data to upsert:', attendanceData);

      const upsertQuery = `
        INSERT INTO employee_daily_attendance
        (employee_id, date, entry_time, exit_time, absence_status, is_validated, validated_by_user_id, validated_at)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, ${validate ? 'CURRENT_TIMESTAMP' : 'NULL'})
        ON CONFLICT (employee_id, date)
        DO UPDATE SET
          entry_time = EXCLUDED.entry_time,
          exit_time = EXCLUDED.exit_time,
          absence_status = EXCLUDED.absence_status,
          is_validated = EXCLUDED.is_validated,
          validated_by_user_id = EXCLUDED.validated_by_user_id,
          validated_at = ${validate ? 'CURRENT_TIMESTAMP' : 'EXCLUDED.validated_at'},
          updated_at = CURRENT_TIMESTAMP
      `;

      const upsertResult = await client.query(upsertQuery, [
        employee_id,
        cleanDate,  // Fixed: use cleanDate instead of date
        attendanceData.entry_time,
        attendanceData.exit_time,
        attendanceData.absence_status,
        validate,
        validate ? userId : null
      ]);
      console.log('Upsert result:', {
        rowCount: upsertResult.rowCount,
        command: upsertResult.command
      });

      // Create exception record for audit (only if no existing override)
      let exceptionId = null;
      const exceptionDetails = {
        entry_time,
        exit_time,
        validated: validate
      };

      console.log('Exception details:', exceptionDetails);

      // Determine override type based on whether times are provided
      const isMissingPunch = !entry_time && !exit_time;
      const overrideType = isMissingPunch ? 'status_override' : 'day_edit';
      const overrideDetails = isMissingPunch
        ? JSON.stringify({ status: 'justified', reason: 'Missing punch justified', ...exceptionDetails })
        : JSON.stringify(exceptionDetails);

      console.log('Override type:', overrideType, 'Details:', overrideDetails);

      if (existingException.rows.length === 0) {
        console.log('Creating new exception and override');
        const exceptionResult = await client.query(`
          INSERT INTO attendance_exceptions
          (employee_id, type, date, payload, submitted_by_user_id, status, reviewed_by_user_id, reviewed_at)
          VALUES ($1, $2, $3::date, $4, $5, 'Approved', $5, CURRENT_TIMESTAMP)
          RETURNING id
        `, [employee_id, 'DayEdit', cleanDate, JSON.stringify(exceptionDetails), userId]);

        exceptionId = exceptionResult.rows[0].id;
        console.log('Created exception with ID:', exceptionId);

        // Create override record linked to exception
        const overrideInsertResult = await client.query(`
          INSERT INTO attendance_overrides
          (employee_id, date, override_type, details, exception_id, created_by_user_id)
          VALUES ($1, $2::date, $3, $4, $5, $6)
          RETURNING id
        `, [employee_id, cleanDate, overrideType, overrideDetails, exceptionId, userId]);
        console.log('Created override with ID:', overrideInsertResult.rows[0].id);
      } else {
        console.log('Updating existing exception');
        exceptionId = existingException.rows[0].id;
        // Update existing exception payload
        const exceptionUpdateResult = await client.query(`
          UPDATE attendance_exceptions
          SET payload = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING id
        `, [JSON.stringify(exceptionDetails), exceptionId]);
        console.log('Updated exception result:', {
          rowCount: exceptionUpdateResult.rowCount,
          updatedId: exceptionUpdateResult.rows[0]?.id
        });

        // Ensure override exists and is updated
        if (existingOverride.rows.length === 0) {
          console.log('Creating missing override for existing exception');
          const overrideInsertResult = await client.query(`
            INSERT INTO attendance_overrides
            (employee_id, date, override_type, details, exception_id, created_by_user_id)
            VALUES ($1, $2::date, $3, $4, $5, $6)
            RETURNING id
          `, [employee_id, cleanDate, overrideType, overrideDetails, exceptionId, userId]);
          console.log('Created override with ID:', overrideInsertResult.rows[0].id);
        } else {
          console.log('Updating existing override');
          // Update existing override details
          const updateResult = await client.query(`
            UPDATE attendance_overrides
            SET details = $1, override_type = $2, updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = $3 AND date::text = $4
            RETURNING id
          `, [overrideDetails, overrideType, employee_id, cleanDate]);
          console.log('Updated override result:', {
            rowCount: updateResult.rowCount,
            updatedId: updateResult.rows[0]?.id
          });
        }
      }

      // Log audit trail
      const auditData = { date: cleanDate, ...exceptionDetails };
      console.log('Audit data:', auditData);
      const auditResult = await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        'daily_attendance',
        employee_id,
        validate ? 'save_and_validate_day' : 'save_day',
        userId,
        JSON.stringify(auditData)
      ]);
      console.log('Audit log created with ID:', auditResult.rows[0].id);

      await client.query('COMMIT');
      console.log('Transaction committed successfully');

      // After committing, invalidate the month
      try {
        const month = moment(cleanDate).month() + 1;
        const year = moment(cleanDate).year();

        await pool.query(`
          UPDATE employee_monthly_summaries
          SET is_validated = false,
              validated_by_user_id = NULL,
              validated_at = NULL,
              calculation_method = 'calculated',
              updated_at = CURRENT_TIMESTAMP
          WHERE employee_id = $1 AND year = $2 AND month = $3
        `, [employee_id, year, month]);

        await pool.query(`
          DELETE FROM employee_monthly_validations
          WHERE employee_id = $1 AND year = $2 AND month = $3
        `, [employee_id, year, month]);

        console.log(`Invalidated month ${month}/${year} for employee ${employee_id}`);
      } catch (invalidationError) {
        console.error('Error during month invalidation:', invalidationError);
        // Don't fail the whole request, just log the error
      }

      res.json({
        success: true,
        message: validate ? 'Day record saved and validated' : 'Day record saved successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Save day record error:', error);
      res.status(500).json({
        error: 'Failed to save day record',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // ============================================================================
  // VALIDATION ROUTES
  // ============================================================================

  // Validate individual employee month
  router.post('/validate/employee/:employeeId', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { employeeId } = req.params;
      const { year, month } = req.body;
      const userId = req.user.userId;

      // Basic input validation to avoid cryptic 500 errors from invalid params
      const parsedYear = parseInt(year, 10);
      const parsedMonth = parseInt(month, 10);
      // Only use UUID-like values for DB writes; fallback for test tokens / missing users
      const isUuid = (val) => typeof val === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val);
      let validatedByUserId = isUuid(userId) ? userId : null;
      if (!validatedByUserId) {
        const empUserRes = await pool.query('SELECT user_id FROM employees WHERE id = $1', [employeeId]);
        const fallbackUserId = empUserRes.rows[0]?.user_id;
        if (isUuid(fallbackUserId)) {
          validatedByUserId = fallbackUserId;
        }
      }
      // Last-resort fallback UUID (system user) to satisfy NOT NULL when no valid user is present
      if (!validatedByUserId) {
        validatedByUserId = '00000000-0000-0000-0000-000000000000';
      }

      if (!parsedYear || Number.isNaN(parsedYear) || !parsedMonth || Number.isNaN(parsedMonth)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Invalid year or month. Please select a valid period before validating.',
          details: { year, month }
        });
      }

      // Check for pending days before validating - ONLY on scheduled days
      const pendingCheckQuery = `
        WITH month_days AS (
          SELECT d::date AS date
          FROM generate_series(
            date_trunc('month', make_date($1::integer, $2::integer, 1)),
            date_trunc('month', make_date($1::integer, $2::integer, 1)) + interval '1 month - 1 day',
            '1 day'::interval
          ) AS d
        ),
        scheduled_days AS (
          SELECT md.date
          FROM month_days md
          WHERE EXISTS (
            SELECT 1 FROM timetable_intervals ti
            JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
            WHERE et.employee_id = $3
              AND (
                EXTRACT(ISODOW FROM md.date) = ti.weekday
                OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM md.date) = 7)
              )
              AND md.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
              AND COALESCE(et.effective_to, '2100-12-31')
          )
        )
        SELECT COUNT(*) AS pending_count
        FROM employees e
        JOIN scheduled_days sd ON TRUE
        LEFT JOIN (
          SELECT
            rp.punch_time::date AS date,
            COUNT(*) AS punch_count,
            lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) AS normalized_name
          FROM raw_punches rp
          WHERE EXTRACT(YEAR FROM rp.punch_time) = $1
            AND EXTRACT(MONTH FROM rp.punch_time) = $2
          GROUP BY rp.punch_time::date, normalized_name
        ) dp ON dp.date = sd.date AND dp.normalized_name IN (
          lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
          lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
          lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
          lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
        )
        LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = sd.date
        WHERE e.id = $3
          AND dp.punch_count = 1 
          AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL))
      `;

      const pendingResult = await client.query(pendingCheckQuery, [parsedYear, parsedMonth, employeeId]);
      const pendingCount = parseInt(pendingResult.rows[0]?.pending_count || 0);

      if (pendingCount > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: `Cannot validate: ${pendingCount} pending day(s) must be resolved first. Please go to the attendance page to treat pending cases.`,
          pending_count: pendingCount
        });
      }

      // Get grace period settings
      const settingsQuery = `
        SELECT grace_period_lateness_minutes, grace_period_early_departure_minutes
        FROM attendance_settings 
        WHERE scope = 'global' 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const settingsResult = await client.query(settingsQuery);
      const settings = settingsResult.rows[0] || { grace_period_lateness_minutes: 15, grace_period_early_departure_minutes: 15 };
      const latenessGrace = settings.grace_period_lateness_minutes || 15;
      const earlyGrace = settings.grace_period_early_departure_minutes || 15;

      // Get employee details for punch name matching
      const employeeQuery = `
        SELECT first_name, last_name
        FROM employees
        WHERE id = $1
      `;
      const employeeResult = await client.query(employeeQuery, [employeeId]);
      if (employeeResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Employee not found for validation',
          employeeId
        });
      }
      const employee = employeeResult.rows[0];

      // Calculate the current totals from daily records (exclude overridden days)
      const dailyQuery = `
        WITH month_days AS (
          SELECT 
            d.date::date AS date,
            EXTRACT(ISODOW FROM d.date)::integer AS day_of_week
          FROM generate_series(
            make_date($2, $3, 1),
            (make_date($2, $3, 1) + interval '1 month - 1 day')::date,
            '1 day'::interval
          ) AS d(date)
        ),
        scheduled_intervals AS (
          SELECT
            md.date,
            md.day_of_week,
            jsonb_agg(
              jsonb_build_object(
                'start_time', ti.start_time::text,
                'end_time', ti.end_time::text,
                'break_minutes', ti.break_minutes
              ) ORDER BY ti.start_time
            ) AS intervals
          FROM month_days md
          JOIN employee_timetables et ON et.employee_id = $1
            AND md.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
            AND COALESCE(et.effective_to, '2100-12-31')
          JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
            AND (
              ti.weekday = md.day_of_week
              OR (ti.weekday = 0 AND md.day_of_week = 7)
            )
          GROUP BY md.date, md.day_of_week
        ),
        daily_punches AS (
          SELECT
            rp.punch_time::date AS date,
            COUNT(*) AS punch_count,
            CASE
              WHEN COUNT(*) = 1 THEN
                CASE
                  WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) < 12 THEN MIN(rp.punch_time)::time
                  ELSE NULL
                END
              ELSE MIN(rp.punch_time)::time
            END AS entry_time_ts,
            CASE
              WHEN COUNT(*) = 1 THEN
                CASE
                  WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) >= 12 THEN MIN(rp.punch_time)::time
                  ELSE NULL
                END
              ELSE MAX(rp.punch_time)::time
            END AS exit_time_ts
          FROM raw_punches rp
          WHERE
            lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
              lower(TRIM(BOTH FROM replace($4 || ' ' || $5, ' ', ''))),
              lower(TRIM(BOTH FROM replace($5 || ' ' || $4, ' ', ''))),
              lower(TRIM(BOTH FROM replace($4 || $5, ' ', ''))),
              lower(TRIM(BOTH FROM replace($5 || $4, ' ', '')))
            )
            AND EXTRACT(YEAR FROM rp.punch_time) = $2
            AND EXTRACT(MONTH FROM rp.punch_time) = $3
          GROUP BY rp.punch_time::date
        )
        SELECT
          md.date AS date,
          ao.override_type,
          COALESCE(dp.punch_count, 0) AS punch_count,
          si.intervals AS scheduled_intervals,
          CASE
            WHEN ao.override_type IS NOT NULL THEN 0
            WHEN dp.entry_time_ts IS NOT NULL AND si.intervals IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN
              GREATEST(0,
                EXTRACT(EPOCH FROM ((dp.entry_time_ts - (si.intervals->0->>'start_time')::time)))/60 - ${latenessGrace}
              )::integer
            ELSE 0
          END AS late_minutes,
          CASE
            WHEN ao.override_type IS NOT NULL THEN 0
            WHEN dp.exit_time_ts IS NOT NULL AND si.intervals IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN
              GREATEST(0,
                EXTRACT(EPOCH FROM (((si.intervals->-1->>'end_time')::time - dp.exit_time_ts)))/60 - ${earlyGrace}
              )::integer
            ELSE 0
          END AS early_minutes
        FROM month_days md
        LEFT JOIN scheduled_intervals si ON si.date = md.date
        LEFT JOIN daily_punches dp ON md.date = dp.date
        LEFT JOIN attendance_overrides ao ON ao.employee_id = $1 AND ao.date = md.date
        ORDER BY md.date
      `;

      const dailyResult = await client.query(dailyQuery, [employeeId, parsedYear, parsedMonth, employee.first_name, employee.last_name]);

      // Calculate totals for late/early minutes (same exclusion as UI)
      let totalLateMinutes = 0;
      let totalEarlyMinutes = 0;
      dailyResult.rows.forEach(record => {
        if (!record.override_type && (record.punch_count || 0) >= 1) {
          totalLateMinutes += record.late_minutes || 0;
          totalEarlyMinutes += record.early_minutes || 0;
        }
      });

      // Compute worked/absence counts using the EXACT SAME SQL logic as the monthly endpoint
      // This ensures validated data matches what's shown on attendance page
      const countsQuery = `
        WITH employee_info AS (
          SELECT first_name, last_name FROM employees WHERE id = $1
        )
        SELECT
          -- Calculate worked days (Present status) - EXACT same as attendance page
          (SELECT COUNT(*)
            FROM (
              SELECT
                d.date,
                CASE
                  -- Treated pending cases (stored in details field)
                  WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present'
                  WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present'
                  WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent'
                  -- Single punch cases go to Pending (if not treated)
                  WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
                  -- Other overrides
                  WHEN ao.override_type IS NOT NULL THEN 'Present'
                  -- Complete attendance (2+ punches)
                  WHEN dp.punch_count >= 2 THEN 'Present'
                  ELSE 'Absent'
                END AS status
              FROM
                generate_series(
                  date_trunc('month', make_date($2::integer, $3::integer, 1))::date,
                  (date_trunc('month', make_date($2::integer, $3::integer, 1)) + interval '1 month - 1 day')::date,
                  '1 day'::interval
                ) AS d(date)
              LEFT JOIN (
                SELECT
                  rp.punch_time::date AS date,
                  COUNT(*) AS punch_count
                FROM raw_punches rp, employee_info ei
                WHERE
                  lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                    lower(TRIM(BOTH FROM replace(ei.first_name || ' ' || ei.last_name, ' ', ''))),
                    lower(TRIM(BOTH FROM replace(ei.last_name || ' ' || ei.first_name, ' ', ''))),
                    lower(TRIM(BOTH FROM replace(ei.first_name || ei.last_name, ' ', ''))),
                    lower(TRIM(BOTH FROM replace(ei.last_name || ei.first_name, ' ', '')))
                  )
                  AND EXTRACT(YEAR FROM rp.punch_time) = $2
                  AND EXTRACT(MONTH FROM rp.punch_time) = $3
                GROUP BY rp.punch_time::date
              ) dp ON d.date = dp.date
              LEFT JOIN attendance_overrides ao ON ao.employee_id = $1 AND ao.date = d.date
              WHERE EXISTS (
                SELECT 1 FROM timetable_intervals ti
                JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
                WHERE et.employee_id = $1
                  AND (
                    EXTRACT(ISODOW FROM d.date) = ti.weekday
                    OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date) = 7)
                  )
                  AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                  AND COALESCE(et.effective_to, '2100-12-31')
              )
            ) daily_records
            WHERE status = 'Present'
          ) AS worked_days,
          -- Count half days separately
          (SELECT COUNT(*)
            FROM (
              SELECT d.date
              FROM
                generate_series(
                  date_trunc('month', make_date($2::integer, $3::integer, 1))::date,
                  (date_trunc('month', make_date($2::integer, $3::integer, 1)) + interval '1 month - 1 day')::date,
                  '1 day'::interval
                ) AS d(date)
              LEFT JOIN attendance_overrides ao ON ao.employee_id = $1 AND ao.date = d.date
              WHERE EXISTS (
                SELECT 1 FROM timetable_intervals ti
                JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
                WHERE et.employee_id = $1
                  AND (
                    EXTRACT(ISODOW FROM d.date) = ti.weekday
                    OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date) = 7)
                  )
                  AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                  AND COALESCE(et.effective_to, '2100-12-31')
              )
              AND ao.override_type = 'status_override' 
              AND ao.details->>'pending_treatment' = 'half_day'
            ) half_day_records
          ) AS half_days,
          -- Calculate absence days - EXACT same as attendance page
          (SELECT COUNT(*)
            FROM (
              SELECT
                d.date,
                CASE
                  -- Treated pending cases (stored in details field)
                  WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'full_day' THEN 'Present'
                  WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'half_day' THEN 'Present'
                  WHEN ao.override_type = 'status_override' AND ao.details->>'pending_treatment' = 'refuse' THEN 'Absent'
                  -- Single punch cases go to Pending (if not treated)
                  WHEN dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL)) THEN 'Pending'
                  -- Other overrides
                  WHEN ao.override_type IS NOT NULL THEN 'Present'
                  -- Complete attendance (2+ punches)
                  WHEN dp.punch_count >= 2 THEN 'Present'
                  ELSE 'Absent'
                END AS status
              FROM
                generate_series(
                  date_trunc('month', make_date($2::integer, $3::integer, 1)),
                  date_trunc('month', make_date($2::integer, $3::integer, 1)) + interval '1 month - 1 day',
                  '1 day'::interval
                ) AS d(date)
              LEFT JOIN (
                SELECT
                  rp.punch_time::date AS date,
                  COUNT(*) AS punch_count
                FROM raw_punches rp, employee_info ei
                WHERE
                  lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                    lower(TRIM(BOTH FROM replace(ei.first_name || ' ' || ei.last_name, ' ', ''))),
                    lower(TRIM(BOTH FROM replace(ei.last_name || ' ' || ei.first_name, ' ', ''))),
                    lower(TRIM(BOTH FROM replace(ei.first_name || ei.last_name, ' ', ''))),
                    lower(TRIM(BOTH FROM replace(ei.last_name || ei.first_name, ' ', '')))
                  )
                  AND EXTRACT(YEAR FROM rp.punch_time) = $2
                  AND EXTRACT(MONTH FROM rp.punch_time) = $3
                GROUP BY rp.punch_time::date
              ) dp ON d.date = dp.date
              LEFT JOIN attendance_overrides ao ON ao.employee_id = $1 AND ao.date = d.date
              WHERE EXISTS (
                SELECT 1 FROM timetable_intervals ti
                JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
                WHERE et.employee_id = $1
                  AND (
                    EXTRACT(ISODOW FROM d.date) = ti.weekday
                    OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM d.date) = 7)
                  )
                  AND d.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
                  AND COALESCE(et.effective_to, '2100-12-31')
              )
            ) daily_records
            WHERE status = 'Absent'
          ) AS absence_days;
      `;
      const countsRes = await client.query(countsQuery, [employeeId, parsedYear, parsedMonth]);
      const presentDays = parseFloat(countsRes.rows[0]?.worked_days) || 0;
      const absenceDays = parseFloat(countsRes.rows[0]?.absence_days) || 0;
      const halfDays = parseFloat(countsRes.rows[0]?.half_days) || 0;

      // Get overtime and wage changes for the month
      const monthWindowQuery = `
        WITH month_window AS (
          SELECT make_date($2, $3, 1)::date AS start_date,
                 (make_date($2, $3, 1) + interval '1 month - 1 day')::date AS end_date
        )
        SELECT
          (
            SELECT COALESCE(SUM(hours), 0)
            FROM employee_overtime_hours eoh, month_window mw
            WHERE eoh.employee_id = $1 AND eoh.date BETWEEN mw.start_date AND mw.end_date
          ) AS overtime_hours,
          (
            SELECT COALESCE(SUM(
              CASE
                WHEN adjustment_type = 'decrease' THEN -amount
                WHEN adjustment_type = 'credit' THEN -amount
                WHEN adjustment_type = 'raise' THEN amount
                ELSE amount
              END
            ), 0)
            FROM employee_salary_adjustments esa
            WHERE esa.employee_id = $1
              AND EXTRACT(YEAR FROM esa.effective_date) = $2
              AND EXTRACT(MONTH FROM esa.effective_date) = $3
          ) AS wage_changes
      `;
      const monthWindowResult = await client.query(monthWindowQuery, [employeeId, parsedYear, parsedMonth]);
      const overtimeHours = parseFloat(monthWindowResult.rows[0]?.overtime_hours) || 0;
      const wageChanges = parseFloat(monthWindowResult.rows[0]?.wage_changes) || 0;

      // Persist recalculated values into employee_monthly_summaries (UPSERT)
      await client.query(`
        INSERT INTO employee_monthly_summaries (
          employee_id, year, month,
          late_hours, early_departure_hours,
          late_minutes, early_departure_minutes,
          updated_at
        ) VALUES (
          $3::uuid, $4::int, $5::int,
          $1::numeric, $2::numeric,
          ROUND(($1::numeric) * 60)::int, ROUND(($2::numeric) * 60)::int,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (employee_id, month, year)
        DO UPDATE SET
          late_hours = EXCLUDED.late_hours,
          early_departure_hours = EXCLUDED.early_departure_hours,
          late_minutes = EXCLUDED.late_minutes,
          early_departure_minutes = EXCLUDED.early_departure_minutes,
          updated_at = CURRENT_TIMESTAMP
      `, [
        totalLateMinutes / 60.0,
        totalEarlyMinutes / 60.0,
        employeeId,
        parsedYear,
        parsedMonth
      ]);

      // If the stored function relies on the view and fails when no punches exist,
      // we still allow validation by directly upserting a validated summary.
      // Try function first; on failure or no result, fall back to manual validation.
      let validated = false;
      // try {
      //   const result = await client.query(
      //     'SELECT validate_employee_monthly_data($1, $2, $3, $4) AS result',
      //     [employeeId, parseInt(month), parseInt(year), userId]
      //   );
      //   const validationResult = result.rows[0]?.result || {};
      //   if (validationResult.success) {
      //     validated = true;
      //   }
      // } catch (e) {
      //   // swallow and proceed to manual path
      // }

      if (!validated) {
        // Prepare snapshot payload for logging/response
        const snapshotPayload = {
          employee_id: employeeId,
          year: parsedYear,
          month: parsedMonth,
          total_worked_days: presentDays,
          absence_days: absenceDays,
          half_days: halfDays,
          late_hours: (totalLateMinutes / 60.0),
          early_departure_hours: (totalEarlyMinutes / 60.0),
          late_minutes: Math.round(totalLateMinutes),
          early_departure_minutes: Math.round(totalEarlyMinutes),
          total_overtime_hours: overtimeHours,
          total_wage_changes: wageChanges,
          is_validated: true
        };
        console.log('Validation snapshot to EMS:', JSON.stringify(snapshotPayload));
        // Persist freshly computed values (exactly what the monthly endpoint computes)
        await client.query(`
          INSERT INTO employee_monthly_summaries (
            employee_id, year, month,
            total_worked_days, absence_days,
            late_hours, early_departure_hours,
            late_minutes, early_departure_minutes,
            total_overtime_hours, total_wage_changes,
            is_validated, validated_by_user_id, validated_at,
            calculation_method, updated_at
          ) VALUES (
            $1::uuid, $2::int, $3::int,
            $4::numeric, $5::numeric,
            $6::numeric, $7::numeric,
            $8::int, $9::int,
            $10::numeric, $11::numeric,
            true, $12::uuid, CURRENT_TIMESTAMP,
            'validated', CURRENT_TIMESTAMP
          )
          ON CONFLICT (employee_id, month, year)
          DO UPDATE SET
            total_worked_days = EXCLUDED.total_worked_days,
            absence_days = EXCLUDED.absence_days,
            late_hours = EXCLUDED.late_hours,
            early_departure_hours = EXCLUDED.early_departure_hours,
            late_minutes = EXCLUDED.late_minutes,
            early_departure_minutes = EXCLUDED.early_departure_minutes,
            total_overtime_hours = EXCLUDED.total_overtime_hours,
            total_wage_changes = EXCLUDED.total_wage_changes,
            is_validated = true,
            validated_by_user_id = EXCLUDED.validated_by_user_id,
            validated_at = CURRENT_TIMESTAMP,
            calculation_method = 'validated',
            updated_at = CURRENT_TIMESTAMP
        `, [
          employeeId,
          parsedYear,
          parsedMonth,
          presentDays,
          absenceDays,
          (totalLateMinutes / 60.0),
          (totalEarlyMinutes / 60.0),
          Math.round(totalLateMinutes),
          Math.round(totalEarlyMinutes),
          overtimeHours,
          wageChanges,
          validatedByUserId
        ]);

        // Update half_days separately (column may not exist yet, so use try-catch)
        try {
          await client.query(`
            UPDATE employee_monthly_summaries
            SET half_days = $1::numeric
            WHERE employee_id = $2 AND year = $3 AND month = $4
          `, [halfDays, employeeId, parsedYear, parsedMonth]);
        } catch (halfDaysError) {
          // If column doesn't exist, we'll add it via migration
          console.warn('half_days column may not exist yet:', halfDaysError.message);
        }

        // Record validation entry
        await client.query(`
          INSERT INTO employee_monthly_validations (employee_id, month, year, validated_by_user_id, validated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (employee_id, month, year)
          DO UPDATE SET validated_by_user_id = $4, validated_at = CURRENT_TIMESTAMP
        `, [employeeId, parsedMonth, parsedYear, validatedByUserId]);

        // Audit
        await client.query(`
          INSERT INTO audit_logs (entity_type, entity_id, action, actor_user_id, data)
          VALUES ('employee_monthly_validation', $1, 'validate_month_manual', $2, $3)
        `, [employeeId, validatedByUserId, JSON.stringify({ month: parsedMonth, year: parsedYear })]);
      }

      await client.query('COMMIT');
      // Return what was saved for debugging
      try {
        const saved = await pool.query(`
          SELECT employee_id, month, year,
                 total_worked_days, absence_days,
                 late_hours, early_departure_hours,
                 total_overtime_hours, total_wage_changes,
                 late_minutes, early_departure_minutes,
                 is_validated, validated_at
          FROM employee_monthly_summaries
          WHERE employee_id = $1 AND year = $2 AND month = $3
        `, [employeeId, parsedYear, parsedMonth]);
        res.json({
          success: true,
          message: 'Employee month validated successfully',
          saved_snapshot: saved.rows[0] || null
        });
      } catch (e) {
        res.json({ success: true, message: 'Employee month validated successfully' });
      }

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Validate employee month error:', error);
      res.status(500).json({
        error: 'Failed to validate employee month',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // Bulk validate employees
  router.post('/validate/bulk', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { employees, year, month, department } = req.body;
      const userId = req.user.userId;

      // Get grace period settings
      const settingsQuery = `
        SELECT grace_period_lateness_minutes, grace_period_early_departure_minutes
        FROM attendance_settings 
        WHERE scope = 'global' 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const settingsResult = await client.query(settingsQuery);
      const settings = settingsResult.rows[0] || { grace_period_lateness_minutes: 15, grace_period_early_departure_minutes: 15 };
      const latenessGrace = settings.grace_period_lateness_minutes || 15;
      const earlyGrace = settings.grace_period_early_departure_minutes || 15;

      let employeeIds = employees;

      // If no specific employees provided, get all employees matching filters
      if (!employeeIds || employeeIds.length === 0) {
        let employeeQuery = `
          SELECT DISTINCT e.id 
          FROM employees e
          JOIN comprehensive_monthly_statistics cms ON e.id = cms.employee_id
          WHERE cms.year = $1 AND cms.month = $2 AND cms.is_validated = false
        `;
        const params = [parseInt(year), parseInt(month)];

        if (department) {
          employeeQuery += ` AND e.id IN (
            SELECT employee_id FROM employee_departments WHERE department_id = $3
          )`;
          params.push(department);
        }

        const result = await client.query(employeeQuery, params);
        employeeIds = result.rows.map(row => row.id);
      }

      if (employeeIds.length === 0) {
        throw new Error('No employees found to validate');
      }

      const results = [];
      for (const employeeId of employeeIds) {
        try {
          // Compute and persist fresh values (skip stored function)
          const emp = await client.query('SELECT first_name, last_name FROM employees WHERE id = $1', [employeeId]);
          const employee = emp.rows[0] || { first_name: '', last_name: '' };

          const dailyQuery = `
            WITH month_days AS (
              SELECT d.date::date AS date, EXTRACT(ISODOW FROM d.date)::integer AS day_of_week
              FROM generate_series(make_date($2, $3, 1), (make_date($2, $3, 1) + interval '1 month - 1 day')::date, '1 day'::interval) AS d(date)
            ),
            scheduled_intervals AS (
              SELECT md.date, md.day_of_week,
                     jsonb_agg(jsonb_build_object('start_time', ti.start_time::text,'end_time', ti.end_time::text,'break_minutes', ti.break_minutes) ORDER BY ti.start_time) AS intervals
              FROM month_days md
              JOIN employee_timetables et ON et.employee_id = $1
                AND md.date BETWEEN COALESCE(et.effective_from, '1900-01-01') AND COALESCE(et.effective_to, '2100-12-31')
              JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
                AND (ti.weekday = md.day_of_week OR (ti.weekday = 0 AND md.day_of_week = 7))
              GROUP BY md.date, md.day_of_week
            ),
            daily_punches AS (
              SELECT rp.punch_time::date AS date, COUNT(*) AS punch_count,
                     CASE WHEN COUNT(*) = 1 THEN CASE WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) < 12 THEN MIN(rp.punch_time)::time ELSE NULL END ELSE MIN(rp.punch_time)::time END AS entry_time_ts,
                     CASE WHEN COUNT(*) = 1 THEN CASE WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) >= 12 THEN MIN(rp.punch_time)::time ELSE NULL END ELSE MAX(rp.punch_time)::time END AS exit_time_ts
              FROM raw_punches rp
              WHERE lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
                      lower(TRIM(BOTH FROM replace($4 || ' ' || $5, ' ', ''))),
                      lower(TRIM(BOTH FROM replace($5 || ' ' || $4, ' ', ''))),
                      lower(TRIM(BOTH FROM replace($4 || $5, ' ', ''))),
                      lower(TRIM(BOTH FROM replace($5 || $4, ' ', '')))
                    )
                AND EXTRACT(YEAR FROM rp.punch_time) = $2
                AND EXTRACT(MONTH FROM rp.punch_time) = $3
              GROUP BY rp.punch_time::date
            )
            SELECT md.date AS date, ao.override_type, COALESCE(dp.punch_count, 0) AS punch_count, si.intervals AS scheduled_intervals,
                   CASE WHEN ao.override_type IS NOT NULL THEN 0 WHEN dp.entry_time_ts IS NOT NULL AND si.intervals IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN GREATEST(0, EXTRACT(EPOCH FROM ((dp.entry_time_ts - (si.intervals->0->>'start_time')::time)))/60 - ${latenessGrace})::integer ELSE 0 END AS late_minutes,
                   CASE WHEN ao.override_type IS NOT NULL THEN 0 WHEN dp.exit_time_ts IS NOT NULL AND si.intervals IS NOT NULL AND jsonb_array_length(si.intervals) > 0 THEN GREATEST(0, EXTRACT(EPOCH FROM (((si.intervals->-1->>'end_time')::time - dp.exit_time_ts)))/60 - ${earlyGrace})::integer ELSE 0 END AS early_minutes
            FROM month_days md
            LEFT JOIN scheduled_intervals si ON si.date = md.date
            LEFT JOIN daily_punches dp ON md.date = dp.date
            LEFT JOIN attendance_overrides ao ON ao.employee_id = $1 AND ao.date = md.date
            ORDER BY md.date`;

          const daily = await client.query(dailyQuery, [employeeId, parseInt(year), parseInt(month), employee.first_name, employee.last_name]);

          let totalLateMinutes = 0;
          let totalEarlyMinutes = 0;
          daily.rows.forEach(r => {
            if (!r.override_type && (r.punch_count || 0) >= 1) {
              totalLateMinutes += r.late_minutes || 0;
              totalEarlyMinutes += r.early_minutes || 0;
            }
          });

          const countsQuery = `
            WITH days AS (
              SELECT d.date::date AS date FROM generate_series(date_trunc('month', make_date($2::int, $3::int, 1))::date, (date_trunc('month', make_date($2::int, $3::int, 1)) + interval '1 month - 1 day')::date, '1 day'::interval) d(date)
            ), punches AS (
              SELECT rp.punch_time::date AS date, COUNT(*) AS punch_count FROM raw_punches rp, employees e
              WHERE e.id = $1 AND (
                lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) = lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))) OR
                lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) = lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))) OR
                lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) = lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))) OR
                lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) = lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
              ) AND EXTRACT(YEAR FROM rp.punch_time) = $2 AND EXTRACT(MONTH FROM rp.punch_time) = $3 GROUP BY rp.punch_time::date
            ), sched AS (
              SELECT sd.date, jsonb_agg(jsonb_build_object('start_time', ti.start_time::text,'end_time', ti.end_time::text,'break_minutes', ti.break_minutes) ORDER BY ti.start_time) AS intervals
              FROM (SELECT d.date, EXTRACT(DOW FROM d.date)::integer AS day_of_week FROM days d) sd
              JOIN employee_timetables et ON et.employee_id = $1 AND sd.date BETWEEN COALESCE(et.effective_from, '1900-01-01') AND COALESCE(et.effective_to, '2100-12-31')
              JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id AND (ti.weekday = sd.day_of_week OR (ti.weekday = 0 AND sd.day_of_week = 7))
              GROUP BY sd.date
            ), base AS (
              SELECT d.date, (ao.override_type IS NOT NULL) AS is_overridden, COALESCE(p.punch_count, 0) AS punch_count, (s.intervals IS NOT NULL AND jsonb_array_length(s.intervals) > 0) AS has_schedule
              FROM days d
              LEFT JOIN sched s ON s.date = d.date
              LEFT JOIN punches p ON p.date = d.date
              LEFT JOIN attendance_overrides ao ON ao.employee_id = $1 AND ao.date = d.date
            )
            SELECT COUNT(*) FILTER (WHERE has_schedule AND (is_overridden OR punch_count >= 1)) AS worked_days,
                   COUNT(*) FILTER (WHERE has_schedule AND NOT (is_overridden OR punch_count >= 1)) AS absence_days
            FROM base`;

          const countsRes = await client.query(countsQuery, [employeeId, parseInt(year), parseInt(month)]);
          const presentDays = parseFloat(countsRes.rows[0]?.worked_days) || 0;
          const absenceDays = parseFloat(countsRes.rows[0]?.absence_days) || 0;

          const monthAgg = await client.query(`
            WITH month_window AS (
              SELECT make_date($2, $3, 1)::date AS start_date, (make_date($2, $3, 1) + interval '1 month - 1 day')::date AS end_date
            )
            SELECT (
                     SELECT COALESCE(SUM(hours), 0) FROM employee_overtime_hours eoh, month_window mw
                     WHERE eoh.employee_id = $1 AND eoh.date BETWEEN mw.start_date AND mw.end_date
                   ) AS overtime_hours,
                   (
                     SELECT COALESCE(SUM(CASE WHEN adjustment_type = 'decrease' THEN -amount WHEN adjustment_type = 'credit' THEN -amount WHEN adjustment_type = 'raise' THEN amount ELSE amount END), 0)
                     FROM employee_salary_adjustments esa
                     WHERE esa.employee_id = $1 AND EXTRACT(YEAR FROM esa.effective_date) = $2 AND EXTRACT(MONTH FROM esa.effective_date) = $3
                   ) AS wage_changes`, [employeeId, parseInt(year), parseInt(month)]);

          const overtimeHours = parseFloat(monthAgg.rows[0]?.overtime_hours) || 0;
          const wageChanges = parseFloat(monthAgg.rows[0]?.wage_changes) || 0;

          await client.query(`
            INSERT INTO employee_monthly_summaries (
              employee_id, year, month,
              total_worked_days, absence_days,
              late_hours, early_departure_hours,
              late_minutes, early_departure_minutes,
              total_overtime_hours, total_wage_changes,
              is_validated, validated_by_user_id, validated_at,
              calculation_method, updated_at
            ) VALUES (
              $1::uuid, $2::int, $3::int,
              $4::numeric, $5::numeric,
              $6::numeric, $7::numeric,
              $8::int, $9::int,
              $10::numeric, $11::numeric,
              true, $12::uuid, CURRENT_TIMESTAMP,
              'validated', CURRENT_TIMESTAMP
            )
            ON CONFLICT (employee_id, month, year)
            DO UPDATE SET
              total_worked_days = EXCLUDED.total_worked_days,
              absence_days = EXCLUDED.absence_days,
              late_hours = EXCLUDED.late_hours,
              early_departure_hours = EXCLUDED.early_departure_hours,
              late_minutes = EXCLUDED.late_minutes,
              early_departure_minutes = EXCLUDED.early_departure_minutes,
              total_overtime_hours = EXCLUDED.total_overtime_hours,
              total_wage_changes = EXCLUDED.total_wage_changes,
              is_validated = true,
              validated_by_user_id = EXCLUDED.validated_by_user_id,
              validated_at = CURRENT_TIMESTAMP,
              calculation_method = 'validated',
              updated_at = CURRENT_TIMESTAMP
          `, [
            employeeId,
            parseInt(year),
            parseInt(month),
            presentDays,
            absenceDays,
            (totalLateMinutes / 60.0),
            (totalEarlyMinutes / 60.0),
            Math.round(totalLateMinutes),
            Math.round(totalEarlyMinutes),
            overtimeHours,
            wageChanges,
            userId
          ]);

          // Fetch saved snapshot for debugging
          const saved = await client.query(`
            SELECT employee_id, month, year,
                   total_worked_days, absence_days,
                   late_hours, early_departure_hours,
                   total_overtime_hours, total_wage_changes,
                   late_minutes, early_departure_minutes,
                   is_validated, validated_at
            FROM employee_monthly_summaries
            WHERE employee_id = $1 AND year = $2 AND month = $3
          `, [employeeId, parseInt(year), parseInt(month)]);

          results.push({
            success: true,
            message: 'Employee monthly data validated successfully',
            statistics: {
              employee_id: employeeId,
              year: parseInt(year),
              month: parseInt(month),
              total_worked_days: presentDays,
              absence_days: absenceDays,
              late_hours: (totalLateMinutes / 60.0),
              early_departure_hours: (totalEarlyMinutes / 60.0),
              overtime_hours: overtimeHours,
              wage_changes: wageChanges,
              is_validated: true,
              validated_at: new Date().toISOString(),
              data_source: 'validated'
            },
            saved_snapshot: saved.rows[0] || null,
            employee_id: employeeId
          });
        } catch (error) {
          console.error(`Error validating employee ${employeeId}:`, error);
          results.push({ success: false, employee_id: employeeId, error: error.message });
        }
      }

      await client.query('COMMIT');

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      res.json({
        success: true,
        message: `Bulk validation completed: ${successCount} successful, ${failureCount} failed`,
        results: {
          total: results.length,
          successful: successCount,
          failed: failureCount,
          details: results
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Bulk validate error:', error);
      res.status(500).json({
        error: 'Failed to perform bulk validation',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // Recalculate employee month
  router.post('/recalculate/employee/:employeeId', verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      const { employeeId } = req.params;
      const { year, month } = req.body;
      const parsedYear = parseInt(year, 10);
      const parsedMonth = parseInt(month, 10);
      const isUuid = (val) => typeof val === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val);
      let actorUserId = isUuid(req.user.userId) ? req.user.userId : null;
      if (!actorUserId) {
        const empUserRes = await pool.query('SELECT user_id FROM employees WHERE id = $1', [employeeId]);
        const fallbackUserId = empUserRes.rows[0]?.user_id;
        if (isUuid(fallbackUserId)) {
          actorUserId = fallbackUserId;
        }
      }
      if (!actorUserId) {
        actorUserId = '00000000-0000-0000-0000-000000000000';
      }

      await client.query('BEGIN');

      // 1) Remove only non-exception overrides within the month (keep exception-linked overrides)
      //    Also, per requirement, remove DayEdit/editday exception-linked overrides and their exceptions
      //    to ensure recalculated records match displayed data.
      await client.query(`
        DELETE FROM attendance_overrides ao
        WHERE ao.employee_id = $1
          AND ao.date >= make_date($2, $3, 1)
          AND ao.date < (make_date($2, $3, 1) + interval '1 month')
          AND ao.exception_id IN (
            SELECT id FROM attendance_exceptions ae
            WHERE ae.employee_id = $1
              AND ae.type IN ('DayEdit', 'editday')
              AND ae.date >= make_date($2, $3, 1)
              AND ae.date < (make_date($2, $3, 1) + interval '1 month')
          )
      `, [employeeId, parsedYear, parsedMonth]);

      await client.query(`
        DELETE FROM attendance_exceptions ae
        WHERE ae.employee_id = $1
          AND ae.type IN ('DayEdit', 'editday')
          AND ae.date >= make_date($2, $3, 1)
          AND ae.date < (make_date($2, $3, 1) + interval '1 month')
      `, [employeeId, parsedYear, parsedMonth]);

      // After clearing DayEdit exceptions, clear non-exception overrides
      await client.query(`
        DELETE FROM attendance_overrides
        WHERE employee_id = $1
          AND date >= make_date($2, $3, 1)
          AND date < (make_date($2, $3, 1) + interval '1 month')
          AND (exception_id IS NULL)
      `, [employeeId, parsedYear, parsedMonth]);

      // 2) Mark the month as unvalidated in summaries
      await client.query(`
        UPDATE employee_monthly_summaries
        SET is_validated = false,
            validated_by_user_id = NULL,
            validated_at = NULL,
            calculation_method = 'calculated',
            updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = $1 AND year = $2 AND month = $3
      `, [employeeId, parseInt(year), parseInt(month)]);

      // 3) Run recalculation from raw punches
      const result = await client.query(
        'SELECT * FROM recalculate_employee_monthly_data($1, $2, $3)',
        [employeeId, parsedMonth, parsedYear]
      );

      // 4) Audit
      await client.query(`
        INSERT INTO audit_logs (entity_type, entity_id, action, actor_user_id, data)
        VALUES ('employee_month_recalculation', $1, 'recalculate_month', $2, $3)
      `, [employeeId, actorUserId, JSON.stringify({ month: parsedMonth, year: parsedYear })]);

      await client.query('COMMIT');

      const recalculationResult = result.rows[0];

      res.json({
        success: true,
        message: 'Employee month recalculated successfully',
        data: recalculationResult
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Recalculate employee month error:', error);
      res.status(500).json({
        error: 'Failed to recalculate employee month',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // ============================================================================
  // BULK OPERATIONS ROUTES
  // ============================================================================

  // Bulk clear late minutes
  router.post('/bulk/clear-late', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { employees, year, month, department } = req.body;
      const rawUserId = req.user.userId;
      const isUuid = (val) => typeof val === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val);
      const actorUserId = isUuid(rawUserId) ? rawUserId : '00000000-0000-0000-0000-000000000000';

      // Get grace period settings
      const settingsQuery = `
        SELECT grace_period_lateness_minutes, grace_period_early_departure_minutes
        FROM attendance_settings 
        WHERE scope = 'global' 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const settingsResult = await client.query(settingsQuery);
      const settings = settingsResult.rows[0] || { grace_period_lateness_minutes: 15, grace_period_early_departure_minutes: 15 };
      const latenessGrace = settings.grace_period_lateness_minutes || 15;

      // Build employee filter
      let employeeFilter = '';
      const params = [parseInt(year), parseInt(month)];
      let paramIndex = 3;
      if (employees && employees.length > 0) {
        employeeFilter = `AND e.id = ANY($${paramIndex}::uuid[])`;
        params.push(employees);
        paramIndex++;
      } else if (department) {
        employeeFilter = `AND e.id IN (SELECT employee_id FROM employee_departments WHERE department_id = $${paramIndex})`;
        params.push(department);
        paramIndex++;
      }

      // Find all employee/day with computed late_minutes > 0
      const lateDaysQuery = `
        WITH emps AS (
          SELECT 
            e.id AS employee_id, 
            e.first_name, 
            e.last_name,
            lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))) AS norm1,
            lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))) AS norm2,
            lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))) AS norm3,
            lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', ''))) AS norm4
          FROM employees e
          WHERE 1=1 ${employeeFilter}
        ), month_days AS (
          SELECT 
            em.employee_id,
            d.date::date AS date
          FROM emps em,
          generate_series(
            make_date($1, $2, 1),
            (make_date($1, $2, 1) + interval '1 month - 1 day')::date,
            '1 day'::interval
          ) AS d(date)
        ), scheduled_intervals AS (
          SELECT
            md.employee_id,
            md.date,
            jsonb_agg(
              jsonb_build_object(
                'start_time', ti.start_time::text,
                'end_time', ti.end_time::text,
                'break_minutes', ti.break_minutes
              ) ORDER BY ti.start_time
            ) AS intervals
          FROM month_days md
          JOIN employee_timetables et ON et.employee_id = md.employee_id
            AND md.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
            AND COALESCE(et.effective_to, '2100-12-31')
          JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
            AND (ti.weekday = EXTRACT(ISODOW FROM md.date)::int OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM md.date)::int = 7))
          GROUP BY md.employee_id, md.date
        ), daily_punches AS (
          SELECT
            em.employee_id,
            rp.punch_time::date AS date,
            COUNT(*) AS punch_count,
            CASE
              WHEN COUNT(*) = 1 THEN CASE WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) < 12 THEN MIN(rp.punch_time)::time ELSE NULL END
              ELSE MIN(rp.punch_time)::time
            END AS entry_time_ts
          FROM emps em
          JOIN raw_punches rp ON lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (em.norm1, em.norm2, em.norm3, em.norm4)
          WHERE EXTRACT(YEAR FROM rp.punch_time) = $1 AND EXTRACT(MONTH FROM rp.punch_time) = $2
          GROUP BY em.employee_id, rp.punch_time::date
        )
        SELECT md.employee_id, md.date
        FROM month_days md
        LEFT JOIN scheduled_intervals si ON si.employee_id = md.employee_id AND si.date = md.date
        LEFT JOIN daily_punches dp ON dp.employee_id = md.employee_id AND dp.date = md.date
        LEFT JOIN attendance_overrides ao ON ao.employee_id = md.employee_id AND ao.date = md.date
        WHERE si.intervals IS NOT NULL
          AND dp.punch_count >= 1
          AND dp.entry_time_ts IS NOT NULL
          AND jsonb_array_length(si.intervals) > 0
          AND GREATEST(0, EXTRACT(EPOCH FROM ((dp.entry_time_ts - (si.intervals->0->>'start_time')::time)))/60 - ${latenessGrace})::integer > 0
          AND COALESCE(ao.details->>'cleared', '') != 'late'
      `;
      const lateDays = await client.query(lateDaysQuery, params);

      let affected = 0;
      const affectedEmployeeIdsSet = new Set();
      for (const row of lateDays.rows) {
        const overrideDetails = {
          cleared: 'late',
          reason: 'Bulk cleared late',
          bulk_operation: true
        };
        const existingOverride = await client.query(
          'SELECT id FROM attendance_overrides WHERE employee_id = $1 AND date = $2',
          [row.employee_id, row.date]
        );

        if (existingOverride.rows.length > 0) {
          // Skip update if already cleared as 'late'
          const current = existingOverride.rows[0];
          const alreadyClearedLate = (current.details && current.details.cleared === 'late') ||
            (typeof current.details === 'string' && current.details.includes('"cleared":"late"'));
          if (!alreadyClearedLate) {
            await client.query(
              'UPDATE attendance_overrides SET details = $1 WHERE id = $2',
              [JSON.stringify(overrideDetails), current.id]
            );
          } else {
            continue;
          }
        } else {
          await client.query(
            'INSERT INTO attendance_overrides (employee_id, date, override_type, details, created_by_user_id) VALUES ($1, $2, $3, $4, $5)',
            [row.employee_id, row.date, 'status_override', JSON.stringify(overrideDetails), actorUserId]
          );
        }
        affected++;
        affectedEmployeeIdsSet.add(row.employee_id);
      }

      // Only un-validate months when changes were actually applied
      if (affected > 0) {
        const affectedEmployees = Array.from(affectedEmployeeIdsSet);
        await client.query(`
          UPDATE employee_monthly_summaries
          SET late_hours = 0,
              late_minutes = 0,
              is_validated = false,
              validated_by_user_id = NULL,
              validated_at = NULL,
              calculation_method = 'calculated',
              updated_at = CURRENT_TIMESTAMP
          WHERE year = $1 AND month = $2
            AND employee_id = ANY($3::uuid[])
        `, [parseInt(year), parseInt(month), affectedEmployees]);

        await client.query(`
          DELETE FROM employee_monthly_validations
          WHERE year = $1 AND month = $2
            AND employee_id = ANY($3::uuid[])
        `, [parseInt(year), parseInt(month), affectedEmployees]);
      }

      // Log bulk action
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'bulk_operation',
        null,
        'bulk_clear_late',
        actorUserId,
        JSON.stringify({
          affected_days: affected,
          filters: { year, month, department, employees: employees ? employees.length : 'all' }
        })
      ]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: affected > 0
          ? `Late minutes cleared via overrides for ${affected} scheduled days`
          : 'No late minutes found to clear; no changes made'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Bulk clear late error:', error);
      res.status(500).json({
        error: 'Failed to clear late minutes',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // Bulk clear early departure minutes
  router.post('/bulk/clear-early', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { employees, year, month, department } = req.body;
      const rawUserId = req.user.userId;
      const isUuid = (val) => typeof val === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val);
      const actorUserId = isUuid(rawUserId) ? rawUserId : '00000000-0000-0000-0000-000000000000';

      // Get grace period settings
      const settingsQuery = `
        SELECT grace_period_lateness_minutes, grace_period_early_departure_minutes
        FROM attendance_settings 
        WHERE scope = 'global' 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const settingsResult = await client.query(settingsQuery);
      const settings = settingsResult.rows[0] || { grace_period_lateness_minutes: 15, grace_period_early_departure_minutes: 15 };
      const earlyGrace = settings.grace_period_early_departure_minutes || 15;

      // Build employee filter
      let employeeFilter = '';
      const params = [parseInt(year), parseInt(month)];
      let paramIndex = 3;
      if (employees && employees.length > 0) {
        employeeFilter = `AND e.id = ANY($${paramIndex}::uuid[])`;
        params.push(employees);
        paramIndex++;
      } else if (department) {
        employeeFilter = `AND e.id IN (SELECT employee_id FROM employee_departments WHERE department_id = $${paramIndex})`;
        params.push(department);
        paramIndex++;
      }

      // Find all employee/day with computed early_minutes > 0
      const earlyDaysQuery = `
        WITH emps AS (
          SELECT 
            e.id AS employee_id, 
            e.first_name, 
            e.last_name,
            lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))) AS norm1,
            lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))) AS norm2,
            lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))) AS norm3,
            lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', ''))) AS norm4
          FROM employees e
          WHERE 1=1 ${employeeFilter}
        ), month_days AS (
          SELECT 
            em.employee_id,
            d.date::date AS date
          FROM emps em,
          generate_series(
            make_date($1, $2, 1),
            (make_date($1, $2, 1) + interval '1 month - 1 day')::date,
            '1 day'::interval
          ) AS d(date)
        ), scheduled_intervals AS (
          SELECT
            md.employee_id,
            md.date,
            jsonb_agg(
              jsonb_build_object(
                'start_time', ti.start_time::text,
                'end_time', ti.end_time::text,
                'break_minutes', ti.break_minutes
              ) ORDER BY ti.start_time
            ) AS intervals
          FROM month_days md
          JOIN employee_timetables et ON et.employee_id = md.employee_id
            AND md.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
            AND COALESCE(et.effective_to, '2100-12-31')
          JOIN timetable_intervals ti ON ti.timetable_id = et.timetable_id
            AND (ti.weekday = EXTRACT(ISODOW FROM md.date)::int OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM md.date)::int = 7))
          GROUP BY md.employee_id, md.date
        ), daily_punches AS (
          SELECT
            em.employee_id,
            rp.punch_time::date AS date,
            COUNT(*) AS punch_count,
            CASE
              WHEN COUNT(*) = 1 THEN CASE WHEN EXTRACT(HOUR FROM MIN(rp.punch_time)) >= 12 THEN MIN(rp.punch_time)::time ELSE NULL END
              ELSE MAX(rp.punch_time)::time
            END AS exit_time_ts
          FROM emps em
          JOIN raw_punches rp ON lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (em.norm1, em.norm2, em.norm3, em.norm4)
          WHERE EXTRACT(YEAR FROM rp.punch_time) = $1 AND EXTRACT(MONTH FROM rp.punch_time) = $2
          GROUP BY em.employee_id, rp.punch_time::date
        )
        SELECT md.employee_id, md.date
        FROM month_days md
        LEFT JOIN scheduled_intervals si ON si.employee_id = md.employee_id AND si.date = md.date
        LEFT JOIN daily_punches dp ON dp.employee_id = md.employee_id AND dp.date = md.date
        LEFT JOIN attendance_overrides ao ON ao.employee_id = md.employee_id AND ao.date = md.date
        WHERE si.intervals IS NOT NULL
          AND dp.punch_count >= 1
          AND dp.exit_time_ts IS NOT NULL
          AND jsonb_array_length(si.intervals) > 0
          AND GREATEST(0, EXTRACT(EPOCH FROM (((si.intervals->-1->>'end_time')::time - dp.exit_time_ts)))/60 - ${earlyGrace})::integer > 0
          AND COALESCE(ao.details->>'cleared', '') != 'early'
      `;
      const earlyDays = await client.query(earlyDaysQuery, params);

      let affected = 0;
      const affectedEmployeeIdsSet = new Set();
      for (const row of earlyDays.rows) {
        const overrideDetails = {
          cleared: 'early',
          reason: 'Bulk cleared early departure',
          bulk_operation: true
        };
        const existingOverride = await client.query(
          'SELECT id FROM attendance_overrides WHERE employee_id = $1 AND date = $2',
          [row.employee_id, row.date]
        );

        if (existingOverride.rows.length > 0) {
          // Skip update if already cleared as 'early'
          const current = existingOverride.rows[0];
          const alreadyClearedEarly = (current.details && current.details.cleared === 'early') ||
            (typeof current.details === 'string' && current.details.includes('"cleared":"early"'));
          if (!alreadyClearedEarly) {
            await client.query(
              'UPDATE attendance_overrides SET details = $1 WHERE id = $2',
              [JSON.stringify(overrideDetails), current.id]
            );
          } else {
            continue;
          }
        } else {
          await client.query(
            'INSERT INTO attendance_overrides (employee_id, date, override_type, details, created_by_user_id) VALUES ($1, $2, $3, $4, $5)',
            [row.employee_id, row.date, 'status_override', JSON.stringify(overrideDetails), actorUserId]
          );
        }
        affected++;
        affectedEmployeeIdsSet.add(row.employee_id);
      }

      // Only un-validate months when changes were actually applied
      if (affected > 0) {
        const affectedEmployees = Array.from(affectedEmployeeIdsSet);
        await client.query(`
          UPDATE employee_monthly_summaries
          SET early_departure_hours = 0,
              early_departure_minutes = 0,
              is_validated = false,
              validated_by_user_id = NULL,
              validated_at = NULL,
              calculation_method = 'calculated',
              updated_at = CURRENT_TIMESTAMP
          WHERE year = $1 AND month = $2
            AND employee_id = ANY($3::uuid[])
        `, [parseInt(year), parseInt(month), affectedEmployees]);

        await client.query(`
          DELETE FROM employee_monthly_validations
          WHERE year = $1 AND month = $2
            AND employee_id = ANY($3::uuid[])
        `, [parseInt(year), parseInt(month), affectedEmployees]);
      }

      // Log bulk action
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'bulk_operation',
        null,
        'bulk_clear_early',
        actorUserId,
        JSON.stringify({
          affected_days: affected,
          filters: { year, month, department, employees: employees ? employees.length : 'all' }
        })
      ]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: affected > 0
          ? `Early departure minutes cleared via overrides for ${affected} scheduled days`
          : 'No early departure minutes found to clear; no changes made'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Bulk clear early error:', error);
      res.status(500).json({
        error: 'Failed to clear early departure minutes',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // Bulk clear missing punches (mark as justified)
  router.post('/bulk/clear-missing', verifyToken, async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { employees, year, month, department } = req.body;
      const rawUserId = req.user.userId;
      const isUuid = (val) => typeof val === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val);
      const actorUserId = isUuid(rawUserId) ? rawUserId : '00000000-0000-0000-0000-000000000000';

      // Find days with missing punches and create overrides
      let findMissingQuery = `
        WITH emps AS (
          SELECT 
            e.id AS employee_id, 
            e.first_name, 
            e.last_name,
            lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))) AS norm1,
            lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))) AS norm2,
            lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))) AS norm3,
            lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', ''))) AS norm4
          FROM employees e
        ), scheduled_days AS (
          SELECT 
            e.employee_id,
            generate_series(
              make_date($1, $2, 1), 
              (make_date($1, $2, 1) + interval '1 month - 1 day')::date,
              '1 day'::interval
            )::date AS date
          FROM emps e
          JOIN employee_timetables et ON e.employee_id = et.employee_id
          WHERE ($1 BETWEEN EXTRACT(YEAR FROM et.effective_from) AND EXTRACT(YEAR FROM COALESCE(et.effective_to, '2100-12-31')))
      `;

      const params = [parseInt(year), parseInt(month)];
      let paramIndex = 3;

      if (employees && employees.length > 0) {
        findMissingQuery += ` AND e.employee_id = ANY($${paramIndex}::uuid[])`;
        params.push(employees);
        paramIndex++;
      } else if (department) {
        findMissingQuery += ` AND e.employee_id IN (SELECT employee_id FROM employee_departments WHERE department_id = $${paramIndex})`;
        params.push(department);
        paramIndex++;
      }

      findMissingQuery += `
        )
        SELECT DISTINCT sd.employee_id, sd.date
        FROM scheduled_days sd
        LEFT JOIN (
          SELECT
            rp.punch_time::date AS date,
            COUNT(*) AS punch_count,
            lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) AS normalized_name
          FROM raw_punches rp
          WHERE EXTRACT(YEAR FROM rp.punch_time) = $1 AND EXTRACT(MONTH FROM rp.punch_time) = $2
          GROUP BY rp.punch_time::date, lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', '')))
        ) ap ON ap.date = sd.date AND ap.normalized_name IN (
          (SELECT norm1 FROM emps WHERE employee_id = sd.employee_id),
          (SELECT norm2 FROM emps WHERE employee_id = sd.employee_id),
          (SELECT norm3 FROM emps WHERE employee_id = sd.employee_id),
          (SELECT norm4 FROM emps WHERE employee_id = sd.employee_id)
        )
        LEFT JOIN attendance_overrides ao ON sd.employee_id = ao.employee_id 
          AND sd.date = ao.date
        WHERE ao.id IS NULL AND ap.punch_count = 1
      `;

      const missingResult = await client.query(findMissingQuery, params);

      // Create overrides for missing/one-punch days
      let affectedCount = 0;
      const affectedEmployeeIdsSet = new Set();
      for (const missing of missingResult.rows) {
        const overrideDetails = {
          status: 'justified',
          reason: 'Bulk justified missing/one-punch days (treated as present)',
          bulk_operation: true
        };
        const existingOverride = await client.query(
          'SELECT id FROM attendance_overrides WHERE employee_id = $1 AND date = $2',
          [missing.employee_id, missing.date]
        );

        if (existingOverride.rows.length > 0) {
          await client.query(
            'UPDATE attendance_overrides SET details = $1 WHERE id = $2',
            [JSON.stringify(overrideDetails), existingOverride.rows[0].id]
          );
        } else {
          await client.query(
            'INSERT INTO attendance_overrides (employee_id, date, override_type, details, created_by_user_id) VALUES ($1, $2, $3, $4, $5)',
            [missing.employee_id, missing.date, 'status_override', JSON.stringify(overrideDetails), actorUserId]
          );
        }
        affectedCount++;
        affectedEmployeeIdsSet.add(missing.employee_id);
      }

      // Un-validate only if we actually created/updated overrides
      if (affectedCount > 0) {
        const affectedEmployees = Array.from(affectedEmployeeIdsSet);
        await client.query(`
          UPDATE employee_monthly_summaries
          SET is_validated = false,
              validated_by_user_id = NULL,
              validated_at = NULL,
              calculation_method = 'calculated',
              updated_at = CURRENT_TIMESTAMP
          WHERE year = $1 AND month = $2
            AND employee_id = ANY($3::uuid[])
        `, [parseInt(year), parseInt(month), affectedEmployees]);

        await client.query(`
          DELETE FROM employee_monthly_validations
          WHERE year = $1 AND month = $2
            AND employee_id = ANY($3::uuid[])
        `, [parseInt(year), parseInt(month), affectedEmployees]);
      }

      // Log bulk action
      await client.query(`
        INSERT INTO audit_logs
        (entity_type, entity_id, action, actor_user_id, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'bulk_operation',
        null,
        'bulk_clear_missing_punches',
        actorUserId,
        JSON.stringify({
          affected_days: affectedCount,
          filters: { year, month, department, employees: employees ? employees.length : 'all' }
        })
      ]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: affectedCount > 0
          ? `Missing punches justified for ${affectedCount} employee days`
          : 'No missing punches found to clear; no changes made'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Bulk clear missing punches error:', error);
      res.status(500).json({
        error: 'Failed to clear missing punches',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // ============================================================================
  // PENDING CASES MANAGEMENT ROUTES (NEW)
  // ============================================================================

  // Get pending cases for an employee or department
  router.get('/pending', verifyToken, async (req, res) => {
    try {
      const { employeeId, year, month, department } = req.query;

      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;

      if (employeeId) {
        whereConditions.push(`pac.employee_id = $${paramIndex}`);
        queryParams.push(employeeId);
        paramIndex++;
      }

      if (year) {
        whereConditions.push(`EXTRACT(YEAR FROM pac.punch_date) = $${paramIndex}`);
        queryParams.push(parseInt(year));
        paramIndex++;
      }

      if (month) {
        whereConditions.push(`EXTRACT(MONTH FROM pac.punch_date) = $${paramIndex}`);
        queryParams.push(parseInt(month));
        paramIndex++;
      }

      if (department) {
        whereConditions.push(`e.department_id = $${paramIndex}`);
        queryParams.push(department);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      const query = `
        SELECT 
          pac.employee_id,
          pac.employee_name,
          pac.punch_date,
          pac.punch_count,
          pac.current_status,
          pac.override_id,
          d.name as department_name,
          p.name as position_name,
          -- Get the single punch time for display
          (SELECT TO_CHAR(punch_time, 'HH24:MI') 
           FROM raw_punches rp 
           WHERE lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (
             lower(TRIM(BOTH FROM replace(pac.employee_name, ' ', '')))
           ) AND rp.punch_time::date = pac.punch_date
           LIMIT 1) as punch_time
        FROM partial_attendance_cases pac
        JOIN employees e ON e.id = pac.employee_id
        LEFT JOIN departments d ON d.id = e.department_id
        LEFT JOIN positions p ON p.id = e.position_id
        ${whereClause}
        ORDER BY pac.punch_date DESC, pac.employee_name
      `;

      const result = await pool.query(query, queryParams);

      res.json({
        success: true,
        pending_cases: result.rows,
        total: result.rows.length
      });

    } catch (error) {
      console.error('Get pending cases error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pending cases',
        details: error.message
      });
    }
  });

  // Treat a pending case (validate full/half day or refuse)
  router.post('/pending/treat', verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { employeeId, date, action, reason, deductionAmount } = req.body;
      const userId = req.user?.userId;

      if (!employeeId || !date || !action) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: employeeId, date, action'
        });
      }

      if (!['full_day', 'half_day', 'refuse'].includes(action)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action. Must be: full_day, half_day, or refuse'
        });
      }

      // Check if this is actually a pending case (simplified check without view)
      const employeeCheck = await client.query(`
        SELECT first_name, last_name FROM employees WHERE id = $1
      `, [employeeId]);

      if (employeeCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Employee not found'
        });
      }

      const employee = employeeCheck.rows[0];

      // Check if there's exactly 1 punch for this date (pending case)
      const punchCheck = await client.query(`
        SELECT COUNT(*) as punch_count
        FROM raw_punches rp
        WHERE (
          UPPER(REPLACE(rp.employee_name, ' ', '')) = UPPER(REPLACE($1 || ' ' || $2, ' ', '')) OR
          UPPER(REPLACE(rp.employee_name, ' ', '')) = UPPER(REPLACE($2 || ' ' || $1, ' ', ''))
        )
        AND DATE(rp.punch_time) = $3
      `, [employee.first_name, employee.last_name, date]);

      const punchCount = parseInt(punchCheck.rows[0]?.punch_count || 0);

      if (punchCount !== 1) {
        return res.status(400).json({
          success: false,
          error: `This is not a pending case. Found ${punchCount} punches for this date.`
        });
      }

      // Create or update the attendance override
      const pendingStatus = action === 'refuse' ? 'refused' : action;
      const overrideType = 'status_override';

      const overrideDetails = {
        action: action,
        reason: reason || `Pending case treated as ${action}`,
        treated_at: new Date().toISOString(),
        treated_by: userId,
        deduction_amount: deductionAmount || 0,
        // Store pending treatment in details since we don't have the column yet
        pending_treatment: action
      };

      // Check if override already exists
      const existingOverride = await client.query(`
        SELECT id FROM attendance_overrides 
        WHERE employee_id = $1 AND date = $2
      `, [employeeId, date]);

      if (existingOverride.rows.length > 0) {
        // Update existing override
        await client.query(`
          UPDATE attendance_overrides 
          SET override_type = $1,
              details = $2,
              updated_at = CURRENT_TIMESTAMP
          WHERE employee_id = $3 AND date = $4
        `, [overrideType, JSON.stringify(overrideDetails), employeeId, date]);
      } else {
        // Create new override
        await client.query(`
          INSERT INTO attendance_overrides 
          (employee_id, date, override_type, details, created_by_user_id)
          VALUES ($1, $2, $3, $4, $5)
        `, [employeeId, date, overrideType, JSON.stringify(overrideDetails), userId]);
      }

      // Create wage change if deduction amount is specified
      if (deductionAmount && deductionAmount > 0) {
        await client.query(`
            INSERT INTO employee_salary_adjustments (employee_id, adjustment_type, amount, effective_date, description, created_by_user_id, created_at)
            VALUES ($1, 'decrease', $2, $3, $4, $5, CURRENT_TIMESTAMP)
          `, [
          employeeId,
          deductionAmount,
          date,
          `Pending case deduction: ${reason || action.replace('_', ' ')}`,
          userId
        ]);
      }

      // Create exception record for tracking
      const exceptionType = action === 'refuse' ? 'MissingPunchFix' : 'MissingPunchFix';
      const exceptionDescription = `Pending case treated as ${action.replace('_', ' ')}: ${reason || 'No reason provided'}`;
      const exceptionPayload = {
        description: exceptionDescription,
        action: action,
        reason: reason || 'No reason provided',
        treated_at: new Date().toISOString()
      };

      await client.query(`
        INSERT INTO attendance_exceptions (employee_id, date, type, payload, status, submitted_by_user_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'Approved', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [employeeId, date, exceptionType, JSON.stringify(exceptionPayload), userId]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `Pending case treated as ${action}`,
        action: action,
        employee_id: employeeId,
        date: date,
        deduction_amount: deductionAmount || 0
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Treat pending case error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to treat pending case',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // Check if month validation is allowed (no pending cases)
  router.get('/validation/check/:year/:month', verifyToken, async (req, res) => {
    try {
      const { year, month } = req.params;
      const { department } = req.query;

      // Compute pending partial cases with same logic as daily (single untreated punch)
      const y = parseInt(year), m = parseInt(month);
      if (!y || !m) {
        return res.status(400).json({ success: false, error: 'Invalid year or month' });
      }

      const pendingParams = [y, m];
      let pendingWhere = '';
      if (department) {
        pendingWhere = 'AND e.department_id = $3';
        pendingParams.push(department);
      }

      const pendingCheckQuery = `
        WITH month_days AS (
          SELECT d::date AS date
          FROM generate_series(
            date_trunc('month', make_date($1::integer, $2::integer, 1)),
            date_trunc('month', make_date($1::integer, $2::integer, 1)) + interval '1 month - 1 day',
            '1 day'::interval
          ) AS d
        ),
        scheduled_days AS (
          SELECT md.date, e.id AS employee_id
          FROM month_days md
          CROSS JOIN employees e
          ${department ? 'LEFT JOIN employee_departments ed ON e.id = ed.employee_id' : ''}
          WHERE EXISTS (
            SELECT 1 FROM timetable_intervals ti
            JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
            WHERE et.employee_id = e.id
              AND (
                EXTRACT(ISODOW FROM md.date) = ti.weekday
                OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM md.date) = 7)
              )
              AND md.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
              AND COALESCE(et.effective_to, '2100-12-31')
          )
          ${department ? 'AND ed.department_id = $3' : ''}
        )
        SELECT COUNT(*) AS pending_count
        FROM scheduled_days sd
        JOIN employees e ON e.id = sd.employee_id
        LEFT JOIN (
          SELECT
            rp.punch_time::date AS date,
            COUNT(*) AS punch_count,
            lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) AS normalized_name
          FROM raw_punches rp
          WHERE EXTRACT(YEAR FROM rp.punch_time) = $1
            AND EXTRACT(MONTH FROM rp.punch_time) = $2
          GROUP BY rp.punch_time::date, normalized_name
        ) dp ON dp.date = sd.date AND dp.normalized_name IN (
          lower(TRIM(BOTH FROM replace(e.first_name || ' ' || e.last_name, ' ', ''))),
          lower(TRIM(BOTH FROM replace(e.last_name || ' ' || e.first_name, ' ', ''))),
          lower(TRIM(BOTH FROM replace(e.first_name || e.last_name, ' ', ''))),
          lower(TRIM(BOTH FROM replace(e.last_name || e.first_name, ' ', '')))
        )
        LEFT JOIN attendance_overrides ao ON ao.employee_id = e.id AND ao.date = sd.date
        WHERE dp.punch_count = 1 AND (ao.override_type IS NULL OR (ao.override_type = 'status_override' AND ao.details->>'pending_treatment' IS NULL))
      `;

      const pendingResult = await pool.query(pendingCheckQuery, pendingParams);
      const pendingCount = parseInt(pendingResult.rows[0]?.pending_count || 0);
      const canValidate = pendingCount === 0;

      res.json({
        success: true,
        can_validate: canValidate,
        pending_count: pendingCount,
        message: canValidate ?
          'Month validation is allowed' :
          `Cannot validate month: ${pendingCount} pending partial cases must be treated first`
      });

    } catch (error) {
      console.error('Check validation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check validation status',
        details: error.message
      });
    }
  });

  // Check if month validation is allowed for a specific employee (ignores others' pending)
  router.get('/validation/check/employee/:employeeId/:year/:month', verifyToken, async (req, res) => {
    try {
      const { employeeId, year, month } = req.params;

      const y = parseInt(year), m = parseInt(month);
      if (!employeeId || !y || !m) {
        return res.status(400).json({ success: false, error: 'Invalid employeeId, year or month' });
      }

      // Count days in the month where this employee has exactly one raw punch on SCHEDULED days
      // and no pending treatment recorded in overrides
      const pendingCheckQuery = `
        WITH month_days AS (
          SELECT d::date AS date
          FROM generate_series(
            date_trunc('month', make_date($2::integer, $3::integer, 1)),
            date_trunc('month', make_date($2::integer, $3::integer, 1)) + interval '1 month - 1 day',
            '1 day'::interval
          ) AS d
        ),
        scheduled_days AS (
          SELECT md.date
          FROM month_days md
          WHERE EXISTS (
            SELECT 1 FROM timetable_intervals ti
            JOIN employee_timetables et ON ti.timetable_id = et.timetable_id
            WHERE et.employee_id = $1
              AND (
                EXTRACT(ISODOW FROM md.date) = ti.weekday
                OR (ti.weekday = 0 AND EXTRACT(ISODOW FROM md.date) = 7)
              )
              AND md.date BETWEEN COALESCE(et.effective_from, '1900-01-01')
              AND COALESCE(et.effective_to, '2100-12-31')
          )
        ),
        employee_ref AS (
          SELECT id, 
            lower(TRIM(BOTH FROM replace(first_name || ' ' || last_name, ' ', ''))) AS n1,
            lower(TRIM(BOTH FROM replace(last_name || ' ' || first_name, ' ', ''))) AS n2,
            lower(TRIM(BOTH FROM replace(first_name || last_name, ' ', ''))) AS n3,
            lower(TRIM(BOTH FROM replace(last_name || first_name, ' ', ''))) AS n4
          FROM employees
          WHERE id = $1
        ),
        day_punches AS (
          SELECT 
            DATE(rp.punch_time) AS date,
            COUNT(*) AS punch_count
          FROM raw_punches rp
          JOIN employee_ref er ON lower(TRIM(BOTH FROM replace(rp.employee_name, ' ', ''))) IN (er.n1, er.n2, er.n3, er.n4)
          WHERE EXTRACT(YEAR FROM rp.punch_time) = $2
            AND EXTRACT(MONTH FROM rp.punch_time) = $3
          GROUP BY DATE(rp.punch_time)
        )
        SELECT COUNT(*) AS pending_count
        FROM scheduled_days sd
        LEFT JOIN day_punches dp ON dp.date = sd.date
        LEFT JOIN attendance_overrides ao 
          ON ao.employee_id = $1 
         AND ao.date = sd.date
        WHERE dp.punch_count = 1
          AND (
            -- Old style pending (no treatment recorded in status_override details)
            ao.override_type IS NULL 
            OR (ao.override_type = 'status_override' AND (ao.details->>'pending_treatment') IS NULL)
          )
      `;

      const result = await pool.query(pendingCheckQuery, [employeeId, y, m]);
      const pendingCount = parseInt(result.rows[0]?.pending_count || 0);
      const canValidate = pendingCount === 0;

      res.json({
        success: true,
        can_validate: canValidate,
        pending_count: pendingCount,
        message: canValidate ?
          'Employee month validation is allowed' :
          `Cannot validate employee month: ${pendingCount} pending partial cases must be treated first`
      });
    } catch (error) {
      console.error('Check employee validation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check employee validation status',
        details: error.message
      });
    }
  });

  // Get pending statistics for dashboard
  router.get('/pending/stats', verifyToken, async (req, res) => {
    try {
      const { year, month, department } = req.query;

      let whereConditions = ['pac.current_status = \'pending\''];
      let queryParams = [];
      let paramIndex = 1;

      if (year) {
        whereConditions.push(`EXTRACT(YEAR FROM pac.punch_date) = $${paramIndex}`);
        queryParams.push(parseInt(year));
        paramIndex++;
      }

      if (month) {
        whereConditions.push(`EXTRACT(MONTH FROM pac.punch_date) = $${paramIndex}`);
        queryParams.push(parseInt(month));
        paramIndex++;
      }

      if (department) {
        whereConditions.push(`e.department_id = $${paramIndex}`);
        queryParams.push(department);
        paramIndex++;
      }

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

      const query = `
        SELECT 
          COUNT(*) as total_pending,
          COUNT(DISTINCT pac.employee_id) as employees_with_pending,
          COUNT(DISTINCT pac.punch_date) as days_with_pending
        FROM partial_attendance_cases pac
        JOIN employees e ON e.id = pac.employee_id
        ${whereClause}
      `;

      const result = await pool.query(query, queryParams);
      const stats = result.rows[0] || { total_pending: 0, employees_with_pending: 0, days_with_pending: 0 };

      res.json({
        success: true,
        stats: {
          total_pending: parseInt(stats.total_pending),
          employees_with_pending: parseInt(stats.employees_with_pending),
          days_with_pending: parseInt(stats.days_with_pending)
        }
      });

    } catch (error) {
      console.error('Get pending stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pending statistics',
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