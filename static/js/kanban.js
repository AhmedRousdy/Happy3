// ---
// --- KANBAN.JS (Executive Edition) ---
// ---

let allTasks = [];
let isSyncing = false;
let currentView = 'executive'; // 'executive' or 'kanban'
let selectedReplyType = null; 
let selectedDelegate = null; // Stores selected contact for delegation

let currentSettings = {
    projects: [],
    tags: [],
    domains: []
};

// SLA_DAYS is now dynamic, initialized with default but updated from backend
let slaDays = 4; 

// --- BATCHING CONFIGURATION ---
const BATCH_SYNC_COOLDOWN_MINUTES = 60; // Suggest waiting 1 hour between checks
const BATCH_SCHEDULE = ["09:00", "13:00", "16:30"]; // Recommended times

document.addEventListener('DOMContentLoaded', () => {
    console.log("[Kanban] Initializing...");
    
    // Force reset button states
    const syncBtn = document.getElementById('syncBtn');
    if(syncBtn) {
        syncBtn.disabled = false;
        const textEl = document.getElementById('syncText');
        const iconEl = document.getElementById('syncIcon');
        const spinnerEl = document.getElementById('syncSpinner');
        if(textEl) textEl.textContent = 'Sync New Emails';
        if(iconEl) iconEl.classList.remove('hidden');
        if(spinnerEl) spinnerEl.classList.add('hidden');
    }

    const histBtn = document.getElementById('historicalSyncBtn');
    if(histBtn) {
        histBtn.disabled = false;
        histBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
    
    // Initial data fetch: Settings (for SLA) first, then Tasks
    fetchSettingsAndTasks();
    updateLastSyncTime();
    checkBatchingStatus(); // Check if we are in a "cooldown"
    
    // Setup Drag and Drop for Columns (Static Elements)
    setupDragAndDrop();

    // --- SAFE EVENT LISTENER HELPER ---
    const addListener = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(event, (e) => {
                if (el.tagName === 'BUTTON' || el.tagName === 'A') e.preventDefault();
                handler(e);
            });
        }
    };

    // Core Listeners
    addListener('syncBtn', 'click', () => handleSyncClick());
    addListener('forceSyncLink', 'click', () => syncEmails(false)); // Hidden override
    addListener('historicalSyncBtn', 'click', syncHistoricalDate);

    // Filter Listeners
    addListener('filterProject', 'change', () => renderTasks(allTasks));
    addListener('filterSender', 'change', () => renderTasks(allTasks));
    addListener('clearFiltersBtn', 'click', clearFilters);

    // Task Modal Listeners
    addListener('modalCloseBtn', 'click', closeTaskModal);
    addListener('modalCopyBtn', 'click', copyCustomReply); 
    addListener('modalSendBtn', 'click', sendReply); 
    addListener('modalDeleteBtn', 'click', () => {
        const modal = document.getElementById('taskModalPanel') || document.getElementById('taskModal');
        if (modal) {
            const id = modal.dataset.currentTaskId;
            if(id) openDeleteModal(null, id);
        }
    });
    
    document.querySelectorAll('.task-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTaskTab(e.target.dataset.tab));
    });
    
    addListener('settingsBtn', 'click', openSettingsModal);
    addListener('settingsCloseBtn', 'click', closeSettingsModal);
    addListener('settingsSaveBtn', 'click', saveSettings);
    
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchSettingsTab(e.target.dataset.tab));
    });
    
    addListener('deleteCancelBtn', 'click', closeDeleteModal);
    addListener('deleteConfirmBtn', 'click', confirmDelete);

    // Delegation Listeners
    const delegateInput = document.getElementById('delegateSearch');
    if(delegateInput) {
        delegateInput.addEventListener('input', (e) => searchContacts(e.target.value));
    }
});

// --- INITIALIZATION HELPER ---
async function fetchSettingsAndTasks() {
    try {
        // Fetch settings first to get SLA config
        const settingsRes = await fetch('/api/settings');
        if (settingsRes.ok) {
            const settings = await settingsRes.json();
            if (settings.sla_days) {
                slaDays = parseInt(settings.sla_days);
                console.log(`[Kanban] SLA threshold set to ${slaDays} days from backend.`);
            }
        }
    } catch (e) {
        console.error("Failed to load settings", e);
    } finally {
        // Always load tasks
        getTasks();
    }
}

// --- FILTER LOGIC ---

function populateFilters(tasks) {
    const projectSelect = document.getElementById('filterProject');
    const senderSelect = document.getElementById('filterSender');
    
    if (!projectSelect || !senderSelect) return;

    // Get current selections to preserve them if possible
    const currentProject = projectSelect.value;
    const currentSender = senderSelect.value;

    const projects = new Set();
    const senders = new Set();

    tasks.forEach(task => {
        if (task.project && task.project !== 'Unknown') projects.add(task.project);
        if (task.sender) senders.add(task.sender);
    });

    // Sort alphabetically
    const sortedProjects = Array.from(projects).sort();
    const sortedSenders = Array.from(senders).sort();

    // Populate Project Dropdown
    projectSelect.innerHTML = '<option value="">All Projects</option>';
    sortedProjects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        projectSelect.appendChild(opt);
    });
    
    // Populate Sender Dropdown
    senderSelect.innerHTML = '<option value="">All Senders (Circle)</option>';
    sortedSenders.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        senderSelect.appendChild(opt);
    });

    // Restore selection if valid
    if (projects.has(currentProject)) projectSelect.value = currentProject;
    if (senders.has(currentSender)) senderSelect.value = currentSender;
    
    toggleClearButton();
}

function clearFilters() {
    const p = document.getElementById('filterProject');
    const s = document.getElementById('filterSender');
    if(p) p.value = "";
    if(s) s.value = "";
    renderTasks(allTasks);
}

function toggleClearButton() {
    const p = document.getElementById('filterProject');
    const s = document.getElementById('filterSender');
    const btn = document.getElementById('clearFiltersBtn');
    if (!p || !s || !btn) return;
    
    if (p.value || s.value) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

// --- RENDER TASKS (Dual View) ---
function renderTasks(tasks) {
    const cols = { 
        // Executive View
        quick: [], deep: [], waiting: [],
        // Kanban View
        todo: [], doing: [], paused: []
    };
    
    // --- APPLY FILTERS ---
    const filterProject = document.getElementById('filterProject')?.value;
    const filterSender = document.getElementById('filterSender')?.value;
    
    toggleClearButton(); // Update UI visibility of 'Clear' button

    tasks.forEach(t => {
        // Common Exclusions
        if(t.status === 'closed' || t.status === 'archived') return;

        // Filter Logic
        if (filterProject && t.project !== filterProject) return;
        if (filterSender && t.sender !== filterSender) return;

        // Executive View Logic (Sort by Category)
        if (t.triage_category === 'waiting_for') cols.waiting.push(t);
        else if (t.triage_category === 'quick_action') cols.quick.push(t);
        else if (t.triage_category === 'deep_work') cols.deep.push(t);
        else cols.deep.push(t); // Default fallback

        // Kanban View Logic (Sort by Status)
        if (t.status === 'new') cols.todo.push(t);
        else if (t.status === 'in_progress') cols.doing.push(t);
        else if (t.status === 'paused') cols.paused.push(t);
    });
    
    const sortFn = (a, b) => {
        const pMap = {high:3, medium:2, low:1};
        const pA = pMap[a.priority]||1, pB = pMap[b.priority]||1;
        if(pA !== pB) return pB - pA;
        return new Date(b.created_at) - new Date(a.created_at);
    };
    
    // Sort all arrays
    Object.values(cols).forEach(arr => arr.sort(sortFn));

    // Clear Executive Cols
    document.getElementById('quick-tasks').innerHTML = '';
    document.getElementById('deep-tasks').innerHTML = '';
    document.getElementById('waiting-tasks').innerHTML = '';
    document.getElementById('count-quick').textContent = cols.quick.length;
    document.getElementById('count-deep').textContent = cols.deep.length;
    document.getElementById('count-waiting').textContent = cols.waiting.length;

    // Clear Kanban Cols
    document.getElementById('todo-tasks').innerHTML = '';
    document.getElementById('doing-tasks').innerHTML = '';
    document.getElementById('paused-tasks').innerHTML = '';
    document.getElementById('count-todo').textContent = cols.todo.length;
    document.getElementById('count-doing').textContent = cols.doing.length;
    document.getElementById('count-paused').textContent = cols.paused.length;

    // Render Logic based on currentView
    if (currentView === 'executive') {
        cols.quick.forEach(t => document.getElementById('quick-tasks').appendChild(createTaskCard(t)));
        cols.deep.forEach(t => document.getElementById('deep-tasks').appendChild(createTaskCard(t)));
        cols.waiting.forEach(t => document.getElementById('waiting-tasks').appendChild(createTaskCard(t)));
    } else {
        cols.todo.forEach(t => document.getElementById('todo-tasks').appendChild(createTaskCard(t)));
        cols.doing.forEach(t => document.getElementById('doing-tasks').appendChild(createTaskCard(t)));
        cols.paused.forEach(t => document.getElementById('paused-tasks').appendChild(createTaskCard(t)));
    }
}

// --- UI HELPERS (Global) ---
window.toggleModalMaximize = function(panelId, iconMaxId, iconMinId) {
    const panel = document.getElementById(panelId);
    const iconMax = document.getElementById(iconMaxId);
    const iconMin = document.getElementById(iconMinId);
    
    if (!panel) return;

    panel.classList.toggle('!w-full');
    panel.classList.toggle('!h-full');
    panel.classList.toggle('!max-w-none');
    panel.classList.toggle('!rounded-none');
    panel.classList.toggle('!m-0'); 
    
    const isMax = panel.classList.contains('!w-full');
    
    if (iconMax) iconMax.classList.toggle('hidden', isMax);
    if (iconMin) iconMin.classList.toggle('hidden', !isMax);
    
    if(iconMin && isMax && !iconMin.innerHTML.trim()) {
         iconMin.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9l-6-6M15 9h4.5M15 9V4.5M15 9l6-6M9 15v4.5M9 15H4.5M9 15l-6 6M15 15h4.5M15 15v4.5M15 15l6 6" />';
    }
}

window.toggleEmailHeader = function() {
    const details = document.getElementById('emailDetailsArea');
    const btnText = document.getElementById('headerToggleText');
    const icon = document.getElementById('headerToggleIcon');
    
    if (details.style.display === 'none') {
        details.style.display = 'block';
        if(btnText) btnText.innerText = 'Hide Details';
        if(icon) icon.classList.remove('rotate-180');
    } else {
        details.style.display = 'none';
        if(btnText) btnText.innerText = 'Show Details';
        if(icon) icon.classList.add('rotate-180');
    }
}

// --- HELPER: SLA Calculator (Uses dynamic slaDays) ---
function getSLAStatus(receivedDateStr) {
    if (!receivedDateStr) return { status: 'Unknown', color: 'bg-gray-100 text-gray-600', text: 'N/A', daysElapsed: 0 };

    const received = new Date(receivedDateStr);
    const now = new Date();
    const diffTime = now - received;
    const daysElapsed = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 

    let status = 'On Time';
    let color = 'bg-green-100 text-green-700';
    let isOverdue = false;
    let text = daysElapsed <= 0 ? 'Today' : `${daysElapsed}d ago`;

    // Use dynamic slaDays variable
    if (daysElapsed > slaDays) {
        status = 'Overdue';
        color = 'bg-red-100 text-red-700 font-bold';
        isOverdue = true;
    } else if (daysElapsed >= slaDays - 1) { 
        status = 'At Risk';
        color = 'bg-orange-100 text-orange-700';
    }

    return { status, color, text, daysElapsed, isOverdue, fullDate: received.toLocaleString() };
}

// --- View Original Email Logic ---
window.viewOriginalEmail = async function() {
    const modal = document.getElementById('taskModalPanel') || document.getElementById('taskModal');
    const id = modal ? modal.dataset.currentTaskId : null;
    if (!id) return;

    const viewer = document.getElementById('emailViewerModal');
    viewer.classList.add('is-visible');
    
    const loadingEl = document.getElementById('emailLoading');
    const displayEl = document.getElementById('emailDisplay');
    
    loadingEl.classList.remove('hidden');
    displayEl.classList.add('hidden'); // Ensure content is hidden initially
    
    loadingEl.innerHTML = `
        <svg class="h-8 w-8 mr-3 sync-btn-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <path class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></path>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Fetching from Exchange...
    `;
    
    try {
        console.log(`[Kanban] Fetching email for task ${id}`);
        const response = await fetch(`/api/tasks/${id}/email`);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to fetch email');
        }
        
        const email = await response.json();
        
        document.getElementById('emailSubject').innerText = email.subject || '(No Subject)';
        document.getElementById('emailFrom').innerText = `${email.sender.name} <${email.sender.email}>`;
        document.getElementById('emailDate').innerText = email.received_at ? new Date(email.received_at).toLocaleString() : 'Unknown Date';
        
        const toList = email.to ? email.to.map(r => r.name).join(', ') : 'None';
        const ccList = email.cc ? email.cc.map(r => r.name).join(', ') : 'None';
        document.getElementById('emailTo').innerText = toList;
        document.getElementById('emailCc').innerText = ccList;
        
        const attContainer = document.getElementById('emailAttachments');
        attContainer.innerHTML = '';
        if (email.attachments && email.attachments.length > 0) {
            attContainer.classList.remove('hidden');
            email.attachments.forEach(att => {
                const badge = document.createElement('div');
                badge.className = 'flex items-center bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs border border-slate-200';
                badge.innerHTML = `
                    <svg class="w-3 h-3 mr-1 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    ${att.name} <span class="ml-1 text-slate-400">(${Math.round(att.size/1024)}KB)</span>
                `;
                attContainer.appendChild(badge);
            });
        } else {
            attContainer.classList.add('hidden');
        }

        const frame = document.getElementById('emailFrame');
        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open();
        const content = `
            <html>
            <head>
                <style>
                    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 20px; color: #334155; }
                    a { color: #2563eb; }
                </style>
            </head>
            <body>${email.body || 'No content available.'}</body>
            </html>
        `;
        doc.write(content);
        doc.close();
        
        loadingEl.classList.add('hidden');
        displayEl.classList.remove('hidden'); // Show content

    } catch (e) {
        console.error("[Kanban] Email fetch error:", e);
        loadingEl.innerHTML = `
            <div class="text-center p-6">
                <svg class="h-12 w-12 text-red-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p class="text-red-500 font-medium">Error loading email</p>
                <p class="text-slate-500 text-sm mt-1">${e.message}</p>
            </div>
        `;
    }
}

// --- MAIN FUNCTIONS ---

window.switchMainView = function(viewName) {
    currentView = viewName;
    const execTab = document.getElementById('tab-view-executive');
    const kanbanTab = document.getElementById('tab-view-kanban');
    const execView = document.getElementById('view-executive');
    const kanbanView = document.getElementById('view-kanban');

    if(viewName === 'executive') {
        execTab.classList.add('active', 'bg-white', 'text-primary');
        execTab.classList.remove('text-slate-500', 'hover:bg-slate-50');
        kanbanTab.classList.remove('active', 'bg-white', 'text-primary');
        kanbanTab.classList.add('text-slate-500', 'hover:bg-slate-50');
        
        execView.classList.remove('hidden');
        kanbanView.classList.add('hidden');
    } else {
        kanbanTab.classList.add('active', 'bg-white', 'text-primary');
        kanbanTab.classList.remove('text-slate-500', 'hover:bg-slate-50');
        execTab.classList.remove('active', 'bg-white', 'text-primary');
        execTab.classList.add('text-slate-500', 'hover:bg-slate-50');
        
        kanbanView.classList.remove('hidden');
        execView.classList.add('hidden');
    }
    
    // Re-render tasks to ensure they appear in the correct view
    renderTasks(allTasks);
}

window.copyReply = function(taskId, type) {
    const task = allTasks.find(x => x.id === parseInt(taskId));
    if (!task) return;

    selectedReplyType = type; 

    // --- DELEGATION FLOW ---
    if (type === 'delegate') {
        openDelegateModal();
        return; // Stop here, modal takes over
    }

    let text = "";
    if (type === 'acknowledge') text = task.reply_acknowledge;
    else if (type === 'done') text = task.reply_done;

    if (!text && type === 'acknowledge' && task.suggested_reply) {
        text = task.suggested_reply;
    }

    if (!text) {
        showMessage('No reply generated for this option.', 'error');
        return;
    }

    const replyBox = document.getElementById('modalTaskReply');
    if (replyBox) {
        replyBox.value = text;
        switchTaskTab('reply'); 
        showMessage(`Draft updated for '${type}'`, 'success');
    }
}

window.copyCustomReply = function() {
    const el = document.getElementById('modalTaskReply');
    if(el) {
        navigator.clipboard.writeText(el.value); 
        showMessage('Custom reply copied!', 'success'); 
    }
}

// --- Helper to refresh modal buttons based on current task state ---
function refreshModalState(taskId) {
    const task = allTasks.find(t => t.id == taskId);
    if (!task) return;

    const startBtn = document.getElementById('modalStartBtn');
    if (startBtn) {
        // Clone to remove old event listeners
        const newStartBtn = startBtn.cloneNode(true);
        startBtn.parentNode.replaceChild(newStartBtn, startBtn);
        
        if (task.status === 'in_progress') {
            newStartBtn.textContent = 'Pause';
            newStartBtn.onclick = () => updateTaskStatus('paused', taskId);
            newStartBtn.className = "pill-btn bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 px-4";
        } else if (task.status === 'paused') {
            newStartBtn.textContent = 'Resume';
            newStartBtn.onclick = () => updateTaskStatus('in_progress', taskId);
            newStartBtn.className = "pill-btn bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 px-4";
        } else {
            newStartBtn.textContent = 'Start';
            newStartBtn.onclick = () => updateTaskStatus('in_progress', taskId);
            newStartBtn.className = "pill-btn bg-white border border-slate-300 text-slate-700 hover:text-blue-700 hover:border-blue-300 hover:bg-blue-50 px-4";
        }
    }

    const completeBtn = document.getElementById('modalCompleteBtn');
    if (completeBtn) {
        const newCompleteBtn = completeBtn.cloneNode(true);
        completeBtn.parentNode.replaceChild(newCompleteBtn, completeBtn);
        newCompleteBtn.onclick = () => updateTaskStatus('closed', taskId);
    }
}

window.updateTask = async function(id, payload) {
    try {
        const response = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error('Failed to update task');
        
        await getTasks(); 
        
        // Update modal if it's open for this task
        const modal = document.getElementById('taskModalPanel');
        if (modal && modal.dataset.currentTaskId == id) {
            if (payload.status === 'closed' || payload.status === 'archived') {
                window.closeTaskModal();
            } else {
                refreshModalState(id);
            }
        }
        
        showMessage('Task updated', 'success');
        
    } catch (error) {
        console.error('Update error:', error);
        showMessage(error.message, 'error');
    }
}

window.updateTaskStatus = function(newStatus, taskId = null) {
    const modal = document.getElementById('taskModalPanel') || document.getElementById('taskModal');
    const id = taskId || (modal ? modal.dataset.currentTaskId : null);
    if (!id) return;
    
    updateTask(id, { status: newStatus });
}

window.updateTaskCategory = function(newCategory, taskId) {
    if (!taskId) return;
    updateTask(taskId, { triage_category: newCategory });
}

window.switchTaskTab = function(tabName) {
    document.querySelectorAll('.task-tab-btn').forEach(btn => {
        if(btn.dataset.tab === tabName) {
            btn.classList.add('active', 'text-primary', 'border-primary');
            btn.classList.remove('text-slate-500', 'border-transparent');
        } else {
            btn.classList.remove('active', 'text-primary', 'border-primary');
            btn.classList.add('text-slate-500', 'border-transparent');
        }
    });
    
    const overview = document.getElementById('task-tab-overview');
    const reply = document.getElementById('task-tab-reply');
    
    if(overview) overview.classList.toggle('hidden', tabName !== 'overview');
    if(reply) reply.classList.toggle('hidden', tabName !== 'reply');
    
    const replyActions = document.getElementById('replyActions');
    if (replyActions) {
        if (tabName === 'reply') {
            replyActions.classList.remove('hidden');
        } else {
            replyActions.classList.add('hidden');
        }
    }
}

window.switchSettingsTab = function(tabName) {
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        if(btn.dataset.tab === tabName) {
            btn.classList.add('active', 'text-primary', 'border-b-2', 'border-primary');
            btn.classList.remove('text-slate-500');
        } else {
            btn.classList.remove('active', 'text-primary', 'border-b-2', 'border-primary');
            btn.classList.add('text-slate-500');
        }
    });
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.toggle('hidden', content.id !== `tab-${tabName}`);
    });
}

window.openSettingsModal = async function() {
    try {
        const response = await fetch('/api/settings');
        if (!response.ok) throw new Error('Failed to load settings.');
        const settings = await response.json();
        
        const modelInput = document.getElementById('ollamaModelInput');
        if(modelInput) modelInput.value = settings.ollama_model;
        
        currentSettings.projects = settings.projects || [];
        currentSettings.tags = settings.tags || [];
        currentSettings.domains = settings.domains || [];
        
        renderTags('projectsList', currentSettings.projects);
        renderTags('tagsList', currentSettings.tags);
        renderTags('domainsList', currentSettings.domains);
        
        const overlay = document.getElementById('settingsOverlay');
        if(overlay) overlay.classList.add('is-visible');
    } catch(error) {
        console.error('Error opening settings:', error);
        showMessage(error.message, 'error');
    }
}

function renderTags(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    items.forEach((item, index) => {
        const tag = document.createElement('span');
        tag.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-white border border-slate-300 text-slate-700 shadow-sm';
        tag.innerHTML = `${item}<button type="button" class="ml-2 text-slate-400 hover:text-red-500" onclick="removeTag('${containerId}', ${index})">&times;</button>`;
        container.appendChild(tag);
    });
}

window.addTag = function(containerId, value) {
    if (!value || value.trim() === '') return;
    const val = value.trim();
    if (containerId === 'projectsList') currentSettings.projects.push(val);
    if (containerId === 'tagsList') currentSettings.tags.push(val);
    if (containerId === 'domainsList') currentSettings.domains.push(val);
    
    renderTags(containerId, containerId === 'projectsList' ? currentSettings.projects : containerId === 'tagsList' ? currentSettings.tags : currentSettings.domains);
    
    const inputId = containerId === 'projectsList' ? 'newProjectInput' : containerId === 'tagsList' ? 'newTagInput' : 'newDomainInput';
    const input = document.getElementById(inputId);
    if(input) input.value = '';
}

window.removeTag = function(containerId, index) {
    if (containerId === 'projectsList') currentSettings.projects.splice(index, 1);
    if (containerId === 'tagsList') currentSettings.tags.splice(index, 1);
    if (containerId === 'domainsList') currentSettings.domains.splice(index, 1);
    renderTags(containerId, containerId === 'projectsList' ? currentSettings.projects : containerId === 'tagsList' ? currentSettings.tags : currentSettings.domains);
}

window.closeSettingsModal = function() { 
    const el = document.getElementById('settingsOverlay');
    if(el) el.classList.remove('is-visible'); 
}

window.saveSettings = async function() {
    const modelInput = document.getElementById('ollamaModelInput');
    const model = modelInput ? modelInput.value : '';
    
    const saveBtn = document.getElementById('settingsSaveBtn');
    const saveBtnText = document.getElementById('saveBtnText');

    if(saveBtn) saveBtn.disabled = true;
    if(saveBtnText) saveBtnText.textContent = 'Saving...';

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ollama_model: model,
                projects: currentSettings.projects,
                tags: currentSettings.tags,
                domains: currentSettings.domains
            })
        });
        if (!response.ok) throw new Error('Failed to save settings');
        showMessage('Settings saved successfully!', 'success');
        closeSettingsModal();
    } catch (error) {
        console.error('Error saving settings:', error);
        showMessage(error.message, 'error');
    } finally {
        if(saveBtn) saveBtn.disabled = false;
        if(saveBtnText) saveBtnText.textContent = 'Save All Settings';
    }
}

// --- STANDARD KANBAN FUNCTIONS ---

function showMessage(message, type = 'success') {
    const container = document.getElementById('message-container');
    if (!container) return;
    const colorClass = type === 'success' ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700';
    const msgDiv = document.createElement('div');
    msgDiv.className = `border ${colorClass} px-4 py-3 rounded-lg relative`;
    msgDiv.innerHTML = `<span class="block sm:inline">${message}</span>`;
    container.appendChild(msgDiv);
    setTimeout(() => msgDiv.remove(), 3000);
}

async function getTasks() {
    try {
        const response = await fetch('/api/tasks');
        if (!response.ok) throw new Error('Failed to fetch tasks');
        allTasks = await response.json();
        
        // Populate filters after fetch
        populateFilters(allTasks);
        
        renderTasks(allTasks);
    } catch (error) { showMessage(error.message, 'error'); }
}

async function updateLastSyncTime() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        const el = document.getElementById('lastSyncTime');
        
        // Also save to localStorage for fallback
        if (data.last_sync_time) {
            localStorage.setItem('lastSyncTime', data.last_sync_time);
        }
        
        if(el) el.textContent = data.last_sync_time ? `Last synced: ${new Date(data.last_sync_time).toLocaleString()}` : 'Last synced: Never';
    } catch (e) {}
}

// --- BATCHING ENFORCER LOGIC ---

function checkBatchingStatus() {
    const lastSync = localStorage.getItem('lastManualSync');
    if (!lastSync) return; // No previous sync

    const diffMins = (new Date() - new Date(lastSync)) / 1000 / 60;
    const btn = document.getElementById('syncBtn');
    const msgEl = document.getElementById('batchingMessage');
    const forceEl = document.getElementById('forceSyncLink');

    if (diffMins < BATCH_SYNC_COOLDOWN_MINUTES) {
        const waitTime = Math.ceil(BATCH_SYNC_COOLDOWN_MINUTES - diffMins);
        
        if (btn) {
            btn.classList.add('opacity-50', 'cursor-not-allowed');
            // Don't fully disable, just visual discouragement + confirmation
        }
        
        if (msgEl) {
            msgEl.classList.remove('hidden');
            msgEl.textContent = `Next batch in ${waitTime} min`;
        }
        
        if (forceEl) forceEl.classList.remove('hidden');
    } else {
        if (btn) btn.classList.remove('opacity-50', 'cursor-not-allowed');
        if (msgEl) msgEl.classList.add('hidden');
        if (forceEl) forceEl.classList.add('hidden');
    }
}

function handleSyncClick() {
    const lastSync = localStorage.getItem('lastManualSync');
    if (lastSync) {
        const diffMins = (new Date() - new Date(lastSync)) / 1000 / 60;
        if (diffMins < BATCH_SYNC_COOLDOWN_MINUTES) {
            // Shake the button or show a toast
            showMessage(`Hold on! It's better to batch emails. <a href="#" onclick="syncEmails(false)" class="underline font-bold">Sync anyway?</a>`, 'error');
            return;
        }
    }
    syncEmails(false);
}

async function syncEmails(isAutoSync = false) {
    if (isSyncing) {
        if(!isAutoSync) showMessage('Sync already in progress...', 'error');
        return;
    }
    isSyncing = true;
    
    // Save timestamp for batching logic
    if (!isAutoSync) {
        localStorage.setItem('lastManualSync', new Date().toISOString());
        checkBatchingStatus(); // Update UI immediately
    }
    
    const btn = document.getElementById('syncBtn');
    const textEl = document.getElementById('syncText');
    const iconEl = document.getElementById('syncIcon');
    const spinnerEl = document.getElementById('syncSpinner');

    if(!isAutoSync && btn) { 
        btn.disabled = true; 
        if(textEl) textEl.textContent = 'Syncing...'; 
        if(iconEl) iconEl.classList.add('hidden'); 
        if(spinnerEl) spinnerEl.classList.remove('hidden'); 
    }
    
    try {
        const res = await fetch('/api/sync', { method: 'POST' });
        if(!res.ok) throw new Error('Sync failed');
        const data = await res.json();
        
        if(!isAutoSync) showMessage(data.message || 'Sync complete!', 'success');
        await getTasks();
    } catch(e) { 
        if(!isAutoSync) showMessage(e.message, 'error'); 
    } finally { 
        isSyncing = false; 
        updateLastSyncTime(); 
        if(!isAutoSync && btn) { 
            btn.disabled = false; 
            if(textEl) textEl.textContent = 'Sync New Emails'; 
            if(iconEl) iconEl.classList.remove('hidden'); 
            if(spinnerEl) spinnerEl.classList.add('hidden'); 
        }
    }
}

async function syncHistoricalDate() {
    const dateInput = document.getElementById('historicalSyncDate');
    const date = dateInput ? dateInput.value : null;
    const btn = document.getElementById('historicalSyncBtn');
    
    if(!date) return showMessage('Select a date', 'error');
    if(isSyncing) return showMessage('Sync is currently busy. Please wait.', 'error');
    
    isSyncing = true;
    const originalContent = btn ? btn.innerHTML : 'Sync Date';
    if(btn) {
        btn.disabled = true;
        btn.textContent = 'Scanning...';
        btn.classList.add('opacity-75', 'cursor-not-allowed');
    }
    
    try {
        const res = await fetch('/api/sync/historical', { 
            method: 'POST', 
            headers:{'Content-Type':'application/json'}, 
            body: JSON.stringify({date}) 
        });
        
        if(!res.ok) throw new Error('Failed');
        const data = await res.json();
        showMessage(data.message || 'Historical sync done', 'success');
        await getTasks();
    } catch(e) { showMessage(e.message, 'error'); } 
    finally { 
        isSyncing = false;
        if(btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent; 
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    }
}

function createTaskCard(task) {
    const div = document.createElement('div');
    
    // SLA Calc
    const sla = getSLAStatus(task.received_at || task.created_at);
    const pulseClass = (sla.isOverdue && task.status !== 'closed' && task.status !== 'paused') ? 'sla-overdue-pulse' : '';
    
    const opacityClass = (task.status === 'paused') ? 'opacity-75 border-slate-300' : '';

    div.className = `task-card bg-white rounded-lg shadow-sm border border-slate-200 p-4 hover:shadow-md hover:border-primary hover:-translate-y-1 transition-all duration-200 cursor-move relative group ${pulseClass} ${opacityClass}`;
    div.draggable = true;
    div.dataset.taskId = task.id;
    div.id = `task-${task.id}`;
    
    // Setup Drag Events
    div.addEventListener('dragstart', handleDragStart);
    
    let pBadge = '';
    if(task.priority === 'high') pBadge = `<span class="priority-label bg-red-100 text-danger">High</span>`;
    
    let delegateInfo = '';
    if (task.delegated_to) {
        delegateInfo = `<div class="mt-2 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded border border-purple-100">
            <span class="font-bold">Delegated to:</span> ${task.delegated_to}
        </div>`;
    }

    // Status Label logic
    let statusLabel = '';
    if (task.status === 'new') {
        statusLabel = `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 mr-2">New</span>`;
    } else if (task.status === 'in_progress') {
        statusLabel = `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100 mr-2">In Progress</span>`;
    } else if (task.status === 'paused') {
        statusLabel = `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 mr-2">Paused</span>`;
    } else if (task.status === 'closed') {
        statusLabel = `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-50 text-green-600 border border-green-100 mr-2">Closed</span>`;
    }

    let actionBtn = `
        <button onclick="openTaskModal(event, ${task.id})" class="text-xs font-semibold text-primary hover:underline">View Details</button>
    `;

    // Dynamic Quick Actions
    let quickActions = '';
    if (task.status === 'in_progress') {
        quickActions = `
            <button onclick="event.stopPropagation(); updateTaskStatus('paused', ${task.id})" class="p-1.5 text-slate-400 hover:text-amber-600 rounded hover:bg-amber-50 transition-colors" title="Pause Task">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
            <button onclick="event.stopPropagation(); updateTaskStatus('closed', ${task.id})" class="p-1.5 text-slate-400 hover:text-green-600 rounded hover:bg-green-50 transition-colors" title="Quick Complete">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
        `;
    } else if (task.status === 'paused') {
        quickActions = `
            <button onclick="event.stopPropagation(); updateTaskStatus('in_progress', ${task.id})" class="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors" title="Resume Task">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
            <button onclick="event.stopPropagation(); updateTaskStatus('closed', ${task.id})" class="p-1.5 text-slate-400 hover:text-green-600 rounded hover:bg-green-50 transition-colors" title="Quick Complete">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
        `;
    } else {
        quickActions = `
            <button onclick="event.stopPropagation(); updateTaskStatus('closed', ${task.id})" class="p-1.5 text-slate-400 hover:text-green-600 rounded hover:bg-green-50 transition-colors" title="Quick Complete">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
        `;
    }

    div.innerHTML = `
        <div class="flex justify-between items-start mb-1">
            <span class="text-xs font-semibold text-slate-400 uppercase">${task.project || 'Unknown'}</span>
            ${pBadge}
        </div>
        
        <div class="flex items-center gap-1 mb-2" title="Received: ${sla.fullDate}">
            ${statusLabel}
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${sla.color}">
                ${sla.status}
            </span>
            <span class="text-xs text-slate-400 ml-1">${sla.text}</span>
        </div>

        <h3 class="font-semibold text-slate-800 leading-tight mb-2">${task.task_summary}</h3>
        ${delegateInfo}
        
        <div class="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center">
            ${actionBtn}
            
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                ${quickActions}
                <button onclick="openDeleteModal(event, ${task.id})" class="p-1.5 text-slate-400 hover:text-danger rounded hover:bg-red-50 transition-colors" title="Delete">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </div>
        </div>
    `;
    return div;
}

window.openTaskModal = function(e, id) {
    e.stopPropagation();
    const t = allTasks.find(x => x.id === id);
    if(!t) return;
    
    selectedReplyType = null; // Reset reply type on open
    switchTaskTab('overview');
    
    const modal = document.getElementById('taskModalPanel') || document.getElementById('taskModal');
    if(!modal) return;
    
    modal.dataset.currentTaskId = id;
    
    const setSafeText = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
    const setSafeValue = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
    
    setSafeText('modalTaskTitle', t.task_summary);
    setSafeText('modalTaskProject', t.project);
    setSafeText('modalTaskDetail', t.task_detail);
    setSafeText('modalTaskAction', t.required_action || 'No immediate action required.');
    
    // Auto-Completion Alert
    const alertBox = document.getElementById('modalAutoCompleteAlert');
    const alertText = document.getElementById('modalAutoCompleteText');
    if (t.completion_evidence && alertBox && alertText) {
        alertBox.classList.remove('hidden');
        alertText.textContent = t.completion_evidence;
    } else if (alertBox) {
        alertBox.classList.add('hidden');
    }
    
    setSafeValue('modalTaskReply', t.reply_acknowledge || t.suggested_reply || ""); 
    
    setSafeText('modalTaskDomain', t.domain_hint || 'N/A');
    setSafeText('modalTaskSender', t.sender);
    setSafeText('modalTaskTo', (t.to_recipients_json ? JSON.parse(t.to_recipients_json).join(', ') : 'Me'));
    setSafeText('modalTaskSubject', t.subject);

    const tagCont = document.getElementById('modalTagsContainer');
    if(tagCont) {
        tagCont.innerHTML = '';
        if(t.tags) t.tags.forEach(tag => {
            const s = document.createElement('span'); s.className = 'text-xs font-semibold px-2 py-1 rounded bg-slate-100 text-slate-600'; s.textContent = tag;
            tagCont.appendChild(s);
        });
    }

    const btnAck = document.getElementById('btnReplyAck');
    const btnDone = document.getElementById('btnReplyDone');
    const btnDel = document.getElementById('btnReplyDelegate');
    
    if(btnAck) btnAck.onclick = () => copyReply(id, 'acknowledge');
    if(btnDone) btnDone.onclick = () => copyReply(id, 'done');
    if(btnDel) btnDel.onclick = () => copyReply(id, 'delegate'); 

    // --- Dynamic Action Buttons Logic ---
    refreshModalState(id);

    const overlay = document.getElementById('taskModalOverlay');
    if(overlay) overlay.classList.add('is-visible');
}

window.closeTaskModal = function() { 
    const el = document.getElementById('taskModalOverlay');
    if(el) el.classList.remove('is-visible'); 
}

window.openDeleteModal = function(e, id) { 
    if(e) e.stopPropagation(); 
    const modal = document.getElementById('confirmDeleteModal');
    if(modal) {
        modal.dataset.id = id; 
        modal.classList.add('is-visible'); 
    }
}

window.closeDeleteModal = function() { 
    const el = document.getElementById('confirmDeleteModal');
    if(el) el.classList.remove('is-visible'); 
}

window.confirmDelete = async function() {
    const modal = document.getElementById('confirmDeleteModal');
    const id = modal ? modal.dataset.id : null;
    if(!id) return;
    
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    closeDeleteModal(); 
    closeTaskModal(); 
    getTasks(); 
    showMessage('Deleted', 'success');
}

window.sendReply = async function(e) {
    if(e) e.preventDefault();
    console.log("[Kanban] Send Reply triggered");

    const btn = document.getElementById('modalSendBtn');
    const originalText = btn ? btn.innerText : 'Send Email';

    const modal = document.getElementById('taskModalPanel') || document.getElementById('taskModal');
    const id = modal ? modal.dataset.currentTaskId : null;
    const replyEl = document.getElementById('modalTaskReply');
    
    if(!id) return showMessage('Error: Task ID missing', 'error');
    if(!replyEl || !replyEl.value.trim()) return showMessage('Please enter a reply text.', 'error');
    
    if(btn) { btn.disabled = true; btn.innerText = 'Sending...'; }

    try {
        const response = await fetch(`/api/tasks/${id}/reply`, { 
            method: 'POST', 
            headers:{'Content-Type':'application/json'}, 
            body: JSON.stringify({
                reply_body: replyEl.value,
                reply_type: selectedReplyType 
            }) 
        });
        
        if(!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to send email');
        }

        closeTaskModal(); 
        getTasks(); 
        showMessage('Email sent successfully!', 'success');
    } catch(error) {
        showMessage(error.message, 'error');
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = originalText; }
    }
}

// --- DELEGATION MODAL LOGIC ---

window.openDelegateModal = function() {
    selectedDelegate = null;
    const list = document.getElementById('delegateList');
    list.innerHTML = '<p class="text-xs text-slate-400 p-2">Start typing to search...</p>';
    document.getElementById('delegateSearch').value = '';
    document.getElementById('confirmDelegateBtn').disabled = true;
    
    document.getElementById('delegateModalOverlay').classList.add('is-visible');
    searchContacts('');
}

window.closeDelegateModal = function() {
    document.getElementById('delegateModalOverlay').classList.remove('is-visible');
}

window.searchContacts = async function(query) {
    const list = document.getElementById('delegateList');
    
    try {
        const res = await fetch(`/api/circle?search=${encodeURIComponent(query)}`);
        const contacts = await res.json();
        
        list.innerHTML = '';
        if (contacts.length === 0) {
            list.innerHTML = '<p class="text-xs text-slate-400 p-2">No contacts found.</p>';
            return;
        }
        
        contacts.forEach(c => {
            const div = document.createElement('div');
            div.className = "flex items-center justify-between p-2 hover:bg-slate-100 rounded cursor-pointer transition-colors";
            div.innerHTML = `
                <div>
                    <p class="text-sm font-semibold text-slate-800">${c.name || 'Unknown'}</p>
                    <p class="text-xs text-slate-500">${c.email}</p>
                </div>
                <span class="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded">${c.manual_role || '-'}</span>
            `;
            div.onclick = () => selectContact(div, c);
            list.appendChild(div);
        });
    } catch (e) {
        console.error("Search failed", e);
    }
}

window.selectContact = function(el, contact) {
    const list = document.getElementById('delegateList');
    Array.from(list.children).forEach(c => c.classList.remove('bg-purple-50', 'border-purple-200'));
    el.classList.add('bg-purple-50', 'border', 'border-purple-200');
    
    selectedDelegate = contact;
    
    const btn = document.getElementById('confirmDelegateBtn');
    btn.disabled = false;
    btn.innerText = `Delegate to ${contact.name.split(' ')[0]}`;
}

window.confirmDelegation = async function() {
    if (!selectedDelegate) return;
    
    const taskModal = document.getElementById('taskModalPanel');
    const taskId = taskModal.dataset.currentTaskId;
    
    // 1. Generate Delegation Text (RESTORED LOGIC)
    const task = allTasks.find(t => t.id == taskId);
    // Use stored AI draft if available, otherwise default template
    const baseText = task ? task.reply_delegate : "";
    const replyText = baseText || 
        `Hi ${selectedDelegate.name.split(' ')[0]},\n\nPlease handle this request. Let me know if you need any guidance.\n\nThanks,`;
    
    // 2. Populate the Reply Box
    const replyBox = document.getElementById('modalTaskReply');
    if(replyBox) {
        replyBox.value = replyText;
    }

    // 3. Update Task in Backend
    updateTask(taskId, {
        triage_category: 'waiting_for',
        delegated_to: selectedDelegate.name
    });
    
    showMessage(`Task delegated to ${selectedDelegate.name}`, 'success');
    closeDelegateModal();
    
    // 4. Switch to Reply Tab so user can send
    switchTaskTab('reply'); 
}

// --- DRAG AND DROP LOGIC ---

function setupDragAndDrop() {
    const columns = document.querySelectorAll('.task-column');
    columns.forEach(col => {
        // Prevent default to allow drop
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move"; // Explicitly visual
            col.classList.add('bg-slate-100'); // Highlight
        });
        
        col.addEventListener('dragleave', (e) => {
            col.classList.remove('bg-slate-100');
        });
        
        col.addEventListener('drop', handleDrop);
    });
}

function handleDragStart(e) {
    e.dataTransfer.setData("text/plain", e.target.dataset.taskId);
    e.dataTransfer.effectAllowed = "move";
}

function handleDrop(e) {
    e.preventDefault();
    const column = e.target.closest('.task-column');
    if (!column) return;
    column.classList.remove('bg-slate-100');

    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    // Detect drop type based on container attributes
    const targetStatus = column.dataset.status;
    const targetCategory = column.dataset.category;

    if (targetStatus) {
        // Dropped in Kanban View -> Change Status
        updateTaskStatus(targetStatus, taskId);
    } else if (targetCategory) {
        // Dropped in Executive View -> Change Category
        updateTaskCategory(targetCategory, taskId);
    }
}