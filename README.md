# Infernic Firmware

![machine_image](https://github.com/user-attachments/assets/b3163748-d6a7-42bf-ac57-e4a549a5c4b1)

# Infernic is the custom firmware behind a purpose-built machine for controlling a Positive Temperature Coefficient (PTC) heater, designed for soldering tasks with a maximum plate temperature of 300 °C. It runs on an ESP32 38-pin Dev Module, coordinated by a Raspberry Pi 5 (8GB) acting as the host.

The firmware implements PID-based heater control, starting with basic bang-bang logic and transitioning to PWM for fine-tuned precision. The heating element is regulated through a solid-state relay (SSR). The Raspberry Pi communicates with the ESP32 via a web-based interface, accessible from any device on the same network.

📡 Features and Monitoring
The firmware provides real-time data reporting, including:

Plate temperature

Lid temperature

Internal humidity

PWM and duty cycle percentage

Power consumption in watts

Average wattage over time

Most non-electronic components — such as the outer enclosure and mounts — are 3D-printed for cost-efficiency and easy customization.


![FlowChart_V1 3x](https://github.com/user-attachments/assets/415bfda5-ac8e-42dd-b127-61244782f7c8)



![UI_Overview_0](https://github.com/user-attachments/assets/e27dff51-dc92-4ef9-83ca-542a02f88137)
🖥️ Web UI Overview
The user interface offers a real-time temperature graph and system dashboard that includes:

Plate and lid temperature readings

Duty cycle and PWM output

Humidity tracking

Average power usage

This gives a clear view of the system’s performance for both short- and long-term monitoring.

![Graph_0](https://github.com/user-attachments/assets/2a2af5fd-e34a-47b4-8e9b-3e688015c1dc)

🖼️ Visual Board Detection
As of July 2nd, 2025, the system includes a bitmap-based visual processing module. Images are converted to black and white for lightweight detection tasks. This feature is currently used to visually detect when a board has been placed on the heating plate — primarily for monitoring and logging purposes, not for active control.
![image](https://github.com/user-attachments/assets/7553fddc-2176-4e5e-a4dc-e63f74dac3bf)
