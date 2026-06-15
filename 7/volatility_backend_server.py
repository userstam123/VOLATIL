import os
import re
import sys
import uuid
import signal
import subprocess
import threading
import webbrowser
import json
import queue
import shutil
import stat
import ctypes
from threading import Timer, Lock
from datetime import datetime
from pathlib import Path
from collections import defaultdict
from flask import Flask, request, jsonify, Response, render_template, send_file

# ============================================================
# CORE ARCHITECTURE & PATH MAPPING
# ============================================================
def get_volatility_drive():
    script_path = os.path.abspath(__file__)
    drive = os.path.splitdrive(script_path)[0]
    return drive + "\\" if drive else "C:\\"

VOLATILITY_DRIVE = get_volatility_drive()
VOLATILITY_PATH = fr"{VOLATILITY_DRIVE}volatility3"
VOL_PATH = fr"{VOLATILITY_PATH}\vol.py"
FINDINGS_DIR = fr"{VOLATILITY_DRIVE}volatility3\findings"
TEMP_DIR = fr"{VOLATILITY_DRIVE}volatility3\temp"
Path(FINDINGS_DIR).mkdir(parents=True, exist_ok=True)


def normalize_path_for_comparison(path):
    """
    Normalizes a path for comparison by removing the drive letter.
    E.g., 'E:\Case\dump.mem' -> '\Case\dump.mem'
    This allows matching across different drive assignments.
    """
    if not path:
        return ""
    # Split off the drive letter (e.g., "C:")
    _, rest = os.path.splitdrive(path)
    # Normalize separators to forward slashes or consistent backslashes
    # Using os.path.normpath to clean up double slashes etc, then replace \ with / for safe comparison
    normalized = os.path.normpath(rest).replace(os.sep, '/')
    return normalized.lower()
    
    
# ============================================================
# STARTUP CLEANUP
# ============================================================
def remove_readonly(func, path, excinfo):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception: pass

if os.path.exists(TEMP_DIR):
    try: shutil.rmtree(TEMP_DIR, onerror=remove_readonly)
    except Exception as e: print(f"Warning: Could not clean temp: {e}")
os.makedirs(TEMP_DIR, exist_ok=True)

app = Flask(__name__, template_folder='templates', static_folder='static')
active_tasks = {}
error_log_lock = Lock()

RE_ANSI = re.compile(r'\x1b\[[0-9;]*m')
RE_CR = re.compile(r'\r\n?|\r')
RE_PROGRESS_LINE = re.compile(r'^\s*(?:Progress:\s*)?\d+\.\d+%\s*$')
RE_SKIP_LINES = re.compile(r'^(Starting |Volatility\s|ERROR\s+Traceback|File\s+"|  File\s+"|  \^~~~)')

def clean_plugin_output(line):
    if not line: return None
    line = RE_ANSI.sub('', line)
    line = RE_CR.sub('\n', line)
    line = line.strip()
    if not line: return None
    if RE_PROGRESS_LINE.match(line): return None
    if RE_SKIP_LINES.match(line): return None
    return line

def append_to_error_log(folder_path, plugin, cmd_line, reason, exit_code):
    log_path = os.path.join(folder_path, "error_log.json")
    entry = {"timestamp": datetime.now().isoformat(), "plugin": plugin, "command_line": cmd_line, "reason": reason, "exit_code": exit_code}
    with error_log_lock:
        existing_logs = []
        if os.path.exists(log_path):
            try:
                with open(log_path, "r", encoding="utf-8") as f: existing_logs = json.load(f)
            except Exception: existing_logs = []
        existing_logs.append(entry)
        with open(log_path, "w", encoding="utf-8") as f: json.dump(existing_logs, f, indent=4)

def detect_os_and_info(mem_file):
    custom_env = os.environ.copy()
    custom_env["PYTHONIOENCODING"] = "utf-8"
    try:
        result = subprocess.run([sys.executable, VOL_PATH, "-f", mem_file, "windows.info"], capture_output=True, text=True, cwd=VOLATILITY_PATH, env=custom_env, errors="ignore", timeout=120)
        if any(x in result.stdout.lower() for x in ["ntsystemroot", "kernel base", "peb"]): return "windows", "windows.info", result.stdout
    except Exception: pass
    try:
        result = subprocess.run([sys.executable, VOL_PATH, "-f", mem_file, "linux.banner"], capture_output=True, text=True, cwd=VOLATILITY_PATH, env=custom_env, errors="ignore", timeout=120)
        if any(x in result.stdout.lower() for x in ["linux version", "linux banner"]): return "linux", "linux.banner", result.stdout
    except Exception: pass
    return "unknown", "unknown", " "

class TaskManager:
    def __init__(self, task_id, proc, txt_path, json_path, plugin, cmd_line):
        self.task_id = task_id; self.proc = proc; self.txt_path = txt_path; self.json_path = json_path
        self.plugin = plugin; self.cmd_line = cmd_line; self.queue = queue.Queue()
        self.is_running = True; self.full_output = []; self.error_output = []
        self.thread = threading.Thread(target=self._run_process, daemon=True)
        self.thread.start()

    def _run_process(self):
        try:
            def read_stderr():
                for line in iter(self.proc.stderr.readline, ''):
                    if line: self.error_output.append(line)
            stderr_thread = threading.Thread(target=read_stderr, daemon=True)
            stderr_thread.start()
            with open(self.txt_path, "w", encoding="utf-8", errors="ignore") as f:
                for line in iter(self.proc.stdout.readline, ''):
                    if not self.is_running: break
                    clean_line = clean_plugin_output(line)
                    f.write(line); f.flush()
                    if clean_line:
                        self.full_output.append(clean_line)
                        if self.queue.qsize() < 5000: self.queue.put(clean_line)
            self.proc.wait(); stderr_thread.join()
            has_error = self.proc.returncode != 0 or any("Traceback" in e for e in self.error_output)
            if has_error:
                with open(self.txt_path, "a", encoding="utf-8", errors="ignore") as f:
                    f.write("\n\n--- STDERR / TRACEBACK ---\n")
                    for err_line in self.error_output: f.write(err_line)
                if os.path.exists(self.json_path): os.remove(self.json_path)
                error_msg = " ".join(self.error_output).strip()
                if not error_msg: error_msg = f"Process failed with exit code {self.proc.returncode}"
                append_to_error_log(os.path.dirname(self.txt_path), self.plugin, self.cmd_line, error_msg, self.proc.returncode)
                self.queue.put(f"[ERROR]{error_msg}[/ERROR]")
            else:
                try:
                    lines = self.full_output
                    if len(lines) > 1:
                        headers = lines[0].split()
                        data_dict = defaultdict(list)
                        for line in lines[1:]:
                            tokens = line.split()
                            if not tokens: continue
                            row_data = {header: (tokens[i] if i < len(tokens) else "") for i, header in enumerate(headers)}
                            key = tokens[headers.index("PID")] if "PID" in headers and len(tokens) > headers.index("PID") else tokens[0]
                            data_dict[key].append(row_data)
                        with open(self.json_path, "w", encoding="utf-8") as jf: json.dump(dict(data_dict), jf, indent=4)
                except Exception: pass
            self.queue.put("[PROCESS_TERMINATED]")
        except Exception as e: self.queue.put(f"[ERROR]{str(e)}[/ERROR]")
        finally: self.is_running = False

    def terminate(self):
        self.is_running = False
        if self.proc.poll() is None:
            try:
                if sys.platform == "win32": subprocess.call(['taskkill', '/F', '/T', '/PID', str(self.proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else: os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            except Exception: self.proc.terminate()
            


# ============================================================
# API ENDPOINTS
# ============================================================
@app.route('/')
def index(): return render_template('index.html')

@app.route('/api/browse')
def browse_files():
    path = request.args.get('path', '').strip()
    
    # If no path or empty path, return available drives
    if not path:
        drives = []
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for letter in range(65, 91):  # A-Z
            if bitmask & 1:
                drive_letter = chr(letter) + ":\\"
                drives.append({"name": drive_letter, "is_dir": True, "path": drive_letter})
            bitmask >>= 1
        return jsonify({"current_path": "", "parent_path": None, "items": drives})

    # Normalize path
    if not path.endswith("\\"): path += "\\"
    if not os.path.exists(path) or not os.path.isdir(path):
        return jsonify({"error": "Invalid path"}), 400
    
    items = []
    try:
        for entry in os.scandir(path):
            try: 
                items.append({"name": entry.name, "is_dir": entry.is_dir(follow_symlinks=False), "path": entry.path})
            except PermissionError: 
                # Add inaccessible folders with a lock icon indicator instead of crashing
                items.append({"name": f"[Locked] {entry.name}", "is_dir": entry.is_dir(follow_symlinks=False), "path": entry.path, "locked": True})
            except OSError: continue
        # Sort: Folders first, then files alphabetically
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
    except PermissionError:
        return jsonify({"error": "Permission denied. Try running as Administrator."}), 403

    # Calculate parent path
    parent_path = None
    if len(path) > 3:  # Not at root like C:\
        parent_path = os.path.dirname(path.rstrip("\\"))
        if not parent_path.endswith("\\"): parent_path += "\\"
        
    return jsonify({"current_path": path, "parent_path": parent_path, "items": items})

@app.route('/api/files/raw/<folder_name>/<path:file_name>')
def read_raw_file(folder_name, file_name):
    folder_path = os.path.join(FINDINGS_DIR, folder_name)
    if '..' in folder_name or '..' in file_name: return "Invalid path", 400
    path = os.path.join(folder_path, file_name)
    if not os.path.exists(path): return "File not found", 404
    return send_file(path, mimetype='text/plain; charset=utf-8')

@app.route('/api/initialize_dump', methods=['POST'])
def initialize_dump():
    data = request.get_json(silent=True) or {}
    mem_file = data.get('memory_file')
    if not mem_file: 
        return jsonify({"error": "Missing memory file"}), 400
    
    os_type, info_plugin, info_output = detect_os_and_info(mem_file)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_id = str(uuid.uuid4())[:8]
    temp_folder_rel = os.path.join(timestamp, temp_id)
    temp_path = os.path.join(TEMP_DIR, temp_folder_rel)
    os.makedirs(temp_path, exist_ok=True)
    
    metadata = {
        "os": os_type,
        "memory_dump": mem_file # Store original path for local execution
    }
    with open(os.path.join(temp_path, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=4)
        
    info_filename = f"{info_plugin}.txt" if info_plugin != "unknown" else "info.txt"
    with open(os.path.join(temp_path, info_filename), "w", encoding="utf-8") as f:
        f.write(info_output)
        
    with open(os.path.join(temp_path, "error_log.json"), "w", encoding="utf-8") as f:
        json.dump([], f)

    matches = []
    if os.path.exists(FINDINGS_DIR):
        # Normalize the input path for comparison
        input_path_normalized = normalize_path_for_comparison(mem_file)
        
        for d in os.listdir(FINDINGS_DIR):
            d_path = os.path.join(FINDINGS_DIR, d)
            if not os.path.isdir(d_path):
                continue
            meta_path = os.path.join(d_path, "metadata.json")
            if not os.path.exists(meta_path):
                continue
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    existing_meta = json.load(f)
                
                existing_dump_path = existing_meta.get("memory_dump", "")
                existing_path_normalized = normalize_path_for_comparison(existing_dump_path)
                
                # Compare normalized paths and OS
                if existing_meta.get("os") == os_type and existing_path_normalized == input_path_normalized:
                    matches.append(d)
            except Exception as e:
                print(f"Error reading metadata for {d}: {e}")
                continue

    return jsonify({
        "temp_folder": temp_folder_rel,
        "os": os_type,
        "matches": matches,
        "info_plugin": info_plugin,
        "memory_file": mem_file
    })
    
    
@app.route('/api/files/peek/<folder_name>/<path:file_name>')
def peek_file(folder_name, file_name):
    folder_path = os.path.join(FINDINGS_DIR, folder_name)
    if '..' in folder_name or '..' in file_name: return jsonify({"error": "Invalid path"}), 400
    path = os.path.join(folder_path, file_name)
    if not os.path.exists(path): return jsonify({"error": "File not found"}), 404
    size = os.path.getsize(path)
    head = ""
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f: head = f.read(4000)
    except Exception: pass
    return jsonify({"size": size, "head": head})

@app.route('/api/files/html/<folder_name>/<path:file_name>')
def view_html_file(folder_name, file_name):
    folder_path = os.path.join(FINDINGS_DIR, folder_name)
    if '..' in folder_name or '..' in file_name: return "Invalid path", 400
    path = os.path.join(folder_path, file_name)
    if not os.path.exists(path): return "File not found", 404
    def generate():
        yield "<!DOCTYPE html><html><head><meta charset='utf-8'><style>"
        yield "body{background:#1e293b;color:#e2e8f0;font-family:'Consolas',monospace;font-size:12px;white-space:pre-wrap;word-wrap:break-word;margin:0;padding:15px;line-height:1.5;}"
        yield "</style></head><body><pre>"
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            while True:
                chunk = f.read(65536)
                if not chunk: break
                chunk = chunk.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                yield chunk
        yield "</pre></body></html>"
    return Response(generate(), mimetype='text/html')

@app.route('/api/finalize_investigation', methods=['POST'])
def finalize_investigation():
    data = request.get_json(silent=True) or {}
    temp_folder = data.get('temp_folder'); action = data.get('action')
    temp_path = os.path.join(TEMP_DIR, temp_folder)
    if action == "continue":
        continue_folder = data.get('continue_folder')
        if os.path.exists(temp_path): shutil.rmtree(temp_path, onerror=remove_readonly)
        return jsonify({"folder": continue_folder})
    elif action == "new":
        inv_name = data.get('inv_name')
        if not inv_name: return jsonify({"error": "Missing name"}), 400
        date_str = datetime.now().strftime("%m-%d-%y")
        new_folder_name = f"{inv_name}-{date_str}"
        new_path = os.path.join(FINDINGS_DIR, new_folder_name)
        counter = 1; base_name = new_folder_name
        while os.path.exists(new_path):
            new_folder_name = f"{base_name}_{counter}"; new_path = os.path.join(FINDINGS_DIR, new_folder_name); counter += 1
        shutil.move(temp_path, new_path)
        return jsonify({"folder": new_folder_name})
    return jsonify({"error": "Invalid action"}), 400

@app.route('/api/plugins/<os_type>')
def list_plugins(os_type):
    custom_env = os.environ.copy(); custom_env["PYTHONIOENCODING"] = "utf-8"
    try:
        result = subprocess.run([sys.executable, VOL_PATH, os_type], capture_output=True, text=True, cwd=VOLATILITY_PATH, env=custom_env, errors="ignore", timeout=120)
        output = result.stdout + result.stderr
        start_text = f"plugin {os_type} matches multiple plugins ("
        start = output.find(start_text)
        if start == -1: return jsonify([])
        start += len(start_text); end = output.find(")", start)
        plugins = [p.strip() for p in output[start:end].split(", ") if p.strip()]
        return jsonify(sorted(plugins))
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/plugin_params/<plugin>')
def get_plugin_params(plugin):
    custom_env = os.environ.copy(); custom_env["PYTHONIOENCODING"] = "utf-8"
    cmd = [sys.executable, VOL_PATH, plugin, "-h"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=VOLATILITY_PATH, env=custom_env, errors="ignore", timeout=30)
        output = result.stdout + result.stderr
        params = []; lines = output.split('\n'); in_options = False
        for line in lines:
            if line.strip().lower() == 'options:': in_options = True; continue
            if in_options:
                if not line.startswith(' ') and not line.startswith('\t'): break
                match = re.search(r'(-{1,2}[\w-]+)', line)
                if match:
                    param_name = match.group(1)
                    if param_name in ['-h', '--help']: continue
                    takes_value = False
                    parts = line.split()
                    for part in parts:
                        if part.strip(',').startswith('-'): continue
                        if part.isupper() or part in ['PATH', 'FILE', 'DIR', 'PID', 'NAME', 'REGEX', 'STRING', 'INT']: takes_value = True; break
                    params.append({"name": param_name, "takes_value": takes_value})
        return jsonify(params)
    except Exception: return jsonify([])

@app.route('/api/plugin_help/<plugin>')
def get_plugin_help(plugin):
    custom_env = os.environ.copy(); custom_env["PYTHONIOENCODING"] = "utf-8"
    cmd = [sys.executable, VOL_PATH, plugin, "-h"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=VOLATILITY_PATH, env=custom_env, errors="ignore", timeout=30)
        return jsonify({"help": result.stdout + result.stderr})
    except Exception as e: return jsonify({"help": str(e)})

@app.route('/api/log_error', methods=['POST'])
def log_error():
    data = request.get_json(silent=True) or {}
    folder = data.get('folder'); plugin = data.get('plugin', 'Unknown'); reason = data.get('reason', 'Unknown error')
    cmd_line = data.get('command_line', 'N/A'); exit_code = data.get('exit_code', -1)
    if not folder: return jsonify({"error": "Missing folder"}), 400
    folder_path = os.path.join(FINDINGS_DIR, folder)
    if not os.path.exists(folder_path): return jsonify({"error": "Folder not found"}), 404
    log_path = os.path.join(folder_path, "error_log.json")
    entry = {"timestamp": datetime.now().isoformat(), "plugin": plugin, "command_line": cmd_line, "reason": reason, "exit_code": exit_code}
    with error_log_lock:
        existing_logs = []
        if os.path.exists(log_path):
            try:
                with open(log_path, "r", encoding="utf-8") as f: existing_logs = json.load(f)
            except Exception: existing_logs = []
        existing_logs.append(entry)
        with open(log_path, "w", encoding="utf-8") as f: json.dump(existing_logs, f, indent=4)
    return jsonify({"success": True})

@app.route('/api/files/<folder_name>')
def list_files(folder_name):
    folder_path = os.path.join(FINDINGS_DIR, folder_name)
    if not os.path.exists(folder_path): return jsonify({"error": "Folder not found"}), 404
    return jsonify({"folder": folder_name, "files": sorted([f for f in os.listdir(folder_path) if f.endswith(('.txt', '.json'))])})

@app.route('/api/files/create', methods=['POST'])
def create_file():
    data = request.get_json(silent=True) or {}
    folder = data.get('folder'); filename = data.get('filename'); content = data.get('content', '')
    if not folder or not filename: return jsonify({"error": "Missing folder or filename"}), 400
    folder_path = os.path.join(FINDINGS_DIR, folder); path = os.path.join(folder_path, filename)
    if os.path.exists(path): return jsonify({"error": "File already exists"}), 400
    try:
        with open(path, 'w', encoding='utf-8') as f: f.write(content)
        return jsonify({"success": True})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/files/rename', methods=['POST'])
def rename_file():
    data = request.get_json(silent=True) or {}
    folder = data.get('folder'); old_name = data.get('old_name'); new_name = data.get('new_name')
    if not folder or not old_name or not new_name: return jsonify({"error": "Missing parameters"}), 400
    folder_path = os.path.join(FINDINGS_DIR, folder)
    old_path = os.path.join(folder_path, old_name); new_path = os.path.join(folder_path, new_name)
    if not os.path.exists(old_path): return jsonify({"error": "File not found"}), 404
    if os.path.exists(new_path): return jsonify({"error": "Target name already exists"}), 400
    try: os.rename(old_path, new_path); return jsonify({"success": True})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/files/save', methods=['POST'])
def save_file():
    data = request.get_json(silent=True) or {}
    folder = data.get('folder'); filename = data.get('filename'); content = data.get('content')
    if not folder or not filename or content is None: return jsonify({"error": "Missing parameters"}), 400
    folder_path = os.path.join(FINDINGS_DIR, folder); path = os.path.join(folder_path, filename)
    if not os.path.exists(path): return jsonify({"error": "File not found"}), 404
    try:
        with open(path, 'w', encoding='utf-8') as f: f.write(content)
        return jsonify({"success": True})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/files/delete', methods=['POST'])
def delete_file():
    data = request.get_json(silent=True) or {}
    folder = request.args.get('folder') or data.get('folder'); file = request.args.get('file') or data.get('file')
    if not folder or not file: return jsonify({"error": "Invalid request"}), 400
    folder_path = os.path.join(FINDINGS_DIR, folder); base_name = os.path.splitext(file)[0]
    for ext in ['.txt', '.json']:
        path = os.path.join(folder_path, base_name + ext)
        if os.path.exists(path):
            try: os.remove(path)
            except Exception: pass
    return jsonify({"success": True})

@app.route('/api/aggregate', methods=['GET', 'POST'])
def aggregate_files():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        folder = data.get('folder'); agg_type = data.get('type', 'by_pid'); files = data.get('files', [])
    else:
        folder = request.args.get('folder'); agg_type = request.args.get('type', 'by_plugin'); files = []
    if not folder: return jsonify({"error": "Missing folder"}), 400
    folder_path = os.path.join(FINDINGS_DIR, folder)
    if not os.path.exists(folder_path): return jsonify({"error": "Folder not found"}), 404

    if agg_type == 'by_plugin':
        json_files = [f for f in os.listdir(folder_path) if f.endswith('.json') and not f.endswith('_aggregated_by_plugin.json') and not f.endswith('_grouped_by_pid.json') and f != 'error_log.json' and f != 'metadata.json']
        aggregated = {}
        for json_file in json_files:
            plugin_name = os.path.splitext(json_file)[0]
            try:
                with open(os.path.join(folder_path, json_file), 'r', encoding='utf-8') as f: aggregated[plugin_name] = json.load(f)
            except Exception: pass
        output_filename = f"{folder}_aggregated_by_plugin.json"
    elif agg_type == 'by_pid':
        if files: json_files = [f for f in files if f.endswith('.json')]
        else: json_files = [f for f in os.listdir(folder_path) if f.endswith('.json') and not f.endswith('_aggregated_by_plugin.json') and not f.endswith('_grouped_by_pid.json') and f != 'error_log.json' and f != 'metadata.json']
        grouped = defaultdict(dict)
        for json_file in json_files:
            plugin_name = os.path.splitext(json_file)[0]
            try:
                with open(os.path.join(folder_path, json_file), 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for pid, entries in data.items(): grouped[pid][plugin_name] = entries
            except Exception: pass
        aggregated = dict(grouped)
        output_filename = f"{folder}_grouped_by_pid.json"
    else: return jsonify({"error": "Invalid type"}), 400
    
    output_path = os.path.join(folder_path, output_filename)
    with open(output_path, 'w', encoding='utf-8') as f: json.dump(aggregated, f, indent=4, default=str)
    return jsonify({"success": True, "filename": output_filename})

@app.route('/api/scan/start', methods=['POST'])
def start_scan():
    data = request.get_json(silent=True) or {}
    mem_file = data.get('memory_file'); plugin = data.get('plugin'); inv_name = data.get('inv_name', 'UnknownCase'); params = data.get('params', [])
    if not mem_file or not plugin: return jsonify({"error": "Missing parameters"}), 400
    task_id = str(uuid.uuid4())
    cmd = [sys.executable, VOL_PATH, "-f", mem_file, plugin]
    if params: cmd.extend(params)
    cmd_line_str = " ".join(f'"{c}"' if " " in c else c for c in cmd)
    folder_path = os.path.join(FINDINGS_DIR, inv_name); os.makedirs(folder_path, exist_ok=True)
    plugin_safe = re.sub(r'[^a-zA-Z0-9_\-]', '_', plugin)
    txt_path = os.path.join(folder_path, f"{plugin_safe}.txt"); json_path = os.path.join(folder_path, f"{plugin_safe}.json")
    custom_env = os.environ.copy(); custom_env["PYTHONIOENCODING"] = "utf-8"
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=VOLATILITY_PATH, bufsize=1, env=custom_env, errors="ignore")
        manager = TaskManager(task_id, proc, txt_path, json_path, plugin, cmd_line_str)
        active_tasks[task_id] = manager
        return jsonify({"task_id": task_id, "plugin": plugin})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/scan/stream/<task_id>')
def stream_scan(task_id):
    manager = active_tasks.get(task_id)
    if not manager: return jsonify({"error": "Task not found"}), 404
    def generate():
        while True:
            try:
                line = manager.queue.get(timeout=1.0)
                yield f"data: {line}\n\n"
                if line == "[PROCESS_TERMINATED]" or line.startswith("[ERROR]"): break
            except queue.Empty:
                if not manager.is_running and manager.queue.empty(): break
            except GeneratorExit: break
    return Response(generate(), mimetype='text/event-stream')

@app.route('/api/scan/terminate/<task_id>', methods=['POST'])
def terminate_scan(task_id):
    manager = active_tasks.get(task_id)
    if not manager: return jsonify({"status": "ignored"})
    manager.terminate()
    return jsonify({"status": "terminated"})

if __name__ == '__main__':
    Timer(1.5, lambda: webbrowser.open("http://127.0.0.1:5000/")).start()
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)