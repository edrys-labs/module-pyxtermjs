#!/usr/bin/env python3
"""Plot serial data in the terminal.

Each line is one sample. Values are separated by commas, tabs or spaces, like the Arduino IDE
plotter: "temp:21.5,hum:40" gives two named series, "12 24" gives value1 and value2. A label
may carry a unit ("Voltage: 1.23 V"); text without a number is ignored.

--type radar reads the first value of a line as the angle (0-180 degrees) and the second as
the distance, keeps one distance per degree, and draws them around the sensor.
"""
import argparse
import collections
import math
import os
import re
import signal
import sys
import time

import plotext as plt
import serial

NUMBER = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
FIELD = re.compile(r"[,;\t]")
FPS = 10
COLORS = ["cyan+", "orange+", "magenta+", "green+", "yellow+", "red+"]


def parse_line(line):
    """Return the (name, value) pairs of one line, skipping the fields that hold no number."""
    pairs = []
    bare = 0
    for field in FIELD.split(line):
        if ":" in field:
            name, rest = field.split(":", 1)
            number = NUMBER.search(rest)
            if name.strip() and number:
                pairs.append((name.strip(), float(number.group())))
            continue
        for word in field.split():
            if NUMBER.fullmatch(word):
                bare += 1
                pairs.append((f"value{bare}", float(word)))
    return pairs


class LinePlot:
    """The last max_len samples of every series, against the sample number."""

    def __init__(self, max_len):
        self.max_len = max_len
        self.series = {}
        self.samples = 0

    def add(self, pairs):
        if not pairs:
            return False
        self.samples += 1
        for name, value in pairs:
            if name not in self.series:
                self.series[name] = collections.deque(maxlen=self.max_len)
            self.series[name].append((self.samples, value))
        return True

    def status(self):
        return f"{self.samples} samples"

    def draw(self, width, height):
        start = max(self.samples - self.max_len, 0)
        plt.xlim(start, max(start + self.max_len, 1))
        for i, (name, points) in enumerate(self.series.items()):
            points = [p for p in points if p[0] > start]
            if points:
                xs, ys = zip(*points)
                plt.plot(xs, ys, label=name, marker="fhd", color=COLORS[i % len(COLORS)])


class RadarPlot:
    """One distance per degree from 0 to 180; a new sweep overwrites the old one in place."""

    def __init__(self):
        self.distance = [None] * 181
        self.last = None

    def add(self, pairs):
        if len(pairs) < 2:
            return False
        angle, distance = round(pairs[0][1]), pairs[1][1]
        if not 0 <= angle <= 180 or not math.isfinite(distance):
            return False
        self.distance[angle] = distance
        self.last = (angle, distance)
        return True

    def status(self):
        if self.last is None:
            return "no scan yet"
        return f"last: {self.last[0]}° → {self.last[1]:g}"

    def draw(self, width, height):
        known = [(a, d) for a, d in enumerate(self.distance) if d is not None]
        reach = max([abs(d) for _, d in known] + [1e-9])
        step = nice_step(reach / 3)
        radius = step * math.ceil(reach / step)

        # A terminal cell is about twice as tall as wide: pick the ranges so circles stay round.
        span_y = radius * 1.08
        span_x = span_y * width / (2 * height)
        if span_x < 2 * span_y:
            span_x = 2 * span_y
            span_y = span_x * 2 * height / width
        plt.xlim(-span_x / 2, span_x / 2)
        plt.ylim(0, span_y)

        rings = [step * i for i in range(1, round(radius / step) + 1)]
        plt.xticks([-r for r in reversed(rings)] + [0] + rings,
                   [f"{r:g}" for r in reversed(rings)] + ["0"] + [f"{r:g}" for r in rings])
        plt.yticks(rings, [f"{r:g}" for r in rings])
        half = [math.radians(a) for a in range(0, 181, 2)]
        for r in rings:
            plt.plot([r * math.cos(t) for t in half], [r * math.sin(t) for t in half],
                     marker="braille", color="gray")
        for a in range(0, 181, 30):
            t = math.radians(a)
            plt.plot([0, radius * math.cos(t)], [0, radius * math.sin(t)],
                     marker="braille", color="gray")
            plt.text(f"{a}°", radius * 1.04 * math.cos(t), radius * 1.04 * math.sin(t),
                     color="gray", alignment="center")

        if known:
            xs = [d * math.cos(math.radians(a)) for a, d in known]
            ys = [d * math.sin(math.radians(a)) for a, d in known]
            plt.scatter(xs, ys, marker="fhd", color="green+")
        if self.last is not None:
            t = math.radians(self.last[0])
            plt.plot([0, radius * math.cos(t)], [0, radius * math.sin(t)],
                     marker="braille", color="red")


def nice_step(value):
    """The smallest 1, 2 or 5 times a power of ten that is >= value."""
    power = 10 ** math.floor(math.log10(value))
    return next(power * m for m in (1, 2, 5, 10) if power * m >= value)


def open_port(port, baud, wait):
    """Open the port, retrying while it comes back after an upload or a reset."""
    deadline = time.monotonic() + wait
    while True:
        try:
            return serial.Serial(port, baud, timeout=1 / FPS)
        except serial.SerialException as error:
            if time.monotonic() >= deadline:
                sys.exit(f"serial-plotter: cannot open {port}: {error}")
            time.sleep(0.25)


def render(plot, title, size):
    cols, rows = size
    width, height = max(cols, 20), max(rows - 1, 8)
    plt.clf()
    plt.theme("dark")
    plt.plotsize(width, height)
    plt.title(f"{title} · {plot.status()} · Ctrl+C to quit")
    plot.draw(width, height)
    frame = plt.build().replace("\n", "\x1b[K\n")
    sys.stdout.write("\x1b[H" + frame + "\x1b[K\x1b[J")
    sys.stdout.flush()


def monitor(port, baud, plot, wait):
    ser = open_port(port, baud, wait)
    title = f"{port} ({baud} baud)"
    buffer = b""
    drawn_at, dirty, size = 0.0, True, None
    sys.stdout.write("\x1b[?25l\x1b[2J")
    while True:
        try:
            buffer += ser.read(ser.in_waiting or 1)
        except serial.SerialException:
            ser.close()
            ser = open_port(port, baud, wait)
            continue
        *lines, buffer = buffer.split(b"\n")
        for line in lines:
            dirty |= plot.add(parse_line(line.decode("utf-8", "replace")))
        buffer = buffer[-4096:]

        now = time.monotonic()
        current = os.get_terminal_size() if sys.stdout.isatty() else (100, 30)
        if (dirty and now - drawn_at >= 1 / FPS) or current != size:
            render(plot, title, current)
            drawn_at, dirty, size = now, False, current


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-p", "--port", default="/dev/ttyACM0", help="serial port (default: %(default)s)")
    parser.add_argument("-b", "--baud", type=int, default=9600, help="baud rate (default: %(default)s)")
    parser.add_argument("-t", "--type", choices=["line", "radar"], default="line",
                        help="line: values against the sample number; radar: angle and distance "
                             "(default: %(default)s)")
    parser.add_argument("-m", "--max-len", type=int, default=250,
                        help="samples kept per series in the line plot (default: %(default)s)")
    parser.add_argument("-w", "--wait", type=float, default=10,
                        help="seconds to keep retrying while the port is missing (default: %(default)s)")
    args = parser.parse_args()

    plot = RadarPlot() if args.type == "radar" else LinePlot(args.max_len)
    signal.signal(signal.SIGINT, signal.default_int_handler)  # also when started with SIGINT ignored
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        monitor(args.port, args.baud, plot, args.wait)
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\x1b[?25h\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
