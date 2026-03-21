// ==== Fonction pour ouvrir le modal de rapport ====
function openReportModal(taskId) {
  const task = tasks.find(t => t.id == taskId);
  if (!task) {
    Utils.showNotification("Task not found", "error");
    return;
  }

  // Trouver l'assigné courant
  const employeeId = getCurrentEmployeeId();
  const assignee = task.assignees?.find(a => a.id == employeeId);

  // Description automatique du rapport
  const autoDescription = `
    La tâche "${task.title}" a été assignée par ${task.assigned_by_first_name} ${task.assigned_by_last_name} 
    à ${assignee ? assignee.first_name + " " + assignee.last_name : "un employé"}.
    Elle a été complétée le ${assignee?.completed_at ? Utils.formatDateTime(assignee.completed_at) : Utils.formatDateTime(new Date())}.
  `;

  // Injecter le modal dans la page
  const modalHtml = `
    <div id="reportModal" class="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div class="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg">
        <h2 class="text-xl font-semibold mb-4">Nouveau rapport</h2>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">Description automatique</label>
          <textarea readonly class="w-full p-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-700">${autoDescription.trim()}</textarea>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">Compte-rendu de l'employé</label>
          <textarea id="employeeReport" class="w-full p-2 border border-gray-300 rounded-lg" rows="4" placeholder="Écrivez ici votre rapport..."></textarea>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">Remarques importantes</label>
          <textarea id="employeeRemarks" class="w-full p-2 border border-gray-300 rounded-lg" rows="3" placeholder="Points importants..."></textarea>
        </div>

        <div class="flex justify-end space-x-3">
          <button onclick="closeReportModal()" 
                  class="px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-100">
            Annuler
          </button>
          <button onclick="saveReport('${task.id}')" 
                  class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  `;

  // Supprimer ancien modal si existe
  const oldModal = document.getElementById("reportModal");
  if (oldModal) oldModal.remove();

  // Ajouter dans body
  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

// ==== Fermer le modal ====
function closeReportModal() {
  const modal = document.getElementById("reportModal");
  if (modal) modal.remove();
}

// ==== Sauvegarder le rapport (CORRIGÉ) ====
async function saveReport(taskId) {
  const reportText = document.getElementById("employeeReport")?.value.trim();
  const remarks = document.getElementById("employeeRemarks")?.value.trim();

  if (!reportText) {
    Utils.showNotification("Veuillez écrire votre compte-rendu avant d'enregistrer", "error");
    return;
  }

  const reportData = {
    task_id: taskId,
    employee_id: getCurrentEmployeeId(),
    description: reportText,
    remarks: remarks || null
  };

  try {
    // ✅ Corriger l'URL de l'API
    const __API = (location.origin && /^https?:\/\//i.test(location.origin)) ? location.origin : '';
    const response = await fetch(`${__API}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportData),
    });

    const result = await response.json();

    if (result.success) {
      Utils.showNotification("Rapport enregistré avec succès ✅", "success");
      closeReportModal();

      // 👉 Affiche directement le PDF généré
      const __API = (location.origin && /^https?:\/\//i.test(location.origin)) ? location.origin : '';
      const pdfUrl = `${__API}/api/reports/${result.report.id}/pdf`;
      window.open(pdfUrl, "_blank");

    } else {
      Utils.showNotification(result.error || "Erreur lors de l'enregistrement", "error");
    }
  } catch (error) {
    console.error("Erreur envoi rapport:", error);
    Utils.showNotification("Erreur réseau/serveur", "error");
  }
}

// ==== Voir un rapport PDF (CORRIGÉ) ====
// ==== Voir un rapport PDF (CORRIGÉ) ====
function viewReport(reportId) {
  console.log("👁️ Tentative d'ouverture du rapport ID:", reportId);
  
  // URL directe vers le PDF - ouvrir directement sans vérification
  const __API = (location.origin && /^https?:\/\//i.test(location.origin)) ? location.origin : '';
  const pdfUrl = `${__API}/api/reports/${reportId}/pdf`;
  console.log("✅ Ouverture directe du PDF:", pdfUrl);
  
  // Ouvrir le PDF dans un nouvel onglet
  window.open(pdfUrl, "_blank");
}


// ==== Charger tous les rapports d'une tâche (CORRIGÉ) ====
async function loadReports(taskId) {
  try {
    console.log("🔍 Chargement des rapports pour la tâche:", taskId);
    
    const __API = (location.origin && /^https?:\/\//i.test(location.origin)) ? location.origin : '';
    const response = await fetch(`${__API}/api/reports/task/${taskId}`);
    const data = await response.json();

    console.log("📋 Réponse de l'API:", data);

    if (data.success && data.reports.length > 0) {
      console.log("✅ Rapports trouvés:", data.reports);
      showReportsModal(taskId, data.reports);
    } else {
      Utils.showNotification("Aucun rapport trouvé pour cette tâche", "info");
    }
  } catch (error) {
    console.error("❌ Erreur lors du chargement des rapports:", error);
    Utils.showNotification("Erreur lors du chargement des rapports", "error");
  }
}

// ==== Afficher le modal des rapports ====
// ==== Afficher le modal des rapports (VERSION ULTRA COMPACTE) ====
function showReportsModal(taskId, reports) {
  console.log("🖼️ Création du modal ultra compact pour les rapports:", reports);
  
  const task = tasks.find(t => t.id == taskId);
  const taskTitle = task ? task.title : `Tâche ${taskId}`;

  const reportsHtml = reports.map(report => {
    return `
      <div class="p-2 border-b border-gray-200 hover:bg-gray-50">
        <div class="flex justify-between items-center">
          <div class="flex-1 truncate">
            <div class="flex items-center space-x-2">
              <span class="font-medium text-gray-900 text-xs">${report.first_name} ${report.last_name}</span>
              <span class="text-xs text-gray-500">${Utils.formatDate(report.created_at)}</span>
            </div>
          </div>
          <div class="ml-2">
            <button onclick="viewReport('${report.id}')" 
                    class="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 whitespace-nowrap">
              <i class="fas fa-file-pdf"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

const modalHtml = `
  <div id="reportsListModal" class="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-md max-h-[65vh] m-4">
      
      <!-- Header -->
      <div class="flex justify-between items-center p-4 border-b">
        <h2 class="text-lg font-semibold text-gray-800">Rapports - ${taskTitle}</h2>
        <button onclick="closeReportsListModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times"></i>
        </button>
      </div>
      
      <!-- Contenu -->
      <div class="overflow-y-auto max-h-[45vh] divide-y">
        ${
          reports.length > 0 
          ? reports.map(report => `
            <div class="flex justify-between items-center p-3 hover:bg-gray-50">
              <div class="flex flex-col">
                <span class="font-medium text-gray-900 text-sm">${report.first_name} ${report.last_name}</span>
                <span class="text-xs text-gray-500">${Utils.formatDate(report.created_at)}</span>
              </div>
              <button onclick="viewReport('${report.id}')" 
                      class="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                <i class="fas fa-file-pdf"></i>
              </button>
            </div>
          `).join('')
          : '<p class="p-4 text-gray-500 text-center text-sm">Aucun rapport</p>'
        }
      </div>
      
      <!-- Footer -->
      <div class="p-3 border-t bg-gray-50 text-center">
        <button onclick="closeReportsListModal()" 
                class="px-4 py-2 text-gray-600 text-sm hover:text-gray-800">
          Fermer
        </button>
      </div>
      
    </div>
  </div>
`;




  const oldModal = document.getElementById("reportsListModal");
  if (oldModal) oldModal.remove();

  document.body.insertAdjacentHTML("beforeend", modalHtml);
}
function debugReport(reportId) {
  console.log("🐛 DEBUG - Rapport ID:", reportId);
  console.log("🐛 DEBUG - Type de l'ID:", typeof reportId);
  
  // Tester différentes URLs
  const __API = (location.origin && /^https?:\/\//i.test(location.origin)) ? location.origin : '';
  const urls = [
    `${__API}/api/reports/${reportId}`,
    `${__API}/api/reports/${reportId}/pdf`
  ];
  
  urls.forEach(url => {
    console.log(`🔍 Test de l'URL: ${url}`);
    fetch(url)
      .then(response => {
        console.log(`Status pour ${url}:`, response.status);
        return response.text();
      })
      .then(text => {
        console.log(`Réponse pour ${url}:`, text.substring(0, 200));
      })
      .catch(error => {
        console.error(`Erreur pour ${url}:`, error);
      });
  });
}

// ==== Fermer le modal de liste des rapports ====
function closeReportsListModal() {
  const modal = document.getElementById("reportsListModal");
  if (modal) modal.remove();
}