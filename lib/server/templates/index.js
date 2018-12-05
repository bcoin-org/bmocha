'use strict';

/* global __FUNCTIONS__, __PATH__ */
/* global __CONSOLE__, __COLORS__, __BAIL__ */
/* global __GREP__, __FGREP__, __INVERT__ */
/* global __SLOW__, __TIMEOUT__, __TIMEOUTS__ */
/* global __RETRIES__, __OPTIONS__, __REQUIRES__ */
/* global __ISTTY__ */
/* global document, BigInt */

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

process.exit = (code) => {
  code >>>= 0;

  if (code !== 0)
    throw new Error(`Exit code: ${code}.`);
};

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
