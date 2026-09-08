# Espressif ESP32 image for the `arduino-esp32` workflow.
#
# Layered on :latest (the arduino image) so arduino-cli, the AVR toolchain and
# the libraries are inherited; this adds only the Espressif core.
#
# This core is NOT in :latest because it is large - esp32:esp32 3.x ships
# prebuilt libs and a toolchain per ESP32 variant, ~5.4 GB installed
# (esp-rv32 2.1 GB, esp32-arduino-libs 1.7 GB, esp-x32 1.1 GB). That is why
# the ESP32 boards get their own tag instead of growing :latest for everyone.
#
# Note this is Espressif's esp32:esp32 core, which is a different thing from
# Arduino's arduino:esp32 core in the parent image. The latter serves the
# Arduino Nano ESP32 (arduino:esp32:nano_nora, the arduino-nano-esp32
# workflow); it cannot build esp32:esp32:* FQBNs, and vice versa. Both are
# present here on purpose.
FROM edryslabs/module-pyxtermjs:latest

ARG user=appuser
USER ${user}

ENV ESP32_URL=https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json

RUN arduino-cli core update-index --additional-urls $ESP32_URL \
    && arduino-cli core install esp32:esp32 --additional-urls $ESP32_URL \
    && arduino-cli cache clean

USER ${user}
