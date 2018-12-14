'use strict';

/*
  global __BAIL__
  global __COLORS__
  global __COLUMNS__
  global __CONSOLE__
  global __CONSTANTS__
  global __ENV__
  global __EXIT__
  global __FGREP__
  global __FUNCTIONS__
  global __HEADLESS__
  global __GREP__
  global __INVERT__
  global __ISTTY__
  global __OPTIONS__
  global __PATH__
  global __REPORTER__
  global __REQUIRES__
  global __RETRIES__
  global __SLOW__
  global __UNCAUGHT__
  global __TIMEOUT__
  global __TIMEOUTS__
  global BigInt
  global document
  global performance
  global XMLHttpRequest
*/

const assert = require('assert');
const fs = require('fs');
const {resolve} = require('path');
const hooks = require('perf_hooks');
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
  SendStream,
  ConsoleStream,
  DOMStream,
  toError
} = bmocha;

/*
 * Constants
 */

let stream = null;
let boot = Date.now();

/*
 * HTTP
 */

const request = (args, callback) => {
  const xhr = new XMLHttpRequest();

  const parse = (xhr, args) => {
    const body = String(xhr.responseText || '').trim();
    const status = xhr.status >>> 0;
    const error = status < 200 || status >= 400;

    let json = Object.create(null);

    try {
      if (body.length > 0)
        json = JSON.parse(body);

      if (!json || typeof json !== 'object')
        throw new Error('Invalid JSON body.');
    } catch (e) {
      if (error)
        return [new Error(`Status code: ${status}`), null];
      return [e, null];
    }

    if (error) {
      const msg = String(json.message || '');
      const err = new Error(msg);

      if (json.name)
        err.name = String(json.name);

      if (json.type)
        err.type = String(json.type);

      if (json.errno != null)
        err.errno = json.errno | 0;

      if (json.code)
        err.code = String(json.code);

      if (json.syscall)
        err.syscall = String(json.syscall);

      if (typeof args[1] === 'string')
        err.path = args[1];

      return [err, null];
    }

    switch (args[0]) {
      case 'access': {
        return [null, undefined];
      }
      case 'exists': {
        return [null, Boolean(json.exists)];
      }
      case 'lstat':
      case 'stat': {
        const stat = Object.assign({}, json, {
          isBlockDevice: () => json.isBlockDevice,
          isCharacterDevice: () => json.isCharacterDevice,
          isDirectory: () => json.isDirectory,
          isFIFO: () => json.isFIFO,
          isFile: () => json.isFile,
          isSocket: () => json.isSocket,
          isSymbolicLink: () => json.isSymbolicLink,
          atimeMs: json.atime,
          mtimeMs: json.mtime,
          ctimeMs: json.ctime,
          birthtimeMs: json.birthtime,
          atime: new Date(json.atime),
          mtime: new Date(json.mtime),
          ctime: new Date(json.ctime),
          birthtime: new Date(json.birthtime)
        });
        return [null, stat];
      }
      case 'readdir': {
        return [null, json];
      }
      case 'readfile': {
        let raw = String(json.data);

        if (args.length < 3 || !args[2])
          raw = Buffer.from(raw, 'base64');

        return [null, raw];
      }
    }

    return [null, json];
  };

  xhr.open('POST', '/', Boolean(callback));
  xhr.send(JSON.stringify(args));

  if (callback) {
    xhr.onreadystatechange = () => {
      const readyState = xhr.readyState >>> 0;

      if (readyState === 4) {
        const [err, res] = parse(xhr, args);
        callback(err, res);
      }
    };

    return undefined;
  }

  const [err, res] = parse(xhr, args);

  if (err)
    throw err;

  return res;
};

const write = (str, cb) => {
  request(['write', String(str)], cb);
};

const close = (code) => {
  stream.onFlush(() => {
    request(['close', code >>> 0]);
  });
};

const exit = (code) => {
  stream.onFlush(() => {
    request(['exit', code >>> 0]);
  });
};

/*
 * Stream
 */

stream = new SendStream(write, __ISTTY__, __COLUMNS__);

if (!__HEADLESS__) {
  const {chrome} = global;
  const isTTY = Boolean(chrome && chrome.app);

  stream = __CONSOLE__
    ? new ConsoleStream(console, isTTY)
    : new DOMStream(document.body);
}

/*
 * Error Handling
 */

const addListener = (event, handler) => {
  if (global.addEventListener)
    global.addEventListener(event, handler, false);
  else if (global.attachEvent)
    global.attachEvent(`on${event}`, handler);
  else
    global[`on${event}`] = handler;
};

const removeListener = (event, handler) => {
  if (global.removeEventListener)
    global.removeEventListener(event, handler, false);
  else if (global.detachEvent)
    global.detachEvent(`on${event}`, handler);
  else
    global[`on${event}`] = null;
};

const catcher = (reject) => {
  const onError = ({error}) => {
    const err = toError(error, true);

    err.uncaught = true;
    err.exception = true;

    reject(err);
  };

  const onRejection = ({reason}) => {
    const err = toError(reason, true);

    err.uncaught = true;
    err.rejected = true;

    reject(err);
  };

  addListener('error', onError);
  addListener('unhandledrejection', onRejection);

  return () => {
    removeListener('error', onError);
    removeListener('unhandledrejection', onRejection);
  };
};

/*
 * Process
 */

process.arch = 'x64';
process.argv0 = 'node';
process.argv = ['/usr/bin/node', 'browserify'];
process.env = __ENV__;
process.env.PATH = '/usr/bin';
process.env.HOME = '/';
process.env.NODE_BACKEND = 'js';
process.env.NODE_TEST = '1';
process.env.BMOCHA = '1';
process.env.BMOCHA_REPORTER = __REPORTER__;
process.exitCode = 0;
process.pid = 1;
process.ppid = 1;
process.version = 'v0.0.0';
process.versions = { node: '0.0.0' };

process.stdin = new Stream();
process.stdin.readable = true;
process.stdout = stream;
process.stderr = stream;

process.abort = () => {
  if (__HEADLESS__) {
    exit(6 | 0x80);
    return;
  }
  throw new Error('Process aborted.');
};

process.exit = (code) => {
  if (code == null)
    code = process.exitCode;

  code >>>= 0;

  if (__HEADLESS__) {
    exit(code);
    return;
  }

  if (code !== 0)
    throw new Error(`Exit code: ${code}.`);
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

process.kill = (pid, signal) => {
  return;
};

process.memoryUsage = () => {
  return {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0
  };
};

process.uptime = () => {
  let now = Date.now() - boot;

  if (now < 0) {
    boot = Date.now();
    now = 0;
  }

  return now / 1000;
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
 * Performance
 */

const perf = (() => {
  if (typeof performance !== 'object')
    return null;

  if (!performance)
    return null;

  if (typeof performance.now !== 'function')
    return null;

  try {
    if (typeof performance.now() !== 'number')
      return null;
  } catch (e) {
    return null;
  }

  return performance;
})();

hooks.performance = {
  nodeTiming: {
    name: 'node',
    entryType: 'node',
    startTime: 0,
    duration: 0,
    nodeStart: 0,
    v8Start: 0,
    bootstrapComplete: 0,
    environment: 0,
    loopStart: 0,
    loopExit: -1,
    thirdPartyMainStart: undefined,
    thirdPartyMainEnd: undefined,
    clusterSetupStart: undefined,
    clusterSetupEnd: undefined,
    moduleLoadStart: undefined,
    moduleLoadEnd: undefined,
    preloadModuleLoadStart: undefined,
    preloadModuleLoadEnd: undefined
  },
  now: () => {
    if (perf)
      return perf.now();

    let now = Date.now() - boot;

    if (now < 0) {
      boot = Date.now();
      now = 0;
    }

    return now;
  }
};

hooks.PerformanceObserver = null;

hooks.constants = {
  NODE_PERFORMANCE_GC_MAJOR: 2,
  NODE_PERFORMANCE_GC_MINOR: 1,
  NODE_PERFORMANCE_GC_INCREMENTAL: 4,
  NODE_PERFORMANCE_GC_WEAKCB: 8
};

/*
 * FS
 */

fs.constants = __CONSTANTS__;

fs.accessSync = (file, mode) => {
  if (mode == null)
    mode = null;

  if (typeof file !== 'string')
    throw new Error('File must be a string.');

  if (mode != null && typeof mode !== 'number')
    throw new Error('Mode must be a number.');

  return request(['access', file, mode]);
};

fs.existsSync = (file) => {
  if (typeof file !== 'string')
    throw new Error('File must be a string.');

  try {
    return request(['exists', file]);
  } catch (e) {
    return false;
  }
};

fs.lstatSync = (file) => {
  if (typeof file !== 'string')
    throw new Error('File must be a string.');

  return request(['lstat', file]);
};

fs.readdirSync = (path) => {
  if (typeof path !== 'string')
    throw new Error('Path must be a string.');

  return request(['readdir', path]);
};

fs.readFileSync = (file, enc) => {
  if (enc == null)
    enc = null;

  if (typeof file !== 'string')
    throw new Error('File must be a string.');

  if (enc != null && typeof enc !== 'string')
    throw new Error('Encoding must be a string.');

  return request(['readfile', file, enc]);
};

fs.statSync = (file) => {
  if (typeof file !== 'string')
    throw new Error('File must be a string.');

  return request(['stat', file]);
};

fs.access = (file, mode, cb) => {
  if (typeof mode === 'function') {
    cb = mode;
    mode = null;
  }

  if (mode == null)
    mode = null;

  if (typeof cb !== 'function')
    throw new Error('Callback must be a function.');

  if (typeof file !== 'string') {
    cb(new Error('File must be a string.'));
    return;
  }

  if (mode != null && typeof mode !== 'number') {
    cb(new Error('Mode must be a number.'));
    return;
  }

  request(['access', file, mode], cb);
};

fs.exists = (file, cb) => {
  if (typeof cb !== 'function')
    throw new Error('Callback must be a function.');

  if (typeof file !== 'string') {
    cb(new Error('File must be a string.'));
    return;
  }

  request(['exists', file], (err, res) => {
    cb(err ? false : res);
  });
};

fs.lstat = (file, cb) => {
  if (typeof cb !== 'function')
    throw new Error('Callback must be a function.');

  if (typeof file !== 'string') {
    cb(new Error('File must be a string.'));
    return;
  }

  request(['lstat', file], cb);
};

fs.readdir = (path, cb) => {
  if (typeof cb !== 'function')
    throw new Error('Callback must be a function.');

  if (typeof path !== 'string') {
    cb(new Error('Path must be a string.'));
    return;
  }

  request(['readdir', path], cb);
};

fs.readFile = (file, enc, cb) => {
  if (typeof enc === 'function') {
    cb = enc;
    enc = null;
  }

  if (enc == null)
    enc = null;

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

  request(['readfile', file, enc], cb);
};

fs.stat = (file, cb) => {
  if (typeof cb !== 'function')
    throw new Error('Callback must be a function.');

  if (typeof file !== 'string') {
    cb(new Error('File must be a string.'));
    return;
  }

  request(['stat', file], cb);
};

/*
 * bfile
 */

try {
  const bfs = require('bfile');

  const wrap = (func) => {
    return (...args) => {
      return new Promise((resolve, reject) => {
        const cb = (err, res) => {
          if (func === fs.exists) {
            resolve(err);
            return;
          }

          if (err)
            reject(err);
          else
            resolve(res);
        };

        args.push(cb);

        try {
          func(...args);
        } catch (e) {
          reject(e);
        }
      });
    };
  };

  bfs.constants = fs.constants;

  bfs.accessSync = fs.accessSync;
  bfs.existsSync = fs.existsSync;
  bfs.lstatSync = fs.lstatSync;
  bfs.readdirSync = fs.readdirSync;
  bfs.readFileSync = fs.readFileSync;
  bfs.statSync = fs.statSync;

  bfs.access = wrap(fs.access);
  bfs.exists = wrap(fs.exists);
  bfs.lstat = wrap(fs.lstat);
  bfs.readdir = wrap(fs.readdir);
  bfs.readFile = wrap(fs.readFile);
  bfs.stat = wrap(fs.stat);
} catch (e) {
  ;
}

/*
 * Assert
 */

assert.strict = assert;

assert.rejects = async (func, ...args) => {
  if (!(func instanceof Promise))
    assert(typeof func === 'function');

  try {
    if (func instanceof Promise)
      await func;
    else
      await func();
  } catch (e) {
    assert.throws(() => {
      throw e;
    }, ...args);
    return;
  }

  assert.throws(() => {}, ...args);
};

/*
 * Workers
 */

global.register = (name, path) => {
  if (typeof name !== 'string')
    throw new Error('Name must be a string.');

  if (!Array.isArray(path))
    throw new Error('Path must be an array.');

  request(['register', name, resolve(...path)]);
};

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
mocha.reporter = __REPORTER__;
mocha.reporterOptions = __OPTIONS__;

if (!__UNCAUGHT__)
  mocha.catcher = catcher;

mocha.exit = process.exit;

__REQUIRES__;

if (__CONSOLE__)
  document.body.innerHTML = 'Running... (press Ctrl+Shift+I)';

mocha.run(funcs).then((code) => {
  if (mocha.results.length > 0) {
    if (__HEADLESS__ && !__EXIT__) {
      close(code);
      return;
    }
  }

  if (__HEADLESS__ && __EXIT__)
    exit(code);
}).catch((err) => {
  stream.write('An error occured outside of the test suite:\n');
  stream.write('\n');

  if (err && err.stack)
    err = err.stack;

  stream.write(err + '\n');

  if (__HEADLESS__)
    exit(1);
});
