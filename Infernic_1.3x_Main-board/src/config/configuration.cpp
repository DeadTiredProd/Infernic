#include "config/configuration.h"

// ——— YOUR NETWORK ———
const char* WIFI_SSID = "SpectrumSetup-23";
const char* WIFI_PASS = "classybunny677";

// ——— PI5 ENDPOINTS —————————————————————————
const char* TEMP_URL = "http://192.168.1.33:5001/api/temperature";
const char* PWM_URL  = "http://192.168.1.33:5001/api/pwm";
const char* LID_URL = "http://192.168.1.33:5001/api/lid";
const char* TARGET_URL = "http://192.168.1.33:5001/api/target_temp";
const char* HUMIDITY_URL = "http://192.168.1.33:5001/api/humidity";
const char* STATE_URL = "http://192.168.1.33:5001/api/state";
const char* STEP_URL = "http://192.168.1.33:5001/api/step";
const char* FAULT_ENDPOINT = "/api/ntc_fault";
const uint16_t HOST_PORT = 5001;
const char* HOST_IP = "192.168.1.33";
// ——— PIN DEFINITIONS ———
const int LED_PIN = 2;  // Controls the LED for status indication Internally used for debugging
const int SSR_PIN = 15;  // Controls the Solid State Relay (SSR) for heating
const int NTC_PIN = 35; // Analog pin for the NTC thermistor
const int BUZZER_PIN = 32; // Controls the buzzer for alerts
const int Relay_2_PIN = 19;  //Controls Input Line of the SSR preventing the SSR from malfunctioning in case of a fault
const int FLAME_LED_PIN = 18; // Controls the LED indicating flame.




// ——— SETTINGS ———
const unsigned long TIMEOUT_MS    = 30UL * 60UL * 1000UL;
const unsigned long TEMP_INTERVAL = 1000UL;

float MIN_TEMP      = 30.0f;   // °C
float MAX_TEMP      = 200.0f;  // °C

bool USE_BUZZER = true; // Enable/disable buzzer for alerts
bool STARTUP_JINGLE = true; // Play startup jingle on boot

// — Calibration — adjust to your hardware
const float VCC           = 3.3f;
const float B_COEFFICIENT = 3950.0f;

// — Thermistor & ADC ———————————————————
const int   ADC_MAX     = 4095;
const float SERIES_R    = 100000.0f;
const float NOMINAL_R   = 100000.0f;
const float NOMINAL_T   = 25.0f;
const int   ADC_SAMPLES = 100;

// ——— STATE ———
char          lineBuf[256];
uint8_t       lineIdx   = 0;
bool          activeJob = false;
bool          faulted   = false;
unsigned long lastCmd   = 0;
unsigned long lastTemp  = 0;

// ——— CONFIG STRUCT ———
Conf cfg;

// ——— QUEUE for POSTER TASK ———
QueueHandle_t tempQueue = nullptr;

// ——— WEB SERVER ———
WebServer server(80);

WiFiUDP udp;        // Global UDP object declaration