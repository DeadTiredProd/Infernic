#include <WiFiUdp.h>  // Added UDP support
#include <WebServer.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include <ArduinoOTA.h>

extern String state;
void connectWiFi();
void startESPServer();
void handleESPServer();

// Two‑arg version (TCP or Serial):
void handleLine(const char* ln, WiFiClient* client);

// One‑arg version (Serial only or HTTP):
void handleLine(const char* ln);

//Setup function for OTA updates
void OtaSetup();