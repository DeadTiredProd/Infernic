
#ifndef SAFEGUARD_H
#define SAFEGUARD_H
#pragma once
#include "config/configuration.h"
#include "helpers/helpers.h"



//PROTOTYPES
void emergencyShutdown();
void sendFaultAlert();
void checkTemperature(float t);


#endif // SAFEGUARD_H