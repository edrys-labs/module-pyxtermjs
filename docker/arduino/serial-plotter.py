#!/usr/bin/env python3
import argparse
import serial
import plotext as plt

def monitor(PORT, BAUD, MAX_LEN):
    sensor_data = {}
    plt.title("Serial Plotter: " + PORT + " (" + str(BAUD) + " baud)")
    plt.xlim(0, MAX_LEN)
    ser = serial.Serial(PORT, BAUD)
    
    while True:
        data = ser.readline()
        if data:
            try:
                decoded_str = data.decode('utf-8')
            except:
                continue
                
            pairs = decoded_str.strip().split(',')
            try:
                for pair in pairs:
                    key, value = pair.split(':')
                    if (sensor_data.get(key) == None):
                        sensor_data[key] = []
                    sensor_data[key].append(float(value))
                    if (len(sensor_data[key]) > MAX_LEN):
                        sensor_data[key].pop(0)
            except:
                pass
                
            plt.clear_terminal()
            plt.clear_data()
            for key in sensor_data.keys():
                plt.plot(sensor_data[key], label=key)
            plt.show()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "A plotter for serial data, where one line represents a data set 'Data1:1.1,data2:22.12' "
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("-p", "--port", default="/dev/ttyACM0", help="Serial port to listen")
    parser.add_argument("-b", "--baud", default="9600", help="Baud")
    parser.add_argument("-m", "--max-len", default="250", help="Max length of data to plot")
    args = parser.parse_args()
    monitor(args.port, int(args.baud), int(args.max_len))