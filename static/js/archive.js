// ---
// --- ARCHIVE.JS (Closed Tasks Manager) ---
// ---

let recentTasks = [];
let archivedTasks = [];
let currentTab = 'recent'; 

document.addEventListener('DOMContentLoaded', () => {
    // Initial Load
    fetchClosedTasks();
    
    document.getElementById('exportCsvBtn').addEventListener('click', exportToCSV);
    document.getElementById('archiveSearchInput').addEventListener('input', filterArchive);
    
    // Tab Listeners
    document.querySelectorAll('.archive-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchArchiveTab(e.target.dataset.tab));
    });
});

/**
 * Displays a success or error message.
 */
function showMessage(message, type = 'success') {
    const container = document.getElementById('message-container');
    const colorClass = type === 'success' ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700';
    const msgDiv = document.createElement('div');
    msgDiv.className = `border ${colorClass} px-4 py-3 rounded-lg relative`;
    msgDiv.innerHTML = `<span class="block sm:inline">${message}</span>`;
    container.appendChild(msgDiv);
    setTimeout(() => msgDiv.remove(), 3000);
}

// --- TAB LOGIC ---
function switchArchiveTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.archive-tab-btn').forEach(btn => {
        if(btn.dataset.tab === tabName) {
            btn.classList.add('active', 'text-green-700', 'border-green-600', 'font-bold');
            btn.classList.remove('text-slate-500', 'border-transparent', 'font-semibold');
        } else {
            btn.classList.remove('active', 'text-green-700', 'border-green-600', 'font-bold');
            btn.classList.add('text-slate-500', 'border-transparent', 'font-semibold');
        }
    });
    
    const recentDiv = document.getElementById('tab-recent');
    const archiveDiv = document.getElementById('tab-archived');
    
    if (tabName === 'recent') {
        recentDiv.classList.remove('hidden');
        archiveDiv.classList.add('hidden');
    } else {
        recentDiv.classList.add('hidden');
        archiveDiv.classList.remove('hidden');
        // Fetch archive if empty
        if(archivedTasks.length === 0) fetchArchivedHistory();
    }
}

// --- DATA FETCHING ---

async function fetchClosedTasks() {
    try {
        // Fetch ALL tasks, then filter for status='closed' client-side
        // Note: API /tasks returns 'new', 'in_progress', 'closed' but NOT 'archived'
        const response = await fetch('/api/tasks');
        if (!response.ok) throw new Error('Failed to fetch tasks.');
        
        const all = await response.json();
        recentTasks = all.filter(t => t.status === 'closed');
        
        renderGrid(recentTasks, 'recent-grid-container', true);
        
    } catch(error) {
        console.error('Error opening closed view:', error);
        document.getElementById('recent-grid-container').innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
    }
}

async function fetchArchivedHistory() {
    try {
        const response = await fetch('/api/tasks/archived');
        if (!response.ok) throw new Error('Failed to fetch archive history.');
        
        archivedTasks = await response.json();
        renderGrid(archivedTasks, 'archive-grid-container', false);
        
    } catch(error) {
        document.getElementById('archive-grid-container').innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
    }
}

// --- SEARCH ---
async function filterArchive(event) {
    const term = event.target.value.toLowerCase();
    
    if (currentTab === 'recent') {
        const filtered = recentTasks.filter(t => 
            (t.task_summary && t.task_summary.toLowerCase().includes(term)) ||
            (t.sender && t.sender.toLowerCase().includes(term)) ||
            (t.subject && t.subject.toLowerCase().includes(term))
        );
        renderGrid(filtered, 'recent-grid-container', true);
    } else {
        // Server-side search for archived
        const container = document.getElementById('archive-grid-container');
        container.innerHTML = '<p class="text-slate-500">Searching...</p>';
        try {
            const response = await fetch(`/api/tasks/archived?search=${encodeURIComponent(term)}`);
            if (!response.ok) throw new Error('Failed to search.');
            const results = await response.json();
            renderGrid(results, 'archive-grid-container', false);
        } catch(e) {
            container.innerHTML = `<p class="text-red-500">${e.message}</p>`;
        }
    }
}

// --- RENDER GRID ---
function renderGrid(tasks, containerId, allowReopen) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if (tasks.length === 0) {
        container.innerHTML = '<p class="text-slate-500 p-4">No tasks found.</p>';
        return;
    }
    
    // Group by Date
    const groups = {};
    tasks.forEach(task => {
        // Use status_updated_at for closing date, fallback to created_at
        const dateVal = task.status_updated_at || task.created_at;
        const date = new Date(dateVal);
        const monthYear = date.toLocaleString('default', { month: 'long', year: 'numeric' });
        
        if (!groups[monthYear]) groups[monthYear] = [];
        groups[monthYear].push(task);
    });
    
    let html = '<div id="archive-grid">';
    
    // Headers (Desktop)
    html += `
        <div class="archive-header hidden md:block" style="grid-column: 1">Summary</div>
        <div class="archive-header hidden md:block" style="grid-column: 2">From</div>
        <div class="archive-header hidden md:block" style="grid-column: 3">Subject</div>
        <div class="archive-header hidden md:block" style="grid-column: 4">Action Taken</div>
        <div class="archive-header hidden md:block" style="grid-column: 5">Date Closed</div>
        <div class="archive-header hidden md:block" style="grid-column: 6">Actions</div>
    `;

    for (const groupName in groups) {
        html += `<h3 class="archive-month-header col-span-full">${groupName}</h3>`;
        
        groups[groupName].forEach(task => {
            const date = new Date(task.status_updated_at || task.created_at);
            
            // Reopen Button (Only for Recent)
            let actionBtn = '<span class="text-slate-400">-</span>';
            if (allowReopen) {
                actionBtn = `
                    <button onclick="reopenTask(${task.id})" class="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                        Reopen
                    </button>
                `;
            }

            html += `
                <div class="archive-cell font-medium text-slate-800" style="grid-column: 1" title="${task.task_summary}">
                    ${task.task_summary}
                </div>
                <div class="archive-cell text-slate-600" style="grid-column: 2" title="${task.sender}">
                    <span class="md:hidden font-bold">From: </span>${task.sender}
                </div>
                <div class="archive-cell text-slate-500 italic" style="grid-column: 3" title="${task.subject}">
                    <span class="md:hidden font-bold">Subject: </span>${task.subject}
                </div>
                <div class="archive-cell" style="grid-column: 4">
                    <span class="md:hidden font-bold">Action: </span>${task.action_taken || 'Closed'}
                </div>
                <div class="archive-cell text-slate-500" style="grid-column: 5">
                    <span class="md:hidden font-bold">Date: </span>${date.toLocaleDateString()}
                </div>
                <div class="archive-cell text-center" style="grid-column: 6">
                    ${actionBtn}
                </div>
            `;
        });
    }
    html += '</div>';
    container.innerHTML = html;
}

// --- ACTIONS ---

window.reopenTask = async function(id) {
    if(!confirm("Reopen this task and move it back to In Progress?")) return;
    
    try {
        const response = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({status: 'in_progress'})
        });
        
        if (!response.ok) throw new Error('Failed to reopen task');
        
        showMessage('Task reopened successfully!', 'success');
        fetchClosedTasks(); // Refresh
        
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

window.exportToCSV = function() {
    const list = currentTab === 'recent' ? recentTasks : archivedTasks;
    if (!list || list.length === 0) {
        showMessage('No tasks to export.', 'error');
        return;
    }
    
    let csvContent = "data:text/csv;charset=utf-8,";
    const headers = ["Summary", "From", "Subject", "Action Taken", "Date Closed"];
    csvContent += headers.join(",") + "\r\n";
    
    const escapeCSV = (str) => {
        if (!str) return '""';
        let newStr = String(str).replace(/(\r\n|\n|\r)/gm, ' ');
        if (newStr.includes(',')) newStr = `"${newStr.replace(/"/g, '""')}"`;
        return newStr;
    };

    list.forEach(t => {
        const row = [
            escapeCSV(t.task_summary),
            escapeCSV(t.sender),
            escapeCSV(t.subject),
            escapeCSV(t.action_taken),
            escapeCSV(new Date(t.status_updated_at || t.created_at).toLocaleDateString())
        ];
        csvContent += row.join(",") + "\r\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `closed_tasks_${currentTab}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}