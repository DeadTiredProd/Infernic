#include "Wifi.h"
#include "config/configuration.h"
#include "helpers/helpers.h"
#include "heating/pwm.h"
bool piConnected = false;
String state = "Idle"; //Default state , state can be "Idle", "Heating", "Cooling", "Moving, Homing,Position Unknown", etc.
WiFiServer ESPServer(23);  // like telnet or serial port over TCP

void startESPServer() {
    ESPServer.begin();
    ESPServer.setNoDelay(true); // Disable Nagle's algorithm for low latency
    Serial.println("ESPServer started on port 23");
}
// ——— WIFI CONNECT —————————————————————————
void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    Serial.print("Connecting to Wi-Fi ");
    Serial.print(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
      delay(500);
      Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println(" OK");
      Serial.print("IP: ");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println(" FAILED");
    }
  
  
  }
  

  void initiatePiConnection() {
    if (piConnected) {
      Serial.println("Already connected to host.");
      return;
    }
    else
    {
  
      if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
        if (WiFi.status() != WL_CONNECTED) {
          Serial.println("Failed to connect to WiFi.");
          // Play a harsh error tone: 5 rapid low-pitched scratchy beeps
          playTone(BUZZER_PIN, 400, 80, 5, 80, false); // 5 beeps for connection failure
          emergencyShutdown(); // Trigger emergency shutdown
          return;
        }
      }
      WiFiClient client;
      if (!client.connect(HOST_IP, HOST_PORT)) {
        Serial.println("initiatePiConnection: Host connection failed.");
        emergencyShutdown(); // Trigger emergency shutdown
        playTone(BUZZER_PIN, 400, 80, 10, 80, false); // 10 beeps for connection failure
        return;
      }
      piConnected = true;
      Serial.println("Pi successfully connected to device.");
      client.stop();
    }
  }

// ——— NETWORK POSTER TASK ————————————————————
void posterTask(void *pvParameters) {
  HTTPClient http;
  float t;
  TickType_t lastPostTick = xTaskGetTickCount();
  const TickType_t postInterval = pdMS_TO_TICKS(1000); // 1s

  for (;;) {
    // Wait up to 100ms for a new temperature sample
    if (xQueueReceive(tempQueue, &t, pdMS_TO_TICKS(100)) == pdTRUE) {
      TickType_t now = xTaskGetTickCount();

      if ((now - lastPostTick) >= postInterval) {
        lastPostTick = now;

        if (WiFi.status() != WL_CONNECTED) {
          connectWiFi(); // Assume defined elsewhere
        }

        if (WiFi.status() == WL_CONNECTED) {
          // Post plate temp
          http.begin(TEMP_URL);
          http.addHeader("Content-Type", "application/json");
          String tempPayload = String("{\"plate_temp\":") + t + "}";
          int httpCode = http.POST(tempPayload);
          if (httpCode != HTTP_CODE_OK && httpCode != HTTP_CODE_NO_CONTENT) {
            Serial.printf("[Poster] TEMP POST failed, code: %d\n", httpCode);
          }
          http.end();

          // Post target temp
          http.begin(TARGET_URL);
          http.addHeader("Content-Type", "application/json");
          String targetPayload = String("{\"target_temp\":") + targetTemp + "}";
          httpCode = http.POST(targetPayload);
          if (httpCode != HTTP_CODE_OK && httpCode != HTTP_CODE_NO_CONTENT) {
            Serial.printf("[Poster] TARGET POST failed, code: %d\n", httpCode);
          }
          http.end();
          

          // Post PWM
          http.begin(PWM_URL);
          http.addHeader("Content-Type", "application/json");
          String pwmPayload = String("{\"pwm\":") + pwmOutput + "}";
          httpCode = http.POST(pwmPayload);
          if (httpCode != HTTP_CODE_OK && httpCode != HTTP_CODE_NO_CONTENT) {
            Serial.printf("[Poster] PWM POST failed, code: %d\n", httpCode);
          }
          http.end();

          // Post lid temp
          http.begin(LID_URL);
          http.addHeader("Content-Type", "application/json");
          String lidPayload = String("{\"lid_temp\":") + ReadAHT10().temperature + "}";
          httpCode = http.POST(lidPayload);
          if (httpCode != HTTP_CODE_OK && httpCode != HTTP_CODE_NO_CONTENT) {
            Serial.printf("[Poster] LID POST failed, code: %d\n", httpCode);
          }
          http.end();

          // Post humidity
          http.begin(HUMIDITY_URL);
          http.addHeader("Content-Type", "application/json");
          String humidityPayload = String("{\"humidity\":") + ReadAHT10().humidity + "}";
          httpCode = http.POST(humidityPayload);
          if (httpCode != HTTP_CODE_OK && httpCode != HTTP_CODE_NO_CONTENT) {
            Serial.printf("[Poster] HUMIDITY POST failed, code: %d\n", httpCode);
          }
          http.end();
          
          // Post machine status
          http.begin(STATE_URL); // Assuming STATE_URL is defined, e.g., "http://localhost:5000/api/set_state"
          http.addHeader("Content-Type", "application/json");
          String statePayload = String("{\"state\":\"") + state + "\"}";
          httpCode = http.POST(statePayload);
          if (httpCode != HTTP_CODE_OK && httpCode != HTTP_CODE_NO_CONTENT) {
              Serial.printf("[Poster] STATE POST failed, code: %d\n", httpCode);
          }
          http.end();
        }
      }
    }
    // Loop continues even if no temp sample arrives
  }
}




float savedZPosition = 0.0f;

/*
  Gcode    Usage                              Description
  --------------------------------------------------------------------------------
  M001     M001                              Run PID calibration autotune at 200°C for 6 cycles
  M110     M110 P<name>                      Set the machine’s name to <name> (max 31 characters)
  M111     M111 S<temp>                      Set maximum safety temperature (°C)
  M112     M112 S<temp>                      Set minimum safety temperature (°C)
  M113     M113 S<temp>                      Set target temperature (°C)
  M114     M114 S<kp>                        Set PID proportional gain (kp)
  M116     M116 S<ki>                        Set PID integral gain (ki)
  M117     M117 S<kd>                        Set PID derivative gain (kd)
  M118     M118                              Return current PID values (kp, ki, kd)
  M115     M115                              Display help listing of all supported commands
  G003     G003                              Emergency shutdown (relay off, flame light fade, restart)
  G004     G004                              Soft restart of firmware (no power cycle)
  G010     G010                              Start the active job
  G011     G011                              End the active job, turn heater off
  G020     G020                              Connect to host Raspberry Pi
  G021     G021                              Disconnect from host Raspberry Pi
  G100     G100
  T001     T001 F<frequency> D<toneDuration> C<count> B<delayBetween> R<repeat>
  Z0       Z0 S<pos>                         Move Z-axis to specified position (mm)
  Z1       Z1                                Save current Z-axis position
  Z2       Z2                                Return Z-axis to saved position
  Z3       Z3 S<positions> D<delays> L<loops> T<time>  Move Z-axis between comma-separated positions (mm)
  Z4       Z4                                Pause active job, move Z-axis away from work area
  Z5       Z5                                Unpause job, return Z-axis to pre-pause position
  Z28      Z28                               Home Z-axis to reference position
*/

void handleLine(const char *ln, WiFiClient *client) {
  auto sendResponse = [&](const char* msg) {
    if (client && client->connected()) client->println(msg);
    else Serial.println(msg);
  };

  // ——— M‑Codes for setting parameters ———

  // M110 P<name> : Set machine name
  if (strncmp(ln, "M110", 4) == 0) {
    char name[32];
    if (sscanf(ln + 4, " P%31s", name) == 1) {
      strncpy(cfg.name, name, sizeof(cfg.name)-1);
      cfg.name[sizeof(cfg.name)-1] = '\0';
      sendResponse("ACK: machine_name");
    } else {
      sendResponse("ERR: M110 syntax");
    }

  // M111 S<temp> : Set upper safety limit (max_temp)
  } else if (strncmp(ln, "M111", 4) == 0) {
    float v;
    if (sscanf(ln + 4, " S%f", &v) == 1) {
      cfg.maxTemp = v;
      char buf[64]; snprintf(buf, 64, "ACK: max_temp=%.2f°C", v);
      sendResponse(buf);
    } else {
      sendResponse("ERR: M111 syntax");
    }

  // M112 S<temp> : Set lower safety limit (min_temp)
  } else if (strncmp(ln, "M112", 4) == 0) {
    float v;
    if (sscanf(ln + 4, " S%f", &v) == 1) {
      cfg.minTemp = v;
      char buf[64]; snprintf(buf, 64, "ACK: min_temp=%.2f°C", v);
      sendResponse(buf);
    } else {
      sendResponse("ERR: M112 syntax");
    }

  // M113 S<temp> : Set target temperature (temp)
  } else if (strncmp(ln, "M113", 4) == 0) {
    float v;
    if (sscanf(ln + 4, " S%f", &v) == 1) {
      setTargetTemp(v);
      char buf[64]; snprintf(buf, 64, "ACK: temp=%.2f°C", v);
      sendResponse(buf);
    } else {
      sendResponse("ERR: M113 syntax");
    }

  // M114 S<kp> : Set kp value for PID
  } else if (strncmp(ln, "M114", 4) == 0) {
    float v;
    if (sscanf(ln + 4, " S%f", &v) == 1) {
      setkp(v);
      char buf[64]; snprintf(buf, 64, "ACK: kp=%.2f", v);
      sendResponse(buf);
    } else {
      sendResponse("ERR: M114 syntax");
    }

  // M116 S<ki> : Set ki value for PID
  } else if (strncmp(ln, "M116", 4) == 0) {
    float v;
    if (sscanf(ln + 4, " S%f", &v) == 1) {
      setki(v);
      char buf[64]; snprintf(buf, 64, "ACK: ki=%.2f", v);
      sendResponse(buf);
    } else {
      sendResponse("ERR: M116 syntax");
    }

  // M117 S<kd> : Set kd value for PID
  } else if (strncmp(ln, "M117", 4) == 0) {
    float v;
    if (sscanf(ln + 4, " S%f", &v) == 1) {
      setkd(v);
      char buf[64]; snprintf(buf, 64, "ACK: kd=%.2f", v);
      sendResponse(buf);
    } else {
      sendResponse("ERR: M117 syntax");
    }
  // M118 : Return current kp, ki, kd values
  } else if (strcmp(ln, "M118") == 0) {
    char buf[64]; snprintf(buf, 64, "PID_VALUES kp=%.2f ki=%.2f kd=%.2f", kp, ki, kd);
    sendResponse(buf);

  // M001 : Run PID calibration
  } else if (strcmp(ln, "M001") == 0) {
    sendResponse("ACK: PID_CALIBRATE");
    runPIDAutotune(200.0f, 6, 5000, 2.0f);
    sendResponse("ACK: PID_CALIBRATE_DONE");
  // T001 F<frequency> D<toneDuration> C<count> B<delayBetween> R<repeat> : Play custom tone sequence
  }else if (strncmp(ln, "T001", 4) == 0) {
    unsigned int frequency;
    unsigned long toneDuration, delayBetween;
    int count;
    int repeat;
    if (sscanf(ln + 4, " F%u D%lu C%d B%lu R%d", &frequency, &toneDuration, &count, &delayBetween, &repeat) == 5) {
      if (frequency > 0 && toneDuration > 0 && count > 0 && delayBetween >= 0 && (repeat == 0 || repeat == 1)) {
        playTone(BUZZER_PIN, frequency, toneDuration, count, delayBetween, repeat == 1);
        char buf[64];
        snprintf(buf, 64, "ACK: tone_played F=%u D=%lu C=%d B=%lu R=%d", frequency, toneDuration, count, delayBetween, repeat);
        sendResponse(buf);
      } else {
        sendResponse("ERR: T001 invalid parameters");
      }
    } else {
      sendResponse("ERR: T001 syntax");
    }
  // M115 : Display help listing
  } else if (strcmp(ln, "HELP") == 0) {
    const char *help =
        "M001           : PID autotune\n"
        "M110 P<name>   : Set machine name\n"
        "M111 S<temp>   : Set max safety temp (°C)\n"
        "M112 S<temp>   : Set min safety temp (°C)\n"
        "M113 S<temp>   : Set target temp (°C)\n"
        "M114 S<kp>     : Set PID kp\n"
        "HELP           : This help listing\n"
        "M116 S<ki>     : Set PID ki\n"
        "M117 S<kd>     : Set PID kd\n"
        "M118           :Return current PID values (kp, ki, kd)\n"
        // Flash Commands
        "M119           : Save Settings to flash\n"
        "M120           : Load Settings from flash\n"
        "M121           : Reset Settings to defaults\n"

        "G003           : Emergency shutdown\n"
        "G004           : Firmware restart\n"
        "G010           : Start job\n"
        "G011           : End job (heater off)\n"
        "G020           : Pi connect\n"
        "G021           : Pi disconnect\n"
        "G100           : Get current target temp\n"
        "T001           : T001 F<frequency> D<toneDuration> C<count> B<delayBetween> R<repeat>\n"
        "                : Play custom tone sequence\n"
        "Z0 S<pos>      : Move Z axis to position\n"
        "Z1             : Save current Z axis position\n"
        "Z2             : Return Z axis to saved position\n"
        "Z3 S<pos> D<delays> L<loops> T<time> : Z axis sequence\n"
        "Z4             : Pause job, move Z axis away\n"
        "Z5             : Unpause job, return Z axis\n"
        "Z28            : Home Z axis\n";
    sendResponse(help);

  // ——— G‑Codes for actions ———

  // G010 : Start job
  } else if (strcmp(ln, "G010") == 0) {
    activeJob = true;
    sendResponse("ACK: start_job");

  // G011 : End job
  } else if (strcmp(ln, "G011") == 0) {
    activeJob = false;
    setTargetTemp(0.0f);
    sendResponse("ACK: end_job");

  // G020 : Connect to Pi
  } else if (strcmp(ln, "G020") == 0) {
    initiatePiConnection();
    sendResponse("ACK: pi_connect");

  // G021 : Disconnect from Pi
  } else if (strcmp(ln, "G021") == 0) {
    piConnected = false;
    sendResponse("ACK: pi_disconnect");

  // G003 : Shutdown (relay off + restart)
  } else if (strcmp(ln, "G003") == 0) {
    sendResponse("ACK: shutdown");
    fadeFlameLightOff();
    controlRelay(0);
    delay(1000);
    ESP.restart();

  // G004 : Restart firmware
  } else if (strcmp(ln, "G004") == 0) {
    sendResponse("ACK: restart");
    restartBoard();

  // G100 : Query current target temperature
  } else if (strcmp(ln, "G100") == 0) {
    float t = getTargetTemp();
    char buf[64]; snprintf(buf, 64, "TARGET_TEMP=%.2f", t);
    sendResponse(buf);

  // ——— Z‑Codes for Z-axis control ———
  
  // ——— Catch-all for unrecognized commands ———
  } else {
    sendResponse("ERR: parse");
  }

  // Common feedback
  blink(1, 100);
  digitalWrite(LED_PIN, HIGH);
}

// Helper function to parse comma-separated float list (e.g., "1.0,2.0,3.0")
int parseFloatList(const char* str, float* output, int maxSize) {
  int count = 0;
  char* copy = strdup(str);
  if (!copy) return 0;
  char* token = strtok(copy, ",");
  while (token && count < maxSize) {
    output[count++] = atof(token);
    token = strtok(NULL, ",");
  }
  free(copy);
  return count;
}

// Helper function to parse comma-separated integer list (e.g., "100,200,300")
int parseIntList(const char* str, int* output, int maxSize) {
  int count = 0;
  char* copy = strdup(str);
  if (!copy) return 0;
  char* token = strtok(copy, ",");
  while (token && count < maxSize) {
    output[count++] = atoi(token);
    token = strtok(NULL, ",");
  }
  free(copy);
  return count;
}
  
  // 1‑arg wrapper
  void handleLine(const char *ln) {
    handleLine(ln, nullptr);
  }
  

// ——— Handle ESP Server —————————————————————  
  
  
  void handleESPServer() {
    WiFiClient client = ESPServer.available();
    if (client && client.connected()) {
      static String buffer;
      while (client.available()) {
        char c = client.read();
        if (c == '\n') {
          buffer.trim();
          if (buffer.length() > 0) {
            handleLine(buffer.c_str(), &client);
          }
          buffer = "";
        } else {
          buffer += c;
        }
      }
    }
  }


  

// ——— HTTP POST /cmd handler ——————————————————
void cmdHandler() {
    String body = server.arg("plain");
    body.trim();
    if (body.length()) {
      handleLine(body.c_str(),nullptr);
      lastCmd = millis();
      server.send(204);
    } else {
      server.send(400, "text/plain", "Empty command");
    }
}



void OtaSetup(){
  const uint16_t otaPort = 3232;  // must match your setPort() below

  Serial.println("→ entering OtaSetup()");

  ArduinoOTA.setPort(otaPort);
  ArduinoOTA.setHostname("Infernic");

  ArduinoOTA
    .onStart([]() {
      Serial.println("OTA: Begin");
    })
    .onEnd([]() {
      Serial.println("\nOTA: End");
    })
    .onProgress([](unsigned int prog, unsigned int tot) {
      Serial.printf("OTA: %u%%\r", (prog * 100) / tot);
    })
    .onError([](ota_error_t err) {
      Serial.printf("OTA Error[%u]: ", err);
      if      (err == OTA_AUTH_ERROR)    Serial.println("Auth Failed");
      else if (err == OTA_BEGIN_ERROR)   Serial.println("Begin Failed");
      else if (err == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
      else if (err == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
      else if (err == OTA_END_ERROR)     Serial.println("End Failed");
    });

  ArduinoOTA.begin();
  Serial.println("→ ArduinoOTA.begin() returned");
  Serial.printf("→ OTA listening on port %u (host: %s.local)\n",
                otaPort, cfg.name);
}

