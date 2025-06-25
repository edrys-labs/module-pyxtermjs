FROM edryslabs/module-pyxtermjs:base
#FROM pyxtermjs

#ensure we are root for software install
USER root

# This is required to install serial-plotter.py and other dependencies
RUN DEBIAN_FRONTEND=noninteractive pip3 install \
    plotext \
    pyserial \
    mpremote \
    platformio

COPY serial-plotter.py /usr/bin
RUN chmod +x /usr/bin/serial-plotter.py

# Update apt repositories before installing packages
RUN apt-get update

# install arduino-cli dependencies
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl \
    make \
    udev \
    usbutils

# prepare arduino-cli for container (install as root)
RUN cd / && curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh

ARG user=appuser

# add ${user} to dailout group for Arduino device access
RUN usermod -a -G dialout ${user}

# Switch to ${user} for arduino-cli setup
USER ${user}

RUN arduino-cli upgrade && arduino-cli core update-index

# install arduino-cli cores
RUN arduino-cli core install arduino:avr
#RUN arduino-cli core install arduino:esp32
#RUN arduino-cli core install arduino:mbed_edge
#RUN arduino-cli core install arduino:mbed_giga
#RUN arduino-cli core install arduino:mbed_nano
#RUN arduino-cli core install arduino:mbed_nicla
#RUN arduino-cli core install arduino:mbed_opta
#RUN arduino-cli core install arduino:mbed_portenta
#RUN arduino-cli core install arduino:mbed_rp2040
RUN arduino-cli core install arduino:megaavr
#RUN arduino-cli core install arduino:nrf52
#RUN arduino-cli core install arduino:renesas_portenta
#RUN arduino-cli core install arduino:sam
#RUN arduino-cli core install arduino:samd
#RUN arduino-cli core install arduino:renesas_uno

# install arduino-cli libraries
RUN arduino-cli lib install \
    "Adafruit Circuit Playground" \
    "Adafruit NeoPixel" \
    "Adafruit Unified Sensor" \
    "Adafruit ZeroTimer Library" \
    "ArduinoJson" \
    "DHT sensor library" \
    "FastLED" \
    "Firmata" \
    "LiquidCrystal" \
    "LiquidCrystal_PCF8574" \
    "NewPing" \
    "SD" \
    "Servo" \
    "Stepper" \
    "TFT" \
    "WiFi"


USER root
CMD mkdir -p /etc/udev/rules.d \
    && cd /home/${user}/.arduino15/packages/arduino/hardware/megaavr/1.8.8/scripts \
    #&& sed -i '/udevadm/d' create_dfu_udev_rule \
    && ./create_dfu_udev_rule


# ensure we are switched to user Switch to user we must not set group to make the configuration done above apply
# !! if ${user} is not setup correctly the next line might result in group being root !!
USER ${user}