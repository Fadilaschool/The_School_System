# Document Generation Feature Implementation

## Overview
This implementation adds the necessary database fields and UI components to support generating "Attestation de Travail" (ATS) and "Certificat de Travail" documents from the database.

## Database Changes

### SQL Migration File
Run the migration file: `database/add_document_generation_fields.sql`

This migration:
1. Adds `place_of_birth` and `social_security_number` columns to `employees` table
2. Adds `address`, `wilaya`, and `registration_number` columns to `branches` table
3. Creates new `employee_contracts` table to track contract history

### New Table: `employee_contracts`
This table stores the employment contract history for each employee, allowing:
- Multiple contracts per employee (e.g., if they left and came back)
- Tracking of contract start and end dates
- Support for "Du... Au..." (From... To...) logic in Certificat de Travail
- NULL `end_date` indicates current/active contract (for ATS "à ce jour")

## Frontend Changes

### 1. Add Employee Form (`frontend/pages/add-employee.html`)
Added new fields:
- **Place of Birth**: Text input for employee's place of birth (e.g., "EL HAMMAMAT")
- **Social Security Number**: Text input for social security number (e.g., "00 1076 0037 64")
- **Contract Start Date**: Date input for the start date of the employee's contract

### 2. Branch Form (`frontend/pages/org-structure.html`)
Added new fields to branch creation/editing:
- **Address**: Full address of the branch (e.g., "Cité BENADJEL (20 août) BOUDOUAOU")
- **Wilaya**: Province where the branch is located (e.g., "BOUMERDES")
- **Registration Number**: Registration number (N° Adhérent) of the branch (e.g., "35370248 57")

## Backend Changes

### 1. User Management Service (`user-management-service/index.js`)
- Updated employee creation endpoint to accept and store:
  - `place_of_birth`
  - `social_security_number`
  - `contract_start_date` (creates initial contract in `employee_contracts` table)
- Updated employee update endpoint to allow updating:
  - `place_of_birth`
  - `social_security_number`

### 2. Department Service (`department-service/index.js`)
- Updated branch GET endpoint to return new fields: `address`, `wilaya`, `registration_number`
- Updated branch POST endpoint to accept and store new fields
- Updated branch PUT endpoint to allow updating new fields

## Data Required for Document Generation

### For "Attestation de Travail" (ATS):
- **Branch Info**: name, description, address, wilaya, registration_number
- **Employee Info**: first_name, last_name, birth_date, place_of_birth, address, social_security_number
- **Contract Info**: position_name (from contract), start_date (from active contract)

### For "Certificat de Travail":
- Same as ATS, plus:
- **Contract Info**: start_date AND end_date (from specific contract)

## SQL Queries for Document Generation

### Query for ATS (Active Contract):
```sql
SELECT 
  e.first_name, e.last_name, e.birth_date, e.place_of_birth, 
  e.address, e.social_security_number,
  b.name as branch_name, b.description, b.address as branch_address, 
  b.wilaya, b.registration_number,
  p.name as position_name,
  c.start_date
FROM employees e
JOIN employee_contracts c ON e.id = c.employee_id AND c.end_date IS NULL
JOIN positions p ON c.position_id = p.id
JOIN employee_departments ed ON e.id = ed.employee_id
JOIN departments d ON ed.department_id = d.id
-- Note: You may need to link Branch to Department or Employee directly
-- This depends on your current schema - branches might be linked via institution field
WHERE e.id = $1;
```

### Query for Certificat (Specific Contract):
```sql
SELECT 
  e.first_name, e.last_name, e.birth_date, e.place_of_birth, 
  e.address, e.social_security_number,
  b.name as branch_name, b.description, b.address as branch_address, 
  b.wilaya, b.registration_number,
  p.name as position_name,
  c.start_date,
  c.end_date
FROM employees e
JOIN employee_contracts c ON e.id = c.employee_id
JOIN positions p ON c.position_id = p.id
WHERE e.id = $1 AND c.id = $2; -- $2 is the contract_id
```

## Next Steps

1. **Run the SQL migration**: Execute `database/add_document_generation_fields.sql` on your database
2. **Test the forms**: 
   - Add a new employee with the new fields
   - Add/edit a branch with the new fields
3. **Implement document generation**: Create the actual document generation functionality that uses these fields
4. **Link branches to employees**: You may need to establish the relationship between employees and branches (currently employees have `institution` field which might be the branch name)

## Notes

- The `employee_contracts` table allows for multiple contracts per employee, supporting contract renewals and re-hires
- When creating a new employee with a `contract_start_date`, an initial contract is automatically created
- The branch-employee relationship might need to be clarified - currently employees have an `institution` field that might correspond to branch name
- Consider adding a UI for managing employee contracts separately (viewing contract history, adding new contracts, ending contracts)
