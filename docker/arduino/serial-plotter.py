#!/usr/bin/env python3
import argparse
import serial
import plotext as plt
import time
import sys
import os
import signal


def get_terminal_size():
    """Get current terminal dimensions."""
    try:
        size = os.get_terminal_size()
        return size.lines, size.columns
    except (OSError, ValueError):
        return 24, 80


def render_plot(sensor_data, port, baud, max_len, rows, cols):
    """Render plot to fit terminal dimensions."""
    plot_height = max(rows - 7, 3)  # Overhead for title, axes, legend
    plot_width = max(cols - 2, 10)
    
    plt.clear_data()
    plt.plotsize(plot_width, plot_height)
    plt.title(f"Serial Plotter: {port} ({baud} baud)")
    plt.xlim(0, max_len)
    for key, values in sensor_data.items():
        plt.plot(values, label=key)
    plt.show()


def monitor(port, baud, max_len):
    """Monitor serial port and plot data."""
    sensor_data = {}
    ser = serial.Serial(port, baud)

    def signal_handler(sig, frame):
        """Handle Ctrl+C gracefully."""
        print("\n\nClosing serial plotter...")
        ser.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    
    # Clear screen and reset cursor at start
    sys.stdout.write('\x1b[2J\x1b[H')
    sys.stdout.flush()

    update_counter = 0
    update_interval = 50
    last_update = time.time()
    min_update = 0.1

    while True:
        data = ser.readline()
        if not data:
            continue
            
        try:
            decoded = data.decode('utf-8').strip()
        except:
            continue

        # Parse "key1:value1,key2:value2" format
        try:
            for pair in decoded.split(','):
                key, value = pair.split(':')
                if key not in sensor_data:
                    sensor_data[key] = []
                sensor_data[key].append(float(value))
                if len(sensor_data[key]) > max_len:
                    sensor_data[key].pop(0)
        except:
            pass

        update_counter += 1
        current_time = time.time()

        # Update plot at intervals
        if update_counter >= update_interval and (current_time - last_update) >= min_update:
            update_counter = 0
            last_update = current_time
            
            rows, cols = get_terminal_size()
            sys.stdout.write('\x1b[H')  # Move cursor to top
            sys.stdout.flush()
            render_plot(sensor_data, port, baud, max_len, rows, cols)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Plot serial data in format 'key1:value1,key2:value2'",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("-p", "--port", default="/dev/ttyACM0", help="Serial port")
    parser.add_argument("-b", "--baud", type=int, default=9600, help="Baud rate")
    parser.add_argument("-m", "--max-len", type=int, default=250, help="Max data points")
    args = parser.parse_args()
    monitor(args.port, args.baud, args.max_len)