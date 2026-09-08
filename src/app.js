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
var lastData = null

// Add session management
var sessionId = null
var isProcessingInput = false
var inputQueue = []
var messageHandlersRegistered = false

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
  methods: {
    reload() {
      if (socket) {
        socket.removeAllListeners()
        socket.close()
      }
      // Reset session
      sessionId = generateSessionId()
      messageHandlersRegistered = false
      this.connectStation()
    },

    execute(code) {
      // add two time ctrl+c to stop a possible execution
      let program = '\u0003\u0003\n' + this.script

      if (!program.endsWith('\n')) {
        program += '\n'
      }

      // replaceAll, not replace - templates use a placeholder more than
      // once (e.g. $FILE in scaffold + compile), and the single-shot
      // replace would only ever fill in the first occurrence.
      program = program
        .replaceAll('$BOARD', this.board)
        .replaceAll('$PORT', this.port)
        .replaceAll('$BAUD', this.baud)
        .replaceAll('$FILE', this.filename)
        .replaceAll('$CODE', btoa(toUtf8(code)))

      if (typeof Edrys !== 'undefined') {
        const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'
        Edrys.sendMessage('input_' + Edrys.role + '_' + executeCmd, program)
      }
    },

    store(file) {
      let command = ''

      for (const name in file) {
        let content = file[name]

        if (!content.endsWith('\n')) {
          content += '\n'
        }

        command += `echo ${btoa(
          toUtf8(content)
        )} | base64 --decode > ${toUtf8(name)}\n`
      }

      if (typeof Edrys !== 'undefined') {
        const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'
        Edrys.sendMessage('input_' + Edrys.role + '_' + executeCmd, command)
      }
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

      terminal.onData((data) => {
        if (socket && socket.connected) {
          socket.emit('pty-input', {
            input: data,
            sessionId: sessionId,
          })
        } else if (typeof Edrys !== 'undefined') {
          tx(data)
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
                tx(toPaste)
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
          } else if (subject === 'connect_' + executeCmd) {
            if (body === true) {
              self.status = true
            } else if (body === false) {
              self.status = false
            } else {
              self.status = null
            }
            fitToScreen()
          }
        })
      }
    },

    connectStation() {
      if (messageHandlersRegistered) return
      messageHandlersRegistered = true

      const self = this

      socket = io.connect(this.server, {
        reconnectionAttempts: 10,
        timeout: 5000,
        forceNew: true,
      })

      socket.on('connect_error', (error) => {
        console.log('Connection error:', error.message)
        self.status = false
      })

      socket.on('pty-output', function (data) {
        if (terminal && data.output) {
          terminal.write(data.output)
          if (typeof Edrys !== 'undefined') {
            const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'
            Edrys.sendMessage('pty-output_' + executeCmd, data.output)
          }
          lastData = data.output
        }
      })

      socket.on('connect', () => {
        console.log('Socket connected with session:', sessionId)
        fitToScreen()
        self.status = true
        if (typeof Edrys !== 'undefined') {
          const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'
          Edrys.sendMessage('connect_' + executeCmd, true)
        }

        // Send initial enter to receive outputs
        socket.emit('pty-input', {
          input: '\n',
          sessionId: sessionId,
        })
      })

      socket.on('disconnect', () => {
        console.log('Socket disconnected')
        self.status = false
        if (typeof Edrys !== 'undefined') {
          const executeCmd = Edrys.module?.stationConfig?.execute || 'execute'
          Edrys.sendMessage('connect_' + executeCmd, false)
        }
      })

      if (typeof Edrys !== 'undefined') {
        Edrys.onMessage(({ from, subject, body }) => {
          switch (subject) {
            default: {
              const executeCmd =
                Edrys.module?.stationConfig?.execute || 'execute'
              if (subject === 'input_teacher_' + executeCmd) {
                if (self.enable.teacher && socket && socket.connected) {
                  socket.emit('pty-input', {
                    input: body,
                    sessionId: sessionId,
                  })
                }
              } else if (subject === 'input_student_' + executeCmd) {
                if (self.enable.student && socket && socket.connected) {
                  socket.emit('pty-input', {
                    input: body,
                    sessionId: sessionId,
                  })
                }
              } else if (subject === 'input_station_' + executeCmd) {
                if (socket && socket.connected) {
                  socket.emit('pty-input', {
                    input: body,
                    sessionId: sessionId,
                  })
                }
              }
              break
            }
            case 'join': {
              if (typeof Edrys !== 'undefined') {
                const executeCmd =
                  Edrys.module?.stationConfig?.execute || 'execute'
                Edrys.sendMessage('connect_' + executeCmd, self.status, from)
                if (lastData) {
                  Edrys.sendMessage('pty-output_' + executeCmd, lastData, from)
                }
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
            try {
              let data = body

              if (data.file) {
                self.store(data.file)
                self.execute('')
                return
              }
            } catch (e) {
              console.warn('Error, could not execute command:', e.message)
            }

            self.execute(body)
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

// Fallback initialization
setTimeout(function () {
  if (typeof Edrys === 'undefined' || !Edrys.module) {
    console.warn('Edrys not available, connecting directly')
    app.connectStation()
  }
}, 5000)
