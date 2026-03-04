-- Test script to verify contract creation works
-- Run this to test if you can manually insert a contract

-- First, check if the table exists
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'employee_contracts'
ORDER BY ordinal_position;

-- Check if you have any employees
SELECT id, first_name, last_name, position_id 
FROM employees 
LIMIT 5;

-- Try to insert a test contract (replace with actual employee_id and position_id)
-- Uncomment and modify the following to test:
/*
INSERT INTO employee_contracts (
    employee_id, 
    position_id, 
    start_date, 
    end_date, 
    is_active
) VALUES (
    'YOUR_EMPLOYEE_ID_HERE',  -- Replace with actual employee ID
    'YOUR_POSITION_ID_HERE',  -- Replace with actual position ID
    '2026-02-16',
    '2026-07-31',
    true
) RETURNING *;
*/

-- Check existing contracts
SELECT 
    ec.id,
    ec.employee_id,
    e.first_name || ' ' || e.last_name as employee_name,
    p.name as position_name,
    ec.start_date,
    ec.end_date,
    ec.is_active,
    ec.created_at
FROM employee_contracts ec
LEFT JOIN employees e ON ec.employee_id = e.id
LEFT JOIN positions p ON ec.position_id = p.id
ORDER BY ec.created_at DESC
LIMIT 10;
