// Direct DOM-based KPI Statistics Script
// This script fetches task data directly from the API and updates detailed statistics

(function () {
    console.log('✅ Direct DOM KPI script loaded');

    // Hide Responsibles card
    const style = document.createElement('style');
    style.textContent = `
        .kpi-card:has(#kpiResponsibles) { display: none !important; }
        #kpiResponsibles { display: none !important; }
    `;
    document.head.appendChild(style);

    // Function to fetch and update statistics
    async function updateDetailedStats() {
        try {
            // Get API base URL
            const API = window.API || '';

            // Fetch tasks directly from API
            const response = await fetch(`${API}/tasks`);
            if (!response.ok) {
                console.error('Failed to fetch tasks:', response.status);
                return;
            }

            const allTasks = await response.json();
            console.log('📊 Fetched tasks:', allTasks.length);

            // Get director ID - try multiple methods
            let directorId = null;

            // Method 1: Try getDirectorEmployeeId function (used by original code)
            if (typeof getDirectorEmployeeId === 'function') {
                directorId = getDirectorEmployeeId();
                console.log('👤 Director ID from getDirectorEmployeeId():', directorId);
            }

            // Method 2: Try window.parent.authManager
            if (!directorId) {
                try {
                    if (window.parent && window.parent.authManager) {
                        const empId = window.parent.authManager.getEmployeeId();
                        if (empId) {
                            directorId = empId;
                            console.log('👤 Director ID from parent.authManager:', directorId);
                        }
                    }
                } catch (e) {
                    console.warn('Could not access parent.authManager:', e);
                }
            }

            // Method 3: Try localStorage
            if (!directorId) {
                const storedEmpId = localStorage.getItem('employee_id');
                if (storedEmpId) {
                    directorId = storedEmpId;
                    console.log('👤 Director ID from localStorage:', directorId);
                }
            }

            // Method 4: Try to extract from tasks (tasks have assigned_by field)
            if (!directorId && allTasks.length > 0) {
                // Look at the main KPI to see how many tasks the director created
                const myTasksEl = document.getElementById('kpiMyTasks');
                const myTasksCount = myTasksEl ? parseInt(myTasksEl.textContent) : 0;

                if (myTasksCount > 0) {
                    // Find the most common assigned_by ID (likely the director)
                    const assignedByCounts = {};
                    allTasks.forEach(t => {
                        if (t.assigned_by) {
                            assignedByCounts[t.assigned_by] = (assignedByCounts[t.assigned_by] || 0) + 1;
                        }
                    });

                    // Get the ID with most assignments
                    let maxCount = 0;
                    for (const [id, count] of Object.entries(assignedByCounts)) {
                        if (count > maxCount) {
                            maxCount = count;
                            directorId = id;
                        }
                    }
                    console.log('👤 Director ID inferred from tasks:', directorId, 'with', maxCount, 'tasks');
                }
            }

            console.log('👤 Final Director ID:', directorId);

            // Helper function to check if task is overdue
            function isOverdue(task) {
                if (!task || task.status === 'Completed') return false;
                if (!task.due_date) return false;
                return new Date(task.due_date) < new Date();
            }

            // Filter tasks (excluding instructions since they're in a separate endpoint)
            const myTasksList = directorId
                ? allTasks.filter(t => String(t.assigned_by) === String(directorId))
                : [];

            // Fetch instructions from separate endpoint
            let myInstructionsList = [];
            if (directorId) {
                try {
                    const instrResponse = await fetch(`${API}/api/instructions/created-by/${directorId}`);
                    if (instrResponse.ok) {
                        const instrData = await instrResponse.json();
                        // Handle different response formats
                        if (Array.isArray(instrData)) {
                            myInstructionsList = instrData;
                        } else if (instrData && Array.isArray(instrData.data)) {
                            myInstructionsList = instrData.data;
                        } else if (instrData && Array.isArray(instrData.instructions)) {
                            myInstructionsList = instrData.instructions;
                        } else {
                            console.warn('Unexpected instructions response format:', instrData);
                            myInstructionsList = [];
                        }
                        console.log('📢 Fetched instructions:', myInstructionsList.length);
                    } else {
                        console.warn('Instructions API returned:', instrResponse.status);
                    }
                } catch (e) {
                    console.warn('Could not fetch instructions:', e);
                }
            }

            // Calculate All Tasks statistics
            const allCompleted = allTasks.filter(t => t.status === 'Completed').length;
            const allInProgress = allTasks.filter(t => t.status === 'In Progress').length;
            const allOverdue = allTasks.filter(t => isOverdue(t)).length;

            // Calculate My Tasks statistics
            const myCompleted = myTasksList.filter(t => t.status === 'Completed').length;
            const myActive = myTasksList.filter(t => t.status === 'In Progress').length;
            const myPending = myTasksList.filter(t => t.status === 'Pending').length;

            // Calculate Instructions statistics (simplified)
            const instrSent = myInstructionsList.length; // Total instructions sent
            let instrRecipients = 0;
            myInstructionsList.forEach(instr => {
                const recipients = instr.recipients || instr.assignees || [];
                instrRecipients += Array.isArray(recipients) ? recipients.length : 0;
            });

            // Fetch departments and employees for organizational stats
            let deptCount = 0, empCount = 0, respCount = 0;
            try {
                const deptRes = await fetch(`${API}/departments`);
                if (deptRes.ok) {
                    const depts = await deptRes.json();
                    deptCount = Array.isArray(depts) ? depts.length : 0;
                }

                const empRes = await fetch(`${API}/employees`);
                if (empRes.ok) {
                    const emps = await empRes.json();
                    empCount = Array.isArray(emps) ? emps.length : 0;
                }

                // Get responsibles count from the main KPI (it's already calculated correctly)
                const respEl = document.getElementById('kpiResponsibles');
                if (respEl) respCount = parseInt(respEl.textContent) || 0;
            } catch (e) {
                console.warn('Error fetching organizational data:', e);
            }

            const coverage = deptCount > 0 ? Math.round((respCount / deptCount) * 100) : 0;

            // Update MAIN KPI Counters
            const elAllTasks = document.getElementById('kpiAllTasks');
            if (elAllTasks) elAllTasks.textContent = allTasks.length;

            const elMyTasks = document.getElementById('kpiMyTasks');
            if (elMyTasks) elMyTasks.textContent = myTasksList.length;

            const elMyInstructions = document.getElementById('kpiMyInstructions');
            if (elMyInstructions) elMyInstructions.textContent = instrSent;


            // Update All Tasks detailed stats
            const elAllCompleted = document.getElementById('kpiAllCompleted');
            if (elAllCompleted) elAllCompleted.textContent = allCompleted;
            const elAllInProgress = document.getElementById('kpiAllInProgress');
            if (elAllInProgress) elAllInProgress.textContent = allInProgress;
            const elAllOverdue = document.getElementById('kpiAllOverdue');
            if (elAllOverdue) elAllOverdue.textContent = allOverdue;

            // Update My Tasks detailed stats
            const elMyCompleted = document.getElementById('kpiMyCompleted');
            if (elMyCompleted) elMyCompleted.textContent = myCompleted;
            const elMyActive = document.getElementById('kpiMyActive');
            if (elMyActive) elMyActive.textContent = myActive;
            const elMyPending = document.getElementById('kpiMyPending');
            if (elMyPending) elMyPending.textContent = myPending;

            // Update Instructions detailed stats (simplified)
            const elInstrSent = document.getElementById('kpiInstrSent');
            if (elInstrSent) elInstrSent.textContent = instrSent;
            const elInstrRecipients = document.getElementById('kpiInstrRecipients');
            if (elInstrRecipients) elInstrRecipients.textContent = instrRecipients;

            // Update Responsibles detailed stats (simplified - only departments)
            const elDepartments = document.getElementById('kpiDepartments');
            if (elDepartments) elDepartments.textContent = deptCount;

            console.log('✅ Detailed KPI Statistics Updated:', {
                allTasks: { total: allTasks.length, completed: allCompleted, inProgress: allInProgress, overdue: allOverdue },
                myTasks: { total: myTasksList.length, completed: myCompleted, active: myActive, pending: myPending },
                instructions: { total: myInstructionsList.length, sent: instrSent, recipients: instrRecipients },
                organization: { responsibles: respCount, departments: deptCount, employees: empCount, coverage: `${coverage}%` }
            });

        } catch (error) {
            console.error('❌ Error updating detailed stats:', error);
        }
    }

    // Wait for page to load and main KPIs to be populated
    setTimeout(updateDetailedStats, 3000);

    // Also retry periodically
    setInterval(updateDetailedStats, 10000);

})();
