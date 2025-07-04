

#include "helpers.h"
#include "heating/heating.h"
// In system_utils.cpp
#include <Arduino.h>
#include <esp_system.h>   // ESP.restart() or esp_restart()




#include <Preferences.h>
Preferences prefs;

void saveSetting(const char* key, const char* value) {
    prefs.begin("settings", false);
    prefs.putString(key, value);
    prefs.end();
}

void loadSettings(){

  prefs.begin("settings", true);
  String buzzer = prefs.getString("USE_BUZZER", "true");
  USE_BUZZER = (buzzer == "true");
  prefs.end();

}


float getTargetTemp() {
  return targetTemp;
}
void restartBoard() {
  Serial.println("Restarting board...");
  delay(100);          // give Serial a moment to flush
  esp_restart();       // reset the ESP32
}
void playTone(uint8_t buzzerPin, unsigned int frequency, unsigned long toneDuration, int count, unsigned long delayBetween, bool repeat) {
  if (!USE_BUZZER) {
    Serial.println("Buzzer is disabled, skipping tone.");
    return;
  }
    pinMode(buzzerPin, OUTPUT);
    do {
      for (int i = 0; i < count; i++) {
        tone(buzzerPin, frequency, toneDuration);
        delay(toneDuration);
        noTone(buzzerPin);
        if (i < count - 1) {
          delay(delayBetween);
        }
      }
    } while (repeat);
}

// ——— BLINK UTILITY ————————————————————————
void blink(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(ms);
    digitalWrite(LED_PIN, LOW);
    delay(ms);
  }
}

void fadeFlameLightOff() {
  const int ledChannel = 0;
  // Gradually decrease LED brightness
  for (int duty = 255; duty >= 0; duty -= 5) {
    ledcWrite(ledChannel, duty);
    delay(10);
  }
  // Keep LED off
  ledcWrite(ledChannel, 0);
}

void fadeFlameLightOn() {
  const int freq = 5000;
  const int ledChannel = 0;
  const int resolution = 8;
  pinMode(FLAME_LED_PIN, OUTPUT);
  ledcSetup(ledChannel, freq, resolution);
  ledcAttachPin(FLAME_LED_PIN, ledChannel);
  
  // Gradually increase LED brightness
  for (int duty = 0; duty <= 255; duty += 5) {
    ledcWrite(ledChannel, duty);
    delay(10);
  }
  // Keep LED fully on
  ledcWrite(ledChannel, 255);
}


// ——— STARTUP JINGLE ————————————————————————
// Plays a simple jingle on the buzzer at startup
// This is a fun way to indicate the device is ready
// It plays three tones sequentially: C5, E5, G5
void startupJingle() {
  if (!USE_BUZZER) {
    Serial.println("Buzzer is disabled, skipping startup jingle.");
    return;
  }
  if (!STARTUP_JINGLE) {
    Serial.println("Startup jingle is disabled, skipping.");
    return;
  }
  playTone(BUZZER_PIN, 523, 100, 1, 100, false);
  delay(300);
  playTone(BUZZER_PIN, 659, 100, 1, 100, false);
  delay(300);
  playTone(BUZZER_PIN, 783, 100, 1, 0, false);
}




