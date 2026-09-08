// Built-in terminal workflows. One entry per toolchain - the board is a
// value ($BOARD), not a workflow of its own, since e.g. every arduino-cli
// board compiles and uploads with the identical command.
//
// Placeholders substituted at execution time:
//   $CODE  base64 of the student's code   $FILE  target filename
//   $BOARD board identifier (FQBN or MCU)
//   $PORT  serial port                    $BAUD  baud rate
export const WORKFLOWS = {
  'arduino-avr': {
    filename: 'Sketch.ino',
    board: 'arduino:avr:uno',
    boards: [
      'arduino:avr:uno',
      'arduino:avr:mega',
      'arduino:avr:nano',
      'arduino:megaavr:nona4809',
      'arduino:avr:leonardo',
      'arduino:avr:micro',
    ],
    port: '/dev/ttyACM0',
    baud: 9600,
    script: [
      'SKETCH=$(basename $FILE .ino)',
      'rm -rf $SKETCH && arduino-cli sketch new $SKETCH',
      'echo $CODE | base64 --decode > $SKETCH/$SKETCH.ino',
      'arduino-cli compile -b $BOARD $SKETCH &&',
      '  arduino-cli upload -b $BOARD -p $PORT $SKETCH &&',
      '  arduino-cli monitor -p $PORT -c baudrate=$BAUD',
    ].join('\n'),
  },

  'arduino-esp32': {
    filename: 'Sketch.ino',
    board: 'esp32:esp32:esp32',
    boards: ['esp32:esp32:esp32', 'esp32:esp32:esp32s3', 'esp32:esp32:esp32c3'],
    port: '/dev/ttyUSB0',
    baud: 115200,
    script: [
      '# needs the :esp32 image tag (the ESP32 core is not in :latest)',
      'SKETCH=$(basename $FILE .ino)',
      'rm -rf $SKETCH && arduino-cli sketch new $SKETCH',
      'echo $CODE | base64 --decode > $SKETCH/$SKETCH.ino',
      'arduino-cli compile -b $BOARD $SKETCH &&',
      '  arduino-cli upload -b $BOARD -p $PORT $SKETCH &&',
      '  arduino-cli monitor -p $PORT -c baudrate=$BAUD',
    ].join('\n'),
  },

  'arduino-nano-esp32': {
    filename: 'Sketch.ino',
    board: 'arduino:esp32:nano_nora',
    boards: ['arduino:esp32:nano_nora'],
    port: '/dev/ttyACM0',
    baud: 115200,
    script: [
      '# needs the arduino:esp32 core (Arduino Nano ESP32, not the Espressif core)',
      '# uses the default DFU upload: the board re-enumerates and runs the new',
      '# sketch on its own.',
      'SKETCH=$(basename $FILE .ino)',
      'rm -rf $SKETCH && arduino-cli sketch new $SKETCH',
      'echo $CODE | base64 --decode > $SKETCH/$SKETCH.ino',
      'arduino-cli compile -b $BOARD $SKETCH &&',
      '  arduino-cli upload -b $BOARD -p $PORT $SKETCH &&',
      '  arduino-cli monitor -p $PORT -c baudrate=$BAUD',
    ].join('\n'),
  },

  'arduino-stm32': {
    filename: 'Sketch.ino',
    board: 'NUCLEO_F401RE',
    boards: [
      'NUCLEO_F401RE',
      'NUCLEO_F103RB',
      'NUCLEO_L476RG',
      'NUCLEO_F429ZI',
    ],
    port: '/dev/ttyACM0',
    baud: 115200,
    script: [
      '# needs the STMicroelectronics:stm32 core. $BOARD is the bare board name;',
      '# the full FQBN is built below. The default MassStorage upload needs the',
      '# NODE_* volume, absent in the container, so flash via the on-board ST-LINK.',
      'case $BOARD in',
      '  NUCLEO_F429ZI|NUCLEO_F746ZG|NUCLEO_H743ZI2) FAMILY=Nucleo_144;;',
      '  *) FAMILY=Nucleo_64;;',
      'esac',
      'FQBN=STMicroelectronics:stm32:$FAMILY:pnum=$BOARD,upload_method=OpenOCDSTLink',
      'SKETCH=$(basename $FILE .ino)',
      'rm -rf $SKETCH && arduino-cli sketch new $SKETCH',
      'echo $CODE | base64 --decode > $SKETCH/$SKETCH.ino',
      'arduino-cli compile -b $FQBN $SKETCH &&',
      '  arduino-cli upload -b $FQBN -p $PORT $SKETCH &&',
      '  arduino-cli monitor -p $PORT -c baudrate=$BAUD',
    ].join('\n'),
  },

  'avr-gcc': {
    filename: 'main.c',
    board: 'avr128db48',
    boards: ['avr128db48', 'atmega328p', 'atmega2560', 'attiny85'],
    port: '/dev/ttyUSB0',
    baud: 9600,
    script: [
      'BASE=$(basename $FILE .c)',
      'echo $CODE | base64 --decode > $FILE',
      'avr-gcc -mmcu=$BOARD -Os -DF_CPU=20000000UL -o $BASE.elf $FILE &&',
      '  avr-objcopy -O ihex $BASE.elf $BASE.hex &&',
      '  avrdude -c serialupdi -P $PORT -p $BOARD -U flash:w:$BASE.hex:i &&',
      '  screen $PORT $BAUD',
    ].join('\n'),
  },

  micropython: {
    filename: 'main.py',
    board: '',
    boards: [],
    port: 'auto',
    baud: 115200,
    script: [
      'echo $CODE | base64 --decode > $FILE',
      'mpremote connect $PORT fs cp $FILE :$FILE &&',
      '  mpremote connect $PORT exec "',
      'import sys',
      "if 'main' in sys.modules:",
      "    del sys.modules['main']",
      'import main',
      '"',
    ].join('\n'),
  },

  native: {
    filename: 'main.py',
    board: '',
    boards: [],
    port: '',
    baud: 9600,
    script: ['echo $CODE | base64 --decode > $FILE', 'python3 $FILE'].join('\n'),
  },
}

export const DEFAULT_SERVER = 'http://localhost:5000/pty'
export const DEFAULT_SCRIPT = 'echo $CODE | base64 --decode'

// Resolution order: an explicit script always wins, then the selected
// workflow's template, then the historic default. All 14 existing labs
// set `script` and no `workflow`, so they keep their exact behaviour.
export function resolveScript(config) {
  if (config?.script) {
    return config.script
  }

  return WORKFLOWS[config?.workflow]?.script || DEFAULT_SCRIPT
}

// A field is taken from the config when set, otherwise from the workflow.
export function resolveField(config, name) {
  const value = config?.[name]

  if (value !== undefined && value !== null && value !== '') {
    return value
  }

  return WORKFLOWS[config?.workflow]?.[name] ?? ''
}
