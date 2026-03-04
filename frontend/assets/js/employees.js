// Employee management functionality

class EmployeeManager {
    constructor() {
        this.employees = [];
        this.allEmployees = []; // Store all employees for client-side filtering
        this.positions = [];
        this.currentPage = 1;
        this.itemsPerPage = 10;
        this.searchTerm = '';
        this.sortBy = 'first_name';
        this.branchFilter = 'all';
    }

    getEffectiveItemsPerPage() {
        if (this.itemsPerPage <= 0) return this.employees.length || 1;
        return this.itemsPerPage;
    }

    async loadEmployees() {
        try {
            const params = {
                search: this.searchTerm,
                sort_by: this.sortBy
            };
            
            // If branch filter is set and not 'all', add it to params
            if (this.branchFilter && this.branchFilter !== 'all') {
                params.institution = this.branchFilter;
            }
            
            const response = await APIService.getEmployees(params);
            // Handle both wrapped and direct responses
            this.allEmployees = response.employees || response || [];
            
            // Apply client-side filtering if needed
            this.applyFilters();
            
            this.updateStatistics();
            this.renderEmployeeTable();
            this.renderEmployeeGrid();
            this.updatePagination();
            this.updateEmployeeCount();
        } catch (error) {
            console.error('Error loading employees:', error);
            const errorText = typeof translate === 'function' ? translate('employee.failed_to_load_employees') : 'Failed to load employees';
            Utils.showNotification(errorText, 'error');
        }
    }

    applyFilters() {
        let filtered = [...this.allEmployees];
        
        // Apply branch filter if set
        if (this.branchFilter && this.branchFilter !== 'all') {
            filtered = filtered.filter(emp => emp.institution === this.branchFilter);
        }
        
        // Apply search filter
        if (this.searchTerm) {
            const searchLower = this.searchTerm.toLowerCase();
            filtered = filtered.filter(emp => {
                const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
                const email = (emp.email || '').toLowerCase();
                const position = (emp.position_name || '').toLowerCase();
                return fullName.includes(searchLower) || 
                       email.includes(searchLower) || 
                       position.includes(searchLower);
            });
        }
        
        // Apply sorting
        filtered.sort((a, b) => {
            let aVal, bVal;
            switch (this.sortBy) {
                case 'first_name':
                    aVal = (a.first_name || '').toLowerCase();
                    bVal = (b.first_name || '').toLowerCase();
                    break;
                case 'last_name':
                    aVal = (a.last_name || '').toLowerCase();
                    bVal = (b.last_name || '').toLowerCase();
                    break;
                case 'email':
                    aVal = (a.email || '').toLowerCase();
                    bVal = (b.email || '').toLowerCase();
                    break;
                case 'join_date':
                    aVal = new Date(a.join_date || 0);
                    bVal = new Date(b.join_date || 0);
                    break;
                default:
                    return 0;
            }
            
            if (this.sortBy === 'join_date') {
                return bVal - aVal; // Newest first
            }
            return aVal.localeCompare(bVal);
        });
        
        this.employees = filtered;
    }

    filterEmployees(searchTerm = '', sortBy = 'first_name', branchFilter = 'all') {
        this.searchTerm = searchTerm;
        this.sortBy = sortBy;
        this.branchFilter = branchFilter;
        this.currentPage = 1;
        
        // If we have all employees loaded, apply filters client-side
        if (this.allEmployees.length > 0) {
            this.applyFilters();
            this.updateStatistics();
            this.renderEmployeeTable();
            this.renderEmployeeGrid();
            this.updatePagination();
            this.updateEmployeeCount();
        } else {
            // Otherwise, reload from API
            this.loadEmployees();
        }
    }

    updateStatistics() {
        const total = this.employees.length;
        const active = this.employees.filter(emp => this.isEmployeeActive(emp)).length;
        const inactive = total - active;
        const positions = new Set(this.employees.map(emp => emp.position_name).filter(Boolean)).size;
        
        document.getElementById('totalEmployeesStat').textContent = total;
        document.getElementById('activeEmployeesStat').textContent = active;
        document.getElementById('inactiveEmployeesStat').textContent = inactive;
        document.getElementById('totalPositionsStat').textContent = positions;
    }

    updateEmployeeCount() {
        const countText = document.getElementById('employeeCountText');
        if (countText) {
            const showingText = typeof translate === 'function' ? translate('employee.showing') : 'Showing';
            const employeesText = typeof translate === 'function' ? translate('employee.employees') : 'employees';
            countText.textContent = `${showingText} ${this.employees.length} ${employeesText}`;
        }
    }

    async loadPositions() {
        try {
            this.positions = await APIService.request('users', '/positions');
        } catch (error) {
            console.error('Error loading positions:', error);
        }
    }

    renderEmployeeTable() {
        const tbody = document.getElementById('employeeTableBody');
        if (!tbody) return;

        if (this.employees.length === 0) {
            const noEmployeesText = typeof translate === 'function' ? translate('employee.no_employees_found') : 'No employees found';
            const tryAdjustingText = typeof translate === 'function' ? translate('employee.try_adjusting_search') : 'Try adjusting your search criteria';
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-16">
                        <div class="flex flex-col items-center justify-center">
                            <div class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                                <i class="fas fa-users text-3xl text-gray-400"></i>
                            </div>
                            <p class="text-lg font-medium text-gray-700 mb-2">${noEmployeesText}</p>
                            ${this.searchTerm ? `<p class="text-sm text-gray-500">${tryAdjustingText}</p>` : ''}
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        const effectivePerPage = this.getEffectiveItemsPerPage();
        const startIndex = (this.currentPage - 1) * effectivePerPage;
        const endIndex = startIndex + effectivePerPage;
        const paginatedEmployees = this.employees.slice(startIndex, endIndex);

        const activeText = typeof translate === 'function' ? translate('employee.active') : 'Active';
        const inactiveText = typeof translate === 'function' ? translate('employee.inactive') : 'Inactive';
        const viewText = typeof translate === 'function' ? translate('employee.view') : 'View';
        const editText = typeof translate === 'function' ? translate('employee.edit') : 'Edit';
        const deleteText = typeof translate === 'function' ? translate('employee.delete') : 'Delete';
        const atsText = typeof translate === 'function' ? translate('employee.generate_ats') : 'Generate Attestation de Travail';
        const certificatText = typeof translate === 'function' ? translate('employee.generate_certificat') : 'Generate Certificat de Travail';
        const noPositionText = typeof translate === 'function' ? translate('common.no_position') : 'No position';

        tbody.innerHTML = paginatedEmployees.map(employee => {
            const isActive = this.isEmployeeActive(employee);
            return `
            <tr class="table-row border-b border-gray-200">
                <td class="py-4 px-6">
                    <div class="flex items-center">
                        <div class="h-12 w-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mr-4 shadow-md">
                            <span class="text-white text-sm font-semibold">
                                ${(employee.first_name?.[0] || '').toUpperCase()}${(employee.last_name?.[0] || '').toUpperCase()}
                            </span>
                        </div>
                        <div>
                            <div class="font-semibold text-gray-900 text-base">${employee.first_name || ''} ${employee.last_name || ''}</div>
                            ${employee.username ? `<div class="text-sm text-gray-500 mt-0.5">@${employee.username}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td class="py-4 px-6">
                    <div class="flex items-center text-gray-700">
                        <i class="fas fa-envelope text-gray-400 mr-2 text-sm"></i>
                        <span>${employee.email || '-'}</span>
                    </div>
                </td>
                <td class="py-4 px-6">
                    <div class="flex items-center text-gray-700">
                        <i class="fas fa-briefcase text-gray-400 mr-2 text-sm"></i>
                        <span>${employee.position_name || noPositionText}</span>
                    </div>
                </td>
                <td class="py-4 px-6">
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        ${employee.role || '-'}
                    </span>
                </td>
                <td class="py-4 px-6">
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                        isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }">
                        <span class="w-2 h-2 rounded-full mr-2 ${
                            isActive ? 'bg-green-500' : 'bg-red-500'
                        }"></span>
                        ${isActive ? activeText : inactiveText}
                    </span>
                </td>
                <td class="py-4 px-6">
                    <div class="flex items-center space-x-2">
                        <button onclick="employeeManager.viewEmployee('${employee.id}')" 
                                class="action-btn p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="${viewText}">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button onclick="employeeManager.editEmployee('${employee.id}')" 
                                class="action-btn p-2 text-green-600 hover:bg-green-50 rounded-lg transition-all" title="${editText}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="employeeManager.generateATS('${employee.id}')" 
                                class="action-btn p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-all ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}" 
                                ${!isActive ? 'disabled' : ''}
                                title="${atsText}">
                            <i class="fas fa-file-pdf"></i>
                        </button>
                        <button onclick="employeeManager.generateCertificat('${employee.id}')" 
                                class="action-btn p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all ${isActive ? 'opacity-50 cursor-not-allowed' : ''}" 
                                ${isActive ? 'disabled' : ''}
                                title="${certificatText}">
                            <i class="fas fa-file-contract"></i>
                        </button>
                        <button onclick="employeeManager.deleteEmployee('${employee.id}', '${employee.first_name} ${employee.last_name}')" 
                                class="action-btn p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all" title="${deleteText}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
        }).join('');
    }

    renderEmployeeGrid() {
        const gridBody = document.getElementById('employeeGridBody');
        if (!gridBody) return;
        const effectivePerPage = this.getEffectiveItemsPerPage();

        if (this.employees.length === 0) {
            const noEmployeesText = typeof translate === 'function' ? translate('employee.no_employees_found') : 'No employees found';
            const tryAdjustingText = typeof translate === 'function' ? translate('employee.try_adjusting_search') : 'Try adjusting your search criteria';
            gridBody.innerHTML = `
                <div class="col-span-full text-center py-16">
                    <div class="flex flex-col items-center justify-center">
                        <div class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <i class="fas fa-users text-3xl text-gray-400"></i>
                        </div>
                        <p class="text-lg font-medium text-gray-700 mb-2">${noEmployeesText}</p>
                        ${this.searchTerm ? `<p class="text-sm text-gray-500">${tryAdjustingText}</p>` : ''}
                    </div>
                </div>
            `;
            return;
        }

        const startIndex = (this.currentPage - 1) * effectivePerPage;
        const endIndex = startIndex + effectivePerPage;
        const paginatedEmployees = this.employees.slice(startIndex, endIndex);

        const activeText = typeof translate === 'function' ? translate('employee.active') : 'Active';
        const inactiveText = typeof translate === 'function' ? translate('employee.inactive') : 'Inactive';
        const viewText = typeof translate === 'function' ? translate('employee.view') : 'View';
        const editText = typeof translate === 'function' ? translate('employee.edit') : 'Edit';
        const deleteText = typeof translate === 'function' ? translate('employee.delete') : 'Delete';
        const atsText = typeof translate === 'function' ? translate('employee.generate_ats') : 'Generate Attestation de Travail';
        const certificatText = typeof translate === 'function' ? translate('employee.generate_certificat') : 'Generate Certificat de Travail';
        const noPositionText = typeof translate === 'function' ? translate('common.no_position') : 'No position';

        gridBody.innerHTML = paginatedEmployees.map(employee => {
            const isActive = this.isEmployeeActive(employee);
            return `
            <div class="employee-card bg-white rounded-xl p-6">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex items-center flex-1">
                        <div class="h-14 w-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mr-4 shadow-md flex-shrink-0">
                            <span class="text-white text-lg font-semibold">
                                ${(employee.first_name?.[0] || '').toUpperCase()}${(employee.last_name?.[0] || '').toUpperCase()}
                            </span>
                        </div>
                        <div class="flex-1 min-w-0">
                            <h3 class="font-semibold text-gray-900 text-base truncate">${employee.first_name || ''} ${employee.last_name || ''}</h3>
                            ${employee.username ? `<p class="text-sm text-gray-500 truncate">@${employee.username}</p>` : ''}
                        </div>
                    </div>
                    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${
                        isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }">
                        <span class="w-1.5 h-1.5 rounded-full mr-1.5 ${
                            isActive ? 'bg-green-500' : 'bg-red-500'
                        }"></span>
                        ${isActive ? activeText : inactiveText}
                    </span>
                </div>
                
                <div class="space-y-2 mb-4">
                    <div class="flex items-center text-sm text-gray-600">
                        <i class="fas fa-envelope text-gray-400 mr-2 w-4"></i>
                        <span class="truncate">${employee.email || '-'}</span>
                    </div>
                    <div class="flex items-center text-sm text-gray-600">
                        <i class="fas fa-briefcase text-gray-400 mr-2 w-4"></i>
                        <span class="truncate">${employee.position_name || noPositionText}</span>
                    </div>
                    <div class="flex items-center text-sm">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            ${employee.role || '-'}
                        </span>
                    </div>
                </div>
                
                <div class="flex items-center justify-end space-x-2 pt-4 border-t border-gray-200">
                    <button onclick="employeeManager.viewEmployee('${employee.id}')" 
                            class="action-btn p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="${viewText}">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button onclick="employeeManager.editEmployee('${employee.id}')" 
                            class="action-btn p-2 text-green-600 hover:bg-green-50 rounded-lg transition-all" title="${editText}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="employeeManager.generateATS('${employee.id}')" 
                            class="action-btn p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-all ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}" 
                            ${!isActive ? 'disabled' : ''}
                            title="${atsText}">
                        <i class="fas fa-file-pdf"></i>
                    </button>
                    <button onclick="employeeManager.generateCertificat('${employee.id}')" 
                            class="action-btn p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all ${isActive ? 'opacity-50 cursor-not-allowed' : ''}" 
                            ${isActive ? 'disabled' : ''}
                            title="${certificatText}">
                        <i class="fas fa-file-contract"></i>
                    </button>
                    <button onclick="employeeManager.deleteEmployee('${employee.id}', '${employee.first_name} ${employee.last_name}')" 
                            class="action-btn p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all" title="${deleteText}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        }).join('');
    }

    updatePagination() {
        const effectivePerPage = this.getEffectiveItemsPerPage();
        const totalPages = Math.ceil(this.employees.length / effectivePerPage);
        const paginationContainer = document.getElementById('pagination');
        const summaryEl = document.getElementById('paginationSummary');
        const rowsSelect = document.getElementById('rowsPerPageSelect');

        const showingText = typeof translate === 'function' ? translate('employee.showing') : 'Showing';
        const toText = typeof translate === 'function' ? translate('employee.to') : 'to';
        const ofText = typeof translate === 'function' ? translate('employee.of') : 'of';
        const employeesText = typeof translate === 'function' ? translate('employee.employees') : 'employees';
        const start = this.employees.length === 0 ? 0 : (this.currentPage - 1) * effectivePerPage + 1;
        const end = Math.min(this.currentPage * effectivePerPage, this.employees.length);

        if (summaryEl) {
            summaryEl.textContent = '';
            summaryEl.innerHTML = `${showingText} <span class="font-bold text-gray-900">${start}</span> ${toText} <span class="font-bold text-gray-900">${end}</span> ${ofText} <span class="font-bold text-gray-900">${this.employees.length}</span> ${employeesText}`;
        }

        if (rowsSelect) {
            const val = this.itemsPerPage <= 0 ? 'all' : String(this.itemsPerPage);
            if (rowsSelect.value !== val) rowsSelect.value = val;
        }

        if (!paginationContainer) return;
        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
            return;
        }

        let paginationHTML = '';
        const previousText = typeof translate === 'function' ? translate('employee.previous') : 'Previous';
        paginationHTML += `
            <button onclick="employeeManager.goToPage(${this.currentPage - 1})" 
                    ${this.currentPage === 1 ? 'disabled' : ''} 
                    class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-l-lg hover:bg-gray-50 transition-colors ${this.currentPage === 1 ? 'cursor-not-allowed opacity-50' : ''}">
                <i class="fas fa-chevron-left mr-1"></i>
                ${previousText}
            </button>
        `;

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= this.currentPage - 2 && i <= this.currentPage + 2)) {
                paginationHTML += `
                    <button onclick="employeeManager.goToPage(${i})" 
                            class="px-4 py-2 text-sm font-medium border transition-colors ${
                                i === this.currentPage 
                                    ? 'text-white bg-blue-600 border-blue-600' 
                                    : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
                            }">
                        ${i}
                    </button>
                `;
            } else if (i === this.currentPage - 3 || i === this.currentPage + 3) {
                paginationHTML += `<span class="px-4 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300">...</span>`;
            }
        }

        const nextText = typeof translate === 'function' ? translate('employee.next') : 'Next';
        paginationHTML += `
            <button onclick="employeeManager.goToPage(${this.currentPage + 1})" 
                    ${this.currentPage === totalPages ? 'disabled' : ''} 
                    class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-r-lg hover:bg-gray-50 transition-colors ${this.currentPage === totalPages ? 'cursor-not-allowed opacity-50' : ''}">
                ${nextText}
                <i class="fas fa-chevron-right ml-1"></i>
            </button>
        `;

        paginationContainer.innerHTML = paginationHTML;
    }

    goToPage(page) {
        const effectivePerPage = this.getEffectiveItemsPerPage();
        const totalPages = Math.ceil(this.employees.length / effectivePerPage);
        if (page >= 1 && page <= totalPages) {
            this.currentPage = page;
            const currentView = document.getElementById('tableView').classList.contains('hidden') ? 'grid' : 'table';
            if (currentView === 'table') {
            this.renderEmployeeTable();
            } else {
                this.renderEmployeeGrid();
            }
            this.updatePagination();
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    toggleView(viewType) {
        const tableView = document.getElementById('tableView');
        const gridView = document.getElementById('gridView');
        const tableViewBtn = document.getElementById('tableViewBtn');
        const gridViewBtn = document.getElementById('gridViewBtn');

        if (viewType === 'table') {
            tableView.classList.remove('hidden');
            gridView.classList.add('hidden');
            tableViewBtn.classList.add('active');
            gridViewBtn.classList.remove('active');
            this.renderEmployeeTable();
        } else {
            tableView.classList.add('hidden');
            gridView.classList.remove('hidden');
            tableViewBtn.classList.remove('active');
            gridViewBtn.classList.add('active');
            this.renderEmployeeGrid();
        }
    }

    search(term) {
        this.filterEmployees(term, this.sortBy, this.branchFilter);
    }

    sort(field) {
        this.filterEmployees(this.searchTerm, field, this.branchFilter);
    }

    async viewEmployee(id) {
        try {
            const employee = await APIService.getEmployee(id);
            this.showEmployeeModal(employee, 'view');
        } catch (error) {
            console.error('Error loading employee:', error);
            const errorText = typeof translate === 'function' ? translate('employee.failed_to_load_employee_details') : 'Failed to load employee details';
            Utils.showNotification(errorText, 'error');
        }
    }

    async editEmployee(id) {
        window.location.href = `add-employee.html?id=${id}`;
    }

    showEmployeeModal(employee, mode = 'view') {
        const isEditable = mode === 'edit';
        const editEmployeeText = typeof translate === 'function' ? translate('employee.edit_employee') : 'Edit Employee';
        const employeeDetailsText = typeof translate === 'function' ? translate('employee.employee_details') : 'Employee Details';
        const modalTitle = isEditable ? editEmployeeText : employeeDetailsText;
        
        // Get translated labels
        const firstNameLabel = typeof translate === 'function' ? translate('employee.first_name') : 'First Name';
        const lastNameLabel = typeof translate === 'function' ? translate('employee.last_name') : 'Last Name';
        const emailLabel = typeof translate === 'function' ? translate('employee.email') : 'Email';
        const phoneLabel = typeof translate === 'function' ? translate('employee.phone') : 'Phone';
        const positionLabel = typeof translate === 'function' ? translate('employee.position') : 'Position';
        const roleLabel = typeof translate === 'function' ? translate('employee.role') : 'Role';
        const joinDateLabel = typeof translate === 'function' ? translate('employee.join_date') : 'Join Date';
        const statusLabel = typeof translate === 'function' ? translate('common.status') : 'Status';
        const activeText = typeof translate === 'function' ? translate('employee.active') : 'Active';
        const inactiveText = typeof translate === 'function' ? translate('employee.inactive') : 'Inactive';
        
        const modalContent = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${firstNameLabel}</label>
                        <input type="text" value="${employee.first_name || ''}" ${isEditable ? '' : 'readonly'} 
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md ${isEditable ? 'focus:outline-none focus:ring-blue-500 focus:border-blue-500' : 'bg-gray-50'}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${lastNameLabel}</label>
                        <input type="text" value="${employee.last_name || ''}" ${isEditable ? '' : 'readonly'} 
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md ${isEditable ? 'focus:outline-none focus:ring-blue-500 focus:border-blue-500' : 'bg-gray-50'}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${emailLabel}</label>
                        <input type="email" value="${employee.email || ''}" ${isEditable ? '' : 'readonly'} 
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md ${isEditable ? 'focus:outline-none focus:ring-blue-500 focus:border-blue-500' : 'bg-gray-50'}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${phoneLabel}</label>
                        <input type="text" value="${employee.phone || ''}" ${isEditable ? '' : 'readonly'} 
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md ${isEditable ? 'focus:outline-none focus:ring-blue-500 focus:border-blue-500' : 'bg-gray-50'}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${positionLabel}</label>
                        <input type="text" value="${employee.position_name || ''}" readonly 
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${roleLabel}</label>
                        <input type="text" value="${employee.role || ''}" readonly 
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${joinDateLabel}</label>
                        <input type="text" value="${employee.join_date ? Utils.formatDate(employee.join_date) : ''}" readonly 
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${statusLabel}</label>
                        <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${this.isEmployeeActive(employee) ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            ${this.isEmployeeActive(employee) ? activeText : inactiveText}
                        </span>
                    </div>
                </div>
            </div>
        `;

        const saveChangesText = typeof translate === 'function' ? translate('common.save_changes') : 'Save Changes';
        const actions = isEditable ? [
            {
                text: saveChangesText,
                class: 'bg-blue-600 text-white',
                onclick: `employeeManager.saveEmployee('${employee.id}')`
            }
        ] : [];

        Utils.showModal(modalTitle, modalContent, actions);
    }

    async deleteEmployee(id, name) {
        const confirmText = typeof translate === 'function' ? translate('employee.delete_employee_confirm').replace('{name}', name) : `Are you sure you want to delete employee "${name}"? This action cannot be undone.`;
        if (!confirm(confirmText)) {
            return;
        }

        try {
            await APIService.deleteEmployee(id);
            const successText = typeof translate === 'function' ? translate('employee.employee_deleted_successfully') : 'Employee deleted successfully';
            Utils.showNotification(successText, 'success');
            this.loadEmployees();
        } catch (error) {
            console.error('Error deleting employee:', error);
            
            // Handle authentication errors specially
            if (error.message && (error.message.includes('Authentication required') || error.status === 401)) {
                const authErrorText = typeof translate === 'function' 
                    ? translate('employee.authentication_required') || 'Your session has expired. Please log in again.'
                    : 'Your session has expired. Please log in again.';
                Utils.showNotification(authErrorText, 'error');
                
                // Redirect to login after a short delay
                setTimeout(() => {
                    if (window.authManager) {
                        window.authManager.logout();
                    }
                }, 2000);
            } else {
                const errorText = typeof translate === 'function' ? translate('employee.failed_to_delete_employee') : 'Failed to delete employee';
                Utils.showNotification(errorText, 'error');
            }
        }
    }

    async exportEmployees() {
        try {
            const data = this.employees.map(emp => ({
                'First Name': emp.first_name || '',
                'Last Name': emp.last_name || '',
                'Email': emp.email || '',
                'Phone': emp.phone || '',
                'Position': emp.position_name || '',
                'Role': emp.role || '',
                'Join Date': emp.join_date ? Utils.formatDate(emp.join_date) : '',
                'Status': emp.user_id ? 'Active' : 'Inactive'
            }));

            await Utils.exportToCSV(data, `employees_${new Date().toISOString().split('T')[0]}.csv`);
        } catch (error) {
            console.error('Error exporting employees:', error);
            Utils.showNotification('Failed to export employees', 'error');
        }
    }

    isEmployeeActive(employee) {
        // Check if employee has an active contract
        if (employee.contract_end_date) {
            const endDate = new Date(employee.contract_end_date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            endDate.setHours(0, 0, 0, 0);
            // Contract is active if end_date is today or in the future
            // Contract is inactive if end_date is in the past
            return endDate >= today;
        }
        // If no end_date, consider active if they have a user_id or contract_is_active is true
        if (employee.contract_is_active !== undefined) {
            return employee.contract_is_active;
        }
        return !!employee.user_id;
    }

    async generateATS(employeeId) {
        try {
            // Check if employee is active
            const employee = this.employees.find(emp => emp.id === employeeId) || 
                           this.allEmployees.find(emp => emp.id === employeeId);
            
            if (!this.isEmployeeActive(employee)) {
                const disabledText = typeof translate === 'function' ? translate('employee.ats_disabled_for_inactive') : 'Attestation de Travail can only be generated for active employees';
                Utils.showNotification(disabledText, 'warning');
                return;
            }
            
            const loadingText = typeof translate === 'function' ? translate('employee.generating_ats') : 'Generating Attestation de Travail...';
            Utils.showNotification(loadingText, 'info');
            
            // Get API services from main.js
            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : {
                users: 'http://localhost:3002'
            };
            
            const response = await authManager.makeAuthenticatedRequest(
                `${apiServices.users}/employees/${employeeId}/generate-ats`,
                { method: 'GET' }
            );

            if (!response.ok) {
                throw new Error('Failed to generate ATS');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `attestation_travail_${employeeId}_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            const successText = typeof translate === 'function' ? translate('employee.ats_generated_successfully') : 'Attestation de Travail generated successfully';
            Utils.showNotification(successText, 'success');
        } catch (error) {
            console.error('Error generating ATS:', error);
            const errorText = typeof translate === 'function' ? translate('employee.failed_to_generate_ats') : 'Failed to generate Attestation de Travail';
            Utils.showNotification(errorText, 'error');
        }
    }

    async generateATSZip() {
        try {
            const loadingText = typeof translate === 'function' ? translate('employee.generating_ats_zip') : 'Generating ATS ZIP for all active employees...';
            Utils.showNotification(loadingText, 'info');
            
            // Get API services from main.js
            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : {
                users: 'http://localhost:3002'
            };
            
            const response = await authManager.makeAuthenticatedRequest(
                `${apiServices.users}/employees/generate-ats-zip`,
                { method: 'GET' }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to generate ATS ZIP');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const today = new Date().toISOString().split('T')[0];
            a.download = `ats_all_active_employees_${today}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            const successText = typeof translate === 'function' ? translate('employee.ats_zip_generated_successfully') : 'ATS ZIP generated successfully';
            Utils.showNotification(successText, 'success');
        } catch (error) {
            console.error('Error generating ATS ZIP:', error);
            const errorText = typeof translate === 'function' ? translate('employee.failed_to_generate_ats_zip') : 'Failed to generate ATS ZIP';
            Utils.showNotification(errorText, 'error');
        }
    }

    async downloadImportTemplate() {
        try {
            const loadingText = typeof translate === 'function' ? translate('employee.downloading_template') : 'Downloading template...';
            Utils.showNotification(loadingText, 'info');
            
            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : {
                users: 'http://localhost:3002'
            };
            
            const response = await authManager.makeAuthenticatedRequest(
                `${apiServices.users}/employees/import-template`,
                { method: 'GET' }
            );

            if (!response.ok) {
                throw new Error('Failed to download template');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'employee_import_template.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            const successText = typeof translate === 'function' ? translate('employee.template_downloaded') : 'Template downloaded successfully';
            Utils.showNotification(successText, 'success');
        } catch (error) {
            console.error('Error downloading template:', error);
            const errorText = typeof translate === 'function' ? translate('employee.failed_to_download_template') : 'Failed to download template';
            Utils.showNotification(errorText, 'error');
        }
    }

    async importEmployees(file) {
        try {
            if (!file) {
                const errorText = typeof translate === 'function' ? translate('employee.no_file_selected') : 'Please select a file';
                Utils.showNotification(errorText, 'error');
                return;
            }

            const loadingText = typeof translate === 'function' ? translate('employee.importing_employees') : 'Importing employees...';
            Utils.showNotification(loadingText, 'info');

            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : {
                users: 'http://localhost:3002'
            };

            const formData = new FormData();
            formData.append('excel_file', file);

            const token = localStorage.getItem('token');
            const response = await fetch(`${apiServices.users}/employees/import`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to import employees');
            }

            const result = await response.json();
            
            // Show detailed results
            let message = result.message || 'Import completed';
            if (result.results && result.results.success.length > 0) {
                message += `\n\nSuccessfully imported ${result.results.success.length} employees:\n`;
                result.results.success.forEach(item => {
                    message += `- ${item.employee}: Username: ${item.username}, Password: ${item.password}\n`;
                });
            }
            if (result.results && result.results.errors.length > 0) {
                message += `\n\nErrors (${result.results.errors.length}):\n`;
                result.results.errors.forEach(item => {
                    message += `- Row ${item.row}: ${item.error}\n`;
                });
            }

            // Show notification with details
            Utils.showNotification(message, result.results.errors.length > 0 ? 'warning' : 'success');
            
            // Reload employees list
            await this.loadEmployees();
        } catch (error) {
            console.error('Error importing employees:', error);
            const errorText = typeof translate === 'function' ? translate('employee.failed_to_import') : 'Failed to import employees';
            Utils.showNotification(`${errorText}: ${error.message}`, 'error');
        }
    }

    async exportWithCredentials() {
        try {
            const loadingText = typeof translate === 'function' ? translate('employee.exporting_credentials') : 'Exporting employees with credentials...';
            Utils.showNotification(loadingText, 'info');
            
            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : {
                users: 'http://localhost:3002'
            };
            
            const response = await authManager.makeAuthenticatedRequest(
                `${apiServices.users}/employees/export-with-credentials`,
                { method: 'GET' }
            );

            if (!response.ok) {
                throw new Error('Failed to export employees');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const today = new Date().toISOString().split('T')[0];
            a.download = `employees_export_${today}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            const successText = typeof translate === 'function' ? translate('employee.exported_successfully') : 'Employees exported successfully';
            Utils.showNotification(successText, 'success');
        } catch (error) {
            console.error('Error exporting employees:', error);
            const errorText = typeof translate === 'function' ? translate('employee.failed_to_export') : 'Failed to export employees';
            Utils.showNotification(errorText, 'error');
        }
    }

    async generateCertificat(employeeId) {
        try {
            // Check if employee is active
            const employee = this.employees.find(emp => emp.id === employeeId) || 
                           this.allEmployees.find(emp => emp.id === employeeId);
            
            if (this.isEmployeeActive(employee)) {
                const disabledText = typeof translate === 'function' ? translate('employee.certificat_disabled_for_active') : 'Certificat de Travail can only be generated for inactive employees';
                Utils.showNotification(disabledText, 'warning');
                return;
            }

            const loadingText = typeof translate === 'function' ? translate('employee.generating_certificat') : 'Generating Certificat de Travail...';
            Utils.showNotification(loadingText, 'info');
            
            // Get API services from main.js
            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : {
                users: 'http://localhost:3002'
            };
            
            const response = await authManager.makeAuthenticatedRequest(
                `${apiServices.users}/employees/${employeeId}/generate-certificat`,
                { method: 'GET' }
            );

            if (!response.ok) {
                throw new Error('Failed to generate Certificat');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `certificat_travail_${employeeId}_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            const successText = typeof translate === 'function' ? translate('employee.certificat_generated_successfully') : 'Certificat de Travail generated successfully';
            Utils.showNotification(successText, 'success');
        } catch (error) {
            console.error('Error generating Certificat:', error);
            const errorText = typeof translate === 'function' ? translate('employee.failed_to_generate_certificat') : 'Failed to generate Certificat de Travail';
            Utils.showNotification(errorText, 'error');
        }
    }

    async loadDashboardStats() {
        try {
            const stats = await APIService.request('users', '/dashboard/stats');
            this.updateDashboardCards(stats);
        } catch (error) {
            console.error('Error loading dashboard stats:', error);
        }
    }

    updateDashboardCards(stats) {
        // Update total employees
        const totalEmployeesCard = document.getElementById('totalEmployees');
        if (totalEmployeesCard) {
            totalEmployeesCard.textContent = stats.totalEmployees || 0;
        }

        // Update active employees
        const activeEmployeesCard = document.getElementById('activeEmployees');
        if (activeEmployeesCard) {
            activeEmployeesCard.textContent = stats.activeEmployees || 0;
        }

        // Update department breakdown
        const departmentBreakdown = document.getElementById('departmentBreakdown');
        if (departmentBreakdown && stats.departmentBreakdown) {
            departmentBreakdown.innerHTML = stats.departmentBreakdown.map(dept => `
                <div class="flex justify-between items-center py-2">
                    <span class="text-sm text-gray-600">${dept.name}</span>
                    <span class="text-sm font-medium text-gray-900">${dept.count}</span>
                </div>
            `).join('');
        }

        // Update position breakdown
        const positionBreakdown = document.getElementById('positionBreakdown');
        if (positionBreakdown && stats.positionBreakdown) {
            positionBreakdown.innerHTML = stats.positionBreakdown.map(pos => `
                <div class="flex justify-between items-center py-2">
                    <span class="text-sm text-gray-600">${pos.name}</span>
                    <span class="text-sm font-medium text-gray-900">${pos.count}</span>
                </div>
            `).join('');
        }
    }
}

// Global instance
const employeeManager = new EmployeeManager();

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on an employee-related page
    if (window.location.pathname.includes('employees') || window.location.pathname.includes('dashboard')) {
        employeeManager.loadPositions();
        
        if (window.location.pathname.includes('employees')) {
            employeeManager.loadEmployees();
        }
        
        if (window.location.pathname.includes('dashboard')) {
            employeeManager.loadDashboardStats();
        }
    }

    // Setup search functionality
    const searchInput = document.getElementById('employeeSearch');
    if (searchInput) {
        searchInput.addEventListener('input', Utils.debounce(function() {
            employeeManager.search(this.value);
        }, 300));
    }

    // Setup sort functionality
    const sortSelect = document.getElementById('employeeSort');
    if (sortSelect) {
        sortSelect.addEventListener('change', function() {
            employeeManager.sort(this.value);
        });
    }

    // Setup export functionality
    const exportButton = document.getElementById('exportEmployees');
    if (exportButton) {
        exportButton.addEventListener('click', function() {
            employeeManager.exportEmployees();
        });
    }

    // Setup ATS ZIP generation
    const generateATSZipButton = document.getElementById('generateATSZip');
    if (generateATSZipButton) {
        generateATSZipButton.addEventListener('click', function() {
            employeeManager.generateATSZip();
        });
    }

    const downloadTemplateButton = document.getElementById('downloadImportTemplate');
    if (downloadTemplateButton) {
        downloadTemplateButton.addEventListener('click', function() {
            employeeManager.downloadImportTemplate();
        });
    }

    const importEmployeesButton = document.getElementById('importEmployees');
    const excelFileInput = document.getElementById('excelFileInput');
    if (importEmployeesButton && excelFileInput) {
        importEmployeesButton.addEventListener('click', function() {
            excelFileInput.click();
        });
        excelFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                employeeManager.importEmployees(file);
                // Reset input
                e.target.value = '';
            }
        });
    }

    const exportWithCredentialsButton = document.getElementById('exportWithCredentials');
    if (exportWithCredentialsButton) {
        exportWithCredentialsButton.addEventListener('click', function() {
            employeeManager.exportWithCredentials();
        });
    }

    const rowsPerPageSelect = document.getElementById('rowsPerPageSelect');
    if (rowsPerPageSelect) {
        rowsPerPageSelect.addEventListener('change', function() {
            const val = this.value;
            employeeManager.itemsPerPage = val === 'all' ? 0 : parseInt(val, 10);
            employeeManager.currentPage = 1;
            employeeManager.renderEmployeeTable();
            employeeManager.renderEmployeeGrid();
            employeeManager.updatePagination();
            employeeManager.updateEmployeeCount();
        });
    }
});

