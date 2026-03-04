// PASTE THIS CODE TO FIX THE ERROR
// Replace lines 1335-1343 in responsible-dashboard.html with this:

const dateRange = getDateRange(currentPeriod);
const hasData = await Promise.all([
    loadTasksStatistics(dateRange),
    loadReportsStatistics(dateRange),
    loadRequestsStatistics(dateRange),
    loadAttendanceStatistics(dateRange),
    loadSignalsStatistics(dateRange)
]);
