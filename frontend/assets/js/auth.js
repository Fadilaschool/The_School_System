// Authentication utilities
const AUTH_API_BASE_URL = 'http://localhost:3001'; // Auth service URL

class AuthManager {
    constructor() {
        this.token = localStorage.getItem('token');
        this.user = JSON.parse(localStorage.getItem('user') || 'null');
    }

    async login(username, password) {
        try {
            const response = await fetch(`${AUTH_API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            this.token = data.token;
            this.user = data.user;

            localStorage.setItem('token', this.token);
            localStorage.setItem('user', JSON.stringify(this.user));

            return data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    async logout() {
        try {
            if (this.token) {
                await fetch(`${AUTH_API_BASE_URL}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                    },
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            this.token = null;
            this.user = null;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // Redirect to the login page, adjusting the path based on the current location
            // if (window.location.pathname.includes('/pages/')) {
            //     window.location.href = '../index.html';
            // } else {
            //     window.location.href = 'index.html';
            // }
        }
    }

    isAuthenticated() {
        return !!this.token && !!this.user;
    }

    getToken() {
        // Always refresh from localStorage to ensure we have the latest token
        const storedToken = localStorage.getItem('token');
        if (storedToken && storedToken !== this.token) {
            this.token = storedToken;
        }
        return this.token;
    }

    getUser() {
        // Always refresh from localStorage to ensure we have the latest user
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                if (parsed && JSON.stringify(parsed) !== JSON.stringify(this.user)) {
                    this.user = parsed;
                }
            } catch (e) {
                console.warn('Error parsing user from localStorage:', e);
            }
        }
        return this.user;
    }

    getUserRole() {
        return this.user?.role;
    }

    async verifyToken() {
        if (!this.token) {
            return false;
        }

        try {
            // Add timeout to prevent hanging requests
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            const response = await fetch(`${AUTH_API_BASE_URL}/auth/verify`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Check if response is ok before parsing
            if (!response.ok) {
                // Only log if it's not a 401 (which is expected for invalid tokens)
                if (response.status !== 401) {
                    console.warn('Token verification failed with status:', response.status);
                }
                return false;
            }

            const data = await response.json();
            return data.valid || false;
        } catch (error) {
            // Don't log network errors as they're expected when auth service is unavailable
            // Only log unexpected errors
            if (error.name !== 'AbortError' && !error.message?.includes('Failed to fetch')) {
                console.error('Token verification error:', error);
            }
            return false;
        }
    }

    redirectToDashboard() {
        const role = this.getUserRole();
        let targetPage = '';

        switch (role) {
            case 'HR_Manager':
                targetPage = 'hr-dashboard.html';
                break;
            case 'Department_Responsible':
                targetPage = 'responsible-dashboard.html';
                break;
            case 'Employee':
                targetPage = 'employee-dashboard.html';
                break;
            case 'Director':
                targetPage = 'director-dashboard.html';
                break;
            default:
                console.error('Unknown user role:', role);
                this.logout();
                return;
        }

        // If on attendance service (port 3000), redirect to frontend dashboard
        if (window.location.port === '3000') {
            window.location.href = `http://127.0.0.1:5502/frontend/pages/${targetPage}`;
            return;
        }

        const currentPage = window.location.pathname.split('/').pop();
        const inPagesDir = window.location.pathname.includes('/pages/');

        // If we're in the pages directory, navigate relative to it
        if (inPagesDir) {
            if (currentPage !== targetPage) {
                window.location.href = targetPage;
            }
        } else {
            // From root (e.g., login page), go to the target dashboard under pages/
            window.location.href = `pages/${targetPage}`;
        }
    }


    async makeAuthenticatedRequest(url, options = {}) {
        // Refresh token from localStorage in case it was updated
        if (!this.token) {
            this.token = localStorage.getItem('token');
        }

        const headers = {
            ...(options.headers || {}),
        };

        const body = options.body;

        const isFormData = (typeof FormData !== 'undefined' && body instanceof FormData) ||
            (body && typeof body === 'object' && typeof body.append === 'function' &&
                (body[Symbol.toStringTag] === 'FormData' || Object.prototype.toString.call(body) === '[object FormData]'));
        const isBlob = (typeof Blob !== 'undefined' && body instanceof Blob);
        const isArrayBuffer = (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView?.(body)));
        const isPlainObject = body && typeof body === 'object' && body.constructor === Object;
        const isJsonString = typeof body === 'string' && /^\s*[{[]/.test(body);

        // Only set JSON Content-Type when body is JSON-like and header not already set
        if (!isFormData && !isBlob && !isArrayBuffer) {
            if ((isPlainObject || isJsonString) && !headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
            }
            // Auto-stringify plain objects
            if (isPlainObject) {
                options = { ...options, body: JSON.stringify(body) };
            }
        }

        // Ensure we have the latest token
        if (!this.token) {
            this.token = localStorage.getItem('token');
        }

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        } else {
            console.warn('No authentication token available for request to:', url);
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (response.status === 401) {
            // Token expired or invalid - try refreshing from localStorage one more time
            const refreshedToken = localStorage.getItem('token');
            if (refreshedToken && refreshedToken !== this.token) {
                // Token was updated, retry with new token
                this.token = refreshedToken;
                headers['Authorization'] = `Bearer ${this.token}`;
                const retryResponse = await fetch(url, {
                    ...options,
                    headers,
                });
                if (retryResponse.status === 401) {
                    // Still 401, token is truly invalid
                    // Don't logout immediately - let the calling code handle it
                    // This allows for better error messages and user experience
                    throw new Error('Authentication required. Please log in again.');
                }
                return retryResponse;
            }
            // Token expired or invalid - but don't logout immediately
            // Let the calling code decide what to do (show error, redirect, etc.)
            throw new Error('Authentication required. Please log in again.');
        }

        return response;
    }
}

// Global auth manager instance
const authManager = new AuthManager();
window.authManager = authManager;

// Check authentication on protected pages
function requireAuth() {
    if (!authManager.isAuthenticated()) {
        // Only redirect to login if not already on login page
        if (!window.location.pathname.includes("index.html")) {
            if (window.location.pathname.includes("/pages/")) {
                window.location.href = "../index.html";
            } else if (window.location.pathname.includes("/hr_tasks/")) {
                // From hr_tasks subdirectory, navigate to frontend
                window.location.href = "/frontend/index.html";
            } else {
                window.location.href = "index.html";
            }
        }
        return false;
    }
    return true;
}

// Login form handler
document.addEventListener('DOMContentLoaded', function () {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const loginButton = document.getElementById('loginButton');

    // Only redirect if on login page and already authenticated
    // if (authManager.isAuthenticated() && !window.location.pathname.includes('/pages/')) {
    //     authManager.redirectToDashboard();
    //     return;
    // }

    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            // Show loading state
            loadingSpinner.classList.remove('hidden');
            loginButton.disabled = true;
            errorMessage.classList.add('hidden');

            try {
                await authManager.login(username, password);
                authManager.redirectToDashboard();
            } catch (error) {
                errorText.textContent = error.message;
                errorMessage.classList.remove('hidden');
            } finally {
                loadingSpinner.classList.add('hidden');
                loginButton.disabled = false;
            }
        });
    }
});

// Logout handler
function handleLogout() {
    if (confirm(translate('common.confirm_logout') || 'Are you sure you want to logout?')) {
        authManager.logout();
    }
}

// Auto-logout on token expiration
setInterval(async () => {
    if (authManager.isAuthenticated()) {
        const isValid = await authManager.verifyToken();
        if (!isValid) {
            // authManager.logout();

        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

