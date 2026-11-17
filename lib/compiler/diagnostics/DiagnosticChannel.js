/**
 * @file DiagnosticChannel.js
 * @description Structured diagnostic channel and record emitter for the Avenx compiler.
 *
 * Provides a first-class structured diagnostic channel so tooling, CLI outputs (--json),
 * and dev-server overlays can consume diagnostics directly with stable fields
 * (code, severity, message, file, line, column, frame) without intercepting
 * global console methods or scraping presentation prose.
 */

import { formatCodeFrame } from '../errors/CompilerError.js';

/**
 * Strips ANSI color escape codes from a message string.
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
  if (typeof str !== 'string') return String(str || '');
  const ansiPattern = '(?:\\u001b|\\u009b)[[(#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nseries]';
  const ansiRegex = new RegExp(ansiPattern, 'g');
  return str.replace(ansiRegex, '').trim();
}

/**
 * Splits a trailing caret code frame off a diagnostic message.
 * @param {string} message - The diagnostic text, frame included.
 * @returns {{message: string, frame: string|null}} The split parts.
 */
export function splitCodeFrame(message) {
  if (typeof message !== 'string' || message === '') {
    return { message: typeof message === 'string' ? message : '', frame: null };
  }

  const lines = message.split(/\r?\n/);
  const isFrameLine = (line) => /^\s*(?:\d+\s*)?\|/.test(line);

  let start = lines.length;
  while (start > 0) {
    const line = lines[start - 1];
    if (isFrameLine(line) || (line.trim() === '' && start < lines.length)) {
      start -= 1;
      continue;
    }
    break;
  }

  if (!lines.slice(start).some(isFrameLine)) {
    return { message, frame: null };
  }

  const frame = lines.slice(start).join('\n').replace(/^\n+|\n+$/g, '');
  const head = lines.slice(0, start).join('\n').replace(/\s+$/, '');
  return { message: head, frame: frame || null };
}

/**
 * Creates a structured diagnostic record from arbitrary compiler error/warning inputs.
 * @param {string} severity - 'warning' or 'error'
 * @param {string|Error|null} errOrCode - Error object or diagnostic code
 * @param {...any} args - Optional message, config, location arguments
 * @returns {object} The structured diagnostic record
 */
export function createDiagnosticRecord(severity, errOrCode, ...args) {
  let file = null;
  let code = null;
  let rawMsg = '';
  let line = null;
  let column = null;
  let frame = null;

  if (errOrCode instanceof Error) {
    const err = errOrCode;
    rawMsg = err.message || String(err);
    code = err.code || null;
    file = err.filename || err.filePath || err.fileName || err.file || null;
    if (typeof err.line === 'number') line = err.line;
    if (typeof err.column === 'number') column = err.column;
    if (typeof err.frame === 'string' && err.frame !== '') {
      frame = err.frame;
    }
  } else if (typeof errOrCode === 'string') {
    code = errOrCode;
    const firstArg = args[0];

    if (firstArg instanceof Error) {
      const err = firstArg;
      rawMsg = err.message || String(err);
      if (!code && err.code) code = err.code;
      file = err.filename || err.filePath || err.fileName || err.file || null;
      if (typeof err.line === 'number') line = err.line;
      if (typeof err.column === 'number') column = err.column;
      if (typeof err.frame === 'string' && err.frame !== '') {
        frame = err.frame;
      }
    } else if (Array.isArray(firstArg)) {
      rawMsg = firstArg.map((a) => (typeof a === 'object' && a !== null ? (a.message || JSON.stringify(a)) : String(a))).join(' ');
    } else if (typeof firstArg === 'string') {
      rawMsg = firstArg;
    } else if (firstArg !== undefined && firstArg !== null) {
      rawMsg = String(firstArg);
    }

    // Check location argument passed as 4th param in reportWarning(code, errOrMessage, config, location)
    // or as 2nd param in helper calls
    const loc = args[2] || (args[1] && typeof args[1] === 'object' && !Array.isArray(args[1]) && (args[1].line !== undefined || args[1].filename !== undefined || args[1].file !== undefined || args[1].filePath !== undefined) ? args[1] : null);
    if (loc && typeof loc === 'object') {
      if (!file && (loc.filename || loc.filePath || loc.file)) {
        file = loc.filename || loc.filePath || loc.file;
      }
      if (line === null && typeof loc.line === 'number') line = loc.line;
      if (column === null && typeof loc.column === 'number') column = loc.column;
      if (!frame && loc.source && line && column) {
        frame = formatCodeFrame(loc.source, line, column, loc);
      }
    }
  } else if (args.length > 0) {
    const first = args[0];
    if (first instanceof Error) {
      rawMsg = first.message || String(first);
      code = first.code || null;
      file = first.filename || first.filePath || first.fileName || first.file || null;
      if (typeof first.line === 'number') line = first.line;
      if (typeof first.column === 'number') column = first.column;
      if (typeof first.frame === 'string' && first.frame !== '') frame = first.frame;
    } else if (Array.isArray(first)) {
      rawMsg = first.map((a) => (typeof a === 'object' && a !== null ? (a.message || JSON.stringify(a)) : String(a))).join(' ');
    } else {
      rawMsg = String(first || '');
    }
  }

  rawMsg = stripAnsi(rawMsg);

  // Extract error code if not yet established
  if (!code) {
    const codeMatch = rawMsg.match(/\[?(AVX_[A-Z0-9]+)\]?/);
    if (codeMatch) {
      code = codeMatch[1];
    }
  }

  // Fallback file extraction from prose (only if not already provided on error or location object)
  if (!file) {
    const searchable = rawMsg.replace(/avenx\.config\.json/gi, '');
    const fileMatch =
      searchable.match(/in template of\s+["']?([^"'\s]+\.[a-zA-Z0-9]+)["']?/i) ||
      searchable.match(/in stylesheet\s+["']?([^"'\s]+\.[a-zA-Z0-9]+)["']?/i) ||
      searchable.match(/in component\s+<([^>]+)>/i) ||
      searchable.match(/at\s+["']?([^"'\s]+\.[a-zA-Z0-9]+)["']?/i) ||
      searchable.match(/["']?([a-zA-Z0-9_\-/\\]+\.(?:component\.js|page\.js|js|mjs|cjs|html|css|json))(?![\w.])["']?/i);

    if (fileMatch) {
      file = fileMatch[1];
    }
  }

  // Fallback line and column extraction from prose (only if not already provided)
  if (line === null) {
    const locMatch = rawMsg.match(/:(\d+):(\d+)/) || rawMsg.match(/line\s+(\d+),\s+column\s+(\d+)/i);
    if (locMatch) {
      line = parseInt(locMatch[1], 10);
      column = parseInt(locMatch[2], 10);
    }
  }

  // Strip leading code bracket like "[AVX_W03] " from clean message
  let cleanMessage = rawMsg;
  if (code) {
    cleanMessage = cleanMessage.replace(new RegExp(`^\\[?${code}\\]?\\s*:?\\s*`), '');
  }

  const split = splitCodeFrame(cleanMessage);
  if (!frame && split.frame) {
    frame = stripAnsi(split.frame);
  }

  const result = {
    file: file || null,
    code: code || 'AVX_UNK',
    severity: severity === 'error' ? 'error' : 'warning',
    message: split.message.trim(),
  };

  if (line !== null && line !== undefined) result.line = line;
  if (column !== null && column !== undefined) result.column = column;
  if (frame) result.frame = frame;

  return result;
}

/**
 * Pushes a diagnostic record into a sink (Array, DiagnosticChannel, function callback, or object with .push/.emit).
 * @param {any} sink - The destination sink
 * @param {object} record - The structured diagnostic record
 */
export function pushToDiagnosticSink(sink, record) {
  if (!sink) return;
  if (typeof sink.emit === 'function') {
    sink.emit(record);
  } else if (typeof sink.push === 'function') {
    sink.push(record);
  } else if (typeof sink === 'function') {
    sink(record);
  } else if (Array.isArray(sink)) {
    sink.push(record);
  }
}

/**
 * DiagnosticChannel class providing pub/sub and collection of compiler diagnostics.
 */
export class DiagnosticChannel extends Array {
  /**
   * Creates an empty diagnostic channel.
   */
  constructor() {
    super();
    this.subscribers = new Set();
  }

  /**
   * Emits a structured diagnostic record.
   * @param {object} record
   */
  emit(record) {
    super.push(record);
    for (const sub of this.subscribers) {
      try {
        sub(record);
      } catch {
        // Subscribers must not throw out of emitter
      }
    }
  }

  /**
   * Appends records and notifies subscribers.
   * @param {...object} records
   * @returns {number}
   */
  push(...records) {
    for (const record of records) {
      this.emit(record);
    }
    return this.length;
  }

  /**
   * Subscribes a listener to diagnostic records.
   * @param {function(object): void} listener
   * @returns {function(): void} Unsubscribe callback
   */
  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * The list of recorded diagnostics.
   * @type {object[]}
   */
  get diagnostics() {
    return this;
  }

  /**
   * The list of recorded diagnostics (alias for diagnostics).
   * @type {object[]}
   */
  get records() {
    return this;
  }

  /**
   * Removes all recorded diagnostics.
   */
  clear() {
    this.length = 0;
  }
}

export default DiagnosticChannel;
