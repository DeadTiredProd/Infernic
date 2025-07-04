// main.cpp
#include "main.h"
int readCount = 0; // Counter for temperature readings

void printESP32IP() {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi not connected.");
  }
}


void setup() {

  Serial.begin(115200);
  Serial.println("Infernic v1.0 starting up...");
  loadSettings(); // Load settings from Preferences
  SetupAHT10();
  initHeating();
  connectWiFi();
  printESP32IP();
  startESPServer();
  OtaSetup();
  startupJingle();
  //fadeFlameLightOn(); // Gradually turn on the flame LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  analogSetAttenuation(ADC_11db);
  analogSetPinAttenuation(NTC_PIN, ADC_11db);

  Serial.setTimeout(10);
  memset(&cfg, 0, sizeof(cfg));

  

  // Queue for temperature poster task
  tempQueue = xQueueCreate(1, sizeof(float));

  // Spawn posterTask on Core 1
  xTaskCreatePinnedToCore(
    posterTask,
    "Poster",
    4096,
    nullptr,
    1,
    nullptr,
    1
  );

  // Set up HTTP endpoint for commands
  server.on("/cmd", HTTP_POST, cmdHandler);
  server.begin();

  lastCmd  = millis();
  lastTemp = millis();
  blink(2, 150);

  state = "IDLE"; // Initialize state to Idle
  
}

void loop() {
  // ——— 1) Networking & HTTP —————————————————————————
   // 1) Service OTA upload traffic:
  server.handleClient();
  handleESPServer();
  ArduinoOTA.handle();


  // ——— 2) Fault-latch —————————————————————————————
  if (faulted) {
    // Immediately kill SSR, blink, and bail out
    digitalWrite(SSR_PIN, LOW);
    blink(1, 500);
    return;
  }

  // ——— 3) Serial command parsing —————————————————————————
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n' || lineIdx >= sizeof(lineBuf) - 1) {
      lineBuf[lineIdx] = '\0';
      handleLine(lineBuf);
      lineIdx = 0;
      lastCmd = millis();
    } else {
      lineBuf[lineIdx++] = c;
    }
  }


  // ——— 5) Temperature read & checks —————————————————————
  float t = readTemp();
  checkTemperature(t);  // hard fault if sensor bad
  AHT10Reading data = ReadAHT10();  // Fast as possible

  unsigned long now = millis();

  // ——— 4) Safety timeout ————————————————————————————
if (!activeJob && now - lastCmd > TIMEOUT_MS &&  t >=  40.0f) {
  Serial.println("DEBUG: Safety timeout — disabling heating");
  playTone(BUZZER_PIN, 400, 80, 5, 80, false); // 5 beeps for timeout
  controlRelay(0);            // Turn off relay
  digitalWrite(LED_PIN, LOW); // Turn off status LED
  // Note: Do NOT clear CANHEAT here to allow future activation
  lastCmd = now;              // Reset lastCmd to prevent repeated triggering
}

  // ——— 6) Over-temp shutdown —————————————————————————
  if (cfg.maxTemp && t > cfg.maxTemp) {
    Serial.println("WARN: Over maxTemp, disabling heating and SSR OFF");
    controlRelay(0);
  }
  // ——— 7) PWM update (only when heating is allowed) —————————
  else if (CANHEAT && targetTemp > 0.0f) {
    updatePWM(t);
  }

  // ——— 8) SSR drive & debug prints —————————————————————
  // Always call handleSSR() so it can see CANHEAT toggles and reset its debug flags
  handleSSR(t);

  // ——— 9) Post the temperature to your queue —————————————
  xQueueOverwrite(tempQueue, &t);
}
