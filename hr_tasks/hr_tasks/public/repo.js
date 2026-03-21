function createReportsHTML() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Task Reports</title>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
            .filter-button {
                padding: 0.5rem 1rem;
                border: 1px solid #d1d5db;
                border-radius: 0.5rem;
                transition: background-color 0.2s;
                cursor: pointer;
            }
            .filter-button:hover {
                background-color: #f9fafb;
            }
            .filter-button.active {
                background-color: #2563eb;
                color: white;
                border-color: #2563eb;
            }
            .stats-card {
                background: white;
                border-radius: 0.5rem;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                padding: 1.5rem;
                border-left: 4px solid transparent;
            }
            .stats-card.total { border-left-color: #3B82F6; }
            .stats-card.completed { border-left-color: #10B981; }
            .stats-card.progress { border-left-color: #F59E0B; }
            .stats-card.overdue { border-left-color: #EF4444; }

            /* Global modal scrollbar and task section scroll styles */
            .custom-scrollbar::-webkit-scrollbar { width: 8px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 3px; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

            .task-section-scroll { max-height: 300px; overflow-y: auto; padding-right: 8px; margin-right: -8px; }
            .task-section-scroll::-webkit-scrollbar { width: 6px; }
            .task-section-scroll::-webkit-scrollbar-track { background: #f8fafc; border-radius: 3px; }
            .task-section-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 3px; }
            .task-section-scroll::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }

            /* Modal enter animation */
            #employeeDetailsModal:not(.hidden) > div { animation: modalSlideIn 0.3s ease-out; }
            @keyframes modalSlideIn {
                from { opacity: 0; transform: scale(0.9) translateY(20px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .task-card { transition: all 0.2s ease; }
            .task-card:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        </style>
    </head>
    <body class="bg-gray-50 h-screen flex flex-col">
        
        <!-- Header -->
        <div class="flex-shrink-0 p-6 bg-gray-50">
            <button onclick="closeReports()" 
                class="mb-4 px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg">
              ← Back to Dashboard
            </button>

            <div class="max-w-7xl mx-auto">
                <div class="mb-6">
                    <h1 class="text-3xl font-bold text-gray-900">Task Reports</h1>
                    <p class="text-gray-600">Analyse des performances des tâches</p>
                </div>

                <!-- Filtres temporels -->
                <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
                    <h2 class="text-lg font-semibold mb-4">Filtres temporels</h2>
                    <div class="flex flex-wrap gap-2 mb-4">
                        <button class="filter-button active" data-period="today">Today</button>
                        <button class="filter-button" data-period="week">This Week</button>
                        <button class="filter-button" data-period="month">This Month</button>
                        <button class="filter-button" data-period="year">This Year</button>
                        <button class="filter-button" data-period="custom">Custom</button>
                    </div>
                    
                    <div id="customDateRange" class="hidden">
                        <div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">From</label>
                                <input type="date" id="dateFrom" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">To</label>
                                <input type="date" id="dateTo" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">&nbsp;</label>
                                <button id="applyFilter" class="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Apply Filter</button>
                            </div>
                        </div>
                    </div>

                    <!-- Filtre par type de tâche -->
                    <div class="mt-6">
                        <h3 class="text-sm font-medium text-gray-800 mb-2">Filtrer par type</h3>
                        <div class="flex flex-wrap gap-2" id="typeFilters">
                            <button class="filter-button active" data-type="all">Tous</button>
                            <button class="filter-button" data-type="daily">Daily</button>
                            <button class="filter-button" data-type="special">Special</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
         
        <!-- Contenu -->
        <div class="flex-1 overflow-y-auto p-6">
            <div id="reportsContent" class="max-w-7xl mx-auto"></div>
        </div>

        <!-- Global Employee Details Modal (single instance) -->
        <div id="employeeDetailsModal" class="hidden fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-4xl w-full flex flex-col transform transition-all duration-300" style="height:90vh;">
                <div class="flex-shrink-0 flex items-center justify-between p-6 border-b border-gray-100">
                    <div class="flex items-center space-x-3">
                        <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                            <i class="fas fa-user text-white text-sm"></i>
                        </div>
                        <div>
                            <h3 id="modalTitle" class="text-xl font-bold text-gray-900">Détails Employé</h3>
                            <p class="text-sm text-gray-500">Performance et tâches assignées</p>
                        </div>
                    </div>
                    <button onclick="window.closeEmployeeDetails()" class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors duration-200 group">
                        <i class="fas fa-times text-gray-500 group-hover:text-gray-700 text-sm"></i>
                    </button>
                </div>
                <div class="flex-1 overflow-y-auto custom-scrollbar">
                    <div id="modalContent" class="p-6 space-y-6"></div>
                </div>
                <div class="flex-shrink-0 flex justify-end p-6 border-t border-gray-100 bg-gray-50/50">
                    <button onclick="window.closeEmployeeDetails()" class="px-6 py-2.5 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm">
                        <i class="fas fa-check mr-2"></i>
                        Fermer
                    </button>
                </div>
            </div>
        </div>

        <script src="reports.js"></script>
    </body>
    </html>`;
}

// Fonction pour initialiser les rapports
async function initializeReports(reportsWindow) {
    const reportsDoc = reportsWindow.document;

    try {
        reportsDoc.getElementById('reportsContent').innerHTML = `
            <div class="flex justify-center items-center h-64">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <span class="ml-3 text-gray-600">Chargement des données...</span>
            </div>
        `;

        const backendUrl = (location.origin && /^https?:\/\//i.test(location.origin)) ? location.origin : '';
        const response = await fetch(`${backendUrl}/api/reports/data`);

        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            reportsWindow.currentTasks = data.tasks;
            reportsWindow.currentEmployees = data.employees;
            // S'assurer que currentUser a un id en mode dev (param URL employee_id/user_id)
            const urlParams = new URLSearchParams(reportsWindow.location.search);
            const devId = urlParams.get('employee_id') || urlParams.get('user_id');
            if (devId && (!currentUser || !currentUser.id)) {
                reportsWindow.currentUser = { ...(currentUser || {}), id: devId, employee_id: devId };
            } else {
                reportsWindow.currentUser = currentUser; // ⚠️ Vérifie que currentUser est bien défini
            }

            // Si responsable de département, remplacer la liste des employés par la liste filtrée
            try {
                if (reportsWindow.currentUser && reportsWindow.currentUser.role === 'Department_Responsible') {
                    const responsibleId = reportsWindow.currentUser.employee_id || reportsWindow.currentUser.id;
                    if (responsibleId) {
                        const empRes = await fetch(`${backendUrl}/employees?responsible_id=${encodeURIComponent(responsibleId)}`);
                        if (empRes.ok) {
                            const filteredEmployees = await empRes.json();
                            if (Array.isArray(filteredEmployees) && filteredEmployees.length >= 0) {
                                reportsWindow.currentEmployees = filteredEmployees;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('Impossible de filtrer les employés côté rapports, utilisation de la liste complète', e);
            }

            // Event listeners pour les filtres
            reportsWindow.currentTypeFilter = 'all';
            const periodButtons = Array.from(reportsDoc.querySelectorAll('.filter-button[data-period]'));
            const typeButtons = Array.from(reportsDoc.querySelectorAll('.filter-button[data-type]'));

            periodButtons.forEach(button => {
                button.addEventListener('click', () => {
                    periodButtons.forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');

                    const period = button.dataset.period;
                    if (period === 'custom') {
                        reportsDoc.getElementById('customDateRange').classList.remove('hidden');
                    } else {
                        reportsDoc.getElementById('customDateRange').classList.add('hidden');
                        filterTasksByPeriod(reportsWindow, period);
                    }
                });
            });

            typeButtons.forEach(button => {
                button.addEventListener('click', () => {
                    typeButtons.forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                    reportsWindow.currentTypeFilter = button.dataset.type || 'all';
                    applyTypeFilter(reportsWindow, reportsWindow.currentTypeFilter);
                });
            });

            reportsDoc.getElementById('applyFilter').addEventListener('click', () => {
                const from = reportsDoc.getElementById('dateFrom').value;
                const to = reportsDoc.getElementById('dateTo').value;
                if (from && to) {
                    filterTasksByCustomRange(reportsWindow, from, to);
                }
            });

            // Initialiser avec "today"
            filterTasksByPeriod(reportsWindow, 'today');
        } else {
            throw new Error(data.error || 'Erreur inconnue du serveur');
        }
    } catch (error) {
        console.error('Error loading report data:', error);
        reportsDoc.getElementById('reportsContent').innerHTML = `
            <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                <strong class="font-bold">Erreur!</strong>
                <span class="block sm:inline"> Impossible de charger les données des rapports.</span>
                <p class="mt-2">Détail: ${error.message}</p>
                <button onclick="initializeReports(window.reportsWindow)" class="mt-3 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
                    Réessayer
                </button>
            </div>
        `;
    }

    // ----------- Modal : détails employé -----------

    // Helper global pour plier/déplier une section dans le modal
    window.toggleSection = function(sectionId) {
        const content = reportsDoc.getElementById(`section-${sectionId}`);
        const icon = reportsDoc.getElementById(`icon-${sectionId}`);
        if (!content || !icon) return;
        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            icon.textContent = '−';
        } else {
            content.classList.add('hidden');
            icon.textContent = '+';
        }
    };

    // Fonction pour afficher les détails d’un employé
    window.showEmployeeDetails = function(employeeId, employeeName) {
        const baseTasks = reportsWindow.currentFilteredTasks || reportsWindow.currentTasks || [];
        const tasks = baseTasks.filter(task => task.assignees?.some(a => a.id == employeeId));

        // Séparer par statut
        const completedTasks = tasks.filter(task => {
            const a = task.assignees.find(a => a.id == employeeId);
            return a && a.status === 'Completed';
        });

        const inProgressTasks = tasks.filter(task => {
            const a = task.assignees.find(a => a.id == employeeId);
            return a && (a.status === 'In Progress' || a.status === 'Pending');
        });

        const overdueTasks = tasks.filter(task => {
            const a = task.assignees.find(a => a.id == employeeId);
            return a && a.status !== 'Completed' && new Date(task.due_date) < new Date();
        });

        // Titre du modal
        const modalTitle = reportsDoc.getElementById('modalTitle');
        modalTitle.innerHTML = `
            <div class="flex items-center gap-3 flex-wrap">
                <span class="text-xl font-bold">${employeeName}</span>
                <div class="flex items-center gap-2 text-xs">
                    <span class="px-2 py-1 rounded-full bg-gray-100 text-gray-700">Total: ${tasks.length}</span>
                    <span class="px-2 py-1 rounded-full bg-green-100 text-green-700">Terminées: ${completedTasks.length}</span>
                    <span class="px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">En cours: ${inProgressTasks.length}</span>
                    <span class="px-2 py-1 rounded-full bg-red-100 text-red-700">En retard: ${overdueTasks.length}</span>
                </div>
            </div>
        `;

        // Helper pour liste de tâches
        function renderTaskList(title, color, icon, taskList) {
            const colorClasses = {
                green: { bg: "bg-green-100", text: "text-green-600" },
                yellow: { bg: "bg-yellow-100", text: "text-yellow-600" },
                red: { bg: "bg-red-100", text: "text-red-600" }
            };

            if (taskList.length === 0) return "";

            return `
            <div class="mb-6">
                <div class="flex items-center mb-4">
                    <div class="w-8 h-8 ${colorClasses[color].bg} rounded-lg flex items-center justify-center mr-3">
                        <i class="fas ${icon} ${colorClasses[color].text} text-sm"></i>
                    </div>
                    <h4 class="text-lg font-semibold text-gray-800">${title}</h4>
                    <span class="ml-2 px-2 py-1 ${colorClasses[color].bg} ${colorClasses[color].text} text-xs font-medium rounded-full">
                        ${taskList.length}
                    </span>
                    <button type="button" class="ml-auto px-2 py-1 text-sm rounded-md border border-gray-200 hover:bg-gray-50" aria-expanded="true" aria-controls="section-${color}" onclick="window.toggleSection('${color}')">
                        <span id="icon-${color}">−</span>
                    </button>
                </div>
                <div id="section-${color}" class="space-y-3 task-section-scroll">
                    ${taskList.map(task => `
                        <div class="task-card border-2 border-black rounded-2xl p-4 bg-white hover:bg-gray-50 overflow-hidden">
                            <div class="flex justify-between items-start mb-2">
                                <h5 class="font-semibold text-gray-900 flex-1">${task.title}</h5>
                                <span class="px-2 py-1 text-xs font-medium rounded-full ${
                                    task.priority === 'High' ? 'bg-red-100 text-red-700' :
                                    task.priority === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-green-100 text-green-700'
                                }">${task.priority}</span>
                            </div>
                            <p class="text-gray-600 text-sm mb-3">${task.description || ''}</p>
                            <div class="flex items-center justify-between text-xs text-gray-500">
                                <span><i class="fas fa-calendar-alt mr-1"></i>${new Date(task.due_date).toLocaleDateString('fr-FR')}</span>
                                <span><i class="fas fa-users mr-1"></i>${task.assignees?.length || 0} assigné(s)</span>
                            </div>
                        </div>
                    `).join("")}
                </div>
            </div>`;
        }

        // Construire le contenu du modal
        let html = `
            ${renderTaskList("Tâches Terminées", "green", "fa-check-circle", completedTasks)}
            ${renderTaskList("Tâches en Cours", "yellow", "fa-clock", inProgressTasks)}
            ${renderTaskList("Tâches en Retard", "red", "fa-exclamation-circle", overdueTasks)}
        `;

        if (tasks.length === 0) {
            html = `
                <div class="text-center py-12">
                    <i class="fas fa-inbox text-gray-400 text-4xl mb-3"></i>
                    <h4 class="text-lg font-medium text-gray-900">Aucune tâche trouvée</h4>
                </div>
            `;
        }

        reportsDoc.getElementById("modalContent").innerHTML = html;
        reportsDoc.getElementById("employeeDetailsModal").classList.remove("hidden");
    };

    // Fonction pour fermer le modal
    window.closeEmployeeDetails = function() {
        reportsDoc.getElementById("employeeDetailsModal").classList.add("hidden");
    };

    // Fermer en cliquant sur l’overlay
    reportsDoc.addEventListener('click', function(e) {
        const modal = reportsDoc.getElementById("employeeDetailsModal");
        if (e.target === modal) {
            modal.classList.add("hidden");
        }
    });

    // ---- Vue par tâche: helpers pour commentaires/rapports (données fraîches) ----
    window.showTaskComments = async function(taskId){
        try{
            const backendUrl = (location.origin && /^https?:\/\//i.test(location.origin)) ? location.origin : '';
            const r = await fetch(`${backendUrl}/tasks/${taskId}/comments`);
            const data = await r.json();
            const list = (data && data.success && Array.isArray(data.comments)) ? data.comments : [];
            const html = `
                <h4 class="text-base font-semibold text-gray-900 mb-2">Commentaires</h4>
                <div class="space-y-2">
                    ${list.length ? list.map(c=>`
                        <div class="p-3 rounded border bg-white">
                            <div class="text-sm text-gray-800">${c.text || c.comment || ''}</div>
                            <div class="text-xs text-gray-500 mt-1">Par ${c.author_name || (c.first_name?`${c.first_name} ${c.last_name}`:'Inconnu')} • ${c.created_at ? new Date(c.created_at).toLocaleString('fr-FR') : ''}</div>
                        </div>
                    `).join('') : '<div class="text-gray-600">Aucun commentaire</div>'}
                </div>
            `;
            reportsDoc.getElementById('modalTitle').textContent = 'Commentaires de la tâche';
            reportsDoc.getElementById('modalContent').innerHTML = html;
            reportsDoc.getElementById('employeeDetailsModal').classList.remove('hidden');
        }catch(_){
            reportsDoc.getElementById('modalTitle').textContent = 'Commentaires de la tâche';
            reportsDoc.getElementById('modalContent').innerHTML = '<div class="text-red-600">Erreur de chargement des commentaires</div>';
            reportsDoc.getElementById('employeeDetailsModal').classList.remove('hidden');
        }
    };
    window.showTaskReports = async function(taskId){
        try{
            const backendUrl = (location.origin && /^https?:\/\//i.test(location.origin)) ? location.origin : '';
            const r = await fetch(`${backendUrl}/api/reports/task/${taskId}`);
            const data = await r.json();
            const list = (data && data.success && Array.isArray(data.reports)) ? data.reports : [];
            const html = `
                <h4 class="text-base font-semibold text-gray-900 mb-2">Rapports</h4>
                <div class="space-y-2">
                    ${list.length ? list.map(rep=>`
                        <div class="p-3 rounded border bg-white">
                            <div class="text-sm text-gray-800">${rep.title || 'Rapport'}</div>
                            <div class="text-xs text-gray-500 mt-1">Par ${rep.author_name || (rep.first_name?`${rep.first_name} ${rep.last_name}`:'Inconnu')} • ${rep.created_at ? new Date(rep.created_at).toLocaleString('fr-FR') : ''}</div>
                            ${rep.content ? `<div class="text-sm text-gray-700 mt-2">${rep.content}</div>` : ''}
                            ${rep.pdf_url ? `<div class="mt-2"><a class="text-blue-600 underline" href="${rep.pdf_url}" target="_blank">Ouvrir PDF</a></div>` : ''}
                        </div>
                    `).join('') : '<div class="text-gray-600">Aucun rapport</div>'}
                </div>
            `;
            reportsDoc.getElementById('modalTitle').textContent = 'Rapports de la tâche';
            reportsDoc.getElementById('modalContent').innerHTML = html;
            reportsDoc.getElementById('employeeDetailsModal').classList.remove('hidden');
        }catch(_){
            reportsDoc.getElementById('modalTitle').textContent = 'Rapports de la tâche';
            reportsDoc.getElementById('modalContent').innerHTML = '<div class="text-red-600">Erreur de chargement des rapports</div>';
            reportsDoc.getElementById('employeeDetailsModal').classList.remove('hidden');
        }
    };
    window.showTaskAssignees = function(assignees){
        const safeList = Array.isArray(assignees) ? assignees : [];
        const html = `
            <h4 class="text-base font-semibold text-gray-900 mb-2">Assignés</h4>
            <div class="space-y-2">
                ${safeList.length ? safeList.map(a=>`
                    <div class="p-3 rounded border bg-white">
                        <div class="font-medium text-gray-900">${(a.first_name||'')+' '+(a.last_name||'')}</div>
                        <div class="text-sm text-gray-600">Statut: ${a.status||'—'} </div>
                    </div>
                `).join('') : '<div class="text-gray-600">Aucun assigné</div>'}
            </div>
        `;
        reportsDoc.getElementById('modalTitle').textContent = 'Détails de la tâche';
        reportsDoc.getElementById('modalContent').innerHTML = html;
        reportsDoc.getElementById('employeeDetailsModal').classList.remove('hidden');
    };

    // ----------- Modal : détails tâche -----------

    // Helper pour afficher les commentaires d'une tâche
    // Helper pour afficher les commentaires d'une tâche

    // Helper pour afficher les rapports d'une tâche
    // Helper pour afficher les rapports d'une tâche
}



// Fonction pour filtrer les tâches par période
function filterTasksByPeriod(reportsWindow, period) {
    const today = new Date();
    let startDate, endDate;
    
    switch(period) {
        case 'today':
            startDate = new Date(today.setHours(0, 0, 0, 0));
            endDate = new Date(today.setHours(23, 59, 59, 999));
            break;
        case 'week':
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            startDate = new Date(weekStart.setHours(0, 0, 0, 0));
            endDate = new Date();
            break;
        case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            endDate = new Date();
            break;
        case 'year':
            startDate = new Date(today.getFullYear(), 0, 1);
            endDate = new Date();
            break;
    }
    
    const filteredTasks = reportsWindow.currentTasks.filter(task => {
        const taskDate = new Date(task.created_at);
        return taskDate >= startDate && taskDate <= endDate;
    });
    
    // Conserver l'ensemble filtré par date
    reportsWindow.currentDateFilteredTasks = filteredTasks;
    // Appliquer le filtre type courant
    applyTypeFilter(reportsWindow, reportsWindow.currentTypeFilter || 'all');
}

// Fonction pour filtrer par plage personnalisée
function filterTasksByCustomRange(reportsWindow, from, to) {
    const startDate = new Date(from);
    const endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);
    
    const filteredTasks = reportsWindow.currentTasks.filter(task => {
        const taskDate = new Date(task.created_at);
        return taskDate >= startDate && taskDate <= endDate;
    });
    
    // Conserver l'ensemble filtré par date
    reportsWindow.currentDateFilteredTasks = filteredTasks;
    // Appliquer le filtre type courant
    applyTypeFilter(reportsWindow, reportsWindow.currentTypeFilter || 'all');
}

// Appliquer filtre par type (all, daily, special) sur l'ensemble filtré par date
function applyTypeFilter(reportsWindow, type) {
    const base = reportsWindow.currentDateFilteredTasks || reportsWindow.currentTasks || [];
    let finalTasks = base;

    if (type && type !== 'all') {
        const wanted = String(type).toLowerCase();
        finalTasks = base.filter(task => {
            const t = (task.type || task.task_type || '').toString().toLowerCase();
            return t === wanted;
        });
    }

    // Conserver l'ensemble filtré courant pour le modal et les vues
    reportsWindow.currentFilteredTasks = finalTasks;
    generateReportsContent(reportsWindow, finalTasks);
}

function generateReportsContent(reportsWindow, filteredTasks) {
    const reportsDoc = reportsWindow.document;
    const contentDiv = reportsDoc.getElementById('reportsContent');
    // Toujours mémoriser l'ensemble filtré courant
    reportsWindow.currentFilteredTasks = filteredTasks;
    
    if (currentUser.role === 'Department_Responsible') {
        contentDiv.innerHTML = generateResponsibleView(reportsWindow, filteredTasks);

        const tabByEmployee = reportsDoc.getElementById('tabByEmployee');
        const tabByTask = reportsDoc.getElementById('tabByTask');
        const responsibleContent = reportsDoc.getElementById('responsibleViewContent');
        const searchInput = reportsDoc.getElementById('responsibleSearch');
        const employeeSelect = reportsDoc.getElementById('employeeFilter');
        const resetButton = reportsDoc.getElementById('resetEmployeeFilter');

        // Populate employee select
        if (employeeSelect && Array.isArray(reportsWindow.currentEmployees)) {
            employeeSelect.innerHTML = ['<option value="all">Tous les employés</option>']
                .concat(
                    reportsWindow.currentEmployees.map(emp =>
                        `<option value="${emp.id}">${emp.first_name || ''} ${emp.last_name || ''}</option>`
                    )
                ).join('');
        }

        // Track active tab
        reportsWindow.respActiveTab = reportsWindow.respActiveTab || 'employee';

        function filterTasksForResponsible(baseTasks) {
            const empId = (employeeSelect && employeeSelect.value) || 'all';
            const q = (searchInput && searchInput.value || '').trim().toLowerCase();

            let result = baseTasks;

            // Filter by employee
            if (empId !== 'all') {
                result = result.filter(task => task.assignees?.some(a => a.id == empId));
            }

            // Filter by search query (title/description/assignee names)
            if (q) {
                result = result.filter(task => {
                    const title = (task.title || '').toLowerCase();
                    const desc = (task.description || '').toLowerCase();
                    const hasInTask = title.includes(q) || desc.includes(q);
                    const hasInAssignees = (task.assignees || []).some(a => {
                        const fn = (a.first_name || '').toLowerCase();
                        const ln = (a.last_name || '').toLowerCase();
                        const full = `${fn} ${ln}`.trim();
                        return fn.includes(q) || ln.includes(q) || full.includes(q);
                    });
                    return hasInTask || hasInAssignees;
                });
            }
            return result;
        }

        function renderResponsible() {
            const base = reportsWindow.currentFilteredTasks || [];
            const tasksToRender = filterTasksForResponsible(base);
            if (reportsWindow.respActiveTab === 'employee') {
                const empId = (employeeSelect && employeeSelect.value) || 'all';
                responsibleContent.innerHTML = generateResponsibleByEmployee(tasksToRender, reportsWindow, empId);
            } else {
                responsibleContent.innerHTML = generateResponsibleByTask(tasksToRender);
            }
        }

        if (tabByEmployee && tabByTask) {
            tabByEmployee.addEventListener('click', () => {
                tabByEmployee.classList.add("bg-blue-600","text-white");
                tabByEmployee.classList.remove("bg-gray-200");
                tabByTask.classList.add("bg-gray-200");
                tabByTask.classList.remove("bg-blue-600","text-white");
                reportsWindow.respActiveTab = 'employee';
                renderResponsible();
            });

            tabByTask.addEventListener('click', () => {
                tabByTask.classList.add("bg-blue-600","text-white");
                tabByTask.classList.remove("bg-gray-200");
                tabByEmployee.classList.add("bg-gray-200");
                tabByEmployee.classList.remove("bg-blue-600","text-white");
                reportsWindow.respActiveTab = 'task';
                renderResponsible();
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', debounce(() => {
                renderResponsible();
            }, 250));
        }

        if (employeeSelect) {
            employeeSelect.addEventListener('change', () => {
                renderResponsible();
            });
        }

        if (resetButton) {
            resetButton.addEventListener('click', () => {
                if (employeeSelect) employeeSelect.value = 'all';
                if (searchInput) searchInput.value = '';
                renderResponsible();
            });
        }

        // Initial render reflecting default controls
        renderResponsible();
    } else {
        contentDiv.innerHTML = generateEmployeeView(reportsWindow, filteredTasks);
    }
}




// Fonction pour filtrer par employé
function filterByEmployee(reportsWindow, employeeId) {
    const reportsDoc = reportsWindow.document;
    const contentDiv = reportsDoc.getElementById('reportsContent');
    
    let filteredTasks = reportsWindow.currentTasks;
    
    if (employeeId !== 'all') {
        filteredTasks = reportsWindow.currentTasks.filter(task => {
            if (!task.assignees || !Array.isArray(task.assignees)) return false;
            return task.assignees.some(assignee => assignee.id == employeeId);
        });
    }
    
    if (currentUser.role === 'Department_Responsible') {
        contentDiv.innerHTML = generateResponsibleView(reportsWindow, filteredTasks, employeeId);
        
        setTimeout(() => {
            const employeeFilter = reportsDoc.getElementById('employeeFilter');
            const resetButton = reportsDoc.getElementById('resetEmployeeFilter');

            if (employeeFilter) {
                employeeFilter.value = employeeId;
                employeeFilter.addEventListener('change', (e) => {
                    filterByEmployee(reportsWindow, e.target.value);
                });
            }
            if (resetButton) {
                resetButton.addEventListener('click', () => {
                    filterByEmployee(reportsWindow, 'all');
                });
            }
        }, 100);
    }
}


// Calcul des statistiques des employés
// Calcul des statistiques des employés
function calculateEmployeeStats(tasks, targetEmployeeId = null) {
    const stats = {};
    
    tasks.forEach(task => {
        if (!task.assignees || !Array.isArray(task.assignees)) return;
        
        task.assignees.forEach(assignee => {
            const employeeId = assignee.id;
            
            // Si on filtre par employé spécifique, ignorer les autres
            if (targetEmployeeId && targetEmployeeId !== 'all' && employeeId != targetEmployeeId) {
                return;
            }
            
            if (!stats[employeeId]) {
                stats[employeeId] = {
                    id: employeeId,
                    name: `${assignee.first_name} ${assignee.last_name}`,
                    total: 0,
                    completed: 0,
                    inProgress: 0,
                    overdue: 0
                };
            }
            
            stats[employeeId].total++;
            
            if (assignee.status === 'Completed') {
                stats[employeeId].completed++;
            } else if (assignee.status === 'In Progress' || assignee.status === 'Pending') {
                stats[employeeId].inProgress++;
            }
            
            if (assignee.status !== 'Completed' && new Date(task.due_date) < new Date()) {
                stats[employeeId].overdue++;
            }
        });
    });
    
    return Object.values(stats);
}
function getEmployeePersonalStats(tasks, currentUser) {
    const myTasks = tasks.filter(task => {
        if (!task.assignees || !Array.isArray(task.assignees)) return false;
        return task.assignees.some(assignee => 
            assignee.id === currentUser.id ||
            `${assignee.first_name} ${assignee.last_name}` === `${currentUser.first_name} ${currentUser.last_name}`
        );
    });
    
    let total = 0, completed = 0, inProgress = 0, overdue = 0;
    
    myTasks.forEach(task => {
        const myAssignee = task.assignees.find(a => 
            a.id === currentUser.id || 
            `${a.first_name} ${a.last_name}` === `${currentUser.first_name} ${currentUser.last_name}`
        );
        
        if (myAssignee) {
            total++;
            
            if (myAssignee.status === 'Completed') {
                completed++;
            } else if (myAssignee.status === 'In Progress' || myAssignee.status === 'Pending') {
                inProgress++;
            }
            
            if (myAssignee.status !== 'Completed' && new Date(task.due_date) < new Date()) {
                overdue++;
            }
        }
    });
    
    return { total, completed, inProgress, overdue, tasks: myTasks };
}


// Vue responsable (tableau simple)
function generateResponsibleView(reportsWindow, filteredTasks, targetEmployeeId = null) {
    return `
        <!-- Onglets -->
        <div class="bg-white rounded-lg shadow-sm p-4 mb-6">
            <div class="flex flex-col lg:flex-row lg:items-center gap-4">
                <div class="flex space-x-2">
                    <button id="tabByEmployee" class="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">Par Employé</button>
                    <button id="tabByTask" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-medium">Par Tâche</button>
                </div>
                <div class="flex-1"></div>
                <div class="flex items-center gap-3 w-full lg:w-auto">
                    <div class="relative flex-1 lg:w-80">
                        <input id="responsibleSearch" type="text" placeholder="Rechercher un employé ..." class="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                        <span class="absolute left-3 top-2.5 text-gray-400"><i class="fas fa-search"></i></span>
                    </div>
                    <select id="employeeFilter" class="px-3 py-2 border border-gray-300 rounded-lg bg-white"></select>
                    <button id="resetEmployeeFilter" class="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Réinitialiser</button>
                </div>
            </div>
        </div>

        <!-- Contenu dynamique -->
        <div id="responsibleViewContent">
            ${generateResponsibleByEmployee(filteredTasks, reportsWindow, targetEmployeeId)}
        </div>
    `;
}
function generateResponsibleByEmployee(filteredTasks, reportsWindow, targetEmployeeId) {
    const employeeStats = calculateEmployeeStats(filteredTasks, targetEmployeeId);

    return `
        <h3 class="text-lg font-semibold mb-4">Performance par Employé</h3>
        <div class="overflow-x-auto">
            <table class="w-full border rounded-lg">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-3 text-left text-sm font-medium text-gray-900">Employé</th>
                        <th class="px-4 py-3 text-center">Total</th>
                        <th class="px-4 py-3 text-center">Terminées</th>
                        <th class="px-4 py-3 text-center">En Cours</th>
                        <th class="px-4 py-3 text-center">En Retard</th>
                        <th class="px-4 py-3 text-center">Détails</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    ${employeeStats.map(stat => `
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium">${stat.name}</td>
                            <td class="px-4 py-3 text-center">${stat.total}</td>
                            <td class="px-4 py-3 text-center text-green-600">${stat.completed}</td>
                            <td class="px-4 py-3 text-center text-yellow-600">${stat.inProgress}</td>
                            <td class="px-4 py-3 text-center text-red-600">${stat.overdue}</td>
                            <td class="px-4 py-3 text-center">
                                <button 
                                    class="inline-flex items-center px-3 py-1.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-medium rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-sm hover:shadow-md"
                                    onclick="window.showEmployeeDetails('${stat.id}', '${stat.name}')">
                                    <i class="fas fa-eye mr-1.5 text-xs"></i>
                                    Voir
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        
    `;
}
function generateResponsibleByTask(filteredTasks) {
    // Persist the current dataset for pagination rerenders
    window.currentRespTasks = Array.isArray(filteredTasks) ? filteredTasks : [];
    window.respTaskPage = window.respTaskPage || 1;
    window.respPageSize = window.respPageSize || 10;

    const total = window.currentRespTasks.length;
    const totalPages = Math.max(1, Math.ceil(total / window.respPageSize));
    if (window.respTaskPage > totalPages) window.respTaskPage = totalPages;
    const startIdx = (window.respTaskPage - 1) * window.respPageSize;
    const endIdx = startIdx + window.respPageSize;
    const pageItems = window.currentRespTasks.slice(startIdx, endIdx);

    return `
        <h3 class="text-lg font-semibold mb-4">Performance par Tâche</h3>
        <div class="flex items-center justify-between mb-3 text-sm text-gray-700">
            <div>
                Total: <span class="font-medium">${total}</span>
            </div>
            <div class="flex items-center gap-2">
                <button class="px-2 py-1 border rounded disabled:opacity-50" ${window.respTaskPage <= 1 ? 'disabled' : ''}
                    onclick="(function(){ window.respTaskPage=Math.max(1,(window.respTaskPage||1)-1); document.getElementById('responsibleViewContent').innerHTML = generateResponsibleByTask(window.currentRespTasks||[]); })()">Préc.</button>
                <span>Page <span class="font-medium">${window.respTaskPage}</span> / ${totalPages}</span>
                <button class="px-2 py-1 border rounded disabled:opacity-50" ${window.respTaskPage >= totalPages ? 'disabled' : ''}
                    onclick="(function(){ window.respTaskPage=Math.min(${totalPages},(window.respTaskPage||1)+1); document.getElementById('responsibleViewContent').innerHTML = generateResponsibleByTask(window.currentRespTasks||[]); })()">Suiv.</button>
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full border rounded-lg">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-3 text-left text-sm font-medium">Titre</th>
                        <th class="px-4 py-3 text-center">Assignées</th>
                        <th class="px-4 py-3 text-center">Terminées</th>
                        <th class="px-4 py-3 text-center">En Cours</th>
                        <th class="px-4 py-3 text-center">En Retard</th>
                        <th class="px-4 py-3 text-center">Échéance</th>
                        <th class="px-4 py-3 text-center">Détails</th>
                        <th class="px-4 py-3 text-center">Commentaires</th>
                        <th class="px-4 py-3 text-center">Rapports</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    ${pageItems.map(task => {
                        let total = task.assignees?.length || 0;
                        let completed = task.assignees?.filter(a => a.status === "Completed").length || 0;
                        let inProgress = task.assignees?.filter(a => a.status === "In Progress" || a.status === "Pending").length || 0;
                        let overdue = task.assignees?.filter(a => a.status !== "Completed" && new Date(task.due_date) < new Date()).length || 0;
                        
                        return `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 font-medium">${task.title}</td>
                                <td class="px-4 py-3 text-center">${total}</td>
                                <td class="px-4 py-3 text-center text-green-600">${completed}</td>
                                <td class="px-4 py-3 text-center text-yellow-600">${inProgress}</td>
                                <td class="px-4 py-3 text-center text-red-600">${overdue}</td>
                                <td class="px-4 py-3 text-center">${new Date(task.due_date).toLocaleDateString()}</td>
                                <td class="px-4 py-3 text-center">
                                    <button class="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700" onclick='window.showTaskAssignees(${JSON.stringify(task.assignees || [])})'>Voir</button>
                                </td>
                                <td class="px-4 py-3 text-center">
                                    <button class="px-3 py-1.5 text-sm rounded bg-gray-700 text-white hover:bg-gray-800" onclick='window.showTaskComments("${task.id}")'>Ouvrir</button>
                                </td>
                                <td class="px-4 py-3 text-center">
                                    <button class="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700" onclick='window.showTaskReports("${task.id}")'>Ouvrir</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function generateEmployeeView(reportsWindow, filteredTasks) {
    const personalStats = getEmployeePersonalStats(filteredTasks, currentUser);
    
    console.log('🔍 Debug Employé - Stats personnelles:', personalStats);
    
    // Séparer les tâches selon MON statut sur chaque tâche
    const accomplishedTasks = personalStats.tasks.filter(task => {
        const myAssignee = task.assignees.find(a => 
            a.id === currentUser.id || 
            `${a.first_name} ${a.last_name}` === `${currentUser.first_name} ${currentUser.last_name}`
        );
        return myAssignee && myAssignee.status === 'Completed';
    });
    
    const inProgressTasks = personalStats.tasks.filter(task => {
        const myAssignee = task.assignees.find(a => 
            a.id === currentUser.id || 
            `${a.first_name} ${a.last_name}` === `${currentUser.first_name} ${currentUser.last_name}`
        );
        return myAssignee && (myAssignee.status === 'In Progress' || myAssignee.status === 'Pending');
    });
    
    const overdueTasks = personalStats.tasks.filter(task => {
        const myAssignee = task.assignees.find(a => 
            a.id === currentUser.id || 
            `${a.first_name} ${a.last_name}` === `${currentUser.first_name} ${currentUser.last_name}`
        );
        return myAssignee && myAssignee.status !== 'Completed' && new Date(task.due_date) < new Date();
    });

    return `
        <!-- Mes statistiques personnelles -->
        <div class="grid grid-cols-4 gap-6 mb-6">
            <div class="stats-card total">
                <div class="flex items-center">
                    <i class="fas fa-tasks text-blue-600 text-2xl mr-4"></i>
                    <div>
                        <p class="text-sm text-gray-600">Mes Tâches</p>
                        <p class="text-2xl font-bold text-gray-900">${personalStats.total}</p>
                    </div>
                </div>
            </div>
            <div class="stats-card completed">
                <div class="flex items-center">
                    <i class="fas fa-check-circle text-green-600 text-2xl mr-4"></i>
                    <div>
                        <p class="text-sm text-gray-600">Accomplies</p>
                        <p class="text-2xl font-bold text-gray-900">${personalStats.completed}</p>
                    </div>
                </div>
            </div>
            <div class="stats-card progress">
                <div class="flex items-center">
                    <i class="fas fa-clock text-yellow-600 text-2xl mr-4"></i>
                    <div>
                        <p class="text-sm text-gray-600">En Cours</p>
                        <p class="text-2xl font-bold text-gray-900">${personalStats.inProgress}</p>
                    </div>
                </div>
            </div>
            <div class="stats-card overdue">
                <div class="flex items-center">
                    <i class="fas fa-exclamation-circle text-red-600 text-2xl mr-4"></i>
                    <div>
                        <p class="text-sm text-gray-600">En Retard</p>
                        <p class="text-2xl font-bold text-gray-900">${personalStats.overdue}</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Mes tâches accomplies -->
            <div class="bg-white rounded-lg shadow-sm p-6">
                <h3 class="text-lg font-semibold mb-4 text-green-600">
                    <i class="fas fa-check-circle mr-2"></i>Mes Accomplissements
                </h3>
                <div class="space-y-3">
                    ${accomplishedTasks.map(task => `
                        <div class="border border-green-200 rounded-lg p-3 bg-green-50">
                            <h4 class="font-medium text-gray-900 mb-1">${task.title}</h4>
                            <p class="text-sm text-gray-600 mb-2">${task.description}</p>
                            <div class="flex items-center text-xs text-gray-500 space-x-3">
                                <span><i class="fas fa-calendar mr-1"></i>${new Date(task.due_date).toLocaleDateString()}</span>
                                <span><i class="fas fa-flag mr-1"></i>${task.priority}</span>
                            </div>
                        </div>
                    `).join('') || '<p class="text-gray-500 text-center py-4">Aucune tâche accomplie</p>'}
                </div>
            </div>

            <!-- Mes tâches en cours -->
            <div class="bg-white rounded-lg shadow-sm p-6">
                <h3 class="text-lg font-semibold mb-4 text-yellow-600">
                    <i class="fas fa-clock mr-2"></i>En Cours de Traitement
                </h3>
                <div class="space-y-3">
                    ${inProgressTasks.map(task => `
                        <div class="border border-yellow-200 rounded-lg p-3 bg-yellow-50">
                            <h4 class="font-medium text-gray-900 mb-1">${task.title}</h4>
                            <p class="text-sm text-gray-600 mb-2">${task.description}</p>
                            <div class="flex items-center text-xs text-gray-500 space-x-3">
                                <span><i class="fas fa-calendar mr-1"></i>${new Date(task.due_date).toLocaleDateString()}</span>
                                <span><i class="fas fa-flag mr-1"></i>${task.priority}</span>
                            </div>
                        </div>
                    `).join('') || '<p class="text-gray-500 text-center py-4">Aucune tâche en cours</p>'}
                </div>
            </div>

            <!-- Mes tâches en retard -->
            <div class="bg-white rounded-lg shadow-sm p-6">
                <h3 class="text-lg font-semibold mb-4 text-red-600">
                    <i class="fas fa-exclamation-circle mr-2"></i>À Rattraper
                </h3>
                <div class="space-y-3">
                    ${overdueTasks.map(task => `
                        <div class="border border-red-200 rounded-lg p-3 bg-red-50">
                            <h4 class="font-medium text-gray-900 mb-1">${task.title}</h4>
                            <p class="text-sm text-gray-600 mb-2">${task.description}</p>
                            <div class="flex items-center text-xs text-gray-500 space-x-3">
                                <span><i class="fas fa-calendar mr-1"></i>${new Date(task.due_date).toLocaleDateString()}</span>
                                <span><i class="fas fa-flag mr-1"></i>${task.priority}</span>
                            </div>
                        </div>
                    `).join('') || '<p class="text-gray-500 text-center py-4">Aucune tâche en retard</p>'}
                </div>
            </div>
        </div>
    `;
}

// Debounce utility to limit fast input triggers
function debounce(fn, delay) {
    let t;
    return function(...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), delay);
    };
}