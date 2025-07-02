# Infernic
Infernic_Firmware
![machine_image](https://github.com/user-attachments/assets/b3163748-d6a7-42bf-ac57-e4a549a5c4b1),![UI_Overview_0](https://github.com/user-attachments/assets/e27dff51-dc92-4ef9-83ca-542a02f88137)


Infernic is firmware that powers a custom machine designed to control a Positive Temperature Coefficient (PTC) heater for soldering, with a plate temperature up to 300°C. The firmware runs on both an ESP32 38-pin Dev Module and a Raspberry Pi 5 (8GB) host. It enables precise heater control via a solid-state relay (SSR), using PID control to regulate temperature by transitioning from bang-bang control to PWM for fine-tuned accuracy. Commands are sent from the Raspberry Pi to the ESP32 through a web-based interface accessible from any device on the home network. The firmware monitors the plate temperature, interior machine humidity, PWM, duty cycle percentage, lid temperature, and power consumption in watts. Most non-electronic components, such as enclosures and mounts, are 3D-printed for cost efficiency and customization.

