#!/usr/bin/env python3
import argparse
from flask import Flask, render_template, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room
import pty
import os
import subprocess
import signal
import select
import termios
import struct
import fcntl
import shlex
import logging
import sys
import tempfile


logging.getLogger("werkzeug").setLevel(logging.ERROR)

__version__ = "0.5.0.0"

app = Flask(__name__, template_folder="../docs", static_folder=".", static_url_path="")
app.config["SECRET_KEY"] = "secret!"
app.config["fd"] = dict()
app.config["child_pid"] = dict()
app.config["tmp"] = dict()
app.config["singleton"] = False

socketio = SocketIO(app, cors_allowed_origins='*')


def set_winsize(fd, row, col, xpix=0, ypix=0):
    logging.debug("setting window size with termios")
    winsize = struct.pack("HHHH", row, col, xpix, ypix)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def read_and_forward_pty_output(id):
    max_read_bytes = 1024 * 20
    while True:
        socketio.sleep(0.01)
        if id in app.config["fd"]:
            timeout_sec = 0
            (data_ready, _, _) = select.select([app.config["fd"][id]], [], [], timeout_sec)
            if data_ready:
                output = os.read(app.config["fd"][id], max_read_bytes).decode(errors='ignore')
                socketio.emit("pty-output", {"output": output}, room=id, namespace="/pty")
        else:
            break


# A standalone terminal for trying the server without Edrys. The Edrys
# module itself is built from src/ and published to GitHub Pages.
@app.route("/")
@app.route("/dir")
def direct():
    return render_template("direct.html")


@socketio.on("pty-input", namespace="/pty")
def pty_input(data):
    """write to the child pty. The pty sees this as if you are typing in a real
    terminal.
    """
    id = "0" if app.config["singleton"] else request.sid
    if app.config["fd"][id]:
        logging.debug("received input from browser: %s" % data["input"])
        os.write(app.config["fd"][id], data["input"].encode())


@socketio.on("resize", namespace="/pty")
def resize(data):
    id = "0" if app.config["singleton"] else request.sid
    if app.config["fd"][id] and "rows" in data and "cols" in data:
        logging.debug(f"Resizing window to {data['rows']}x{data['cols']}")
        set_winsize(app.config["fd"][id], data["rows"], data["cols"])

@socketio.on("disconnect", namespace="/pty")
def disconnect():
    logging.info("client disconnected "+ request.sid)
    if not app.config["singleton"]:
        id = request.sid
        
        if id in app.config["child_pid"]:
            try:
                pid = app.config["child_pid"][id]
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
                del app.config["child_pid"][id]
                # Ensure the child process is reaped
            except ProcessLookupError:
                print("Process already terminated.")

        if id in app.config["tmp"]:
            del app.config["tmp"][id]
        
        if id in app.config["fd"]:
            del app.config["fd"][id]
            
def handle_sigterm(signum, frame):
    print("Child process: Received SIGTERM, exiting cleanly.")
    os._exit(0)

@socketio.on("connect", namespace="/pty")
def connect():
    """new client connected"""
    logging.info("new client connected " + request.sid)

    id = "0" if app.config["singleton"] else request.sid

    join_room(id, namespace='/pty')

    if app.config["child_pid"].get(id):
        # already started child process, don't start another
        return

    # create child process attached to a pty we can read from and write to
    (child_pid, fd) = pty.fork()
    if child_pid == 0:
        while True:
            if (app.config["useTmp"]):
                app.config["tmp"][id] = tempfile.mkdtemp()
                # this is the child process fork.
                # anything printed here will show up in the pty, including the output
                # of this subprocess
                subprocess.run(app.config["cmd"], cwd=app.config["tmp"][id])
            else:
                subprocess.run(app.config["cmd"])
    else:
        # this is the parent process fork.
        # store child fd and pid
        app.config["fd"][id] = fd
        app.config["child_pid"][id] = child_pid
        set_winsize(fd, 50, 50)
        cmd = " ".join(shlex.quote(c) for c in app.config["cmd"])
        # logging/print statements must go after this because... I have no idea why
        # but if they come before the background task never starts
        socketio.start_background_task(target=read_and_forward_pty_output, id=id)

        logging.info("child pid is " + child_pid)
        logging.info(
            f"starting background task with command `{cmd}` to continously read "
            "and forward pty output to client"
        )
        logging.info("task started")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "A fully functional terminal in your browser. "
            "https://github.com/cs01/pyxterm.js"
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("-p", "--port", default=5000, help="port to run server on")
    parser.add_argument("--cors", default=False, help="enable CORS by default this is disabled")

    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="host to run server on (use 0.0.0.0 to allow access from other hosts)",
    )
    parser.add_argument("--debug", action="store_true", help="debug the server")
    parser.add_argument("--version", action="store_true", help="print version and exit")
    parser.add_argument(
        "--command", default="bash", help="Command to run in the terminal"
    )
    parser.add_argument(
        "--cmd-args",
        default="",
        help="arguments to pass to command (i.e. --cmd-args='arg1 arg2 --flag')",
    )
    parser.add_argument(
        "--tmp",
        default="False",
        help="use a temporary folder as base, which comes handy when using firejail",
    )

    parser.add_argument(
        "--singleton",
        default="False",
        help="use a single terminal for all clients",
    )

    args = parser.parse_args()
    if args.version:
        print(__version__)
        exit(0)

    app.config["cmd"] = [args.command or os.environ.get(
        "PYXTERM_CMD")] + shlex.split(args.cmd_args or os.environ.get("PYXTERM_CMD_ARGS") or "")

    app.config["useTmp"] = args.tmp or os.environ.get("PYXTERM_USE_TMP")

    app.config["singleton"] = args.singleton == "True" or os.environ.get("PYXTERM_SINGLETON") == "True"

    if args.cors or os.environ.get("PYXTERM_CORS"):
        CORS(app)

    green = "\033[92m"
    end = "\033[0m"
    log_format = green + "pyxtermjs > " + end + "%(levelname)s (%(funcName)s:%(lineno)s) %(message)s"
    logging.basicConfig(
        format=log_format,
        stream=sys.stdout,
        level=logging.DEBUG if args.debug or os.environ.get("PYXTERM_DEBUG") else logging.INFO,
    )
    logging.info(f"serving on http://{args.host}:{args.port}")

    socketio.run(app,
                 debug=args.debug or os.environ.get("PYXTERM_DEBUG"),
                 port=args.port or os.environ.get("PYXTERM_PORT"),
                 host=args.host or os.environ.get("PYXTERM_HOST"))


if __name__ == "__main__":
    main()
