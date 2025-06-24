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

usage: __main__.py [-h] [-p PORT] [--cors CORS] [--host HOST] [--debug] [--version] [--command COMMAND] [--cmd-args CMD_ARGS] [--tmp TMP]

A fully functional terminal in your browser. https://github.com/cs01/pyxterm.js

optional arguments:
  -h, --help            show this help message and exit
  -p PORT, --port PORT  port to run server on (default: 5000)
  --cors CORS           enable CORS by default this is disabled (default: False)
  --host HOST           host to run server on (use 0.0.0.0 to allow access from other hosts) (default: 127.0.0.1)
  --debug               debug the server (default: False)
  --version             print version and exit (default: False)
  --command COMMAND     Command to run in the terminal (default: bash)
  --cmd-args CMD_ARGS   arguments to pass to command (i.e. --cmd-args='arg1 arg2 --flag') (default: )
  --tmp TMP             use a temporary folder as base, which comes handy when using firejail (default: False)
```

## Docker

To enable an even more secure usage, you can also start and or modify the included Dockerfile.

Build and run it via:

``` bash
$ docker-compose up
```

or directly load our prebuild image from dockerhub:

``` bash
$ docker run -it -p 5000:5000 edryslabs/edrys-pyxtermjs:latest
```

However, if you want to build more elaborate docker images, you can have a look at the included Docker- and docker-compose files in [docker](./docker).
Or, if you want to directly run them, simply use:

``` bash
$ docker run -it -p 5000:5000 edryslabs/module-pyxtermjs_development:latest
```

to start an entire development server with gcc, java, python, nodejs, etc. installed, or:

``` bash
$ docker run -it -p 5000:5000 \
  --device=/dev/ttyACM0:/dev/ttyACM0 \
  --device-cgroup-rule='c 166:* rmv' \
  --device-cgroup-rule='c 189:* rmv' \
  edryslabs/module-pyxtermjs_arduino:latest
```

to start a container with arduino support.

## Edrys - Classroom

You can try out the following classroom/lab configuration for sharing a terminal with your students:

`https://raw.githubusercontent.com/edrys-labs/module-pyxtermjs/master/laboratory.yaml`

see the configuration [here](./laboratory.yaml).
