-- Verify employee_contracts table structure and data

-- 1. Check table structure (should include id column)
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'employee_contracts'
ORDER BY ordinal_position;

-- 2. Check if there are any contracts
SELECT COUNT(*) as total_contracts FROM employee_contracts;

-- 3. View all contracts with employee and position info
SELECT 
    ec.id,
    ec.employee_id,
    e.first_name || ' ' || e.last_name as employee_name,
    ec.position_id,
    p.name as position_name,
    ec.start_date,
    ec.end_date,
    ec.is_active,
    ec.contract_type,
    ec.created_at,
    ec.updated_at
FROM employee_contracts ec
LEFT JOIN employees e ON ec.employee_id = e.id
LEFT JOIN positions p ON ec.position_id = p.id
ORDER BY ec.created_at DESC;

-- 4. Check the specific contract that was just created (from the logs)
SELECT * FROM employee_contracts 
WHERE id = 'fe9bd6fe-ec17-4c02-aa83-cdaf666538ed';

-- 5. Check contracts for the employee that was just created
SELECT * FROM employee_contracts 
WHERE employee_id = '41d83650-2a13-4504-b259-b055918667af';
