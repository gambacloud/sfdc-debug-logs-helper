document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

let selectedLogs = new Set();
let allLogs = [];
let filteredLogs = [];
let currentLogId = null;

async function initApp() {
    console.log("Initializing App...");
    setupEventListeners();
    await fetchOrgs();
}

function getSelectedOrg() {
    const selector = document.getElementById('org-selector');
    return selector ? selector.value : '';
}

function setupEventListeners() {
    document.getElementById('btn-refresh-logs').addEventListener('click', fetchLogs);
    
    // Org Management
    document.getElementById('btn-connect-org').addEventListener('click', connectNewOrg);
    document.getElementById('org-selector').addEventListener('change', () => {
        fetchTraces();
        fetchLogs();
    });
    
    // Add Trace Modal
    document.getElementById('btn-add-trace').addEventListener('click', () => {
        document.getElementById('add-trace-modal').classList.add('active');
        document.getElementById('user-search-input').value = '';
        document.getElementById('user-search-results').style.display = 'none';
        document.getElementById('selected-user-display').style.display = 'none';
        document.getElementById('btn-confirm-add-trace').disabled = true;
    });
    
    document.getElementById('btn-search-user').addEventListener('click', searchUsers);
    document.getElementById('user-search-input').addEventListener('keypress', (e) => {
        if(e.key === 'Enter') searchUsers();
    });
    
    document.getElementById('btn-confirm-add-trace').addEventListener('click', createTrace);

    // Global Search Modal
    document.getElementById('btn-global-search').addEventListener('click', () => {
        document.getElementById('global-search-modal').classList.add('active');
    });
    
    document.getElementById('btn-execute-global-search').addEventListener('click', executeGlobalSearch);
    document.getElementById('global-search-input').addEventListener('keypress', (e) => {
        if(e.key === 'Enter') executeGlobalSearch();
    });

    // Bulk Delete
    document.getElementById('btn-delete-logs').addEventListener('click', deleteSelectedLogs);

    // Screenshot
    document.getElementById('btn-screenshot').addEventListener('click', captureScreenshot);

    // View Toggling
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const view = e.target.dataset.view;
            switchView(view);
        });
    });

    // Select All Logs
    document.getElementById('chk-select-all-logs').addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.querySelectorAll('.log-checkbox:not([style*="display: none"])').forEach(chk => {
            const item = chk.closest('.log-item');
            if (item.style.display !== 'none') {
                chk.checked = checked;
                if(checked) selectedLogs.add(chk.dataset.id);
                else selectedLogs.delete(chk.dataset.id);
            }
        });
        updateLogCounters();
    });

    // Filtering
    ['filter-user', 'filter-type', 'filter-status'].forEach(id => {
        document.getElementById(id).addEventListener('input', applyLogFilters);
    });
}

// ================= API Calls =================

async function fetchOrgs() {
    const selector = document.getElementById('org-selector');
    try {
        const res = await fetch('/api/orgs');
        if(!res.ok) {
            const errData = await res.json().catch(()=>({}));
            throw new Error(errData.detail || "Failed to fetch orgs");
        }
        const data = await res.json();
        
        if(data.orgs && data.orgs.length > 0) {
            selector.innerHTML = data.orgs.map(o => 
                `<option value="${o.alias || o.username}" ${o.isDefaultUsername ? 'selected' : ''}>${o.alias || o.username}</option>`
            ).join('');
        } else {
            selector.innerHTML = `<option value="">No orgs found. Please connect one.</option>`;
        }
    } catch(e) {
        console.error("fetchOrgs error:", e);
        selector.innerHTML = `<option value="">Error: ${e.message}</option>`;
    }
    
    // Load initial data for the selected org
    fetchTraces();
    fetchLogs();
}

async function connectNewOrg() {
    alert("Opening browser to authenticate... Please complete the Salesforce login process. The org list will refresh automatically in 30 seconds, or you can manually reload the page.");
    try {
        await fetch('/api/orgs/login', { method: 'POST' });
        // Automatically fetch orgs again after 30 seconds to see the newly added org
        setTimeout(fetchOrgs, 30000);
    } catch(e) {
        console.error("Error initiating login", e);
    }
}

async function fetchTraces() {
    const org = getSelectedOrg();
    const container = document.getElementById('traces-list');
    container.innerHTML = `<div class="loader"></div> Loading traces...`;
    try {
        const res = await fetch(`/api/traces?org=${encodeURIComponent(org)}`);
        if(!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        renderTraces(data.traces);
    } catch(e) {
        container.innerHTML = `<div style="color:var(--accent-red)">Error: ${e.message}</div>`;
    }
}

async function fetchLogs() {
    const org = getSelectedOrg();
    const container = document.getElementById('logs-list');
    container.innerHTML = `<div class="loader"></div> Loading logs...`;
    try {
        const res = await fetch(`/api/logs?org=${encodeURIComponent(org)}`);
        if(!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        allLogs = data.logs;
        applyLogFilters();
    } catch(e) {
        container.innerHTML = `<div style="color:var(--accent-red)">Error: ${e.message}</div>`;
    }
}

// ================= Render Functions =================

function renderTraces(traces) {
    const container = document.getElementById('traces-list');
    if(!traces || traces.length === 0) {
        container.innerHTML = `<div style="color:var(--text-secondary); text-align:center; padding:1rem;">No traces found</div>`;
        return;
    }

    let html = '';
    const now = new Date();
    
    traces.forEach(t => {
        const start = new Date(t.StartDate);
        const end = new Date(t.ExpirationDate);
        
        let status = 'expired';
        let badgeClass = 'badge-expired';
        
        if (now >= start && now <= end) {
            status = 'live';
            badgeClass = 'badge-live';
        } else if (now < start) {
            status = 'future';
            badgeClass = 'badge-future';
        }

        html += `
            <div class="list-item">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div class="item-title" style="margin:0">${t.TracedEntityName}</div>
                    <button class="btn btn-icon btn-danger" onclick="deleteTrace('${t.Id}')" title="Delete Trace" style="padding:2px 4px; font-size:10px;"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div class="item-meta">
                    <span>Exp: ${end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    <span class="badge ${badgeClass}">${status}</span>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function renderLogs(logs) {
    const container = document.getElementById('logs-list');
    if(!logs || logs.length === 0) {
        container.innerHTML = `<div style="color:var(--text-secondary); text-align:center; padding:1rem;">No logs found</div>`;
        return;
    }

    let html = '';
    logs.forEach(l => {
        let sizeText = '';
        if (l.LogLength > 1024 * 1024) {
            sizeText = (l.LogLength / 1024 / 1024).toFixed(2) + ' MB';
        } else {
            sizeText = (l.LogLength / 1024).toFixed(1) + ' KB';
        }
        const time = new Date(l.StartTime).toLocaleString();
        const statusColor = l.Status === 'Success' ? 'var(--accent-green)' : 'var(--accent-red)';
        
        html += `
            <div class="list-item log-item" data-id="${l.Id}">
                <div class="checkbox-item" style="margin-bottom: 0.25rem;">
                    <input type="checkbox" class="log-checkbox" data-id="${l.Id}" onclick="event.stopPropagation()">
                    <div class="item-title" style="margin:0">${l.Operation || l.Application}</div>
                </div>
                <div class="item-meta" style="margin-left: 1.5rem;">
                    <span>${l.LogUserName}</span>
                    <span style="color:${statusColor}">${l.Status}</span>
                </div>
                <div class="item-meta" style="margin-left: 1.5rem; margin-top: 0.2rem;">
                    <span>${time}</span>
                    <span>${sizeText}</span>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;

    updateLogCounters();

    // Sync "Select All" state
    const selectAllChk = document.getElementById('chk-select-all-logs');
    const checkboxes = Array.from(document.querySelectorAll('.log-checkbox'));
    const allChecked = checkboxes.length > 0 && checkboxes.every(c => c.checked);
    selectAllChk.checked = allChecked;
    
    // Attach selection listener
    document.querySelectorAll('.log-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if(e.target.type === 'checkbox') return;
            
            const id = item.dataset.id;
            const name = item.querySelector('.item-title').innerText;
            // Clear previous selection
            document.querySelectorAll('.log-item').forEach(li => li.classList.remove('selected'));
            item.classList.add('selected');
            openLogViewer(id, name);
        });
        
        const chk = item.querySelector('.log-checkbox');
        chk.addEventListener('change', () => {
            if(chk.checked) selectedLogs.add(chk.dataset.id);
            else selectedLogs.delete(chk.dataset.id);
            updateLogCounters();
        });
    });
}

function applyLogFilters() {
    const userQ = document.getElementById('filter-user').value.toLowerCase();
    const typeQ = document.getElementById('filter-type').value.toLowerCase();
    const statusQ = document.getElementById('filter-status').value.toLowerCase();

    filteredLogs = allLogs.filter(l => {
        const userName = (l.LogUserName || '').toLowerCase();
        const typeName = (l.Operation || l.Application || '').toLowerCase();
        const statusName = (l.Status || '').toLowerCase();

        return userName.includes(userQ) && 
               typeName.includes(typeQ) && 
               statusName.includes(statusQ);
    });

    renderLogs(filteredLogs);
}

function updateLogCounters() {
    const totalCount = filteredLogs.length;
    const selectedCount = selectedLogs.size;
    document.getElementById('log-count-total').innerText = totalCount;
    document.getElementById('log-count-selected').innerText = selectedCount;
}

// ================= Add Trace Logic =================

async function searchUsers() {
    const org = getSelectedOrg();
    const q = document.getElementById('user-search-input').value;
    if(!q) return;
    
    const container = document.getElementById('user-search-results');
    container.style.display = 'block';
    container.innerHTML = `Searching...`;
    
    try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}&org=${encodeURIComponent(org)}`);
        const data = await res.json();
        
        if(!data.users || data.users.length === 0) {
            container.innerHTML = `No users found.`;
            return;
        }
        
        container.innerHTML = data.users.map(u => `
            <div class="list-item" onclick="selectUser('${u.Id}', '${u.Name}')" style="padding:0.5rem; cursor:pointer;">
                <div style="font-weight:500;">${u.Name}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary);">${u.Username}</div>
            </div>
        `).join('');
    } catch(e) {
        container.innerHTML = `Error searching users.`;
    }
}

let selectedUserIdForTrace = null;
window.selectUser = function(id, name) {
    selectedUserIdForTrace = id;
    document.getElementById('selected-user-display').style.display = 'block';
    document.getElementById('sel-user-name').innerText = name;
    document.getElementById('btn-confirm-add-trace').disabled = false;
}

async function createTrace() {
    const org = getSelectedOrg();
    const btn = document.getElementById('btn-confirm-add-trace');
    btn.innerText = "Creating...";
    btn.disabled = true;
    
    try {
        const res = await fetch('/api/traces', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({user_id: selectedUserIdForTrace, minutes: 20, org: org})
        });
        
        if(res.ok) {
            document.getElementById('add-trace-modal').classList.remove('active');
            fetchTraces();
        } else {
            const data = await res.json();
            alert("Error: " + data.detail);
        }
    } catch(e) {
        alert("Error creating trace.");
    } finally {
        btn.innerText = "Create Trace";
        btn.disabled = false;
    }
}

// ================= Delete Logs =================

async function deleteSelectedLogs() {
    const org = getSelectedOrg();
    if(selectedLogs.size === 0) {
        alert("Select logs to delete using the checkboxes.");
        return;
    }
    
    if(!confirm(`Delete ${selectedLogs.size} logs?`)) return;
    
    try {
        const res = await fetch('/api/logs/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({log_ids: Array.from(selectedLogs), org: org})
        });
        
        if(res.ok) {
            selectedLogs.clear();
            allLogs = allLogs.filter(l => !req.log_ids.includes(l.Id));
            applyLogFilters();
        }
    } catch(e) {
        alert("Error deleting logs.");
    }
}

// ================= Global Search =================
async function executeGlobalSearch() {
    const q = document.getElementById('global-search-input').value;
    if(!q) return;
    
    const container = document.getElementById('global-search-results');
    const btn = document.getElementById('btn-execute-global-search');
    
    container.style.display = 'block';
    container.innerHTML = `<div class="loader"></div> Searching...`;
    btn.disabled = true;
    
    try {
        const res = await fetch(`/api/logs/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        
        if(!data.results || data.results.length === 0) {
            container.innerHTML = `No results found.`;
        } else {
            let html = ``;
            data.results.forEach(fileRes => {
                const logId = fileRes.file.split('.')[0];
                html += `<div style="margin-bottom: 1rem;">
                    <div style="font-weight: 500; color: var(--accent-blue); margin-bottom: 0.25rem; cursor: pointer; display: inline-block;" 
                         onmouseover="this.style.textDecoration='underline'" 
                         onmouseout="this.style.textDecoration='none'"
                         onclick="openLogFromSearch('${logId}', '${fileRes.file}')">📄 ${fileRes.file}</div>`;
                
                fileRes.matches.slice(0, 10).forEach(m => {
                    html += `<div style="font-family: monospace; font-size: 0.75rem; background: rgba(0,0,0,0.3); padding: 0.25rem; margin-bottom: 2px;">
                        <span style="color: var(--text-secondary);">Line ${m.line_no}:</span> ${m.snippet}
                    </div>`;
                });
                
                if(fileRes.matches.length > 10) {
                    html += `<div style="font-size: 0.75rem; color: var(--text-secondary);">...and ${fileRes.matches.length - 10} more matches</div>`;
                }
                html += `</div>`;
            });
            container.innerHTML = html;
        }
    } catch(e) {
        container.innerHTML = `Error performing global search.`;
    } finally {
        btn.disabled = false;
    }
}

window.openLogFromSearch = function(logId, logName) {
    document.getElementById('global-search-modal').classList.remove('active');
    openLogViewer(logId, logName);
}

async function deleteTrace(traceId) {
    if(!confirm("Delete this trace flag?")) return;
    const org = getSelectedOrg();
    try {
        const res = await fetch(`/api/traces/${traceId}?org=${encodeURIComponent(org)}`, {
            method: 'DELETE'
        });
        if(res.ok) {
            fetchTraces();
        } else {
            const data = await res.json();
            alert("Error: " + data.detail);
        }
    } catch(e) {
        alert("Error deleting trace.");
    }
}

// ================= Log Viewer & Analyzer =================

let currentLogView = 'analyzer';
let lastAnalysisData = null;
let lastRawContent = '';

async function openLogViewer(logId, logName) {
    currentLogId = logId;
    currentLogView = 'analyzer';
    
    // Reset toggle buttons
    document.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === 'analyzer');
    });

    const tv = document.getElementById('main-toolbar');
    const title = document.getElementById('current-view-title');
    const viewer = document.getElementById('viewer-area');
    
    tv.style.display = 'flex';
    title.innerText = logName;
    viewer.innerHTML = `<div class="empty-state"><div class="loader" style="width:3rem;height:3rem;"></div><h3 style="margin-top:1rem">Downloading & Analyzing...</h3></div>`;
    
    await downloadAndAnalyze(logId);
}

function switchView(view) {
    if (!currentLogId) return;
    currentLogView = view;
    
    document.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
    });

    if (view === 'analyzer') {
        if (lastAnalysisData) renderAnalysis(lastAnalysisData);
        else downloadAndAnalyze(currentLogId);
    } else {
        if (lastRawContent) renderRawLog(lastRawContent);
        else fetchRawLog(currentLogId);
    }
}

window.downloadAndAnalyze = async function(logId) {
    const org = getSelectedOrg();
    const viewer = document.getElementById('viewer-area');
    try {
        // 1. Download Log
        const dlRes = await fetch(`/api/logs/${logId}/download?org=${encodeURIComponent(org)}`, {method: 'POST'});
        if(!dlRes.ok) throw new Error("Failed to download log. It may have expired.");
        
        // 2. Analyze Log
        const anRes = await fetch(`/api/logs/${logId}/analyze`);
        if(!anRes.ok) throw new Error("Failed to analyze log.");
        
        const analysis = await anRes.json();
        lastAnalysisData = analysis;
        if (currentLogView === 'analyzer') {
            renderAnalysis(analysis);
        }
    } catch(e) {
        viewer.innerHTML = `<div class="empty-state" style="color:var(--accent-red)"><i class="fa-solid fa-circle-exclamation fa-3x"></i><h3>Error</h3><p>${e.message}</p></div>`;
    }
}

async function fetchRawLog(logId) {
    const viewer = document.getElementById('viewer-area');
    try {
        const res = await fetch(`/api/logs/${logId}/raw`);
        if (!res.ok) throw new Error("Failed to fetch raw log.");
        const data = await res.json();
        lastRawContent = data.content;
        if (currentLogView === 'raw') {
            renderRawLog(data.content);
        }
    } catch (e) {
        viewer.innerHTML = `<div class="empty-state" style="color:var(--accent-red)"><i class="fa-solid fa-circle-exclamation fa-3x"></i><h3>Error</h3><p>${e.message}</p></div>`;
    }
}

function renderAnalysis(data) {
    const viewer = document.getElementById('viewer-area');
    
    let html = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom: 1.5rem;">
            <div class="table-wrapper" style="margin:0; padding:1rem;">
                <h3 style="margin-top:0">Log Limits Execution</h3>
                <div style="font-size:0.875rem;">
                    <div><strong>SOQL Queries:</strong> ${data.limits.soql_queries || 'N/A'}</div>
                    <div><strong>CPU Time:</strong> ${data.limits.cpu_time || 'N/A'}</div>
                    <div><strong>DML Statements:</strong> ${data.limits.dml_statements || 'N/A'}</div>
                    <div><strong>DML Rows:</strong> ${data.limits.dml_rows || 'N/A'}</div>
                </div>
            </div>
            <div class="table-wrapper" style="margin:0; padding:1rem; border-color: ${data.warnings.length > 0 ? "var(--accent-red)" : "var(--border-color)"};">
                <h3 style="margin-top:0; color: ${data.warnings.length > 0 ? "var(--accent-red)" : "inherit"};">Warnings (${data.warnings.length})</h3>
                <div style="font-size:0.875rem; max-height:100px; overflow-y:auto;">
                    ${data.warnings.map(w => `<div style="color: #fca5a5; margin-bottom:4px;">⚠️ ${w}</div>`).join('') || '<div style="color:var(--text-secondary)">No warnings detected.</div>'}
                </div>
            </div>
        </div>
        
        <h3 style="border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">Variable & Field Assignments</h3>
    `;
    
    // Variables table
    if(data.assignments.length > 0) {
        html += `
        <div class="table-wrapper" style="max-height: 400px; overflow-y:auto;">
            <table>
                <thead style="position:sticky; top:0; background:var(--bg-panel); z-index:1;">
                    <tr><th>Time</th><th>Line</th><th>Variable</th><th>Value</th></tr>
                </thead>
                <tbody>
                    ${data.assignments.map(a => `
                        <tr>
                            <td style="white-space:nowrap; color:var(--text-secondary)">${a.time.substring(11,23)}</td>
                            <td style="color:var(--text-secondary)">${a.line}</td>
                            <td style="font-family:monospace; color:var(--accent-purple)">${a.variable}</td>
                            <td style="font-family:monospace; word-break:break-all;">${a.value}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
    } else {
        html += `<p style="color:var(--text-secondary)">No explicit VARIABLE_ASSIGNMENT events found in this log.</p>`;
    }
    
    html += `<h3 style="border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-top:2rem;">SOQL Queries (${data.total_soql} executed, ${data.total_soql_rows} rows)</h3>`;
    
    if(data.soql.length > 0) {
        html += `
        <div class="table-wrapper" style="max-height: 400px; overflow-y:auto;">
            <table>
                <thead style="position:sticky; top:0; background:var(--bg-panel); z-index:1;">
                    <tr><th>Time</th><th>Line</th><th>Rows</th><th>Query</th></tr>
                </thead>
                <tbody>
                    ${data.soql.map(q => `
                        <tr>
                            <td style="white-space:nowrap; color:var(--text-secondary)">${q.time.substring(11,23)}</td>
                            <td style="color:var(--text-secondary)">${q.line}</td>
                            <td><span class="badge ${q.rows > 100 ? 'badge-error' : 'badge-success'}">${q.rows}</span></td>
                            <td style="font-family:monospace; font-size: 0.8rem; word-break:break-all;">${q.query}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
    } else {
        html += `<p style="color:var(--text-secondary)">No SOQL queries found in this log.</p>`;
    }

    viewer.innerHTML = html;
}

function renderRawLog(content) {
    const viewer = document.getElementById('viewer-area');
    
    viewer.innerHTML = `
        <div class="raw-log-container">
            <div class="raw-log-search">
                <input type="text" id="raw-log-search-input" class="input" placeholder="Search log text..." style="flex:1">
                <button class="btn" id="btn-raw-search"><i class="fa-solid fa-search"></i></button>
                <div style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem; color:var(--text-secondary); margin-left:1rem;">
                    <input type="checkbox" id="chk-debug-only"> Only User Debug
                </div>
            </div>
            <div class="raw-log-content" id="raw-log-content-area"></div>
        </div>
    `;

    const area = document.getElementById('raw-log-content-area');
    const searchInput = document.getElementById('raw-log-search-input');
    const debugOnly = document.getElementById('chk-debug-only');

    const updateRawView = () => {
        const q = searchInput.value;
        const onlyDebug = debugOnly.checked;
        let lines = content.split('\n');
        
        if (onlyDebug) {
            lines = lines.filter(line => line.includes('|USER_DEBUG|'));
        }

        let outputHtml = '';
        lines.forEach(line => {
            let lineHtml = line.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
            if (q && q.length > 1) {
                const regex = new RegExp(`(${q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')})`, 'gi');
                lineHtml = lineHtml.replace(regex, '<mark>$1</mark>');
            }
            const isDebug = line.includes('|USER_DEBUG|');
            outputHtml += `<div class="${isDebug ? 'debug-line' : ''}">${lineHtml}</div>`;
        });
        area.innerHTML = outputHtml;
    };

    searchInput.addEventListener('input', updateRawView);
    debugOnly.addEventListener('change', updateRawView);
    document.getElementById('btn-raw-search').addEventListener('click', updateRawView);

    updateRawView();
}

async function captureScreenshot() {
    const layout = document.querySelector('.main-content');
    const btn = document.getElementById('btn-screenshot');
    const originalText = btn.innerHTML;
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Capturing...';
    btn.disabled = true;

    try {
        const canvas = await html2canvas(layout, {
            backgroundColor: '#0f1115',
            scale: 2,
            logging: false,
            useCORS: true
        });
        
        const link = document.createElement('a');
        link.download = `sfdc-analysis-${currentLogId || 'export'}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (e) {
        console.error("Screenshot capture failed:", e);
        alert("Failed to capture screenshot. Check console for details.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
