// === Minimal i18n (optionnel mais safe) ===
// Don't redeclare currentLanguage if it's already defined (e.g., by translations.js)
if (typeof currentLanguage === 'undefined') {
  var currentLanguage = (() => {
    try { return localStorage.getItem('lang') || localStorage.getItem('language') || 'ar'; } catch(_) { return 'en'; }
  })();
}
// Also sync with window.currentLanguage if available
if (typeof window !== 'undefined' && window.currentLanguage && typeof currentLanguage !== 'undefined') {
  currentLanguage = window.currentLanguage;
} else if (typeof window !== 'undefined' && window.currentLanguage) {
  currentLanguage = window.currentLanguage;
}
const TRANSLATIONS = {
  en: {'common.cancel':'Cancel'},
  fr: {'common.cancel':'Annuler'},
  ar: {'common.cancel':'إلغاء'}
};
function translate(key){ const d=TRANSLATIONS[currentLanguage]||{}; return d[key]||key; }
function setLanguage(lang){ currentLanguage = lang || 'ar'; try{localStorage.setItem('lang',currentLanguage);}catch(_){}; applyTranslations(); }
function applyTranslations(){
  document.querySelectorAll('[data-translate]').forEach(el=>{
    const key = el.getAttribute('data-translate'); if(!key) return;
    const txt = translate(key); if(typeof txt==='string') el.textContent = txt;
  });
  document.documentElement.setAttribute('dir', currentLanguage==='ar' ? 'rtl' : 'ltr');
}
// === Compatibilité avec l'ancien code (shim APIService) ===
// Only declare APIService if it doesn't already exist (to avoid conflicts with frontend)
if (typeof APIService === 'undefined') {
  window.APIService = class APIService {
  static _getAuthHeader(){
    try{
      if (window.parent && window.parent.authManager && typeof window.parent.authManager.getToken === 'function'){
        const t = window.parent.authManager.getToken();
        if (t) return { 'Authorization': `Bearer ${t}` };
      }
    }catch(_){ }
    try{
      const t = localStorage.getItem('token') || localStorage.getItem('jwt_token');
      if (t) return { 'Authorization': `Bearer ${t}` };
    }catch(_){ }
    return {};
  }
  // Employés (redirige vers /employees si ton backend l'expose)
  static async getEmployees(params = {}) {
    return TaskAPI._request(`/employees?${new URLSearchParams(params)}`);
  }

  // Tâches
   static async getTasks(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const headers = {
      'Content-Type': 'application/json',
      ...APIService._getAuthHeader()
    };
    const response = await fetch(`${TASKS_API}/tasks${queryString ? `?${queryString}` : ""}`, {
      headers: headers
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error fetching tasks:', response.status, errorText);
      throw new Error(`Failed to fetch tasks: ${response.status}`);
    }
    return response.json();
  }

  static async createTask(data) {
    // Server expects a single assigned_to per task and derives assigned_by from token
    const headers = { 'Content-Type': 'application/json', ...APIService._getAuthHeader() };
    const assignedList = Array.isArray(data?.assigned_to) ? data.assigned_to.filter(Boolean) : [data.assigned_to].filter(Boolean);
    const base = {
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      due_date: data.due_date || null,
      // Some backends (e.g., on port 3020) require assigned_by in the payload
      assigned_by: data.assigned_by
    };
    const results = [];
    for (const assigneeId of assignedList){
      const payload = { ...base, assigned_to: assigneeId };
      const resp = await fetch(`${TASKS_API}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      const json = await resp.json();
      if (!resp.ok){
        const err = json && (json.error || json.message);
        throw new Error(err || `HTTP ${resp.status}`);
      }
      results.push(json);
    }
    return Array.isArray(data?.assigned_to) ? results : results[0];
  }
static async getTaskComments(taskId) {
    try {
      const response = await fetch(`${TASKS_API}/tasks/${taskId}/comments`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching comments:', error);
      throw error;
    }
  }

  // Ajouter un commentaire
  static async addComment(taskId, comment, employeeId) {
    try {
      const response = await fetch(`${TASKS_API}/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ comment, employeeId })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }

  // Modifier un commentaire
  static async updateComment(commentId, comment, employeeId) {
    try {
      const response = await fetch(`${TASKS_API}/comments/${commentId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ comment, employeeId })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error updating comment:', error);
      throw error;
    }
  }

  // Supprimer un commentaire
  static async deleteComment(commentId, employeeId) {
    try {
      const response = await fetch(`${TASKS_API}/comments/${commentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ employeeId })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error deleting comment:', error);
      throw error;
    }
  }
  static async updateAssigneeStatus(taskId, employeeId, status) {
    const response = await fetch(`${TASKS_API}/tasks/${taskId}/assignees/${employeeId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status })
    });
    return response.json();
  }
  static async updateTask(id, data) {
    return TaskAPI.update(id, data);
  }

  static async deleteTask(id) {
    return TaskAPI.remove(id);
  }

  static async addComment(taskId, comment) {
    return TaskAPI.addComment(taskId, comment);
  }

  static async listComments(taskId) {
    return TaskAPI.listComments(taskId);
  }
   static async updateTask(taskId, data) {
    try {
      const response = await fetch(`${TASKS_API}/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error updating task:', error);
      throw error;
    }
  }

  // NOUVELLE méthode pour récupérer une tâche spécifique
  static async getTask(taskId) {
    try {
      const response = await fetch(`${TASKS_API}/tasks/${taskId}`, {
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching task:', error);
      throw error;
    }
  }

  // NOUVELLE méthode pour supprimer une tâche
  static async deleteTask(taskId) {
    try {
      const response = await fetch(`${TASKS_API}/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error deleting task:', error);
      throw error;
    }
  }
  };
  
  // Expose globalement (comme avant) - do this immediately
  window.APIService = APIService;
  // Also expose to global scope for immediate access
  if (typeof globalThis !== 'undefined') {
    globalThis.APIService = APIService;
  }
} // End of if (typeof APIService === 'undefined')


// === Config uniquement pour TASKS ===

const TASKS_API = "";

// === Utils (uniquement ce que l'écran Tasks utilise) ===
// Only declare Utils if it doesn't already exist (to avoid duplicate declaration errors)
if (typeof Utils === 'undefined') {
  class Utils {
    static formatDate(s){ if(!s) return ""; const d=new Date(s);
      return d.toLocaleDateString(currentLanguage,{year:"numeric",month:"short",day:"numeric"}); }
    static formatDateTime(s){ if(!s) return ""; const d=new Date(s);
      return d.toLocaleString(currentLanguage,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }
    static showNotification(message,type="info"){
      const div=document.createElement("div");
      div.className=`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm ${{
        success:"bg-green-500 text-white",
        error:"bg-red-500 text-white",
        warning:"bg-yellow-500 text-white",
        info:"bg-blue-500 text-white"
      }[type]||"bg-blue-500 text-white"}`;
      div.innerHTML=`<div class="flex items-center">
        <span class="font-medium mr-2">${type.toUpperCase()}</span>
        <span>${message}</span>
        <button class="ml-4 opacity-80 hover:opacity-100" aria-label="close">&times;</button>
      </div>`;
      div.querySelector("button").onclick=()=>div.remove();
      document.body.appendChild(div); setTimeout(()=>div.remove(),5000);
    }
  }
  // Expose Utils globally
  window.Utils = Utils;
}
function getStatusClass(status){
  const map = {
    "Pending":"bg-yellow-100 text-yellow-800",
    "In Progress":"bg-blue-100 text-blue-800",
    "Completed":"bg-green-100 text-green-800",
    "Accepted":"bg-indigo-100 text-indigo-800",
    "Denied":"bg-red-100 text-red-800"
  };
  return map[status] || "bg-gray-100 text-gray-800";
}
function getPriorityClass(priority){
  const map = {
    "Low":"bg-gray-100 text-gray-800",
    "Medium":"bg-orange-100 text-orange-800",
    "High":"bg-red-100 text-red-800",
    "Critical":"bg-rose-100 text-rose-800"
  };
  return map[priority] || "bg-gray-100 text-gray-800";
}
function getTypeClass(type){
  const map = {
    "Bug":"bg-red-100 text-red-800",
    "Feature":"bg-blue-100 text-blue-800",
    "Task":"bg-gray-100 text-gray-800",
    "Improvement":"bg-green-100 text-green-800"
  };
  return map[type] || "bg-gray-100 text-gray-800";
}

// === API Tasks uniquement (aucune dépendance à auth/users/etc.) ===
class TaskAPI {
  static async _request(path, options={}){
    const url = `${TASKS_API}${path}`;
    // Try to get token from frontend's authManager first, then fallback to localStorage
    let token = null;
    try {
      if (window.authManager && typeof window.authManager.getToken === 'function') {
        token = window.authManager.getToken();
      }
    } catch(_) {}
    if (!token) {
      token = localStorage.getItem('token') || localStorage.getItem('jwt_token');
    }
const defaults = { 
  headers: { 
    'Content-Type':'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  } 
};

    const res = await fetch(url, { ...defaults, ...options });
    if (!res.ok){
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch(_) {}
      throw new Error(msg);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

 static list(params={}) {
    const qs = new URLSearchParams(params).toString();
    return this._request(`/tasks${qs ? `?${qs}` : ""}`);
}
 static async getComments(taskId) {
    return this._request(`/tasks/${taskId}/comments`);
  }

  static async addComment(taskId, commentData) {
    return this._request(`/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify(commentData)
    });
  }

  static async updateComment(commentId, commentData) {
    return this._request(`/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify(commentData)
    });
  }

  static async deleteComment(commentId) {
    return this._request(`/comments/${commentId}`, {
      method: 'DELETE'
    });
  }
  static create(data) {
    return this._request(`/tasks`, { method:'POST', body: JSON.stringify(data) });
  }
  static update(id, data) {
    return this._request(`/tasks/${id}`, { method:'PUT', body: JSON.stringify(data) });
  }
   static remove(id) {
    return this._request(`/tasks/${id}`, { method:'DELETE' });
  }
    static get(id) {
    return this._request(`/tasks/${id}`);
  }
  // Optionnel : commentaires stockés dans la tâche
  static addComment(id, comment) {
    return this._request(`/tasks/${id}/comments`, { method:'POST', body: JSON.stringify(comment) });
  }
  static listComments(id) {
    return this._request(`/tasks/${id}/comments`);
  }
}

// === Bootstrap très simple pour l’écran Tasks ===
// (Tu peux appeler ces fonctions depuis ton HTML actuel)
const TaskUI = (() => {
  let currentTaskId = null;

 async function loadTasksAndRender(renderFn){
    try{
        const tasks = await TaskAPI.list(); // ← ici ça appelle /tasks
        renderFn(tasks);
    }catch(e){
        Utils.showNotification(`Erreur chargement tâches: ${e.message}`,'error');
    }
}
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0,
          v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
async function createTaskFromForm(getFormValuesFn, onCreated){
  try{
    const payload = getFormValuesFn();

    // Utiliser directement l'UUID de l'employé sélectionné pour assigned_to
    // assigned_by sera généré côté serveur
    console.log("Payload envoyé :", payload);
    const t = await TaskAPI.create(payload);

    Utils.showNotification('Tâche créée','success');
    onCreated?.(t);
  }catch(e){
    Utils.showNotification(`Erreur création: ${e.message}`,'error');
  }
}


  async function showTaskDetails(id, renderDetailsFn){
    try{
      currentTaskId = id;
      // si ton API renvoie /tasks/:id, tu peux la créer; sinon filtre localement
      const tasks = await TaskAPI.list();
      const task = tasks.find(t=>t.id===id);
      if(!task) return;
      const comments = await safeListComments(id);
      renderDetailsFn({task, comments});
    }catch(e){
      Utils.showNotification(`Erreur détails: ${e.message}`,'error');
    }
  }

  async function addComment(text, userFullName, onDone){
    if(!currentTaskId || !text?.trim()) return;
    try{
      const c = await TaskAPI.addComment(currentTaskId, {
        user: userFullName || 'Utilisateur',
        text: text.trim(),
        timestamp: new Date().toISOString()
      });
      onDone?.(c);
      Utils.showNotification('Commentaire ajouté','success');
    }catch(e){
      Utils.showNotification(`Erreur commentaire: ${e.message}`,'error');
    }
  }

  async function toggleComplete(id, completed, onSaved){
    try{
      const t = await TaskAPI.update(id, { completed });
      onSaved?.(t);
      Utils.showNotification('Tâche mise à jour','success');
    }catch(e){
      Utils.showNotification(`Erreur mise à jour: ${e.message}`,'error');
    }
  }

  async function deleteTask(id, onDeleted){
    try{
      await TaskAPI.remove(id);
      onDeleted?.(id);
      Utils.showNotification('Tâche supprimée','success');
    }catch(e){
      Utils.showNotification(`Erreur suppression: ${e.message}`,'error');
    }
  }

  async function safeListComments(id){
    try{ return await TaskAPI.listComments(id); }
    catch{ return []; }
  }
  async function loadTaskComments(taskId) {
    try {
      const response = await APIService.getTaskComments(taskId);
      return response.comments || [];
    } catch (error) {
      console.error('Error loading comments:', error);
      return [];
    }
  }

  async function addNewComment(taskId, commentText, employeeId) {
    try {
      const response = await APIService.addComment(taskId, commentText, employeeId);
      
      if (response.success) {
        Utils.showNotification('Commentaire ajouté avec succès', 'success');
        return response.comment;
      } else {
        throw new Error(response.error || 'Failed to add comment');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      Utils.showNotification(`Erreur: ${error.message}`, 'error');
      throw error;
    }
  }

  async function updateExistingComment(commentId, commentText, employeeId) {
    try {
      const response = await APIService.updateComment(commentId, commentText, employeeId);
      
      if (response.success) {
        Utils.showNotification('Commentaire modifié avec succès', 'success');
        return response.comment;
      } else {
        throw new Error(response.error || 'Failed to update comment');
      }
    } catch (error) {
      console.error('Error updating comment:', error);
      Utils.showNotification(`Erreur: ${error.message}`, 'error');
      throw error;
    }
  }

  async function deleteExistingComment(commentId, employeeId) {
    try {
      const response = await APIService.deleteComment(commentId, employeeId);
      
      if (response.success) {
        Utils.showNotification('Commentaire supprimé avec succès', 'success');
        return true;
      } else {
        throw new Error(response.error || 'Failed to delete comment');
      }
    } catch (error) {
      console.error('Error deleting comment:', error);
      Utils.showNotification(`Erreur: ${error.message}`, 'error');
      throw error;
    }
  }
async function editComment(commentId, currentText) {
  // Échapper les guillemets simples pour éviter les erreurs
  const escapedText = currentText.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const newText = prompt('Modifier votre commentaire:', escapedText);
  
  if (newText === null) return; // Annulation
  if (newText.trim() === currentText.trim()) return; // Texte identique
  
  if (!newText.trim()) {
    Utils.showNotification('Le commentaire ne peut pas être vide', 'error');
    return;
  }
  
  try {
    const employeeId = getCurrentEmployeeId();
    if (!employeeId) {
      Utils.showNotification('Cannot identify current employee', 'error');
      return;
    }
    
    const response = await fetch(`${TASKS_API}/comments/${commentId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        comment: newText.trim(),
        employeeId: employeeId
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    
    if (data.success) {
      // Mettre à jour l'affichage du commentaire
      const commentElement = document.querySelector(`.comment[data-comment-id="${commentId}"] .comment-text`);
      if (commentElement) {
        commentElement.textContent = newText.trim();
      }
      Utils.showNotification('Commentaire modifié avec succès', 'success');
    } else {
      throw new Error(data.error || 'Failed to update comment');
    }
  } catch (error) {
    console.error('Error updating comment:', error);
    Utils.showNotification('Erreur lors de la modification: ' + error.message, 'error');
  }
}

// Fonction pour supprimer un commentaire (CORRIGÉE)
async function deleteComment(commentId) {
  if (!confirm('Êtes-vous sûr de vouloir supprimer ce commentaire?')) return;
  
  try {
    const employeeId = getCurrentEmployeeId();
    if (!employeeId) {
      Utils.showNotification('Cannot identify current employee', 'error');
      return;
    }
    
    const response = await fetch(`${TASKS_API}/comments/${commentId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ employeeId: employeeId })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    
    if (data.success) {
      // Supprimer l'élément du commentaire de l'interface
      const commentElement = document.querySelector(`.comment[data-comment-id="${commentId}"]`);
      if (commentElement) {
        commentElement.remove();
      }
      
      // Vérifier s'il reste des commentaires
      const commentsContainer = document.getElementById('taskComments');
      if (commentsContainer.children.length === 0) {
        commentsContainer.innerHTML = '<p class="text-gray-500 text-sm">No comments yet</p>';
      }
      
      Utils.showNotification('Commentaire supprimé avec succès', 'success');
    } else {
      throw new Error(data.error || 'Failed to delete comment');
    }
  } catch (error) {
    console.error('Error deleting comment:', error);
    Utils.showNotification('Erreur lors de la suppression: ' + error.message, 'error');
  }
}
 

  return {
    loadTasksAndRender,
    createTaskFromForm,
    showTaskDetails,
    addComment,
    toggleComplete,
    deleteTask,
    loadTaskComments,
    addNewComment,
    updateExistingComment,
    deleteExistingComment
  };
})();

// Expose utilitaires que ton HTML utilise déjà
// Utils is already exposed above if it was created
if (typeof Utils !== 'undefined') {
  window.Utils = Utils;
}
window.getStatusClass = getStatusClass;
window.getPriorityClass = getPriorityClass;
window.getTypeClass = getTypeClass;
window.setLanguage = setLanguage;
window.applyTranslations = applyTranslations;
window.editComment = editComment;
window.deleteComment = deleteComment;
window.TaskAPI = TaskAPI;
window.TaskUI = TaskUI;
