// xterm theme, terminal construction and the small timing helpers.
// The socket + Edrys message wiring lives in app.js.

import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

// The terminal stays dark in both classroom themes. Its background is
// --edrys-terminal from edrys-module.css (a shade darker in the dark theme),
// which #terminal in styles.css uses too, so the padding shows no seam.
export function terminalTheme() {
  const css = getComputedStyle(document.documentElement)
  const background = css.getPropertyValue('--edrys-terminal').trim() || '#1b2029'
  const foreground = css.getPropertyValue('--edrys-on-terminal').trim() || '#e4e7eb'
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: '#3a4a63',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#5c6470',
    brightRed: '#ff7a93',
    brightGreen: '#b9f27c',
    brightYellow: '#ff9e64',
    brightBlue: '#7da6ff',
    brightMagenta: '#bb9af7',
    brightCyan: '#0db9d7',
    brightWhite: '#e4e7eb',
  }
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

const FALLBACK_FONT = "'JetBrains Mono', 'Fira Code', 'Cascadia Mono', 'SF Mono', 'Menlo', 'Consolas', monospace"
// edrys-module.css's font; xterm measures its font once, so it is only used
// when loaded (app.js switches to it then)
export const TERMINAL_FONT = `'JetBrains Mono Variable', ${FALLBACK_FONT}`

export function createTerminal() {
  return new Terminal({
    cursorBlink: true,
    macOptionIsMeta: true,
    scrollback: 10000,
    fontFamily: document.fonts?.check("13px 'JetBrains Mono Variable'") ? TERMINAL_FONT : FALLBACK_FONT,
    fontSize: 13,
    lineHeight: 1.3,
    cursorStyle: 'bar',
    cursorWidth: 2,
    theme: terminalTheme(),
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
