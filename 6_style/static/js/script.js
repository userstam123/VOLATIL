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

btnChooseDump.addEventListener('click', () => openFileBrowser());
btnRunSelected.addEventListener('click', runAllSelectedPlugins);
btnAggregate.addEventListener('click', () => handleAggregation('by_plugin'));
btnGroupPid.addEventListener('click', () => openPidModal());
btnRefreshFiles.addEventListener('click', loadFileTree);
if (btnCreateFile) btnCreateFile.addEventListener('click', () => promptCreateFile());

if (fileSortSelect) {
    fileSortSelect.addEventListener('change', (e) => { currentFileSort = e.target.value; loadFileTree(); });
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
    if (savedTheme === 'light') { document.body.classList.add('light-mode'); themeToggleBtn.textContent = '☀️'; }
    else { themeToggleBtn.textContent = '🌙'; }
    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        themeToggleBtn.textContent = isLight ? '☀️' : '🌙';
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    });
}

document.getElementById('btn-continue-existing').addEventListener('click', async () => {
    const selectedFolder = document.getElementById('existing-matches-select').value;
    if (!selectedFolder) return;
    closeModal();
    setStatus(`Continuing case ${selectedFolder}...`, 'running');
    showProgress(50, 100, 'Finalizing investigation...');
    try {
        const res = await fetch('/api/finalize_investigation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ temp_folder: currentTempFolder, action: 'continue', continue_folder: selectedFolder })
        });
        const data = await res.json();
        await setupCaseUI(data.folder);
    } catch (err) { showToast(err.message, 'error'); hideProgress(); }
});

document.getElementById('btn-create-new').addEventListener('click', async () => {
    const name = document.getElementById('modal-inv-name').value.trim();
    if (!name) { showToast("Please enter an investigation name", "warning"); return; }
    closeModal();
    setStatus(`Creating new case ${name}...`, 'running');
    showProgress(50, 100, 'Finalizing investigation...');
    try {
        const res = await fetch('/api/finalize_investigation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ temp_folder: currentTempFolder, action: 'new', inv_name: name })
        });
        const data = await res.json();
        await setupCaseUI(data.folder);
    } catch (err) { showToast(err.message, 'error'); hideProgress(); }
});

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`; toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
function setStatus(text, type) { statusBar.textContent = text; statusIndicator.className = `status-indicator ${type}`; }
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
}

function closeFileBrowser() { fileBrowserModal.style.display = 'none'; }

async function selectMemoryFile(path) {
    currentMemFile = path;
    closeFileBrowser();
    setStatus('Profiling memory dump...', 'running');
    showProgress(0, 100, 'Running OS detection...');
    try {
        const res = await fetch('/api/initialize_dump', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memory_file: currentMemFile })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); setStatus('Failed to profile dump', 'error'); hideProgress(); return; }
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
        invModal.style.display = 'flex';
    } catch (err) { showToast(err.message, 'error'); setStatus('Error profiling dump', 'error'); hideProgress(); }
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
    list.innerHTML = '';
    if (plugins.length === 0) { list.innerHTML = '<div class="empty-state">No plugins found</div>'; return; }
    const filtered = currentPluginSearch ? plugins.filter(p => p.toLowerCase().includes(currentPluginSearch)) : plugins;
    filtered.sort((a, b) => {
        const aSel = selectedPlugins.has(a) ? 0 : 1;
        const bSel = selectedPlugins.has(b) ? 0 : 1;
        return aSel - bSel;
    });
    filtered.forEach(plugin => {
        const wrapper = document.createElement('div');
        wrapper.className = 'plugin-item-wrapper';
        const itemRow = document.createElement('div');
        itemRow.className = `plugin-item ${selectedPlugins.has(plugin) ? 'selected' : ''}`;
        const helpBtn = document.createElement('button');
        helpBtn.className = 'plugin-params-btn'; helpBtn.innerHTML = '?'; helpBtn.title = 'Help';
        helpBtn.onclick = (e) => { e.stopPropagation(); showPluginHelp(plugin); };
        const paramsBtn = document.createElement('button');
        paramsBtn.className = 'plugin-params-btn'; paramsBtn.innerHTML = '⋮'; paramsBtn.title = 'Parameters';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.dataset.plugin = plugin; checkbox.checked = selectedPlugins.has(plugin);
        const label = document.createElement('span');
        label.className = 'plugin-item-name'; label.textContent = plugin; label.title = plugin;
        const dropdown = document.createElement('div');
        dropdown.className = 'params-dropdown';
        dropdown.id = `params-${plugin.replace(/[^a-zA-Z0-9]/g, '_')}`;
        paramsBtn.onclick = (e) => { e.stopPropagation(); toggleParamsDropdown(plugin, dropdown); };
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) { selectedPlugins.add(plugin); itemRow.classList.add('selected'); }
            else { selectedPlugins.delete(plugin); itemRow.classList.remove('selected'); }
            updateRunButton();
            renderPlugins(plugins);
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
    currentPluginSearch = e.target.value.toLowerCase();
    renderPlugins(allPlugins);
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
    if (dropdown.classList.contains('active')) { dropdown.classList.remove('active'); return; }
    if (!dropdown.dataset.loaded) {
        dropdown.innerHTML = '<div style="color:var(--ui-text-muted);font-size:12px;">Loading...</div>';
        const params = await fetchPluginParams(plugin);
        dropdown.innerHTML = '';
        if (!pluginParams[plugin]) pluginParams[plugin] = {};
        if (params.length === 0) {
            dropdown.innerHTML = '<div style="color:var(--ui-text-muted);font-size:12px;margin-bottom:8px;">No default parameters. Add custom below:</div>';
        } else {
            params.forEach(p => {
                const row = document.createElement('div');
                row.className = 'param-row';
                const cb = document.createElement('input');
                cb.type = 'checkbox'; cb.id = `param-cb-${dropdown.id}-${p.name}`;
                const lbl = document.createElement('label'); lbl.htmlFor = cb.id; lbl.textContent = p.name;
                const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Value';
                cb.onchange = () => {
                    if (!pluginParams[plugin]) pluginParams[plugin] = {};
                    pluginParams[plugin][p.name] = { active: cb.checked, value: inp.value, takes_value: p.takes_value };
                };
                inp.oninput = () => {
                    if (!pluginParams[plugin]) pluginParams[plugin] = {};
                    pluginParams[plugin][p.name] = { active: cb.checked, value: inp.value, takes_value: p.takes_value };
                };
                row.appendChild(cb); row.appendChild(lbl); row.appendChild(inp);
                dropdown.appendChild(row);
            });
        }
        const customSection = document.createElement('div');
        customSection.style.cssText = 'margin-top:10px;border-top:1px solid var(--ui-border);padding-top:8px;';
        customSection.innerHTML = `
            <div style="font-size:10px;color:var(--ui-text-muted);margin-bottom:4px;">Custom Parameters:</div>
            <div class="param-row">
                <input type="text" placeholder="Param name" id="custom-name-${plugin}" style="flex:1;">
                <input type="text" placeholder="Value" id="custom-value-${plugin}" style="flex:1;">
                <button class="btn btn-compact btn-primary" onclick="addCustomParam('${plugin}')">Add</button>
            </div>
            <div id="custom-params-list-${plugin}"></div>
        `;
        dropdown.appendChild(customSection);
        dropdown.dataset.loaded = 'true';
    }
    dropdown.classList.add('active');
}

window.addCustomParam = function(plugin) {
    const nameInput = document.getElementById(`custom-name-${plugin}`);
    const valueInput = document.getElementById(`custom-value-${plugin}`);
    const name = nameInput.value.trim();
    const value = valueInput.value.trim();
    if (!name) return;
    if (!pluginParams[plugin]) pluginParams[plugin] = {};
    pluginParams[plugin][name] = { active: true, value: value, takes_value: true, isCustom: true };
    const list = document.getElementById(`custom-params-list-${plugin}`);
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
        <label style="flex:1;font-family:monospace;color:var(--primary);">${name}</label>
        <input type="text" value="${value}" style="flex:1;" oninput="updateCustomParam('${plugin}','${name}',this.value)">
        <button class="btn btn-compact btn-secondary" onclick="removeCustomParam('${plugin}','${name}',this.parentElement)">✕</button>
    `;
    list.appendChild(row);
    nameInput.value = ''; valueInput.value = '';
};
window.updateCustomParam = function(plugin, name, value) {
    if (pluginParams[plugin] && pluginParams[plugin][name]) pluginParams[plugin][name].value = value;
};
window.removeCustomParam = function(plugin, name, rowElement) {
    if (pluginParams[plugin]) delete pluginParams[plugin][name];
    rowElement.remove();
};

async function fetchPluginParams(plugin) {
    try { const res = await fetch(`/api/plugin_params/${encodeURIComponent(plugin)}`); return await res.json(); }
    catch (e) { return []; }
}

function updateRunButton() {
    const count = selectedPlugins.size;
    document.getElementById('selected-count').textContent = count;
    btnRunSelected.disabled = count === 0;
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
        let files = data.files;
        files.sort((a, b) => {
            switch (currentFileSort) {
                case 'name-asc': return a.localeCompare(b);
                case 'name-desc': return b.localeCompare(a);
                default: return 0;
            }
        });
        tree.innerHTML = '';
        if (files.length === 0) { tree.innerHTML = '<div class="empty-state">No files yet</div>'; return; }
        files.forEach(file => {
            const div = document.createElement('div');
            div.className = 'file-item';
            div.draggable = true;
            div.dataset.fileName = file;
            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-item-name'; nameSpan.textContent = file; nameSpan.title = file; nameSpan.title = file;
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
            
            // Drag start handler for AI sidebar drop
            div.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', `file:${file}`);
                e.dataTransfer.effectAllowed = 'copy';
            });
            
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
    document.body.classList.add('loading');
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
    finally { document.body.classList.remove('loading'); }
}

async function openFileTab(filename, isFinished = false, forceProblematic = false, isEdit = false) {
    if (document.getElementById(`tab-btn-${filename}`)) { switchTab(filename); if (isEdit) toggleEditMode(filename); return; }
    createTab(filename, filename, false, isFinished, forceProblematic, false, isEdit);
    const consoleContainer = document.getElementById(`tab-content-${filename}`);
    
    // Check if JSON file - render as interactive table
    if (filename.endsWith('.json')) {
        await renderJSONTable(consoleContainer, filename);
    } else if (isEdit) {
        renderEditMode(consoleContainer, filename);
    } else {
        consoleContainer.innerHTML = `<iframe src="/api/files/html/${currentFolder}/${encodeURIComponent(filename)}" style="width:100%;height:100%;border:none;background:#1e293b;flex:1;" data-filename="${filename}"></iframe>`;
    }
    
    openFileTabs.set(filename, { lastSize: -1 });
    checkFileSize(filename);
}

async function renderJSONTable(container, filename) {
    try {
        const res = await fetch(`/api/files/raw/${currentFolder}/${encodeURIComponent(filename)}`);
        const jsonText = await res.text();
        let jsonData;
        
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            container.innerHTML = `<div class="console-output">Error parsing JSON: ${e.message}</div>`;
            return;
        }
        
        // Convert to array of objects for table rendering
        let tableData = [];
        let columns = new Set();
        
        if (Array.isArray(jsonData)) {
            tableData = jsonData;
            tableData.forEach(row => Object.keys(row).forEach(k => columns.add(k)));
        } else if (typeof jsonData === 'object') {
            // Handle nested object structure (like Volatility output)
            for (const key in jsonData) {
                if (Array.isArray(jsonData[key])) {
                    jsonData[key].forEach(item => {
                        if (typeof item === 'object') {
                            const row = { _group: key, ...item };
                            tableData.push(row);
                            Object.keys(row).forEach(k => columns.add(k));
                        }
                    });
                } else if (typeof jsonData[key] === 'object') {
                    const row = { _group: key, ...jsonData[key] };
                    tableData.push(row);
                    Object.keys(row).forEach(k => columns.add(k));
                }
            }
        }
        
        const columnsArr = Array.from(columns);
        
        container.innerHTML = `
            <div class="json-table-container">
                <div class="json-table-toolbar">
                    <input type="text" class="json-table-search" placeholder="🔍 Search table...">
                    <button class="btn-process-tree" onclick="renderProcessTree('${filename}')">🌲 Interactive Process Tree</button>
                </div>
                <div class="json-table-wrapper">
                    <table class="json-data-table">
                        <thead>
                            <tr>${columnsArr.map(col => `<th data-column="${col}">${col}</th>`).join('')}</tr>
                        </thead>
                        <tbody>
                            ${tableData.slice(0, 100).map(row => `
                                <tr>${columnsArr.map(col => `<td>${row[col] !== undefined ? String(row[col]) : ''}</td>`).join('')}</tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="json-table-info">
                    <span>Showing ${Math.min(tableData.length, 100)} of ${tableData.length} rows</span>
                    <span>${filename}</span>
                </div>
            </div>
        `;
        
        // Add search functionality
        const searchInput = container.querySelector('.json-table-search');
        const tbody = container.querySelector('.json-data-table tbody');
        const allRows = Array.from(tbody.querySelectorAll('tr'));
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            allRows.forEach((row, idx) => {
                const matches = tableData[idx] && Object.values(tableData[idx]).some(val => 
                    String(val).toLowerCase().includes(query)
                );
                row.style.display = matches ? '' : 'none';
            });
        });
        
        // Add column sorting
        container.querySelectorAll('.json-data-table th').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.column;
                const sorted = [...tableData].sort((a, b) => {
                    const aVal = a[col] || '';
                    const bVal = b[col] || '';
                    return String(aVal).localeCompare(String(bVal));
                });
                
                // Re-render with sorted data
                const newHtml = sorted.slice(0, 100).map(row => 
                    `<tr>${columnsArr.map(c => `<td>${row[c] !== undefined ? String(row[c]) : ''}</td>`).join('')}</tr>`
                ).join('');
                tbody.innerHTML = newHtml;
                
                // Update sort indicators
                container.querySelectorAll('.json-data-table th').forEach(h => {
                    h.classList.remove('sorted-asc', 'sorted-desc');
                });
                th.classList.add('sorted-asc');
            });
        });
        
    } catch (err) {
        container.innerHTML = `<div class="console-output">Error loading JSON: ${err.message}</div>`;
    }
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

// ============================================================
// AI SIDEBAR FUNCTIONALITY
// ============================================================
let currentAIModel = 'qwen';
let aiAttachments = [];
let aiSidebarCollapsed = false;

const aiSidebar = document.getElementById('ai-sidebar');
const aiCollapseBtn = document.getElementById('ai-collapse-btn');
const aiTabs = document.querySelectorAll('.ai-tab');
const aiChatHistory = document.getElementById('ai-chat-history');
const aiPromptInput = document.getElementById('ai-prompt-input');
const aiSendBtn = document.getElementById('ai-send-btn');
const aiAttachmentStatus = document.getElementById('ai-attachment-status');

// API Key storage per model
const apiKeys = {
    qwen: '',
    gemini: '',
    grok: ''
};

// Load saved API keys from localStorage
function loadAPIKeys() {
    const savedKeys = localStorage.getItem('ai_api_keys');
    if (savedKeys) {
        try {
            const parsed = JSON.parse(savedKeys);
            apiKeys.qwen = parsed.qwen || '';
            apiKeys.gemini = parsed.gemini || '';
            apiKeys.grok = parsed.grok || '';
            
            // Populate input fields
            const qwenInput = document.getElementById('qwen-api-key');
            const geminiInput = document.getElementById('gemini-api-key');
            const grokInput = document.getElementById('grok-api-key');
            if (qwenInput) qwenInput.value = apiKeys.qwen;
            if (geminiInput) geminiInput.value = apiKeys.gemini;
            if (grokInput) grokInput.value = apiKeys.grok;
        } catch (e) {
            console.error('Failed to load API keys:', e);
        }
    }
}

// Save API key when changed
function saveAPIKey(model, value) {
    apiKeys[model] = value;
    localStorage.setItem('ai_api_keys', JSON.stringify(apiKeys));
}

// Setup API key listeners
function setupAPIKeyListeners() {
    const qwenInput = document.getElementById('qwen-api-key');
    const geminiInput = document.getElementById('gemini-api-key');
    const grokInput = document.getElementById('grok-api-key');
    
    if (qwenInput) {
        qwenInput.addEventListener('change', (e) => saveAPIKey('qwen', e.target.value));
        qwenInput.addEventListener('blur', (e) => saveAPIKey('qwen', e.target.value));
    }
    if (geminiInput) {
        geminiInput.addEventListener('change', (e) => saveAPIKey('gemini', e.target.value));
        geminiInput.addEventListener('blur', (e) => saveAPIKey('gemini', e.target.value));
    }
    if (grokInput) {
        grokInput.addEventListener('change', (e) => saveAPIKey('grok', e.target.value));
        grokInput.addEventListener('blur', (e) => saveAPIKey('grok', e.target.value));
    }
}

// Toggle AI sidebar collapse/expand
if (aiCollapseBtn) {
    aiCollapseBtn.addEventListener('click', () => {
        aiSidebarCollapsed = !aiSidebarCollapsed;
        aiSidebar.classList.toggle('collapsed', aiSidebarCollapsed);
        aiCollapseBtn.textContent = aiSidebarCollapsed ? '▶' : '◀';
    });
}

// AI model tab switching
aiTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        aiTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentAIModel = tab.dataset.model;
        addAIMessage(`Switched to ${currentAIModel.toUpperCase()} model.`, 'assistant', currentAIModel);
    });
});

// Send AI message
if (aiSendBtn && aiPromptInput) {
    aiSendBtn.addEventListener('click', sendAIMessage);
    aiPromptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendAIMessage();
        }
    });
}

async function sendAIMessage() {
    const prompt = aiPromptInput.value.trim();
    if (!prompt && aiAttachments.length === 0) return;
    
    // Add user message
    if (prompt) {
        addAIMessage(prompt, 'user', currentAIModel);
    }
    
    aiPromptInput.value = '';
    aiSendBtn.disabled = true;
    
    try {
        // Prepare attachments data
        const attachmentsData = aiAttachments.map(att => ({
            name: att.name,
            content: att.content,
            type: att.type
        }));
        
        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: currentAIModel,
                prompt: prompt,
                attachments: attachmentsData,
                api_key: apiKeys[currentAIModel] || ''
            })
        });
        
        const data = await response.json();
        if (data.response) {
            addAIMessage(data.response, 'assistant', currentAIModel);
        } else if (data.error) {
            addAIMessage(`Error: ${data.error}`, 'assistant', currentAIModel);
        }
    } catch (error) {
        addAIMessage(`Connection error: ${error.message}`, 'assistant', currentAIModel);
    } finally {
        aiSendBtn.disabled = false;
        aiAttachments = [];
        updateAttachmentStatus();
    }
}

function addAIMessage(content, role, model = 'qwen') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `ai-message ${role} model-${model}`;
    
    // Parse markdown-like code blocks
    const parsedContent = parseAICodeBlocks(content);
    msgDiv.innerHTML = parsedContent;
    
    aiChatHistory.appendChild(msgDiv);
    aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
}

function parseAICodeBlocks(content) {
    // Simple code block detection and rendering
    let html = content;
    
    // Replace ```language ... ``` blocks with styled code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'text';
        const safeCode = escapeHtml(code.trim());
        const filename = `${currentAIModel}_output.${getFileExtension(language)}`;
        return `
<div class="ai-code-block">
    <div class="ai-code-header">
        <span>${language.toUpperCase()}</span>
        <div class="ai-code-actions">
            <button class="ai-code-action-btn" onclick="copyCode(this)">📋 Copy</button>
            <button class="ai-code-action-btn" onclick="saveCodeToCase(this, '${filename}', '${safeCode.substring(0, 50)}')">💾 Save to Case</button>
        </div>
    </div>
    <div class="ai-code-content">${safeCode}</div>
</div>`;
    });
    
    // Convert line breaks
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getFileExtension(lang) {
    const extMap = {
        python: 'py', py: 'py', javascript: 'js', js: 'js',
        json: 'json', html: 'html', css: 'css', bash: 'sh',
        shell: 'sh', powershell: 'ps1', text: 'txt'
    };
    return extMap[lang.toLowerCase()] || 'txt';
}

function copyCode(btn) {
    const codeBlock = btn.closest('.ai-code-block');
    const codeContent = codeBlock.querySelector('.ai-code-content').textContent;
    navigator.clipboard.writeText(codeContent).then(() => {
        showToast('Code copied to clipboard!', 'success');
    }).catch(err => {
        showToast('Failed to copy code', 'error');
    });
}

function saveCodeToCase(btn, defaultName, preview) {
    const filename = prompt('Enter filename for the new case file:', defaultName);
    if (!filename) return;
    
    const codeBlock = btn.closest('.ai-code-block');
    const codeContent = codeBlock.querySelector('.ai-code-content').textContent;
    
    fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            folder: currentFolder,
            filename: filename,
            content: codeContent
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            showToast(data.error, 'error');
        } else {
            showToast(`File "${filename}" saved to case!`, 'success');
            loadFileTree();
        }
    })
    .catch(err => {
        showToast('Failed to save file', 'error');
    });
}

// Drag and drop file attachment
function setupAIDragDrop() {
    const dropzoneOverlay = document.createElement('div');
    dropzoneOverlay.className = 'ai-dropzone-overlay';
    dropzoneOverlay.innerHTML = '<div class="ai-dropzone-text">📎 Drop files to analyze with AI</div>';
    document.body.appendChild(dropzoneOverlay);
    
    let dragCounter = 0;
    let isDraggingFileItem = false;
    
    document.addEventListener('dragenter', (e) => {
        dragCounter++;
        // Check if we're dragging a file item from the case files tree
        if (e.target.closest('.file-item')) {
            isDraggingFileItem = true;
        }
        if (isDraggingFileItem) {
            dropzoneOverlay.classList.add('active');
        }
    });
    
    document.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter === 0) {
            dropzoneOverlay.classList.remove('active');
            isDraggingFileItem = false;
        }
    });
    
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (isDraggingFileItem) {
            e.dataTransfer.dropEffect = 'copy';
        }
    });
    
    document.addEventListener('drop', (e) => {
        dragCounter = 0;
        dropzoneOverlay.classList.remove('active');
        e.preventDefault();
        
        // Check if dropping a file item from the case files tree
        const draggedFileId = e.dataTransfer.getData('text/plain');
        if (draggedFileId && draggedFileId.startsWith('file:')) {
            const fileName = draggedFileId.replace('file:', '');
            attachFileToAI(fileName);
        }
    });
}

function attachFileToAI(fileName) {
    // Peek file contents
    fetch(`/api/files/peek/${currentFolder}/${fileName}`)
        .then(res => res.json())
        .then(data => {
            aiAttachments.push({
                name: fileName,
                content: data.head,
                size: data.size,
                type: fileName.endsWith('.json') ? 'json' : 'text'
            });
            updateAttachmentStatus();
            showToast(`📎 ${fileName} attached to AI chat`, 'success');
        })
        .catch(err => {
            showToast('Failed to attach file', 'error');
        });
}

function updateAttachmentStatus() {
    aiAttachmentStatus.innerHTML = '';
    aiAttachments.forEach((att, index) => {
        const chip = document.createElement('div');
        chip.className = 'ai-attachment-chip';
        chip.innerHTML = `
            <span>📎 ${att.name}</span>
            <span class="remove-attachment" onclick="removeAttachment(${index})">×</span>
        `;
        aiAttachmentStatus.appendChild(chip);
    });
}

function removeAttachment(index) {
    aiAttachments.splice(index, 1);
    updateAttachmentStatus();
}

// Initialize AI drag and drop on load
document.addEventListener('DOMContentLoaded', () => {
    setupAIDragDrop();
    loadAPIKeys();
    setupAPIKeyListeners();
});

// Make functions globally available
window.copyCode = copyCode;
window.saveCodeToCase = saveCodeToCase;
window.removeAttachment = removeAttachment;
window.renderProcessTree = renderProcessTree;

// ============================================================
// PROCESS TREE VISUALIZATION
// ============================================================
function renderProcessTree(filename) {
    // Find the current tab content
    const tabContent = document.getElementById(`tab-content-${filename}`);
    if (!tabContent) return;
    
    // Re-fetch and build tree
    fetch(`/api/files/raw/${currentFolder}/${encodeURIComponent(filename)}`)
        .then(res => res.text())
        .then(jsonText => {
            try {
                const jsonData = JSON.parse(jsonText);
                
                // Extract process data
                let processes = [];
                
                if (Array.isArray(jsonData)) {
                    processes = jsonData;
                } else if (typeof jsonData === 'object') {
                    for (const key in jsonData) {
                        if (Array.isArray(jsonData[key])) {
                            processes.push(...jsonData[key]);
                        } else if (typeof jsonData[key] === 'object') {
                            processes.push(jsonData[key]);
                        }
                    }
                }
                
                // Build tree structure
                const treeContainer = document.createElement('div');
                treeContainer.className = 'process-tree-container';
                treeContainer.innerHTML = `
                    <h3 style="color: var(--primary); margin-bottom: 15px;">🌲 Process Tree - ${filename}</h3>
                    <div id="tree-root"></div>
                    <div id="process-inspector" class="process-tree-inspector" style="display:none;"></div>
                `;
                
                tabContent.innerHTML = '';
                tabContent.appendChild(treeContainer);
                
                // Build PID -> PPID mapping
                const pidMap = new Map();
                const childrenMap = new Map();
                
                processes.forEach(proc => {
                    const pid = String(proc.PID || proc.pid || proc.Pid || '');
                    const ppid = String(proc.PPID || proc.ppid || proc.ParentPid || '0');
                    
                    if (pid) {
                        pidMap.set(pid, proc);
                        if (!childrenMap.has(ppid)) {
                            childrenMap.set(ppid, []);
                        }
                        childrenMap.get(ppid).push(pid);
                    }
                });
                
                // Find root processes (PPID = 0 or not found)
                const rootPids = [];
                pidMap.forEach((proc, pid) => {
                    const ppid = String(proc.PPID || proc.ppid || proc.ParentPid || '0');
                    if (ppid === '0' || !pidMap.has(ppid)) {
                        rootPids.push(pid);
                    }
                });
                
                const treeRoot = document.getElementById('tree-root');
                
                // Render tree recursively
                function renderNode(pid, depth = 0) {
                    const proc = pidMap.get(pid);
                    if (!proc) return null;
                    
                    const nodeDiv = document.createElement('div');
                    nodeDiv.className = 'process-tree-node';
                    
                    const itemName = proc.ImageName || proc.name || proc.ProcessName || 'unknown';
                    const isSuspicious = checkSuspiciousProcess(proc);
                    
                    nodeDiv.innerHTML = `
                        <div class="process-tree-item ${isSuspicious ? 'suspicious' : ''}" data-pid="${pid}">
                            <span class="process-tree-toggle">${childrenMap.has(pid) && childrenMap.get(pid).length > 0 ? '▶' : '•'}</span>
                            <span class="process-tree-pid">${pid}</span>
                            <span class="process-tree-name">${itemName}</span>
                        </div>
                        <div class="process-tree-children"></div>
                    `;
                    
                    const item = nodeDiv.querySelector('.process-tree-item');
                    const childrenContainer = nodeDiv.querySelector('.process-tree-children');
                    const toggle = nodeDiv.querySelector('.process-tree-toggle');
                    
                    // Click to select and show details
                    item.addEventListener('click', () => {
                        document.querySelectorAll('.process-tree-item').forEach(i => i.classList.remove('selected'));
                        item.classList.add('selected');
                        showProcessInspector(proc);
                    });
                    
                    // Toggle children
                    toggle.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const hasChildren = childrenMap.has(pid) && childrenMap.get(pid).length > 0;
                        if (hasChildren) {
                            const isExpanded = childrenContainer.classList.contains('expanded');
                            childrenContainer.classList.toggle('expanded', !isExpanded);
                            toggle.classList.toggle('expanded', !isExpanded);
                        }
                    });
                    
                    // Render children
                    const childPids = childrenMap.get(pid) || [];
                    childPids.forEach(childPid => {
                        const childNode = renderNode(childPid, depth + 1);
                        if (childNode) childrenContainer.appendChild(childNode);
                    });
                    
                    if (childPids.length > 0) {
                        childrenContainer.classList.add('expanded');
                        toggle.classList.add('expanded');
                    }
                    
                    return nodeDiv;
                }
                
                // Render all root nodes
                rootPids.sort().forEach(pid => {
                    const node = renderNode(pid);
                    if (node) treeRoot.appendChild(node);
                });
                
                // Show inspector function
                function showProcessInspector(proc) {
                    const inspector = document.getElementById('process-inspector');
                    const pid = proc.PID || proc.pid || 'N/A';
                    const ppid = proc.PPID || proc.ppid || 'N/A';
                    const name = proc.ImageName || proc.name || 'N/A';
                    const threads = proc.Threads || proc.num_threads || 'N/A';
                    const handles = proc.Handles || 'N/A';
                    const cmdline = proc.CommandLine || proc.cmdline || 'N/A';
                    const path = proc.Path || proc.ImageFileName || 'N/A';
                    
                    inspector.style.display = 'block';
                    inspector.innerHTML = `
                        <h3>📋 Process Details</h3>
                        <div class="process-tree-inspector-row">
                            <span class="process-tree-inspector-label">Process Name:</span>
                            <span class="process-tree-inspector-value">${name}</span>
                        </div>
                        <div class="process-tree-inspector-row">
                            <span class="process-tree-inspector-label">PID:</span>
                            <span class="process-tree-inspector-value">${pid}</span>
                        </div>
                        <div class="process-tree-inspector-row">
                            <span class="process-tree-inspector-label">PPID:</span>
                            <span class="process-tree-inspector-value">${ppid}</span>
                        </div>
                        <div class="process-tree-inspector-row">
                            <span class="process-tree-inspector-label">Threads:</span>
                            <span class="process-tree-inspector-value">${threads}</span>
                        </div>
                        <div class="process-tree-inspector-row">
                            <span class="process-tree-inspector-label">Handles:</span>
                            <span class="process-tree-inspector-value">${handles}</span>
                        </div>
                        <div class="process-tree-inspector-row">
                            <span class="process-tree-inspector-label">Path:</span>
                            <span class="process-tree-inspector-value" style="word-break:break-all;">${path}</span>
                        </div>
                        <div class="process-tree-inspector-row" style="flex-direction:column;align-items:flex-start;">
                            <span class="process-tree-inspector-label">Command Line:</span>
                            <span class="process-tree-inspector-value" style="word-break:break-all;margin-top:4px;">${cmdline}</span>
                        </div>
                    `;
                }
                
                function checkSuspiciousProcess(proc) {
                    const name = (proc.ImageName || proc.name || '').toLowerCase();
                    const parent = (proc.ParentImage || '').toLowerCase();
                    
                    // Suspicious patterns
                    if (parent.includes('services.exe') && name.includes('cmd')) return true;
                    if (name.includes('svchost') && parent && !parent.includes('services')) return true;
                    if (name.includes('powershell') && parent && !parent.includes('explorer')) return true;
                    
                    return false;
                }
                
            } catch (e) {
                tabContent.innerHTML = `<div class="console-output">Error building process tree: ${e.message}</div>`;
            }
        })
        .catch(err => {
            const tabContent = document.getElementById(`tab-content-${filename}`);
            if (tabContent) {
                tabContent.innerHTML = `<div class="console-output">Error loading process tree: ${err.message}</div>`;
            }
        });
}