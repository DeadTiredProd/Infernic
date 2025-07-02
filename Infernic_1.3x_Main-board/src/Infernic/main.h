// main.h
#ifndef MAIN_H
#define MAIN_H
#pragma once
#include "config/configuration.h"
// ——— PROTOTYPES ———
void handleLine(const char *ln);
void posterTask(void *pvParameters);
void cmdHandler();
#endif // MAIN_H
