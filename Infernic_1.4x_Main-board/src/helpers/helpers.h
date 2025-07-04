#pragma once
#ifndef HELPERS_H
#define HELPERS_H
#include "config/configuration.h"


void loadSettings();
void saveSetting(const char* key, const char* value);
void blink(int times, int ms);
void playTone(uint8_t buzzerPin, unsigned int frequency, unsigned long toneDuration, int count, unsigned long delayBetween, bool repeat);
void fadeFlameLightOff();
void fadeFlameLightOn();
void startupJingle();
void restartBoard();
float getTargetTemp();    // forward declaration
#endif // HELPERS_H