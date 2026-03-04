# Troubleshooting: Employee Edit Form - Empty Fields

## Problem
When editing an employee, the new fields (place_of_birth, social_security_number, contract_start_date, contract_end_date) show as empty even though they were filled during creation.

## Possible Causes

### 1. Database Migration Not Run (Most Likely)
The new columns might not exist in your database yet. The migration file `database/add_document_generation_fields.sql` needs to be executed.

**Solution:**
1. Connect to your PostgreSQL database
2. Run the migration file:
   ```sql
   \i database/add_document_generation_fields.sql
   ```
   Or execute the SQL commands directly in your database client.

3. Verify the columns exist by running:
   ```sql
   SELECT column_name 
   FROM information_schema.columns 
   WHERE table_name = 'employees' 
     AND column_name IN ('place_of_birth', 'social_security_number');
   ```

### 2. Employee Created Before Migration
If you created the employee BEFORE running the migration, those fields were never saved (they don't exist in the database yet).

**Solution:**
- Run the migration
- Re-edit the employee and fill in the fields again
- Or update the existing employee record directly in the database

### 3. Data Not Being Saved
Check the browser console and server logs when creating an employee. Look for any errors related to database columns.

**To Debug:**
1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Create a new employee with the new fields
4. Look for any error messages
5. Check the Network tab to see the API response

### 4. Date Format Issues
Contract dates might have format issues. The code now handles both DATE and TIMESTAMP formats.

## Quick Check

Run this SQL query to check if your employee has the data:

```sql
SELECT 
  id, 
  first_name, 
  last_name,
  place_of_birth,
  social_security_number
FROM employees 
WHERE id = 'YOUR_EMPLOYEE_ID';
```

And check contracts:

```sql
SELECT 
  id,
  employee_id,
  start_date,
  end_date,
  is_active
FROM employee_contracts
WHERE employee_id = 'YOUR_EMPLOYEE_ID';
```

## Verification Steps

1. **Check if columns exist:**
   - Run `database/check_migration_status.sql` to verify

2. **Check browser console:**
   - When editing an employee, open Developer Tools
   - Look for the console log: `📋 [Edit Employee] Loaded employee data:`
   - This will show what data is actually being returned from the API

3. **Check server logs:**
   - Look for: `📥 [Get Employee] Returning employee data:`
   - This shows what the backend is returning

4. **Test with a new employee:**
   - After running the migration, create a NEW employee with all fields
   - Then try to edit it to see if the fields load correctly

## Expected Behavior After Fix

After running the migration:
- Creating a new employee should save all fields
- Editing an employee should show all previously saved fields
- Console logs should show the field values in the debug output
