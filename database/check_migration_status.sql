-- Quick check to verify if the migration has been run
-- Run this to check if the new columns exist

-- Check employees table
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'employees' 
  AND column_name IN ('place_of_birth', 'social_security_number')
ORDER BY column_name;

-- Check branches table
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'branches' 
  AND column_name IN ('address', 'wilaya', 'registration_number')
ORDER BY column_name;

-- Check if employee_contracts table exists
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'employee_contracts'
ORDER BY ordinal_position;
