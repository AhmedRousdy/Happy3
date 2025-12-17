// ---
// --- NEWS.JS ---
// ---
// This file controls all logic for the News Summary page (news.html)
//

// Global audio player to manage play/pause state
let currentAudio = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Load the news view on page load
    fetchAndRenderSummaries();
});


/**
 * Displays a success or error message. (Helper)
 */
function showMessage(message, type = 'success') {
    const container = document.getElementById('message-container');
    const colorClass = type === 'success' ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700';
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `border ${colorClass} px-4 py-3 rounded-lg relative`;
    msgDiv.role = 'alert';
    msgDiv.innerHTML = `<span class="block sm:inline">${message}</span>`;
    
    container.appendChild(msgDiv);

    // Auto-dismiss
    setTimeout(() => {
        msgDiv.remove();
    }, 3000);
}


// --- LATEST NEWS & AUDIO FUNCTIONS ---

/**
 * Fetches ALL summaries from the API and renders them.
 */
async function fetchAndRenderSummaries() {
    console.log("[News] Fetching summaries from /api/summaries...");
    const container = document.getElementById('news-summaries-container');
    // Only show loading if empty to prevent jitter on refresh
    if (!container.innerHTML.trim()) {
        container.innerHTML = '<p class="text-slate-500">Loading daily summaries...</p>';
    }
    
    try {
        const response = await fetch('/api/summaries');
        console.log(`[News] Fetch response status: ${response.status}`);

        if (!response.ok) throw new Error(`Failed to fetch summaries. Status: ${response.status}`);
        
        const summaries = await response.json();
        console.log("[News] Fetched summaries data:", summaries);
        
        renderSummaryCards(summaries);
        
    } catch(error) {
        console.error('[News] Error fetching summaries:', error);
        showMessage(error.message, 'error');
        container.innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
    }
}

/**
 * Renders the full list of summary cards.
 */
function renderSummaryCards(summaries) {
    const container = document.getElementById('news-summaries-container');
    container.innerHTML = ''; // Clear loading message
    
    if (summaries.length === 0) {
        container.innerHTML = '<p class="text-slate-500">No news summaries have been generated yet. The first one will be created at 8:00 AM.</p>';
        return;
    }
    
    summaries.forEach(summary => {
        const card = document.createElement('div');
        card.className = 'summary-item bg-white p-6 rounded-lg shadow-sm border border-slate-200';
        card.id = `summary-card-${summary.id}`;
        card.innerHTML = getSummaryCardHTML(summary); // Use helper to build HTML
        container.appendChild(card);
    });
}

/**
 * Helper to get the correct HTML for a summary based on its status.
 */
function getSummaryCardHTML(summary) {
    const title = formatDate(summary.summary_date);
    
    // ---
    // --- 1. GENERATED (Success state)
    // ---
    if (summary.status === 'generated') {
        const htmlContent = (summary.content || "No content.")
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        const listenButton = summary.audio_file_path ? `
            <button class="pill-btn bg-secondary hover:bg-secondary-hover text-white !py-2.5 !px-4 w-full sm:w-auto" 
                    data-audio-path="${summary.audio_file_path}" 
                    onclick="playSummary(this)">
                <svg class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M19.114 11.632a.75.75 0 010 1.236l-6.064 3.465a.75.75 0 01-1.12-.618V9.302a.75.75 0 011.12-.618l6.064 3.465zM8.25 6.75a.75.75 0 00-1.5 0v10.5a.75.75 0 001.5 0V6.75z" />
                </svg>
                <span>Listen</span>
            </button>
        ` : '';

        return `
            <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                <h2 class="text-2xl font-bold text-slate-800">${title}</h2>
                <div class="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    ${listenButton}
                    <button class="pill-btn bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 !py-2.5 !px-4 w-full sm:w-auto" 
                            onclick="regenerateSummary(${summary.id}, this)">
                        <svg class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                           <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                        <span>Regenerate</span>
                    </button>
                </div>
            </div>
            <div class="prose prose-slate max-w-none text-slate-700">
                ${htmlContent}
            </div>
        `;
    }
    
    // ---
    // --- 2. PENDING (Waiting for generation)
    // ---
    if (summary.status === 'pending') {
        return `
            <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                <h2 class="text-2xl font-bold text-slate-800">${title}</h2>
                <button class="pill-btn bg-primary hover:bg-primary-hover text-white !py-2.5 !px-4 w-full sm:w-auto" 
                        onclick="generateSummary(${summary.id}, this)">
                    <svg class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                    <span>Generate Now</span>
                </button>
            </div>
            <div class="prose prose-slate max-w-none text-slate-500">
                <p>This summary is pending. Click "Generate Now" to create it.</p>
            </div>
        `;
    }
    
    // ---
    // --- 3. GENERATING (Active state - FIX FOR "DELETED" SUMMARY)
    // ---
    if (summary.status === 'generating') {
         return `
            <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                <h2 class="text-2xl font-bold text-slate-800">${title}</h2>
                <button class="pill-btn bg-slate-100 text-slate-400 !py-2.5 !px-4 w-full sm:w-auto cursor-not-allowed" disabled>
                    <svg class="h-5 w-5 mr-2 sync-btn-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <path class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></path>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Processing...</span>
                </button>
            </div>
            <div class="prose prose-slate max-w-none text-blue-600">
                <p class="animate-pulse"><strong>AI is generating your summary...</strong></p>
                <p class="text-sm text-slate-500">This may take a minute depending on your model speed.</p>
            </div>
        `;
    }
    
    // ---
    // --- 4. FAILED (Error state)
    // ---
    if (summary.status === 'failed') {
        return `
            <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                <h2 class="text-2xl font-bold text-slate-800">${title}</h2>
                <button class="pill-btn bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 !py-2.5 !px-4 w-full sm:w-auto" 
                        onclick="regenerateSummary(${summary.id}, this)">
                    <svg class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    <span>Regenerate</span>
                </button>
            </div>
            <div class="prose prose-slate max-w-none text-red-600">
                <p><strong>Generation Failed.</strong></p>
                <p class="text-sm">Error: ${summary.content || "Unknown error."}</p>
            </div>
        `;
    }
    
    // Fallback
    return `<p class="text-red-500">Unknown status: ${summary.status}</p>`;
}

/**
 * Formats a date string (YYYY-MM-DD) into a readable title.
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const userOffset = new Date().getTimezoneOffset() * 60000;
    const localDate = new Date(date.getTime() + userOffset);

    if (localDate.toDateString() === today.toDateString()) {
        return 'Today\'s Briefing';
    } else if (localDate.toDateString() === yesterday.toDateString()) {
        return 'Yesterday\'s Briefing';
    } else {
        return localDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
};

/**
 * Sets a button to its spinning/loading state.
 */
function setButtonLoading(button, text = "Generating...") {
    button.disabled = true;
    const icon = button.querySelector('svg');
    button.innerHTML = `
        <svg class="h-5 w-5 mr-2 sync-btn-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <path class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></path>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>${text}</span>
    `;
}

/**
 * Handles "Generate Now" button click.
 */
async function generateSummary(summaryId, btnEl) {
    console.log(`[Generate] Triggering generation for ID: ${summaryId}...`);
    setButtonLoading(btnEl, "Generating...");

    try {
        const response = await fetch(`/api/summaries/generate/${summaryId}`, { method: 'POST' });
        console.log(`[Generate] Response status: ${response.status}`);
        
        const summary = await response.json();
        console.log(`[Generate] API Result:`, summary);
        
        if (!response.ok) {
            throw new Error(summary.error || 'Failed to generate summary');
        }
        
        const card = document.getElementById(`summary-card-${summaryId}`);
        card.innerHTML = getSummaryCardHTML(summary);
        
        if (summary.status === 'generating') {
             console.log(`[Generate] Status is 'generating'. Polling scheduled.`);
             // Poll for updates if stuck in generating (optional, but good UX)
             showMessage('Summary is generating in background...', 'success');
             setTimeout(() => fetchAndRenderSummaries(), 5000); 
        } else {
             console.log(`[Generate] Success. Status: ${summary.status}`);
             showMessage('Summary generated successfully!', 'success');
        }

    } catch (error) {
        console.error('[Generate] Error:', error);
        showMessage(error.message, 'error');
        fetchAndRenderSummaries();
    }
}

/**
 * Handles "Regenerate" button click.
 */
async function regenerateSummary(summaryId, btnEl) {
    console.log(`[Regenerate] Triggering regeneration for ID: ${summaryId}...`);
    setButtonLoading(btnEl, "Regenerating...");

    try {
        const response = await fetch(`/api/summaries/regenerate/${summaryId}`, { method: 'POST' });
        console.log(`[Regenerate] Response status: ${response.status}`);

        const summary = await response.json();
        console.log(`[Regenerate] API Result:`, summary);

        if (!response.ok) {
            throw new Error(summary.error || 'Failed to regenerate summary');
        }
        
        const card = document.getElementById(`summary-card-${summaryId}`);
        card.innerHTML = getSummaryCardHTML(summary);
        
        if (summary.status === 'generating') {
             console.log(`[Regenerate] Status is 'generating'. Polling scheduled.`);
             showMessage('Summary is regenerating in background...', 'success');
             setTimeout(() => fetchAndRenderSummaries(), 5000);
        } else {
             console.log(`[Regenerate] Success. Status: ${summary.status}`);
             showMessage('Summary regenerated successfully!', 'success');
        }

    } catch (error) {
        console.error('[Regenerate] Error:', error);
        showMessage(error.message, 'error');
        fetchAndRenderSummaries();
    }
}

/**
 * Handles "Listen" button click.
 */
function playSummary(btnEl) {
    const audioPath = btnEl.dataset.audioPath;

    if (currentAudio) {
        const oldButton = document.querySelector('[data-audio-path].playing');
        stopSpeaking(oldButton);
    }
    
    if (btnEl.classList.contains('playing')) {
        btnEl.classList.remove('playing');
        return;
    }

    currentAudio = new Audio(audioPath);
    btnEl.classList.add('playing');
    btnEl.innerHTML = `
        <svg class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
           <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
        </svg>
        <span>Stop</span>
    `;

    currentAudio.play();
    
    currentAudio.onended = () => {
        stopSpeaking(btnEl);
    };
    currentAudio.onerror = () => {
        showMessage('Error playing audio file.', 'error');
        stopSpeaking(btnEl);
    };
}

/**
 * Stops the currently playing audio and resets its button.
 */
function stopSpeaking(btnEl) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    
    if (btnEl) {
        document.querySelectorAll('[data-audio-path]').forEach(btn => {
            btn.classList.remove('playing');
            btn.innerHTML = `
                <svg class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M19.114 11.632a.75.75 0 010 1.236l-6.064 3.465a.75.75 0 01-1.12-.618V9.302a.75.75 0 011.12-.618l6.064 3.465zM8.25 6.75a.75.75 0 00-1.5 0v10.5a.75.75 0 001.5 0V6.75z" />
                </svg>
                <span>Listen</span>
            `;
        });
    }
}