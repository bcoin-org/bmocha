/*!
 * bmocha.js - minimal mocha implementation
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

/* eslint no-control-regex: "off" */

'use strict';

const diff = require('./diff');

/*
 * Globals
 */

const {
  Array,
  Boolean,
  Date,
  clearTimeout,
  Error,
  JSON,
  Math,
  Promise,
  setTimeout,
  String
} = global;

/*
 * Constants
 */

const style = {
  __proto__: null,
  font: 'monospace',
  fg: '#000000', // #eeeeee
  bg: '#ffffff', // #111111
  colors: [
    '#2e3436', // black
    '#cc0000', // red
    '#4e9a06', // green
    '#c4a000', // yellow
    '#3465a4', // blue
    '#75507b', // magenta
    '#06989a', // cyan
    '#d3d7cf', // white
    '#555753', // bright black
    '#ef2929', // bright red
    '#8ae234', // bright green
    '#fce94f', // bright yellow
    '#729fcf', // bright blue
    '#ad7fa8', // bright magenta
    '#34e2e2', // bright cyan
    '#eeeeec'  // bright white
  ]
};

const skipper = {};

/**
 * Runnable
 */

class Runnable {
  constructor() {
    this.mocha = null;
    this.reporter = null;
    this.suite = null;
    this.parent = null;
    this.title = '';
    this.name = '';
    this.func = null;
    this.matching = false;
    this.depth = 0;
    this.slow = 0;
    this.timeout = 0;
    this.timeouts = false;
    this.retries = 0;
    this.skip = false;
    this.only = false;
    this.running = false;
    this.elapsed = 0;
    this.context = null;
  }

  fullName() {
    let name = this.name;
    let parent = this.parent;

    while (parent) {
      if (parent.name)
        name = parent.name + ' ' + name;
      parent = parent.parent;
    }

    return name;
  }
}

/**
 * Mocha
 */

class Mocha extends Runnable {
  constructor(stream = new Stream(), Reporter = SpecReporter) {
    assert(stream && typeof stream.write === 'function');
    assert(typeof Reporter === 'function');

    super();

    this.mocha = this;
    this.reporter = new Reporter(stream);
    this.suite = null;
    this.parent = null;
    this.title = '';
    this.name = '';
    this.func = null;
    this.matching = false;
    this.depth = -1;
    this.slow = 75;
    this.timeout = 2000;
    this.timeouts = true;
    this.retries = 0;
    this.skip = false;
    this.only = false;
    this.running = false;
    this.elapsed = 0;
    this.context = new Context(this);

    this.stream = stream;
    this.colors = Boolean(stream.isTTY);
    this.windows = false;
    this.bail = false;
    this.grep = null;
    this.fgrep = '';
    this.invert = false;
    this.exclusive = false;
    this.beforeEaches = [];
    this.afterEaches = [];
    this.results = [];
    this.passing = 0;
    this.pending = 0;
    this.failing = 0;
  }

  report(Reporter, options) {
    assert(typeof Reporter === 'function');
    this.reporter = new Reporter(this.stream, options);
    return this;
  }

  matches(name) {
    assert(typeof name === 'string');

    let ret = !this.invert;

    if (this.grep)
      ret = this.grep.test(name);
    else if (this.fgrep)
      ret = name.indexOf(this.fgrep) !== -1;

    if (this.invert)
      ret = !ret;

    return ret;
  }

  async run(funcs) {
    if (typeof funcs === 'function')
      funcs = [funcs];

    assert(Array.isArray(funcs));

    this.results = [];
    this.passing = 0;
    this.pending = 0;
    this.failing = 0;

    this.reporter.colors = this.colors;
    this.reporter.windows = this.windows;

    this.running = true;
    this.elapsed = 0;

    this.reporter.start(this);

    const start = Date.now();

    for (const func of funcs) {
      const suite = Suite.from(this, func);

      if (!await suite.run())
        break;
    }

    this.running = false;
    this.elapsed = Date.now() - start;

    this.reporter.finish(this);

    return Math.min(this.failing, 255);
  }
}

/**
 * Suite
 */

class Suite extends Runnable {
  constructor(parent, name, func) {
    assert((parent instanceof Mocha)
        || (parent instanceof Suite));
    assert(typeof name === 'string');
    assert(typeof func === 'function');

    super();

    this.mocha = parent.mocha;
    this.reporter = parent.mocha.reporter;
    this.suite = this;
    this.parent = parent;
    this.title = name;
    this.name = name;
    this.func = func;
    this.matching = parent.matching || parent.mocha.matches(name);
    this.depth = parent.depth + 1;
    this.slow = parent.slow;
    this.timeout = parent.timeout;
    this.timeouts = parent.timeouts;
    this.retries = parent.retries;
    this.skip = parent.skip;
    this.only = parent.only;
    this.running = false;
    this.elapsed = 0;
    this.context = new Context(this);

    this.befores = [];
    this.afters = [];
    this.beforeEaches = parent.beforeEaches.slice();
    this.afterEaches = parent.afterEaches.slice();
    this.tests = [];
    this.suites = [];

    this.init();
  }

  wrap(method) {
    assert(typeof method === 'function');

    const context = this.context.bind();
    const api = method.bind(this);

    api.enableTimeouts = context.enableTimeouts;

    api.only = (name, func) => {
      if (arguments.length === 0)
        return context.only();
      return api(name, func).only();
    };

    api.retries = context.retries;

    api.skip = (name, func) => {
      if (arguments.length === 0)
        return context.skip();
      return api(name, func).skip();
    };

    api.slow = context.slow;
    api.timeout = context.timeout;

    return api;
  }

  before(func) {
    const hook = new Hook(this, 'before all', func);
    this.befores.push(hook);
  }

  after(func) {
    const hook = new Hook(this, 'after all', func);
    this.afters.push(hook);
  }

  beforeEach(func) {
    const hook = new Hook(this, 'before each', func);
    this.beforeEaches.push(hook);
  }

  afterEach(func) {
    const hook = new Hook(this, 'after each', func);
    this.afterEaches.push(hook);
  }

  describe(name, func) {
    if (name === '')
      throw new TypeError('Suite must have a name.');

    const suite = new Suite(this, name, func);

    this.suites.push(suite);

    return suite.context;
  }

  it(name, func) {
    if (name === '')
      throw new TypeError('Test must have a name.');

    const test = new Test(this, name, func);

    this.tests.push(test);

    return test.context;
  }

  init() {
    const describe = global.describe;
    const before = global.before;
    const after = global.after;
    const beforeEach = global.beforeEach;
    const afterEach = global.afterEach;
    const it = global.it;

    global.before = this.before.bind(this);
    global.after = this.after.bind(this);
    global.beforeEach = this.beforeEach.bind(this);
    global.afterEach = this.afterEach.bind(this);
    global.describe = this.wrap(this.describe);
    global.it = this.wrap(this.it);

    try {
      this.func.call(this.context);
    } finally {
      global.describe = describe;
      global.before = before;
      global.after = after;
      global.beforeEach = beforeEach;
      global.afterEach = afterEach;
      global.it = it;
    }
  }

  total() {
    if (this.skip)
      return 0;

    if (!this.matching)
      return 0;

    let count = 0;

    for (const test of this.tests) {
      if (this.mocha.exclusive && !test.only)
        continue;

      if (!test.matching)
        continue;

      count += 1;
    }

    for (const suite of this.suites)
      count += suite.total();

    return count;
  }

  succeed(test) {
    assert(test instanceof Executable);

    if (test.skip)
      this.mocha.pending += 1;
    else
      this.mocha.passing += 1;

    this.mocha.results.push(test);

    this.reporter.test(test);
  }

  fail(test) {
    assert(test instanceof Executable);

    test.id = this.mocha.failing + 1;

    this.mocha.failing += 1;
    this.mocha.results.push(test);

    this.reporter.test(test);

    return !this.mocha.bail;
  }

  async run() {
    if (this.total() === 0)
      return true;

    this.running = true;
    this.elapsed = 0;

    this.reporter.begin(this);

    const start = Date.now();
    const ok = await this.exec();

    this.running = false;
    this.elapsed = Date.now() - start;

    this.reporter.end(this);

    return ok;
  }

  async exec() {
    for (const hook of this.befores) {
      if (!await hook.run())
        return this.fail(hook);
    }

    for (const test of this.tests) {
      let success = false;

      if (this.mocha.exclusive && !test.only)
        continue;

      if (!test.matching)
        continue;

      for (let retry = 0; retry < test.retries + 1; retry++) {
        if (test.skip) {
          success = true;
          break;
        }

        for (const hook of this.beforeEaches) {
          if (!await hook.run(test))
            return this.fail(hook);
        }

        success = await test.run(retry);

        for (const hook of this.afterEaches) {
          if (!await hook.run(test))
            return this.fail(hook);
        }

        if (success)
          break;
      }

      if (success) {
        this.succeed(test);
      } else {
        if (!this.fail(test))
          return false;
      }

      await wait();
    }

    for (const suite of this.suites) {
      if (!await suite.run())
        return false;
    }

    for (const hook of this.afters) {
      if (!await hook.run())
        return this.fail(hook);
    }

    return true;
  }

  static from(mocha, func) {
    return new this(mocha, '', func);
  }
}

/**
 * Executable
 */

class Executable extends Runnable {
  constructor(parent, name, func) {
    assert(parent instanceof Suite);
    assert(typeof name === 'string');
    assert(typeof func === 'function');

    super();

    this.mocha = parent.mocha;
    this.reporter = parent.reporter;
    this.suite = parent;
    this.parent = parent;
    this.title = name;
    this.name = name;
    this.func = func;
    this.matching = parent.matching || parent.mocha.matches(name);
    this.depth = parent.depth;
    this.slow = parent.slow;
    this.timeout = parent.timeout;
    this.timeouts = parent.timeouts;
    this.retries = parent.retries;
    this.skip = parent.skip;
    this.only = parent.only;
    this.running = false;
    this.elapsed = 0;
    this.context = new Context(this);

    this.id = 0;
    this.retry = 0;
    this.failed = false;
    this.error = null;
    this.stack = '';
  }

  async exec() {
    return new Promise((resolve, reject) => {
      const job = new Job(this, resolve, reject);

      if (this.func.length > 0) {
        const cb = err => job.callback(err);

        try {
          this.func.call(this.context, cb);
        } catch (e) {
          job.reject(e);
          return;
        }
      } else {
        let result;

        try {
          result = this.func.call(this.context);
        } catch (e) {
          job.reject(e);
          return;
        }

        if (!(result instanceof Promise)) {
          job.resolve();
          return;
        }

        result
          .then(_ => job.resolve())
          .catch(err => job.reject(err));
      }

      job.start();
    });
  }

  async run() {
    this.id = 0;
    this.failed = false;
    this.error = null;
    this.stack = '';

    this.running = true;
    this.elapsed = 0;

    const start = Date.now();

    let failed = false;
    let err = null;

    try {
      await this.exec();
    } catch (e) {
      if (e !== skipper) {
        failed = true;
        err = e;
      }
    }

    this.running = false;
    this.elapsed = Date.now() - start;

    if (failed) {
      this.failed = true;
      this.error = castError(err);
      this.stack = formatStack(this.error.stack);
      return false;
    }

    return true;
  }

  toJSON(minimal = false) {
    assert(typeof minimal === 'boolean');

    let err = {};
    let stack = undefined;

    if (this.failed) {
      err = {
        stack: this.stack,
        message: String(this.error.message),
        generatedMessage: this.error.generatedMessage,
        name: String(this.error.name || ''),
        type: this.error.type,
        code: this.error.code,
        actual: this.error.actual,
        expected: this.error.expected,
        operator: this.error.operator
      };

      if (minimal) {
        stack = err.stack;
        err = err.message;
      }
    } else {
      if (minimal) {
        stack = undefined;
        err = undefined;
      }
    }

    return {
      title: this.name,
      fullTitle: this.fullName(),
      duration: this.elapsed,
      currentRetry: this.retry,
      err,
      stack
    };
  }
}

/**
 * Hook
 */

class Hook extends Executable {
  constructor(parent, name, func) {
    super(parent, name, func);
  }

  async run(test) {
    assert(test == null || (test instanceof Test));

    let name = `"${this.title}" hook`;

    if (test) {
      this.context = test.context;

      name += ` for "${test.name}"`;
    } else {
      this.context = this.suite.context;
    }

    this.name = name;

    return super.run();
  }
}

/**
 * Test
 */

class Test extends Executable {
  constructor(parent, name, func) {
    super(parent, name, func);
  }

  async run(retry = 0) {
    assert((retry >>> 0) === retry);
    this.retry = retry;
    return super.run();
  }
}

/**
 * Context
 */

class Context {
  constructor(runnable) {
    assert(runnable instanceof Runnable);
    this.runnable = runnable;
  }

  enableTimeouts(enabled) {
    this.runnable.timeouts = Boolean(enabled);
    return this;
  }

  only() {
    this.runnable.only = true;
    this.runnable.mocha.exclusive = true;
    return this;
  }

  retries(n) {
    this.runnable.retries = n >>> 0;
    return this;
  }

  skip() {
    this.runnable.skip = true;
    if (this.runnable.running)
      throw skipper;
    return this;
  }

  slow(ms) {
    this.runnable.slow = ms >>> 0;
    return this;
  }

  timeout(ms) {
    this.runnable.timeout = ms >>> 0;
    return this;
  }

  bind() {
    return {
      enableTimeouts: this.enableTimeouts.bind(this),
      only: this.only.bind(this),
      retries: this.retries.bind(this),
      skip: this.skip.bind(this),
      slow: this.slow.bind(this),
      timeout: this.timeout.bind(this)
    };
  }
}

/**
 * Job
 */

class Job {
  constructor(test, resolve, reject) {
    assert(test instanceof Executable);
    assert(typeof resolve === 'function');
    assert(typeof reject === 'function');

    this.test = test;
    this.timer = null;
    this.called = false;
    this._resolve = resolve;
    this._reject = reject;
  }

  resolve() {
    if (this.called)
      return;

    this.called = true;
    this.clear();
    this._resolve();
  }

  reject(err) {
    if (this.called)
      return;

    this.called = true;
    this.clear();
    this._reject(err);
  }

  callback(err) {
    if (err)
      this.reject(err);
    else
      this.resolve();
  }

  start() {
    const {timeout, timeouts} = this.test;

    if (this.called)
      return;

    if (!timeouts)
      return;

    if (timeout === 0)
      return;

    assert(this.timer == null);

    this.timer = setTimeout(() => {
      this.reject(new Error(`Timeout of ${timeout}ms exceeded.`));
    }, timeout);
  }

  clear() {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Reporter
 */

class Reporter {
  constructor(stream = new Stream(), options = Object.create(null)) {
    assert(stream && typeof stream.write === 'function');
    assert(options && typeof options === 'object');

    this.stream = stream;
    this.options = options;
    this.colors = false;
    this.windows = false;
  }

  log(str, depth) {
    assert(typeof str === 'string');

    if (!this.colors)
      str = str.replace(/\x1b\[[^m]*m/g, '');

    if (this.windows) {
      str = str.replace(/\u2713/g, '\u221a');
      str = str.replace(/\u2716/g, '\u00d7');
      str = str.replace(/\u2024/g, '.');
    }

    str = indent(str, depth);

    return this.stream.write(str + '\n');
  }

  start(mocha) {
    assert(mocha instanceof Mocha);
  }

  begin(suite) {
    assert(suite instanceof Suite);
  }

  test(test) {
    assert(test instanceof Executable);
  }

  end(suite) {
    assert(suite instanceof Suite);
  }

  finish(mocha) {
    assert(mocha instanceof Mocha);
  }
}

/**
 * SpecReporter
 */

class SpecReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
  }

  begin(suite) {
    assert(suite instanceof Suite);

    if (suite.name) {
      if (!suite.parent.name)
        this.log('', suite.depth);
      this.log(`${suite.name}`, suite.depth);
    }
  }

  test(test) {
    assert(test instanceof Executable);

    if (test.skip) {
      this.log(`  \x1b[36m- ${test.name}\x1b[m`, test.depth);
      return;
    }

    if (test.failed) {
      this.log(`  \x1b[31m${test.id}) ${test.name}\x1b[m `, test.depth);
      return;
    }

    const line = [
      '  ',
      '\x1b[32m\u2713\x1b[m',
      ' ',
      `\x1b[90m${test.name}\x1b[m`
    ];

    if (test.elapsed > test.slow)
      line.push(` \x1b[31m(${test.elapsed}ms)\x1b[m`);
    else if (test.elapsed > (test.slow >>> 1))
      line.push(` \x1b[33m(${test.elapsed}ms)\x1b[m`);

    this.log(line.join(''), test.depth);
  }

  finish(mocha) {
    assert(mocha instanceof Mocha);

    if (mocha.results.length === 0)
      return;

    const elapsed = Math.ceil(mocha.elapsed / 1000);
    const passed = `\x1b[32m${mocha.passing} passing\x1b[m`;
    const time = `\x1b[90m(${elapsed}s)\x1b[m`;

    this.log('');
    this.log(`${passed} ${time}`, 1);

    if (mocha.pending > 0)
      this.log(`\x1b[36m${mocha.pending} pending\x1b[m`, 1);

    if (mocha.failing > 0)
      this.log(`\x1b[31m${mocha.failing} failing\x1b[m`, 1);

    this.log('');

    for (const test of mocha.results) {
      if (!test.failed)
        continue;

      const {suite, error} = test;

      if (suite.name) {
        this.log(`${test.id}) ${suite.name}`, 1);
        this.log(`${test.name}:`, 3);
      } else {
        this.log(`${test.id}) ${test.name}:`, 1);
      }

      const name = String(error.name || 'Error');

      let message = String(error.message);
      let operator = error.operator;

      if (error.generatedMessage && diff.isDiffable(error)) {
        if (message.indexOf('\n') !== -1) {
          if (operator == null)
            operator = 'assertion';
          else if (operator === '==')
            operator = 'equal';
          else if (operator === '!=')
            operator = 'notEqual';

          message = `${operator} failed.`;
        }
      }

      this.log('');
      this.log(`\x1b[31m${name}: ${message}\x1b[m`, 3);

      if (diff.isDiffable(error)) {
        this.log('');
        this.log(diff.createDiff(error), 3);
      }

      this.log('');
      this.log(`\x1b[90m${test.stack}\x1b[m`, 3);
      this.log('');
    }
  }
}

/**
 * JSONReporter
 */

class JSONReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
    this.time = 0;
    this.suites = 0;
    this.pending = [];
    this.failures = [];
    this.passes = [];
    this.tests = [];
  }

  json(json) {
    this.log(JSON.stringify(json, null, 2));
  }

  start(mocha) {
    assert(mocha instanceof Mocha);

    this.time = Date.now();
    this.suites = 0;
    this.pending = [];
    this.failures = [];
    this.passes = [];
    this.tests = [];
  }

  begin(suite) {
    assert(suite instanceof Suite);

    if (suite.name)
      this.suites += 1;
  }

  test(test) {
    assert(test instanceof Executable);

    const json = test.toJSON();

    if (test.skip)
      this.pending.push(json);
    else if (test.failed)
      this.failures.push(json);
    else
      this.passes.push(json);

    this.tests.push(json);
  }

  finish(mocha) {
    assert(mocha instanceof Mocha);

    const end = Date.now();

    this.json({
      stats: {
        suites: this.suites,
        tests: this.tests.length,
        passes: this.passes.length,
        pending: this.pending.length,
        failures: this.failures.length,
        start: new Date(this.time).toISOString(),
        end: new Date(end).toISOString(),
        duration: end - this.time
      },
      tests: this.tests,
      pending: this.pending,
      failures: this.failures,
      passes: this.passes
    });
  }
}

/**
 * JSONStreamReporter
 */

class JSONStreamReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
    this.time = 0;
    this.suites = 0;
    this.pending = 0;
    this.failures = 0;
    this.passes = 0;
    this.tests = 0;
  }

  json(json) {
    this.log(JSON.stringify(json));
  }

  start(mocha) {
    assert(mocha instanceof Mocha);

    this.time = Date.now();
    this.suites = 0;
    this.pending = 0;
    this.failures = 0;
    this.passes = 0;
    this.tests = 0;
    this.json(['start', { total: null }]);
  }

  begin(suite) {
    assert(suite instanceof Suite);

    if (suite.name)
      this.suites += 1;
  }

  test(test) {
    assert(test instanceof Executable);

    if (test.skip) {
      this.pending += 1;
      return;
    }

    if (test.failed)
      this.failures += 1;
    else
      this.passes += 1;

    this.json([
      test.failed ? 'fail' : 'pass',
      test.toJSON(true)
    ]);
  }

  finish(mocha) {
    assert(mocha instanceof Mocha);

    const end = Date.now();

    this.json(['end', {
      suites: this.suites,
      tests: this.tests,
      passes: this.passes,
      pending: this.pending,
      failures: this.failures,
      start: new Date(this.time).toISOString(),
      end: new Date(end).toISOString(),
      duration: end - this.time
    }]);
  }
}

/**
 * Stream
 */

class Stream {
  constructor() {
    this.readable = false;
    this.writable = false;
    this.isTTY = false;
  }

  on(event, handler) {
    return this;
  }

  addListener(event, handler) {
    return this;
  }

  once(event, handler) {
    return this;
  }

  off(event, handler) {
    return this;
  }

  removeListener(event, handler) {
    return this;
  }

  removeAllListeners(event) {
    return this;
  }

  emit(event, ...args) {
    return this;
  }

  prependListener(event, handler) {
    return this;
  }

  prependOnceListener(event, handler) {
    return this;
  }

  listeners() {
    return [];
  }

  pause() {
    return this;
  }

  resume() {
    return this;
  }

  close() {
    return this;
  }

  destroy() {
    return this;
  }

  write(data) {
    return true;
  }

  end(data) {
    if (data != null)
      return this.write(data);
    return true;
  }

  pipe(dest) {
    return dest;
  }

  onFlush(func) {
    assert(typeof func === 'function');
    func();
  }
}

/**
 * SendStream
 */

class SendStream extends Stream {
  constructor(send, isTTY = false) {
    assert(typeof send === 'function');
    assert(typeof isTTY === 'boolean');

    super();

    this.send = send;
    this.writable = true;
    this.isTTY = isTTY;
    this.sending = false;
    this.buffer = '';
    this.onSend = this._onSend.bind(this);
    this.flushers = [];
  }

  error(err) {
    if (global.onerror) {
      global.onerror(err);
      return;
    }

    this.emit('error', err);
  }

  write(str) {
    str = String(str);

    if (this.sending) {
      this.buffer += str;
      return false;
    }

    this.sending = true;
    this.send(str, this.onSend);

    return true;
  }

  _onSend(err) {
    if (err)
      this.error(err);

    this.sending = false;

    if (this.buffer.length === 0) {
      this.doFlush();
      return;
    }

    const str = this.buffer;

    this.buffer = '';
    this.write(str);
  }

  onFlush(func) {
    assert(typeof func === 'function');

    if (this.buffer.length === 0) {
      func();
      return;
    }

    this.flushers.push(func);
  }

  doFlush() {
    if (this.flushers.length === 0)
      return;

    const flushers = this.flushers.slice();

    this.flushers.length = 0;

    for (const func of flushers)
      func();
  }
}

/**
 * ConsoleStream
 */

class ConsoleStream extends Stream {
  constructor(console) {
    super();

    if (console == null)
      console = global.console;

    assert(console, 'Must pass a console.');
    assert(typeof console.log === 'function');

    this.writable = true;
    this.isTTY = false;
    this.console = console;
    this.buffer = '';
    this.init();
  }

  init() {
    const {chrome} = global;
    const browser = typeof process === 'object' && process
                  ? process.browser
                  : false;

    if (!browser || (chrome && chrome.app))
      this.isTTY = true;
  }

  write(str) {
    str = String(str);

    if (str.length === 0)
      return true;

    if (this.isTTY)
      str = str.replace(/\x1b\[m/g, '\x1b[0m');
    else
      str = str.replace(/\x1b\[[^m]*m/g, '');

    const lines = str.split('\n');

    if (lines.length > 1) {
      lines[0] = this.buffer + lines[0];
      for (let i = 0; i < lines.length - 1; i++)
        this.console.log(lines[i]);
      this.buffer = '';
    }

    this.buffer += lines[lines.length - 1];

    return true;
  }
}

/**
 * DOMStream
 */

class DOMStream extends Stream {
  constructor(node) {
    super();

    if (node == null) {
      if (global.document)
        node = global.document.body;
    }

    assert(node, 'Must pass a DOM element.');

    this.writable = true;
    this.isTTY = true;
    this.document = global.document;
    this.node = node;
    this.init();
  }

  init() {
    if (this.node.style) {
      this.node.style.cssText = `font-family: ${style.font};`;
      this.node.style.cssText = `color: ${style.fg};`;
      this.node.style.cssText = `background-color: ${style.bg};`;
    }
    this.node.innerHTML = '';
  }

  scroll() {
    const {document} = this;

    let node = this.node;

    if (document && document.body && node === document.body)
      node = document.scrollingElement || document.body;

    node.scrollTop = node.scrollHeight;
  }

  write(str) {
    str = String(str);

    // Escape HTML.
    str = str.replace(/&/g, '&amp;');
    str = str.replace(/</g, '&lt;');
    str = str.replace(/>/g, '&gt;');
    str = str.replace(/"/g, '&quot;');
    str = str.replace(/'/g, '&#39;');
    str = str.replace(/ /g, '&nbsp;');
    str = str.replace(/\n/g, '<br>');

    // Convert CSI codes to HTML.
    str = str.replace(/\x1b\[([^m]*)m/g, replaceCSI);

    if (this.document && this.node.appendChild) {
      const node = this.document.createElement('span');
      node.innerHTML = str;
      this.node.appendChild(node);
    } else {
      this.node.innerHTML += str;
    }

    this.scroll();

    return true;
  }
}

/*
 * Helpers
 */

function assert(ok, msg) {
  if (!ok) {
    const err = new Error(msg || 'Assertion failure');

    if (Error.captureStackTrace)
      Error.captureStackTrace(err, assert);

    throw err;
  }
}

async function wait() {
  return new Promise(r => setImmediate(r));
}

function indent(str, depth) {
  if (depth == null)
    depth = 0;

  assert(typeof str === 'string');
  assert((depth >>> 0) === depth);

  if (depth === 0)
    return str;

  let spaces = '';

  for (let i = 0; i < depth * 2; i++)
    spaces += ' ';

  return str.replace(/^/gm, spaces);
}

function castError(err) {
  if (err == null || typeof err !== 'object')
    err = String(err);

  if (typeof err === 'string')
    err = new Error(err);

  assert(err && typeof err === 'object');

  return err;
}

function formatStack(stack) {
  let str = String(stack);
  let index = str.indexOf('\n    at ');

  if (index !== -1)
    str = str.substring(index + 1);

  if (typeof __filename === 'string') {
    index = str.indexOf(`(${__filename}:`);

    while (index >= 0 && str[index] !== '\n')
      index -= 1;

    if (index !== -1)
      str = str.substring(0, index);
  }

  return str.replace(/^ +/gm, '');
}

function replaceCSI(_, str) {
  assert(typeof str === 'string');

  let out = '';

  for (const code of str.split(';'))
    out += convertCSI(code);

  return out;
}

function convertCSI(str) {
  let num = str >>> 0;

  if (num === 0
      || num === 22
      || num === 23
      || num === 24
      || num === 29
      || num === 39
      || num === 49) {
    return '</span>';
  }

  if (num === 1)
    return '<span style="font-weight:bold">';

  if (num === 2)
    return '<span style="font-style:oblique 10deg">';

  if (num === 3)
    return '<span style="font-style:italic">';

  if (num === 4)
    return '<span style="text-decoration:underline">';

  if (num === 9)
    return '<span style="text-decoration:line-through">';

  let prop = '';

  if (num >= 30 && num <= 37) {
    prop = 'color';
    num -= 30;
  } else if (num >= 40 && num <= 47) {
    prop = 'background-color';
    num -= 40;
  } else if (num >= 90 && num <= 97) {
    prop = 'color';
    num -= 90;
    num += 8;
  } else if (num >= 100 && num <= 107) {
    prop = 'background-color';
    num -= 100;
    num += 8;
  }

  if (num >= style.colors.length)
    return '';

  const value = style.colors[num];

  return `<span style="${prop}:${value}">`;
}

/*
 * Expose
 */

exports.style = style;
exports.Mocha = Mocha;
exports.Suite = Suite;
exports.Executable = Executable;
exports.Hook = Hook;
exports.Test = Test;
exports.Context = Context;
exports.Job = Job;
exports.Reporter = Reporter;
exports.SpecReporter = SpecReporter;
exports.JSONReporter = JSONReporter;
exports.JSONStreamReporter = JSONStreamReporter;
exports.Stream = Stream;
exports.SendStream = SendStream;
exports.ConsoleStream = ConsoleStream;
exports.DOMStream = DOMStream;
