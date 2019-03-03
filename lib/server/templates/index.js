'use strict';

/*
  global __REQUIRES__
  global __FUNCTIONS__
  global __OPTIONS__
  global __PLATFORM__
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
const bmocha = require('../../bmocha');
const common = require('./common');

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
  DOMStream
} = bmocha;

/*
 * Constants
 */

const options = __OPTIONS__;

const platform = __PLATFORM__;

const body = document.getElementById('bmocha');

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

      if (json.stack) {
        try {
          err.stack = String(json.stack);
        } catch (e) {
          ;
        }
      }

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

const call = (args) => {
  return new Promise((resolve, reject) => {
    const cb = (err, res) => {
      if (err)
        reject(err);
      else
        resolve(res);
    };

    try {
      request(args, cb);
    } catch (e) {
      reject(e);
    }
  });
};

const write = (str, cb) => {
  request(['write', String(str)], cb);
};

const close = (code) => {
  stream.flush(() => {
    request(['close', code >>> 0]);
  });
};

const exit = (code) => {
  stream.flush(() => {
    request(['exit', code >>> 0]);
  });
};

/*
 * Stream
 */

stream = new SendStream(write, options.isTTY, options.columns);

if (!options.headless) {
  const {chrome} = global;
  const isTTY = Boolean(chrome && chrome.app);

  stream = options.console
    ? new ConsoleStream(console, isTTY)
    : new DOMStream(body);
}

/*
 * Process
 */

process.arch = 'x64';
process.argv0 = 'node';
process.argv = ['/usr/bin/node', './bin/bmocha'];
process.env = platform.env;
process.env.PATH = '/usr/bin';
process.env.HOME = '/';
process.env.BMOCHA = '1';
process.env.NODE_TEST = '1';
process.execArgv = [];
process.exitCode = 0;
process.pid = 1;
process.ppid = 1;
process.version = 'v0.0.0';
process.versions = { node: '0.0.0' };

if (options.backend)
  process.env.NODE_BACKEND = options.backend;

for (const key of Object.keys(options.env)) {
  const value = options.env[key];

  if (value != null)
    process.env[key] = value;
  else
    delete process.env[key];
}

process.stdin = new Stream();
process.stdin.readable = true;
process.stdout = stream;
process.stderr = stream;

process.abort = function abort() {
  if (options.headless) {
    exit(6 | 0x80);
    return;
  }
  throw new Error('Process aborted.');
};

// eslint-disable-next-line
process.exit = function _exit(code) {
  if (code == null)
    code = process.exitCode;

  code >>>= 0;

  if (options.headless) {
    exit(code);
    return;
  }

  if (code !== 0)
    throw new Error(`Exit code: ${code}.`);
};

process.hrtime = function hrtime(time) {
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

    if (!isFinite(now) || now < 0)
      now = 0;
  }

  // Milliseconds to:
  // [seconds, nanoseconds]
  const mod = now % 1000;
  const sec = (now - mod) / 1000;
  const ns = mod * 1e6;

  return [sec, ns];
};

// eslint-disable-next-line
process.hrtime.bigint = function hrtimeBigInt() {
  if (typeof BigInt !== 'function')
    throw new Error('BigInt is unsupported.');

  let now = Date.now() - boot;

  if (now < 0) {
    boot = Date.now();
    now = 0;
  }

  return BigInt(now) * BigInt(1e6);
};

process.kill = function kill(pid, signal) {
  return;
};

process.memoryUsage = function memoryUsage() {
  return {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0
  };
};

if (typeof queueMicrotask === 'function')
  process.nextTick = queueMicrotask;

process.uptime = function uptime() {
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

if (!options.console) {
  const format = (opts, ...args) => {
    if (args.length > 0 && typeof args[0] === 'string')
      return util.format(...args);
    return util.inspect(args[0], opts);
  };

  console.log = function log(...args) {
    const opts = { colors: options.colors };
    const str = format(opts, ...args);

    stream.write(str + '\n');
  };

  console.info = console.log;
  console.warn = console.log;
  console.error = console.log;

  console.dir = function dir(obj, opts) {
    if (opts == null || typeof opts !== 'object')
      opts = {};

    opts = Object.assign({}, opts);

    if (opts.colors == null)
      opts.colors = false;

    if (opts.customInspect == null)
      opts.customInspect = false;

    const str = format(opts, obj);

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
  // eslint-disable-next-line
  now: function _now() {
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

fs.constants = platform.constants;

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
    return function promisified(...args) {
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

if (!assert.rejects) {
  // Not pretty, but better than nothing.
  assert.rejects = async function rejects(func, ...args) {
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
}

if (!assert.strict) {
  // eslint-disable-next-line
  assert.strict = function _assert(...args) {
    assert(...args);
  };

  Object.assign(assert.strict, assert, {
    equal: assert.strictEqual,
    notEqual: assert.notStrictEqual,
    deepEqual: assert.deepStrictEqual,
    notDeepEqual: assert.notDeepStrictEqual
  });
}

/*
 * Workers
 */

global.register = (name, path) => {
  if (typeof name !== 'string')
    throw new TypeError('Name must be a string.');

  if (!Array.isArray(path))
    throw new TypeError('Path must be an array.');

  request(['register', name, resolve(...path)]);
};

/*
 * Notifications
 */

async function notify(stats) {
  if (!options.headless) {
    if (await common.notify(stats))
      return;
  }

  await call(['notify', {
    passes: stats.passes,
    failures: stats.failures,
    total: stats.total,
    duration: stats.duration
  }]);
}

/*
 * Mocha
 */

options.stream = stream;

const mocha = new Mocha(options);

if (options.colors !== options.isTTY)
  mocha.colors = options.colors;

if (options.growl)
  mocha.notify = notify;

if (!options.allowUncaught)
  mocha.catcher = common.catcher;

mocha.exit = process.exit;

/*
 * Execute
 */

__REQUIRES__;

const funcs = [
  __FUNCTIONS__
];

if (options.console) {
  body.innerHTML = 'Running... (press Ctrl+Shift+I) '
                 + '<a href="index.js.html">[source]</a>';
}

mocha.run(funcs).then((code) => {
  if (mocha.results.length > 0) {
    if (!options.headless && !options.console)
      stream.put('<a href="index.js.html">[source]</a>');

    if (options.headless && !options.exit) {
      close(code);
      return;
    }
  }

  if (options.headless && options.exit)
    exit(code);
}).catch((err) => {
  stream.write(err.stack + '\n');

  if (options.headless)
    exit(1);
});
