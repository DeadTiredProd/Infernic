import os
import sys
import time
import threading
import glob
import configparser
import cv2
import socket
import re
from collections import deque
from flask import Flask, render_template, jsonify, request, send_from_directory, Response
from werkzeug.utils import secure_filename
import statistics
import numpy as np
import base64
import io

app = Flask(__name__)

# Paths
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
CONFIG_DIR = os.path.join(BASE_DIR, "config")
CONFIG_PATH = os.path.join(CONFIG_DIR, "Machine.config")
PROFILE_DIR = os.path.join(BASE_DIR, "profiles")
ICON_DIR = os.path.join("static", "uploaded-icons")

os.makedirs(CONFIG_DIR, exist_ok=True)
os.makedirs(PROFILE_DIR, exist_ok=True)
os.makedirs(ICON_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg"}
ESP32_HOST = "192.168.1.181"
ESP32_PORT = 23

# Global state for ESP32 data
current_temp_value = 0
target_temp_value = 0.0
lid_temp_value = 0.0
humid_value = 0.0
state_value = "Idle"
current_step_value = 1
fault_triggered = False
PWM_BUFFER_SIZE = 16
HEATER_MAX_POWER = 400.0
pwm_buffer = deque(maxlen=PWM_BUFFER_SIZE)
current_duty_cycle = 0.0
effective_power = 0.0
pwm_value = 0

selected_profile = None

# Job duration tracking
job_start_time = None
job_durations = []
MAX_DURATIONS = 100

# Initialize tempData with limited size
tempData = {
    'labels': deque(maxlen=1000),
    'datasets': [
        {'label': 'Duty Cycle (%)', 'data': deque(maxlen=1000), 'yAxisID': 'y1'},
        {'label': 'Plate Temperature (°C)', 'data': deque(maxlen=1000), 'yAxisID': 'y'},
        {'label': 'Lid Temperature (°C)', 'data': deque(maxlen=1000), 'yAxisID': 'y'},
        {'label': 'Interior Humidity (%)', 'data': deque(maxlen=1000), 'yAxisID': 'y3'},
        {'label': 'Power (W)', 'data': deque(maxlen=1000), 'yAxisID': 'y2'},
        {'label': 'Target Temperature (°C)', 'data': deque(maxlen=1000), 'yAxisID': 'y'},
        {'label': 'PWM', 'data': deque(maxlen=1000), 'yAxisID': 'y4'}
    ]
}

@app.route("/api/state", methods=["POST"])
def set_state():
    global state_value
    data = request.get_json()
    state_value = str(data.get("state", "")).upper() if data and "state" in data else "ERROR"
    return jsonify({"success": True, "state": state_value})

def send_command_to_esp32(cmd: str) -> tuple[bool, str]:
    try:
        print(f"Connecting to ESP32 at {ESP32_HOST}:{ESP32_PORT}...")
        with socket.create_connection((ESP32_HOST, ESP32_PORT), timeout=5) as s:
            print(f"Sending command: {cmd}")
            s.sendall((cmd + "\n").encode())
            response = s.recv(512).decode(errors="ignore").strip()
            print(f"Received response: {response}")
        return True, response
    except Exception as e:
        print(f"!! Error sending to ESP32: {e}")
        return False, ""

def capture_camera_frame():
    if not camera_config:
        print("[ERROR] Camera not enabled or configured")
        return None
    cap = cv2.VideoCapture(camera_config["device"])
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, camera_config["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, camera_config["height"])
    if not cap.isOpened():
        print(f"[ERROR] Unable to open camera {camera_config['device']}")
        cap.release()
        return None
    success, frame = cap.read()
    cap.release()
    if not success:
        print("[ERROR] Failed to capture frame")
        return None
    return frame

@app.route('/touch')
def touchscreen():
    machine = load_machine_config()
    status = get_machine_status()
    return render_template(
        'touchscreen.html',
        machine=machine,
        current_temp_value=current_temp_value,
        target_temp_value=target_temp_value,
        status=status
    )

@app.route("/api/send-command", methods=["POST"])
def api_send_command():
    global target_temp_value
    data = request.get_json(force=True)
    cmd = data.get("command", "").strip()
    if not cmd:
        return jsonify(error="No command provided"), 400

    previous_target = target_temp_value
    if cmd.lower().startswith("temp="):
        try:
            target_temp_value = float(cmd.split("=",1)[1])
            manage_job_duration(previous_target, target_temp_value)
        except ValueError:
            pass
    elif cmd.upper().startswith("M113"):
        m = re.search(r"[sS]\s*([0-9]+(?:\.[0-9]+)?)", cmd)
        if m:
            try:
                target_temp_value = float(m.group(1))  # Fixed: Corrected syntax error
                manage_job_duration(previous_target, target_temp_value)
            except ValueError:
                pass

    success, response = send_command_to_esp32(cmd)
    if success:
        return jsonify(
            success=True,
            command=cmd,
            response=response,
            target_temp=target_temp_value
        )
    else:
        return jsonify(error="Failed to send command to ESP32"), 500

def load_camera_config():
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_PATH)
    if not cfg.has_section("Camera") or not cfg.getboolean("Camera", "camera_enabled", fallback=False):
        return None
    camera_path = cfg.get("Camera", "camera", fallback="/dev/video0")
    resolution = cfg.get("Camera", "camera_resolution", fallback="640x480")
    width, height = map(int, resolution.lower().split("x"))
    return {
        "device": camera_path,
        "width": width,
        "height": height,
        "crosshair_enabled": cfg.getboolean("Camera", "crosshair_enabled", fallback=False),
        "crosshair_gui_enabled": cfg.getboolean("Camera", "crosshair_gui_enabled", fallback=False),
        "zoom_gui_enabled": cfg.getboolean("Camera", "zoom_gui_enabled", fallback=False),
    }

camera_config = load_camera_config()

def generate_camera_stream(zoom=1.0):
    if not camera_config:
        return
    cap = cv2.VideoCapture(camera_config["device"])
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, camera_config["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, camera_config["height"])
    if not cap.isOpened():
        print(f"[ERROR] Unable to open camera {camera_config['device']}")
        return
    while True:
        success, frame = cap.read()
        if not success:
            break
        if zoom > 1.0:
            h, w = frame.shape[:2]
            new_w, new_h = int(w / zoom), int(h / zoom)
            x1, y1 = (w-new_w)//2, (h-new_h)//2
            frame = frame[y1:y1+new_h, x1:x1+new_w]
            frame = cv2.resize(frame, (w, h))
        if camera_config.get("crosshair_enabled", False):
            h, w = frame.shape[:2]
            color, thickness = (0,255,0), 1
            cv2.line(frame, (0, h//2), (w, h//2), color, thickness)
            cv2.line(frame, (w//2, 0), (w//2, h), color, thickness)
        ret, jpeg = cv2.imencode('.jpg', frame)
        if not ret:
            continue
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
    cap.release()

@app.route("/camera_feed")
def camera_feed():
    if not camera_config:
        return "Camera not enabled or configured", 404
    try:
        zoom = float(request.args.get("zoom", "1.0"))
        zoom = min(max(zoom, 1.0), 4.0)
    except ValueError:
        zoom = 1.0
    return Response(generate_camera_stream(zoom=zoom),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/api/bitmap", methods=["GET"])
def api_bitmap():
    frame = capture_camera_frame()
    if frame is None:
        return jsonify(error="Unable to capture frame"), 500

    # Convert to grayscale and apply inverse binary threshold
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)

    # Find contours
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return jsonify(error="No black object detected"), 404

    # Get largest contour
    largest_contour = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest_contour)

    # Pixel-to-mm conversion
    pixels_per_mm = 10.0  # Adjust based on camera calibration
    width_mm = w / pixels_per_mm
    height_mm = h / pixels_per_mm
    center_x_mm = (x + w / 2) / pixels_per_mm
    center_y_mm = (y + h / 2) / pixels_per_mm

    return jsonify({
        "success": True,
        "center_x_mm": center_x_mm,
        "center_y_mm": center_y_mm,
        "width_mm": width_mm,
        "height_mm": height_mm
    })

@app.route("/api/bitmap-image", methods=["GET"])
def api_bitmap_image():
    frame = capture_camera_frame()
    if frame is None:
        return jsonify(error="Unable to capture image"), 500

    # Convert to grayscale
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Apply inverse binary threshold (black object on white background)
    _, binary = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)

    # Convert binary image to 3-channel for JPEG compatibility (optional)
    binary_3ch = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)

    # Encode as JPEG
    ret, jpeg = cv2.imencode('.jpg', binary_3ch)
    if not ret:
        return jsonify(error="Failed to encode image"), 500

    # Convert to base64
    img_base64 = base64.b64encode(jpeg).decode('utf-8')
    return f"data:image/jpeg;base64,{img_base64}"

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.',1)[1].lower() in ALLOWED_EXTENSIONS

def load_machine_config():
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_PATH)
    return {
        "name": cfg.get("machine", "name", fallback="Unknown"),
        "controller": cfg.get("machine", "controller", fallback="Unknown"),
        "min_temp": cfg.getint("machine", "min_temp", fallback=25),
        "max_temp": cfg.getint("machine", "max_temp", fallback=250),
        "plate_type": cfg.get("Plate", "type", fallback="ptc"),
        "voltage": cfg.getint("Plate", "voltage", fallback=110),
        "duty_cycle": cfg.getint("Plate", "duty", fallback=400),
        "zones": cfg.getint("Plate", "zones", fallback=1),
        "fan_enabled": cfg.getboolean("Plate", "fan_enabled", fallback=True),
    }


def get_machine_status():
    return {
        "current_temp": current_temp_value,
        "duty_cycle": current_duty_cycle * 100,
        "pwm": pwm_value,
        "watts": effective_power,
        "target_temp": target_temp_value,
        "current_step": current_step_value,
        "lid_temp": lid_temp_value,
        "humidity": humid_value,
        "state": state_value
    }

@app.route("/")
def home():
    send_command_to_esp32("M115")
    machine = load_machine_config()
    status = get_machine_status()
    return render_template("index.html", machine=machine, status=status)

@app.route("/api/status", methods=["GET", "HEAD"])
def api_status():
    if request.method == 'HEAD':
        return '', 200
    status = get_machine_status()
    return jsonify(status)

@app.route('/api/ntc_fault', methods=['POST'])
def fault_alert():
    global fault_triggered
    fault_triggered = True
    print("FAULT RECEIVED!")
    return '', 200

@app.route('/api/fault_status', methods=['GET'])
def fault_status():
    return jsonify({'fault': fault_triggered})

@app.route("/api/pwm", methods=["POST"])
def api_pwm():
    global pwm_value, current_duty_cycle, effective_power, pwm_buffer, tempData
    data = request.get_json(force=True)
    pwm_value = data.get("pwm")
    if pwm_value is None:
        return jsonify({"error": "'pwm' key missing"}), 400

    frac = pwm_value / 255.0
    pwm_buffer.append(frac)
    avg_frac = sum(pwm_buffer) / len(pwm_buffer)
    current_duty_cycle = avg_frac
    effective_power = avg_frac * HEATER_MAX_POWER

    tempData['labels'].append(time.strftime("%H:%M:%S"))
    tempData['datasets'][0]['data'].append(current_duty_cycle * 100)
    tempData['datasets'][6]['data'].append(pwm_value)
    tempData['datasets'][4]['data'].append(effective_power)
    return "", 204

@app.route("/api/temperature", methods=["POST"])
def api_temperature():
    global current_temp_value, tempData
    data = request.get_json(force=True)
    temp = data.get("plate_temp")
    try:
        t = float(temp)
    except (TypeError, ValueError):
        return jsonify(error="Invalid temperature"), 400
    current_temp_value = t
    print(f"[API] Received temperature → {t} °C")
    tempData['datasets'][1]['data'].append(t)
    return "", 204

@app.route("/api/current-temperature")
def get_current_temperature():
    return jsonify(current_temp_value)

@app.route("/api/target_temp", methods=["POST"])
def api_get_targ_temp():
    global target_temp_value, tempData
    data = request.get_json(force=True)
    targ_temp = data.get("target_temp")
    try:
        t = float(targ_temp)
    except (TypeError, ValueError):
        return jsonify(error="Invalid Target Temp"), 400
    previous_target = target_temp_value
    target_temp_value = t
    manage_job_duration(previous_target, t)
    print(f"[API] Received target temperature → {t} °C")
    tempData['datasets'][5]['data'].append(t)
    return "", 204

@app.route("/api/lid", methods=["POST"])
def api_lid():
    global lid_temp_value, tempData
    data = request.get_json(force=True)
    lid_temp = data.get("lid_temp")
    try:
        t = float(lid_temp)
    except (TypeError, ValueError):
        return jsonify(error="Invalid lid temperature"), 400
    lid_temp_value = t
    print(f"[API] Received lid temperature → {t} °C")
    tempData['datasets'][2]['data'].append(t)
    return "", 204

@app.route("/api/humidity", methods=["POST"])
def api_humidity():
    global humid_value, tempData
    data = request.get_json(force=True)
    humidity = data.get("humidity")
    try:
        h = float(humidity)
    except (TypeError, ValueError):
        return jsonify(error="Invalid humidity"), 400
    humid_value = h
    print(f"[API] Received humidity → {h} %")
    tempData['datasets'][3]['data'].append(h)
    return "", 204

@app.route("/api/set_temp", methods=["POST"])
def api_set_temp():
    global target_temp_value, current_duty_cycle, effective_power, pwm_buffer, pwm_value, tempData
    data = request.get_json(force=True)
    t = float(data.get("temp", 0))
    previous_target = target_temp_value
    target_temp_value = t
    manage_job_duration(previous_target, t)

    if t == 0.0:
        pwm_buffer.clear()
        current_duty_cycle = 0.0
        effective_power = 0.0
        pwm_value = 0
    tempData['datasets'][5]['data'].append(t)
    success, response = send_command_to_esp32(f"M113 S{t}")
    if success:
        return jsonify(success=True, target_temp=t)
    else:
        return jsonify(error="Failed to set target temperature"), 500

@app.route("/api/restart-firmware", methods=["POST"])
def api_restart_firmware():
    global target_temp_value, current_duty_cycle, effective_power, pwm_buffer, tempData
    print("[API] Restart Hellfire Firmware — clearing target temp and PWM")
    previous_target = target_temp_value
    target_temp_value = 0.0
    manage_job_duration(previous_target, target_temp_value)
    current_duty_cycle = 0
    effective_power = 0.0
    pwm_buffer.clear()
    tempData['datasets'][5]['data'].append(0.0)
    send_command_to_esp32("G004")
    return jsonify(success=True, target_temp=target_temp_value)

@app.route("/api/restart-host", methods=["POST"])
def api_restart_host():
    
    global target_temp_value
    previous_target = target_temp_value
    target_temp_value = 0.0
    manage_job_duration(previous_target, target_temp_value)
    def _restart():
        time.sleep(1)
        os.execv(sys.executable, [sys.executable] + sys.argv)
    threading.Thread(target=_restart, daemon=True).start()
    return jsonify(success=True)

@app.route("/api/config-files", methods=["GET"])
def api_config_files():
    files = sorted([
        fname for fname in os.listdir(CONFIG_DIR)
        if os.path.isfile(os.path.join(CONFIG_DIR, fname))
    ])
    return jsonify(files=files)

@app.route("/api/config-file", methods=["GET"])
def api_get_config_file():
    name = request.args.get("name", "")
    path = os.path.join(CONFIG_DIR, name)
    if not os.path.isfile(path):
        return jsonify(error="Not found"), 404
    with open(path, "r") as f:
        content = f.read()
    return jsonify(name=name, content=content)

@app.route("/api/config-file", methods=["POST"])
def api_save_config_file():
    name = request.args.get("name", "")
    content = request.get_json(force=True).get("content", "")
    path = os.path.join(CONFIG_DIR, name)
    with open(path, "w") as f:
        f.write(content)
    return jsonify(success=True)

@app.route("/api/config-file", methods=["DELETE"])
def api_delete_config_file():
    name = request.args.get("name", "")
    path = os.path.join(CONFIG_DIR, name)
    if os.path.isfile(path):
        os.remove(path)
        return jsonify(success=True)
    return jsonify(error="Not found"), 404

@app.route("/api/config-file/download", methods=["GET"])
def api_download_config_file():
    name = request.args.get("name", "")
    if not os.path.isfile(os.path.join(CONFIG_DIR, name)):
        return jsonify(error="Not found"), 404
    return send_from_directory(CONFIG_DIR, name, as_attachment=True)

@app.route("/api/solder-profiles", methods=["GET"])
def api_list_profiles():
    files = sorted(glob.glob(os.path.join(PROFILE_DIR, "*.ini")))
    names = [os.path.splitext(os.path.basename(f))[0] for f in files]
    return jsonify(profiles=names)

@app.route("/api/solder-profile", methods=["GET"])
def api_get_profile():
    name = request.args.get("name", "")
    path = os.path.join(PROFILE_DIR, f"{name}.ini")
    if not os.path.isfile(path):
        return jsonify(error="Not found"), 404
    cfg = configparser.ConfigParser()
    cfg.read(path)
    if "profile" not in cfg or "name" not in cfg:
        return jsonify(error="Malformed profile file"), 400
    profile = {
        "name": cfg.get("name", "name", fallback=name),
        "molten_temp": cfg.getint("profile", "molten_temp", fallback=0),
        "solid_temp": cfg.getint("profile", "solid_temp", fallback=0),
        "composition": cfg.get("profile", "composition", fallback="0%,0%"),
        "peak_temp": cfg.getint("profile", "peak_temp", fallback=0),
        "preheat_time": cfg.getint("profile", "preheat_time", fallback=0),
        "soak_time": cfg.getint("profile", "soak_time", fallback=0),
        "reflow_time": cfg.getint("profile", "reflow_time", fallback=0),
        "cool_time": cfg.getint("profile", "cool_time", fallback=0),
        "icon_url": cfg.get("profile", "icon_url", fallback="")
    }
    return jsonify(profile)

@app.route("/api/solder-profile", methods=["POST"])
def api_save_profile():
    payload = request.get_json(force=True)
    name = payload.get("name", "").strip()
    if not name:
        return jsonify(error="Name is required"), 400
    path = os.path.join(PROFILE_DIR, f"{name}.ini")
    cfg = configparser.ConfigParser()
    cfg["name"] = {"name": name}
    cfg["profile"] = {
        "molten_temp": str(payload.get("molten_temp", 0)),
        "solid_temp": str(payload.get("solid_temp", 0)),
        "composition": payload.get("composition") or "0%,0%",
        "peak_temp": str(payload.get("peak_temp", 0)),
        "preheat_time": str(payload.get("preheat_time", 0)),
        "soak_time": str(payload.get("soak_time", 0)),
        "reflow_time": str(payload.get("reflow_time", 0)),
        "cool_time": str(payload.get("cool_time", 0)),
        "icon_url": payload.get("icon_url", "")
    }
    with open(path, "w") as f:
        cfg.write(f)
    return jsonify(success=True)

@app.route("/api/solder-profile", methods=["DELETE"])
def api_delete_profile():
    name = request.args.get("name", "")
    path = os.path.join(PROFILE_DIR, f"{name}.ini")
    if os.path.isfile(path):
        os.remove(path)
        return jsonify(success=True)
    return jsonify(error="Not found"), 404

@app.route("/api/upload-icon", methods=["POST"])
def api_upload_icon():
    if 'icon' not in request.files:
        return jsonify(error="No file uploaded"), 400
    file = request.files['icon']
    if file.filename == '':
        return jsonify(error="Empty filename"), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename) # type: ignore
        filepath = os.path.join(ICON_DIR, filename)
        counter = 1
        base, ext = os.path.splitext(filename)
        while os.path.exists(filepath):
            filename = f"{base}_{counter}{ext}"
            filepath = os.path.join(ICON_DIR, filename)
            counter += 1
        file.save(filepath)
        url = f"/static/uploaded-icons/{filename}"
        return jsonify(url=url)
    return jsonify(error="Invalid file type"), 400

@app.route('/stats')
def stats():
    plate_temp_data = tempData['datasets'][1]['data']
    lid_temp_data = tempData['datasets'][2]['data']
    target_temp_data = tempData['datasets'][5]['data']
    pwm_data = tempData['datasets'][6]['data']

    stats = {
        'max_plate_temp': max(plate_temp_data) if plate_temp_data else 0,
        'max_lid_temp': max(lid_temp_data) if lid_temp_data else 0,
        'avg_pwm': statistics.mean(pwm_data) if pwm_data else 0,
        'total_jobs': len(job_durations),
        'most_used_target_temp': statistics.mode(target_temp_data) if target_temp_data else 0,
        'longest_job_duration': max(job_durations) if job_durations else 0,
        'highest_temp': max(max(plate_temp_data, default=0), max(lid_temp_data, default=0))
    }
    return render_template('stats.html', stats=stats)

@app.route('/api/stats')
def api_stats():
    plate_temp_data = tempData['datasets'][1]['data']
    lid_temp_data = tempData['datasets'][2]['data']
    target_temp_data = tempData['datasets'][5]['data']
    pwm_data = tempData['datasets'][6]['data']

    stats = {
        'maxPlateTemp': max(plate_temp_data) if plate_temp_data else 0,
        'maxLidTemp': max(lid_temp_data) if lid_temp_data else 0,
        'avgPwm': statistics.mean(pwm_data) if pwm_data else 0,
        'totalJobs': len(job_durations),
        'mostUsedTargetTemp': statistics.mode(target_temp_data) if target_temp_data else 0,
        'longestJobDuration': max(job_durations) if job_durations else 0,
        'highestTemp': max(max(plate_temp_data, default=0), max(lid_temp_data, default=0))
    }
    return jsonify(stats)

def manage_job_duration(previous_target, new_target):
    global job_start_time, job_durations
    if previous_target == 0 and new_target > 0 and job_start_time is None:
        job_start_time = time.time()
        print(f"[API] Job started at {time.strftime('%H:%M:%S')}")
    elif previous_target > 0 and new_target == 0 and job_start_time is not None:
        duration = time.time() - job_start_time
        job_durations.append(duration)
        if len(job_durations) > MAX_DURATIONS:
            job_durations.pop(0)
        print(f"[API] Job ended, duration: {duration:.1f}s")
        job_start_time = None

with app.app_context():
    try:
        success, resp = send_command_to_esp32("M113 S0")
    except Exception:
        pass

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
