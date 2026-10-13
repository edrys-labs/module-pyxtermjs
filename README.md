# Edrys PyxTerm.js Module

This module runs a full terminal within [edrys-Lite](https://github.com/edrys-labs/edrys-Lite), an open remote teaching platform.
It is based on [pyxterm.js](https://github.com/cs01/pyxtermjs) by Chad Smith.

![screenshot](./pyxtermjs.gif)

## Usage

To use this URL to add the module to your class:

```bash
https://edrys-labs.github.io/module-pyxtermjs/index.html
```

additionally you will have to clone this project and start the [pyxterm.js](https://github.com/cs01/pyxtermjs) terminal server:

```bash
pip install -r requirements.txt
python3 -m pyxtermjs --cors True
```

To secure the usage, you can also start a docker-container, which is used as a secure environment or, as it is shown below, you can run and restrict the command-line access via [firejail](https://firejail.wordpress.com/documentation-2/basic-usage/).
The `--private-home` is not necessarily required, it simply copies my zsh configuration to the firejail home folder.

``` bash
python3 -m pyxtermjs --cors True --tmp True --command firejail --cmd-args='--noroot --private --quiet --cpu=1 --nice=19 --hostname=host --net=none --no3d --nosound --rlimit-cpu=1 --allow-debuggers --shell=/bin/zsh --private-home=/home/andre/.zshrc --private-home=/home/andre/.oh-my-zsh'
```

You may optionally specify any of the following station-only settings:

``` json
{ "server": "http://localhost:5000/pty"
, "execute": "execute"
, "script": "echo $CODE | base64 --decode"
, "enable": {
  "teacher": true,
  "student": true
  }
}
```

the `server` contains the default terminal-server, and via execute it is possible to define a subject on which this module will listen for code to be executed. The following view is only visible on station-mode.
Whenever another module sends some code/commands via the predefined "execute"-topic, the script on top will be executed, whereby `$CODE` will be substituted with the code passed from another module.
By default students and teachers cannot directly access the terminal, they will see only the output.
You will have to grant access via the checkboxes, which are only visible on the station.

![station-control](./pyxterm.png)


## API

```
> python3 -m pyxtermjs --help

usage: __main__.py [-h] [-p PORT] [--cors CORS] [--host HOST] [--debug] [--version] [--command COMMAND] [--cmd-args CMD_ARGS] [--tmp TMP] [--singleton SINGLETON]

A fully functional terminal in your browser. https://github.com/cs01/pyxterm.js

options:
  -h, --help            show this help message and exit
  -p PORT, --port PORT  port to run server on (default: 5000)
  --cors CORS           enable CORS by default this is disabled (default: False)
  --host HOST           host to run server on (use 0.0.0.0 to allow access from other hosts) (default: 127.0.0.1)
  --debug               debug the server (default: False)
  --version             print version and exit (default: False)
  --command COMMAND     Command to run in the terminal (default: bash)
  --cmd-args CMD_ARGS   arguments to pass to command (i.e. --cmd-args='arg1 arg2 --flag') (default: )
  --tmp TMP             use a temporary folder as base, which comes handy when using firejail (default: False)
  --singleton SINGLETON use a single terminal for all clients (default: False)
```

## Docker

To enable an even more secure usage, you can also start and or modify the included Dockerfile.

Build and run it via:

``` bash
$ docker-compose up
```

or directly load our prebuild image from dockerhub:

``` bash
$ docker run -it -p 127.0.0.1:5000:5000 --device=/dev/ttyACM0:/dev/ttyACM0 edryslabs/module-pyxtermjs:latest
```

Replace `/dev/ttyACM0` with your board's port if it differs - check with
`arduino-cli board list` or `ls /dev/ttyACM* /dev/ttyUSB*`. The board has to be
plugged in before you start the container, otherwise Docker refuses to start
because the device does not exist.

### Boards that upload over DFU

Some boards - such as the **Arduino Nano ESP32** - are not flashed over the
serial port but via DFU. For those, passing `--device` alone is not enough:
`dfu-util` opens the raw USB node through libusb, and every upload fails with

```
dfu-util: unable to initialize libusb: LIBUSB_ERROR_OTHER
```

Start the container with access to the USB devices as well:

``` bash
$ docker run -it -p 127.0.0.1:5000:5000 \
  --device=/dev/ttyACM0:/dev/ttyACM0 \
  -v /dev/bus/usb:/dev/bus/usb \
  --device-cgroup-rule='c 166:* rmw' \
  --device-cgroup-rule='c 189:* rmw' \
  edryslabs/module-pyxtermjs:latest
```

Mount the whole `/dev/bus/usb` tree rather than a single node - a DFU upload
makes the board re-enumerate, so its `/dev/bus/usb/<bus>/<dev>` path changes with
every upload. Note that this grants the container access to all USB devices on
the host.

### ESP32 devkits

Espressif ESP32 boards (the `arduino-esp32` workflow) need the `:esp32` tag -
Espressif's `esp32:esp32` core is too large to ship in `:latest`, and it is a
different core from the `arduino:esp32` one the Arduino Nano ESP32 uses.

These devkits also talk through a CH340/CP210x bridge, so they appear as
`/dev/ttyUSB0` rather than `/dev/ttyACM0`, and `ttyUSB*` has its own device
major number (188 instead of 166):

``` bash
$ docker run -it -p 127.0.0.1:5000:5000 \
  --device=/dev/ttyUSB0:/dev/ttyUSB0 \
  -v /dev/bus/usb:/dev/bus/usb \
  --device-cgroup-rule='c 188:* rmw' \
  --device-cgroup-rule='c 189:* rmw' \
  edryslabs/module-pyxtermjs:esp32
```

### Building your own image

If you need additional tools, compilers, or libraries, you can build your own
image on top of the published ones. Have a look at the included Docker- and
docker-compose files in [docker](./docker) as a starting point - for example
[docker/arduino](./docker/arduino) adds the arduino-cli toolchain, cores, and
libraries on top of the base image.

### For Windows Users

Windows does not natively support USB device passthrough to Docker containers. However, with WSL2 and the `usbipd-win` tool, we can achieve this functionality.

For this you can use the provided Windows starter script located in `docker/windows-starter/start-pyxtermjs.bat`.

**Requirements:**
- Windows 10/11 with WSL2 installed
- Docker Desktop for Windows with WSL2 backend enabled
- [usbipd-win](https://github.com/dorssel/usbipd-win) tool installed

**Usage:**

1. First, run the script without arguments to see available USB devices:
   ```cmd
   start-pyxtermjs.bat
   ```

2. Identify your device's BUSID from the list and run:
   ```cmd
   start-pyxtermjs.bat <BUSID>
   ```
   
   For example:
   ```cmd
   start-pyxtermjs.bat 5-1
   ```

The script will automatically:
- Bind the USB device (if not already bound)
- Detach any existing connection
- Attach the device to WSL
- Start the Docker container with USB device access
- Make the terminal available at `http://localhost:5000`

**Note:** The first time you bind a device, you may need to run the command prompt as Administrator.

#### Manual USB Device Attachment

If you prefer to run the commands manually instead of using the batch file:

1. **List available USB devices:**
   ```cmd
   usbipd list
   ```

2. **Bind the device (one-time setup):**
   ```cmd
   usbipd bind --busid <BUSID>
   ```

3. **Attach the device to WSL:**
   ```cmd
   usbipd attach --wsl --busid <BUSID>
   ```

4. **Start the Docker container:**
   ```cmd
   wsl -e bash -c "docker run -it -p 127.0.0.1:5000:5000 --device=/dev/ttyACM0:/dev/ttyACM0 edryslabs/module-pyxtermjs:latest"
   ```

5. **When finished, detach the device:**
   ```cmd
   usbipd detach --busid <BUSID>
   ```

Replace `<BUSID>` with your actual device's bus ID (e.g., `5-1`).

## Development

The module's source is in [src](./src) and is bundled with [Parcel](https://parceljs.org):

``` bash
npm install
npm run watch   # dev server on http://localhost:3002/index.html, add this URL to a class
npm run build   # production build in dist/
```

`dist/` is not committed. On every push to `master`, the [deploy workflow](./.github/workflows/deploy.yml)
builds it and publishes it to GitHub Pages
(GitHub Pages source: "GitHub Actions").

The terminal server serves a standalone terminal without Edrys at `http://localhost:5000/`
([docs/direct.html](./docs/direct.html)).

## Edrys - Classroom

You can try out the following classroom/lab configuration for sharing a terminal with your students:

`https://raw.githubusercontent.com/edrys-labs/module-pyxtermjs/master/laboratory.yaml`

see the configuration [here](./laboratory.yaml).
