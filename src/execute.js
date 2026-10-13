// Turning code sent with `execute` into the shell input the station types:
// reading the upload, writing the files of a project, filling in the script.
// No DOM, Vue or Edrys here, so the unit tests can import it as is.

// A JS string as the bytes of its UTF-8 encoding, one char per byte, which is
// what btoa() needs.
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

const base64 = (text) => btoa(toUtf8(String(text)))

// An execute body is code, or a project as module-editor's multi-file mode
// sends it: {"file": {"Sketch.ino": "...", "util.h": "..."}}, as JSON text or
// as an object. The main file is the one named like the `filename` field, else
// the first with its extension, else the first; it becomes $CODE. Returns
// { code, files } or null.
export function parseUpload(body, filename) {
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
export function fileCommands(files) {
  const commands = []
  for (const [name, content] of Object.entries(files)) {
    if (!SAFE_NAME.test(name)) {
      console.warn('pyxtermjs: skipped a file with an unsafe name:', name)
      continue
    }
    commands.push(`echo ${base64(content)} | base64 --decode > ${shellQuote(name)}`)
  }
  return commands.join(' && ') || 'true'
}

// The script with its placeholders filled in, ending in a newline. fields:
// { board, port, baud, filename }; files: the other files of a project,
// written by $FILES, or before the script when it has no $FILES.
export function fillScript(script, fields, code, files = {}) {
  let program = script.endsWith('\n') ? script : script + '\n'

  const writes = fileCommands(files)
  if (!program.includes('$FILES') && writes !== 'true') {
    program = writes + '\n' + program
  }

  // replaceAll, not replace - templates use a placeholder more than
  // once (e.g. $FILE in scaffold + compile), and the single-shot
  // replace would only ever fill in the first occurrence. $FILES goes
  // first, since $FILE is a prefix of it.
  return program
    .replaceAll('$FILES', writes)
    .replaceAll('$BOARD', String(fields.board ?? ''))
    .replaceAll('$PORT', String(fields.port ?? ''))
    .replaceAll('$BAUD', String(fields.baud ?? ''))
    .replaceAll('$FILE', String(fields.filename ?? ''))
    .replaceAll('$CODE', base64(code))
}
