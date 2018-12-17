/*!
 * error.js - error line parsing for node.js
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

/* eslint func-name-matching: "off" */
/* eslint no-control-regex: "off" */

'use strict';

const fs = require('fs');

/*
 * Constants
 */

const wrapperSize = 62;
const map = new WeakMap();

let slab = null;

/*
 * API
 */

function hasAPI() {
  const oldPrepareStackTrace = Error.prepareStackTrace;

  let args = [null, null];
  let line, column, filename, str;

  Error.prepareStackTrace = function prepareStackTrace(error, stack) {
    args = [error, stack];
    return 'foobar';
  };

  const error = new Error();
  const stack = String(error.stack);

  Error.prepareStackTrace = oldPrepareStackTrace;

  if (stack !== 'foobar')
    return false;

  if (args[0] !== error)
    return false;

  const calls = args[1];

  if (!Array.isArray(calls))
    return false;

  for (const call of calls) {
    if (!isObject(call))
      return false;
  }

  if (calls.length === 0)
    return false;

  const call = calls[0];

  try {
    line = call.getLineNumber();
    column = call.getColumnNumber();
    filename = call.getFileName();
    str = call.toString();
  } catch (e) {
    return false;
  }

  if ((line >>> 0) !== line)
    return false;

  if ((column >>> 0) !== column)
    return false;

  if (typeof filename !== 'string')
    return false;

  if (typeof str !== 'string')
    return false;

  return true;
}

function inject() {
  if (!hasAPI())
    return () => {};

  const oldPrepareStackTrace = Error.prepareStackTrace;

  let prepare = oldPrepareStackTrace;

  if (typeof prepare !== 'function')
    prepare = defaultPrepareStackTrace;

  Error.prepareStackTrace = function prepareStackTrace(error, stack) {
    if (isObject(error))
      map.set(error, stack);

    return prepare.call(Error, error, stack);
  };

  return () => {
    Error.prepareStackTrace = oldPrepareStackTrace;
  };
}

function getCalls(error) {
  if (!isObject(error))
    return [];

  if (map.has(error))
    return map.get(error);

  const stack = String(error.stack);

  // Length check to prevent v8 from optimizing.
  if (stack.length > 0 && map.has(error))
    return map.get(error);

  return [];
}

function getCall(error) {
  const calls = getCalls(error);

  for (const call of calls) {
    const filename = call.getFileName();

    if (!filename)
      return null;

    // Up until node 8.11.2 (as far as I
    // can tell), captureStackTrace()
    // only hid the caller from the
    // _formatted_ stack, not the actual
    // calls. Search until we find a file
    // which is not an assert.js. Note
    // that we could just check
    // `filename === 'assert.js'`, but
    // we want to filter out 3rd-party
    // assertion libraries as well.
    if (filename.endsWith('assert.js'))
      continue;

    return call;
  }

  return null;
}

function getCallRaw(error) {
  if (!isObject(error))
    return null;

  let {stack, message} = error;

  if (typeof stack !== 'string' || stack === '')
    return null;

  if (typeof message === 'string' && message.length > 0) {
    // Remove the message from the stack trace.
    let index = stack.indexOf(message);

    if (index !== -1) {
      index += message.length;
      stack = stack.substring(index + 1);
    }
  }

  const m = /\(([^:]+):(\d+):(\d+)\)/.exec(stack);

  if (!m)
    return null;

  return {
    getFileName: () => m[1],
    getLineNumber: () => m[2] >>> 0,
    getColumnNumber: () => m[3] >>> 0
  };
}

function getLine(error) {
  const call = getCall(error);

  if (!call)
    return null;

  const filename = call.getFileName();

  if (!filename)
    return null;

  const line = call.getLineNumber() - 1;

  let column = call.getColumnNumber() - 1;
  let fd = null;
  let code = null;

  if (line === 0)
    column -= wrapperSize;

  try {
    fd = fs.openSync(filename, 'r', 0o666);
    [column, code] = getCode(fd, line, column);
  } catch (e) {
    ;
  } finally {
    if (fd != null)
      fs.closeSync(fd);
  }

  return {
    filename,
    line,
    column,
    code
  };
}

/*
 * Parsing
 */

function getCode(fd, line, column) {
  assert(fd != null);
  assert((line >>> 0) === line);
  assert((column >>> 0) === column);

  if (!slab)
    slab = Buffer.allocUnsafe(8 * 1024);

  const stat = fs.fstatSync(fd);

  let start = 0;
  let current = 0;
  let pos = 0;

  // Try to find the offending line.
outer:
  while (pos < stat.size) {
    const length = Math.min(stat.size - pos, slab.length);
    const bytes = fs.readSync(fd, slab, 0, length, pos);

    if (bytes !== length)
      throw new Error('readSync failed.');

    for (let i = 0; i < length; i++) {
      const ch = slab[i];

      if (ch !== 0x0a) // '\n'
        continue;

      if (current === line) {
        pos += i;
        break outer;
      }

      current += 1;
      start = pos + i + 1;
    }

    pos += bytes;
  }

  if (current !== line)
    throw new Error('Could not find line.');

  let length = pos - start;

  // Enough to ensure utf8 decodes correctly
  // given our final string length limit of
  // 80 bytes (5 * 80).
  if (length > 400)
    length = 400;

  const bytes = fs.readSync(fd, slab, 0, length, start);

  if (bytes !== length)
    throw new Error('readSync failed.');

  let begin = -1;
  let end = -1;

  // Eat space and try to stop at a semicolon.
  for (let i = 0; i < length; i++) {
    const ch = slab[i];

    // Eat space and subtract from columns.
    if (begin === -1) {
      if (ch === 0x09 || ch === 0x20) // '\t', ' '
        column -= 1;
      else
        begin = i;
    }

    // Last non-unicode byte.
    if ((ch & 0x80) === 0)
      end = i;

    // Stop when we see a semicolon.
    if (ch === 0x3b) // ';'
      break;
  }

  if (begin === -1)
    begin = 0;

  end += 1;

  // Strange line with
  // unicode characters.
  if (begin > end) {
    begin = end;
    column = 0;
  }

  let code = slab.toString('utf8', begin, end);

  // Sanitize.
  code = code.replace(/^\ufeff/, '');
  code = code.replace(/\t/g, '  ');
  code = code.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');

  if (code.length > 80) {
    code = code.substring(0, 76) + ' ...';

    if (column > 77)
      column = 77;
  }

  if (column < 0)
    column = 0;

  if (column >= code.length)
    column = code.length - 1;

  return [column, code];
}

/*
 * Helpers
 */

function assert(ok, msg) {
  if (!ok) {
    const err = new Error(msg || 'Assertion failure');
    Error.captureStackTrace(err, assert);
    throw err;
  }
}

function isObject(error) {
  if (error == null)
    return false;

  return typeof error === 'object'
      || typeof error === 'function';
}

function defaultPrepareStackTrace(error, stack) {
  if (!isObject(error))
    return '';

  // As far as I can figure, this is the exact
  // behavior of v8's default stack generator.
  let {name, message} = error;

  if (name === undefined)
    name = 'Error';

  let out = String(name);

  if (message !== undefined && message !== '') {
    out += ': ';
    out += String(message);
    out += '\n';
  } else {
    out += '\n';
  }

  for (const call of stack)
    out += `    at ${call.toString()}\n`;

  return out.slice(0, -1);
}

/*
 * Expose
 */

exports.hasAPI = hasAPI;
exports.inject = inject;
exports.getCalls = getCalls;
exports.getCall = getCall;
exports.getCallRaw = getCallRaw;
exports.getLine = getLine;
