// Sidebar Navigation Logic
// Extracted and adapted from frontend/assets/js/main.js

// API service URLs
if (typeof window !== 'undefined' && !window.API_SERVICES) {
    window.API_SERVICES = {
        auth: "/api/auth",
        users: "/api/users",
        departments: "/api/departments",
        tasks: "",
        hr_tasks: "",
        meetings: "/api/meetings",
        payments: "/api/payments",
        notifications: "/api/notifications",
        attendance: "",
        requests: "/api/requests",
        salary: "/api/salary",
        timetable: "/api/timetable",
    };
}

// Helper function to translate
function translateNav(key) {
    if (typeof translate === 'function') {
        const translated = translate(key);
        if (translated && translated !== key) return translated;
    }
    return key;
}

// Navigation Sections
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
                { href: 'org-structure.html', icon: 'fa-sitemap', label: 'nav.org_structure' },
                { href: 'attendance.html', icon: 'fa-clock', label: 'nav.attendance' }
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

function getSidebarNavSectionsByRole(role) {
    const normalizedRole = role ? String(role).trim() : '';

    // Check context (simplified for this file)
    const currentPath = window.location.pathname.split('/').pop() || '';
    const hrPages = ['hr-dashboard.html', 'employees-simple.html', 'org-structure.html', 'attendance.html',
        'timetable-library.html', 'employee-assignments.html', 'salary-management.html',
        'payslips-admin.html', 'exceptions.html'];
    const isDirectorInHRContext = normalizedRole === 'Director' && hrPages.includes(currentPath);

    switch (normalizedRole) {
        case 'HR_Manager':
        case 'HR Manager':
        case 'hr_manager':
        case 'hr-manager':
        case 'admin':
        case 'Admin':
        case 'ADMIN':
            return getHRNavigationSections('employee-dashboard.html', 'My Space');
        case 'Employee':
            return [
                {
                    name: 'nav.main', items: [
                        { href: 'employee-dashboard.html', icon: 'fa-tachometer-alt', label: 'nav.dashboard' },
                        { href: 'my-tasks.html', icon: 'fa-tasks', label: 'nav.tasks' },
                        { href: 'rapportemp.html', icon: 'fa-chart-bar', label: 'nav.reports' },
                        { href: 'submit-exception.html', icon: 'fa-paper-plane', label: 'nav.requests' },
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
            if (isDirectorInHRContext) {
                return getHRNavigationSections('director-dashboard.html', 'My Space');
            }
            return [
                {
                    name: 'nav.all_views', items: [
                        { href: 'director-dashboard-stats.html', icon: 'fa-chart-line', label: 'nav.dashboard' },
                        { href: 'director.html', icon: 'fa-tasks', label: 'nav.tasks_management' },
                        { href: 'reportdir.html', icon: 'fa-chart-bar', label: 'nav.reports' },
                        { href: 'complaints_director.html', icon: 'fa-exclamation-circle', label: 'nav.complaints' },
                        { href: 'signals_responsible.html', icon: 'fa-signal', label: 'nav.signals' }
                    ]
                },
                {
                    name: 'nav.account', items: [
                        { href: '#', icon: 'fa-sign-out-alt', label: 'nav.logout', action: 'logout' }
                    ]
                }
            ];
        default:
            return [];
    }
}

function handleSidebarNavigation() {
    const sidebar = document.getElementById('collapsibleSidebar');
    if (!sidebar) return;
    const sidebarItems = document.querySelectorAll(".nav-item");

    let isExpanded = false;

    sidebar.addEventListener('mouseenter', () => {
        isExpanded = true;
        sidebar.classList.remove('w-16');
        sidebar.classList.add('w-64');
        document.querySelectorAll('.nav-label').forEach(label => {
            label.classList.remove('opacity-0', 'invisible');
            label.classList.add('opacity-100', 'visible');
        });
        document.querySelectorAll('.search-input-expanded').forEach(input => {
            input.classList.remove('opacity-0', 'invisible');
            input.classList.add('opacity-100', 'visible');
        });
        const title = document.querySelector('.school-title');
        if (title) title.classList.remove('hidden');
        const subtitle = document.querySelector('.school-subtitle');
        if (subtitle) subtitle.classList.remove('hidden');
    });

    sidebar.addEventListener('mouseleave', () => {
        isExpanded = false;
        sidebar.classList.remove('w-64');
        sidebar.classList.add('w-16');
        document.querySelectorAll('.nav-label').forEach(label => {
            label.classList.remove('opacity-100', 'visible');
            label.classList.add('opacity-0', 'invisible');
        });
        document.querySelectorAll('.search-input-expanded').forEach(input => {
            input.classList.remove('opacity-100', 'visible');
            input.classList.add('opacity-0', 'invisible');
        });
        const title = document.querySelector('.school-title');
        if (title) title.classList.add('hidden');
        const subtitle = document.querySelector('.school-subtitle');
        if (subtitle) subtitle.classList.add('hidden');
    });

    sidebarItems.forEach((item) => {
        item.addEventListener("click", function (e) {
            if (this.getAttribute("data-action") === "logout") return;

            // Allow default navigation for links
            const href = this.getAttribute("href");
            if (href && href !== "#" && !href.startsWith("javascript:")) {
                // Optional: Highlight active
                sidebarItems.forEach(i => i.classList.remove("nav-active"));
                this.classList.add("nav-active");
            }
        });
    });
}

function initializeCollapsibleSidebar() {
    if (document.getElementById('collapsibleSidebar')) return;

    let role = (window.authManager && window.authManager.getUserRole && window.authManager.getUserRole()) || localStorage.getItem('userRole') || 'HR_Manager';
    if (role && (role.toLowerCase() === 'admin' || role === 'Admin' || role === 'ADMIN')) {
        role = 'HR_Manager';
    }

    const navigationSections = getSidebarNavSectionsByRole(role);
    const isRTL = document.documentElement.getAttribute('dir') === 'rtl';
    const sidebarPosition = isRTL ? 'right-0' : 'left-0';
    const sidebarMargin = isRTL ? 'mr-3' : 'ml-3';
    const searchPlaceholder = translateNav('nav.search');
    const isEmployee = role === 'Employee';
    const sidebarSubtitle = isEmployee ? translateNav('nav.employee_space') : translateNav('nav.hr_management_system');

    // Logo path - assuming we are in hr_tasks/hr_tasks/public
    // We need to go up to frontend assets
    const logoPath = '../../../frontend/assets/images/logo fadila.png';

    let sidebarHTML = `
    <div id="collapsibleSidebar" class="fixed ${sidebarPosition} top-0 h-screen bg-white shadow-lg z-50 w-16 transition-all duration-300 overflow-hidden">
      <div class="p-4 border-b border-gray-200">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <img src="${logoPath}" alt="EL FADILA SCHOOL" class="h-8 w-8 object-contain" onerror="this.onerror=null; this.src='${logoPath}';">
          </div>
          <div class="${sidebarMargin} overflow-hidden">
            <h1 class="school-title text-lg font-bold text-gray-900 whitespace-nowrap hidden transition-opacity duration-300">EL FADILA SCHOOL</h1>
            <p class="school-subtitle text-sm text-gray-500 whitespace-nowrap hidden transition-opacity duration-300" data-translate="${isEmployee ? 'nav.employee_space' : 'nav.hr_management_system'}">${sidebarSubtitle}</p>
          </div>
        </div>
      </div>

      <div class="search-container p-4 border-b border-gray-200 transition-all duration-300 relative">
        <i class="fas fa-search search-icon-collapsed"></i>
        <input type="text" id="sidebarSearch" data-translate-placeholder="nav.search" placeholder="${searchPlaceholder}" class="search-input-expanded w-full pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
      </div>

      <nav class="flex-1 overflow-y-auto py-4">`;

    if (navigationSections && navigationSections.length > 0) {
        navigationSections.forEach((section, si) => {
            if (si > 0) sidebarHTML += `<div class="border-t border-gray-200 mx-4 my-2"></div>`;
            sidebarHTML += `<div class="nav-section px-2">`;

            section.items.forEach(item => {
                // Adjust paths if needed. Since we are in hr_tasks/hr_tasks/public, and other pages might be in frontend/pages
                // We might need to adjust hrefs.
                // For now, let's assume hrefs are relative to frontend/pages or absolute.
                // But wait, director.html is in hr_tasks/hr_tasks/public.
                // If href is 'hr-dashboard.html', it expects it in the same dir.
                // But hr-dashboard.html is likely in frontend/pages.
                // So we should prepend '../../../frontend/pages/' to links if they are not local.

                let navHref = item.href;
                if (navHref !== '#' && !navHref.startsWith('http') && !navHref.startsWith('javascript')) {
                    // Check if file exists locally? No easy way.
                    // Assume most pages are in frontend/pages
                    // Exception: director.html, my-tasks.html are here.
                    const localPages = ['director.html', 'director-dashboard-stats.html', 'my-tasks.html', 'tasks.html', 'priorities.html', 'statistics.html', 'reportdir.html', 'complaints_director.html', 'signals_responsible.html'];
                    if (!localPages.includes(navHref)) {
                        navHref = '../../../frontend/pages/' + navHref;
                    }
                }

                const isActive = window.location.pathname.endsWith(item.href);
                const activeClass = isActive ? 'nav-active' : '';
                const actionAttr = item.action ? `data-action="${item.action}"` : '';
                const labelText = translateNav(item.label);
                const labelMargin = isRTL ? 'mr-3' : 'ml-3';

                sidebarHTML += `
                <a href="${navHref}" class="nav-item flex items-center px-3 py-3 mx-2 rounded-lg transition-all duration-200 ${activeClass} hover:bg-gray-100 group" ${actionAttr}>
                  <div class="flex-shrink-0 w-5 text-center">
                    <i class="fas ${item.icon} text-gray-600 group-hover:text-blue-600 transition-colors duration-200"></i>
                  </div>
                  <span class="nav-label ${labelMargin} text-gray-700 group-hover:text-blue-600 font-medium whitespace-nowrap opacity-0 invisible transition-all duration-300" data-translate="${item.label}">
                  ${labelText}
                  </span>
                </a>
                `;
            });
            sidebarHTML += `</div>`;
        });
    }
    sidebarHTML += '</nav></div>';

    document.body.insertAdjacentHTML('afterbegin', sidebarHTML);

    if (isRTL) {
        document.body.style.paddingRight = '4rem';
    } else {
        document.body.style.paddingLeft = '4rem';
    }
}

// Initialize
document.addEventListener("DOMContentLoaded", function () {
    initializeCollapsibleSidebar();
    handleSidebarNavigation();

    // Logout handler
    document.addEventListener("click", function (e) {
        if (e.target.closest('[data-action="logout"]')) {
            e.preventDefault();
            if (confirm("Are you sure you want to logout?")) {
                if (window.authManager) window.authManager.logout();
                window.location.href = '../../../frontend/index.html';
            }
        }
    });
});
