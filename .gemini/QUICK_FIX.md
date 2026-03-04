# Quick Fix for loadComplaintsStatistics Error

## Problem
Line 1342 in `responsible-dashboard.html` still calls `loadComplaintsStatistics(dateRange)` which no longer exists.

## Solution

**Find line 1342** in `responsible-dashboard.html`:

```javascript
loadComplaintsStatistics(dateRange)
```

**Delete that entire line** (including the comma on line 1341 if it's there).

The section should look like this BEFORE:
```javascript
const hasData = await Promise.all([
    loadTasksStatistics(dateRange),
    loadReportsStatistics(dateRange),
    loadRequestsStatistics(dateRange),
    loadAttendanceStatistics(dateRange),
    loadSignalsStatistics(dateRange),
    loadComplaintsStatistics(dateRange)  // ← DELETE THIS LINE
]);
```

And like this AFTER:
```javascript
const hasData = await Promise.all([
    loadTasksStatistics(dateRange),
    loadReportsStatistics(dateRange),
    loadRequestsStatistics(dateRange),
    loadAttendanceStatistics(dateRange),
    loadSignalsStatistics(dateRange)  // ← Remove comma here too
]);
```

## Why?
Complaints are now loaded in the **Personal Data Section** by the `loadMyPersonalComplaints()` function, not in the department management section.

---

## Also: About "Assigned Signals"

You mentioned wanting to move "Assigned Signals" away from the department section. Here's the clarification:

### Current Structure (Correct):
- **Personal Section** → **My Signals** (signals YOU submitted as an employee)
- **Department Section** → **Assigned Signals** (signals assigned TO YOU to manage/resolve)

These are TWO DIFFERENT things:
1. **My Signals** = Signals you created (e.g., "AC broken in my office")
2. **Assigned Signals** = Signals you need to handle as a responsible (e.g., "Broken window in classroom 3A")

### If you want to remove "Assigned Signals" entirely:
Delete lines **970-1011** in `responsible-dashboard.html` (the entire "Assigned Signals" card in the Department section).

Let me know if you want me to do that!
