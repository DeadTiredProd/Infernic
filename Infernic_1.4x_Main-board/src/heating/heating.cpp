// heating.cpp
#include "heating.h"
#include "config/configuration.h"
#include "helpers/helpers.h"
#include "Safeguards/safeguard.h"
#include <math.h>
#include <Adafruit_AHTX0.h>
#include <Preferences.h>
#include "pwm.h"

Adafruit_AHTX0 aht;
static unsigned long lastNTCTempPrintTime = 0;
extern const float adc_to_temp[4096];

// Globals
bool CANHEAT = false;
float targetTemp = 0.0f;
float kp = 12.0f;
float ki = 1.2f;
float kd = 5.0f;
float integral = 0.0f;
float lastError = 0.0f;
static unsigned long lastPIDTime = 0;
static uint8_t currentPWMDuty = 0; // Changed to uint8_t to match pwmGetDuty

// PID Calibration Parameters
static const float CAL_HIGH_TEMP = 150.0f;
static const float CAL_LOW_TEMP = 125.0f;
static const int CAL_SETPOINT_HITS = 6;
static const unsigned long HOLD_MS = 2000;

void initHeating() {
  pinMode(Relay_2_PIN, OUTPUT);
  digitalWrite(Relay_2_PIN, HIGH);
  CANHEAT = false;

  pwmInit(SSR_PIN); // Use custom PWM library
  Serial.printf("PWM settings: freq=%u Hz, maxCount=%u\n", PWM_FREQ, PWM_MAX_COUNT);
  lastPIDTime = millis();
}

void controlRelay(int state) {
  if (state) {
    digitalWrite(Relay_2_PIN, LOW);
    CANHEAT = true;
  } else {
    digitalWrite(Relay_2_PIN, HIGH);
    CANHEAT = false;
    currentPWMDuty = 0;
    pwmReset();
  }
}

void setTargetTemp(float temp) {
  targetTemp = temp;
  integral = 0.0f;
  lastError = 0.0f;
  lastPIDTime = millis();

  if (temp == 0.0f) {
    Serial.println("Target temperature cleared. Relay OFF.");
    controlRelay(0);
  } else if (temp >= MIN_TEMP && temp <= MAX_TEMP) {
    Serial.printf("Target temperature set to %.2f °C. Relay ON.\n", targetTemp);
    controlRelay(1);
    state = "HEATING";
  } else {
    Serial.printf("Target temperature %.2f °C is out of safe range (50–300 °C). Relay OFF.\n", temp);
    controlRelay(0);
  }
}

void updatePWM(float currentTemp) {
  unsigned long now = millis();
  float dt = (now - lastPIDTime) / 1000.0f;
  lastPIDTime = now;
  if (dt <= 0) return;

  float error = targetTemp - currentTemp;
  integral += error * dt;
  integral = constrain(integral, -100.0f / ki, 100.0f / ki);
  float derivative = (error - lastError) / dt;
  lastError = error;

  pwmOutput = constrain(kp * error + ki * integral + kd * derivative, 0, 255);
  currentPWMDuty = pwmOutput;
  pwmSetDuty(currentPWMDuty); // Apply PWM immediately

  Serial.printf("[PID] Temp=%.2f°C, Error=%.2f, Integral=%.2f, PWM=%u\n",
                currentTemp, error, integral, currentPWMDuty);
}

void handleSSR(float currentTemp) {
  static unsigned long lastSwitch = 0;
  const float STARTUP_BAND_C = 25.0f;
  const float HYSTERESIS_C = 1.0f;
  const unsigned long MIN_SWITCH_MS = 200;

  if (!CANHEAT) {
    if (currentPWMDuty != 0) {
      pwmReset();
      currentPWMDuty = 0;
      Serial.println("[PWM] Heating disabled — PWM OFF");
    }
    return;
  }

  float error = targetTemp - currentTemp;
  uint8_t duty = currentPWMDuty; // Default to PID output
  unsigned long now = millis();

  // Bang-bang control
  if (error > STARTUP_BAND_C) {
    duty = 255; // Full ON
  } else if (error < -STARTUP_BAND_C) {
    duty = 0; // Full OFF
  }

  // Update PWM if changed and enough time has passed
  if ((now - lastSwitch) >= MIN_SWITCH_MS && duty != currentPWMDuty) {
    pwmSetDuty(duty);
    currentPWMDuty = duty;
    lastSwitch = now;
    Serial.printf("[PWM] Duty=%u/255 (%.1f%%), Temp=%.2f°C, Error=%.2f\n",
                  duty, (duty * 100.0f) / 255.0f, currentTemp, error);
  }
}

void setkp(float tkp) {
  Preferences prefs;
  prefs.begin("pid_config", false);
  kp = tkp;
  prefs.putFloat("kp", kp);
  prefs.end();
  Serial.printf("New Kp set: %.2f (saved to flash)\n", kp);
}

void setki(float tki) {
  Preferences prefs;
  prefs.begin("pid_config", false);
  ki = tki;
  prefs.putFloat("ki", ki);
  prefs.end();
  Serial.printf("New Ki set: %.2f (saved to flash)\n", ki);
}

void setkd(float tkd) {
  Preferences prefs;
  prefs.begin("pid_config", false);
  kd = tkd;
  prefs.putFloat("kd", kd);
  prefs.end();
  Serial.printf("New Kd set: %.2f (saved to flash)\n", kd);
}

float readTemp() {
  uint16_t raw = analogRead(NTC_PIN) & 0x0FFF;
  float temp = adc_to_temp[raw];

  unsigned long now = millis();
  if (now - lastNTCTempPrintTime >= 900) {
    lastNTCTempPrintTime = now;
    Serial.println("***** PLATE TEMP *****");
    Serial.printf("Temp: %.2f °C\n", temp);
    Serial.println("**********************\n");
  }

  return temp;
}

void checkTemperature(float t) {
  if (t < -10.0f || t > 310.0f) {
    emergencyShutdown();
    sendFaultAlert();
    state = "ERROR"; // Set state to ERROR for fault condition
  } else if (targetTemp == 0.0f && t < 40.0f) {
    state = "IDLE"; // Set state to IDLE when target is 0 and temp < 40
  } else if (abs(t - targetTemp) <= 1.0f && targetTemp > 0.0f) {
    state = "STABLE"; // Set state to STABLE when temp is within 1°C of target
  } else if (t < 40.0f && CANHEAT && targetTemp > 0.0f && targetTemp > MIN_TEMP) {
    state = "HEATING";
  } else if (t > targetTemp && t >= 40.0f) {
    state = "COOLING";
  }
}


static bool _rampTo(float setpoint, float tol) {
  setTargetTemp(setpoint);
  float initTemp = readTemp();
  unsigned long start = millis();

  while (true) {
    float T = readTemp();
    updatePWM(T);
    handleSSR(T);
    Serial.printf("%.1f,%.2f\n", (millis() - start) / 1000.0f, T);

    if (millis() - start >= 5000 && T < initTemp + 2.0f) {
      Serial.println("ERROR: Heater failed to raise temp → EMERGENCY SHUTDOWN");
      emergencyShutdown();
      return false;
    }

    if (fabs(T - setpoint) <= tol) {
      unsigned long holdStart = millis();
      while (millis() - holdStart < HOLD_MS) {
        float Th = readTemp();
        updatePWM(Th);
        handleSSR(Th);
        Serial.printf("%.1f,%.2f\n", (millis() - start) / 1000.0f, Th);
        delay(100);
      }
      return true;
    }
    delay(100);
  }
}

void runPIDAutotune(float tuneTemp, int cycles, unsigned long noHeatTimeoutMs, float noHeatDelta) {
  Serial.println("=== PID Autotune Start ===");
  Serial.println("time_s,temp_C,pwm_duty");

  float maxTemp = -1e6f, minTemp = 1e6f;
  unsigned long start = millis();
  bool heating = true;
  int cycleCount = 0;
  unsigned long heatOnTime = 0;
  float initTemp = readTemp();

  controlRelay(1);

  while (cycleCount < cycles) {
    unsigned long now = millis();
    float T = readTemp();
    float elapsed = (now - start) / 1000.0f;

    if (heating) {
      pwmSetDuty(255);
      currentPWMDuty = 255;
      if (heatOnTime == 0) {
        heatOnTime = now;
        initTemp = T;
      }
      if (now - heatOnTime >= noHeatTimeoutMs && T < initTemp + noHeatDelta) {
        Serial.println("ERROR: No heat detected → EMERGENCY SHUTDOWN");
        emergencyShutdown();
        controlRelay(0);
        Serial.println("=== Autotune Aborted ===");
        return;
      }
      if (T > tuneTemp + 5.0f) {
        heating = false;
        cycleCount++;
        heatOnTime = 0;
        Serial.printf("Cycle %d: reached %.2f°C\n", cycleCount, T);
      }
    } else {
      pwmReset();
      currentPWMDuty = 0;
      if (T < tuneTemp - 5.0f) {
        heating = true;
        heatOnTime = now;
        initTemp = T;
      }
    }

    maxTemp = max(maxTemp, T);
    minTemp = min(minTemp, T);
    Serial.printf("%.2f,%.2f,%u\n", elapsed, T, currentPWMDuty);
    delay(250);
  }

  pwmReset();
  currentPWMDuty = 0;
  controlRelay(0);
  Serial.println("=== Autotune Complete ===");

  float amplitude = (maxTemp - minTemp) / 2.0f;
  float periodSec = (millis() - start) / (cycleCount * 1000.0f);
  float Ku = (4.0f / M_PI) * (tuneTemp / amplitude);
  float Tu = periodSec;

  Serial.printf("→ Amplitude: %.2f°C\n", amplitude);
  Serial.printf("→ Period:    %.2f s\n", Tu);
  Serial.printf("→ Ku:        %.2f\n", Ku);

  float newKp = 0.6f * Ku;
  float newKi = 2.0f * newKp / Tu;
  float newKd = newKp * Tu / 8.0f;

  Serial.printf("→ New PID: kp=%.2f, ki=%.2f, kd=%.2f\n", newKp, newKi, newKd);

  kp = newKp;
  ki = newKi;
  kd = newKd;
}

void SetupAHT10() {
  Wire.begin(23, 22);
  if (!aht.begin(&Wire)) {
    Serial.println("Failed to find AHT10 sensor!");
    while (1) delay(10);
  }
  Serial.println("AHT10 initialized.");
}

unsigned long lastAHT10ReadTime = 0;
unsigned long lastAHT10PrintTime = 0;

AHT10Reading latestData;

AHT10Reading ReadAHT10() {
  sensors_event_t humidity, temp;
  aht.getEvent(&humidity, &temp);
  unsigned long now = millis();
  if (now - lastAHT10ReadTime >= 100) {
    lastAHT10ReadTime = now;
    latestData = {temp.temperature, humidity.relative_humidity};
  }
  if (now - lastAHT10PrintTime >= 1100) {
    lastAHT10PrintTime = now;
    Serial.println("----- LID TEMP & HUMIDITY -----");
    Serial.printf("Temp: %.2f °C\n", latestData.temperature);
    Serial.printf("Humidity: %.2f %%\n", latestData.humidity);
    Serial.println("------------------------------\n");
  }
  return latestData;
}

