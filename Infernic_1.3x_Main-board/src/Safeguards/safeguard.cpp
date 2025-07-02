#include "safeguard.h"
#include "WIFI/Wifi.h"
void emergencyShutdown() {
    faulted = true;
    digitalWrite(Relay_2_PIN, HIGH); // Turn off Relay 2 Active Low
    digitalWrite(SSR_PIN, LOW);
    digitalWrite(LED_PIN, LOW);
    Serial.println("EMERGENCY SHUTDOWN: SSR OFF, LED OFF");
    playTone(BUZZER_PIN, 400, 1000, 1, 0, false); // Long tone to indicate emergency
  }

void sendFaultAlert() {
    if (WiFi.status() != WL_CONNECTED) {
      connectWiFi();               // your existing reconnect logic
      if (WiFi.status() != WL_CONNECTED) return;
    }
    // Play a harsh error tone: 3 rapid low-pitched scratchy beeps
    playTone(BUZZER_PIN, 400, 80, 3, 80, false);
    
    WiFiClient client;
    if (!client.connect(HOST_IP, HOST_PORT)) {
      Serial.println("sendFaultAlert: connect failed");
      return;
    }
  
    // Build & send a minimal valid HTTP/1.1 POST with no body:
    client.print(String("POST ") + FAULT_ENDPOINT + " HTTP/1.1\r\n");
    client.print(String("Host: ") + HOST_IP + ":" + HOST_PORT + "\r\n");
    client.print("Connection: close\r\n");
    client.print("Content-Length: 0\r\n");
    client.print("\r\n");
  
    // Optionally read the response status line:
    String line = client.readStringUntil('\n');
    Serial.println("sendFaultAlert response: " + line);
  
    client.stop();
  }

  