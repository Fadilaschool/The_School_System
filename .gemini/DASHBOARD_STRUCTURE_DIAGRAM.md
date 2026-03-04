# Responsible Dashboard - Structure Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RESPONSIBLE DASHBOARD                             │
│                                                                      │
│  👤 [Responsible Name]                                               │
│  🏢 [Department Name] - [X] Employees                                │
│  📅 Filter: [Current Month ▼]                                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  👤 MY PERSONAL DATA                              [Personal] Badge   │
│  As an employee of the institution                                   │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┬──────────────┬──────────────┬──────────────┐
│  📋 My Tasks │ 📄 My Reports│ 📝 My Requests│ 💰 My Salary │
│              │              │              │              │
│  Total: X    │  Total: X    │  Exceptions: │  Net: X DA   │
│  Done: X     │  Read: X     │  X           │              │
│  Progress: X │  Pending: X  │  Extra Hrs:  │  Status:     │
│  Overdue: X  │  Today: X    │  X           │  Paid ✓      │
└──────────────┴──────────────┴──────────────┴──────────────┘

┌──────────────┬──────────────┬──────────────┐
│ 📅 My        │ ⚠️ My Signals│ 💬 My        │
│ Timetable    │              │ Complaints   │
│              │  Total: X    │              │
│ [View        │  Pending: X  │  Total: X    │
│  Schedule]   │  Treated: X  │  Pending: X  │
│              │  High Pri: X │  Done: X     │
│ On-call: Xh  │              │  Overdue: X  │
└──────────────┴──────────────┴──────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  📊 MY ATTENDANCE SUMMARY                         [Personal] Badge   │
│                                                                      │
│  Work Days: X │ Absent: X │ Overtime: Xh │ Late: Xm │ Early: Xm    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  👥 DEPARTMENT MANAGEMENT                        [Management] Badge  │
│  Oversight and statistics for your department                        │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┬──────────────┬──────────────┬──────────────┐
│ 📋 Dept Tasks│ 📄 Dept      │ 📝 Dept      │ 📊 Dept      │
│              │ Reports      │ Requests     │ Attendance   │
│ Created: X   │              │              │              │
│ Done: X      │  Total: X    │  Exceptions: │  Employees:  │
│ Received: X  │  Read: X     │  Pending: X  │  X           │
│ Done: X      │  Pending: X  │  Accepted: X │              │
│              │  Today: X    │  Extra Hrs:  │  Avg Work:   │
│              │              │  Pending: X  │  X days      │
│              │              │  Accepted: X │              │
└──────────────┴──────────────┴──────────────┴──────────────┘

┌──────────────────────────┬──────────────────────────┐
│  ⚠️ Assigned Signals     │                          │
│  (To Handle/Manage)      │                          │
│                          │                          │
│  Total: X                │                          │
│  Pending: X              │                          │
│  Treated: X              │                          │
│  High Priority: X        │                          │
└──────────────────────────┴──────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  📊 DEPARTMENT ATTENDANCE DETAILS                [Management] Badge  │
│                                                                      │
│  Work Days: X │ Absent: X │ Overtime: Xh │ Late: Xm │ Early: Xm    │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Distinctions

### Personal Section (Blue 🔵)
**What it shows**: The responsible's OWN data as an employee

| Card | Description | Who |
|------|-------------|-----|
| My Tasks | Tasks assigned TO them | Them as employee |
| My Reports | Reports THEY submitted | Them as employee |
| My Requests | THEIR exceptions/overtime | Them as employee |
| My Salary | THEIR salary | Them as employee |
| My Timetable | THEIR work schedule | Them as employee |
| **My Signals** | Signals THEY submitted | Them as employee |
| **My Complaints** | Complaints THEY submitted | Them as employee |
| My Attendance | THEIR attendance | Them as employee |

### Department Section (Purple 🟣)
**What it shows**: Department oversight data

| Card | Description | Who |
|------|-------------|-----|
| Dept Tasks | Tasks created BY them for dept OR received by dept | Them as manager |
| Dept Reports | Reports from department employees | Department employees |
| Dept Requests | Requests from department employees | Department employees |
| Dept Attendance | Aggregated attendance | Department employees |
| **Assigned Signals** | Signals assigned TO them to HANDLE | Them as responsible |

## Important Notes

### Signals - Two Different Things!

1. **My Signals** (Personal Section)
   - Signals the responsible SUBMITTED as an employee
   - Example: "The AC in my office is broken"
   - API: `/api/signals?created_by={responsibleId}`

2. **Assigned Signals** (Department Section)
   - Signals assigned TO the responsible to MANAGE/RESOLVE
   - Example: "Broken window in classroom 3A" (assigned to maintenance responsible)
   - API: `/api/signals/responsible/{responsibleId}/statistics`

### Complaints - Only Personal

- Complaints are only in the Personal section
- These are complaints the responsible SUBMITTED
- There's no "department complaints" concept in the current system
- API: `/api/complaints?employee_id={responsibleId}`

### Timetable - Personal Only

- Shows the responsible's own work schedule
- Current week view with on-call hours
- Link to full timetable management page
- API: `/api/timetables/employee/{responsibleId}`

