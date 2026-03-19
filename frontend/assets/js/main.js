// Main JavaScript utilities for HR Operations Platform

// Suppress harmless browser extension errors (MetaMask, etc.)
if (typeof window !== 'undefined') {
  // Suppress MetaMask connection errors when extension is not installed
  window.addEventListener('unhandledrejection', function(event) {
    const reason = event.reason;
    if (reason && (
      (typeof reason === 'string' && reason.includes('MetaMask')) ||
      (reason.message && reason.message.includes('MetaMask')) ||
      (reason.message && reason.message.includes('extension not found'))
    )) {
      event.preventDefault();
      console.debug('MetaMask extension not available (suppressed)');
      return false;
    }
  });

  // Suppress runtime.lastError from browser extensions
  // These errors occur when browser extensions try to communicate but no receiver exists
  // They are harmless and can be safely ignored
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    // Override console.error to filter out runtime.lastError messages
    const originalConsoleError = console.error;
    console.error = function(...args) {
      const message = args.join(' ');
      if (message.includes('runtime.lastError') || 
          message.includes('Receiving end does not exist') ||
          message.includes('Could not establish connection')) {
        // Suppress these harmless browser extension errors
        console.debug('Browser extension communication error (suppressed):', ...args);
        return;
      }
      originalConsoleError.apply(console, args);
    };
  }
}

// Ensure currentLanguage is defined (fallback if translations.js isn't loaded)
// Check both window scope and global scope
if (typeof window !== 'undefined' && typeof window.currentLanguage === 'undefined') {
  window.currentLanguage = (() => {
    try {
      return localStorage.getItem('language') || localStorage.getItem('lang') || 'en';
    } catch (_) {
      return 'en';
    }
  })();
}
// Use window.currentLanguage - don't redeclare if already defined by translations.js
// Just reference it via window to avoid conflicts

// API service URLs - expose globally for other scripts
// Only declare if not already declared (prevents duplicate declaration errors)
if (typeof window === 'undefined' || !window.API_SERVICES) {
  // Detect production vs development environment
  const _IS_DEV_MODE = (() => {
    if (typeof window === 'undefined') return true;
    const port = window.location.port;
    return ['5502','5503','5504','5505','5506','5507','5508','5518',
            '3000','3001','3002','3003','3004','3005','3006','3007',
            '3009','3010','3011','3020'].includes(port);
  })();

  const API_SERVICES = _IS_DEV_MODE ? {
    auth: "http://localhost:3001",
    users: "http://localhost:3002",
    departments: "http://localhost:3003",
    tasks: "http://localhost:3004",
    hr_tasks: "http://localhost:3020",
    meetings: "http://localhost:3005",
    payments: "http://localhost:3006",
    notifications: "http://localhost:3007",
    attendance: "http://localhost:3000",
    requests: "http://localhost:3009",
    salary: "http://localhost:3010",
    timetable: "http://localhost:3011",
  } : {
    // Production: nginx proxies /api/service/... to the correct microservice
    auth: "",
    users: "/api/users",
    departments: "/api/departments",
    tasks: "",
    hr_tasks: "",
    meetings: "/api/meetings",
    payments: "/api/payments",
    notifications: "/api/notifications",
    attendance: "/api",
    requests: "/api/requests",
    salary: "/api/salary",
    timetable: "/api/timetable",
  };

  // Expose API_SERVICES globally for other scripts
  if (typeof window !== 'undefined') {
    window.API_SERVICES = API_SERVICES;
    // API_BASE for hr-tasks iframe communication (used by director dashboard)
    const currentHost = window.location.hostname === '127.0.0.1' ? '127.0.0.1' : 'localhost';
    window.API_BASE = _IS_DEV_MODE ? `http://${currentHost}:3020` : '';
  }
}

// Helper function to get current language safely
function getCurrentLanguage() {
  // First check window.currentLanguage (from translations.js if loaded)
  if (typeof window !== 'undefined' && window.currentLanguage) {
    return window.currentLanguage;
  }
  // Fallback to localStorage or default
  try {
    return localStorage.getItem('language') || localStorage.getItem('lang') || 'en';
  } catch (_) {
    return 'en';
  }
}

// Utility functions
class Utils {
  static formatDate(dateString) {
    if (!dateString) return "";
    const lang = getCurrentLanguage();
    // Treat pure date strings as local date to avoid timezone shifts
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      const [y, m, d] = dateString.split('-').map(Number);
      const dateLocal = new Date(y, m - 1, d);
      return dateLocal.toLocaleDateString(lang, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
    const date = new Date(dateString);
    return date.toLocaleDateString(lang, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  static formatDateTime(dateString) {
    if (!dateString) return "";
    const lang = getCurrentLanguage();
    const date = new Date(dateString);
    return date.toLocaleString(lang, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      // Use local timezone for display to avoid unexpected day shifts
    });
  }

  static formatDateTimeForInput(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    // Format as yyyy-MM-ddTHH:mm for datetime-local input
    const pad = (num) => num.toString().padStart(2, "0");
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  static formatTime(dateString) {
    if (!dateString) return "";
    const lang = getCurrentLanguage();
    const date = new Date(dateString);
    return date.toLocaleTimeString(lang, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  static getStatusClass(status) {
    const statusMap = {
      Pending: "status-pending",
      Completed: "status-completed",
      "In Progress": "status-in-progress",
      Accepted: "status-accepted",
      Denied: "status-denied",
    };
    return statusMap[status] || "bg-gray-100 text-gray-800";
  }

  static showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm ${type === "success"
      ? "bg-green-500 text-white"
      : type === "error"
        ? "bg-red-500 text-white"
        : type === "warning"
          ? "bg-yellow-500 text-white"
          : "bg-blue-500 text-white"
      }`;

    notification.innerHTML = `
      <div class="flex items-center">
        <i class="fas ${type === "success"
        ? "fa-check-circle"
        : type === "error"
          ? "fa-exclamation-circle"
          : type === "warning"
            ? "fa-exclamation-triangle"
            : "fa-info-circle"
      } mr-2"></i>
        <span>${message}</span>
        <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-white hover:text-gray-200">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }

  static showModal(title, content, actions = []) {
    const modal = document.createElement("div");
    modal.className =
      "modal-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";

    // Build action buttons with valid markup (previous template had stray spaces breaking tags)
    const actionsHtml = actions
      .map(
        (action) =>
          `<button onclick="${action.onclick}" class="${action.class || "bg-blue-600 text-white"} px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">${action.text}</button>`
      )
      .join("");

    const cancelText = (typeof translate === 'function') ? (translate("common.cancel") || 'Cancel') : 'Cancel';
    modal.innerHTML = `
      <div class="modal-content bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold">${title}</h3>
          <button onclick="this.closest('.modal-overlay').remove()" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="mb-6">${content}</div>
        <div class="flex justify-end space-x-2">
          ${actionsHtml}
          <button onclick="this.closest('.modal-overlay').remove()" class="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition-colors">
            ${cancelText}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    return modal;
  }

  static async loadTemplate(templatePath) {
    try {
      const response = await fetch(templatePath);
      return await response.text();
    } catch (error) {
      console.error("Error loading template:", error);
      return "";
    }
  }

  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  static async exportToCSV(data, filename) {
    if (!data || data.length === 0) {
      Utils.showNotification("No data to export", "warning");
      return;
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map((row) =>
        headers.map((header) => `"${row[header] || ""}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Expose Utils globally for other scripts
if (typeof window !== 'undefined') {
  window.Utils = Utils;
}

// API service class
class APIService {
  static async payslipsAdminList(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request("salary", `/payslips/admin${queryString ? '?' + queryString : ''}`);
  }

  static async payslipsAdminEmployee(employeeId, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request("salary", `/payslips/admin/${employeeId}${queryString ? '?' + queryString : ''}`);
  }

  static async payslipsUploadBatch(formData) {
    const url = `${API_SERVICES.salary}/payslips/upload-batch`;
    const response = await authManager.makeAuthenticatedRequest(url, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  static async payslipsMe() {
    return this.request("salary", `/payslips/me`);
  }

  static async payslipDownload(payslipId) {
    const url = `${API_SERVICES.salary}/payslips/download/${payslipId}`;
    const res = await authManager.makeAuthenticatedRequest(url, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return blob;
  }
  static async request(service, endpoint, options = {}) {
    const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : API_SERVICES;
    const url = `${apiServices[service]}${endpoint}`;

    try {
      const response = await authManager.makeAuthenticatedRequest(url, options);

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (jsonError) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }

        // Create error with status code for better error handling
        const error = new Error(errorMessage);
        error.status = response.status;
        
        // If it's a 401, add a more user-friendly message
        if (response.status === 401) {
          error.message = 'Authentication required. Please log in again.';
        }
        
        throw error;
      }

      // Handle cases where there is no JSON body in the response
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        return await response.json();
      } else {
        return await response.text();
      }
    } catch (error) {
      console.error(`API request failed: ${service}${endpoint}`, error);
      throw error;
    }
  }

  // User management
  static async getEmployees(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request("users", `/employees${queryString ? '?' + queryString : ''}`);
  }

  static async getEmployee(id) {
    return this.request("users", `/employees/${id}`);
  }

  static async createEmployee(formData) {
    const url = `${API_SERVICES.users}/employees`;

    try {
      const response = await authManager.makeAuthenticatedRequest(url, {
        method: "POST",
        body: formData, // Don't stringify FormData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("API request failed: users/employees", error);
      throw error;
    }
  }

  static async updateEmployee(id, data) {
    return this.request("users", `/employees/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  static async deleteEmployee(id) {
    return this.request("users", `/employees/${id}`, {
      method: "DELETE",
    });
  }

  // Departments
  static async getDepartments() {
    return this.request("departments", "/departments");
  }

  static async createDepartment(data) {
    return this.request("departments", "/departments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  // Tasks
  static async getTasks(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request("tasks", `/tasks?${queryString}`);
  }

  static async createTask(data) {
    return this.request("tasks", "/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  static async updateTask(id, data) {
    return this.request("tasks", `/tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // Meetings
  static async getMeetings(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request("meetings", `/meetings?${queryString}`);
  }

  static async getMeetingById(id) {
    console.log("APIService.getMeetingById called with id:", id);
    return this.request("meetings", `/meetings/${id}`);
  }

  static async createMeeting(data) {
    return this.request("meetings", "/meetings", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  static async updateMeeting(id, data) {
    return this.request("meetings", `/meetings/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  static async deleteMeeting(id) {
    return this.request("meetings", `/meetings/${id}`, {
      method: "DELETE",
    });
  }

  // Requests
  static async getRequests(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request("requests", `/requests?${queryString}`);
  }

  static async createRequest(data) {
    return this.request("requests", "/requests", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  static async updateRequestStatus(id, status) {
    return this.request("requests", `/requests/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }

  // Attendance
  static async getAttendance(employeeId, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request(
      "attendance",
      `/attendance/${employeeId}?${queryString}`
    );
  }

  static async checkIn() {
    return this.request("attendance", "/attendance/check-in", {
      method: "POST",
    });
  }

  static async checkOut() {
    return this.request("attendance", "/attendance/check-out", {
      method: "POST",
    });
  }

  // Notifications
  static async getNotifications(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request("notifications", `/notifications?${queryString}`);
  }

  static async markNotificationAsRead(id) {
    return this.request("notifications", `/notifications/${id}/read`, {
      method: "PUT",
    });
  }
}

// New collapsible sidebar navigation handler
function handleSidebarNavigation() {
  const sidebar = document.getElementById('collapsibleSidebar');
  const sidebarItems = document.querySelectorAll(".nav-item");

  // Handle sidebar collapse/expand
  let isExpanded = false;

  sidebar.addEventListener('mouseenter', () => {
    isExpanded = true;
    sidebar.classList.remove('w-16');
    sidebar.classList.add('w-64');
    document.querySelectorAll('.nav-label').forEach(label => {
      label.classList.remove('opacity-0', 'invisible');
      label.classList.add('opacity-100', 'visible');
    });
    document.querySelector('.school-title').classList.remove('hidden');
    document.querySelector('.school-subtitle').classList.remove('hidden');
  });

  sidebar.addEventListener('mouseleave', () => {
    if (window.matchMedia('(max-width: 768px)').matches && sidebar.classList.contains('mobile-open')) return;
    isExpanded = false;
    sidebar.classList.remove('w-64');
    sidebar.classList.add('w-16');
    document.querySelectorAll('.nav-label').forEach(label => {
      label.classList.remove('opacity-100', 'visible');
      label.classList.add('opacity-0', 'invisible');
    });
    const st = document.querySelector('.school-title');
    const ss = document.querySelector('.school-subtitle');
    if (st) st.classList.add('hidden');
    if (ss) ss.classList.add('hidden');
  });

  // Handle navigation clicks
  sidebarItems.forEach((item) => {
    item.addEventListener("click", function (e) {
      e.preventDefault();

      // Don't handle logout action here
      if (this.getAttribute("data-action") === "logout") {
        return;
      }

      let href = this.getAttribute("href");
      if (href && href !== "#" && !href.startsWith("javascript:")) {
        // Check if this is an external link with onclick handler (should open in new window)
        // But don't treat frontend pages as external even if they're absolute URLs
        const isAbsoluteUrl = href.startsWith('http://') || href.startsWith('https://');
        const isFrontendPage = href.includes('/frontend/pages/') || 
                               href.includes('/pages/') ||
                               (isAbsoluteUrl && (href.includes('localhost:5502') || href.includes('127.0.0.1:5502')));
        const isExternal = isAbsoluteUrl && !isFrontendPage;
        const hasOnClick = this.getAttribute("onclick");

        // If external and has onclick handler, let the onclick handle it (don't navigate current page)
        if (isExternal && hasOnClick) {
          // The onclick handler will open in new window, just update active state
          sidebarItems.forEach((i) => {
            i.classList.remove("nav-active");
          });
          this.classList.add("nav-active");
          return;
        }

        // If we're on attendance service (port 3000) and href is relative, convert it
        const isOnAttendanceService = window.location.port === '3000' ||
          (window.location.hostname === 'localhost' && window.location.port === '3000') ||
          window.location.href.includes('attendance-service') ||
          window.location.href.includes('attendance-master.html');

        if (isOnAttendanceService && !href.startsWith('http://') && !href.startsWith('https://')) {
          // Get frontend base URL
          let frontendBase = localStorage.getItem('frontendBaseURL');
          if (!frontendBase) {
            frontendBase = 'http://127.0.0.1:5502/frontend/pages/';
          }
          href = `${frontendBase}${href}`;
        }

        // Remove active class from all items
        sidebarItems.forEach((i) => {
          i.classList.remove("nav-active");
        });

        // Add active class to clicked item
        this.classList.add("nav-active");

        // Navigate to the page
        window.location.href = href;
      }
    });
  });

}

// Logout handler
function handleLogout() {
  if (confirm("Are you sure you want to logout?")) {
    authManager.logout();
    window.location.href = "../index.html";
  }
}

async function loadUserProfileSidebar() {
  try {
    // Check if we have a valid token before making the request
    const token = localStorage.getItem('token');
    if (!token || token === 'test-token') {
      console.log("No valid authentication token, skipping profile sidebar load");
      return;
    }

    const user = authManager.getUser();
    if (!user || !user.id) {
      console.log("No user found or user ID missing");
      return;
    }

    console.log("Loading profile for user:", user.id);
    const employees = await APIService.getEmployees({ user_id: user.id });
    const employee = employees.find((emp) => emp.user_id === user.id);

    if (employee) {
      // Update display name in sidebar profile section
      const displayName = `${employee.first_name} ${employee.last_name}`;
      const displayElement = document.getElementById("sidebarUserName");
      if (displayElement) {
        displayElement.textContent = displayName;
      }

      // Handle profile picture in sidebar
      const profileImageElement = document.getElementById("sidebarProfileImage");
      if (profileImageElement) {
        await setEmployeeProfileImage(profileImageElement, employee);
      }
    } else {
      console.log("No employee record found for user ID:", user.id);
    }
  } catch (error) {
    // Only log error if it's not an authentication error
    if (error.message && !error.message.includes('Authentication required') && !error.message.includes('401')) {
      console.error("Error loading user profile sidebar:", error);
    } else {
      console.log("Authentication required for profile sidebar, skipping");
    }

    // Set fallback image on error
    const profileImageElement = document.getElementById("sidebarProfileImage");
    if (profileImageElement) {
      setGenericPlaceholder(profileImageElement);
    }
  }
}

// New function to handle setting employee profile images with better error handling
async function setEmployeeProfileImage(imageElement, employee) {
  if (!employee) {
    setGenericPlaceholder(imageElement);
    return;
  }

  // If there's a profile picture URL, try to load it
  if (employee.profile_picture_url) {
    try {
      let imageUrl;

      // Use the profile-image endpoint for better CORS handling
      if (employee.id) {
        imageUrl = `${API_SERVICES.users}/profile-image/${employee.id}`;
      } else {
        // Fallback to direct URL
        imageUrl = employee.profile_picture_url.startsWith('http')
          ? employee.profile_picture_url
          : `${API_SERVICES.users}${employee.profile_picture_url}`;
      }

      // Test if the image loads successfully
      const testImage = new Image();
      testImage.onload = function () {
        imageElement.src = imageUrl;
        console.log("Successfully loaded profile image for employee:", employee.id);
      };
      testImage.onerror = function () {
        console.log("Failed to load profile image, using initials placeholder");
        setInitialsPlaceholder(imageElement, employee);
      };

      // Add auth header if needed
      if (authManager.getToken()) {
        const response = await fetch(imageUrl, {
          headers: {
            'Authorization': `Bearer ${authManager.getToken()}`
          }
        });

        if (response.ok) {
          const blob = await response.blob();
          const objectURL = URL.createObjectURL(blob);
          imageElement.src = objectURL;
          console.log("Successfully loaded profile image via fetch for employee:", employee.id);
        } else {
          throw new Error('Failed to fetch image');
        }
      } else {
        testImage.src = imageUrl;
      }
    } catch (error) {
      console.log("Error loading profile image, using initials placeholder:", error);
      setInitialsPlaceholder(imageElement, employee);
    }
  } else {
    // No profile picture URL, use initials
    setInitialsPlaceholder(imageElement, employee);
  }
}

function updateProfileDisplay() {
  document.getElementById('profileName').textContent = `${userProfile.first_name} ${userProfile.last_name}`;
  document.getElementById('profileRole').textContent = userProfile.role?.replace('_', ' ') || 'Employee';
  document.getElementById('profileDepartment').textContent = userProfile.department || '';
  document.getElementById('profileEmail').textContent = userProfile.email || '';
  document.getElementById('profilePhone').textContent = userProfile.phone || '';

  if (userProfile.join_date) {
    const joinDate = new Date(userProfile.join_date);
    document.getElementById('profileJoinDate').textContent = joinDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long'
    });
  }

  // Set profile images using the new function
  const profileImageElement = document.getElementById('profileImage');
  if (profileImageElement) {
    setEmployeeProfileImage(profileImageElement, userProfile);
  }

  const headerProfileImageElement = document.getElementById('headerProfileImage');
  if (headerProfileImageElement) {
    setEmployeeProfileImage(headerProfileImageElement, userProfile);
  }
}

// Helper function to create initials placeholder
function setInitialsPlaceholder(imageElement, employee) {
  if (employee?.first_name && employee?.last_name) {
    const initials =
      employee.first_name.charAt(0).toUpperCase() +
      employee.last_name.charAt(0).toUpperCase();

    // Create a canvas-based placeholder instead of using external service
    const canvas = document.createElement("canvas");
    const size = imageElement.classList.contains('h-32') ? 128 : 32; // Adjust size based on element
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    // Draw background
    ctx.fillStyle = "#4F46E5"; // Blue background
    ctx.fillRect(0, 0, size, size);

    // Draw initials
    ctx.fillStyle = "#FFFFFF"; // White text
    ctx.font = `${Math.floor(size / 2.5)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, size / 2, size / 2);

    // Convert to data URL and set as src
    imageElement.src = canvas.toDataURL();
    console.log("Set canvas-based initials placeholder:", initials);
  } else {
    setGenericPlaceholder(imageElement);
  }
}

// Helper function to set generic placeholder
function setGenericPlaceholder(imageElement) {
  // Create a simple canvas placeholder
  const canvas = document.createElement("canvas");
  const size = imageElement.classList.contains('h-32') ? 128 : 32; // Adjust size based on element
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Draw background
  ctx.fillStyle = "#6B7280"; // Gray background
  ctx.fillRect(0, 0, size, size);

  // Draw user icon (simple circle and body)
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.375, size * 0.1875, 0, 2 * Math.PI); // Head
  ctx.fill();

  ctx.beginPath();
  ctx.arc(size / 2, size * 0.8125, size * 0.25, 0, Math.PI, true); // Body
  ctx.fill();

  imageElement.src = canvas.toDataURL();
  console.log("Set canvas-based generic placeholder");
}

// Helper function to get HR navigation sections
function getHRNavigationSections(mySpaceHref, mySpaceLabel) {
  return [
    {
      name: 'nav.dashboard', items: [
        { href: 'hr-dashboard.html', icon: 'fa-tachometer-alt', label: 'nav.dashboard' }
      ]
    },
    {
      name: 'nav.management', items: [
        { href: 'employees-simple.html', icon: 'fa-users', label: 'nav.employees_management' },
        { href: 'contract-management.html', icon: 'fa-file-contract', label: 'nav.contract_management' },
        { href: 'org-structure.html', icon: 'fa-sitemap', label: 'nav.org_structure' },
        { href: 'attendance.html', icon: 'fa-clock', label: 'nav.attendance' },
        { href: 'punch-management.html', icon: 'fa-file-upload', label: 'nav.punch_management' }
      ]
    },
    {
      name: 'nav.timetables', items: [
        { href: 'timetable-library.html', icon: 'fa-calendar-alt', label: 'nav.timetable_library' },
        { href: 'employee-assignments.html', icon: 'fa-user-clock', label: 'nav.timetable_assignment' }
      ]
    },
    {
      name: 'nav.salary', items: [
        { href: 'salary-management.html', icon: 'fa-money-check-alt', label: 'nav.salary_management' },
        { href: 'payslips-admin.html', icon: 'fa-file-invoice-dollar', label: 'nav.payslips_admin' }
      ]
    },
    {
      name: 'nav.exceptions', items: [
        { href: 'exceptions.html', icon: 'fa-exclamation-triangle', label: 'nav.exceptions' }
      ]
    },
    {
      name: 'nav.my_space', items: [
        { href: mySpaceHref, icon: 'fa-home', label: mySpaceLabel }
      ]
    },
    {
      name: 'nav.account', items: [
        { href: '#', icon: 'fa-sign-out-alt', label: 'nav.logout', action: 'logout' }
      ]
    }
  ];
}

// Unified dynamic navigation by role
function getSidebarNavSectionsByRole(role) {
  // Normalize role name (handle variations)
  const normalizedRole = role ? String(role).trim() : '';
  console.log('getSidebarNavSectionsByRole called with role:', normalizedRole);

  // Check if Director is in HR system context (on HR pages)
  const currentPath = window.location.pathname.split('/').pop() || '';
  const hrPages = ['hr-dashboard.html', 'employees-simple.html', 'contract-management.html', 'org-structure.html', 'attendance.html',
    'timetable-library.html', 'employee-assignments.html', 'salary-management.html',
    'payslips-admin.html', 'exceptions.html', 'punch-management.html', 'add-employee.html',
    'daily-attendance.html'];
  const employeePages = ['employee-dashboard.html', 'my-tasks.html', 'rapportemp.html', 'submit-exception.html',
    'signals-employee.html', 'complaints-employee.html',
    'salary-employee.html', 'timetable-employee.html', 'profile.html'];
  const isDirectorInHRContext = normalizedRole === 'Director' && hrPages.includes(currentPath);
  const isHRManagerInEmployeeContext = (normalizedRole === 'HR_Manager' || normalizedRole === 'HR Manager' ||
    normalizedRole === 'hr_manager' || normalizedRole === 'hr-manager' ||
    normalizedRole === 'admin' || normalizedRole === 'Admin' || normalizedRole === 'ADMIN') &&
    employeePages.includes(currentPath);

  switch (normalizedRole) {
    case 'HR_Manager':
    case 'HR Manager':
    case 'hr_manager':
    case 'hr-manager':
    case 'admin':
    case 'Admin':
    case 'ADMIN':
      // If HR Manager is in employee space, show employee navigation with "HR Management" back to HR system
      if (isHRManagerInEmployeeContext) {
        return [
          {
            name: 'nav.main', items: [
              { href: 'employee-dashboard.html', icon: 'fa-tachometer-alt', label: 'nav.dashboard' },
              { href: 'my-tasks.html', icon: 'fa-tasks', label: 'nav.tasks' },
              { href: 'rapportemp.html', icon: 'fa-chart-bar', label: 'nav.reports' },
              { href: 'submit-exception.html', icon: 'fa-paper-plane', label: 'nav.requests' },
              { href: 'signals-employee.html', icon: 'fa-bullhorn', label: 'nav.signals_employee' },
              { href: 'complaints-employee.html', icon: 'fa-comment-dots', label: 'nav.complaints_employee' },
              { href: 'salary-employee.html', icon: 'fa-money-check-alt', label: 'nav.salary' },
              { href: 'timetable-employee.html', icon: 'fa-calendar-alt', label: 'nav.timetable' },
              { href: 'profile.html', icon: 'fa-user', label: 'nav.profile' }
            ]
          },
          {
            name: 'nav.hr_management', items: [
              { href: 'hr-dashboard.html', icon: 'fa-users-cog', label: 'nav.hr_management' }
            ]
          },
          {
            name: 'nav.account', items: [
              { href: '#', icon: 'fa-sign-out-alt', label: 'nav.logout', action: 'logout' }
            ]
          }
        ];
      }
      // Otherwise, show HR navigation with "My Space" to employee space
      return getHRNavigationSections('employee-dashboard.html', 'nav.my_space');
    case 'Employee':
      return [
        {
          name: 'nav.main', items: [
            { href: 'employee-dashboard.html', icon: 'fa-tachometer-alt', label: 'nav.dashboard' },
            { href: 'my-tasks.html', icon: 'fa-tasks', label: 'nav.tasks' },
            { href: 'rapportemp.html', icon: 'fa-chart-bar', label: 'nav.reports' },
            { href: 'submit-exception.html', icon: 'fa-paper-plane', label: 'nav.requests' },
            { href: 'signals-employee.html', icon: 'fa-bullhorn', label: 'nav.signals_employee' },
            { href: 'complaints-employee.html', icon: 'fa-comment-dots', label: 'nav.complaints_employee' },
            { href: 'salary-employee.html', icon: 'fa-money-check-alt', label: 'nav.salary' },
            { href: 'timetable-employee.html', icon: 'fa-calendar-alt', label: 'nav.timetable' },
            { href: 'profile.html', icon: 'fa-user', label: 'nav.profile' }
          ]
        },
        {
          name: 'nav.account', items: [
            { href: '#', icon: 'fa-sign-out-alt', label: 'nav.logout', action: 'logout' }
          ]
        }
      ];
    case 'Department_Responsible':
      return [
        {
          name: 'nav.department', items: [
            { href: 'responsible-dashboard.html', icon: 'fa-tachometer-alt', label: 'nav.dashboard' },
            { href: 'tasks.html', icon: 'fa-cog', label: 'nav.management' },
            { href: 'departments.html', icon: 'fa-building', label: 'nav.departments' },
            { href: 'salary-employee.html', icon: 'fa-money-check-alt', label: 'nav.salary' },
            { href: 'timetable-employee.html', icon: 'fa-calendar-alt', label: 'nav.timetable' },
            { href: 'signals-employee.html', icon: 'fa-tools', label: 'nav.maintenance_requests' },
            { href: 'complaints-employee.html', icon: 'fa-comment-dots', label: 'nav.complaints_employee' },
            { href: 'profile.html', icon: 'fa-user', label: 'nav.profile' }
          ]
        },
        {
          name: 'nav.account', items: [
            { href: '#', icon: 'fa-sign-out-alt', label: 'nav.logout', action: 'logout' }
          ]
        }
      ];
    case 'Director':
      // If Director is in HR system context (on HR pages), show full HR navigation
      // and, at the end, give access back to Systems Space and My Space (director dashboard)
      if (isDirectorInHRContext) {
        const hrSections = getHRNavigationSections('director-dashboard.html', 'nav.my_space');
        // Insert a "Systems Space" section just before the My Space + Account sections
        const baseSections = hrSections.slice(0, -2); // dashboard, management, timetables, salary, exceptions
        const tailSections = hrSections.slice(-2);    // my_space, account
        const systemsSection = {
          name: 'nav.systems_space',
          items: [
            { href: 'director-systems.html', icon: 'fa-network-wired', label: 'nav.systems_space' }
          ]
        };
        return [...baseSections, systemsSection, ...tailSections];
      }
      // Otherwise, show director's own space (with direct links to Reports, Complaints and Signals) plus a Systems Space entry
      return [
        {
          name: 'nav.my_space',
          items: [
            { href: 'director-dashboard-stats.html', icon: 'fa-chart-line', label: 'nav.dashboard' },
            { href: 'director-dashboard.html', icon: 'fa-tasks', label: 'nav.tasks_management' },
            { href: 'reportdir.html', icon: 'fa-chart-bar', label: 'nav.reports' },
            // Complaints & Signals (Director views) - using wrapper pages with authentication
            { href: 'complaints-director.html', icon: 'fa-exclamation-circle', label: 'nav.complaints' },
            { href: 'signals-responsible.html', icon: 'fa-signal', label: 'nav.maintenance_requests' }
          ]
        },
        {
          name: 'nav.systems_space',
          items: [
            { href: 'director-systems.html', icon: 'fa-network-wired', label: 'nav.systems_space' }
          ]
        },
        {
          name: 'nav.account',
          items: [
            { href: '#', icon: 'fa-sign-out-alt', label: 'nav.logout', action: 'logout' }
          ]
        }
      ];
    default:
      return [];
  }
}

// Patch initializeCollapsibleSidebar to use above role-based logic
function initializeCollapsibleSidebar() {
  if (document.querySelector('#loginForm')) return;
  try {
    const params = new URLSearchParams(window.location.search);
    const isEmbed = params.get('embed') === '1';
    const inIframe = window.self !== window.top;
    if (isEmbed || inIframe) return;
  } catch (_) { }
  if (document.getElementById('collapsibleSidebar')) return;

  let role = (window.authManager && window.authManager.getUserRole && window.authManager.getUserRole()) || localStorage.getItem('userRole') || 'HR_Manager';

  // Map admin role to HR_Manager for navigation (admin is part of HR system)
  if (role && (role.toLowerCase() === 'admin' || role === 'Admin' || role === 'ADMIN')) {
    console.log('Mapping admin role to HR_Manager for navigation');
    role = 'HR_Manager';
  }

  console.log('initializeCollapsibleSidebar: Role detected:', role);
  const navigationSections = getSidebarNavSectionsByRole(role);
  console.log('initializeCollapsibleSidebar: Navigation sections:', navigationSections.length, 'sections');

  if (!navigationSections || navigationSections.length === 0) {
    console.warn('No navigation sections found for role:', role);
    console.warn('Available roles in getSidebarNavSectionsByRole:', ['HR_Manager', 'Employee', 'Department_Responsible', 'Director']);
  }

  const currentPath = window.location.pathname.split('/').pop();
  const isRTL = document.documentElement.getAttribute('dir') === 'rtl' || document.body.classList.contains('rtl');
  const sidebarPosition = isRTL ? 'right-0' : 'left-0';
  const sidebarMargin = isRTL ? 'mr-3' : 'ml-3';

  // Use role + context-based text for sidebar subtitle
  const employeePages = ['employee-dashboard.html', 'my-tasks.html', 'rapportemp.html', 'submit-exception.html',
    'signals-employee.html', 'complaints-employee.html',
    'salary-employee.html', 'timetable-employee.html', 'profile.html'];
  const hrPages = ['hr-dashboard.html', 'employees-simple.html', 'contract-management.html', 'org-structure.html', 'attendance.html',
    'timetable-library.html', 'employee-assignments.html', 'salary-management.html',
    'payslips-admin.html', 'exceptions.html', 'punch-management.html', 'add-employee.html',
    'daily-attendance.html'];

  const isHRManagerLike = role === 'HR_Manager' || role === 'HR Manager' ||
    role === 'hr_manager' || role === 'hr-manager';
  const isHRManagerInEmployeeContext = isHRManagerLike && employeePages.includes(currentPath);
  const isDirectorInHRContext = role === 'Director' && hrPages.includes(currentPath);

  let sidebarSubtitleKey;
  if (role === 'Department_Responsible') {
    // Responsible always sees their own space
    sidebarSubtitleKey = 'nav.responsible_space';
  } else if (role === 'Employee' || isHRManagerInEmployeeContext) {
    // Pure employees, and HR managers when in My Space, see Employee Space
    sidebarSubtitleKey = 'nav.employee_space';
  } else if (role === 'Director') {
    // Director: HR system vs Director space depending on context
    sidebarSubtitleKey = isDirectorInHRContext ? 'nav.hr_management_system' : 'nav.director_space';
  } else {
    // HR managers and similar roles on HR pages see the HR management system
    sidebarSubtitleKey = 'nav.hr_management_system';
  }

  const sidebarSubtitle = translateNav(sidebarSubtitleKey);

  // Detect if we're on attendance service (port 3000) and adjust navigation paths
  // Only consider it attendance service if port is 3000, not if it's 5502/5503 (frontend)
  const currentPort = window.location.port;
  const isOnAttendanceService = (currentPort === '3000') ||
    (window.location.hostname === 'localhost' && currentPort === '3000') ||
    (window.location.href.includes('attendance-service') && currentPort === '3000') ||
    (window.location.href.includes('attendance-master.html') && currentPort === '3000');

  // Function to get the correct navigation path based on current location
  const getNavigationPath = (href) => {
    // If it's already an absolute URL, return as is
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }
    // If we're on attendance service (port 3000), convert relative paths to absolute paths
    // Otherwise, keep relative paths as-is for normal frontend navigation
    if (isOnAttendanceService) {
      // Try to get frontend base URL from localStorage or detect it
      let frontendBase = localStorage.getItem('frontendBaseURL');

      if (!frontendBase) {
        // Try to detect from document.referrer if available
        if (document.referrer) {
          try {
            const referrerUrl = new URL(document.referrer);
            if (referrerUrl.pathname.includes('/frontend/') || referrerUrl.pathname.includes('/pages/')) {
              // Extract base from referrer
              const pathParts = referrerUrl.pathname.split('/');
              const frontendIndex = pathParts.indexOf('frontend');
              if (frontendIndex >= 0) {
                frontendBase = `${referrerUrl.protocol}//${referrerUrl.host}/frontend/pages/`;
              } else {
                // Try pages directory
                const pagesIndex = pathParts.indexOf('pages');
                if (pagesIndex >= 0) {
                  const basePath = pathParts.slice(0, pagesIndex + 1).join('/');
                  frontendBase = `${referrerUrl.protocol}//${referrerUrl.host}${basePath}/`;
                }
              }
            }
          } catch (e) {
            console.warn('Could not parse referrer URL:', e);
          }
        }

        // Fallback to common Live Server port
        if (!frontendBase) {
          frontendBase = 'http://127.0.0.1:5502/frontend/pages/';
        }

        // Store for future use
        localStorage.setItem('frontendBaseURL', frontendBase);
      }

      console.log('Converting navigation path for attendance service:', href, '->', `${frontendBase}${href}`);
      return `${frontendBase}${href}`;
    }
    // Otherwise, return relative path as is
    return href;
  };

  // Get logo path - adjust if on attendance service
  const getLogoPath = () => {
    // Check current location to determine the best path
    const currentPath = window.location.pathname;
    const currentPort = window.location.port;
    const currentHost = window.location.hostname;
    const fullUrl = window.location.href;
    
    // Always use relative paths unless we're definitely on attendance service (port 3000)
    // This is more reliable and avoids connection issues
    const isDefinitelyAttendanceService = currentPort === '3000';
    
    // Debug logging
    console.log('[getLogoPath] Debug:', {
      path: currentPath,
      port: currentPort,
      hostname: currentHost,
      fullUrl: fullUrl,
      isAttendanceService: isDefinitelyAttendanceService
    });
    
    // If NOT on attendance service (port 3000), try relative path first
    if (!isDefinitelyAttendanceService) {
      // Handle different path structures
      let relativePath;
      const isLiveServer = ['5502', '5503', '5504', '5505', '5506', '5507', '5508', '5518', '5520'].includes(currentPort);
      // More robust detection: check path, filename, or if we're in attendance-service directory
      const isAttendanceServicePage = currentPath.includes('/attendance-service/') || 
                                      currentPath.includes('attendance-master.html') || 
                                      currentPath.includes('daily-attendance.html') ||
                                      currentPath.endsWith('/attendance-master.html') ||
                                      currentPath.endsWith('/daily-attendance.html') ||
                                      fullUrl.includes('attendance-master.html') ||
                                      fullUrl.includes('daily-attendance.html');
      
      console.log('[getLogoPath] Detection:', {
        isLiveServer,
        isAttendanceServicePage,
        currentPath
      });
      
      // Check where main.js was loaded from to determine context
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      const mainJsScript = scripts.find(s => s.src && s.src.includes('main.js'));
      const mainJsSrc = mainJsScript ? mainJsScript.src : '';
      const isMainJsFromFrontendPath = mainJsSrc.includes('/frontend/') || mainJsSrc.includes('../frontend/');
      
      console.log('[getLogoPath] Script context:', {
        mainJsSrc,
        isMainJsFromFrontendPath
      });
      
      if (currentPath.includes('/pages/')) {
        // From /frontend/pages/, go up one level to /frontend/, then into assets/images/
        relativePath = '../assets/images/logo fadila.png';
      } else if (isAttendanceServicePage || (isLiveServer && isMainJsFromFrontendPath && !currentPath.includes('/frontend/'))) {
        // When accessed from attendance-service folder (detected by main.js being loaded from ../frontend/)
        // Use relative path for Live Server to avoid cross-origin issues
        // The relative path from attendance-service/ to frontend/assets/images/ is ../frontend/assets/images/
        relativePath = '../frontend/assets/images/logo fadila.png';
        console.log('[getLogoPath] Using relative path for attendance service page:', relativePath);
      } else if (currentPath.includes('/frontend/') && !currentPath.includes('/pages/')) {
        // If we're in /frontend/ but not in /pages/, go up one level then into assets/images/
        relativePath = '../assets/images/logo fadila.png';
      } else {
        // Default: assume we're at root level, go into frontend/assets/images/
        relativePath = 'frontend/assets/images/logo fadila.png';
      }
      console.log('[getLogoPath] Using relative path:', relativePath);
      return relativePath;
    }
    
    // We're on attendance service (port 3000), need absolute URL to frontend
    // Try to get frontend URL from localStorage or detect from referrer
    // Note: currentHost is already declared above as window.location.hostname
    const currentProtocol = window.location.protocol;
    let frontendBase = localStorage.getItem('frontendBaseURL');
    
    if (!frontendBase) {
      // Try to detect from document.referrer
      if (document.referrer) {
        try {
          const referrerUrl = new URL(document.referrer);
          frontendBase = `${referrerUrl.protocol}//${referrerUrl.host}`;
        } catch (e) {
          // Use current host but different port
          frontendBase = `${currentProtocol}//${currentHost}:5502`;
        }
      } else {
        // Use current host but try common ports
        frontendBase = `${currentProtocol}//${currentHost}:5502`;
      }
    } else {
      // Extract just host from stored URL
      try {
        const url = new URL(frontendBase);
        frontendBase = `${url.protocol}//${url.host}`;
      } catch (e) {
        const match = frontendBase.match(/^(https?:\/\/[^\/]+)/);
        if (match) {
          frontendBase = match[1];
        } else {
          frontendBase = `${currentProtocol}//${currentHost}:5502`;
        }
      }
    }
    
    // Construct absolute path to logo
    return `${frontendBase}/frontend/assets/images/logo fadila.png`;
  };

  let sidebarHTML = `
    <div id="collapsibleSidebar" class="fixed ${sidebarPosition} top-0 h-screen bg-white shadow-lg z-50 w-16 transition-all duration-300 overflow-hidden">
      <div class="border-b border-gray-200" style="height: 80px; min-height: 80px; max-height: 80px; display: flex; align-items: center; justify-content: center; padding: 0 1rem;" ${isRTL ? 'dir="rtl"' : ''}>
        <div class="flex items-center justify-center" style="width: 100%;">
          <div class="flex-shrink-0">
            <div class="w-12 h-12 flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200">
              <img src="${getLogoPath()}" alt="EL FADILA SCHOOL" class="h-10 w-10 object-contain rounded-lg" onerror="(function(img){ let triedFallback = img.dataset.triedFallback === 'true'; if (triedFallback) { img.style.display='none'; return; } img.dataset.triedFallback = 'true'; const currentPath = window.location.pathname; const currentPort = window.location.port; const isLiveServer = ['5502', '5503', '5504', '5505', '5506', '5507', '5508', '5518', '5520'].includes(currentPort); const isAttendanceServicePage = currentPath.includes('/attendance-service/') || currentPath.includes('attendance-master.html') || currentPath.includes('daily-attendance.html'); const scripts = Array.from(document.querySelectorAll('script[src]')); const mainJsScript = scripts.find(s => s.src && s.src.includes('main.js')); const mainJsSrc = mainJsScript ? mainJsScript.src : ''; const isMainJsFromFrontendPath = mainJsSrc.includes('/frontend/') || mainJsSrc.includes('../frontend/'); let fallbackPath; if (currentPath.includes('/pages/')) { fallbackPath = '../../assets/images/logo fadila.png'; } else if (isAttendanceServicePage || (isLiveServer && isMainJsFromFrontendPath && !currentPath.includes('/frontend/'))) { fallbackPath = '../frontend/assets/images/logo fadila.png'; } else { fallbackPath = '../assets/images/logo fadila.png'; } console.log('[Logo fallback] Trying:', fallbackPath); img.src=fallbackPath; })(this);">
            </div>
          </div>
          <div class="${sidebarMargin} overflow-hidden hidden" ${isRTL ? 'dir="rtl" style="text-align: right;"' : ''}>
            <h1 class="school-title text-lg font-bold text-gray-900 whitespace-nowrap hidden transition-opacity duration-300" ${isRTL ? 'dir="rtl" style="text-align: right;"' : ''}>EL FADILA SCHOOL</h1>
            <p class="school-subtitle text-sm text-gray-500 whitespace-nowrap hidden transition-opacity duration-300" data-translate="${sidebarSubtitleKey}" ${isRTL ? 'dir="rtl" style="text-align: right;"' : ''}>${sidebarSubtitle}</p>
          </div>
        </div>
      </div>

      <button type="button" class="sidebar-mobile-close" id="sidebarMobileCloseBtn" aria-label="Close menu">
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>

      <!-- Navigation Sections -->
      <nav class="flex-1 overflow-y-auto py-4" style="scrollbar-width: none; -ms-overflow-style: none;">`;

  if (!navigationSections || navigationSections.length === 0) {
    console.error('No navigation sections available! Role:', role);
    sidebarHTML += `<div class="px-4 py-2 text-sm text-red-600">No navigation items for role: ${role}</div>`;
  } else {
    navigationSections.forEach((section, si) => {
      if (si > 0) sidebarHTML += `<div class="border-t border-gray-200 mx-4 my-2"></div>`;
      sidebarHTML += `<div class="nav-section px-2">`;

      if (!section.items || section.items.length === 0) {
        console.warn('Section has no items:', section.name);
        sidebarHTML += `<div class="px-2 py-1 text-xs text-gray-400">No items in section</div>`;
      } else {
        section.items.forEach(item => {
          // Get the correct navigation path based on current location
          const navHref = getNavigationPath(item.href);
          const isActive = currentPath && item.href.endsWith(currentPath);
          const activeClass = isActive ? 'nav-active' : '';
          const actionAttr = item.action ? `data-action="${item.action}"` : '';
          const labelText = translateNav(item.label);
          const labelMargin = isRTL ? 'mr-3' : 'ml-3';
          const iconOrder = isRTL ? 'order-2' : '';
          const labelOrder = isRTL ? 'order-1' : '';
          // Handle external URLs (starting with http:// or https://) by opening in new window
          // But don't treat frontend pages as external even if they're absolute URLs
          const isAbsoluteUrl = navHref.startsWith('http://') || navHref.startsWith('https://');
          const isFrontendPage = navHref.includes('/frontend/pages/') || 
                                 navHref.includes('/pages/') ||
                                 (isAbsoluteUrl && (navHref.includes('localhost:5502') || navHref.includes('127.0.0.1:5502')));
          const isExternal = isAbsoluteUrl && !isFrontendPage;
          const targetAttr = isExternal ? 'target="_blank" rel="noopener noreferrer"' : '';
          const onClickAttr = isExternal ? `onclick="window.open('${navHref}', '_blank'); return false;"` : '';
          sidebarHTML += `
        <a href="${navHref}" ${targetAttr} ${onClickAttr} class="nav-item flex items-center px-3 py-3 mx-2 rounded-lg transition-all duration-200 ${activeClass} hover:bg-blue-50 group" ${actionAttr} ${isRTL ? 'dir="rtl"' : ''}>
          <div class="flex-shrink-0 w-5 text-center ${iconOrder}">
            <i class="fas ${item.icon} text-gray-600 group-hover:text-blue-600 transition-colors duration-200"></i>
          </div>
          <span class="nav-label ${labelMargin} ${labelOrder} text-gray-700 group-hover:text-blue-600 font-medium whitespace-nowrap opacity-0 invisible transition-all duration-300" data-translate="${item.label}" ${isRTL ? 'dir="rtl" style="text-align: right;"' : ''}>
          ${labelText}
          </span>
        </a>
      `;
        });
      }
      sidebarHTML += `</div>`;
    });
  }
  sidebarHTML += '</nav></div>';

  // Remove old sidebar/header/flex
  const existingSidebar = document.querySelector('.bg-white.w-64, .sidebar, [class*="w-64"]');
  if (existingSidebar) existingSidebar.remove();
  const existingHeader = document.querySelector('header');
  if (existingHeader) existingHeader.remove();
  const existingFlexContainer = document.querySelector('.flex.h-screen');
  if (existingFlexContainer && existingFlexContainer.parentNode === document.body) {
    const mainContent = existingFlexContainer.querySelector('main, .main-content, [class*="flex-1"]');
    if (mainContent) document.body.appendChild(mainContent);
    existingFlexContainer.remove();
  }
  // Insert new sidebar
  document.body.insertAdjacentHTML('afterbegin', sidebarHTML);

  // Insert mobile sidebar overlay (for small screens; click to close menu)
  const sidebarEl = document.getElementById('collapsibleSidebar');
  if (sidebarEl) {
    sidebarEl.insertAdjacentHTML('afterend', '<div id="sidebarOverlay" class="sidebar-overlay hidden" aria-hidden="true"></div>');
  }

  // Update translations for sidebar after it's created
  if (typeof updatePageTranslations === 'function') {
    setTimeout(() => updatePageTranslations(), 100);
  }
}

// ============================
// Global Header / Page Hero
// ============================

function buildGlobalHeaderHTML() {
  // Avoid duplicate header
  if (document.querySelector('.page-hero')) return '';

  return `
    <section class="page-hero">
      <div class="page-hero-content">
        <div class="hero-inner">
          <!-- Row 1: Menu (left) | Date + Language + Notification (right, next to each other) -->
          <div class="hero-row hero-row-1">
            <button type="button" id="headerMobileMenuBtn" class="header-mobile-menu-btn" aria-label="Toggle menu">
              <i class="fas fa-bars" aria-hidden="true"></i>
            </button>
            <div class="hero-row-1-right">
              <div class="header-date">
                <i class="fas fa-calendar-alt"></i>
                <span id="currentDate"></span>
              </div>
              <select id="languageSelector" class="hero-select hero-select-compact" title="Language">
                <option value="en">En</option>
                <option value="fr">Fr</option>
                <option value="ar">Ar</option>
              </select>
              <div class="notification-bell" id="notificationBell" title="Notifications">
              <i class="fas fa-bell"></i>
              <span class="notification-badge" id="notificationCount">0</span>
              <div id="notificationDropdown" class="notification-dropdown hidden">
                <div class="notification-dropdown-header">
                  <h3 class="notification-dropdown-title">
                    <i class="fas fa-bell"></i>
                    <span data-translate="notifications.title">Notifications</span>
                  </h3>
                  <button id="markAllReadBtn" class="mark-all-read-btn" title="Mark all as read">
                    <i class="fas fa-check-double"></i>
                  </button>
                </div>
                <div id="notificationList" class="notification-list">
                  <div id="notificationLoading" class="notification-loading">
                    <div class="loading-spinner"></div>
                    <span data-translate="notifications.loading">Loading notifications...</span>
                  </div>
                  <div id="notificationEmpty" class="notification-empty hidden">
                    <i class="fas fa-bell-slash"></i>
                    <p data-translate="notifications.empty">No notifications</p>
                  </div>
                </div>
                <div class="notification-dropdown-footer">
                  <a href="priorities.html" class="view-all-link">
                    <span data-translate="notifications.view_all">View all notifications</span>
                    <i class="fas fa-arrow-right"></i>
                  </a>
                </div>
              </div>
            </div>
            </div>
          </div>
          <!-- Row 2: spacer (same width as menu) so name block aligns with row 1 icons -->
          <div class="hero-row hero-row-2 header-actions">
            <div class="hero-row-2-spacer" aria-hidden="true"></div>
            <div class="header-user-section">
              <div class="header-avatar" id="userAvatar">
                <span id="userInitials">D</span>
              </div>
              <div class="header-user-info">
                <h2 class="header-user-name" id="userName">Director</h2>
                <span class="header-user-role" id="userRole">Director</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function insertGlobalHeader() {
  // Don't insert on login page or if header already exists
  if (document.querySelector('#loginForm')) return;
  if (document.querySelector('.page-hero')) return;

  const main = document.querySelector('main');
  if (!main) return;

  const headerHTML = buildGlobalHeaderHTML();
  if (!headerHTML) return;

  main.insertAdjacentHTML('afterbegin', headerHTML);
}

// User data for header
function loadHeaderUserData() {
  try {
    if (!window.authManager || typeof authManager.getUser !== 'function') return;
    const user = authManager.getUser();
    if (!user) return;

    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'User';
    const userNameElement = document.getElementById('userName');
    if (userNameElement) userNameElement.textContent = fullName;

    const roleMap = {
      'Director': 'Director',
      'HR_Manager': 'HR Manager',
      'Department_Responsible': 'Department Head',
      'Employee': 'Employee'
    };
    const displayRole = roleMap[user.role] || user.role || '';
    const userRoleElement = document.getElementById('userRole');
    if (userRoleElement && displayRole) userRoleElement.textContent = displayRole;

    // Initials
    const initials = getInitialsForHeader(fullName);
    const userInitialsElement = document.getElementById('userInitials');
    if (userInitialsElement) userInitialsElement.textContent = initials;

    // If user has profile image, prefer that
    if (user.profile_image) {
      const avatarElement = document.getElementById('userAvatar');
      if (avatarElement) {
        avatarElement.innerHTML = `<img src="${user.profile_image}" alt="${fullName}">`;
      }
    }
  } catch (e) {
    console.warn('Error loading header user data:', e);
  }
}

function getInitialsForHeader(name) {
  if (!name) return 'U';
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Date display with Western numerals
function updateHeaderDateDisplay(lang) {
  const dateElement = document.getElementById('currentDate');
  if (!dateElement) return;
  const today = new Date();
  const options = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    numberingSystem: 'latn'
  };

  let locale = 'en-US';
  if (lang === 'ar') locale = 'ar-SA';
  else if (lang === 'fr') locale = 'fr-FR';

  dateElement.textContent = today.toLocaleDateString(locale, options);
}

// Language selector wiring for header
function initializeHeaderLanguageSelector() {
  const selector = document.getElementById('languageSelector');
  if (!selector) return;

  const savedLang =
    (typeof window !== 'undefined' && window.currentLanguage) ||
    localStorage.getItem('preferredLanguage') ||
    localStorage.getItem('language') ||
    localStorage.getItem('lang') ||
    'en';

  selector.value = savedLang;

  // Apply lang/dir attributes
  document.documentElement.lang = savedLang === 'ar' ? 'ar' : savedLang === 'fr' ? 'fr' : 'en';
  document.documentElement.dir = savedLang === 'ar' ? 'rtl' : 'ltr';

  if (typeof window !== 'undefined') {
    window.currentLanguage = savedLang;
  }

  updateHeaderDateDisplay(savedLang);

  selector.addEventListener('change', function () {
    const selectedLang = this.value;
    try {
      localStorage.setItem('preferredLanguage', selectedLang);
      localStorage.setItem('language', selectedLang);
    } catch (_) { }

    document.documentElement.lang = selectedLang === 'ar' ? 'ar' : selectedLang === 'fr' ? 'fr' : 'en';
    document.documentElement.dir = selectedLang === 'ar' ? 'rtl' : 'ltr';

    if (typeof window !== 'undefined') {
      window.currentLanguage = selectedLang;
    }

    updateHeaderDateDisplay(selectedLang);

    // Update translations on page
    if (typeof updatePageTranslations === 'function') {
      setTimeout(() => updatePageTranslations(), 50);
    }
  });
}

// ============================
// Notification System (Header)
// ============================

let allNotifications = [];
let notificationRefreshInterval = null;

function getHrTasksAuthHeaders() {
  try {
    if (!window.authManager || typeof authManager.getToken !== 'function') return {};
    const token = authManager.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  } catch (_) {
    return {};
  }
}

function getHrTasksApiBase() {
  if (typeof window !== 'undefined') {
    // window.API_BASE is '' in production, so only use it if non-empty
    if (window.API_BASE) return window.API_BASE;
    // Use hr_tasks from API_SERVICES; check for undefined (not falsy) to handle empty string in production
    if (window.API_SERVICES && typeof window.API_SERVICES.hr_tasks !== 'undefined') {
      return window.API_SERVICES.hr_tasks; // returns "" in production
    }
  }
  return 'http://localhost:3020';
}

// Toggle notification dropdown
function toggleNotificationDropdown() {
  const dropdown = document.getElementById('notificationDropdown');
  if (!dropdown) return;
  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    dropdown.classList.remove('hidden');
    loadNotifications();
  } else {
    dropdown.classList.add('hidden');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function (event) {
  const dropdown = document.getElementById('notificationDropdown');
  const bell = document.getElementById('notificationBell');
  if (!dropdown || !bell) return;
  if (!dropdown.contains(event.target) && !bell.contains(event.target)) {
    dropdown.classList.add('hidden');
  }
});

function initializeHeaderNotifications() {
  const bell = document.getElementById('notificationBell');
  if (bell) {
    bell.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleNotificationDropdown();
    });
  }

  const markAllBtn = document.getElementById('markAllReadBtn');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      markAllAsRead();
    });
  }

  // Initial load & auto-refresh
  setTimeout(() => {
    loadNotifications();
    startNotificationRefresh();
  }, 1000);
}

// Show loading state
function showNotificationLoading() {
  const loading = document.getElementById('notificationLoading');
  const empty = document.getElementById('notificationEmpty');
  if (loading) loading.style.display = 'flex';
  if (empty) empty.classList.add('hidden');
}

// Show empty state
function showNotificationEmpty() {
  const loading = document.getElementById('notificationLoading');
  const empty = document.getElementById('notificationEmpty');
  if (loading) loading.style.display = 'none';
  if (empty) empty.classList.remove('hidden');
}

// Update badge
function updateNotificationBadge(count) {
  const badge = document.getElementById('notificationCount');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

// Load all notifications (tasks + reports + complaints + signals)
async function loadNotifications() {
  const listContainer = document.getElementById('notificationList');
  if (!listContainer) return;

  showNotificationLoading();

  try {
    const [tasks, reports, complaints, signals] = await Promise.all([
      loadTaskNotifications(),
      loadReportNotifications(),
      loadComplaintNotifications(),
      loadSignalNotifications()
    ]);

    allNotifications = [...tasks, ...reports, ...complaints, ...signals];
    allNotifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const unreadCount = allNotifications.filter(n => !n.isRead).length;
    updateNotificationBadge(unreadCount);

    renderNotifications(allNotifications);
  } catch (error) {
    console.error('Error loading notifications:', error);
    showNotificationEmpty();
  }
}

async function loadTaskNotifications() {
  try {
    const base = getHrTasksApiBase();
    const response = await fetch(`${base}/tasks`, {
      headers: getHrTasksAuthHeaders()
    });
    if (!response.ok) return [];
    const tasks = await response.json();
    const notifications = [];

    const user = authManager && authManager.getUser ? authManager.getUser() : null;
    if (!user) return [];

    const now = new Date();
    tasks.forEach(task => {
      const dueDate = task.due_date ? new Date(task.due_date) : null;
      const isOverdue = dueDate && dueDate < now && task.status !== 'Completed';
      const isPending = task.status === 'Pending' || task.status === 'In Progress';

      if (isOverdue) {
        notifications.push({
          id: `task-${task.id}`,
          type: 'task',
          title: task.title || 'Task',
          message: `Overdue task - Due ${formatHeaderDate(dueDate)}`,
          link: 'tasks.html',
          icon: 'fa-tasks',
          color: '#ef4444',
          timestamp: task.created_at || new Date().toISOString(),
          isRead: false
        });
      } else if (isPending && task.priority === 'high') {
        notifications.push({
          id: `task-${task.id}`,
          type: 'task',
          title: task.title || 'Task',
          message: 'High priority task pending',
          link: 'tasks.html',
          icon: 'fa-tasks',
          color: '#3b82f6',
          timestamp: task.created_at || new Date().toISOString(),
          isRead: false
        });
      }
    });

    return notifications.slice(0, 10);
  } catch (error) {
    console.error('Error loading task notifications:', error);
    return [];
  }
}

async function loadReportNotifications() {
  try {
    const base = getHrTasksApiBase();
    const response = await fetch(`${base}/api/rapportemp/director/all-reports`, {
      headers: getHrTasksAuthHeaders()
    });
    if (!response.ok) {
      // Silently handle 404 or other errors - service might not be available
      if (response.status === 404) {
        return [];
      }
      return [];
    }
    const data = await response.json();
    const reports = data.reports || [];
    const notifications = [];

    reports.forEach(report => {
      let analysis = report.analysis;
      if (typeof analysis === 'string') {
        try {
          analysis = JSON.parse(analysis);
        } catch (e) {
          analysis = null;
        }
      }
      const urgencyScore = analysis?.urgency?.score || 0;
      if (report.status === 'pending' && urgencyScore >= 8) {
        notifications.push({
          id: `report-${report.id}`,
          type: 'report',
          title: report.title || 'Report',
          message: `Urgent report - Priority score: ${urgencyScore}/10`,
          link: 'reports-director.html',
          icon: 'fa-file-alt',
          color: '#f59e0b',
          timestamp: report.created_at || new Date().toISOString(),
          isRead: false
        });
      }
    });

    return notifications.slice(0, 10);
  } catch (error) {
    // Silently handle network errors - service might not be available
    return [];
  }
}

async function loadComplaintNotifications() {
  try {
    const base = getHrTasksApiBase();
    const response = await fetch(`${base}/api/director/complaints-statistics`, {
      headers: getHrTasksAuthHeaders()
    });
    if (!response.ok) {
      // Silently handle 404 or other errors - service might not be available
      if (response.status === 404) {
        return [];
      }
      return [];
    }
    const data = await response.json();
    const overview = data.overview || {};
    const notifications = [];

    if (overview.pending > 0) {
      notifications.push({
        id: 'complaints-pending',
        type: 'complaint',
        title: 'Pending Complaints',
        message: `${overview.pending} complaint${overview.pending > 1 ? 's' : ''} awaiting review`,
        link: 'complaints-director.html',
        icon: 'fa-comment',
        color: '#ef4444',
        timestamp: new Date().toISOString(),
        isRead: false
      });
    }

    if (overview.overdue > 0) {
      notifications.push({
        id: 'complaints-overdue',
        type: 'complaint',
        title: 'Overdue Complaints',
        message: `${overview.overdue} complaint${overview.overdue > 1 ? 's' : ''} past due date`,
        link: 'complaints-director.html',
        icon: 'fa-comment',
        color: '#dc2626',
        timestamp: new Date().toISOString(),
        isRead: false
      });
    }

    return notifications;
  } catch (error) {
    // Silently handle network errors - service might not be available
    return [];
  }
}

async function loadSignalNotifications() {
  try {
    const base = getHrTasksApiBase();
    const response = await fetch(`${base}/api/director/signals-stats`, {
      headers: getHrTasksAuthHeaders()
    });
    if (!response.ok) {
      // Silently handle 404 or other errors - service might not be available
      if (response.status === 404) {
        return [];
      }
      return [];
    }
    const data = await response.json();
    const overview = data.overview || {};
    const notifications = [];

    if (overview.pending > 0) {
      notifications.push({
        id: 'signals-pending',
        type: 'signal',
        title: 'Pending Signals',
        message: `${overview.pending} signal${overview.pending > 1 ? 's' : ''} awaiting treatment`,
        link: 'signals-responsible.html',
        icon: 'fa-exclamation-triangle',
        color: '#10b981',
        timestamp: new Date().toISOString(),
        isRead: false
      });
    }

    if (overview.high_priority > 0) {
      notifications.push({
        id: 'signals-high-priority',
        type: 'signal',
        title: 'High Priority Signals',
        message: `${overview.high_priority} high priority signal${overview.high_priority > 1 ? 's' : ''}`,
        link: 'signals-responsible.html',
        icon: 'fa-exclamation-triangle',
        color: '#059669',
        timestamp: new Date().toISOString(),
        isRead: false
      });
    }

    return notifications;
  } catch (error) {
    console.error('Error loading signal notifications:', error);
    return [];
  }
}

function renderNotifications(notifications) {
  const listContainer = document.getElementById('notificationList');
  const loading = document.getElementById('notificationLoading');
  const empty = document.getElementById('notificationEmpty');
  if (!listContainer || !loading || !empty) return;

  loading.style.display = 'none';

  const existingItems = listContainer.querySelectorAll('.notification-item');
  existingItems.forEach(item => item.remove());

  if (notifications.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  notifications.forEach(notification => {
    const item = createNotificationItem(notification);
    listContainer.appendChild(item);
  });
}

function createNotificationItem(notification) {
  const div = document.createElement('div');
  div.className = `notification-item ${notification.isRead ? '' : 'unread'}`;
  div.style.position = 'relative';
  div.innerHTML = `
    <div class="notification-icon ${notification.type}">
      <i class="fas ${notification.icon}"></i>
    </div>
    <div class="notification-content">
      <div class="notification-title">${notification.title}</div>
      <div class="notification-message">${notification.message}</div>
      <div class="notification-time">
        <i class="fas fa-clock"></i>
        ${formatRelativeTime(notification.timestamp)}
      </div>
    </div>
  `;
  div.addEventListener('click', () => {
    if (notification.link) {
      window.location.href = notification.link;
    }
  });
  return div;
}

function formatRelativeTime(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return formatHeaderDate(date);
}

function formatHeaderDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function markAllAsRead() {
  allNotifications.forEach(n => (n.isRead = true));
  updateNotificationBadge(0);
  renderNotifications(allNotifications);
}

function startNotificationRefresh() {
  if (notificationRefreshInterval) {
    clearInterval(notificationRefreshInterval);
  }
  notificationRefreshInterval = setInterval(() => {
    loadNotifications();
  }, 30000);
}

// Mobile sidebar toggle: open/close sidebar and overlay on small screens
function initializeMobileSidebarToggle() {
  const btn = document.getElementById('headerMobileMenuBtn');
  const sidebar = document.getElementById('collapsibleSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!btn || !sidebar || !overlay) return;

  function closeSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    const icon = btn.querySelector('i');
    if (icon) {
      icon.classList.remove('fa-times');
      icon.classList.add('fa-bars');
    }
  }

  function openSidebar() {
    sidebar.classList.add('mobile-open');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    const icon = btn.querySelector('i');
    if (icon) {
      icon.classList.remove('fa-bars');
      icon.classList.add('fa-times');
    }
  }

  btn.addEventListener('click', function () {
    if (sidebar.classList.contains('mobile-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  overlay.addEventListener('click', closeSidebar);

  const closeBtn = document.getElementById('sidebarMobileCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

  // Close sidebar when a nav link is clicked (navigation happens)
  sidebar.querySelectorAll('.nav-item').forEach(function (item) {
    if (item.getAttribute('data-action') === 'logout') return;
    item.addEventListener('click', function () {
      closeSidebar();
    });
  });
}

// Initialize page functionality
document.addEventListener("DOMContentLoaded", async function () {
  // Initialize new sidebar navigation
  try {
    initializeCollapsibleSidebar();
    if (document.getElementById('collapsibleSidebar')) {
      handleSidebarNavigation();
    }
  } catch (e) {
    console.warn('Sidebar initialization skipped:', e);
  }

  // Insert and initialize global header (page hero) on authenticated pages
  try {
    insertGlobalHeader();
    initializeHeaderLanguageSelector();
    loadHeaderUserData();
    initializeHeaderNotifications();
  } catch (e) {
    console.warn('Header initialization skipped:', e);
  }

  // Wire mobile menu button and overlay (header + sidebar must exist)
  try {
    initializeMobileSidebarToggle();
  } catch (e) {
    console.warn('Mobile sidebar toggle skipped:', e);
  }

  loadUserProfileSidebar();

  // Update all placeholder user images on the page
  await updateAllUserImages();

  // Add click handlers for common elements
  document.addEventListener("click", function (e) {
    // Handle logout buttons
    if (
      e.target.matches('[data-action="logout"]') ||
      e.target.closest('[data-action="logout"]')
    ) {
      e.preventDefault();
      handleLogout();
    }

    // Handle modal close buttons
    if (e.target.matches(".modal-close")) {
      e.target.closest(".modal-overlay")?.remove();
    }
  });

  // Enhance any existing modals/popups to have a close X and overlay-to-close
  try {
    initializeGlobalModalEnhancer();
  } catch (e) {
    console.warn('Modal enhancer initialization skipped:', e);
  }

  // Add search functionality
  const searchInputs = document.querySelectorAll("[data-search]");
  searchInputs.forEach((input) => {
    input.addEventListener(
      "input",
      Utils.debounce(function () {
        const searchTerm = this.value.toLowerCase();
        const targetSelector = this.getAttribute("data-search");
        const items = document.querySelectorAll(targetSelector);

        items.forEach((item) => {
          const text = item.textContent.toLowerCase();
          item.style.display = text.includes(searchTerm) ? "" : "none";
        });
      }, 300)
    );
  });
});

// New function to update all placeholder user images on the page
async function updateAllUserImages() {
  try {
    // Check if we have a valid token before making the request
    const token = localStorage.getItem('token');
    if (!token || token === 'test-token') {
      console.log("No valid authentication token, skipping user images update");
      return;
    }

    const user = authManager.getUser();
    if (!user || !user.id) {
      console.log("No user found or user ID missing");
      return;
    }

    const employees = await APIService.getEmployees({ user_id: user.id });
    const employee = employees.find((emp) => emp.user_id === user.id);

    if (!employee) {
      console.log("No employee record found for user ID:", user.id);
      return;
    }

    // Find all img elements with placeholder src
    const placeholderImgs = Array.from(document.querySelectorAll('img')).filter(img =>
      img.src.includes("via.placeholder.com") || img.src.includes("placeholder")
    );

    // Update each placeholder image
    for (const img of placeholderImgs) {
      await setEmployeeProfileImage(img, employee);
    }
  } catch (error) {
    // Only log error if it's not an authentication error
    if (error.message && !error.message.includes('Authentication required') && !error.message.includes('401')) {
      console.error("Error updating user images:", error);
    } else {
      console.log("Authentication required for user images update, skipping");
    }
  }
}

// Global error handler
window.addEventListener("error", function (e) {
  console.error("Global error:", e.error);
  Utils.showNotification("An unexpected error occurred", "error");
});

// Handle unhandled promise rejections
window.addEventListener("unhandledrejection", function (e) {
  // Suppress MetaMask and browser extension errors
  const reason = e.reason;
  if (reason && (
    (typeof reason === 'string' && (
      reason.includes('MetaMask') || 
      reason.includes('extension not found') ||
      reason.includes('Failed to connect to MetaMask')
    )) ||
    (reason.message && (
      reason.message.includes('MetaMask') || 
      reason.message.includes('extension not found') ||
      reason.message.includes('Failed to connect to MetaMask')
    ))
  )) {
    e.preventDefault();
    console.debug('MetaMask extension not available (suppressed)');
    return;
  }
  
  console.error("Unhandled promise rejection:", e.reason);
  Utils.showNotification(
    "An error occurred while processing your request",
    "error"
  );
});

// Helper function to translate - safe fallback if translations.js not loaded
function translateNav(key) {
  // Try translate function first (if available)
  if (typeof translate === 'function') {
    const translated = translate(key);
    if (translated && translated !== key) {
      return translated;
    }
  }

  // Try window.translations object
  if (typeof window !== 'undefined' && window.translations) {
    const lang = window.currentLanguage || localStorage.getItem('language') || localStorage.getItem('lang') || 'en';
    const translation = window.translations[lang]?.[key];
    if (translation) {
      return translation;
    }
  }

  // Return key as fallback (will be translated by updatePageTranslations later)
  return key;
}

// Make functions globally accessible
if (typeof window !== 'undefined') {
  window.initializeCollapsibleSidebar = initializeCollapsibleSidebar;
  window.handleSidebarNavigation = handleSidebarNavigation;
}

// Global modal enhancer: ensure all modals/popups have an X close and overlay click closes
function initializeGlobalModalEnhancer() {
  // Delegate overlay click to close when clicking outside modal-content
  document.addEventListener('click', function (event) {
    const overlay = event.target.closest('.modal-overlay');
    if (!overlay) return;
    const content = event.target.closest('.modal-content');
    // If clicked the overlay area (not inside content), close
    if (!content) {
      overlay.remove();
      return;
    }
  });

  // MutationObserver to inject a close X button if missing
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        // If a modal overlay is added, ensure it has a close button
        const overlays = node.matches?.('.modal-overlay') ? [node] : Array.from(node.querySelectorAll?.('.modal-overlay') || []);
        overlays.forEach((ov) => {
          const content = ov.querySelector('.modal-content');
          if (!content) return;
          // If header area with an existing X exists, skip
          const hasAnyClose = content.querySelector('.modal-close, [data-close], .fa-times');
          if (hasAnyClose) return;

          // Build a close button and place it at top-right
          const closeBtn = document.createElement('button');
          closeBtn.className = 'modal-close absolute top-3 right-3 text-gray-500 hover:text-gray-700';
          closeBtn.innerHTML = '<i class="fas fa-times"></i>';
          closeBtn.addEventListener('click', () => {
            ov.remove();
          });

          // Ensure content is position:relative to place absolute button
          const prevPos = getComputedStyle(content).position;
          if (prevPos === 'static' || !prevPos) {
            content.style.position = 'relative';
          }
          content.appendChild(closeBtn);
        });
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}
