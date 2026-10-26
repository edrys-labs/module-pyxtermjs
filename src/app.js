import './styles.css'

// the build with the template compiler: the template is the HTML in #app
import { createApp } from 'vue/dist/vue.esm-browser.prod.js'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'

import {
  DEFAULT_SCRIPT,
  DEFAULT_SERVER,
  resolveField,
  resolveScript,
} from './workflows.js'

import { fillScript, parseUpload } from './execute.js'

import {
  createTerminal,
  debounce,
  registerClearHandler,
  throttle,
} from './terminal.js'

var terminal = null
var fit = null
var socket = null
var serialize = null

// rows of scrollback the station replays to a peer that joins
const JOIN_SCROLLBACK = 500

var messageHandlersRegistered = false
// station: the unreachable server was reported in the terminal
var unreachableNoticed = false
// student: the station's checkboxes as it last announced them, null until then
var stationEnable = null
// student: the typing hint was shown since typing was last allowed
var typingNoticed = false
// student: the station's terminal size, null until it announces one
var stationSize = null

const STATION_OFFLINE = 'The station is not connected to its terminal server.'

// The message subjects. All but `join` carry the station's `execute` setting,
// so several terminals can share a room.
function subjects() {
  const execute = window.Edrys?.module?.stationConfig?.execute || 'execute'
  return {
    execute,
    output: 'pty-output_' + execute,
    screen: 'pty-screen_' + execute,
    connect: 'connect_' + execute,
    input: (role) => 'input_' + role + '_' + execute,
  }
}

// Send to the room, or to one peer. Opened outside Edrys, with edrys.js not
// loaded, there is no one to send to.
function send(subject, body, to) {
  if (window.Edrys) Edrys.sendMessage(subject, body, to)
}

// A line from the module itself, not from the shell.
function notice(text) {
  if (terminal) terminal.write('\r\n\x1b[33m' + text + '\x1b[0m\r\n')
}

// The station owns the pty size: it fits its own frame and sends the size to
// the server (and, see announce(), to the room). A student keeps the
// station's size, or fits its frame while it does not know it (older
// stations). Returns true when the size changed.
function fitToScreen() {
  if (!fit || !terminal || stationSize) return false
  const { cols, rows } = terminal
  fit.fit()
  if (socket) socket.emit('resize', { cols: terminal.cols, rows: terminal.rows })
  return terminal.cols !== cols || terminal.rows !== rows
}

// Student: show the station's screen at the station's width; scroll if the
// frame is narrower. A taller frame gets more rows, the extra ones hold
// scrollback - except in the alternate buffer (vim, less, man), where the
// program positions and scrolls by the station's rows. Sizes from a peer
// are capped.
function applyStationSize(size) {
  const cols = Math.min(Number(size?.cols), 500)
  const rows = Math.min(Number(size?.rows), 200)
  if (!terminal || !(Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0)) return
  stationSize = { cols, rows }
  fitStationSize()
}

function fitStationSize() {
  if (!terminal || !stationSize) return
  const { cols, rows } = stationSize
  const fitted = terminal.buffer.active.type === 'alternate' ? 0 : fit?.proposeDimensions()?.rows || 0
  const target = Math.max(rows, fitted)
  if (terminal.cols !== cols || terminal.rows !== target) terminal.resize(cols, target)
}

// Station only: type into the shell of the connected terminal-server.
function writeToShell(input) {
  if (socket && socket.connected && typeof input === 'string') {
    socket.emit('pty-input', { input })
  }
}

// The sender's role as edrys-Lite derives it from the class setup. Never use
// the role in the message subject: the sender chooses that.
function senderRole(from) {
  return Edrys.liveClass?.users?.[from]?.role
}

const app = createApp({
  data() {
    return {
      status: null,
      isStation: false,
      enable: {
        student: false,
        teacher: false,
      },
      server: DEFAULT_SERVER,
      script: DEFAULT_SCRIPT,
      board: '',
      port: '',
      baud: '',
      filename: '',
    }
  },
  watch: {
    // students show a hint when they type without permission
    enable: {
      deep: true,
      handler() {
        if (this.isStation) this.announce()
      },
    },
  },
  methods: {
    // Station: tell the room (or one peer) the status, who may type, and the
    // terminal size.
    announce(to) {
      send(
        subjects().connect,
        {
          connected: this.status,
          enable: { ...this.enable },
          size: terminal ? { cols: terminal.cols, rows: terminal.rows } : null,
        },
        to,
      )
    },

    reload() {
      if (socket) {
        socket.removeAllListeners()
        socket.close()
      }
      // only the socket: the Edrys listeners from connectStation() stay, a
      // second registration would handle every message twice
      this.openSocket()
    },

    // files: the other files of a multi-file project, written by $FILES
    execute(code, files = {}) {
      const program = fillScript(this.script, this, code, files)

      // two ctrl+c first, to stop a possible execution. One write: a ctrl+c
      // makes the terminal drop all input the shell has not read yet.
      writeToShell('\u0003\u0003\n' + program)
    },

    initTerminal() {
      if (terminal) {
        terminal.dispose()
      }

      terminal = createTerminal()
      // e2e tests read the buffer
      window.term = terminal

      // https://github.com/xtermjs/xterm.js/issues/2941
      terminal.attachCustomKeyEventHandler(customKeyEventHandler)

      registerClearHandler(terminal)

      fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.loadAddon(new WebLinksAddon())
      terminal.loadAddon(new SearchAddon())
      serialize = new SerializeAddon()
      terminal.loadAddon(serialize)

      terminal.open(document.getElementById('terminal'))
      fit.fit()
      terminal.writeln('Welcome to pyxterm.js!')
      terminal.writeln('https://github.com/cs01/pyxterm.js')
      terminal.writeln('')
      // part of the station's screen, which students get on join: it cannot
      // depend on whether the viewer may type
      terminal.writeln('Copy: ctrl+shift+c   Paste: ctrl+shift+v')
      terminal.writeln('')

      // keystrokes typed within 50 ms go to the station as one message
      const tx = throttle((data) => send(subjects().input(Edrys.role), data), 50)

      // the station drops input it does not allow; say so once instead of
      // letting the keys vanish
      const toStation = (data) => {
        if (stationEnable?.[Edrys.role] === false && !typingNoticed) {
          typingNoticed = true
          notice(`Typing is not enabled for ${Edrys.role}s at this station.`)
        }
        tx(data)
      }

      terminal.onData((data) => {
        if (socket && socket.connected) {
          socket.emit('pty-input', { input: data })
        } else if (window.Edrys) {
          toStation(data)
        }
      })

      function customKeyEventHandler(e) {
        if (e.type !== 'keydown') {
          return true
        }
        if (e.ctrlKey && e.shiftKey) {
          const key = e.key.toLowerCase()
          if (key === 'v') {
            // only keep xterm from sending ^V: the browser pastes on its own
            // (a `paste` event, which xterm passes to onData); reading the
            // clipboard here as well pasted everything twice
            return false
          } else if (key === 'c' || key === 'x') {
            // ctrl+shift+c is also the browser's "inspect element"
            e.preventDefault()
            const toCopy = terminal.getSelection()
            navigator.clipboard.writeText(toCopy)
            terminal.focus()
            return false
          }
        }
        return true
      }

      const wait_ms = 50
      // the box, not the window: the station's controls and a taller script
      // box change it too
      new ResizeObserver(
        debounce(() => {
          if (fitToScreen() && this.isStation) this.announce()
          fitStationSize()
        }, wait_ms)
      ).observe(document.getElementById('terminal'))

      // student: back to the station's rows while a program owns the screen
      terminal.buffer.onBufferChange(() => fitStationSize())
    },

    connectUser() {
      if (messageHandlersRegistered) return
      messageHandlersRegistered = true

      const self = this

      Edrys.onMessage(({ from, subject, body }) => {
          // the sender gets its own messages too
          if (from === Edrys.username) return

          const subject_ = subjects()

          if (subject === subject_.output) {
            if (terminal && typeof body === 'string') {
              terminal.write(body)
            }
          } else if (subject === subject_.screen) {
            // the station's whole screen, sent when we joined, after the
            // status and size; the reset wipes the status notice, so repeat it
            if (terminal && typeof body === 'string') {
              terminal.reset()
              terminal.write(body)
              if (self.status === false) notice(STATION_OFFLINE)
            }
          } else if (subject === subject_.connect) {
            // { connected, enable, size }; older stations send the status alone
            const announced = body !== null && typeof body === 'object'
            const connected = announced ? body.connected : body
            if (connected === false && self.status !== false) {
              notice(STATION_OFFLINE)
            }
            self.status = connected === true || connected === false ? connected : null
            if (announced && body.enable) {
              stationEnable = body.enable
              if (stationEnable[Edrys.role]) typingNoticed = false
            }
            if (announced && body.size) applyStationSize(body.size)
            else fitToScreen()
          }
        })
    },

    // Connect to the terminal-server. Called again by reload().
    openSocket() {
      const self = this

      // no limit on attempts: stations run unattended, and the server may be
      // down for longer (container restart, laptop asleep)
      socket = io.connect(this.server, {
        reconnectionDelayMax: 5000,
        timeout: 5000,
        forceNew: true,
      })

      socket.on('connect_error', (error) => {
        console.log('Connection error:', error.message)
        if (!unreachableNoticed) {
          unreachableNoticed = true
          notice(
            `Cannot reach the terminal server at ${self.server}. Start it, e.g.: ` +
              'docker run -it -p 127.0.0.1:5000:5000 edryslabs/module-pyxtermjs:latest'
          )
        }
        if (self.status !== false) {
          self.status = false
          self.announce()
        }
      })

      socket.on('pty-output', function (data) {
        if (terminal && data.output) {
          terminal.write(data.output)
          send(subjects().output, data.output)
        }
      })

      socket.on('connect', () => {
        console.log('Socket connected')
        fitToScreen()
        self.status = true
        unreachableNoticed = false
        self.announce()

        // Send initial enter to receive outputs
        socket.emit('pty-input', { input: '\n' })
      })

      socket.on('disconnect', () => {
        console.log('Socket disconnected')
        self.status = false
        self.announce()
      })
    },

    // Station only, once: open the socket and register the Edrys listeners.
    connectStation() {
      if (messageHandlersRegistered) return
      messageHandlersRegistered = true

      const self = this

      this.openSocket()

      // opened outside Edrys: only the socket
      if (!window.Edrys) return

      Edrys.onMessage(({ from, subject, body }) => {
        const subject_ = subjects()

        if (subject === subject_.input('teacher') || subject === subject_.input('student')) {
          // the role from the class, not from the subject the sender chose
          const role = senderRole(from)
          if (
            (role === 'teacher' && self.enable.teacher) ||
            (role === 'student' && self.enable.student)
          ) {
            writeToShell(body)
          }
        } else if (subject === 'join') {
          // the status and size first, so the screen lands in a terminal of
          // the right size; then the screen, not only the last output chunk
          self.announce(from)
          if (serialize) {
            send(subject_.screen, serialize.serialize({ scrollback: JOIN_SCROLLBACK }), from)
          }
        }
      })

      // promiscuous: `execute` comes from the station's other modules
      Edrys.onMessage(({ from, subject, body }) => {
        if (subject === subjects().execute) {
          // code runs on the station's host, so it needs the same checkbox as
          // typing; the station's own modules may always
          const role = senderRole(from)
          if (
            role !== 'station' &&
            !(role === 'teacher' && self.enable.teacher) &&
            !(role === 'student' && self.enable.student)
          ) {
            console.warn(`pyxtermjs: ignored code from a ${role || 'unknown peer'}; enable it in the station settings`)
            return
          }

          const upload = parseUpload(body, self.filename)
          if (upload) {
            self.execute(upload.code, upload.files)
          } else {
            console.warn('pyxtermjs: nothing to execute in', body)
          }
        }
      }, true)
    },
  },
}).mount('#app')

app.initTerminal()

// Initialize when Edrys is ready
if (window.Edrys) {
  Edrys.onReady(() => {
    console.log('pyxtermjs is loaded!')

    if (Edrys.role === 'station') {
      app.isStation = true
      const stationConfig = Edrys.module?.stationConfig

      app.server = stationConfig?.server || DEFAULT_SERVER
      app.script = resolveScript(stationConfig)
      app.board = resolveField(stationConfig, 'board')
      app.port = resolveField(stationConfig, 'port')
      app.baud = resolveField(stationConfig, 'baud')
      app.filename = resolveField(stationConfig, 'filename')
      app.enable.student = stationConfig?.enable?.student || false
      app.enable.teacher = stationConfig?.enable?.teacher || false

      app.connectStation()
      Edrys.sendMessage('join', null)
    } else {
      app.connectUser()

      function join() {
        setTimeout(() => {
          if (app.status === null) {
            console.log('re-joining')
            Edrys.sendMessage('join', null)
            join()
          }
        }, 1000)
      }

      join()
    }
  })
}

// Opened directly, not in Edrys: connect to the local server. Never inside
// Edrys, where a late config would otherwise turn a student into a station
// of its own localhost.
if (window.parent === window) {
  console.warn('not running in Edrys, connecting directly')
  app.connectStation()
}
