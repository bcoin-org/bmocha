'use strict';

/* global __FUNCTIONS__, __PATH__ */
/* global __CONSOLE__, __COLORS__, __BAIL__ */
/* global __GREP__, __FGREP__, __INVERT__ */
/* global __SLOW__, __TIMEOUT__, __TIMEOUTS__ */
/* global __RETRIES__, __OPTIONS__, __REQUIRES__ */
/* global __ISTTY__ */
/* global document, BigInt, XMLHttpRequest */

const fs = require('fs');
const util = require('util');
const bmocha = require(__PATH__);

const {
  Array,
  Date,
  isFinite,
  Math,
  Object
} = global;

const {
  Mocha,
  Stream,
  ConsoleStream,
  DOMStream,
  __REPORTER__
} = bmocha;

/*
 * Stream
 */

const stream = __CONSOLE__
  ? new ConsoleStream(console)
  : new DOMStream(document.body);

/*
 * Global
 */

global.onerror = (err) => {
  if (err && err.stack)
    err = err.stack;

  stream.write(err + '\n');
};

global.onunhandledrejection = ({reason}) => {
  stream.write('Unhandled rejection:\n');
  stream.write('\n');
  stream.write(reason + '\n');
};

/*
 * Process
 */

let boot = Date.now();

process.stdin = new Stream();
process.stdin.readable = true;
process.stdout = stream;
process.stderr = stream;

process.arch = 'x64';
process.argv0 = 'node';
process.argv = ['/usr/bin/node', 'browserify'];
process.env.HOME = '/';
process.env.NODE_BACKEND = 'js';
process.env.PATH = '/usr/bin';
process.pid = 1;
process.ppid = 1;
process.version = 'v0.0.0';
process.versions = { node: '0.0.0' };

process.uptime = () => {
  let now = Date.now() - boot;

  if (now < 0) {
    boot = Date.now();
    now = 0;
  }

  return now / 1000;
};

process.hrtime = (time) => {
  let now = Date.now() - boot;

  if (now < 0) {
    boot = Date.now();
    now = 0;
  }

  if (Array.isArray(time)) {
    // [seconds, nanoseconds] to:
    // milliseconds.
    const [sec, ns] = time;
    const ms = sec * 1000 + Math.floor(ns / 1e6);

    now -= ms;

    if (!isFinite(now))
      now = 0;

    if (now < 0)
      now = 0;
  }

  // Milliseconds to:
  // [seconds, nanoseconds]
  const mod = now % 1000;
  const sec = (now - mod) / 1000;
  const ns = mod * 1e6;

  return [sec, ns];
};

process.hrtime.bigint = () => {
  if (typeof BigInt !== 'function')
    throw new Error('BigInt is unsupported.');

  let now = Date.now() - boot;

  if (now < 0) {
    boot = Date.now();
    now = 0;
  }

  return BigInt(now) * BigInt(1e6);
};

process.memoryUsage = () => {
  return {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0
  };
};

process.abort = () => {
  throw new Error('Aborted.');
};

process.kill = (pid, signal) => {
  return;
};

process.exitCode = 0;

process.exit = (code) => {
  if (code == null)
    code = process.exitCode;

  code >>>= 0;

  if (code !== 0)
    throw new Error(`Exit code: ${code}.`);
};

/*
 * Console
 */

if (!__CONSOLE__) {
  const format = (options, ...args) => {
    if (args.length > 0 && typeof args[0] === 'string')
      return util.format(...args);
    return util.inspect(args[0], options);
  };

  console.log = (...args) => {
    const options = { colors: __COLORS__ };
    const str = format(options, ...args);

    stream.write(str + '\n');
  };

  console.info = console.log;
  console.warn = console.log;
  console.error = console.log;

  console.dir = (obj, options) => {
    if (options == null || typeof options !== 'object')
      options = {};

    options = Object.assign({}, options);

    if (options.colors == null)
      options.colors = false;

    if (options.customInspect == null)
      options.customInspect = false;

    const str = format(options, obj);

    stream.write(str + '\n');
  };
}

/*
 * FS
 */

const request = (path, enc, callback) => {
  const xhr = new XMLHttpRequest();
  const url = `/file?path=${encodeURIComponent(path)}`;

  const parse = (xhr) => {
    const body = String(xhr.responseText || '');

    if (xhr.status >= 200 && xhr.status < 400) {
      let raw = Buffer.from(body, 'base64');

      if (enc)
        raw = raw.toString(enc);

      return [null, raw];
    }

    let json;

    try {
      json = JSON.parse(body);

      if (!json || typeof json !== 'object')
        throw new Error('Invalid JSON.');
    } catch (e) {
      return [e, null];
    }

    const err = new Error(json.message);

    err.name = String(json.name);
    err.errno = json.errno >>> 0;
    err.code = String(json.code);
    err.syscall = String(json.syscall);
    err.path = path;

    return [err, null];
  };

  xhr.open('GET', url, Boolean(callback));
  xhr.send(null);

  if (callback) {
    xhr.onreadystatechange = () => {
      if ((xhr.readyState >>> 0) === 4) {
        const [err, result] = parse(xhr);
        callback(err, result);
      }
    };
    return undefined;
  }

  const [err, result] = parse(xhr);

  if (err)
    throw err;

  return result;
};

fs.readFileSync = (file, enc) => {
  if (typeof file !== 'string')
    throw new Error('File must be a string.');

  if (enc != null && typeof enc !== 'string')
    throw new Error('Encoding must be a string.');

  return request(file, enc);
};

fs.readFile = (file, enc, cb) => {
  if (typeof enc === 'function') {
    cb = enc;
    enc = null;
  }

  if (typeof cb !== 'function')
    throw new Error('Callback must be a function.');

  if (typeof file !== 'string') {
    cb(new Error('File must be a string.'));
    return;
  }

  if (enc != null && typeof enc !== 'string') {
    cb(new Error('Encoding must be a string.'));
    return;
  }

  request(file, enc, cb);
};

try {
  // Should be resolved from the CWD.
  const bfs = require('bfile');

  bfs.readFileSync = fs.readFileSync;

  bfs.readFile = async (file, enc) => {
    return new Promise((resolve, reject) => {
      const cb = (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      };

      try {
        fs.readFile(file, enc, cb);
      } catch (e) {
        reject(e);
      }
    });
  };
} catch (e) {
  ;
}

/*
 * Mocha
 */

const mocha = new Mocha(stream);

const funcs = [
  __FUNCTIONS__
];

if (__COLORS__ !== __ISTTY__)
  mocha.colors = __COLORS__;

mocha.bail = __BAIL__;
mocha.grep = __GREP__;
mocha.fgrep = __FGREP__;
mocha.invert = __INVERT__;
mocha.slow = __SLOW__;
mocha.timeout = __TIMEOUT__;
mocha.timeouts = __TIMEOUTS__;
mocha.retries = __RETRIES__;

mocha.report(__REPORTER__, __OPTIONS__);

__REQUIRES__;

if (__CONSOLE__)
  document.body.innerHTML = 'Running... (press Ctrl+Shift+I)';

mocha.run(funcs).catch((err) => {
  stream.write('An error occured outside of the test suite:\n');
  stream.write('\n');

  if (err && err.stack)
    err = err.stack;

  stream.write(err + '\n');
});
