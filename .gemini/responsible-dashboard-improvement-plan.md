# Responsible Dashboard Improvement Plan

## Overview
The responsible dashboard needs to be restructured to clearly separate:
1. **Personal Employee Data** - The responsible's own employee statistics
2. **Department Management Data** - Statistics for the department they manage

## Current Structure Analysis

### Database Schema
From `current.sql`, the `employees` table contains:
- `id` (UUID) - Employee identifier
- `user_id` (UUID) - Link to user account
- `position_id` (UUID) - Employee position
- `first_name`, `last_name` - Employee name
- Personal data: phone, email, address, etc.
- Employment data: join_date, marital_status, etc.

The `departments` table contains:
- `id` (UUID) - Department identifier  
- `name` - Department name
- `responsible_id` (UUID) - Links to employees.id

### Current Dashboard Issues
The current dashboard mixes:
- Department-level statistics (tasks created/received by department)
- Personal statistics (should show the responsible's own data as an employee)

## Proposed Structure

### Section 1: My Personal Data
**Header**: "My Personal Data - As an employee of the institution"
**Cards**:
1. **My Tasks** - Tasks assigned TO the responsible as an employee
   - Total, Completed, In Progress, Overdue
2. **My Reports** - Reports submitted BY the responsible
   - Total, Read, Pending, Today
3. **My Requests** - Personal attendance exceptions/overtime
   - My Exceptions, My Extra Hours
4. **My Salary** - Personal salary information
   - Net Salary, Payment Status
5. **My Timetable** - Personal work schedule
   - Current week schedule, on-call hours
   - Link to full timetable view
6. **My Signals** - Signals submitted BY the responsible
   - Total, Pending, Treated, High Priority
7. **My Complaints** - Complaints submitted BY the responsible
   - Total, Pending, Completed, Overdue
8. **My Attendance** - Personal attendance summary
   - Work Days, Absent Days, Overtime, Late, Early Leave

### Section 2: Department Management
**Header**: "Department Management - Oversight and statistics for your department"
**Cards**:
1. **Department Tasks** - Tasks for department employees
   - Created by Me (as responsible), Completed
   - Received by Dept, Completed
2. **Department Reports** - Reports from department employees
   - Total, Read, Pending, Today
3. **Department Requests** - Requests from department employees
   - Exceptions (Pending/Accepted), Extra Hours (Pending/Accepted)
4. **Department Attendance** - Aggregated attendance
   - Total Employees, Average metrics
5. **Assigned Signals** - Signals assigned TO the responsible for handling/resolution
   - Total, Pending, Treated, High Priority
   - Note: These are different from "My Signals" - these are signals the responsible needs to MANAGE

## Implementation Steps

1. **HTML Structure**:
   - Add section dividers with clear visual distinction
   - Duplicate stat cards with new IDs (my* prefix for personal, keep existing for department)
   - Use different color schemes (blue for personal, purple for management)

2. **JavaScript Functions**:
   - Create `loadMyPersonalData()` - Loads responsible's own employee data
   - Keep existing `loadDashboardData()` - Loads department management data
   - Add `loadMyTasks()`, `loadMyReports()`, `loadMyAttendance()`, etc.

3. **API Calls**:
   - Personal: Filter by `employee_id = currentResponsibleId`
   - Department: Filter by `department_id = currentDepartmentId` or employees in department

## Visual Design

### Personal Section
- **Color**: Blue gradient (#3b82f6 to #2563eb)
- **Icon**: fa-user
- **Pill**: "Personal" badge

### Management Section  
- **Color**: Purple gradient (#7c3aed to #6d28d9)
- **Icon**: fa-users-cog
- **Pill**: "Management" badge

## Data Sources

### Personal Data APIs
- Tasks: `/tasks?assignee_id={responsibleId}`
- Reports: `/api/rapportemp/employee/{responsibleId}/reports`
- Attendance: `/api/attendance/monthly?employee_id={responsibleId}`
- Requests: `/api/exceptions?employee_id={responsibleId}`
- Salary: `/api/salary/employee/{responsibleId}`

### Department Data APIs (existing)
- Tasks: `/tasks` (filter by department employees)
- Reports: Aggregate from all department employees
- Attendance: Aggregate from all department employees
- Requests: `/api/exceptions/pending?departmentId={deptId}`
- Signals: `/api/signals/responsible/{responsibleId}/statistics`

## Benefits
1. **Clear Separation**: Responsible can see their own performance vs department performance
2. **Better UX**: No confusion between personal and managerial responsibilities
3. **Complete Picture**: Responsible sees all relevant data in one place
4. **Consistent with Employee Dashboard**: Personal section mirrors employee dashboard
5. **Enhanced Management**: Department section provides oversight tools

