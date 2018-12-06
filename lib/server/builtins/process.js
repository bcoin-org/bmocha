/*!
 * process.js - node process for javascript
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 *
 * Parts of this software are based on defunctzombie/node-process:
 *   Copyright (c) 2013, Roman Shtylman <shtylman@gmail.com>
 *   https://github.com/defunctzombie/node-process
 *
 * (The MIT License)
 *
 * Copyright (c) 2013 Roman Shtylman <shtylman@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

'use strict';

/* global BigInt */
/* eslint no-var: "off" */

var process = {};
var cachedSetTimeout;
var cachedClearTimeout;
var boot = Number(new Date());
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

/*
 * Helpers
 */

function noop() {
  return this;
}

/*
 * Timers
 */

function defaultSetTimeout() {
  throw new Error('setTimeout has not been defined');
}

function defaultClearTimeout() {
  throw new Error('clearTimeout has not been defined');
}

(function() {
  try {
    if (typeof setTimeout === 'function')
      cachedSetTimeout = setTimeout;
    else
      cachedSetTimeout = defaultSetTimeout;
  } catch (e) {
    cachedSetTimeout = defaultSetTimeout;
  }

  try {
    if (typeof clearTimeout === 'function')
      cachedClearTimeout = clearTimeout;
    else
      cachedClearTimeout = defaultClearTimeout;
  } catch (e) {
    cachedClearTimeout = defaultClearTimeout;
  }
})();

function runTimeout(func) {
  if (cachedSetTimeout === setTimeout)
    return setTimeout(func, 0);

  if ((cachedSetTimeout === defaultSetTimeout
      || !cachedSetTimeout) && setTimeout) {
    cachedSetTimeout = setTimeout;
    return setTimeout(func, 0);
  }

  try {
    return cachedSetTimeout(func, 0);
  } catch (e) {
    try {
      return cachedSetTimeout.call(null, func, 0);
    } catch (e) {
      return cachedSetTimeout.call(this, func, 0);
    }
  }
}

function runClearTimeout(marker) {
  if (cachedClearTimeout === clearTimeout)
    return clearTimeout(marker);

  if ((cachedClearTimeout === defaultClearTimeout
      || !cachedClearTimeout) && clearTimeout) {
    cachedClearTimeout = clearTimeout;
    return clearTimeout(marker);
  }

  try {
    return cachedClearTimeout(marker);
  } catch (e) {
    try {
      return cachedClearTimeout.call(null, marker);
    } catch (e) {
      return cachedClearTimeout.call(this, marker);
    }
  }
}

function cleanUpNextTick() {
  if (!draining || !currentQueue)
    return;

  draining = false;

  if (currentQueue.length)
    queue = currentQueue.concat(queue);
  else
    queueIndex = -1;

  if (queue.length)
    drainQueue();
}

function drainQueue() {
  if (draining)
    return;

  var timeout = runTimeout(cleanUpNextTick);
  var len = queue.length;

  draining = true;

  while (len) {
    currentQueue = queue;
    queue = [];

    while (++queueIndex < len) {
      if (currentQueue)
        currentQueue[queueIndex].run();
    }

    queueIndex = -1;
    len = queue.length;
  }

  currentQueue = null;
  draining = false;

  runClearTimeout(timeout);
}

/*
 * Item
 */

function Item(func, array) {
  this.func = func;
  this.array = array;
}

Item.prototype.run = function() {
  this.func.apply(null, this.array);
};

/*
 * Stream
 */

function Stream() {
  this.readable = false;
  this.writable = false;
  this.isTTY = false;
}

Stream.prototype.on = noop;
Stream.prototype.addListener = noop;
Stream.prototype.once = noop;
Stream.prototype.off = noop;
Stream.prototype.removeListener = noop;
Stream.prototype.removeAllListeners = noop;
Stream.prototype.emit = noop;
Stream.prototype.prependListener = noop;
Stream.prototype.prependOnceListener = noop;

Stream.prototype.listeners = function(name) {
  return [];
};

Stream.prototype.pause = noop;
Stream.prototype.resume = noop;
Stream.prototype.close = noop;
Stream.prototype.destroy = noop;

Stream.prototype.write = function(data) {
  return true;
};

Stream.prototype.end = Stream.prototype.write;

Stream.prototype.pipe = function(dest) {
  return dest;
};

/*
 * Process
 */

process.arch = 'x64';
process.argv0 = 'node';
process.argv = ['/usr/bin/node', 'browser'];
process.browser = true;
process.env = {};
process.env.PATH = '/usr/bin';
process.env.HOME = '/';
process.exitCode = 0;
process.pid = 1;
process.ppid = 1;
process.title = 'browser';
process.version = 'v0.0.0';
process.versions = { node: '0.0.0' };

/*
 * STDIO
 */

process.stdin = new Stream();
process.stdin.readable = true;

process.stdout = new Stream();
process.stdout.writable = true;

process.stderr = new Stream();
process.stderr.writable = true;

/*
 * Events
 */

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function(name) {
  return [];
};

/*
 * Methods
 */

process.abort = function() {
  throw new Error('Process aborted.');
};

process.binding = function(name) {
  throw new Error('process.binding is not supported.');
};

process.cwd = function() {
  return '/';
};

process.chdir = function(dir) {
  throw new Error('process.chdir is not supported.');
};

process.exit = function(code) {
  if (code == null)
    code = process.exitCode;

  code >>>= 0;

  if (code !== 0)
    throw new Error('Exit code: ' + code + '.');
};

process.hrtime = function(time) {
  var now = Number(new Date()) - boot;
  var mod, sec, ms, ns;

  if (now < 0) {
    boot = Number(new Date());
    now = 0;
  }

  if (time) {
    sec = time[0];
    ns = time[1];
    ms = sec * 1000 + Math.floor(ns / 1000000);

    now -= ms;

    if (!isFinite(now))
      now = 0;

    if (now < 0)
      now = 0;
  }

  mod = now % 1000;
  sec = (now - mod) / 1000;
  ns = mod * 1000000;

  return [sec, ns];
};

process.hrtime.bigint = function() {
  if (typeof BigInt !== 'function')
    throw new Error('BigInt is unsupported.');

  var now = Number(new Date()) - boot;

  if (now < 0) {
    boot = Number(new Date());
    now = 0;
  }

  return BigInt(now) * BigInt(1000000);
};

process.kill = function(pid, signal) {
  return;
};

process.memoryUsage = function() {
  return {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0
  };
};

process.nextTick = function(func) {
  var args = new Array(arguments.length - 1);
  var i;

  if (arguments.length > 1) {
    for (i = 1; i < arguments.length; i++)
      args[i - 1] = arguments[i];
  }

  queue.push(new Item(func, args));

  if (queue.length === 1 && !draining)
    runTimeout(drainQueue);
};

process.umask = function() {
  return 0;
};

process.uptime = function() {
  var now = Number(new Date()) - boot;

  if (now < 0) {
    boot = Number(new Date());
    now = 0;
  }

  return now / 1000;
};

/*
 * Expose
 */

module.exports = process;
