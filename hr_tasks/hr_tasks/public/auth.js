// Authentication utilities
const API_BASE_URL = (['localhost','127.0.0.1'].includes(window.location.hostname)) ? 'http://localhost:3001' : '/api/auth'; // Auth service URL

class AuthManager {
    constructor() {
        this.token = localStorage.getItem('token');
        this.user = JSON.parse(localStorage.getItem('user') || 'null');
    }

    async login(username, password) {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
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
                await fetch(`${API_BASE_URL}/auth/logout`, {
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
            if (window.location.pathname.includes('/pages/')) {
                window.location.href = '../index.html';
            } else {
                window.location.href = 'index.html';
            }
        }
    }

    isAuthenticated() {
        return !!this.token && !!this.user;
    }

    getToken() {
        return this.token;
    }

    getUser() {
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

            const response = await fetch(`${API_BASE_URL}/auth/verify`, {
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
        const frontendBase = '/frontend/pages/';
        const inHrTasksApp = window.location.pathname.includes('/hr_tasks/');
        const currentPath = window.location.pathname;
        const isReportsContext = /report|rapport|repo/i.test(currentPath);
        let targetPage = '';

        switch (role) {
            case 'HR_Manager':
                targetPage = inHrTasksApp ? 'tasks.html' : `${frontendBase}hr-dashboard.html`;
                break;
            case 'Department_Responsible':
                targetPage = inHrTasksApp ? 'tasks.html' : `${frontendBase}responsible-dashboard.html`;
                break;
            case 'Employee':
                targetPage = inHrTasksApp ? 'my-tasks.html' : `${frontendBase}employee-dashboard.html`;
                break;
            case 'Director':
                targetPage = inHrTasksApp ? 'director.html' : `${frontendBase}director-dashboard.html`;
                break;
            default:
                console.error('Unknown user role:', role);
                this.logout();
                return;
        }

        // Check if the current page is inside the 'pages' directory
        const currentPage = window.location.pathname.split('/').pop();

        // Director role should redirect to frontend, not hr_tasks
        if (role === 'Director') {
            // Don't redirect if already on director dashboard or other director-specific pages
            const directorPages = [
                'director-dashboard',
                'director.html',
                'reportdir.html',
                'priorities.html',
                'statistics.html',
                'complaints_director.html',
                'signals_responsible.html',
                'parametres.html',
                'director-systems.html',
                'reports-director.html',
            ];
            const isOnDirectorPage = directorPages.some(page => window.location.pathname.includes(page));

            if (!isOnDirectorPage) {
                window.location.href = '/frontend/pages/director-dashboard.html';
            }
            return;
        }

        // Only redirect if we're on the login page or if the current page doesn't match the user's role
        if (!window.location.pathname.includes('/pages/') ||
            window.location.pathname.endsWith(targetPage)) {

            // Use absolute paths to frontend dashboards to avoid 404s inside hr_tasks
            if (!window.location.pathname.endsWith(targetPage)) {
                // When inside hr_tasks app, keep current reports pages instead of forcing a tasks redirect
                if (inHrTasksApp && isReportsContext) return;
                window.location.href = inHrTasksApp ? targetPage : targetPage;
            }
        }
        // If we're already on a valid page for the user's role, don't redirect
    }


    async makeAuthenticatedRequest(url, options = {}) {
        const headers = {
            ...options.headers,
        };

        // Only set Content-Type for non-FormData requests
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (response.status === 401) {
            // Token expired or invalid
            this.logout();
            throw new Error('Authentication required');
        }

        return response;
    }
}

// Global auth manager instance
const authManager = new AuthManager();

// Check authentication on protected pages
function requireAuth() {
    if (!authManager.isAuthenticated()) {
        // Only redirect to login if not already on login page
        if (!window.location.pathname.includes("index.html")) {
            if (window.location.pathname.includes("/pages/")) {
                window.location.href = "../index.html";
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

    // In embed/iframe contexts (e.g., signals/complaints wrappers), skip auto-redirect
    // to avoid hijacking the parent page. We only want redirects on the standalone login page.
    const params = new URLSearchParams(window.location.search);
    const isEmbed = params.get('embed') === '1';
    const inIframe = window.self !== window.top;
    if (isEmbed || inIframe) {
        // Do not auto-redirect; leave embedded content in place.
        return;
    }

    // Only redirect if on login page and already authenticated
    if (authManager.isAuthenticated() && !window.location.pathname.includes('/pages/')) {
        authManager.redirectToDashboard();
        return;
    }

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
            authManager.logout();
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

