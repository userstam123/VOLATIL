let currentMemFile = null;
let currentInvName = null;
let currentOS = null;
let currentFolder = null;
let currentTempFolder = null;
let currentInfoPlugin = null;
let selectedPlugins = new Set();
let activeTasks = {};
let currentBrowserPath = "";
let browserHistory = [];
let browserHistoryIndex = -1;
let pluginParams = {};
const openFileTabs = new Map();
const MAX_CONCURRENT = 3;
let runningTasks = 0;
let pluginQueue = [];
let currentPluginSearch = "";
let currentFileSort = "name-asc";
let currentFileFilter = "all";
let currentFileSearch = "";
let renameTargetFile = null;
let allPlugins = [];

const btnChooseDump = document.getElementById('btn-choose-dump');
const btnRunSelected = document.getElementById('btn-run-selected');
const btnAggregate = document.getElementById('btn-aggregate');
const btnGroupPid = document.getElementById('btn-group-pid');
const btnRefreshFiles = document.getElementById('btn-refresh-files');
const btnCreateFile = document.getElementById('btn-create-file');
const invModal = document.getElementById('inv-modal');
const fileBrowserModal = document.getElementById('file-browser-modal');
const browserCurrentPath = document.getElementById('browser-address-bar');
const browserList = document.getElementById('browser-list');
const browserUpBtn = document.getElementById('browser-up-btn');
const browserBackBtn = document.getElementById('browser-back-btn');
const browserForwardBtn = document.getElementById('browser-forward-btn');
const browserRefreshBtn = document.getElementById('browser-refresh-btn');
const browserBreadcrumbs = document.getElementById('browser-breadcrumbs');
const statusBar = document.getElementById('status-text');
const statusIndicator = document.getElementById('status-indicator');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const renameModal = document.getElementById('rename-modal');
const renameInput = document.getElementById('rename-input');
const btnConfirmRename = document.getElementById('btn-confirm-rename');
const pidModal = document.getElementById('pid-modal');
const pidFileList = document.getElementById('pid-file-list');
const btnConfirmPid = document.getElementById('btn-confirm-pid');
const fileSortSelect = document.getElementById('file-sort-select');
const fileFilterSelect = document.getElementById('file-filter-select');

btnChooseDump.addEventListener('click', () => openFileBrowser());
btnRunSelected.addEventListener('click', runAllSelectedPlugins);
btnAggregate.addEventListener('click', () => handleAggregation('by_plugin'));
btnGroupPid.addEventListener('click', () => openPidModal());
btnRefreshFiles.addEventListener('click', loadFileTree);
if (btnCreateFile) btnCreateFile.addEventListener('click', () => promptCreateFile());

if (fileSortSelect) {
    fileSortSelect.addEventListener('change', (e) => { currentFileSort = e.target.value; loadFileTree(); });
}

if (fileFilterSelect) {
    fileFilterSelect.addEventListener('change', (e) => { currentFileFilter = e.target.value; loadFileTree(); });
}

document.getElementById('file-search').addEventListener('input', (e) => {
    currentFileSearch = e.target.value.toLowerCase();
    applyFileSearchFilter();
});

function applyFileSearchFilter() {
    document.querySelectorAll('.file-item').forEach(item => {
        const name = item.querySelector('.file-item-name');
        if (name) item.style.display = name.textContent.toLowerCase().includes(currentFileSearch) ? 'flex' : 'none';
    });
}

function openRenameModal(filename) {
    renameTargetFile = filename;
    renameInput.value = filename;
    renameModal.style.display = 'flex';
    setTimeout(() => renameInput.focus(), 100);
}
function closeRenameModal() { renameModal.style.display = 'none'; renameTargetFile = null; }
btnConfirmRename.addEventListener('click', async () => {
    const newName = renameInput.value.trim();
    if (!newName || !renameTargetFile || newName === renameTargetFile) { closeRenameModal(); return; }
    await doRename(renameTargetFile, newName);
    closeRenameModal();
});
renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnConfirmRename.click();
    if (e.key === 'Escape') closeRenameModal();
});

async function doRename(oldName, newName) {
    try {
        const res = await fetch('/api/files/rename', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: currentFolder, old_name: oldName, new_name: newName })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); }
        else {
            showToast(`Renamed to ${newName}`, 'success');
            loadFileTree();
            const tabBtn = document.getElementById(`tab-btn-${oldName}`);
            if (tabBtn) {
                tabBtn.id = `tab-btn-${newName}`;
                tabBtn.querySelector('span').textContent = newName;
                const content = document.getElementById(`tab-content-${oldName}`);
                if (content) content.id = `tab-content-${newName}`;
            }
        }
    } catch (err) { showToast(err.message, 'error'); }
}

let availablePidFiles = [];
function openPidModal() {
    if (!currentFolder) { showToast("No active case", "warning"); return; }
    pidModal.style.display = 'flex';
    pidFileList.innerHTML = '<div class="empty-state">Loading...</div>';
    fetch(`/api/files/${currentFolder}`)
        .then(r => r.json())
        .then(data => {
            availablePidFiles = data.files.filter(f => 
                f.endsWith('.json') && !f.endsWith('_aggregated_by_plugin.json') && 
                !f.endsWith('_grouped_by_pid.json') && f !== 'error_log.json' && f !== 'metadata.json'
            );
            renderPidFileList(availablePidFiles.map(f => ({ name: f, selected: true })));
        })
        .catch(err => { pidFileList.innerHTML = '<div style="color:var(--danger);">Error loading files</div>'; });
}
function closePidModal() { pidModal.style.display = 'none'; }

function renderPidFileList(files) {
    pidFileList.innerHTML = '';
    if (files.length === 0) { pidFileList.innerHTML = '<div class="empty-state">No JSON files available</div>'; return; }
    files.forEach((f, i) => {
        const div = document.createElement('div');
        div.className = 'pid-file-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = f.selected; cb.dataset.index = i;
        cb.onchange = () => { files[i].selected = cb.checked; };
        const lbl = document.createElement('span'); lbl.textContent = f.name;
        div.appendChild(cb); div.appendChild(lbl);
        pidFileList.appendChild(div);
    });
}

document.getElementById('btn-pid-select-all').addEventListener('click', () => {
    pidFileList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = true; const idx = parseInt(cb.dataset.index);
        if (availablePidFiles[idx]) availablePidFiles[idx].selected = true;
    });
});
document.getElementById('btn-pid-deselect-all').addEventListener('click', () => {
    pidFileList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = false; const idx = parseInt(cb.dataset.index);
        if (availablePidFiles[idx]) availablePidFiles[idx].selected = false;
    });
});

btnConfirmPid.addEventListener('click', async () => {
    const selected = availablePidFiles.filter(f => f.selected).map(f => f.name);
    if (selected.length === 0) { showToast("No files selected", "warning"); return; }
    closePidModal();
    await handleAggregationWithFiles('by_pid', selected);
});

// THEME TOGGLE
const themeToggleBtn = document.getElementById('theme-toggle');
if (themeToggleBtn) {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') { 
        document.body.classList.add('light-mode'); 
        document.documentElement.classList.add('light-mode');
        themeToggleBtn.textContent = '☀️'; 
    }
    else { themeToggleBtn.textContent = '🌙'; }
    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        document.documentElement.classList.toggle('light-mode', isLight);
        themeToggleBtn.textContent = isLight ? '☀️' : '🌙';
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    });
}

document.getElementById('btn-continue-existing').addEventListener('click', async () => {
    const selectedFolder = document.getElementById('existing-matches-select').value;
    if (!selectedFolder) return;
    closeModal();
    setStatus(`Continuing case ${selectedFolder}...`, 'running');
    showLoadingOverlay();
    try {
        const res = await fetch('/api/finalize_investigation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ temp_folder: currentTempFolder, action: 'continue', continue_folder: selectedFolder })
        });
        const data = await res.json();
        await setupCaseUI(data.folder);
    } catch (err) { showToast(err.message, 'error'); }
    finally { hideLoadingOverlay(); hideProgress(); }
});

document.getElementById('btn-create-new').addEventListener('click', async () => {
    const name = document.getElementById('modal-inv-name').value.trim();
    if (!name) { showToast("Please enter an investigation name", "warning"); return; }
    closeModal();
    setStatus(`Creating new case ${name}...`, 'running');
    showLoadingOverlay();
    try {
        const res = await fetch('/api/finalize_investigation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ temp_folder: currentTempFolder, action: 'new', inv_name: name })
        });
        const data = await res.json();
        await setupCaseUI(data.folder);
    } catch (err) { showToast(err.message, 'error'); }
    finally { hideLoadingOverlay(); hideProgress(); }
});

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`; toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
function setStatus(text, type) { statusBar.textContent = text; statusIndicator.className = `status-indicator ${type}`; }

// Show loading overlay with spinning animation
function showLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'flex';
}

// Hide loading overlay
function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

function showProgress(current, total, message) {
    progressContainer.style.display = 'block';
    const percentage = total > 0 ? (current / total) * 100 : 0;
    progressFill.style.width = percentage + '%';
    progressText.textContent = message || `Processing ${current} of ${total}`;
}
function hideProgress() { progressContainer.style.display = 'none'; progressFill.style.width = '0%'; }

function logErrorToBackend(plugin, reason) {
    if (!currentFolder || !currentMemFile) return;
    fetch('/api/log_error', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: currentFolder, plugin: plugin, reason: reason, command_line: `python vol.py -f "${currentMemFile}" ${plugin}`, exit_code: -1 })
    }).catch(err => console.error("Failed to log error:", err));
}

// FILE EXPLORER NAVIGATION WITH DRIVE SUPPORT
function addToHistory(path) {
    browserHistory = browserHistory.slice(0, browserHistoryIndex + 1);
    browserHistory.push(path);
    browserHistoryIndex = browserHistory.length - 1;
    updateNavButtons();
}

function updateNavButtons() {
    if (browserBackBtn) browserBackBtn.disabled = browserHistoryIndex <= 0;
    if (browserForwardBtn) browserForwardBtn.disabled = browserHistoryIndex >= browserHistory.length - 1;
}

if (browserBackBtn) {
    browserBackBtn.addEventListener('click', () => {
        if (browserHistoryIndex > 0) {
            browserHistoryIndex--;
            const path = browserHistory[browserHistoryIndex];
            currentBrowserPath = path;
            loadBrowserDirectory(path, false);
            updateNavButtons();
        }
    });
}

if (browserForwardBtn) {
    browserForwardBtn.addEventListener('click', () => {
        if (browserHistoryIndex < browserHistory.length - 1) {
            browserHistoryIndex++;
            const path = browserHistory[browserHistoryIndex];
            currentBrowserPath = path;
            loadBrowserDirectory(path, false);
            updateNavButtons();
        }
    });
}

if (browserUpBtn) {
    browserUpBtn.addEventListener('click', () => {
        // If we are in a folder, go up. If we are at root (drives), disable.
        if (currentBrowserPath && currentBrowserPath.length > 3) {
            let parent = currentBrowserPath.substring(0, currentBrowserPath.lastIndexOf('\\', currentBrowserPath.length - 2) + 1);
            if (!parent) parent = currentBrowserPath.substring(0, 3);
            openFileBrowser(parent);
        }
    });
}

if (browserRefreshBtn) {
    browserRefreshBtn.addEventListener('click', () => { loadBrowserDirectory(currentBrowserPath, false); });
}

if (browserCurrentPath) {
    browserCurrentPath.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const path = browserCurrentPath.value.trim();
            if (path) openFileBrowser(path);
        }
    });
}

function updateBreadcrumbs(path) {
    if (!browserBreadcrumbs) return;
    browserBreadcrumbs.innerHTML = '';
    
    // If at root/drives view
    if (!path) {
        const item = document.createElement('span');
        item.className = 'breadcrumb-current';
        item.textContent = 'This PC';
        browserBreadcrumbs.appendChild(item);
        return;
    }

    const parts = path.split('\\').filter(p => p);
    let currentPath = '';
    
    parts.forEach((part, index) => {
        currentPath += part + '\\';
        if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-separator';
            sep.textContent = '›';
            browserBreadcrumbs.appendChild(sep);
        }
        const item = document.createElement('span');
        item.className = index === parts.length - 1 ? 'breadcrumb-current' : 'breadcrumb-item';
        item.textContent = part;
        if (index < parts.length - 1) {
            const fullPath = currentPath;
            item.onclick = () => openFileBrowser(fullPath);
        }
        browserBreadcrumbs.appendChild(item);
    });
}

async function loadBrowserDirectory(path, addToHist = true) {
    browserList.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
        const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.error) {
            browserList.innerHTML = `<div style="padding:10px;color:var(--danger);">${data.error}</div>`;
            return;
        }
        
        currentBrowserPath = data.current_path;
        if (browserCurrentPath) browserCurrentPath.value = data.current_path;
        
        // Update Up button state based on whether we are at root
        if (browserUpBtn) browserUpBtn.disabled = !data.parent_path;
        
        updateBreadcrumbs(data.current_path);
        browserList.innerHTML = '';
        
        if (data.items.length === 0) { 
            browserList.innerHTML = '<div class="empty-state">Empty Folder</div>'; 
            return; 
        }
        
        data.items.forEach(item => {
            const div = document.createElement('div');
            div.className = `browser-item ${item.is_dir ? 'dir' : ''}`;
            
            // Use drive icon for drives, folder/file icons otherwise
            const isDrive = item.path.length === 3 && item.path.endsWith(':\\');
            const icon = isDrive ? '💾' : (item.is_dir ? '📁' : '📄');
            const displayName = item.locked ? item.name : item.name;
            
            div.innerHTML = `<span class="browser-item-icon">${icon}</span><span>${displayName}</span>`;
            div.onclick = () => item.is_dir ? openFileBrowser(item.path) : selectMemoryFile(item.path);
            browserList.appendChild(div);
        });
    } catch (err) { 
        browserList.innerHTML = `<div style="padding:10px;color:var(--danger);">Error loading directory: ${err.message}</div>`; 
    }
}

async function openFileBrowser(path = '') {
    fileBrowserModal.style.display = 'flex';
    addToHistory(path);
    await loadBrowserDirectory(path, true);
    // Load and display recent dumps
    loadRecentDumps();
}

// Load recently used memory dumps from localStorage
function loadRecentDumps() {
    const recentList = document.getElementById('recent-dumps-list');
    if (!recentList) return;
    
    try {
        const recent = JSON.parse(localStorage.getItem('recent_dumps') || '[]');
        
        if (recent.length === 0) {
            recentList.innerHTML = '<span style="font-size: 11px; color: var(--ui-text-muted);">No recent dumps</span>';
            return;
        }
        
        recentList.innerHTML = '';
        recent.forEach(dumpPath => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-small btn-secondary';
            btn.style.marginBottom = '0';
            btn.textContent = dumpPath.split('\\').pop() || dumpPath;
            btn.title = dumpPath;
            btn.onclick = () => selectMemoryFile(dumpPath);
            recentList.appendChild(btn);
        });
    } catch (err) {
        console.error('Error loading recent dumps:', err);
        recentList.innerHTML = '<span style="font-size: 11px; color: var(--ui-text-muted);">No recent dumps</span>';
    }
}

// Save a dump path to recent list
function saveToRecentDumps(path) {
    try {
        const recent = JSON.parse(localStorage.getItem('recent_dumps') || '[]');
        // Remove if already exists (to move to front)
        const filtered = recent.filter(p => p !== path);
        // Add to front
        filtered.unshift(path);
        // Keep only last 5
        const limited = filtered.slice(0, 5);
        localStorage.setItem('recent_dumps', JSON.stringify(limited));
    } catch (err) {
        console.error('Error saving recent dump:', err);
    }
}

function closeFileBrowser() { fileBrowserModal.style.display = 'none'; }

async function selectMemoryFile(path) {
    currentMemFile = path;
    // Save to recent dumps
    saveToRecentDumps(path);
    closeFileBrowser();
    setStatus('Profiling memory dump...', 'running');
    showProgress(0, 100, 'Running OS detection...');
    showLoadingOverlay();
    try {
        const res = await fetch('/api/initialize_dump', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memory_file: currentMemFile })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); setStatus('Failed to profile dump', 'error'); hideProgress(); hideLoadingOverlay(); return; }
        currentOS = data.os;
        currentTempFolder = data.temp_folder;
        currentInfoPlugin = data.info_plugin;
        const continueSection = document.getElementById('continue-section');
        const matchesSelect = document.getElementById('existing-matches-select');
        const newNameInput = document.getElementById('modal-inv-name');
        matchesSelect.innerHTML = '';
        if (data.matches && data.matches.length > 0) {
            data.matches.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                matchesSelect.appendChild(opt);
            });
            continueSection.style.display = 'block';
            newNameInput.placeholder = "Or enter new name below...";
        } else {
            continueSection.style.display = 'none';
            newNameInput.placeholder = "e.g., Incident_Response_001";
            newNameInput.focus();
        }
        hideProgress();
        hideLoadingOverlay();
        invModal.style.display = 'flex';
    } catch (err) { showToast(err.message, 'error'); setStatus('Error profiling dump', 'error'); hideProgress(); hideLoadingOverlay(); }
}

function closeModal() {
    invModal.style.display = 'none';
    document.getElementById('modal-inv-name').value = '';
    document.getElementById('continue-section').style.display = 'none';
}

async function setupCaseUI(folderName) {
    currentFolder = folderName;
    currentInvName = folderName;
    document.getElementById('badge-case').textContent = `📋 Case: ${currentInvName}`;
    document.getElementById('badge-os').textContent = `💻 OS: ${currentOS ? currentOS.toUpperCase() : 'UNKNOWN'}`;
    document.getElementById('badges').style.display = 'block';
    hideProgress();
    showProgress(75, 100, 'Loading plugins...');
    if (currentOS && currentOS !== 'unknown') {
        const pluginsRes = await fetch(`/api/plugins/${currentOS}`);
        allPlugins = await pluginsRes.json();
        renderPlugins(allPlugins);
    } else {
        allPlugins = [];
        renderPlugins([]);
    }
    loadFileTree();
    setTimeout(() => {
        if (currentInfoPlugin && currentInfoPlugin !== 'unknown') {
            openFileTab(`${currentInfoPlugin}.txt`, false, false);
        }
    }, 500);
    setStatus('Ready. Select plugins and click Run.', 'success');
    showToast(`Case "${currentFolder}" ready!`, 'success');
    hideProgress();
}

function renderPlugins(plugins) {
    const list = document.getElementById('plugin-list');
    if (!list) return;
    
    // Filter out plugins that don't match the current search if implemented, 
    // otherwise use allPlugins or passed plugins.
    // Assuming 'plugins' argument is the full list or filtered list.
    
    // Sort plugins: Selected first, then alphabetical
    const sortedPlugins = [...plugins].sort((a, b) => {
        const aSelected = selectedPlugins.has(a);
        const bSelected = selectedPlugins.has(b);
        
        if (aSelected && !bSelected) return -1; // a comes first
        if (!aSelected && bSelected) return 1;  // b comes first
        return a.localeCompare(b); // Alphabetical if both selected or both unselected
    });

    list.innerHTML = '';
    
    sortedPlugins.forEach(plugin => {
        const wrapper = document.createElement('div');
        wrapper.className = 'plugin-item-wrapper';
        
        const itemRow = document.createElement('div');
        // Check if selected based on the set
        const isSelected = selectedPlugins.has(plugin);
        itemRow.className = `plugin-item ${isSelected ? 'selected' : ''}`;
        
        // Help Button
        const helpBtn = document.createElement('button');
        helpBtn.className = 'plugin-params-btn'; 
        helpBtn.innerHTML = '?'; 
        helpBtn.title = 'Help';
        helpBtn.onclick = (e) => { e.stopPropagation(); showPluginHelp(plugin); };
        
        // Params Button
        const paramsBtn = document.createElement('button');
        paramsBtn.className = 'plugin-params-btn'; 
        paramsBtn.innerHTML = '⋮'; 
        paramsBtn.title = 'Parameters';
        
        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; 
        checkbox.dataset.plugin = plugin; 
        checkbox.checked = isSelected;
        
        // Label
        const label = document.createElement('span');
        label.className = 'plugin-item-name'; 
        label.textContent = plugin; 
        label.title = plugin;
        
        // Dropdown Container
        const dropdown = document.createElement('div');
        dropdown.className = 'params-dropdown';
        dropdown.id = `params-${plugin.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        // Event Listeners
        paramsBtn.onclick = (e) => { 
            e.stopPropagation(); 
            toggleParamsDropdown(plugin, dropdown); 
        };
        
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) { 
                selectedPlugins.add(plugin); 
            } else { 
                selectedPlugins.delete(plugin); 
            }
            
            // Re-render immediately to move pinned items to top
            updateRunButton();
            renderPlugins(allPlugins); // Use global allPlugins to ensure full list is sorted
            
            // If we just selected it, we might want to keep the dropdown open or handle focus?
            // For now, standard behavior: re-render resets DOM, so dropdown closes.
            // If you want to keep dropdown open, you'd need to restore state, but usually 
            // pinning to top is visual enough.
        });

        itemRow.appendChild(helpBtn);
        itemRow.appendChild(paramsBtn);
        itemRow.appendChild(checkbox);
        itemRow.appendChild(label);
        
        wrapper.appendChild(itemRow);
        wrapper.appendChild(dropdown);
        list.appendChild(wrapper);
    });
}

document.getElementById('plugin-search').addEventListener('input', (e) => {
    currentPluginSearch = e.target.value.toLowerCase().trim();
    
    // Filter plugins based on search query
    const filteredPlugins = allPlugins.filter(plugin => 
        plugin.toLowerCase().includes(currentPluginSearch)
    );
    
    // Render filtered list
    renderPlugins(filteredPlugins);
});

async function showPluginHelp(plugin) {
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <h2 style="margin-bottom:15px;color:var(--ui-text);">Help: ${plugin}</h2>
            <div id="help-content" style="flex:1;overflow-y:auto;background:var(--space-bg);padding:10px;border-radius:4px;font-family:monospace;font-size:11px;white-space:pre-wrap;color:var(--ui-text);border:1px solid var(--ui-border);">Loading...</div>
            <div class="modal-buttons"><button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Close</button></div>
        </div>
    `;
    document.body.appendChild(modal);
    try {
        const res = await fetch(`/api/plugin_help/${encodeURIComponent(plugin)}`);
        const data = await res.json();
        document.getElementById('help-content').textContent = data.help || 'No help available.';
    } catch (err) { document.getElementById('help-content').textContent = 'Error loading help.'; }
}

async function toggleParamsDropdown(plugin, dropdown) {
    // Check if this specific dropdown is already active
    const isActive = dropdown.classList.contains('active');
    
    // Close ALL other dropdowns first to keep UI clean (optional, but recommended)
    document.querySelectorAll('.params-dropdown.active').forEach(d => {
        if (d !== dropdown) d.classList.remove('active');
    });

    if (isActive) {
        // If it was active, close it
        dropdown.classList.remove('active');
    } else {
        // If it was not active, open it
        dropdown.classList.add('active');
        
        // Load params if not already loaded
        if (!dropdown.dataset.loaded) {
            dropdown.innerHTML = '<div style="color:var(--ui-text-muted);font-size:12px;">Loading...</div>';
            try {
                const params = await fetchPluginParams(plugin);
                dropdown.innerHTML = ''; // Clear loading message
                
                // Initialize plugin params storage if needed
                if (!pluginParams[plugin]) pluginParams[plugin] = {};

                if (params.length === 0) {
                    dropdown.innerHTML = '<div style="color:var(--ui-text-muted);font-size:12px;margin-bottom:8px;">No default parameters. Add custom below:</div>';
                } else {
                    // Render default params
                    params.forEach(p => {
                        const row = document.createElement('div');
                        row.className = 'param-row';
                        
                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.checked = pluginParams[plugin][p.name]?.active || false;
                        
                        const lbl = document.createElement('label');
                        lbl.textContent = p.name;
                        
                        const inp = document.createElement('input');
                        inp.type = 'text';
                        inp.value = pluginParams[plugin][p.name]?.value || '';
                        inp.placeholder = p.default || '';
                        inp.disabled = !cb.checked;
                        
                        // Event listeners for updating state
                        cb.onchange = () => {
                            inp.disabled = !cb.checked;
                            if (!pluginParams[plugin]) pluginParams[plugin] = {};
                            pluginParams[plugin][p.name] = { 
                                active: cb.checked, 
                                value: inp.value, 
                                takes_value: p.takes_value 
                            };
                        };
                        
                        inp.oninput = () => {
                            if (!pluginParams[plugin]) pluginParams[plugin] = {};
                            pluginParams[plugin][p.name] = { 
                                active: cb.checked, 
                                value: inp.value, 
                                takes_value: p.takes_value 
                            };
                        };
                        
                        row.appendChild(cb);
                        row.appendChild(lbl);
                        row.appendChild(inp);
                        dropdown.appendChild(row);
                    });
                }
                
                // Add Custom Param Section
                const customSection = document.createElement('div');
                customSection.style.cssText = 'margin-top:10px; border-top:1px solid var(--ui-border);padding-top:8px;';
                customSection.innerHTML = `
                    <div style="font-size:12px; margin-bottom:5px; font-weight:bold;">Custom Parameters</div>
                    <div id="custom-params-list-${plugin.replace(/[^a-zA-Z0-9]/g, '_')}"></div>
                    <div style="display:flex; gap:5px; margin-top:5px;">
                        <input type="text" id="custom-name-${plugin.replace(/[^a-zA-Z0-9]/g, '_')}" placeholder="Name" style="flex:1; font-size:11px;">
                        <input type="text" id="custom-value-${plugin.replace(/[^a-zA-Z0-9]/g, '_')}" placeholder="Value" style="flex:1; font-size:11px;">
                        <button onclick="addCustomParam('${plugin}')" style="font-size:10px; padding:2px 5px;">+</button>
                    </div>
                `;
                dropdown.appendChild(customSection);
                
                // Render existing custom params if any
                if (pluginParams[plugin]) {
                    Object.keys(pluginParams[plugin]).forEach(key => {
                        const p = pluginParams[plugin][key];
                        if (p.isCustom) {
                            // Re-add to UI if it was saved in session/memory
                             const list = document.getElementById(`custom-params-list-${plugin.replace(/[^a-zA-Z0-9]/g, '_')}`);
                             if(list) {
                                 const row = document.createElement('div');
                                 row.className = 'param-row';
                                 row.innerHTML = `
                                    <label style="font-size:11px; flex:1;">${key}</label>
                                    <input type="text" value="${p.value}" style="flex:1; font-size:11px;" 
                                        oninput="updateCustomParam('${plugin}', '${key}', this.value)">
                                    <button onclick="removeCustomParam('${plugin}', '${key}', this.parentElement)" style="font-size:10px; color:var(--danger);">✕</button>
                                 `;
                                 list.appendChild(row);
                             }
                        }
                    });
                }

                dropdown.dataset.loaded = "true";
            } catch (e) {
                dropdown.innerHTML = '<div style="color:var(--danger);font-size:12px;">Failed to load params</div>';
            }
        }
    }
}

// Helper functions for custom params (ensure these are in global scope or accessible)
window.addCustomParam = function(plugin) {
    const safePluginId = plugin.replace(/[^a-zA-Z0-9]/g, '_');
    const nameInput = document.getElementById(`custom-name-${safePluginId}`);
    const valueInput = document.getElementById(`custom-value-${safePluginId}`);
    const name = nameInput.value.trim();
    const value = valueInput.value.trim();
    
    if (!name) return;
    
    if (!pluginParams[plugin]) pluginParams[plugin] = {};
    pluginParams[plugin][name] = { active: true, value: value, takes_value: true, isCustom: true };
    
    const list = document.getElementById(`custom-params-list-${safePluginId}`);
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
        <label style="font-size:11px; flex:1;">${name}</label>
        <input type="text" value="${value}" style="flex:1; font-size:11px;" 
            oninput="updateCustomParam('${plugin}', '${name}', this.value)">
        <button onclick="removeCustomParam('${plugin}', '${name}', this.parentElement)" style="font-size:10px; color:var(--danger);">✕</button>
    `;
    list.appendChild(row);
    
    nameInput.value = '';
    valueInput.value = '';
};

window.updateCustomParam = function(plugin, name, value) {
    if (pluginParams[plugin] && pluginParams[plugin][name]) {
        pluginParams[plugin][name].value = value;
    }
};

window.removeCustomParam = function(plugin, name, rowElement) {
    if (pluginParams[plugin]) {
        delete pluginParams[plugin][name];
    }
    rowElement.remove();
};

async function fetchPluginParams(plugin) {
    try { const res = await fetch(`/api/plugin_params/${encodeURIComponent(plugin)}`); return await res.json(); }
    catch (e) { return []; }
}

// Ensure updateRunButton is defined as before
function updateRunButton() {
    const count = selectedPlugins.size;
    const btn = document.getElementById('btn-run-selected');
    const countSpan = document.getElementById('selected-count');
    if(btn) btn.disabled = count === 0;
    if(countSpan) countSpan.textContent = count;
}

async function runAllSelectedPlugins() {
    if (selectedPlugins.size === 0) { showToast("No plugins selected", "warning"); return; }
    const pluginsToRun = Array.from(selectedPlugins);
    selectedPlugins.clear();
    updateRunButton();
    document.querySelectorAll('.plugin-item').forEach(item => {
        item.classList.remove('selected');
        const cb = item.querySelector('input');
        if (cb) cb.checked = false;
    });
    pluginQueue = pluginsToRun.map(p => ({ plugin: p, status: 'queued' }));
    runningTasks = 0;
    setStatus(`Queued ${pluginQueue.length} plugins...`, 'running');
    processQueue();
}

function processQueue() {
    while (runningTasks < MAX_CONCURRENT && pluginQueue.length > 0) {
        const nextTask = pluginQueue.shift();
        runningTasks++;
        runPlugin(nextTask.plugin).finally(() => { runningTasks--; processQueue(); });
    }
    if (runningTasks === 0 && pluginQueue.length === 0) {
        setStatus('All plugins completed!', 'success');
        showToast('All queued plugins completed', 'success');
        loadFileTree();
    } else if (pluginQueue.length > 0) {
        setStatus(`Running ${runningTasks}/${MAX_CONCURRENT}, ${pluginQueue.length} queued...`, 'running');
    }
}

async function runPlugin(plugin) {
    const tabId = `run-${plugin.replace(/[^a-zA-Z0-9_]/g, '_')}-${Date.now()}`;
    createTab(tabId, plugin, true, false, false, true);
    const tabEl = document.getElementById(`tab-btn-${tabId}`);
    if (tabEl) tabEl.classList.add('queued');
    const consoleDiv = document.getElementById(`console-${tabId}`);
    consoleDiv.innerHTML = '<div style="color:#f59e0b;">⏳ Waiting in queue...</div>';
    let streamBuffer = []; let isFlushing = false; let hasError = false; const MAX_DOM_LINES = 1000;
    let lineCount = 0; let hasProgressError = false;
    const triggerStallCheck = () => {
        if (lineCount <= 3 && activeTasks[tabId]?.isRunning && !hasError) {
            const keepRunning = confirm(`The plugin "${plugin}" has produced 3 or fewer lines in 5 minutes. Terminate?`);
            if (keepRunning) {
                hasError = true;
                streamBuffer.push('❌ STALLED: Terminated by user.');
                if (tabEl) {
                    tabEl.classList.remove('running', 'queued'); tabEl.classList.add('error');
                    tabEl.dataset.issue = "Plugin stalled (User terminated).";
                    tabEl.dataset.filename = plugin.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.txt';
                }
                if (!isFlushing) requestAnimationFrame(flushBuffer);
                logErrorToBackend(plugin, "Plugin stalled (User terminated).");
                if (activeTasks[tabId]?.taskId) fetch(`/api/scan/terminate/${activeTasks[tabId].taskId}`, { method: 'POST' });
            } else {
                lineCount = 0;
                activeTasks[tabId].stallTimer = setTimeout(triggerStallCheck, 300000);
            }
        } else if (activeTasks[tabId]?.isRunning && !hasError) {
            activeTasks[tabId].stallTimer = setTimeout(triggerStallCheck, 300000);
        }
    };
    if (!activeTasks[tabId]) activeTasks[tabId] = {};
    activeTasks[tabId].isRunning = true;
    activeTasks[tabId].plugin = plugin;
    activeTasks[tabId].stallTimer = setTimeout(triggerStallCheck, 300000);
    function flushBuffer() {
        if (streamBuffer.length === 0) { isFlushing = false; return; }
        isFlushing = true;
        const fragment = document.createDocumentFragment();
        const chunk = streamBuffer.splice(0, 50);
        chunk.forEach(text => { const div = document.createElement('div'); div.textContent = text; fragment.appendChild(div); });
        consoleDiv.appendChild(fragment);
        while (consoleDiv.childNodes.length > MAX_DOM_LINES) consoleDiv.removeChild(consoleDiv.firstChild);
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
        requestAnimationFrame(flushBuffer);
    }
    const paramsArray = [];
    if (pluginParams[plugin]) {
        for (const [name, data] of Object.entries(pluginParams[plugin])) {
            if (data.active) {
                paramsArray.push(name);
                if (data.takes_value && data.value && data.value.trim() !== '') paramsArray.push(data.value.trim());
            }
        }
    }
    try {
        if (tabEl) { tabEl.classList.remove('queued'); tabEl.classList.add('running'); }
        consoleDiv.innerHTML = '';
        const res = await fetch('/api/scan/start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memory_file: currentMemFile, plugin: plugin, inv_name: currentInvName, params: paramsArray })
        });
        const data = await res.json();
        if (data.error) { consoleDiv.textContent = `[ERROR] ${data.error}`; showToast(`Error starting ${plugin}`, 'error'); return; }
        activeTasks[tabId].taskId = data.task_id;
        const eventSource = new EventSource(`/api/scan/stream/${data.task_id}`);
        activeTasks[tabId].eventSource = eventSource;
        eventSource.onmessage = (event) => {
            if (event.data.startsWith('[ERROR]')) {
                if (activeTasks[tabId]?.stallTimer) clearTimeout(activeTasks[tabId].stallTimer);
                hasError = true;
                streamBuffer.push(`❌ ${event.data.replace('[ERROR]', '').replace('[/ERROR]', '')}`);
            } else if (event.data === '[PROCESS_TERMINATED]') {
                if (activeTasks[tabId]?.stallTimer) clearTimeout(activeTasks[tabId].stallTimer);
                eventSource.close();
                streamBuffer.push('✅ PROCESS COMPLETED');
                if (!isFlushing) requestAnimationFrame(flushBuffer);
                activeTasks[tabId].isRunning = false;
                const safeName = plugin.replace(/[^a-zA-Z0-9_\-]/g, '_');
                const txtFilename = safeName + '.txt';
                if (hasError || lineCount <= 3 || hasProgressError) {
                    if (tabEl) {
                        tabEl.classList.remove('running', 'queued', 'finished'); tabEl.classList.add('error');
                        tabEl.dataset.issue = "Plugin failed or produced invalid output.";
                        tabEl.dataset.filename = txtFilename;
                    }
                    if (!hasError) {
                        let reason = "Plugin produced insufficient output.";
                        if (hasProgressError) reason = "Plugin stuck in scanning loop.";
                        logErrorToBackend(plugin, reason);
                    }
                } else {
                    closeTab(tabId, false);
                    openFileTab(txtFilename, true, false);
                    loadFileTree();
                }
            } else {
                if (event.data.includes("Progress: ") && event.data.includes("Scanning ")) hasProgressError = true;
                lineCount++;
                if (activeTasks[tabId]?.stallTimer) clearTimeout(activeTasks[tabId].stallTimer);
                activeTasks[tabId].stallTimer = setTimeout(triggerStallCheck, 300000);
                streamBuffer.push(event.data);
                if (!isFlushing) requestAnimationFrame(flushBuffer);
            }
        };
        eventSource.onerror = () => {
            if (activeTasks[tabId]?.stallTimer) clearTimeout(activeTasks[tabId].stallTimer);
            eventSource.close();
            activeTasks[tabId].isRunning = false;
            streamBuffer.push('❌ CONNECTION CLOSED');
            if (!isFlushing) requestAnimationFrame(flushBuffer);
        };
    } catch (err) {
        if (activeTasks[tabId]?.stallTimer) clearTimeout(activeTasks[tabId].stallTimer);
        consoleDiv.textContent = `[ERROR] ${err.message}`;
        showToast(`Error running ${plugin}`, 'error');
    }
}

async function handleAggregation(type) {
    if (!currentFolder) { showToast("No active case", "warning"); return; }
    setStatus(type === 'by_plugin' ? 'Aggregating...' : 'Grouping by PID...', 'running');
    showProgress(0, 100, 'Processing...');
    try {
        const res = await fetch(`/api/aggregate?folder=${currentFolder}&type=${type}`);
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); setStatus('Failed', 'error'); }
        else { showToast(`Created: ${data.filename}`, 'success'); setStatus('Complete!', 'success'); loadFileTree(); }
    } catch (err) { showToast(err.message, 'error'); setStatus('Failed', 'error'); }
    hideProgress();
}

async function handleAggregationWithFiles(type, files) {
    if (!currentFolder) { showToast("No active case", "warning"); return; }
    setStatus('Grouping by PID...', 'running');
    showProgress(0, 100, 'Processing...');
    try {
        const res = await fetch('/api/aggregate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: currentFolder, type: type, files: files })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); setStatus('Failed', 'error'); }
        else { showToast(`Created: ${data.filename}`, 'success'); setStatus('Complete!', 'success'); loadFileTree(); }
    } catch (err) { showToast(err.message, 'error'); setStatus('Failed', 'error'); }
    hideProgress();
}

async function loadFileTree() {
    if (!currentFolder) return;
    const tree = document.getElementById('file-tree');
    tree.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
        const res = await fetch(`/api/files/${currentFolder}`);
        const data = await res.json();
        let files = data.files || [];
        
        // Apply filter first
        if (currentFileFilter && currentFileFilter !== 'all') {
            files = files.filter(f => f.toLowerCase().endsWith('.' + currentFileFilter.toLowerCase()));
        }
        
        // Then apply sort
        files.sort((a, b) => {
            switch (currentFileSort) {
                case 'name-asc': return a.localeCompare(b);
                case 'name-desc': return b.localeCompare(a);
                case 'type-asc': {
                    const extA = a.split('.').pop() || '';
                    const extB = b.split('.').pop() || '';
                    return extA.localeCompare(extB) || a.localeCompare(b);
                }
                case 'type-desc': {
                    const extA = a.split('.').pop() || '';
                    const extB = b.split('.').pop() || '';
                    return extB.localeCompare(extA) || b.localeCompare(a);
                }
                case 'created-asc': 
                case 'created-desc': {
                    // Use file stats from backend if available, otherwise fallback to name
                    const dateA = data.file_stats && data.file_stats[a] ? new Date(data.file_stats[a].created) : new Date(0);
                    const dateB = data.file_stats && data.file_stats[b] ? new Date(data.file_stats[b].created) : new Date(0);
                    return currentFileSort === 'created-asc' ? dateA - dateB : dateB - dateA;
                }
                case 'modified-asc':
                case 'modified-desc': {
                    // Use file stats from backend if available, otherwise fallback to name
                    const dateA = data.file_stats && data.file_stats[a] ? new Date(data.file_stats[a].modified) : new Date(0);
                    const dateB = data.file_stats && data.file_stats[b] ? new Date(data.file_stats[b].modified) : new Date(0);
                    return currentFileSort === 'modified-asc' ? dateA - dateB : dateB - dateA;
                }
                default: return 0;
            }
        });
        tree.innerHTML = '';
        if (files.length === 0) { tree.innerHTML = '<div class="empty-state">No files found</div>'; return; }
        files.forEach(file => {
            const div = document.createElement('div');
            div.className = 'file-item';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-item-name'; nameSpan.textContent = file; nameSpan.title = file;
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'file-actions';
            const editBtn = document.createElement('button');
            editBtn.className = 'file-action-btn'; editBtn.innerHTML = '✎'; editBtn.title = 'Edit';
            editBtn.onclick = (e) => { e.stopPropagation(); openFileTab(file, false, false, true); };
            const renameBtn = document.createElement('button');
            renameBtn.className = 'file-action-btn'; renameBtn.innerHTML = 'R'; renameBtn.title = 'Rename';
            renameBtn.onclick = (e) => { e.stopPropagation(); openRenameModal(file); };
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'file-action-btn delete'; deleteBtn.innerHTML = '✕'; deleteBtn.title = 'Delete';
            deleteBtn.onclick = (e) => { e.stopPropagation(); promptDeleteFile(file); };
            actionsDiv.appendChild(editBtn); actionsDiv.appendChild(renameBtn); actionsDiv.appendChild(deleteBtn);
            div.appendChild(nameSpan); div.appendChild(actionsDiv);
            div.onclick = () => handleSidebarFileClick(file);
            tree.appendChild(div);
        });
        applyFileSearchFilter();
    } catch (err) { tree.innerHTML = '<div style="color:var(--danger);text-align:center;">Error</div>'; }
}

async function promptCreateFile() {
    if (!currentFolder) { showToast("No active case", "warning"); return; }
    const filename = prompt("Enter new file name (e.g., notes.txt):");
    if (!filename) return;
    if (!filename.endsWith('.txt') && !filename.endsWith('.json')) { showToast("File must end with .txt or .json", "warning"); return; }
    try {
        const res = await fetch('/api/files/create', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: currentFolder, filename: filename, content: '' })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); }
        else { showToast(`Created ${filename}`, 'success'); loadFileTree(); openFileTab(filename, false, false, true); }
    } catch (err) { showToast(err.message, 'error'); }
}

async function promptDeleteFile(filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
    try {
        const res = await fetch('/api/files/delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: currentFolder, file: filename })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); }
        else { showToast(`Deleted ${filename}`, 'success'); loadFileTree(); closeTab(filename, false); }
    } catch (err) { showToast('Failed to delete: ' + err.message, 'error'); }
}

async function handleSidebarFileClick(file) {
    if (document.getElementById(`tab-btn-${file}`)) { switchTab(file); return; }
    showLoadingOverlay();
    try {
        const res = await fetch(`/api/files/peek/${currentFolder}/${encodeURIComponent(file)}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        const content = data.head || "";
        let isProblematic = false;
        let problemReason = "The plugin execution failed with an error.";
        const ignoredFiles = ['error_log.json', 'metadata.json'];
        if (ignoredFiles.includes(file)) { openFileTab(file, false, false, false); return; }
        const lines = content.split('\n').filter(l => l.trim() !== '');
        if (content.includes("Traceback") || content.includes("[ERROR]") || content.toLowerCase().includes("error:")) isProblematic = true;
        else if (data.size === 0 || lines.length === 0) { isProblematic = true; problemReason = "The file is completely empty."; }
        else if (lines.length === 1 && data.size < 500) { isProblematic = true; problemReason = "The file only contains a header."; }
        if (isProblematic) showIssuePopup(file, problemReason, file);
        else openFileTab(file, false, false, false);
    } catch (err) { showToast(`File ${file} not found`, 'error'); }
    finally { hideLoadingOverlay(); }
}

async function openFileTab(filename, isFinished = false, forceProblematic = false, isEdit = false) {
    if (document.getElementById(`tab-btn-${filename}`)) { switchTab(filename); if (isEdit) toggleEditMode(filename); return; }
    createTab(filename, filename, false, isFinished, forceProblematic, false, isEdit);
    const consoleContainer = document.getElementById(`tab-content-${filename}`);
    if (isEdit) renderEditMode(consoleContainer, filename);
    else consoleContainer.innerHTML = `<iframe src="/api/files/html/${currentFolder}/${encodeURIComponent(filename)}" style="width:100%;height:100%;border:none;background:#1e293b;flex:1;" data-filename="${filename}"></iframe>`;
    openFileTabs.set(filename, { lastSize: -1 });
    checkFileSize(filename);
}

async function renderEditMode(container, filename) {
    container.innerHTML = `
        <div class="edit-container">
            <div class="edit-toolbar">
                <button class="btn btn-small btn-secondary" onclick="toggleEditMode('${filename}')">👁 View Mode</button>
                <button class="btn btn-small btn-primary" onclick="saveFileEdit('${filename}')">💾 Save</button>
            </div>
            <textarea class="edit-textarea" id="edit-area-${filename}"></textarea>
        </div>
    `;
    try {
        const res = await fetch(`/api/files/raw/${currentFolder}/${encodeURIComponent(filename)}`);
        const text = await res.text();
        document.getElementById(`edit-area-${filename}`).value = text;
    } catch (err) { document.getElementById(`edit-area-${filename}`).value = "Error loading file content."; }
}

async function saveFileEdit(filename) {
    const content = document.getElementById(`edit-area-${filename}`).value;
    try {
        const res = await fetch('/api/files/save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: currentFolder, filename: filename, content: content })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); }
        else { showToast(`Saved ${filename}`, 'success'); loadFileTree(); }
    } catch (err) { showToast(err.message, 'error'); }
}

function toggleEditMode(filename) {
    const container = document.getElementById(`tab-content-${filename}`);
    const isCurrentlyEdit = container.querySelector('.edit-container') !== null;
    if (isCurrentlyEdit) container.innerHTML = `<iframe src="/api/files/html/${currentFolder}/${encodeURIComponent(filename)}?t=${Date.now()}" style="width:100%;height:100%;border:none;background:#1e293b;flex:1;" data-filename="${filename}"></iframe>`;
    else renderEditMode(container, filename);
}

async function checkFileSize(filename) {
    if (!currentFolder || !openFileTabs.has(filename)) return;
    try {
        const res = await fetch(`/api/files/peek/${currentFolder}/${encodeURIComponent(filename)}`);
        if (res.ok) {
            const data = await res.json();
            const info = openFileTabs.get(filename);
            if (info.lastSize !== -1 && data.size !== info.lastSize) {
                const iframe = document.querySelector(`#tab-content-${filename} iframe`);
                if (iframe && !document.getElementById(`edit-area-${filename}`)) iframe.src = `/api/files/html/${currentFolder}/${encodeURIComponent(filename)}?t=${Date.now()}`;
            }
            info.lastSize = data.size;
        }
    } catch (e) {}
}

setInterval(() => {
    for (const filename of openFileTabs.keys()) {
        if (activeTasks[filename] && activeTasks[filename].isRunning) continue;
        checkFileSize(filename);
    }
}, 3000);

function showIssuePopup(tabId, reason, filename) {
    if (document.getElementById(`issue-modal-${filename}`)) return;
    const modal = document.createElement('div');
    modal.className = 'modal issue-modal'; modal.id = `issue-modal-${filename}`; modal.style.display = 'flex';
    modal.innerHTML = `<div class="modal-content" style="width:400px;text-align:center;">
        <h2 style="color:var(--danger);margin-bottom:15px;">⚠️ Output Issue</h2>
        <p style="margin-bottom:20px;color:var(--ui-text);">${reason}</p>
        <p style="margin-bottom:20px;font-size:12px;color:var(--ui-text-muted);word-break:break-all;">File: ${filename}</p>
        <div class="modal-buttons" style="justify-content:center;gap:15px;">
            <button class="btn btn-secondary ignore-btn">Ignore (Delete)</button>
            <button class="btn btn-primary save-btn">Save (Keep)</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.ignore-btn').onclick = async () => {
        if (document.getElementById(`tab-btn-${tabId}`)) closeTab(tabId, false);
        if (filename) await fetch('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: currentFolder, file: filename }) });
        loadFileTree(); modal.remove();
    };
    modal.querySelector('.save-btn').onclick = () => {
        const tab = document.getElementById(`tab-btn-${tabId}`);
        if (tab) { tab.classList.remove('error'); delete tab.dataset.issue; }
        modal.remove(); loadFileTree();
    };
}

function createTab(id, title, isRunning, isFinished = false, isProblematic = false, isQueued = false, isEdit = false) {
    const header = document.getElementById('tabs-header');
    const container = document.getElementById('tabs-container');
    if (document.getElementById(`tab-btn-${id}`)) { switchTab(id); return; }
    const tab = document.createElement('div');
    tab.className = 'tab'; tab.id = `tab-btn-${id}`; tab.draggable = true;
    if (isQueued) tab.classList.add('queued');
    if (isRunning) {
        tab.classList.add('running');
        let seconds = 0;
        const timerSpan = document.createElement('span');
        timerSpan.className = 'tab-timer'; timerSpan.textContent = '00:00';
        tab.appendChild(timerSpan);
        const timerInterval = setInterval(() => {
            seconds++;
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            timerSpan.textContent = `${m}:${s}`;
        }, 1000);
        if (!activeTasks[id]) activeTasks[id] = {};
        activeTasks[id].timerInterval = timerInterval;
    }
    if (isFinished) tab.classList.add('finished');
    if (isProblematic) tab.classList.add('error');
    const titleSpan = document.createElement('span');
    titleSpan.textContent = title; tab.appendChild(titleSpan);
    if (!isRunning && !isQueued) {
        const editToggle = document.createElement('span');
        editToggle.className = 'tab-edit-toggle';
        editToggle.textContent = isEdit ? '👁 View' : '✎ Edit';
        editToggle.onclick = (e) => { e.stopPropagation(); toggleEditMode(id); };
        tab.appendChild(editToggle);
    }
    const closeSpan = document.createElement('span');
    closeSpan.className = 'tab-close'; closeSpan.textContent = '×';
    closeSpan.onclick = (e) => { e.stopPropagation(); closeTab(id, isRunning); };
    tab.appendChild(closeSpan);
    tab.onclick = (e) => {
        if (!e.target.classList.contains('tab-close') && !e.target.classList.contains('tab-edit-toggle')) {
            switchTab(id);
            if (tab.classList.contains('finished')) tab.classList.remove('finished');
            if (tab.classList.contains('error') && tab.dataset.issue) showIssuePopup(id, tab.dataset.issue, tab.dataset.filename || id);
        }
    };
    tab.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id, isRunning); } });
    tab.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => tab.classList.add('dragging'), 0); });
    tab.addEventListener('dragend', () => { tab.classList.remove('dragging'); document.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over')); });
    tab.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tab.classList.add('drag-over'); });
    tab.addEventListener('dragleave', () => { tab.classList.remove('drag-over'); });
    tab.addEventListener('drop', (e) => {
        e.preventDefault(); tab.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId === id) return;
        const draggedTab = document.getElementById(`tab-btn-${draggedId}`);
        const targetTab = document.getElementById(`tab-btn-${id}`);
        if (draggedTab && targetTab) {
            const headerChildren = Array.from(header.children);
            const draggedIndex = headerChildren.indexOf(draggedTab);
            const targetIndex = headerChildren.indexOf(targetTab);
            if (draggedIndex < targetIndex) targetTab.after(draggedTab); else targetTab.before(draggedTab);
        }
    });
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    header.appendChild(tab);
    const content = document.createElement('div');
    content.className = 'tab-content active'; content.id = `tab-content-${id}`;
    content.innerHTML = `<div class="console-output" id="console-${id}"></div>`;
    container.appendChild(content);
}

function switchTab(id) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const newBtn = document.getElementById(`tab-btn-${id}`);
    const newContent = document.getElementById(`tab-content-${id}`);
    if (newBtn) newBtn.classList.add('active');
    if (newContent) newContent.classList.add('active');
}

function closeTab(id, wasRunning) {
    const task = activeTasks[id];
    if (task) {
        if (task.timerInterval) clearInterval(task.timerInterval);
        if (task.stallTimer) clearTimeout(task.stallTimer);
        if (wasRunning && task.isRunning) {
            if (!confirm(`"${task.plugin}" is running. Terminate and close?`)) return;
            setStatus(`Terminating ${task.plugin}...`, 'running');
            try { fetch(`/api/scan/terminate/${task.taskId}`, { method: 'POST' }); if (task.eventSource) task.eventSource.close(); } catch (err) { console.error(err); }
        }
    }
    delete activeTasks[id]; openFileTabs.delete(id);
    document.getElementById(`tab-btn-${id}`)?.remove();
    document.getElementById(`tab-content-${id}`)?.remove();
    const remainingTabs = document.querySelectorAll('.tab');
    if (remainingTabs.length > 0) switchTab(remainingTabs[0].id.replace('tab-btn-', ''));
    setStatus('Ready', 'idle');
}