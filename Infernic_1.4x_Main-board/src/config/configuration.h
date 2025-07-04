#ifndef CONFIGURATION_H
#define CONFIGURATION_H
#pragma once
// pull in Arduino/ESP32‑core types (uint8_t, pinMode, Serial, etc)
#include <Arduino.h>
#include "helpers/helpers.h"
#include "safeguards/safeguard.h"
#include "heating/heating.h"
#include "WIFI/Wifi.h"





// ——— WEB SERVER ———
extern WebServer server;

// ——— YOUR NETWORK ———
extern const char* WIFI_SSID;
extern const char* WIFI_PASS;


// ——— PI5 ENDPOINT —————————————————————————
extern const char* HOST_IP;        // "192.168.1.33"
extern const uint16_t HOST_PORT;      // Pi’s HTTP port
extern const char* TEMP_URL;
extern const char* PWM_URL;         // Endpoint for PID control
extern const char* LID_URL;
extern const char* TARGET_URL;
extern const char* HUMIDITY_URL;
extern const char* STATE_URL;
extern const char* STEP_URL;
extern const char* FAULT_ENDPOINT;

// ——— PIN DEFINITIONS ———
extern const int LED_PIN;
extern const int SSR_PIN;
extern const int NTC_PIN;
extern const int BUZZER_PIN;
extern const int Relay_2_PIN;
extern const int FLAME_LED_PIN;
// ——— SETTINGS ———
extern const unsigned long TIMEOUT_MS;
extern const unsigned long TEMP_INTERVAL;
extern bool USE_BUZZER; // Enable/disable buzzer for alerts
extern bool STARTUP_JINGLE; // Play startup jingle on boot
// — Calibration — adjust to your hardware
extern const float VCC;
extern const float B_COEFFICIENT;

/// Time (ms) of the full on/off window for SSR burst-mode control
extern const unsigned long PWM_WINDOW_MS;

// — Thermistor & ADC ———————————————————
extern const int   ADC_MAX;
extern const float SERIES_R;
extern const float NOMINAL_R;
extern const float NOMINAL_T;
extern const int   ADC_SAMPLES;

// ——— STATE ———
extern char          lineBuf[256];
extern uint8_t       lineIdx;
extern bool          activeJob;
extern bool          faulted;
extern unsigned long lastCmd;
extern unsigned long lastTemp;

// ——— CONFIG STRUCT ———
typedef struct {
    char name[32];
    int  maxTemp;
    int  minTemp;
  } Conf;
  extern Conf cfg;

  // ——— QUEUE for POSTER TASK ———
extern QueueHandle_t tempQueue;


extern WiFiUDP udp;

extern float MIN_TEMP;   // °C
extern float MAX_TEMP;  // °C


#endif // CONFIGURATION_H