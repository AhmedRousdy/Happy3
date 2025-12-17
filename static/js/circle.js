// ---
// --- CIRCLE.JS ---
// ---

let availableProjects = []; // Store projects loaded from settings

document.addEventListener('DOMContentLoaded', () => {
    fetchContacts();
    loadProjects(); // Fetch projects on load
    
    // Attach listeners
    document.getElementById('circleSearch').addEventListener('input', debounce(fetchContacts, 300));
    document.getElementById('roleFilter').addEventListener('change', fetchContacts);
    document.getElementById('contactForm').addEventListener('submit', handleFormSubmit);
    
    // Default dates for scan modal
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);
    document.getElementById('scanEndDate').valueAsDate = today;
    document.getElementById('scanStartDate').valueAsDate = lastMonth;
});

async function loadProjects() {
    try {
        const res = await fetch('/api/settings');
        if(res.ok) {
            const data = await res.json();
            availableProjects = data.projects || [];
        }
    } catch(e) { console.error("Failed to load projects", e); }
}

// --- Debounce Helper ---
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// --- Fetch Data ---
async function fetchContacts() {
    const search = document.getElementById('circleSearch').value;
    const role = document.getElementById('roleFilter').value;
    
    const tbody = document.getElementById('contactsTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-center text-slate-500">Loading...</td></tr>';

    try {
        const query = new URLSearchParams({ search, role });
        const res = await fetch(`/api/circle?${query}`);
        if (!res.ok) throw new Error('Failed to load contacts');
        
        const contacts = await res.json();
        renderTable(contacts);
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-red-500">Error: ${error.message}</td></tr>`;
    }
}

// --- Render Table ---
function renderTable(contacts) {
    const tbody = document.getElementById('contactsTableBody');
    tbody.innerHTML = '';

    if (contacts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-12 text-center">
                    <div class="flex flex-col items-center justify-center">
                        <svg class="h-12 w-12 text-slate-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <p class="text-slate-500 text-lg font-medium">No contacts found.</p>
                        <p class="text-slate-400 text-sm mt-1">Try adjusting your filters or sync your emails to discover contacts.</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    contacts.forEach(p => {
        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50 transition-colors group cursor-pointer";
        row.onclick = (e) => {
            if (e.target.closest('button') || e.target.closest('.delete-project-btn')) return;
            openProfileModal(p.id);
        };
        
        let roleBadge = '';
        if (p.manual_role === 'VIP') roleBadge = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700">VIP</span>';
        else if (p.manual_role) roleBadge = `<span class="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">${p.manual_role}</span>`;
        else roleBadge = '<span class="px-2 py-0.5 rounded text-xs text-slate-400 border border-slate-200">Unclassified</span>';

        // Format Projects for display
        let projectsHtml = '<span class="text-slate-400 text-xs">-</span>';
        if (p.projects && p.projects.length > 0) {
            // Handle both legacy string list and new object list
            projectsHtml = p.projects.map(proj => {
                const name = typeof proj === 'string' ? proj : proj.name;
                const role = (typeof proj === 'object' && proj.role) ? ` <span class="text-[10px] text-slate-400">(${proj.role})</span>` : '';
                return `<div class="text-xs bg-slate-100 rounded px-2 py-0.5 inline-block mr-1 mb-1 border border-slate-200">${name}${role}</div>`;
            }).join('');
        }

        row.innerHTML = `
            <td class="px-6 py-4">
                <div class="font-medium text-slate-800">${p.name || 'Unknown'}</div>
                <div class="text-xs text-slate-500">${p.email}</div>
            </td>
            <td class="px-6 py-4">
                <div class="text-sm text-slate-700">${p.job_title || '-'}</div>
                <div class="text-xs text-slate-500">${p.department || '-'}</div>
            </td>
            <td class="px-6 py-4">${roleBadge}</td>
            <td class="px-6 py-4 max-w-xs overflow-hidden">${projectsHtml}</td>
            <td class="px-6 py-4 text-center">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                    ${p.interaction_count}
                </span>
            </td>
            <td class="px-6 py-4 text-center">
                <div class="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="openEditModal(${p.id})" class="text-blue-600 hover:text-blue-800 text-xs font-semibold">Edit</button>
                    <span class="text-slate-300">|</span>
                    <button onclick="hideContact(${p.id})" class="text-red-500 hover:text-red-700 text-xs">Remove</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// --- PROJECT LIST MANAGEMENT (Inside Modal) ---

function renderProjectRows(projects) {
    const tbody = document.getElementById('projectListBody');
    const noMsg = document.getElementById('noProjectsMsg');
    tbody.innerHTML = '';
    
    if (!projects || projects.length === 0) {
        noMsg.classList.remove('hidden');
        return;
    }
    noMsg.classList.add('hidden');

    projects.forEach((proj, index) => {
        const row = document.createElement('tr');
        
        // Handle Legacy (String) vs New (Object)
        const projName = typeof proj === 'string' ? proj : proj.name;
        const projRole = (typeof proj === 'object' && proj.role) ? proj.role : '';

        // Project Dropdown Options
        let projectOptions = '<option value="">Select Project</option>';
        availableProjects.forEach(pName => {
            const selected = pName === projName ? 'selected' : '';
            projectOptions += `<option value="${pName}" ${selected}>${pName}</option>`;
        });

        // Role Dropdown Options
        const roles = ['Stakeholder', 'Contributor', 'Approver', 'Owner', 'Requestor', 'Informed'];
        let roleOptions = '<option value="">Select Role</option>';
        roles.forEach(r => {
            const selected = r === projRole ? 'selected' : '';
            roleOptions += `<option value="${r}" ${selected}>${r}</option>`;
        });

        row.innerHTML = `
            <td class="px-2 py-1">
                <select class="project-select w-full p-1.5 border border-slate-300 rounded text-sm bg-white focus:border-primary">
                    ${projectOptions}
                </select>
            </td>
            <td class="px-2 py-1">
                <select class="project-role-select w-full p-1.5 border border-slate-300 rounded text-sm bg-white focus:border-primary">
                    ${roleOptions}
                </select>
            </td>
            <td class="px-2 py-1 text-center">
                <button type="button" onclick="removeProjectRow(this)" class="text-slate-400 hover:text-red-500">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

window.addProjectRow = function() {
    const tbody = document.getElementById('projectListBody');
    document.getElementById('noProjectsMsg').classList.add('hidden');
    
    const row = document.createElement('tr');
    
    let projectOptions = '<option value="">Select Project</option>';
    availableProjects.forEach(pName => {
        projectOptions += `<option value="${pName}">${pName}</option>`;
    });

    const roles = ['Stakeholder', 'Contributor', 'Approver', 'Owner', 'Requestor', 'Informed'];
    let roleOptions = '<option value="">Select Role</option>';
    roles.forEach(r => {
        roleOptions += `<option value="${r}">${r}</option>`;
    });

    row.innerHTML = `
        <td class="px-2 py-1">
            <select class="project-select w-full p-1.5 border border-slate-300 rounded text-sm bg-white focus:border-primary">
                ${projectOptions}
            </select>
        </td>
        <td class="px-2 py-1">
            <select class="project-role-select w-full p-1.5 border border-slate-300 rounded text-sm bg-white focus:border-primary">
                ${roleOptions}
            </select>
        </td>
        <td class="px-2 py-1 text-center">
            <button type="button" onclick="removeProjectRow(this)" class="text-slate-400 hover:text-red-500">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </td>
    `;
    tbody.appendChild(row);
}

window.removeProjectRow = function(btn) {
    btn.closest('tr').remove();
    const tbody = document.getElementById('projectListBody');
    if (tbody.children.length === 0) {
        document.getElementById('noProjectsMsg').classList.remove('hidden');
    }
}

// --- CRUD Operations ---

let editingId = null;

async function openEditModal(id) {
    editingId = id;
    
    // Quick re-fetch to get current data for edit form
    const search = document.getElementById('circleSearch').value;
    const role = document.getElementById('roleFilter').value;
    const query = new URLSearchParams({ search, role });
    const res = await fetch(`/api/circle?${query}`);
    const contacts = await res.json();
    const person = contacts.find(p => p.id === id);
    
    if (person) {
        document.getElementById('modalTitle').innerText = "Edit Contact";
        document.getElementById('contactId').value = person.id;
        document.getElementById('contactName').value = person.name || '';
        document.getElementById('contactEmail').value = person.email;
        document.getElementById('contactEmail').disabled = true; 
        document.getElementById('contactTitle').value = person.job_title || '';
        document.getElementById('contactDept').value = person.department || '';
        document.getElementById('contactRole').value = person.manual_role || '';
        
        // Render Projects
        renderProjectRows(person.projects || []);
        
        document.getElementById('contactModalOverlay').classList.add('is-visible');
    }
}

function openAddContactModal() {
    editingId = null;
    document.getElementById('modalTitle').innerText = "Add New Contact";
    document.getElementById('contactForm').reset();
    document.getElementById('contactId').value = '';
    document.getElementById('contactEmail').disabled = false;
    renderProjectRows([]); // Clear projects
    document.getElementById('contactModalOverlay').classList.add('is-visible');
}

function closeContactModal() {
    document.getElementById('contactModalOverlay').classList.remove('is-visible');
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    // Gather Project Data
    const projectRows = document.querySelectorAll('#projectListBody tr');
    const projects = [];
    projectRows.forEach(row => {
        const name = row.querySelector('.project-select').value;
        const role = row.querySelector('.project-role-select').value;
        if (name) {
            projects.push({ name, role });
        }
    });

    const id = document.getElementById('contactId').value;
    const data = {
        name: document.getElementById('contactName').value,
        email: document.getElementById('contactEmail').value,
        job_title: document.getElementById('contactTitle').value,
        department: document.getElementById('contactDept').value,
        manual_role: document.getElementById('contactRole').value,
        projects: projects // Include new project structure
    };
    
    try {
        let url = '/api/circle';
        let method = 'POST';
        
        if (id) {
            url = `/api/circle/${id}`;
            method = 'PUT';
        }
        
        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if (!res.ok) throw new Error((await res.json()).error);
        
        showMessage('Saved successfully!', 'success');
        closeContactModal();
        fetchContacts(); 
        
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

async function hideContact(id) {
    if (!confirm("Are you sure you want to remove this contact from your view?")) return;
    
    try {
        const res = await fetch(`/api/circle/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to remove');
        fetchContacts();
        showMessage('Contact removed.', 'success');
    } catch (e) {
        showMessage(e.message, 'error');
    }
}

// --- SCAN Operations ---

function openScanModal() {
    document.getElementById('scanModalOverlay').classList.add('is-visible');
}

function closeScanModal() {
    document.getElementById('scanModalOverlay').classList.remove('is-visible');
}

async function performScan() {
    const start = document.getElementById('scanStartDate').value;
    const end = document.getElementById('scanEndDate').value;
    const btn = document.getElementById('startScanBtn');
    const text = document.getElementById('scanBtnText');
    const spinner = document.getElementById('scanSpinner');
    
    if(!start || !end) return showMessage('Please select dates', 'error');
    
    btn.disabled = true;
    text.innerText = "Scanning...";
    spinner.classList.remove('hidden');
    
    try {
        const res = await fetch('/api/circle/scan', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({start_date: start, end_date: end})
        });
        
        const data = await res.json();
        
        if(!res.ok) throw new Error(data.error || "Scan failed");
        
        showMessage(`Scan Complete. Found/Updated ${data.scanned} contacts.`, 'success');
        closeScanModal();
        fetchContacts(); 
        
    } catch(e) {
        showMessage(e.message, 'error');
    } finally {
        btn.disabled = false;
        text.innerText = "Start Scan";
        spinner.classList.add('hidden');
    }
}

// --- Profile Modal ---
async function openProfileModal(id) {
    try {
        const res = await fetch(`/api/circle/${id}/profile`);
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();
        const p = data.person;
        
        const names = (p.name || "Unknown").split(' ');
        const initials = names[0][0] + (names.length > 1 ? names[names.length - 1][0] : '');
        document.getElementById('profileInitials').innerText = initials.toUpperCase();
        
        document.getElementById('profileName').innerText = p.name || "Unknown";
        document.getElementById('profileTitle').innerText = `${p.job_title || 'No Title'} • ${p.department || 'No Dept'}`;
        document.getElementById('profileMeta').innerText = `${p.email} • ${p.manual_role || 'Unclassified'}`;
        
        document.getElementById('profileManager').innerText = p.manager_name || "Unknown";
        document.getElementById('profileOffice').innerText = p.office_location || "Unknown";
        
        const activeContainer = document.getElementById('profileActiveTasks');
        activeContainer.innerHTML = '';
        if (data.active_tasks.length === 0) {
            activeContainer.innerHTML = '<p class="text-sm text-slate-500 italic">No active tasks found for this contact.</p>';
        } else {
            data.active_tasks.forEach(t => {
                const div = document.createElement('div');
                div.className = "bg-white border-l-4 border-red-400 p-3 rounded shadow-sm";
                div.innerHTML = `
                    <div class="flex justify-between">
                        <h4 class="font-bold text-slate-800 text-sm">${t.task_summary}</h4>
                        <span class="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">${t.status}</span>
                    </div>
                    <p class="text-xs text-slate-600 mt-1 line-clamp-2">${t.task_detail}</p>
                `;
                activeContainer.appendChild(div);
            });
        }
        
        const historyContainer = document.getElementById('profileHistory');
        historyContainer.innerHTML = '';
        if (data.recent_closed.length === 0) {
            historyContainer.innerHTML = '<p class="text-sm text-slate-500 italic">No recent history found.</p>';
        } else {
            data.recent_closed.forEach(t => {
                const div = document.createElement('div');
                div.className = "bg-slate-50 p-3 rounded border border-slate-100";
                div.innerHTML = `
                    <h4 class="font-semibold text-slate-700 text-sm strike-through decoration-slate-400">${t.task_summary}</h4>
                    <p class="text-xs text-slate-400 mt-1">Closed on ${new Date(t.status_updated_at).toLocaleDateString()}</p>
                `;
                historyContainer.appendChild(div);
            });
        }

        document.getElementById('profileModalOverlay').classList.add('is-visible');
        
    } catch(e) {
        showMessage(e.message, 'error');
    }
}

function closeProfileModal() {
    document.getElementById('profileModalOverlay').classList.remove('is-visible');
}

function showMessage(msg, type) {
    const container = document.getElementById('message-container');
    const div = document.createElement('div');
    div.className = `px-4 py-3 rounded shadow-lg text-white ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
    div.innerText = msg;
    container.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}