# Contract Management System - Testing Guide

## Prerequisites

1. ✅ Database migration completed (`database/add_contract_management_system.sql`)
2. ✅ Node packages installed (`npm install` in `user-management-service`)
3. ✅ Word template files placed in project root or `contract-templates` folder

## Testing Checklist

### 1. Database Verification
Run the verification script:
```sql
\i database/verify_contract_management.sql
```

Expected results:
- ✅ All tables, sequences, triggers, and functions should exist
- ✅ Contract number generation should work

### 2. Employee Creation with ID Card Info

**Test Steps:**
1. Navigate to "Add Employee" page
2. Fill in all required fields
3. **Fill in ID Card Information section:**
   - ID Card Number (required)
   - ID Issue Date (required)
   - ID Issue Authority (required)
   - Arabic Place of Birth (optional)
   - Arabic Address (optional)
   - Arabic Nationality (defaults to "جزائرية")
4. **Fill in Contract Information:**
   - Contract Start Date
   - Contract End Date (optional)
   - Contract Salary
   - Probation Months
5. Submit the form

**Expected Results:**
- ✅ Employee created successfully
- ✅ Identity record created in `employee_identities` table
- ✅ Contract created with auto-generated contract number (format: 00012026)
- ✅ Contract duration automatically calculated

### 3. Excel Import/Export

**Test Import:**
1. Download Excel template
2. Fill in employee data including:
   - ID card information
   - Contract information
   - Education level
3. Upload the Excel file

**Expected Results:**
- ✅ All employees imported successfully
- ✅ Identity records created
- ✅ Contracts created with contract numbers
- ✅ Education levels imported

**Test Export:**
1. Click "Export All Data (Excel)"
2. Open the downloaded file

**Expected Results:**
- ✅ All employee data exported
- ✅ Identity information included
- ✅ Contract information included
- ✅ Credentials generated

### 4. Contract Management Page

**Test Access:**
1. Navigate to HR Management space
2. Click "Contract Management" in sidebar

**Expected Results:**
- ✅ Page loads successfully
- ✅ Contracts table displays
- ✅ Filters work (name, year, status)

**Test Filters:**
1. Search by employee name
2. Filter by year
3. Filter by status (active/expired)

**Expected Results:**
- ✅ Filters apply correctly
- ✅ Table updates with filtered results

### 5. Contract Operations

**Test View Contract:**
1. Click "View" button on any contract
2. Check contract details modal

**Expected Results:**
- ✅ All contract details displayed
- ✅ Employee information shown
- ✅ Contract number visible

**Test Edit Contract:**
1. Click "Edit" button
2. Modify contract dates, salary, or probation period
3. Save changes

**Expected Results:**
- ✅ Contract updated successfully
- ✅ Duration recalculated automatically
- ✅ Changes reflected in table

**Test Delete Contract:**
1. Click "Delete" button
2. Confirm deletion

**Expected Results:**
- ✅ Contract deleted successfully
- ✅ Removed from table

**Test View History:**
1. Click "History" button
2. View contract history for employee

**Expected Results:**
- ✅ All contracts for employee displayed
- ✅ Historical contracts shown
- ✅ Active/inactive status visible

### 6. Bulk Contract Renewal

**Test Steps:**
1. Select multiple contracts (checkboxes)
2. Click "Bulk Renew Contracts"
3. Fill in renewal form:
   - New Start Date (required)
   - New End Date (optional)
   - Contract Salary
   - Probation Months
   - Position (optional)
4. Submit

**Expected Results:**
- ✅ Old contracts deactivated (is_active = false)
- ✅ New contracts created with new contract numbers
- ✅ All selected employees renewed
- ✅ History preserved (old contracts still in database)

### 7. Contract Document Generation

**Prerequisites:**
- Word template file must exist in project root or `contract-templates` folder
- Template should use placeholders like `{{Full_Name}}`, `{{ID_No}}`, etc.

**Test Steps:**
1. View a contract that has complete data (ID card info, etc.)
2. Click "Generate Document" button
3. Wait for download

**Expected Results:**
- ✅ Word document generated
- ✅ All placeholders filled with correct data
- ✅ Document downloaded automatically
- ✅ Document path saved to contract record

**Template Placeholders Supported:**
- `{{Full_Name}}` - Employee Arabic name
- `{{ID_No}}` - ID card number
- `{{Duration}}` - Contract duration in months (Arabic)
- `{{Salary}}` - Contract salary
- `{{Contract_Number}}` - Contract number
- `{{Birth_Date}}` - Birth date (DD/MM/YYYY)
- `{{Birth_Place}}` - Place of birth (Arabic)
- `{{Nationality}}` - Nationality (Arabic)
- `{{Address}}` - Address (Arabic)
- `{{Issue_Date}}` - ID issue date
- `{{Issue_Authority}}` - ID issue authority

### 8. Edit Employee with Identity Info

**Test Steps:**
1. Edit an existing employee
2. Add or update ID card information
3. Save changes

**Expected Results:**
- ✅ Identity information saved/updated
- ✅ All fields preserved

### 9. Excel Template Download

**Test Steps:**
1. Click "Download Excel Template"
2. Open the downloaded file

**Expected Results:**
- ✅ Template includes all new columns:
  - ID Card Number
  - ID Issue Date
  - ID Issue Authority
  - Arabic Place of Birth
  - Arabic Address
  - Arabic Nationality
  - Contract Salary
  - Probation Months
  - Education Level
- ✅ Example row included
- ✅ No nationality or foreign_address columns

## Common Issues & Solutions

### Issue: "Contract template file not found"
**Solution:** 
- Place Word template in project root or `user-management-service/contract-templates/` folder
- Name it `حليمي اسلام.docx`, `عمي لينة.docx`, or `template.docx`

### Issue: Contract number not generated
**Solution:**
- Check if `contract_number_seq` sequence exists
- Verify `generate_contract_number()` function exists
- Check database migration was run successfully

### Issue: Duration not calculated
**Solution:**
- Verify trigger `trg_calculate_contract_duration` exists
- Check that both start_date and end_date are provided
- Verify trigger function `calculate_contract_duration()` exists

### Issue: Identity info not saving
**Solution:**
- Check that `employee_identities` table exists
- Verify ID card number, issue date, and authority are provided (required fields)
- Check database constraints

## Performance Testing

1. **Bulk Import:** Test importing 50+ employees via Excel
2. **Bulk Renewal:** Test renewing 20+ contracts at once
3. **Filtering:** Test filters with large dataset (100+ contracts)

## Security Testing

1. ✅ Only HR Manager and Director can access contract management
2. ✅ Only HR Manager and Director can create/update/delete contracts
3. ✅ Authentication required for all endpoints
4. ✅ User can only view their own contract (if Employee role)

## Integration Testing

1. ✅ Contract creation from employee form works
2. ✅ Contract renewal maintains history
3. ✅ Document generation uses correct data
4. ✅ Excel import creates contracts with numbers
5. ✅ Excel export includes all contract data
