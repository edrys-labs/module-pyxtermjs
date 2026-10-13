// xterm theme, terminal construction and the small timing/encoding helpers.
// The socket + Edrys message wiring lives in app.js.

import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

// Mirrored by the #terminal background in styles.css - if these drift, the
// padding around the terminal shows a seam against the xterm canvas.
export const TERMINAL_BACKGROUND = '#1a1b26'

export const TERMINAL_THEME = {
  background: TERMINAL_BACKGROUND,
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: TERMINAL_BACKGROUND,
  selectionBackground: '#33467c',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#ff7a93',
  brightGreen: '#b9f27c',
  brightYellow: '#ff9e64',
  brightBlue: '#7da6ff',
  brightMagenta: '#bb9af7',
  brightCyan: '#0db9d7',
  brightWhite: '#c0caf5',
}

export function toUtf8(text) {
  var surrogate = encodeURIComponent(text)
  var result = ''
  for (var i = 0; i < surrogate.length; ) {
    var character = surrogate[i]
    i += 1
    if (character == '%') {
      var hex = surrogate.substring(i, (i += 2))
      if (hex) {
        result += String.fromCharCode(parseInt(hex, 16))
      }
    } else {
      result += character
    }
  }
  return result
}

export function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

export function debounce(func, wait_ms) {
  let timeout
  return function (...args) {
    const context = this
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(context, args), wait_ms)
  }
}

export function throttle(cb, delay = 100) {
  let storedChange = ''
  let timerID = null
  let isProcessing = false

  function checkStoredArgs() {
    if (storedChange.length > 0 && !isProcessing) {
      isProcessing = true
      const dataToSend = storedChange
      storedChange = ''
      cb(dataToSend)
      isProcessing = false
    }
    timerID = null
  }

  return (change) => {
    if (timerID) {
      window.clearTimeout(timerID)
    }

    if (change !== null && typeof change === 'string') {
      storedChange += change
    }

    timerID = window.setTimeout(checkStoredArgs, delay)
  }
}

export function createTerminal() {
  return new Terminal({
    cursorBlink: true,
    macOptionIsMeta: true,
    scrollback: 10000,
    fontFamily:
      "'JetBrains Mono', 'Fira Code', 'Cascadia Mono', 'SF Mono', 'Menlo', 'Consolas', monospace",
    fontSize: 14,
    lineHeight: 1.3,
    cursorStyle: 'bar',
    cursorWidth: 2,
    theme: TERMINAL_THEME,
  })
}

// A shell clearing the screen (ctrl+l, `clear`, tput clear, ...) emits
// CSI 2 J, which only wipes the viewport - the scrollback survives and
// reappears when scrolling up. Hooking the sequence instead of a keystroke
// covers every way of triggering it. Returning false lets xterm still
// perform its normal handling.
export function registerClearHandler(terminal) {
  terminal.parser.registerCsiHandler({ final: 'J' }, (params) => {
    if (params[0] === 2 || params[0] === 3) {
      setTimeout(() => terminal.clear(), 0)
    }
    return false
  })
}
