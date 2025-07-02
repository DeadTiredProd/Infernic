// pwm.h
#ifndef PWM_H
#define PWM_H

#include <Arduino.h>

// PWM settings (accessible but not modifiable)
extern const uint8_t PWM_TIMER;      // Timer 0
extern const uint32_t PWM_FREQ;      // 5 Hz
extern const uint16_t PWM_MAX_COUNT; // 256
extern const uint32_t PWM_PRESCALER; // 80
extern  int pwmOutput; // PID output for PWM duty cycle
uint8_t getPWM(); // Changed to uint8_t for consistency

// Initialize PWM with output pin
void pwmInit(uint8_t pin);
// Set PWM duty cycle (0–255)
void pwmSetDuty(uint8_t duty);
// Get current PWM duty cycle (0–255)
uint8_t pwmGetDuty();
// Reset PWM to 0 (output OFF)
void pwmReset();

#endif