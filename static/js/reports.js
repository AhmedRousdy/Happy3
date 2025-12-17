// Filename: static/js/reports.js
// Role: Frontend logic for the Reports page (generating standard/consolidated reports)

document.addEventListener('DOMContentLoaded', () => {
    loadReports();
    
    // Set default dates
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);
    
    const fmt = d => d.toISOString().split('T')[0];
    
    const setDates = (sId, eId) => {
        const s = document.getElementById(sId);
        const e = document.getElementById(eId);
        if(s && e) { s.value = fmt(lastWeek); e.value = fmt(today); }
    };
    
    setDates('reportStartDate', 'reportEndDate');
    setDates('consolStartDate', 'consolEndDate');
});

async function loadReports() {
    const list = document.getElementById('reportsList');
    list.innerHTML = '<li class="px-6 py-8 text-center text-slate-500">Loading reports...</li>';
    
    try {
        const res = await fetch('/api/reports/list');
        const files = await res.json();
        
        list.innerHTML = '';
        if (files.length === 0) {
            list.innerHTML = '<li class="px-6 py-8 text-center text-slate-500">No reports generated yet.</li>';
            return;
        }
        
        files.forEach(f => {
            const isConsolidated = f.filename.toLowerCase().includes('consolidated');
            const iconColor = isConsolidated ? 'text-indigo-500' : 'text-primary';
            const iconBg = isConsolidated ? 'bg-indigo-50' : 'bg-blue-50';
            const label = isConsolidated ? 'AI Consolidated' : 'Standard Report';
            
            const li = document.createElement('li');
            li.className = "px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors";
            li.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="p-2 rounded-lg ${iconBg} ${iconColor}">
                        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <div>
                        <p class="font-medium text-slate-900">${f.filename}</p>
                        <p class="text-xs text-slate-500">${label} • Created: ${f.created}</p>
                    </div>
                </div>
                <div class="flex gap-3">
                    <a href="/static/reports/${f.filename}" target="_blank" class="text-sm font-medium text-slate-600 hover:text-primary flex items-center">
                        View
                        <svg class="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </a>
                    <a href="/static/reports/${f.filename}" download class="text-sm font-medium text-slate-600 hover:text-primary flex items-center">
                        Download
                    </a>
                </div>
            `;
            list.appendChild(li);
        });
    } catch (e) {
        list.innerHTML = `<li class="px-6 py-4 text-red-500">Error loading reports: ${e.message}</li>`;
    }
}

// Modal Logic
function openGenerateModal() { document.getElementById('generateModal').classList.add('is-visible'); }
function closeGenerateModal() { document.getElementById('generateModal').classList.remove('is-visible'); }

function openConsolidateModal() { document.getElementById('consolidateModal').classList.add('is-visible'); }
function closeConsolidateModal() { document.getElementById('consolidateModal').classList.remove('is-visible'); }

async function generateReport(type) {
    const isConsol = type === 'consolidated';
    const sId = isConsol ? 'consolStartDate' : 'reportStartDate';
    const eId = isConsol ? 'consolEndDate' : 'reportEndDate';
    const btnId = isConsol ? 'confirmConsolBtn' : 'confirmGenerateBtn';
    
    const start = document.getElementById(sId).value;
    const end = document.getElementById(eId).value;
    
    if (!start || !end) {
        alert("Please select both start and end dates.");
        return;
    }
    
    const btn = document.getElementById(btnId);
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Generating...";
    
    const endpoint = isConsol ? '/api/reports/consolidated' : '/api/reports/custom';
    
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ start_date: start, end_date: end })
        });
        
        if (!res.ok) throw new Error("Generation failed");
        
        const data = await res.json();
        
        if (isConsol) closeConsolidateModal(); 
        else closeGenerateModal();
        
        // Refresh list
        await loadReports();
        
        // Auto-open if URL returned
        if(data.url) window.open(data.url, '_blank');
        
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}