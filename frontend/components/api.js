// API utility functions for HR Operations Platform

// Base API configuration
// Resolve service base by endpoint prefix to hit correct microservice instead of frontend origin
const LIVE_SERVER_PORTS = ['5502', '5503', '5504', '5505', '5506', '5507', '5508', '5518'];
const SERVICE_PORTS = ['3000', '3001', '3002', '3003', '3004', '3005', '3006', '3007', '3009', '3010', '3011', '3020'];
const isLiveServerPort = LIVE_SERVER_PORTS.includes(window.location.port);
const isServicePort = SERVICE_PORTS.includes(window.location.port);
const isDevMode = isLiveServerPort || isServicePort;
const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
// In production (served via nginx on port 80/443/custom), use relative URLs so nginx proxies correctly.
// In development (live server or direct service port), route to specific service localhost.
const DEFAULT_API_BASE_URL = isDevMode ? (isLiveServerPort ? 'http://localhost:3000' : `${window.location.protocol}//${window.location.hostname}:${port}`) : '';
window.API_BASE_URL = DEFAULT_API_BASE_URL; // Back-compat global

function getServiceBaseForEndpoint(endpoint) {
    try {
        // In production (nginx), all endpoints already have correct /api/ paths.
        // Return empty string so URLs are relative and nginx routes them correctly.
        if (!isDevMode) return '';

        // Development: route to specific service localhost ports
        const services = (typeof API_SERVICES !== 'undefined') ? API_SERVICES : {
            auth: 'http://localhost:3001',
            users: 'http://localhost:3002',
            departments: 'http://localhost:3003',
            tasks: 'http://localhost:3004',
            meetings: 'http://localhost:3005',
            payments: 'http://localhost:3006',
            notifications: 'http://localhost:3007',
            attendance: 'http://localhost:3000',
            requests: 'http://localhost:3009',
            salary: 'http://localhost:3010',
        };

        if (endpoint.startsWith('/api/auth')) return 'http://localhost:3001';
        if (endpoint.startsWith('/api/departments')) return 'http://localhost:3003';
        if (endpoint.startsWith('/api/attendance')) return 'http://localhost:3000';
        if (endpoint.startsWith('/api/punches')) return 'http://localhost:3000';
        if (endpoint.startsWith('/api/exceptions')) return 'http://localhost:3000';
        if (endpoint.startsWith('/api/substitutions')) return 'http://localhost:3000';
        if (endpoint.startsWith('/api/salary')) return 'http://localhost:3010';
        // Default to current origin or dev proxy
        return DEFAULT_API_BASE_URL;
    } catch (_) {
        return isDevMode ? DEFAULT_API_BASE_URL : '';
    }
}

// Get authentication token from localStorage
function getToken() {
    return localStorage.getItem('token');
}

// Set authentication token in localStorage
function setToken(token) {
    localStorage.setItem('token', token);
}

// Remove authentication token from localStorage
function removeToken() {
    localStorage.removeItem('token');
}

// Check if user is authenticated
function isAuthenticated() {
    const token = getToken();
    if (!token) return false;
    
    try {
        // Basic token validation (check if it's not expired)
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp > Date.now() / 1000;
    } catch (error) {
        return false;
    }
}

// Redirect to login if not authenticated
function checkAuth() {
    if (!isAuthenticated()) {
        window.location.href = '../index.html';
        return false;
    }
    return true;
}

// Logout function
function logout() {
    removeToken();
    window.location.href = '../index.html';
}

// Setup logout button
document.addEventListener('DOMContentLoaded', function() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
});

// Get user's timezone
function getUserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (error) {
        return 'UTC';
    }
}

// Generic API request function
async function apiRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http')
        ? endpoint
        : `${getServiceBaseForEndpoint(endpoint)}${endpoint}`;

    const isFormData = options && options.body && (typeof FormData !== 'undefined') && options.body instanceof FormData;

    // Default timeout: 30 seconds (can be overridden via options.timeout)
    const timeout = options.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const defaultOptions = {
        headers: {
            ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
            'Authorization': `Bearer ${getToken()}`
        },
        signal: controller.signal
    };
    
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            'x-user-timezone': getUserTimezone(),
            ...options.headers
        }
    };
    
    // If sending FormData, ensure Content-Type is not manually set
    if (isFormData && mergedOptions.headers && mergedOptions.headers['Content-Type']) {
        delete mergedOptions.headers['Content-Type'];
    }
    
    try {
        const response = await fetch(url, mergedOptions);
        clearTimeout(timeoutId);
        
        // Handle authentication errors
        if (response.status === 401) {
            removeToken();
            window.location.href = '../index.html';
            return null;
        }
        
        // Handle other HTTP errors
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const base = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
            const more = errorData.details ? `: ${errorData.details}` : '';
            throw new Error(base + more);
        }
        
        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        
        // Handle timeout/abort errors
        if (error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('aborted')) {
            const timeoutError = new Error('Connection terminated due to connection timeout');
            timeoutError.name = 'TimeoutError';
            timeoutError.isTimeout = true;
            console.error('API request timeout:', url);
            throw timeoutError;
        }
        
        // Handle network errors (server down, CORS, etc.)
        if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError') || error.name === 'TypeError') {
            const networkError = new Error('Network error: Unable to connect to the server. Please check your connection and ensure the server is running.');
            networkError.name = 'NetworkError';
            networkError.isNetworkError = true;
            console.error('API network error:', url, error.message);
            throw networkError;
        }
        
        console.error('API request failed:', error);
        throw error;
    }
}

// Specific API functions
const API = {
    // Authentication
    login: async (credentials) => {
        return await apiRequest('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials)
        });
    },
    
    // Attendance
    getAttendanceLog: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/attendance/attendance-log?${queryString}`);
    },

    getAttendanceDetails: async (employeeId, date) => {
        return await apiRequest(`/api/attendance/details/${employeeId}/${date}`);
    },

    getAttendanceSummary: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/attendance/summary?${queryString}`);
    },

    getMonthlyStatistics: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/attendance/monthly-statistics?${queryString}`);
    },

    // Get comprehensive dashboard statistics (NEW - Optimized)
    getDashboardStats: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/attendance/dashboard-stats?${queryString}`);
    },

    getEmployeeMonthlyDetails: async (employeeId, params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/attendance/employee-monthly-details/${employeeId}?${queryString}`);
    },

    // Wage Changes
    addWageChange: async (data) => {
        return await apiRequest('/api/attendance/wage-changes', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    updateWageChange: async (id, data) => {
        return await apiRequest(`/api/attendance/wage-changes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    deleteWageChange: async (id) => {
        return await apiRequest(`/api/attendance/wage-changes/${id}`, {
            method: 'DELETE'
        });
    },

    // Overtime Hours
    addOvertimeHours: async (data) => {
        return await apiRequest('/api/attendance/overtime-hours', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    updateOvertimeHours: async (id, data) => {
        return await apiRequest(`/api/attendance/overtime-hours/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    deleteOvertimeHours: async (id) => {
        return await apiRequest(`/api/attendance/overtime-hours/${id}`, {
            method: 'DELETE'
        });
    },

    // Punch Files
    uploadPunchFile: async (file) => {
        const formData = new FormData();
        formData.append('punchFile', file);

        return await apiRequest('/api/punches/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'x-user-timezone': getUserTimezone()
                // Don't set Content-Type for FormData
            },
            body: formData
        });
    },
    
    parsePunchFile: async (uploadId) => {
        return await apiRequest(`/api/punches/parse/${uploadId}`, {
            method: 'POST'
        });
    },
    
    savePunches: async (uploadId) => {
        return await apiRequest(`/api/punches/save/${uploadId}`, {
            method: 'POST'
        });
    },
    
    getPunchFiles: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/punches/files?${queryString}`);
    },
    
    deletePunchFile: async (uploadId) => {
        return await apiRequest(`/api/punches/files/${uploadId}`, {
            method: 'DELETE'
        });
    },
    
    // Exceptions
    getPendingExceptions: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/exceptions/pending?${queryString}`);
    },

    getExceptionHistory: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/exceptions/history?${queryString}`);
    },

    getExceptionDetails: async (exceptionId) => {
        return await apiRequest(`/api/exceptions/${exceptionId}`);
    },

    approveException: async (exceptionId, data = {}) => {
        return await apiRequest(`/api/exceptions/approve/${exceptionId}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    rejectException: async (exceptionId, data = {}) => {
        return await apiRequest(`/api/exceptions/reject/${exceptionId}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

  deleteException: async (exceptionId) => {
      return await apiRequest(`/api/exceptions/${exceptionId}`, {
          method: 'DELETE'
      });
  },

  // Delete overrides for a specific employee/day
  deleteDayOverrides: async (employeeId, date) => {
      return await apiRequest(`/api/attendance/overrides/${employeeId}/${date}`, {
          method: 'DELETE'
      });
  },

    createExceptionRequest: async (exceptionData) => {
        return await apiRequest('/api/exceptions/request', {
            method: 'POST',
            body: JSON.stringify(exceptionData)
        });
    },

    // Exceptions with file attachment (multipart/form-data)
    createExceptionRequestWithFile: async (exceptionData, file) => {
        const formData = new FormData();
        formData.append('type', exceptionData.type);
        formData.append('date', exceptionData.date);
        if (exceptionData.end_date) formData.append('end_date', exceptionData.end_date);
        if (exceptionData.reason) formData.append('reason', exceptionData.reason);
        if (exceptionData.payload) formData.append('payload', JSON.stringify(exceptionData.payload));
        if (file) formData.append('justificationFile', file);

        return await apiRequest('/api/exceptions/request', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'x-user-timezone': getUserTimezone()
            },
            body: formData
        });
    },

    // Download exception document as Blob (follows redirect to /uploads)
    downloadExceptionDocument: async (exceptionId) => {
        const url = `${API_BASE_URL}/api/exceptions/${exceptionId}/document`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'x-user-timezone': getUserTimezone()
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
                const data = await response.json();
                if (data && data.error) message = data.error;
            } catch (_) {}
            throw new Error(message);
        }

        const blob = await response.blob();
        // Try to infer filename from final URL
        const finalUrl = response.url || url;
        const parts = finalUrl.split('/');
        const filename = parts[parts.length - 1] || 'attachment';
        return { blob, filename };
    },

    // Bulk update exception status for missing punches
    bulkUpdateExceptionStatus: async (updates, status) => {
        return await apiRequest('/api/attendance/bulk-update-exception-status', {
            method: 'POST',
            body: JSON.stringify({ updates, status }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
    },
    
    // Employees and Departments
    getEmployees: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/attendance/employees?${queryString}`);
    },
    
    getDepartments: async () => {
        const data = await apiRequest('/api/departments');
        if (Array.isArray(data)) {
            return { success: true, departments: data, items: data, data };
        }
        if (data && data.departments && !data.success) {
            return { success: true, departments: data.departments, items: data.departments, data: data.departments };
        }
        return data;
    },
    
    // Salary
    getSalaryReport: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/salary/report?${queryString}`);
    },
    
    calculateSalary: async (employeeId, data) => {
        return await apiRequest(`/api/salary/calculate/${employeeId}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    
    markSalaryPaid: async (calculationId) => {
        return await apiRequest(`/api/salary/mark-paid/${calculationId}`, {
            method: 'POST'
        });
    },
    
    getSalarySettings: async (employeeId) => {
        return await apiRequest(`/api/salary/settings/${employeeId}`);
    },
    
    updateSalarySettings: async (employeeId, settings) => {
        return await apiRequest(`/api/salary/settings/${employeeId}`, {
            method: 'POST',
            body: JSON.stringify(settings)
        });
    },

    // Overtime listings (for Exceptions UI)
    getPendingOvertime: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/attendance/overtime/pending?${queryString}`);
    },

    getOvertimeHistory: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/attendance/overtime/history?${queryString}`);
    },

    // Create overtime request (employee)
    createOvertimeRequest: async (data) => {
        return await apiRequest('/api/attendance/overtime/submit', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    approveOvertimeRequest: async (requestId, admin_notes = '') => {
        return await apiRequest(`/api/attendance/overtime/approve/${requestId}`, {
            method: 'POST',
            body: JSON.stringify({ admin_notes })
        });
    },

    declineOvertimeRequest: async (requestId, admin_notes = '') => {
        return await apiRequest(`/api/attendance/overtime/decline/${requestId}`, {
            method: 'POST',
            body: JSON.stringify({ admin_notes })
        });
    },

    // Delete recorded overtime hours row
    deleteRecordedOvertime: async (id) => {
        return await apiRequest(`/api/attendance/overtime-hours/${id}`, {
            method: 'DELETE'
        });
    },

    // Get my exceptions (for employee UI)
    getMyExceptions: async (status = 'all') => {
        return await apiRequest(`/api/exceptions/mine?status=${encodeURIComponent(status)}`);
    },

    // Get my substitution invitations
    getMyInvitations: async (status = 'pending') => {
        return await apiRequest(`/api/substitutions/invitations/mine?status=${encodeURIComponent(status)}`);
    },

    // Respond to substitution invitation
    respondToInvitation: async (id, action) => {
        return await apiRequest(`/api/substitutions/invitations/${encodeURIComponent(id)}/respond`, {
            method: 'POST',
            body: JSON.stringify({ action })
        });
    },

    // Get my overtime requests
    getMyOvertimeRequests: async (limit = 10) => {
        return await apiRequest(`/api/attendance/overtime/my-requests?limit=${limit}`);
    },

    // Delete overtime request
    deleteOvertimeRequest: async (requestId) => {
        return await apiRequest(`/api/attendance/overtime/${requestId}`, {
            method: 'DELETE'
        });
    },

    // Get substitution requests
    getSubstitutionRequests: async (status = null) => {
        const qs = status ? `?status=${encodeURIComponent(status)}` : '';
        return await apiRequest(`/api/substitutions/requests${qs}`);
    },

    // Auto-invite colleagues to a substitution request
    autoInviteSubstitution: async (requestId) => {
        return await apiRequest(`/api/substitutions/requests/${requestId}/auto-invite`, {
            method: 'POST'
        });
    },

    // Create custom invitations for a substitution request
    createSubstitutionInvitations: async (requestId, candidateEmployeeIds) => {
        return await apiRequest(`/api/substitutions/requests/${requestId}/create-invitations`, {
            method: 'POST',
            body: JSON.stringify({ candidate_employee_ids: candidateEmployeeIds })
        });
    },

    // Get all invitations for admin management
    getAllInvitations: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return await apiRequest(`/api/substitutions/invitations/all?${queryString}`);
    },

    // Delete an invitation
    deleteInvitation: async (invitationId) => {
        return await apiRequest(`/api/substitutions/invitations/${invitationId}`, {
            method: 'DELETE'
        });
    },

    // Get invitation statistics
    getInvitationStats: async () => {
        return await apiRequest('/api/substitutions/invitations/stats');
    }
};

// Make API object globally available
window.API = API;

// Export for use in other scripts (only in Node.js environment)
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    try {
        module.exports = { API, getToken, setToken, removeToken, isAuthenticated, checkAuth, logout, apiRequest };
    } catch (e) {
        // Ignore errors in browser environment
    }
}
