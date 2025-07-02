// pwm.cpp
#include "pwm.h"

// PWM settings (defined as const)
const uint8_t PWM_TIMER = 0;        // Timer 0 (ESP32 has 4 timers: 0–3)
const uint32_t PWM_FREQ = 5;        // 5 Hz (in 3–10 Hz range)
const uint16_t PWM_MAX_COUNT = 256; // Max-count of 256
const uint32_t PWM_PRESCALER = 80;  // Prescaler divides 80 MHz clock

// Static variables (shared within this file)
static volatile uint8_t pwmDuty = 0;    // Current PWM value (0–255)
static volatile uint16_t pwmCount = 0;  // Current timer count
static volatile bool outputState = false; // Output pin HIGH (true) or LOW (false)
static uint8_t pwmPin = 0;             // Output pin (set by pwmInit)
static hw_timer_t* timer = nullptr;    // Hardware timer
int pwmOutput = 0; // PID output for PWM duty cycle

// Interrupt handler for PWM
void IRAM_ATTR onPwmTimer() {
  pwmCount++;
  if (pwmCount >= PWM_MAX_COUNT) {
    pwmCount = 0; // Reset count
  }
  outputState = (pwmCount < pwmDuty); // Compare directly (max-count is 256)
  digitalWrite(pwmPin, outputState ? HIGH : LOW);
}

// Initialize PWM
void pwmInit(uint8_t pin) {
  pwmPin = pin;
  pinMode(pwmPin, OUTPUT);
  digitalWrite(pwmPin, LOW);

  // Set up timer
  timer = timerBegin(PWM_TIMER, PWM_PRESCALER, true); // Count-up
  timerAttachInterrupt(timer, &onPwmTimer, true);
  // Calculate ticks: 80 MHz ÷ prescaler ÷ maxCount ÷ freq
  uint32_t ticks = 80000000UL / PWM_PRESCALER / PWM_MAX_COUNT / PWM_FREQ;
  timerAlarmWrite(timer, ticks, true); // Auto-reload
  timerAlarmEnable(timer);
  Serial.printf("PWM initialized: pin=%u, freq=%u Hz, maxCount=%u, prescaler=%u, ticks=%u\n", 
                pwmPin, PWM_FREQ, PWM_MAX_COUNT, PWM_PRESCALER, ticks);
}

// Set PWM duty cycle (0–255)
void pwmSetDuty(uint8_t duty) {
  pwmDuty = duty;
  Serial.printf("PWM duty set to %u\n", pwmDuty);
}

// Get current PWM duty cycle
uint8_t pwmGetDuty() {
  return pwmDuty;
}

// Reset PWM to 0
void pwmReset() {
  pwmDuty = 0;
  digitalWrite(pwmPin, LOW);
  Serial.println("PWM reset to 0");
}

uint8_t getPWM() {
    return pwmGetDuty(); // Return PWM duty (0–255)
  }
  