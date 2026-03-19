// Personal Data Loaders for Responsible Dashboard
// These functions load the responsible's OWN employee data (not department data)

// Load MY personal tasks (assigned TO me as an employee)
async function loadMyPersonalTasks() {
    try {
        if (!currentResponsibleId) return false;
        const tasksApiBase = window.API_SERVICES?.hr_tasks ?? '';
        const token = authManager.getToken();
        if (!token) return false;

        const tasksResponse = await fetch(`${tasksApiBase}/tasks`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!tasksResponse.ok) return false;

        const tasksData = await tasksResponse.json();
        let allTasks = Array.isArray(tasksData) ? tasksData : (tasksData.tasks || []);
        const myTasks = allTasks.filter(t => t.assignees?.some(a => String(a.id) === String(currentResponsibleId)));

        const total = myTasks.length;
        const completed = myTasks.filter(t => t.status === 'completed').length;
        const inProgress = myTasks.filter(t => t.status === 'in_progress').length;
        const overdue = myTasks.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()).length;

        document.getElementById('myTasksTotal').textContent = total;
        document.getElementById('myTasksCompleted').textContent = completed;
        document.getElementById('myTasksInProgress').textContent = inProgress;
        document.getElementById('myTasksOverdue').textContent = overdue;
        return total > 0;
    } catch (error) {
        console.error('Error loading my personal tasks:', error);
        return false;
    }
}

// Load MY personal reports
async function loadMyPersonalReports() {
    try {
        if (!currentResponsibleId) return false;
        const reportsApiBase = window.API_SERVICES?.hr_tasks ?? '';
        const token = authManager.getToken();
        if (!token) return false;

        const response = await fetch(`${reportsApiBase}/api/rapportemp/employee/${currentResponsibleId}/reports`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) return false;

        const data = await response.json();
        const myReports = Array.isArray(data) ? data : (data.reports || []);

        const total = myReports.length;
        const read = myReports.filter(r => r.is_read || r.read_at).length;
        const pending = total - read;
        const today = myReports.filter(r => new Date(r.created_at).toDateString() === new Date().toDateString()).length;

        document.getElementById('myReportsTotal').textContent = total;
        document.getElementById('myReportsRead').textContent = read;
        document.getElementById('myReportsPending').textContent = pending;
        document.getElementById('myReportsToday').textContent = today;
        return total > 0;
    } catch (error) {
        console.error('Error loading my personal reports:', error);
        return false;
    }
}

// Load MY personal requests
async function loadMyPersonalRequests() {
    try {
        if (!currentResponsibleId) return false;
        const attendanceApiBase = window.API_SERVICES?.attendance ?? '/api';
        const token = authManager.getToken();
        if (!token) return false;

        let exceptionsCount = 0, extraHoursCount = 0;

        try {
            const exceptionsResponse = await fetch(`${attendanceApiBase}/api/exceptions?employee_id=${currentResponsibleId}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (exceptionsResponse.ok) {
                const exceptionsData = await exceptionsResponse.json();
                const exceptions = Array.isArray(exceptionsData) ? exceptionsData : (exceptionsData.exceptions || []);
                exceptionsCount = exceptions.length;
            }
        } catch (e) { console.warn('Error fetching exceptions:', e); }

        try {
            const overtimeResponse = await fetch(`${attendanceApiBase}/api/attendance/overtime?employee_id=${currentResponsibleId}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (overtimeResponse.ok) {
                const overtimeData = await overtimeResponse.json();
                const overtime = Array.isArray(overtimeData) ? overtimeData : (overtimeData.overtime || []);
                extraHoursCount = overtime.reduce((sum, o) => sum + (o.hours || 0), 0);
            }
        } catch (e) { console.warn('Error fetching overtime:', e); }

        document.getElementById('myExceptionsCount').textContent = exceptionsCount;
        document.getElementById('myExtraHoursCount').textContent = extraHoursCount;
        return (exceptionsCount + extraHoursCount) > 0;
    } catch (error) {
        console.error('Error loading my personal requests:', error);
        return false;
    }
}

// Load MY personal salary
async function loadMyPersonalSalary() {
    try {
        if (!currentResponsibleId) return false;
        const salaryApiBase = window.API_SERVICES?.salary ?? '/api/salary';
        const token = authManager.getToken();
        if (!token) return false;

        const response = await fetch(`${salaryApiBase}/api/salary/employee/${currentResponsibleId}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) return false;

        const data = await response.json();
        const salary = data.salary || data;

        if (salary.net_salary) {
            document.getElementById('myLastMonthSalary').textContent = `${salary.net_salary.toLocaleString()} DA`;
            document.getElementById('mySalaryStatus').textContent = salary.status || 'Paid';
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error loading my personal salary:', error);
        return false;
    }
}

// Load MY personal signals
async function loadMyPersonalSignals() {
    try {
        if (!currentResponsibleId) return false;
        const signalsApiBase = window.API_SERVICES?.signals ?? '';
        const token = authManager.getToken();
        if (!token) return false;

        const response = await fetch(`${signalsApiBase}/api/signals?created_by=${currentResponsibleId}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) return false;

        const data = await response.json();
        const mySignals = Array.isArray(data) ? data : (data.signals || []);

        const total = mySignals.length;
        const pending = mySignals.filter(s => !s.is_treated).length;
        const treated = mySignals.filter(s => s.is_treated).length;
        const highPriority = mySignals.filter(s => s.priority === 'high').length;

        document.getElementById('mySignalsTotal').textContent = total;
        document.getElementById('mySignalsPending').textContent = pending;
        document.getElementById('mySignalsTreated').textContent = treated;
        document.getElementById('mySignalsHighPriority').textContent = highPriority;
        return total > 0;
    } catch (error) {
        console.error('Error loading my personal signals:', error);
        return false;
    }
}

// Load MY personal complaints
async function loadMyPersonalComplaints() {
    try {
        if (!currentResponsibleId) return false;
        const complaintsApiBase = window.API_SERVICES?.complaints ?? '';
        const token = authManager.getToken();
        if (!token) return false;

        const response = await fetch(`${complaintsApiBase}/api/complaints?employee_id=${currentResponsibleId}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) return false;

        const data = await response.json();
        const myComplaints = Array.isArray(data) ? data : (data.complaints || []);

        const total = myComplaints.length;
        const pending = myComplaints.filter(c => c.status === 'pending' || c.status === 'open').length;
        const completed = myComplaints.filter(c => c.status === 'completed' || c.status === 'resolved').length;
        const overdue = myComplaints.filter(c => {
            if (c.status === 'completed' || c.status === 'resolved') return false;
            return c.due_date && new Date(c.due_date) < new Date();
        }).length;

        document.getElementById('myComplaintsTotal').textContent = total;
        document.getElementById('myComplaintsPending').textContent = pending;
        document.getElementById('myComplaintsCompleted').textContent = completed;
        document.getElementById('myComplaintsOverdue').textContent = overdue;
        return total > 0;
    } catch (error) {
        console.error('Error loading my personal complaints:', error);
        return false;
    }
}

// Load MY personal attendance
async function loadMyPersonalAttendance() {
    try {
        if (!currentResponsibleId) return false;
        const attendanceApiBase = window.API_SERVICES?.attendance ?? '/api';
        const token = authManager.getToken();
        if (!token) return false;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        const response = await fetch(`${attendanceApiBase}/api/attendance/monthly?employee_id=${currentResponsibleId}&year=${year}&month=${month}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) return false;

        const data = await response.json();
        const attendance = data.attendance || data;

        const workDays = attendance.total_worked_days || 0;
        const absentDays = attendance.absence_days || 0;
        const overtime = attendance.total_overtime_hours || 0;
        const late = attendance.late_hours || 0;
        const early = attendance.early_departure_hours || 0;

        document.getElementById('myAttendanceWorkDays').textContent = workDays;
        document.getElementById('myAttendanceAbsentDays').textContent = absentDays;
        document.getElementById('myAttendanceOvertime').textContent = `${overtime.toFixed(1)}h`;
        document.getElementById('myAttendanceLate').textContent = `${Math.round(late * 60)}m`;
        document.getElementById('myAttendanceEarly').textContent = `${Math.round(early * 60)}m`;
        return true;
    } catch (error) {
        console.error('Error loading my personal attendance:', error);
        return false;
    }
}

// Format time for display (HH:MM:SS -> HH:MM)
function formatTime(timeString) {
    if (!timeString) return '';
    const parts = timeString.split(':');
    return `${parts[0]}:${parts[1]}`;
}

// Load MY personal schedule/timetable
async function loadSchedule() {
    try {
        if (!currentResponsibleId) {
            console.warn('No currentResponsibleId, cannot load schedule');
            document.getElementById('scheduleLoading').classList.add('hidden');
            document.getElementById('scheduleDisplay').classList.remove('hidden');
            document.getElementById('noScheduleMessage').classList.remove('hidden');
            return false;
        }

        console.log('Loading schedule for responsible ID:', currentResponsibleId);
        const timetableApiBase = window.API_SERVICES?.timetable ?? '/api/timetable';
        const response = await fetch(`${timetableApiBase}/employee-assignments/${currentResponsibleId}`, {
            headers: {
                'Authorization': `Bearer ${authManager.getToken()}`,
                'Content-Type': 'application/json'
            }
        });

        document.getElementById('scheduleLoading').classList.add('hidden');
        document.getElementById('scheduleDisplay').classList.remove('hidden');

        if (!response.ok) {
            if (response.status === 404) {
                console.log('No schedule found (404)');
                document.getElementById('noScheduleMessage').classList.remove('hidden');
                return false;
            }
            throw new Error('Failed to load schedule');
        }

        const data = await response.json();
        const intervals = data.intervals || [];
        const assignment = data.assignment || null;

        if (!intervals || intervals.length === 0) {
            console.log('No intervals in schedule');
            document.getElementById('noScheduleMessage').classList.remove('hidden');
            return false;
        }

        document.getElementById('noScheduleMessage').classList.add('hidden');
        console.log('Schedule loaded successfully, intervals:', intervals.length);

        // Display timetable name
        if (assignment && assignment.timetable_name) {
            const timetableLabel = typeof translate === 'function' ? translate('employee_dashboard.timetable') : 'Timetable';
            const timetableNameEl = document.getElementById('timetableName');
            if (timetableNameEl) {
                timetableNameEl.textContent = `${timetableLabel}: ${assignment.timetable_name}`;
            }
            if (assignment.timetable_type) {
                const scheduleTypeEl = document.getElementById('scheduleType');
                if (scheduleTypeEl) {
                    scheduleTypeEl.textContent = assignment.timetable_type.charAt(0).toUpperCase() + assignment.timetable_type.slice(1);
                }
            }
        }

        // Calculate statistics
        const totalDays = intervals.length;
        let totalHours = 0;

        intervals.forEach(interval => {
            if (interval.start_time && interval.end_time) {
                const start = new Date(`2000-01-01T${interval.start_time}`);
                const end = new Date(`2000-01-01T${interval.end_time}`);
                const diffMs = end - start;
                const diffHours = diffMs / (1000 * 60 * 60);
                totalHours += diffHours;
            }
        });

        document.getElementById('scheduleTotalDays').textContent = totalDays;
        document.getElementById('scheduleTotalHours').textContent = totalHours.toFixed(1) + 'h';

        // Display weekly schedule
        const daysContainer = document.querySelector('#scheduleDisplay .grid.grid-cols-1.md\\:grid-cols-7');
        if (daysContainer) {
            // Check if RTL (Arabic)
            const isRTL = document.documentElement.getAttribute('dir') === 'rtl' ||
                (typeof window !== 'undefined' && window.currentLanguage === 'ar');

            // Get translated day names
            const getDayName = (index) => {
                const keys = [
                    'employee_dashboard.day_sunday',
                    'employee_dashboard.day_monday',
                    'employee_dashboard.day_tuesday',
                    'employee_dashboard.day_wednesday',
                    'employee_dashboard.day_thursday',
                    'employee_dashboard.day_friday',
                    'employee_dashboard.day_saturday'
                ];
                return typeof translate === 'function' ? translate(keys[index]) : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index];
            };

            const getDayNameShort = (index) => {
                const keys = [
                    'employee_dashboard.day_sun',
                    'employee_dashboard.day_mon',
                    'employee_dashboard.day_tue',
                    'employee_dashboard.day_wed',
                    'employee_dashboard.day_thu',
                    'employee_dashboard.day_fri',
                    'employee_dashboard.day_sat'
                ];
                return typeof translate === 'function' ? translate(keys[index]) : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index];
            };

            daysContainer.innerHTML = '';

            // Create array of day indices, reversed for RTL
            const dayIndices = isRTL ? [6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6];

            for (let i = 0; i < 7; i++) {
                const dayIndex = dayIndices[i];
                const dayIntervals = intervals.filter(interval => parseInt(interval.weekday) === dayIndex);
                const hasSchedule = dayIntervals.length > 0;

                const dayCard = document.createElement('div');
                dayCard.className = 'bg-white rounded-xl border border-gray-200 p-4 hover:shadow-lg transition-all';

                const dayCardInner = document.createElement('div');
                dayCardInner.className = 'text-center';

                const dayNameShort = document.createElement('div');
                dayNameShort.className = 'text-xs font-semibold text-gray-500 mb-2';
                dayNameShort.textContent = getDayNameShort(dayIndex);

                const dayNameFull = document.createElement('div');
                dayNameFull.className = 'text-sm font-medium text-gray-800';
                dayNameFull.textContent = getDayName(dayIndex);

                dayCardInner.appendChild(dayNameShort);
                dayCardInner.appendChild(dayNameFull);

                if (hasSchedule) {
                    dayIntervals.forEach((interval, idx) => {
                        if (interval.start_time && interval.end_time) {
                            const startTime = formatTime(interval.start_time);
                            const endTime = formatTime(interval.end_time);

                            const timeSlot = document.createElement('div');
                            timeSlot.className = 'mt-2 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium';
                            timeSlot.textContent = `${startTime} - ${endTime}`;

                            dayCardInner.appendChild(timeSlot);

                            // Calculate duration
                            const start = new Date(`2000-01-01T${interval.start_time}`);
                            const end = new Date(`2000-01-01T${interval.end_time}`);
                            const diffMs = end - start;
                            const diffHours = diffMs / (1000 * 60 * 60);

                            const durationText = document.createElement('div');
                            durationText.className = 'mt-1 text-xs font-semibold text-green-600';
                            durationText.textContent = `${diffHours.toFixed(1)}h`;

                            dayCardInner.appendChild(durationText);
                        }
                    });
                } else {
                    const offDay = document.createElement('div');
                    offDay.className = 'mt-2 px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium';
                    offDay.setAttribute('data-translate', 'employee_dashboard.day_off');
                    offDay.textContent = typeof translate === 'function' ? translate('employee_dashboard.day_off') : 'Day Off';
                    dayCardInner.appendChild(offDay);
                }

                dayCard.appendChild(dayCardInner);
                daysContainer.appendChild(dayCard);
            }
        }

        return true;
    } catch (error) {
        console.error('Error loading schedule:', error);
        document.getElementById('scheduleLoading').classList.add('hidden');
        document.getElementById('scheduleDisplay').classList.remove('hidden');
        document.getElementById('noScheduleMessage').classList.remove('hidden');
        return false;
    }
}

// Load all personal data
async function loadAllPersonalData() {
    console.log('📊 Loading personal data for responsible...');
    await Promise.all([
        loadMyPersonalTasks(),
        loadMyPersonalReports(),
        loadMyPersonalRequests(),
        loadMyPersonalSalary(),
        loadMyPersonalSignals(),
        loadMyPersonalComplaints(),
        loadMyPersonalAttendance(),
        loadSchedule()
    ]);
    console.log('✅ Personal data loaded');
}
