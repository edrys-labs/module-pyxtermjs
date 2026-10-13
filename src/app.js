import './styles.css'

import {
  DEFAULT_SCRIPT,
  DEFAULT_SERVER,
  resolveField,
  resolveScript,
} from './workflows.js'

import {
  createTerminal,
  debounce,
  generateSessionId,
  registerClearHandler,
  throttle,
  toUtf8,
} from './terminal.js'

const { createApp } = Vue

var terminal = null
var fit = null
var socket = null
var serialize = null

// rows of scrollback the station replays to a peer that joins
const JOIN_SCROLLBACK = 500

// Add session management
var sessionId = null
var isProcessingInput = false
var inputQueue = []
var messageHandlersRegistered = false
// station: the unreachable server was reported in the terminal
var unreachableNoticed = false
// student: the station's checkboxes as it last announced them, null until then
var stationEnable = null
// student: the typing hint was shown since typing was last allowed
var typingNoticed = false

// A line from the module itself, not from the shell.
function notice(text) {
  if (terminal) terminal.write('\r\n\x1b[33m' + text + '\x1b[0m\r\n')
}

function fitToScreen(dimensions) {
  if (fit && terminal) {
    fit.fit()

    let dims = {
      cols: terminal.cols,
      rows: terminal.rows,
    }

    if (dimensions?.cols && dimensions?.rows) {
      dims = dimensions
    }

    // console.log("sending new dimensions to server's pty", dims);
    if (socket) {
      socket.emit('resize', dims)
    } else {
      try {
        Edrys.sendMessage('resize', dims)
      } catch (e) {}
    }
  }
}

// Station only: type into the shell of the connected terminal-server.
function writeToShell(input) {
  if (socket && socket.connected && typeof input === 'string') {
    socket.emit('pty-input', {
      input: input,
      sessionId: sessionId,
    })
  }
}

// The sender's role as edrys-Lite derives it from the class setup. Never use
// the role in the message subject: the sender chooses that.
function senderRole(from) {
  return Edrys.liveClass?.users?.[from]?.role
}

// An execute body is code, or a project as module-editor's multi-file mode
// sends it: {"file": {"Sketch.ino": "...", "util.h": "..."}}, as JSON text or
// as an object. The main file is the one named like the `filename` field, else
// the first with its extension, else the first; it becomes $CODE. Returns
// { code, files } or null.
function parseUpload(body, filename) {
  let project = body
  if (typeof body === 'string') {
    try {
      project = JSON.parse(body)
    } catch (e) {
      return { code: body, files: {} }
    }
  }

  const files = project?.file
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    return typeof body === 'string' ? { code: body, files: {} } : null
  }

  const names = Object.keys(files)
  const dot = filename.lastIndexOf('.')
  const ext = dot > 0 ? filename.slice(dot) : null
  const main = names.includes(filename)
    ? filename
    : names.find((name) => ext && name.endsWith(ext)) ?? names[0]
  if (main === undefined) return null

  const { [main]: code, ...rest } = files
  return { code: String(code), files: rest }
}

// Plain file names only: no paths, no dotfiles, nothing the shell parses.
const SAFE_NAME = /^\w[\w.-]*$/

const shellQuote = (s) => "'" + s.replace(/'/g, "'\\''") + "'"

// The shell commands that write the files, as one line for $FILES.
function fileCommands(files) {
  const commands = []
  for (const [name, content] of Object.entries(files)) {
    if (!SAFE_NAME.test(name)) {
      console.warn('pyxtermjs: skipped a file with an unsafe name:', name)
      continue
    }
    commands.push(
      `echo ${btoa(toUtf8(String(content)))} | base64 --decode > ${shellQuote(name)}`
    )
  }
  return commands.join(' && ') || 'true'
}

const app = createApp({
  data() {
    return {
      status: null,
      isStation: false,
      connected: false,
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
    // Station: tell the room (or one peer) the status and who may type.
    announce(to) {
      if (typeof Edrys === 'undefined') return
      const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'
      Edrys.sendMessage(
        'connect_' + executeCmd,
        { connected: this.status, enable: { ...this.enable } },
        to,
      )
    },

    reload() {
      if (socket) {
        socket.removeAllListeners()
        socket.close()
      }
      // Reset session
      sessionId = generateSessionId()
      // only the socket: the Edrys listeners from connectStation() stay, a
      // second registration would handle every message twice
      this.openSocket()
    },

    // files: the other files of a multi-file project, written by $FILES
    execute(code, files = {}) {
      let program = this.script

      if (!program.endsWith('\n')) {
        program += '\n'
      }

      const writes = fileCommands(files)
      if (!program.includes('$FILES') && writes !== 'true') {
        program = writes + '\n' + program
      }

      // replaceAll, not replace - templates use a placeholder more than
      // once (e.g. $FILE in scaffold + compile), and the single-shot
      // replace would only ever fill in the first occurrence. $FILES goes
      // first, since $FILE is a prefix of it.
      program = program
        .replaceAll('$FILES', writes)
        .replaceAll('$BOARD', this.board)
        .replaceAll('$PORT', this.port)
        .replaceAll('$BAUD', this.baud)
        .replaceAll('$FILE', this.filename)
        .replaceAll('$CODE', btoa(toUtf8(code)))

      // two ctrl+c first, to stop a possible execution. One write: a ctrl+c
      // makes the terminal drop all input the shell has not read yet.
      writeToShell('\u0003\u0003\n' + program)
    },

    initTerminal() {
      if (terminal) {
        terminal.dispose()
      }

      sessionId = generateSessionId()

      terminal = createTerminal()

      // https://github.com/xtermjs/xterm.js/issues/2941
      terminal.attachCustomKeyEventHandler(customKeyEventHandler)

      registerClearHandler(terminal)

      fit = new FitAddon.FitAddon()
      terminal.loadAddon(fit)
      terminal.loadAddon(new WebLinksAddon.WebLinksAddon())
      terminal.loadAddon(new SearchAddon.SearchAddon())
      serialize = new SerializeAddon.SerializeAddon()
      terminal.loadAddon(serialize)

      terminal.open(document.getElementById('terminal'))
      fit.fit()
      terminal.resize(12, Math.round((window.innerHeight - 32) / 18.5))
      fit.fit()
      terminal.writeln('Welcome to pyxterm.js!')
      terminal.writeln('https://github.com/cs01/pyxterm.js')
      terminal.writeln('')
      terminal.writeln('You can copy with ctrl+shift+x')
      terminal.writeln('You can paste with ctrl+shift+v')
      terminal.writeln('')

      // Improved throttling with deduplication
      const tx = throttle((data) => {
        if (typeof Edrys !== 'undefined' && !isProcessingInput) {
          isProcessingInput = true
          const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'
          Edrys.sendMessage('input_' + Edrys.role + '_' + executeCmd, data)
          setTimeout(() => {
            isProcessingInput = false
          }, 50)
        }
      }, 50)

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
          socket.emit('pty-input', {
            input: data,
            sessionId: sessionId,
          })
        } else if (typeof Edrys !== 'undefined') {
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
            navigator.clipboard.readText().then((toPaste) => {
              if (socket && socket.connected) {
                socket.emit('pty-input', {
                  input: toPaste,
                  sessionId: sessionId,
                })
              } else if (typeof Edrys !== 'undefined') {
                toStation(toPaste)
              }
            })
            return false
          } else if (key === 'c' || key === 'x') {
            const toCopy = terminal.getSelection()
            navigator.clipboard.writeText(toCopy)
            terminal.focus()
            return false
          }
        }
        return true
      }

      const wait_ms = 50
      window.onresize = debounce(fitToScreen, wait_ms)
    },

    connectUser() {
      if (messageHandlersRegistered) return
      messageHandlersRegistered = true

      const self = this

      if (typeof Edrys !== 'undefined') {
        Edrys.onMessage(({ from, subject, body }) => {
          // Prevent processing own messages
          if (from === Edrys.liveUser?.name) return

          const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'

          if (subject === 'pty-output_' + executeCmd) {
            if (terminal && typeof body === 'string') {
              terminal.write(body)
            }
          } else if (subject === 'pty-screen_' + executeCmd) {
            // the station's whole screen, sent when we joined
            if (terminal && typeof body === 'string') {
              terminal.reset()
              terminal.write(body)
            }
          } else if (subject === 'connect_' + executeCmd) {
            // { connected, enable }; older stations send the status alone
            const announced = body !== null && typeof body === 'object'
            const connected = announced ? body.connected : body
            if (connected === false && self.status !== false) {
              notice('The station is not connected to its terminal server.')
            }
            self.status = connected === true || connected === false ? connected : null
            if (announced && body.enable) {
              stationEnable = body.enable
              if (stationEnable[Edrys.role]) typingNoticed = false
            }
            fitToScreen()
          }
        })
      }
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
          if (typeof Edrys !== 'undefined') {
            const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'
            Edrys.sendMessage('pty-output_' + executeCmd, data.output)
          }
        }
      })

      socket.on('connect', () => {
        console.log('Socket connected with session:', sessionId)
        fitToScreen()
        self.status = true
        unreachableNoticed = false
        self.announce()

        // Send initial enter to receive outputs
        socket.emit('pty-input', {
          input: '\n',
          sessionId: sessionId,
        })
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

      if (typeof Edrys !== 'undefined') {
        Edrys.onMessage(({ from, subject, body }) => {
          switch (subject) {
            default: {
              const executeCmd =
                Edrys.module?.stationConfig?.execute || 'execute'
              if (
                subject === 'input_teacher_' + executeCmd ||
                subject === 'input_student_' + executeCmd
              ) {
                const role = senderRole(from)
                if (
                  (role === 'teacher' && self.enable.teacher) ||
                  (role === 'student' && self.enable.student)
                ) {
                  writeToShell(body)
                }
              }
              break
            }
            case 'join': {
              if (typeof Edrys !== 'undefined') {
                const executeCmd =
                  Edrys.module?.stationConfig?.execute || 'execute'
                // the screen, not only the last output chunk; before the
                // status, whose notice the screen's reset would wipe
                if (serialize) {
                  Edrys.sendMessage(
                    'pty-screen_' + executeCmd,
                    serialize.serialize(JOIN_SCROLLBACK),
                    from,
                  )
                }
                self.announce(from)
              }
              break
            }
            case 'resize': {
              fitToScreen(body)
              break
            }
          }
        })

        const promiscuous = true

        Edrys.onMessage(({ from, subject, body, module }) => {
          if (subject === (Edrys.module?.stationConfig?.execute || 'execute')) {
            // code runs on the station's host, so it needs the same checkbox
            // as typing; the station's own modules may always
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
        }, promiscuous)
      }
    },
  },
}).mount('#app')

app.initTerminal()

// Initialize when Edrys is ready
if (typeof Edrys !== 'undefined') {
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
      app.enable.student = Edrys.module?.stationConfig?.enable?.student || false
      app.enable.teacher = Edrys.module?.stationConfig?.enable?.teacher || false

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
