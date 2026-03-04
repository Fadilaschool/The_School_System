-- Verification script for Contract Management System
-- Run this after add_contract_management_system.sql to verify everything was created correctly

-- Check if employee_identities table exists
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_identities')
        THEN '✅ employee_identities table exists'
        ELSE '❌ employee_identities table NOT found'
    END as status;

-- Check if contract_number_seq sequence exists
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema = 'public' AND sequence_name = 'contract_number_seq')
        THEN '✅ contract_number_seq sequence exists'
        ELSE '❌ contract_number_seq sequence NOT found'
    END as status;

-- Check if employee_contracts has new columns
SELECT 
    column_name,
    data_type,
    CASE 
        WHEN column_name IN ('contract_number', 'duration_months', 'probation_months', 'contract_salary', 'document_path')
        THEN '✅'
        ELSE ''
    END as status
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'employee_contracts'
  AND column_name IN ('contract_number', 'duration_months', 'probation_months', 'contract_salary', 'document_path')
ORDER BY column_name;

-- Check if triggers exist
SELECT 
    trigger_name,
    event_manipulation,
    CASE 
        WHEN trigger_name IN ('trg_calculate_contract_duration', 'trg_update_employee_identities_updated_at')
        THEN '✅'
        ELSE ''
    END as status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN ('trg_calculate_contract_duration', 'trg_update_employee_identities_updated_at')
ORDER BY trigger_name;

-- Check if functions exist
SELECT 
    routine_name,
    routine_type,
    CASE 
        WHEN routine_name IN ('calculate_contract_duration', 'generate_contract_number', 'update_updated_at_column')
        THEN '✅'
        ELSE ''
    END as status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('calculate_contract_duration', 'generate_contract_number', 'update_updated_at_column')
ORDER BY routine_name;

-- Test contract number generation function
SELECT 
    generate_contract_number('2026-01-15'::DATE) as test_contract_number,
    CASE 
        WHEN generate_contract_number('2026-01-15'::DATE) LIKE '____2026'
        THEN '✅ Contract number format correct'
        ELSE '❌ Contract number format incorrect'
    END as status;
