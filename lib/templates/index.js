'use strict';

/* eslint brace-style: "off" */
/* global __FUNCS__, __PATH__ */
/* global __CONSOLE__, __COLORS__, __BAIL__ */
/* global __GREP__, __FGREP__, __INVERT__ */
/* global __SLOW__, __TIMEOUT__, __TIMEOUTS__ */
/* global __RETRIES__, __OPTIONS__, __REQUIRES__ */
/* global __ISTTY__ */
/* global document */

const funcs = [
  __FUNCS__
];

const util = require('util');
const bmocha = require(__PATH__);

const {
  Mocha,
  ConsoleStream,
  DOMStream,
  __REPORTER__
} = bmocha;

let stream = null;

if (__CONSOLE__) {
  stream = new ConsoleStream(console);
  document.body.innerHTML = 'Running... (press Ctrl+Shift+I)';
} else {
  stream = new DOMStream(document.body);

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

const noop = function() {
  return this;
};

stream.readable = false;
stream.writable = true;
stream.on = noop;
stream.addListener = noop;
stream.once = noop;
stream.off = noop;
stream.removeListener = noop;
stream.removeAllListeners = noop;
stream.emit = noop;
stream.prependListener = noop;
stream.prependOnceListener = noop;
stream.listeners = () => [];
stream.pause = noop;
stream.resume = noop;
stream.close = noop;
stream.destroy = noop;

process.stdin = {};
process.stdin.readable = true;
process.stdin.writeable = false;
process.stdin.isTTY = false;
process.stdin.on = noop;
process.stdin.addListener = noop;
process.stdin.once = noop;
process.stdin.off = noop;
process.stdin.removeListener = noop;
process.stdin.removeAllListeners = noop;
process.stdin.emit = noop;
process.stdin.prependListener = noop;
process.stdin.prependOnceListener = noop;
process.stdin.listeners = () => [];
process.stdin.pause = noop;
process.stdin.resume = noop;
process.stdin.close = noop;
process.stdin.destroy = noop;
process.stdin.pipe = noop;

process.stdout = stream;
process.stderr = stream;

process.argv0 = 'node';
process.argv = ['/usr/bin/node', 'bmocha'];
process.env.HOME = '/';
process.env.NODE_BACKEND = 'js';

process._boot = Date.now();

process.uptime = () => {
  return (Date.now() - process._boot) / 1000;
};

process.hrtime = (time) => {
  let now = Date.now();

  if (time) {
    const [hi, lo] = time;
    const start = hi * 1000 + lo / 1e6;
    now = now - Math.floor(start);
  }

  const ms = now % 1000;
  const hi = (now - ms) / 1000;
  const lo = ms * 1e6;

  return [hi, lo];
};

process.kill = () => {};

process.exit = (code) => {
  code >>>= 0;

  if (code !== 0)
    throw new Error('Exit code: ' + code);
};

global.onerror = (err) => {
  if (err && err.stack)
    err = String(err.stack);
  stream.write(err + '\n');
};

global.onunhandledrejection = ({reason}) => {
  stream.write('Unhandled rejection:\n');
  stream.write('\n');
  stream.write(reason + '\n');
};

const mocha = new Mocha(stream);

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

mocha.run(funcs).catch((err) => {
  stream.write('An error occured outside of the test suite:\n');
  stream.write('\n');
  if (err && err.stack)
    err = String(err.stack);
  stream.write(err + '\n');
});
