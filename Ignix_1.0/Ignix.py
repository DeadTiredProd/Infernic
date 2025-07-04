import os
import subprocess
import socket
import json
import time
from pathlib import Path
import uvicorn
from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse, RedirectResponse

app = FastAPI()
ignix_port = 5002  # Ignix on 5002
infernic_port = 5001  # Infernic on 5001
infernic_process = None
home = Path("/home/Hellfire")
base_dir = home / "Shared"
script_dir = Path(__file__).parent
config_file = script_dir / "config.json"
setup_flag = script_dir / "setup_complete"

def get_local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "localhost"

def is_port_free(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("0.0.0.0", port))
            return True
    except OSError:
        return False

def is_infernic_running():
    global infernic_process
    if infernic_process and infernic_process.poll() is None:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                return sock.connect_ex(("localhost", infernic_port)) == 0
        except Exception as e:
            print(f"Error checking Infernic socket: {e}")
            return False
    return False

def find_infernic_path():
    print(f"Searching for Infernic.py in {base_dir}...")
    patterns = ["Infernic-*", "Infernic_*"]
    for pattern in patterns:
        infernic_dirs = sorted(
            [d for d in base_dir.glob(pattern) if d.is_dir()],
            key=lambda x: x.name,
            reverse=True
        )
        for d in infernic_dirs:
            print(f"Checking directory: {d}")
            host_dirs = [h for h in d.glob("*_Host") if h.is_dir() and (h / "Infernic.py").exists()]
            if host_dirs:
                print(f"Found Infernic.py in {host_dirs[0] / 'Infernic.py'}")
                return str(host_dirs[0] / "Infernic.py")
    for root, _, files in os.walk(base_dir):
        if "Infernic.py" in files:
            print(f"Found Infernic.py in {Path(root) / 'Infernic.py'}")
            return str(Path(root) / "Infernic.py")
    print(f"No Infernic.py found in {base_dir}")
    return None

def launch_infernic():
    global infernic_process
    if not is_infernic_running():
        if not is_port_free(infernic_port):
            print(f"Port {infernic_port} is in use. Killing processes...")
            try:
                subprocess.run(["sudo", "fuser", "-k", f"{infernic_port}/tcp"], check=True)
                time.sleep(1)
            except subprocess.CalledProcessError as e:
                return False, f"Failed to free port {infernic_port}: {e}"
        
        print(f"Starting Infernic at {infernic_path}")
        if not os.path.exists(infernic_path):
            return False, f"File not found: {infernic_path}"
        if not os.access(infernic_path, os.R_OK):
            return False, f"Permission denied: Cannot read {infernic_path}"
        if not os.access(infernic_path, os.X_OK):
            print(f"Warning: {infernic_path} is not executable. Attempting to run anyway.")
        
        try:
            infernic_process = subprocess.Popen(
                ["python3", infernic_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                preexec_fn=os.setpgrp
            )
            time.sleep(1)
            if infernic_process.poll() is not None:
                stdout, stderr = infernic_process.communicate()
                error = stderr or "Infernic exited immediately with no error output"
                print(f"Failed to start Infernic: {error}")
                return False, error
            print(f"Started Infernic process (PID: {infernic_process.pid})")
            return True, None
        except FileNotFoundError:
            error = "Python3 not found or Infernic.py is invalid"
            print(f"Failed to start Infernic: {error}")
            return False, error
        except PermissionError as e:
            error = f"Permission error: {e}"
            print(f"Failed to start Infernic: {error}")
            return False, error
        except Exception as e:
            error = f"Unexpected error: {e}"
            print(f"Failed to start Infernic: {error}")
            return False, error
    else:
        print("Infernic is already running")
        return True, None
    return False, "Unknown error"

def perform_first_time_setup():
    print("Performing first-time Ignix setup...")
    script_dir.mkdir(parents=True, exist_ok=True)

    infernic_path = find_infernic_path() or str(base_dir / "Infernic-1.4x" / "Infernic_1.4x_Host" / "Infernic.py")
    config = {"infernic_path": infernic_path}

    with open(config_file, "w") as f:
        json.dump(config, f, indent=4)
    print(f"Created config file: {config_file} with infernic_path: {infernic_path}")

    service_content = f"""[Unit]
Description=Ignix Startup Interface
After=network.target

[Service]
ExecStart=/usr/bin/python3 {__file__}
WorkingDirectory={script_dir}
Restart=always
User=Hellfire

[Install]
WantedBy=multi-user.target
"""

    service_path = "/etc/systemd/system/ignix.service"
    if not os.path.exists(service_path):
        try:
            with open("/tmp/ignix.service", "w") as f:
                f.write(service_content)
            subprocess.run(["sudo", "mv", "/tmp/ignix.service", service_path], check=True)
            subprocess.run(["sudo", "systemctl", "enable", "ignix"], check=True)
            print("Ignix systemd service installed.")
        except subprocess.CalledProcessError as e:
            print(f"Could not install Ignix systemd service: {e}")
        except Exception as e:
            print(f"Unexpected error during Ignix service setup: {e}")

    setup_flag.touch()
    print("Ignix setup complete.")

if not setup_flag.exists():
    perform_first_time_setup()

try:
    with open(config_file) as f:
        config = json.load(f)
except FileNotFoundError:
    print(f"Config file {config_file} not found. Please run setup again.")
    raise

infernic_path = config.get("infernic_path", str(base_dir / "Infernic-1.4x" / "Infernic_1.4x_Host" / "Infernic.py"))
if not Path(infernic_path).exists():
    print(f"Stored infernic path {infernic_path} is invalid. Searching for new path...")
    infernic_path = find_infernic_path()
    if infernic_path:
        config["infernic_path"] = infernic_path
        with open(config_file, "w") as f:
            json.dump(config, f, indent=4)
        print(f"Updated config with new infernic path: {infernic_path}")
    else:
        print(f"Could not find Infernic.py in {base_dir}. Using default path.")
        infernic_path = str(base_dir / "Infernic-1.4x" / "Infernic_1.4x_Host" / "Infernic.py")
        config["infernic_path"] = infernic_path
        with open(config_file, "w") as f:
            json.dump(config, f, indent=4)
        print(f"Falling back to default path: {infernic_path}")

@app.get("/", response_class=HTMLResponse)
async def root():
    local_ip = get_local_ip()
    status = "running" if is_infernic_running() else "not running"
    button_label = "Restart Host Firmware" if is_infernic_running() else "Start Host Firmware"
    return HTMLResponse(f"""
        <h2>Ignix UI</h2>
        <p>Infernic status: {status}</p>
        <form action="/start" method="post">
            <button type="submit">{button_label}</button>
        </form>
        <p>Infernic expected at: http://{local_ip}:{infernic_port}</p>
    """)

@app.post("/start", response_class=HTMLResponse)
async def start_infernic_route():
    global infernic_process
    if is_infernic_running() and infernic_process:
        try:
            infernic_process.terminate()
            infernic_process.wait(timeout=5)
            print("Infernic stopped for restart.")
        except subprocess.TimeoutExpired:
            infernic_process.kill()
            print("Infernic forcefully stopped for restart.")
        infernic_process = None

    success, error = launch_infernic()
    if not success:
        return HTMLResponse(f"<h2>Error</h2><p>Failed to start Infernic: {error}</p>", status_code=500)

    for _ in range(20):
        try:
            with socket.create_connection(("localhost", infernic_port), timeout=1):
                break
        except OSError:
            time.sleep(0.5)
    else:
        return HTMLResponse("<h2>Error</h2><p>Infernic didn't start in time.</p>", status_code=500)

    local_ip = get_local_ip()
    return RedirectResponse(url=f"http://{local_ip}:{infernic_port}", status_code=302)

if __name__ == "__main__":
    local_ip = get_local_ip()
    print(f"Starting Ignix server at http://{local_ip}:{ignix_port}")
    print(f"Infernic expected at http://{local_ip}:{infernic_port}")
    print(f"Visit http://{local_ip}:{ignix_port} to start Infernic manually.")
    uvicorn.run(app, host="0.0.0.0", port=ignix_port)
