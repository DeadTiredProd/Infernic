// shorthand for show/hide
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');
let m115Sent = false;  // Add this near the top, before any functions use it

// Global chart variable (assumed to be initialized later)
let tempChart;

// Chart data configuration for temperature, power, and related metrics
const tempData = {
  labels: [], // Timestamps for x-axis
  datasets: [
    {
      label: 'Duty Cycle (%)',
      data: [],
      yAxisID: 'y1',
      borderColor: 'rgba(100, 181, 246, 0.6)', // Soft blue
      borderWidth: 1.5, // Thinner lines
      tension: 0.4, // Smooth curves via linear interpolation
      fill: false,
      hidden: true,
      pointRadius: 0 // No points for clean lines
    },
    {
      label: 'Plate Temperature (°C)',
      data: [],
      yAxisID: 'y',
      borderColor: 'rgba(255, 10, 30, 0.6)', // Soft red
      borderWidth: 1.5,
      tension: 0.4,
      fill: false,
      hidden: false,
      pointRadius: 1
    },
    {
      label: 'Lid Temperature (°C)',
      data: [],
      yAxisID: 'y',
      borderColor: 'rgba(255, 159, 64, 0.6)', // Soft orange
      borderWidth: 1.5,
      tension: 0.4,
      fill: false,
      hidden: true,
      pointRadius: 0
    },
    {
      label: 'Interior Humidity (%)',
      data: [],
      yAxisID: 'y3',
      borderColor: 'rgba(0, 102, 255, 0.6)', // Soft purple
      borderWidth: 1.5,
      tension: 0.4,
      fill: false,
      hidden: true,
      pointRadius: 0
    },
    {
      label: 'Power (W)',
      data: [],
      yAxisID: 'y2',
      borderColor: 'rgba(0, 205, 0, 0.6)', // Soft yellow
      borderWidth: 3,
      tension: 0.4,
      borderDash: [4, 4], // Dashed line for PWM
      fill: false,
      hidden: false,
      pointRadius: 1
    },
    {
      label: 'Target Temperature (°C)',
      data: [],
      yAxisID: 'y',
      borderColor: 'rgba(75, 192, 192, 0.6)', // Soft cyan
      borderWidth: 1.5,
      tension: 0.4,
      fill: false,
      hidden: false,
      pointRadius: 0
    },
    {
      label: 'PWM',
      data: [],
      yAxisID: 'y4',
      borderColor: 'rgba(201, 203, 207, 0.6)', // Soft gray
      borderWidth: 2,
      tension: 0.4,
      fill: false,
      hidden: false,
      pointRadius: 1
    }
  ]
};

// ── Loader & Status Polling ──
async function initialize() {
  const overlay = document.getElementById('loader-overlay');
  const mainUi = document.getElementById('main-ui');
  const progressBar = document.getElementById('loader-progress');
  const loaderText = document.getElementById('loader-text');

  loaderText.textContent = `Connecting to ${window.location.host}…`;

  try {
    await fetch('/api/status', { method: 'HEAD', cache: 'no-cache' });
  } catch {
    loaderText.textContent = 'Connection failed. Retrying…';
    return setTimeout(initialize, 5000);
  }

  loaderText.textContent = 'Initializing interface…';
  logToConsole('Connected to Infernic API');
  progressBar.style.width = '50%';
  await fetch('/api/status'); // full fetch now
  progressBar.style.width = '100%';

  setTimeout(() => {
    overlay.classList.add('hidden');
    mainUi.classList.remove('hidden');
    startStatusPolling();

    // Attach temp-input keypress listener
    const tempInput = document.getElementById('temp-input');

    if (!tempInput) {
      console.error('Temperature input with id "temp-input" not found');
      return;
    }
    console.log('Attaching keypress listener to temp-input');
    tempInput.addEventListener('keypress', e => {
      console.log('Key pressed in temp-input:', e.key);
      if (e.key === 'Enter') {
        console.log('Enter key detected, calling setTemp()');
        setTemp();
      }
    });

    sendCommand('T001 F300  D100 C1 B0 R0 ') //Send Interface Connection Tone
    sendCommand('T001 F400  D100 C1 B0 R0 ') //Send Interface Connection Tone 1

  }, 300);
}


// Reusable function to send commands to the API
async function sendCommand(command) {
  try {
    const response = await fetch('/api/send-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error sending command:', error);
    throw error;
  }
}


function startStatusPolling() {
  fetchStatus();
  setInterval(fetchStatus, 1000);
}

// Ring buffer for averaging Power (W)
let pwmBuffer = [];

const pwmWindowSize = 16; // Number of samples to average (~1.6s if fetch is every 100ms)

// Store the last valid (non-zero, non-drastic) values for lid_temp and humidity
let lastValidLidTemp = null;
let lastValidHumidity = null;

// Define acceptable change thresholds
const LID_TEMP_MAX_DELTA = 20; // Max allowed change in °C
const HUMIDITY_MAX_DELTA = 20; // Max allowed change in %

// Valid statuses
const validStatuses = [
  "IDLE", "HEATING", "COOLING", "STABLE",
  "HOMING", "HOMED", "COOLED", "HEATED",
  "POSITION UNKNOWN", "MOVING"
];

async function setMachineState(newState) {
  try {
    const response = await fetch("/api/set_state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: newState })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log("Server response:", JSON.stringify(data, null, 2)); // Debug response

    if (data.success) {
      setMachineStatus(data.state); // Update UI
      console.log(`State set to ${data.state}`);
      logToConsole(`State set to ${data.state}`);

      // Check for STABLE state (case-insensitive)
      if (data.state && data.state.toUpperCase() === "STABLE") {
        console.log("Temperature is stable, triggering tone command");
        try {
          const toneResult = await sendCommand('T001 F713 D100 C1 B0 R0')
          if (toneResult.success) {
            console.log("Tone command sent successfully");
            logToConsole("Tone command sent successfully");
          } else {
            console.error("Failed to send tone command:", toneResult.error || "Unknown error");
            logToConsole(`Error: Failed to send tone command - ${toneResult.error || "Unknown error"}`);
          }
        } catch (toneError) {
          console.error("Error sending tone command:", toneError);
          logToConsole(`Error sending tone command: ${toneError}`);
        }
      }
    } else {
      console.error("Failed to set state:", data.error || "Unknown error");
      logToConsole(`Error: Failed to set state - ${data.error || "Unknown error"}`);
      setMachineStatus("ERROR");
    }
  } catch (err) {
    console.error("Error setting state:", err);
    logToConsole(`Error setting state: ${err}`);
    setMachineStatus("ERROR");
  }
}

// Optional: Log to console-output (if you want to keep this)
function logToConsole(message) {
  const consoleOutput = document.getElementById("console-output");
  if (consoleOutput) {
      consoleOutput.textContent += `${new Date().toLocaleTimeString()}: ${message}\n`;
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }
}


// Define previousState globally (add this near the top of your code, e.g., after pwmBuffer)
let previousState = null;

async function fetchStatus() {
  fetch('/api/status')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      const ts = new Date().toLocaleTimeString();

      // Extract data
      let duty = Number(data.duty_cycle); // 0–100%
      let pwm = Number(data.pwm); // 0–255
      let watts = Number(data.watts); // Power (W)
      const currentTemp = Number(data.current_temp); // Plate Temp (°C)
      const targetTemp = Number(data.target_temp); // Target Temp (°C)
      let lidTemp = Number(data.lid_temp); // Lid Temp (°C)
      let humidity = Number(data.humidity); // Humidity (%)
      const currentStep = Number(data.current_step); // Current Step
      const state = data.state || 'Unknown'; // State

      // If targetTemp is 0, force duty, watts, and pwm to 0
      if (targetTemp === 0) {
        duty = 0;
        watts = 0;
        pwm = 0;
      }

      // Trigger tone sequence on state transition to STABLE or HEATING
      if (state && state.toUpperCase() === 'STABLE' && previousState !== 'STABLE') {
        console.log('State transitioned to STABLE, triggering tone sequence');
        const toneSequence = [
          'T001 F300 D150 C1 B50 R0',
          'T001 F300 D150 C1 B50 R0'
        ];
        let delay = 0;
        for (const command of toneSequence) {
          setTimeout(async () => {
            try {
              const toneResult = await sendCommand(command);
              if (toneResult.success) {
                console.log(`Tone command ${command} sent successfully`);
              } else {
                console.error(`Failed to send tone command ${command}:`, toneResult.error || 'Unknown error');
                logToConsole(`Error: Failed to send tone command ${command} - ${toneResult.error || 'Unknown error'}`);
              }
            } catch (toneError) {
              console.error(`Error sending tone command ${command}:`, toneError);
              logToConsole(`Error sending tone command ${command}: ${toneError}`);
            }
          }, delay);
          delay += 100; // Adjust delay to account for tone duration (150 or 200 ms) + 50 ms gap
        }
      } else if (state && state.toUpperCase() === 'HEATING' && previousState !== 'HEATING') {
        console.log('State transitioned to HEATING, triggering tone sequence');
        const toneSequence = [
          'T001 F300 D50 C1 B50 R0',
          'T001 F300 D50 C1 B50 R0',
          'T001 F300 D50 C1 B50 R0',
        ];
        let delay = 0;
        for (const command of toneSequence) {
          setTimeout(async () => {
            try {
              const toneResult = await sendCommand(command);
              if (toneResult.success) {
                console.log(`Tone command ${command} sent successfully`);
              } else {
                console.error(`Failed to send tone command ${command}:`, toneResult.error || 'Unknown error');
              }
            } catch (toneError) {
              console.error(`Error sending tone command ${command}:`, toneError);
              logToConsole(`Error sending tone command ${command}: ${toneError}`);
            }
          }, delay);
          delay += 200; // Adjust delay to account for tone duration (150 or 200 ms) + 50 ms gap
        }
      } else if (state && state.toUpperCase() === 'IDLE' && previousState !== 'IDLE') {
        console.log('State transitioned to IDLE, triggering tone sequence');
        const toneSequence = [
          'T001 F400 D100 C1 B50 R0',
          'T001 F300 D75 C1 B50 R0',
          'T001 F200 D50 C1 B50 R0'
        ];
        let delay = 0;
        for (const command of toneSequence) {
          setTimeout(async () => {
            try {
              const toneResult = await sendCommand(command);
              if (toneResult.success) {
                console.log(`Tone command ${command} sent successfully`);
              } else {
                console.error(`Failed to send tone command ${command}:`, toneResult.error || 'Unknown error');
              }
            } catch (toneError) {
              console.error(`Error sending tone command ${command}:`, toneError);
              logToConsole(`Error sending tone command ${command}: ${toneError}`);
            }
          }, delay);
          delay += 200; // Adjust delay to account for tone duration (150 or 200 ms) + 50 ms gap
        }
      }
      previousState = state; // Update previousState after checking

      // Filter noise for lid temperature
      if (lastValidLidTemp === null || Math.abs(lidTemp - lastValidLidTemp) <= LID_TEMP_MAX_DELTA) {
        lastValidLidTemp = lidTemp;
      } else {
        console.warn(`[fetchStatus] Lid temp outlier detected: ${lidTemp}, using last valid: ${lastValidLidTemp}`);
        lidTemp = lastValidLidTemp !== null ? lastValidLidTemp : 0;
      }

      // Filter noise for humidity
      if (lastValidHumidity === null || Math.abs(humidity - lastValidHumidity) <= HUMIDITY_MAX_DELTA) {
        lastValidHumidity = humidity;
      } else {
        console.warn(`[fetchStatus] Humidity outlier detected: ${humidity}, using last valid: ${lastValidHumidity}`);
        humidity = lastValidHumidity !== null ? lastValidHumidity : 0;
      }

      // Log API response
      console.log(`[fetchStatus] API: duty_cycle=${duty}, pwm=${pwm}, watts=${watts}, current_temp=${currentTemp}, target_temp=${targetTemp}, lid_temp=${lidTemp}, humidity=${humidity}, current_step=${currentStep}, state=${state}`);

      // Update UI
      const elements = {
        machineStatus: document.getElementById('machine-status'),
        currentTemp: document.getElementById('current-temp'),
        targetSpan: document.getElementById('target-temp'),
        secondTarget: document.getElementById('target-temp-2'),
        secondTemp: document.getElementById('current-temp-2'),
        currentStep: document.getElementById('current-step'),
        powerLevel: document.getElementById('power-level'),
        pwmValue: document.getElementById('pwm-value'),
        lidTemp: document.getElementById('lid-temp'),
        interiorHumid: document.getElementById('interior-humid')
      };

      if (elements.machineStatus) elements.machineStatus.textContent = state;
      if (elements.currentTemp) elements.currentTemp.textContent = currentTemp.toFixed(1) + ' °C';
      if (elements.targetSpan) elements.targetSpan.textContent = targetTemp.toFixed(1) + ' °C';
      if (elements.secondTarget) elements.secondTarget.textContent = targetTemp.toFixed(1) + ' °C';
      if (elements.secondTemp) elements.secondTemp.textContent = currentTemp.toFixed(1) + ' °C';
      if (elements.currentStep) elements.currentStep.textContent = currentStep;
      if (elements.powerLevel) elements.powerLevel.textContent = duty.toFixed(0) + ' %';
      if (elements.pwmValue) elements.pwmValue.textContent = pwm.toFixed(0); // Raw PWM (0–255)
      if (elements.lidTemp) elements.lidTemp.textContent = lidTemp.toFixed(1) + ' °C';
      if (elements.interiorHumid) elements.interiorHumid.textContent = humidity.toFixed(1) + ' %';

      // Log chart data
      console.log(`[fetchStatus] Chart: DutyCycle=${duty}, PWM=${pwm}, Watts=${watts}, PlateTemp=${currentTemp}, LidTemp=${lidTemp}, Humidity=${humidity}, TargetTemp=${targetTemp}`);

      // Update chart
      if (tempData.labels.length > 25) {
        tempData.labels.shift();
        tempData.datasets.forEach(dataset => dataset.data.shift());
      }
      tempData.labels.push(ts);
      tempData.datasets[0].data.push(duty); // Duty Cycle % (0–100)
      tempData.datasets[1].data.push(currentTemp); // Plate Temp (°C)
      tempData.datasets[2].data.push(lidTemp); // Lid Temp (°C)
      tempData.datasets[3].data.push(humidity); // Humidity (%)
      tempData.datasets[4].data.push(watts); // Power (W)
      tempData.datasets[5].data.push(targetTemp); // Target Temp (°C)
      tempData.datasets[6].data.push(pwm); // Raw PWM (0–255)
      console.log(pwm);

      // Log dataset lengths
      console.log(`[fetchStatus] Datasets:`, tempData.datasets.map(d => `${d.label}: ${d.data.length}`));

      // Force chart update
      if (tempChart) {
        tempChart.data = tempData;
        tempChart.update();
        console.log('[fetchStatus] Chart updated');
      } else {
        console.error('[fetchStatus] tempChart not initialized');
      }

      // Clear fault overlay on successful fetch
      hideFaultOverlay();
    })
    .catch(err => {
      console.error('[fetchStatus] Failed to fetch:', err);
      showFaultOverlay('Failed to fetch status. Retrying...');
    });
}

function showFaultOverlay(message = 'A fault has occurred') {
  document.getElementById('main-ui').classList.add('hidden');
  document.getElementById('fault-overlay').classList.remove('hidden');
  document.getElementById('fault-reason').textContent = message;
}


// if you ever want to clear fault and return to normal
function hideFaultOverlay() {
  document.getElementById('fault-overlay').classList.add('hidden');
  document.getElementById('main-ui').classList.remove('hidden');
}

async function pollFault() {
  try {
    const res = await fetch('/api/fault_status');
    const js = await res.json();
    if (js.fault) {
      showFaultOverlay('Thermistor Fault Detected!  Took too long between readings. indicates a loose connection or dying thermistor.');
      return;           // stop polling once is shown
    }
  } catch(e) {
    console.error('fault poll error', e);
  }
  setTimeout(pollFault, 500);  // poll again in 1sec
}

// start polling as soon as the UI is up
window.addEventListener('load', () => {
  pollFault();
});




// ── Commands ──
function setTemp() {
  const val = document.getElementById('temp-input').value.trim();
  if (!val) return;

  const temp = parseFloat(val);
  if (isNaN(temp) || temp < 0 || temp > 300) {
    console.error('Invalid temperature: must be between 0°C and 300°C');
    logToConsole('Error: Invalid temperature: must be between 0°C and 300°C');
    document.getElementById('temp-input').value = '';
    return;
  }

  const command = `M113 S${temp.toFixed(2)}`;

  fetch('/api/send-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: command })
  })
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        console.log(`Temperature set to ${temp.toFixed(2)} C`);
        // Update the target temp display immediately
        const targetTempSpan = document.getElementById('target-temp-2');
        targetTempSpan.textContent = `${temp.toFixed(2)} C`;
        logToConsole(`Temperature set to ${temp.toFixed(2)} C`);
      } else {
        console.error('Failed to set temperature:', data);
        logToConsole(`Error: Failed to set temperature - ${data.error || 'Unknown error'}`);
      }
    })
    .catch(err => {
      console.error('Error sending temperature command:', err);
      logToConsole(`Error setting temperature: ${err}`);
    });

  document.getElementById('temp-input').value = '';
}



function restartFirmware() {

  logToConsole('Restarting firmware…');
  // After the delay, send the restart command
  fetch('/api/restart-firmware', { method: 'POST' });
}

function restartHost() {
  const overlay     = document.getElementById('loader-overlay');
  const mainUi      = document.getElementById('main-ui');
  const loaderText  = document.getElementById('loader-text');
  const progressBar = document.getElementById('loader-progress');

  overlay.style.display         = 'flex';
  hide(mainUi);
  loaderText.textContent        = 'Restarting host…';
  progressBar.style.animation   = 'pulse 2s infinite';
  progressBar.style.width       = '0%';
  logToConsole('Restarting host… This may take a few seconds.');

  fetch('/api/restart-host', { method: 'POST' })
    .then(() => setTimeout(() => window.location.reload(), 1500));
}

// ── Machine Tab & Editor ──
function openMachineTab() {
  closeAllTabs();
  show(document.getElementById('tab-content'));
  loadConfigList();
}

async function loadConfigList() {
  const res = await fetch('/api/config-files');
  const { files } = await res.json();
  const ul = document.getElementById('config-file-list');
  ul.innerHTML = '';
  files.forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    li.ondblclick = () => openEditor(name);
    ul.appendChild(li);
  });
}

async function openEditor(name) {
  const res = await fetch(`/api/config-file?name=${encodeURIComponent(name)}`);
  const data = await res.json();
  document.getElementById('editor-filename').textContent = data.name;
  document.getElementById('editor-text').value         = data.content;
  show(document.getElementById('editor-overlay'));
}

function closeEditor() {
  hide(document.getElementById('editor-overlay'));
}

async function saveFile() {
  const name    = document.getElementById('editor-filename').textContent;
  const content = document.getElementById('editor-text').value;
  await fetch(`/api/config-file?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  logToConsole(`File ${name} saved successfully.`);
  closeEditor();
  loadConfigList();
  logToConsole("Reloading config list after save… and restarting firmware and host");
  restartFirmware();
  restartHost();
}

// Command queue for macros
let commandQueue = [];

// Open macro editor overlay
function AddMacro() {
  console.log('Opening macro editor overlay');
  const macroEditorOverlay = document.getElementById('macro-editor-overlay');
  if (!macroEditorOverlay) {
    console.error('Macro editor overlay not found');
    return;
  }
  closeAllTabs();
  show(macroEditorOverlay);
  const macroInput = document.getElementById('macro-input');
  if (macroInput) {
    macroInput.value = '';
    macroInput.focus();
  } else {
    console.error('Macro input element not found');
  }
}

function closeAllTabs() {
  const tabs = [
    document.getElementById('tab-content'),
    document.getElementById('profiles-content'),
    document.getElementById('axis-content'),
    document.getElementById('editor-overlay'),
    document.getElementById('profile-editor-overlay'),
    document.getElementById('macro-editor-overlay')
  ];
  tabs.forEach(tab => {
    if (tab) hide(tab);
  });
}


// Open Axis Control Tab
// Initialize 3D model when Axis tab opens
function openAxisTab() {
  console.log('Opening axis control tab');
  const axisContent = document.getElementById('axis-content');
  if (!axisContent) {
    console.error('Axis tab content not found');
    return;
  }
  closeAllTabs();
  show(axisContent);
  if (!renderer) init3DModel(); // Initialize on first open
}

// Submit macro to queue
function submitMacro() {
  const macroInput = document.getElementById('macro-input');
  if (!macroInput) {
    console.error('Macro input element not found');
    return;
  }
  const macro = macroInput.value.trim();
  if (!macro) {
    console.error('Macro input is empty');
    alert('Please enter a macro command.');
    return;
  }

  // Add to local queue
  commandQueue.push(macro);
  console.log('Macro added to queue:', macro, 'Queue:', commandQueue);

  // Send to server (adjust endpoint as needed)
  fetch('/api/add-macro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ macro })
  })
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(data => {
    console.log('Macro successfully added:', data);
    hide(document.getElementById('macro-editor-overlay'));
  })
  .catch(err => {
    console.error('Error adding macro:', err);
    alert('Failed to add macro. Please try again.');
  });
}

// Cancel macro input
function cancelMacro() {
  const macroEditorOverlay = document.getElementById('macro-editor-overlay');
  if (macroEditorOverlay) {
    hide(macroEditorOverlay);
  } else {
    console.error('Macro editor overlay not found');
  }
}

// Optional: Execute command queue
function executeQueue() {
  if (commandQueue.length === 0) {
    console.log('Command queue is empty');
    return;
  }
  const macro = commandQueue.shift();
  console.log('Executing macro:', macro);
  // Split macro into individual commands (e.g., "moveAxis(10);moveAxis(5)")
  const commands = macro.split(';').filter(cmd => cmd.trim());
  commands.forEach(cmd => {
    try {
      // Execute command (safer than eval)
      const match = cmd.match(/^moveAxis\(([-+]?[0-9]*\.?[0-9]+)\)$/);
      if (match) {
        const distance = parseFloat(match[1]);
        moveAxis(distance); // Reuse existing moveAxis function
      } else {
        console.error('Invalid command:', cmd);
      }
    } catch (err) {
      console.error('Error executing command:', cmd, err);
    }
  });
  // Continue queue after delay (adjust as needed)
  setTimeout(executeQueue, 1000);
}
async function deleteFile() {
  const name = document.getElementById('editor-filename').textContent;
  await fetch(`/api/config-file?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  closeEditor();
  loadConfigList();
}

// ── Profiles Tab & Editor ──
function openProfilesTab() {
  closeAllTabs();
  show(document.getElementById('profiles-content'));
  loadProfileList();
}

async function loadProfileList() {
  const resNames = await fetch('/api/solder-profiles');
  const { profiles: names } = await resNames.json();
  const ul = document.getElementById('profile-file-list');
  ul.innerHTML = '';

  for (const name of names) {
    try {
      const r = await fetch(`/api/solder-profile?name=${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error('Not found');
      const p = await r.json();

      const li = document.createElement('li');
      li.className = 'profile-list-item';

      // Icon thumbnail
      const icon = document.createElement('img');
      icon.src = p.icon_url || '/static/images/default-solder.png';
      icon.alt = p.name;
      icon.style = 'width:24px;height:24px;margin-right:8px;vertical-align:middle;';

      // Text: name + molten/solid temps
      const text = document.createElement('span');
      text.innerHTML = `
        <strong>${p.name}</strong>
        <small style="margin-left:8px;color:#aaa;">
          Molten: ${p.molten_temp}°C |
          Solid: ${p.solid_temp}°C
        </small>`;

      li.appendChild(icon);
      li.appendChild(text);
      li.ondblclick = () => openProfileEditor(p.name);
      ul.appendChild(li);
    } catch (err) {
      console.error('Failed to load profile', name, err);
    }
  }
}

async function openProfileEditor(name) {
  const res = await fetch(`/api/solder-profile?name=${encodeURIComponent(name)}`);
  const p   = await res.json();

  document.getElementById('profile-editor-filename').textContent = p.name;

  // Populate fields
  document.getElementById('profile-editor-icon').value    = p.icon_url || '';
  document.getElementById('profile-icon-preview').src     = p.icon_url || '/static/images/default-solder.png';
  document.getElementById('profile-editor-name').value    = p.name;
  document.getElementById('profile-editor-molten').value  = p.molten_temp;
  document.getElementById('profile-editor-solid').value   = p.solid_temp;
  document.getElementById('profile-editor-composition').value = p.composition;
  document.getElementById('profile-editor-peak').value    = p.peak_temp;
  document.getElementById('profile-editor-preheat').value = p.preheat_time;
  document.getElementById('profile-editor-soak').value    = p.soak_time;
  document.getElementById('profile-editor-reflow').value  = p.reflow_time;
  document.getElementById('profile-editor-cool').value    = p.cool_time;

  show(document.getElementById('profile-editor-overlay'));
}

function closeProfileEditor() {
  hide(document.getElementById('profile-editor-overlay'));
}

document.getElementById('profile-editor-icon').addEventListener('input', e => {
  const url = e.target.value.trim();
  document.getElementById('profile-icon-preview').src = url || '/static/images/default-solder.png';
});

document.addEventListener('DOMContentLoaded', () => {
  // Chart setup
  const ctx = document.getElementById('temp-chart').getContext('2d');
  if (!ctx) {
    console.error('Canvas element with id "temp-chart" not found');
    return;
  }


  const axisTabButton = document.getElementById('axis-tab-button');
  if (axisTabButton) {
    axisTabButton.addEventListener('click', openAxisTab);
  }
  const axisCloseBtn = document.getElementById('axis-close-btn');
  if (axisCloseBtn) {
    axisCloseBtn.addEventListener('click', closeAllTabs);
  }
  tempChart = new Chart(ctx, { // Assign to global tempChart
    type: 'line',
    data: tempData,
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: true,
      devicePixelRatio: window.devicePixelRatio || 1,
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        x: {
          type: 'category',
          title: { display: true, text: 'Time' }
        },
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Temperature (°C)' },
                        suggestedMin: 25,
                        suggestedMax: 40
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Duty Cycle (%)' },
                        min: 0,
                        max: 100,
                        grid: { drawOnChartArea: false }
        },
        y2: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Power (W)' },
                        min: 0,
                        max: 400,
                        grid: { drawOnChartArea: false },
                        offset: true
        },
        y3: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Interior Humidity (%)' },
                        min: 30,
                        max: 100,
                        grid: { drawOnChartArea: false },
                        offset: true
        },
        y4: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'PWM' },
          min: 0,
          max: 255,
          grid: { drawOnChartArea: false },
          offset: true

        }
      }
    }
  });

  // Console toggle button logic
  const toggleConsoleBtn = document.getElementById('toggle-console-btn');
  const consoleOutput = document.getElementById('console-output');
  const consoleArrow = document.getElementById('console-arrow');

  if (!toggleConsoleBtn || !consoleOutput || !consoleArrow) {
    console.error('Console toggle elements not found');
  } else {
    toggleConsoleBtn.addEventListener('click', () => {
      console.log('Console toggle button clicked');
      const isCollapsed = consoleOutput.classList.contains('collapsed');
      consoleOutput.classList.toggle('collapsed');
      consoleArrow.classList.toggle('collapsed');
      consoleArrow.textContent = isCollapsed ? '▼' : '▶';
      console.log(`Console ${isCollapsed ? 'expanded' : 'collapsed'}`);
    });
  }

  // Chart toggle button logic
  const toggleChartBtn = document.getElementById('toggle-chart-btn');
  const tempChartElement = document.getElementById('temp-chart');
  const chartArrow = document.getElementById('chart-arrow');

  if (!toggleChartBtn || !tempChartElement || !chartArrow) {
    console.error('Chart toggle elements not found');
  } else {
    toggleChartBtn.addEventListener('click', () => {
      console.log('Chart toggle button clicked');
      const isCollapsed = tempChartElement.classList.contains('collapsed');
      tempChartElement.classList.toggle('collapsed');
      chartArrow.classList.toggle('collapsed');
      chartArrow.textContent = isCollapsed ? '▼' : '▶';
      if (tempChart) {
        tempChart.resize();
        console.log('Chart resized after toggle');
      }
      console.log(`Chart ${isCollapsed ? 'expanded' : 'collapsed'}`);
    });
  }
  // Fullscreen button logic
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  if (!fullscreenBtn) {
    console.error('Fullscreen button with id "fullscreen-btn" not found');
    return;
  }

  fullscreenBtn.addEventListener('click', () => {
    console.log('Fullscreen button clicked');
    const chartContainer = document.getElementById('temp-chart-parent');
    if (!chartContainer) {
      console.error('Chart container with id "temp-chart-parent" not found');
      return;
    }

    if (!document.fullscreenElement) {
      console.log('Requesting fullscreen');
      chartContainer.requestFullscreen().catch(err => {
        console.error('Failed to enter fullscreen:', err);
      });
    } else {
      console.log('Exiting fullscreen');
      document.exitFullscreen().catch(err => {
        console.error('Failed to exit fullscreen:', err);
      });
    }
  });

  document.addEventListener('fullscreenchange', () => {
    console.log('Fullscreen state changed. Fullscreen element:', document.fullscreenElement);
    if (tempChart) {
      tempChart.resize();
      console.log('Chart resized');
    } else {
      console.error('tempChart is not defined');
    }
  });

  // Existing event listeners
  document.getElementById('machine-tab-button').addEventListener('click', openMachineTab);
  document.getElementById('profiles-tab-button').addEventListener('click', openProfilesTab);
  document.getElementById('machine-close-btn').addEventListener('click', closeAllTabs);
  document.getElementById('profiles-close-btn').addEventListener('click', closeAllTabs);
  document.getElementById('editor-close-btn').addEventListener('click', closeEditor);
  document.getElementById('profile-editor-close-btn').addEventListener('click', closeProfileEditor);
  document.getElementById('temp-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') setTemp();
  });

    // Camera toggle
    document.getElementById('camera-toggle').addEventListener('click', (event) => {
      if (event.target.id === 'zoom-slider' || event.target.closest('#zoom-slider')) {
        return;
      }
      const section = document.getElementById('camera-section');
      const arrow = document.getElementById('camera-arrow');
      const isVisible = section.style.display !== 'none';
      section.style.display = isVisible ? 'none' : 'block';
      arrow.textContent = isVisible ? '▶' : '▼';
    });

    document.getElementById('profile-editor-icon-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('icon', file);

      const res = await fetch('/api/upload-icon', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        alert('Icon upload failed');
        return;
      }

      const { url } = await res.json();
      document.getElementById('profile-editor-icon').value = url;
      document.getElementById('profile-icon-preview').src = url;
    });

    document.addEventListener('DOMContentLoaded', () => {
      const machineTabButton = document.getElementById('machine-tab-button');
      console.log('Machine tab button found:', machineTabButton);
      if (!machineTabButton) {
        console.error('Machine tab button not found');
        return;
      }
      machineTabButton.addEventListener('click', () => {
        console.log('Machine tab button clicked');
        openMachineTab();
      });
    });

    window.addEventListener('resize', onWindowResize);
    animate();
});

function sendConsoleCommand(command = null) {
  const input = document.getElementById("console-input");
  const output = document.getElementById("console-output");

  // Use provided command if available, otherwise get from input field
  const cmd = command !== null ? command.trim() : input.value.trim();

  if (!cmd) {
    output.textContent = "Please enter a command.";
    return;
  }

  output.textContent = "Sending command...";

  fetch("/api/send-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: cmd })
  })
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        output.textContent = `Command sent successfully.\nResponse:\n${data.response}`;
      } else {
        output.textContent = `Command failed to send.\n${JSON.stringify(data, null, 2)}`;
      }
    })
    .catch(err => {
      output.textContent = `Error sending command:\n${err}`;
    });
}

// Three.js setup
let scene, camera, renderer, model, headModel, hotplateModel, objectBox, controls;
let currentTemp = 30; // Synced with Flask's current_temp_value
let currentZPos = 0;
let isHeadModelLoaded = false;
let isHotplateModelLoaded = false;

// Adjustable offsets for the box position (in mm)
let offsetX = -30; // X offset in mm
let offsetY = -22; // Y offset in mm
let offsetZ = -150; // Z offset in mm (0 keeps box bottom on hotplate surface)

// New: Toggle for bitmap display
let showBitmap = true;

function init3DModel() {
  const container = document.getElementById('model-container');
  if (!container) {
    console.error('Model container not found');
    return;
  }

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);

  // Camera
  camera = new THREE.PerspectiveCamera(
    75,
    container.clientWidth / container.clientHeight,
    0.001,
    100000
  );
  camera.position.set(0, 0, 0.3);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(0, 1, 1);
  scene.add(directionalLight);

  // Controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = false;
  controls.minPolarAngle = -Infinity;
  controls.maxPolarAngle = Infinity;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.minDistance = 0.001;
  controls.maxDistance = 1000;
  controls.update();

  // Bitmap display setup
  const bitmapContainer = document.createElement('div');
  bitmapContainer.style.position = 'absolute';
  bitmapContainer.style.bottom = '10px';
  bitmapContainer.style.right = '10px';
  bitmapContainer.style.background = 'rgba(255, 255, 255, 0.7)';
  bitmapContainer.style.padding = '5px';
  bitmapContainer.style.border = '1px solid black';
  container.appendChild(bitmapContainer);

  const bitmapCanvas = document.createElement('canvas');
  bitmapCanvas.width = 200;
  bitmapCanvas.height = 200;
  bitmapCanvas.style.display = 'block';
  bitmapContainer.appendChild(bitmapCanvas);

  // New: Toggle button for bitmap display
  const toggleButton = document.createElement('button');
  toggleButton.textContent = 'Toggle Bitmap';
  toggleButton.style.margin = '5px';
  toggleButton.onclick = () => {
    showBitmap = !showBitmap;
    bitmapContainer.style.display = showBitmap ? 'block' : 'none';
    console.log(`Bitmap display ${showBitmap ? 'enabled' : 'disabled'}`);
  };
  bitmapContainer.appendChild(toggleButton);

  // Camera info display
  const camInfo = document.createElement('div');
  camInfo.style.position = 'absolute';
  camInfo.style.top = '10px';
  camInfo.style.left = '10px';
  camInfo.style.color = 'black';
  camInfo.style.background = 'rgba(255, 255, 255, 0.7)';
  camInfo.style.padding = '5px';
  camInfo.style.fontFamily = 'Arial, sans-serif';
  camInfo.style.fontSize = '12px';
  container.appendChild(camInfo);

  function updateCameraInfo() {
    const pos = camera.position;
    const rot = camera.rotation;
    const rotDegrees = {
      x: THREE.MathUtils.radToDeg(rot.x).toFixed(2),
      y: THREE.MathUtils.radToDeg(rot.y).toFixed(2),
      z: THREE.MathUtils.radToDeg(rot.z).toFixed(2)
    };
    camInfo.textContent = `Camera Pos: X=${pos.x.toFixed(2)}, Y=${pos.y.toFixed(2)}, Z=${pos.z.toFixed(2)}\n` +
    `Camera Rot: X=${rotDegrees.x}°, Y=${rotDegrees.y}°, Z=${rotDegrees.z}°`;
  }

  const loader = new THREE.GLTFLoader();

  loader.load(
    '/static/models/Reflow_Machine.glb',
    gltf => {
      model = gltf.scene;
      model.rotation.x = THREE.MathUtils.degToRad(180);
      model.scale.set(0.5, 0.5, 0.5);
      scene.add(model);
    },
    undefined,
    err => console.error(err)
  );

  loader.load(
    '/static/models/Carriage.glb',
    gltf => {
      headModel = gltf.scene;
      headModel.rotation.x = THREE.MathUtils.degToRad(180);
      const carriageHead = headModel.getObjectByName('carriage_head');
      if (carriageHead) headModel = carriageHead;
      headModel.scale.set(0.5, 0.5, 0.5);
      headModel.position.z = 0;
      scene.add(headModel);
      isHeadModelLoaded = true;
      tryRestorePositionAndStart();
    },
    undefined,
    err => console.error(err)
  );

  loader.load(
    '/static/models/Hotplate.glb',
    gltf => {
      hotplateModel = gltf.scene;
      hotplateModel.rotation.x = THREE.MathUtils.degToRad(180);
      hotplateModel.traverse(child => {
        if (child.isMesh) child.userData.originalMaterial = child.material.clone();
      });
        hotplateModel.scale.set(0.5, 0.5, 0.5);
        scene.add(hotplateModel);
        isHotplateModelLoaded = true;
        tryRestorePositionAndStart();
    },
    undefined,
    err => console.error(err)
  );

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    bitmapCanvas.width = Math.min(200, container.clientWidth / 4);
    bitmapCanvas.height = Math.min(200, container.clientHeight / 4);
  });

  function tryRestorePositionAndStart() {
    if (!isHeadModelLoaded || !isHotplateModelLoaded) return;
    const savedZPos = parseFloat(localStorage.getItem('currentZPos'));
    if (!isNaN(savedZPos)) {
      currentZPos = savedZPos;
      const zEl = document.getElementById('current-z-pos');
      if (zEl) zEl.textContent = `Z: ${currentZPos.toFixed(2)} mm`;
      const maxTravel = 100;
      const scale = 0.0005;
      headModel.position.z = THREE.MathUtils.clamp(
        currentZPos * scale, -maxTravel * scale, maxTravel * scale
      );
      fetch('/api/send-gcode', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ command: `G1 Z${currentZPos.toFixed(2)}` })
      })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => console.log('Axis position restored:', d))
      .catch(e => console.error('Error restoring axis position:', e));
    }
    animate3DModel();
  }

  function animate3DModel() {
    requestAnimationFrame(animate3DModel);
    controls.update();
    updateCameraInfo();
    renderer.render(scene, camera);
  }

  function updateHotplateColor(temp = currentTemp) {
    if (!hotplateModel) return;
    if (temp < 35) {
      hotplateModel.traverse(child => {
        if (child.isMesh && child.userData.originalMaterial) {
          child.material = child.userData.originalMaterial;
        }
      });
      return;
    }
    let color;
    if (temp <= 40) {
      color = new THREE.Color().lerpColors(
        new THREE.Color(0x0000ff),
                                           new THREE.Color(0x4444ff),
                                           (temp - 35) / 5
      );
    } else if (temp <= 65) {
      color = new THREE.Color().lerpColors(
        new THREE.Color(0x4444ff),
                                           new THREE.Color(0x00ff00),
                                           (temp - 40) / 25
      );
    } else if (temp <= 90) {
      color = new THREE.Color().lerpColors(
        new THREE.Color(0x00ff00),
                                           new THREE.Color(0xffff00),
                                           (temp - 65) / 25
      );
    } else {
      color = new THREE.Color().lerpColors(
        new THREE.Color(0xffff00),
                                           new THREE.Color(0xff0000),
                                           Math.min((temp - 90) / 60, 1)
      );
    }
    hotplateModel.traverse(child => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: color,
          metalness: 0.5,
          roughness: 0.5
        });
      }
    });
  }

  function updateBitmapDisplay(imageData, objectData) {
    const ctx = bitmapCanvas.getContext('2d');
    ctx.clearRect(0, 0, bitmapCanvas.width, bitmapCanvas.height);

    if (!imageData) {
      console.log('No bitmap image data, clearing canvas');
      // New: Display placeholder
      ctx.fillStyle = 'gray';
      ctx.fillRect(0, 0, bitmapCanvas.width, bitmapCanvas.height);
      ctx.fillStyle = 'white';
      ctx.font = '12px Arial';
      ctx.fillText('No Image Available', 10, bitmapCanvas.height / 2);
      return;
    }

    const img = new Image();
    img.onload = () => {
      console.log('Image loaded successfully, size:', img.width, 'x', img.height);
      const scale = Math.min(bitmapCanvas.width / img.width, bitmapCanvas.height / img.height);
      const imgWidth = img.width * scale;
      const imgHeight = img.height * scale;
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);

      if (objectData && objectData.success) {
        const { center_x_mm, center_y_mm, width_mm, height_mm, rotation_deg = 0 } = objectData;
        const mmPerPixel = 0.1; // Adjust based on camera calibration
        const centerX = center_x_mm / mmPerPixel * scale;
        const centerY = center_y_mm / mmPerPixel * scale;
        const boxWidth = width_mm / mmPerPixel * scale;
        const boxHeight = height_mm / mmPerPixel * scale;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(THREE.MathUtils.degToRad(rotation_deg));
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.strokeRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(10, 0);
        ctx.moveTo(0, -10);
        ctx.lineTo(0, 10);
        ctx.stroke();
        ctx.restore();
      }
    };
    img.onerror = () => console.error('Error loading bitmap image:', imageData);
    img.src = imageData;
  }

  let lastBitmapData = null; // Store last valid bitmap data
  let objectBoxes = []; // Store multiple PCB boxes
  let lastImageData = null; // Store last valid bitmap image

  function updateObjectBox() {
    fetch('/api/bitmap')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      console.log('Bitmap data:', data); // Debug: Log object detection data

      // Check if new PCB data differs significantly from last
      const pcbs = data.success ? data.pcbs || [] : (data.cached ? lastBitmapData?.pcbs || [] : []);
      const isDataChanged = !lastBitmapData || JSON.stringify(pcbs) !== JSON.stringify(lastBitmapData?.pcbs || []);

      if (data.success) {
        lastBitmapData = data; // Update last valid bitmap data
      } else if (!data.cached) {
        console.log('No valid bitmap data, retaining last PCB boxes');
        if (lastImageData) {
          updateBitmapDisplay(lastImageData, lastBitmapData || { pcbs: [] });
        }
        return; // Skip updating if no cached data
      }

      fetch('/api/bitmap-image')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text(); // Expect base64 string
      })
      .then(imageData => {
        console.log('Image data:', imageData.substring(0, 50)); // Debug: Log start of image data
        lastImageData = imageData; // Cache image data
        updateBitmapDisplay(imageData, lastBitmapData || data);
      })
      .catch(err => {
        console.error('Error fetching bitmap image:', err);
        if (lastImageData) {
          updateBitmapDisplay(lastImageData, lastBitmapData || data); // Use cached image
        } else {
          updateBitmapDisplay(null, lastBitmapData || data); // Fallback to placeholder
        }
      });

      if (!data.success && !data.cached) {
        console.log('No PCBs detected and no cached data, removing boxes');
        objectBoxes.forEach(box => scene.remove(box));
        objectBoxes = [];
        return;
      }

      // Only update boxes if data has changed
      if (isDataChanged) {
        // Remove existing boxes
        objectBoxes.forEach(box => scene.remove(box));
        objectBoxes = [];

        // Create boxes for each PCB
        const modelScale = 0.0003;
        pcbs.forEach(pcb => {
          const { center_x_mm, center_y_mm, width_mm, height_mm, rotation_deg = 0 } = pcb;
          const boxWidth = width_mm * modelScale;
          const boxDepth = height_mm * modelScale;
          const boxHeight = 15 * modelScale;
          const boxX = (center_x_mm + offsetX) * modelScale;
          const boxY = (center_y_mm + offsetY) * modelScale;
          const boxZ = (boxHeight / 2) + (offsetZ * modelScale);

          const geometry = new THREE.BoxGeometry(boxWidth, boxDepth, boxHeight);
          const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
          const box = new THREE.Mesh(geometry, material);
          box.position.set(boxX, boxY, boxZ);
          box.rotation.z = THREE.MathUtils.degToRad(rotation_deg);
          scene.add(box);
          objectBoxes.push(box);
          console.log(`PCB box added: center (${boxX.toFixed(4)}, ${boxY.toFixed(4)}, ${boxZ.toFixed(4)}), size (${boxWidth.toFixed(4)}, ${boxDepth.toFixed(4)}, ${boxHeight.toFixed(4)}), rotation (${rotation_deg.toFixed(2)}°)`);
        });
      } else {
        console.log('PCB data unchanged, skipping box update');
      }
    })
    .catch(err => {
      console.error('Error fetching bitmap data:', err);
      if (lastBitmapData && lastImageData) {
        updateBitmapDisplay(lastImageData, lastBitmapData); // Retain last image and boxes
      } else {
        updateBitmapDisplay(null, null); // Fallback to placeholder
      }
    });
  }

  function fetchAndUpdateTemp() {
    fetch('/api/current-temperature')
    .then(res => res.ok ? res.json() : Promise.reject(res.status))
    .then(data => {
      const temp = (typeof data === 'number') ? data : parseFloat(data.temperature);
      if (!isNaN(temp)) {
        currentTemp = temp;
        updateHotplateColor();
        console.log('Updated temp:', currentTemp);
      } else {
        console.error('Temperature not a valid number:', data);
      }
    })
    .catch(err => console.error('Error fetching temp:', err));
  }

  setInterval(() => {
    fetchAndUpdateTemp();
    updateObjectBox();
  }, 250);
  fetchAndUpdateTemp();
}

function moveAxis(distance) {
  console.log(`Moving axis by ${distance} mm`);
  currentZPos += -distance;
  localStorage.setItem('currentZPos', currentZPos);
  const zEl = document.getElementById('current-z-pos');
  if (zEl) zEl.textContent = `Z: ${currentZPos.toFixed(2)} mm`;
  if (headModel) {
    const maxTravel = 100;
    const scale = 0.0005;
    headModel.position.z = THREE.MathUtils.clamp(
      currentZPos * scale, -maxTravel * scale, maxTravel * scale
    );
  }
  fetch('/api/send-gcode', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ command: `G1 Z${currentZPos.toFixed(2)}` })
  })
  .then(r => r.ok ? r.json() : Promise.reject(r.status))
  .then(d => console.log('Axis moved response:', d))
  .catch(e => console.error('G-code error:', e));
}
function onWindowResize() {
  if (!container  || !renderer) return;
  renderer.setSize(container.clientWidth, container.clientHeight);
}

window.onload = initialize;



