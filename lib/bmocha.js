/*!
 * bmocha.js - minimal mocha implementation
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 *
 * Parts of this software are based on mochajs/mocha:
 *   Copyright (c) 2011-2018 JS Foundation and contributors
 *   https://github.com/mochajs/mocha
 */

/* eslint no-control-regex: "off" */
/* eslint no-ex-assign: "off" */

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

const PENDING = new Error('pending');

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
    this.stats = null;
    this.context = null;
  }

  names() {
    const names = [this.name];

    let parent = this.parent;

    while (parent) {
      if (parent.name)
        names.push(parent.name);
      parent = parent.parent;
    }

    return names.reverse();
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
  constructor(stream = new Stream(), reporter, options) {
    assert(stream && typeof stream.write === 'function');

    super();

    this.mocha = this;
    this.reporter = null;
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
    this.stats = new Stats();
    this.context = new Context(this);

    this.global = true;
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

    this.before = this._before.bind(this);
    this.after = this._after.bind(this);
    this.beforeEach = this._beforeEach.bind(this);
    this.afterEach = this._afterEach.bind(this);
    this.describe = this._describe.bind(this);
    this.it = this._it.bind(this);

    this.report(reporter, options);
  }

  _suite() {
    if (!this.suite)
      throw new Error('No suite currently initializing.');
    return this.suite;
  }

  _before(name, func) {
    return this._suite().before(name, func);
  }

  _after(name, func) {
    return this._suite().after(name, func);
  }

  _beforeEach(name, func) {
    return this._suite().beforeEach(name, func);
  }

  _afterEach(name, func) {
    return this._suite().afterEach(name, func);
  }

  _describe(name, func) {
    return this._suite().describe(name, func);
  }

  _it(name, func) {
    return this._suite().it(name, func);
  }

  report(reporter, options) {
    const Report = Reporter.get(reporter);
    this.reporter = new Report(this.stream, options);
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
    if (!Array.isArray(funcs))
      funcs = [funcs];

    this.results = [];
    this.stats = new Stats();

    this.reporter.stats = this.stats;
    this.reporter.colors = this.colors;
    this.reporter.windows = this.windows;

    this.running = true;
    this.stats.mark();

    if (this.reporter.buffer) {
      const suites = [];

      for (const func of funcs) {
        const suite = Suite.from(this, func);
        this.stats.total += suite.total();
        suites.push(suite);
      }

      this.reporter.start(this);

      for (const suite of suites) {
        if (!await suite.run())
          break;
      }
    } else {
      this.reporter.start(this);

      for (const func of funcs) {
        const suite = Suite.from(this, func);

        this.stats.total += suite.total();

        if (!await suite.run())
          break;
      }
    }

    this.stats.mark();
    this.running = false;

    this.reporter.end(this);

    return Math.min(this.stats.failures, 255);
  }
}

/**
 * MochaLocal
 */

class MochaLocal extends Mocha {
  constructor(stream, Reporter, options) {
    super(stream, Reporter, options);

    this.global = false;
    this.triggered = false;

    this.suite = new Suite(this);
    this.suite.inject(this.describe);
    this.suite.inject(this.it);
  }

  _suite() {
    const suite = super._suite();

    if (!this.triggered) {
      setImmediate(() => this.run());
      this.triggered = true;
    }

    return suite;
  }

  exit(code) {
    code >>>= 0;

    if (code !== 0)
      throw new Error(`Exit code: ${code}`);
  }

  async exec() {
    const code = await super.run(this.suite);
    this.exit(code);
  }

  async run() {
    try {
      await this.exec();
    } catch (err) {
      if (err && err.stack)
        err = err.stack;

      this.stream.write(err + '\n');
      this.exit(1);
    }
  }
}

/**
 * Suite
 */

class Suite extends Runnable {
  constructor(parent, name = '', func = null) {
    assert((parent instanceof Mocha)
        || (parent instanceof Suite));
    assert(typeof name === 'string');
    assert(func == null || typeof func === 'function');

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
    this.stats = new Stats();
    this.context = new Context(this);

    this.befores = [];
    this.afters = [];
    this.beforeEaches = parent.beforeEaches.slice();
    this.afterEaches = parent.afterEaches.slice();
    this.tests = [];
    this.suites = [];

    if (func)
      this.init();
  }

  inject(method) {
    assert(typeof method === 'function');

    const enableTimeouts = method.enableTimeouts;
    const only = method.only;
    const retries = method.retries;
    const skip = method.skip;
    const slow = method.slow;
    const timeout = method.timeout;

    this.context.inject(method);

    method.only = (name, func) => {
      if (arguments.length === 0)
        return this.context.only();
      return method(name, func).only();
    };

    method.skip = (name, func) => {
      if (arguments.length === 0)
        return this.context.skip();
      return method(name, func).skip();
    };

    return {
      enableTimeouts,
      only,
      retries,
      skip,
      slow,
      timeout
    };
  }

  uninject(method, save) {
    assert(typeof method === 'function');
    assert(save && typeof save === 'object');

    method.enableTimeouts = save.enableTimeouts;
    method.only = save.only;
    method.retries = save.retries;
    method.skip = save.skip;
    method.slow = save.slow;
    method.timeout = save.timeout;

    return method;
  }

  globalize() {
    const describe = global.describe;
    const before = global.before;
    const after = global.after;
    const beforeEach = global.beforeEach;
    const afterEach = global.afterEach;
    const it = global.it;

    if (this.mocha.global) {
      global.before = this.mocha.before;
      global.after = this.mocha.after;
      global.beforeEach = this.mocha.beforeEach;
      global.afterEach = this.mocha.afterEach;
      global.describe = this.mocha.describe;
      global.it = this.mocha.it;
    }

    return {
      describe,
      before,
      after,
      beforeEach,
      afterEach,
      it
    };
  }

  unglobalize(save) {
    assert(save && typeof save === 'object');

    if (this.mocha.global) {
      if (save.before === undefined)
        delete global.before;
      else
        global.before = save.before;

      if (save.after === undefined)
        delete global.after;
      else
        global.after = save.after;

      if (save.beforeEach === undefined)
        delete global.beforeEach;
      else
        global.beforeEach = save.beforeEach;

      if (save.afterEach === undefined)
        delete global.afterEach;
      else
        global.afterEach = save.afterEach;

      if (save.describe === undefined)
        delete global.describe;
      else
        global.describe = save.describe;

      if (save.it === undefined)
        delete global.it;
      else
        global.it = save.it;
    }
  }

  before(name, func) {
    if (typeof name === 'function')
      [name, func] = [func, name];
    const hook = new Hook(this, 'before all', name, func);
    this.befores.push(hook);
  }

  after(name, func) {
    if (typeof name === 'function')
      [name, func] = [func, name];
    const hook = new Hook(this, 'after all', name, func);
    this.afters.push(hook);
  }

  beforeEach(name, func) {
    if (typeof name === 'function')
      [name, func] = [func, name];
    const hook = new Hook(this, 'before each', name, func);
    this.beforeEaches.push(hook);
  }

  afterEach(name, func) {
    if (typeof name === 'function')
      [name, func] = [func, name];
    const hook = new Hook(this, 'after each', name, func);
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
    if (!this.func)
      throw new Error('No function provided to suite.');

    const suite = this.mocha.suite;
    const describe = this.inject(this.mocha.describe);
    const it = this.inject(this.mocha.it);
    const global = this.globalize();

    this.mocha.suite = this;

    try {
      const result = this.func.call(this.context, this.context);

      if (result instanceof Promise)
        throw new Error('Cannot resolve asynchronous test suites.');
    } finally {
      this.unglobalize(global);
      this.uninject(this.mocha.it, it);
      this.uninject(this.mocha.describe, describe);
      this.mocha.suite = suite;
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
      this.mocha.stats.pending += 1;
    else
      this.mocha.stats.passes += 1;

    this.mocha.stats.tests += 1;
    this.mocha.results.push(test);

    this.reporter.testEnd(test);
  }

  fail(test) {
    assert(test instanceof Executable);

    test.id = this.mocha.stats.failures + 1;

    this.mocha.stats.failures += 1;
    this.mocha.stats.tests += 1;
    this.mocha.results.push(test);

    this.reporter.testEnd(test);

    return !this.mocha.bail;
  }

  async run() {
    if (this.total() === 0)
      return true;

    this.stats = new Stats();

    this.running = true;
    this.stats.mark();

    if (this.name)
      this.mocha.stats.suites += 1;

    this.reporter.suiteStart(this);

    const ok = await this.exec();

    this.stats.mark();
    this.running = false;

    this.reporter.suiteEnd(this);

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

      this.reporter.testStart(test);

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
    assert(mocha instanceof Mocha);

    if (func instanceof Suite) {
      assert(func.mocha === mocha);
      assert(!func.name);
      return func;
    }

    assert(typeof func === 'function');

    return new Suite(mocha, '', func);
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
    this.stats = new Stats();
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

      let result;

      if (this.func.length > 0) {
        const cb = err => job.callback(err);

        this.context.inject(cb);

        try {
          result = this.func.call(this.context, cb);
        } catch (e) {
          job.reject(e);
          return;
        }

        if (!(result instanceof Promise)) {
          job.start();
          return;
        }
      } else {
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
      }

      result
        .then(_ => job.resolve())
        .catch(err => job.reject(err));

      job.start();
    });
  }

  async run() {
    this.id = 0;
    this.failed = false;
    this.error = null;
    this.stack = '';
    this.stats = new Stats();

    this.running = true;
    this.stats.mark();

    let failed = false;
    let err = null;

    try {
      await this.exec();
    } catch (e) {
      if (e !== PENDING) {
        failed = true;
        err = e;
      }
    }

    this.stats.mark();
    this.running = false;

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
      duration: this.stats.duration,
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
  constructor(parent, title, desc, func) {
    if (desc == null)
      desc = '';

    assert(typeof title === 'string');
    assert(typeof desc === 'string');
    assert(typeof func === 'function');

    let name = `"${title}" hook`;

    if (!desc && func.name)
      desc = func.name;

    if (desc)
      name += `: ${desc}`;

    super(parent, name, func);
  }

  async run(test) {
    assert(test == null || (test instanceof Test));

    if (test) {
      this.context = test.context;
      this.name = `${this.title} for "${test.name}"`;
    } else {
      this.context = this.suite.context;
      this.name = this.title;
    }

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
      throw PENDING;
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

  before(name, func) {
    return this.runnable.mocha.before(name, func);
  }

  after(name, func) {
    return this.runnable.mocha.after(name, func);
  }

  beforeEach(name, func) {
    return this.runnable.mocha.beforeEach(name, func);
  }

  afterEach(name, func) {
    return this.runnable.mocha.afterEach(name, func);
  }

  describe(name, func) {
    return this.runnable.mocha.describe(name, func);
  }

  it(name, func) {
    return this.runnable.mocha.it(name, func);
  }

  inject(func) {
    assert(typeof func === 'function');

    func.enableTimeouts = this.enableTimeouts.bind(this);
    func.only = this.only.bind(this);
    func.retries = this.retries.bind(this);
    func.skip = this.skip.bind(this);
    func.slow = this.slow.bind(this);
    func.timeout = this.timeout.bind(this);

    return func;
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

/*
 * Stats
 */

class Stats {
  constructor() {
    this.start = 0;
    this.end = 0;
    this.duration = 0;
    this.suites = 0;
    this.passes = 0;
    this.pending = 0;
    this.failures = 0;
    this.tests = 0;
    this.total = 0;
  }

  get elapsed() {
    if (this.end === 0)
      return Math.max(0, Date.now() - this.start);
    return this.duration;
  }

  mark() {
    if (this.start === 0) {
      this.start = Date.now();
      this.end = 0;
      this.duration = 0;
    } else {
      this.end = Date.now();
      this.duration = Math.max(0, this.end - this.start);
    }
    return this;
  }

  toJSON() {
    return {
      suites: this.suites,
      tests: this.tests,
      passes: this.passes,
      pending: this.pending,
      failures: this.failures,
      start: new Date(this.start).toISOString(),
      end: new Date(this.end).toISOString(),
      duration: this.duration
    };
  }
}

/**
 * Reporter
 */

class Reporter {
  constructor(stream = new Stream(), options = Object.create(null)) {
    assert(stream && typeof stream.write === 'function');
    assert(options && typeof options === 'object');

    this.stats = new Stats();
    this.stream = stream;
    this.options = options;
    this.colors = false;
    this.windows = false;
  }

  get id() {
    return this.constructor.id;
  }

  get buffer() {
    return this.constructor.buffer;
  }

  get isTTY() {
    return this.stream.isTTY && typeof this.stream.cursorTo === 'function';
  }

  get columns() {
    if (typeof this.stream.columns === 'number')
      return this.stream.columns;
    return 75;
  }

  get width() {
    return (this.columns * 0.75) | 0;
  }

  write(str) {
    str = String(str);

    if (!this.isTTY)
      str = str.replace(/\x1b\[[^a-zA-Z]*[a-ln-zA-LN-Z]/g, '');

    if (!this.colors)
      str = str.replace(/\x1b\[[^m]*m/g, '');

    if (this.windows) {
      str = str.replace(/\u2713/g, '\u221a');
      str = str.replace(/\u2716/g, '\u00d7');
      str = str.replace(/\u2024/g, '.');
    }

    return this.stream.write(str);
  }

  log(str, depth) {
    return this.write(indent(str, depth) + '\n');
  }

  hide() {
    if (this.isTTY)
      this.write('\x1b[?25l');
  }

  show() {
    if (this.isTTY)
      this.write('\x1b[?25h');
  }

  deleteLine() {
    if (this.isTTY)
      this.write('\x1b[2K');
  }

  beginningOfLine() {
    if (this.isTTY)
      this.write('\x1b[0G');
  }

  carriage() {
    if (this.isTTY) {
      this.deleteLine();
      this.beginningOfLine();
    } else {
      this.write('\r');
    }
  }

  cursorUp(n) {
    if (this.isTTY)
      this.write(`\x1b[${n}A`);
  }

  cursorDown(n) {
    if (this.isTTY)
      this.write(`\x1b[${n}B`);
  }

  color(col, str) {
    if (!this.colors)
      return this.write(str);
    return this.write(`\x1b[${col}m${str}\x1b[m`);
  }

  start(mocha) {
    assert(mocha instanceof Mocha);
  }

  suiteStart(suite) {
    assert(suite instanceof Suite);
  }

  testStart(test) {
    assert(test instanceof Executable);
  }

  testEnd(test) {
    assert(test instanceof Executable);
  }

  suiteEnd(suite) {
    assert(suite instanceof Suite);
  }

  end(mocha) {
    assert(mocha instanceof Mocha);
  }

  epilogue(mocha) {
    assert(mocha instanceof Mocha);

    const stats = this.stats;

    if (stats.tests === 0)
      return;

    const duration = stats.duration >= 1000
      ? Math.ceil(stats.duration / 1000) + 's'
      : stats.duration + 'ms';

    const passed = `\x1b[32m${stats.passes} passing\x1b[m`;
    const time = `\x1b[90m(${duration})\x1b[m`;

    this.log('');
    this.log(`${passed} ${time}`, 1);

    if (stats.pending > 0)
      this.log(`\x1b[36m${stats.pending} pending\x1b[m`, 1);

    if (stats.failures > 0)
      this.log(`\x1b[31m${stats.failures} failing\x1b[m`, 1);

    this.log('');

    for (const test of mocha.results) {
      if (!test.failed)
        continue;

      const {error} = test;
      const names = test.names();

      for (let i = 0; i < names.length; i++) {
        const depth = 1 + i;

        let name = names[i];

        if (i === names.length - 1)
          name += ':';

        if (i === 0)
          this.log(`${test.id}) ${name}`, depth);
        else
          this.log(`   ${name}`, depth);
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

  static get(reporter) {
    if (reporter == null)
      return SpecReporter;

    if (typeof reporter === 'string') {
      switch (reporter) {
        case 'dot':
          reporter = DotReporter;
          break;
        case 'json':
          reporter = JSONReporter;
          break;
        case 'json-stream':
          reporter = JSONStreamReporter;
          break;
        case 'landing':
          reporter = LandingReporter;
          break;
        case 'list':
          reporter = ListReporter;
          break;
        case 'min':
          reporter = MinReporter;
          break;
        case 'nyan':
          reporter = NyanReporter;
          break;
        case 'progress':
          reporter = ProgressReporter;
          break;
        case 'spec':
          reporter = SpecReporter;
          break;
        default:
          throw new Error(`Unknown reporter: ${reporter}.`);
      }
    }

    assert(typeof reporter === 'function');
    assert(typeof reporter.id === 'string');
    assert(typeof reporter.buffer === 'boolean');

    return reporter;
  }
}

Reporter.id = '';
Reporter.buffer = false;

/**
 * DotReporter
 */

class DotReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
    this.n = -1;
  }

  start(mocha) {
    this.n = -1;
    this.write('\n');
  }

  testEnd(test) {
    if (test.skip) {
      if (++this.n % this.width === 0)
        this.write('\n  ');
      this.color(36, ',');
      return;
    }

    if (test.fail) {
      if (++this.n % this.width === 0)
        this.write('\n  ');
      this.color(31, '!');
      return;
    }

    if (++this.n % this.width === 0)
      this.write('\n  ');

    if (test.stats.duration > test.slow)
      this.color(31, '.');
    else if (test.stats.duration > (test.slow >>> 1))
      this.color(33, '.');
    else
      this.color(90, '.');
  }

  end(mocha) {
    this.write('\n');
    this.epilogue(mocha);
  }
}

DotReporter.id = 'dot';
DotReporter.buffer = false;

/**
 * JSONReporter
 */

class JSONReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
    this.pending = [];
    this.failures = [];
    this.passes = [];
    this.tests = [];
  }

  json(json) {
    this.log(JSON.stringify(json, null, 2));
  }

  start(mocha) {
    this.pending = [];
    this.failures = [];
    this.passes = [];
    this.tests = [];
  }

  testEnd(test) {
    const json = test.toJSON();

    if (test.skip)
      this.pending.push(json);
    else if (test.failed)
      this.failures.push(json);
    else
      this.passes.push(json);

    this.tests.push(json);
  }

  end(mocha) {
    this.json({
      stats: this.stats.toJSON(),
      tests: this.tests,
      pending: this.pending,
      failures: this.failures,
      passes: this.passes
    });
  }
}

JSONReporter.id = 'json';
JSONReporter.buffer = false;

/**
 * JSONStreamReporter
 */

class JSONStreamReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
  }

  json(json) {
    this.log(JSON.stringify(json));
  }

  start(mocha) {
    this.json(['start', { total: this.stats.total }]);
  }

  testEnd(test) {
    this.json([
      test.failed ? 'fail' : 'pass',
      test.toJSON(true)
    ]);
  }

  end(mocha) {
    this.json(['end', this.stats.toJSON()]);
  }
}

JSONStreamReporter.id = 'json-stream';
JSONStreamReporter.buffer = true;

/**
 * LandingReporter
 */

class LandingReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);

    this.crashed = -1;
    this.n = 0;
  }

  runway() {
    const buf = Array(this.width).join('-');
    this.color(90, `  ${buf}`);
  }

  start(mocha) {
    this.crashed = -1;
    this.n = 0;
    this.write('\n\n\n  ');
    this.hide();
  }

  testEnd(test) {
    const col = this.crashed === -1
      ? (this.width * ++this.n / this.stats.total) | 0
      : this.crashed;

    let plane = 0;

    if (test.failed) {
      plane = 31;
      this.crashed = col;
    }

    if (this.isTTY)
      this.write(`\x1b[${this.width + 1}D\x1b[2A`);

    this.runway();
    this.write('\n  ');
    this.color(90, Array(col).join('⋅'));
    this.color(plane, '\u2708');
    this.color(90, Array(this.width - col).join('⋅') + '\n');
    this.runway();
    this.write('\x1b[m');
  }

  end(mocha) {
    this.show();
    this.write('\n');
    this.epilogue(mocha);
  }
}

LandingReporter.id = 'landing';
LandingReporter.buffer = true;

/**
 * ListReporter
 */

class ListReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
  }

  start(mocha) {
    this.write('\n');
  }

  testStart(test) {
    if (this.isTTY)
      this.color(90, `    ${test.fullName()}: `);
  }

  testEnd(test) {
    if (test.skip) {
      if (this.isTTY)
        this.carriage();
      this.color(32, '  -');
      this.color(36, ` ${test.fullName()}`);
      this.write('\n');
      return;
    }

    if (test.fail) {
      if (this.isTTY)
        this.carriage();
      this.color(31, `  ${test.id}) ${test.fullName()}`);
      this.write('\n');
      return;
    }

    let color;

    if (test.stats.duration > test.slow)
      color = 31;
    else if (test.stats.duration > (test.slow >>> 1))
      color = 33;
    else
      color = 90;

    if (this.isTTY)
      this.carriage();

    this.color(32, '  \u2713');
    this.color(90, ` ${test.fullName()}: `);
    this.color(color, `${test.stats.duration}ms`);
    this.write('\n');
  }

  end(mocha) {
    this.epilogue(mocha);
  }
}

ListReporter.id = 'list';
ListReporter.buffer = false;

/**
 * MinReporter
 */

class MinReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
  }

  start(mocha) {
    this.write('\x1b[2J');
    this.write('\x1b[1;3H');
  }

  end(mocha) {
    this.epilogue(mocha);
  }
}

MinReporter.id = 'min';
MinReporter.buffer = false;

/**
 * NyanReporter
 */

class NyanReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);

    this.nyanCatWidth = 11;
    this.colorIndex = 0;
    this.numberOfLines = 4;
    this.rainbowColors = this.generateColors();
    this.scoreboardWidth = 7;
    this.tick = 0;
    this.trajectories = [[], [], [], []];
  }

  start(mocha) {
    this.colorIndex = 0;
    this.tick = 0;
    this.trajectories = [[], [], [], []];

    this.hide();
    this.draw();
  }

  testEnd(test) {
    this.draw();
  }

  end(mocha) {
    this.show();

    for (let i = 0; i < this.numberOfLines; i++)
      this.write('\n');

    this.epilogue(mocha);
  }

  draw() {
    this.appendRainbow();
    this.drawScoreboard();
    this.drawRainbow();
    this.drawNyanCat();
    this.tick = !this.tick;
  }

  drawScoreboard() {
    const stats = this.stats;

    const draw = (color, n) => {
      this.write(' ');
      this.color(color, n);
      this.write('\n');
    };

    draw(32, stats.passes);
    draw(31, stats.failures);
    draw(36, stats.pending);

    this.write('\n');

    this.cursorUp(this.numberOfLines);
  }

  appendRainbow() {
    const segment = this.tick ? '_' : '-';
    const rainbowified = this.rainbowify(segment);
    const trajectoryWidthMax = this.width - this.nyanCatWidth;

    for (let index = 0; index < this.numberOfLines; index++) {
      const trajectory = this.trajectories[index];

      if (trajectory.length >= trajectoryWidthMax)
        trajectory.shift();

      trajectory.push(rainbowified);
    }
  }

  drawRainbow() {
    for (const line of this.trajectories) {
      this.write(`\x1b[${this.scoreboardWidth}C`);
      this.write(line.join(''));
      this.write('\n');
    }

    this.cursorUp(this.numberOfLines);
  }

  drawNyanCat() {
    const startWidth = this.scoreboardWidth + this.trajectories[0].length;
    const dist = `\x1b[${startWidth}C`;

    let padding = '';
    let tail = '';

    if (this.isTTY)
      this.write(dist);

    this.write('_,------,');
    this.write('\n');

    if (this.isTTY)
      this.write(dist);

    padding = this.tick ? '  ' : '   ';

    this.write(`_|${padding}/\\_/\\ `);
    this.write('\n');

    if (this.isTTY)
      this.write(dist);

    padding = this.tick ? '_' : '__';
    tail = this.tick ? '~' : '^';

    this.write(`${tail}|${padding}${this.face()} `);
    this.write('\n');

    if (this.isTTY)
      this.write(dist);

    padding = this.tick ? ' ' : '  ';

    this.write(`${padding}""  "" `);
    this.write('\n');

    this.cursorUp(this.numberOfLines);
  }

  face() {
    const stats = this.stats;

    if (stats.failures > 0)
      return '( x .x)';

    if (stats.pending > 0)
      return '( o .o)';

    if (stats.passes > 0)
      return '( ^ .^)';

    return '( - .-)';
  }

  generateColors() {
    const colors = [];

    for (let i = 0; i < 6 * 7; i++) {
      const pi3 = Math.floor(Math.PI / 3);
      const n = i * (1.0 / 6);
      const r = Math.floor(3 * Math.sin(n) + 3);
      const g = Math.floor(3 * Math.sin(n + 2 * pi3) + 3);
      const b = Math.floor(3 * Math.sin(n + 4 * pi3) + 3);
      colors.push(36 * r + 6 * g + b + 16);
    }

    return colors;
  }

  rainbowify(str) {
    if (!this.colors)
      return str;

    const len = this.rainbowColors.length;
    const color = this.rainbowColors[this.colorIndex % len];

    this.colorIndex += 1;

    return `\x1b[38;5;${color}m${str}\x1b[m`;
  }
}

NyanReporter.id = 'nyan';
NyanReporter.buffer = false;

/**
 * ProgressReporter
 */

class ProgressReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
    this.open = options.open || '[';
    this.complete = options.complete || '\u25ac';
    this.incomplete = options.incomplete || '.';
    this.close = options.close || ']';
    this.verbose = options.verbose || false;
    this.n = -1;
  }

  start(mocha) {
    this.n = -1;
    this.write('\n');
    this.hide();
  }

  testEnd(test) {
    const stats = this.stats;
    const percent = stats.tests / stats.total;
    const width = this.width;
    const n = (width * percent) | 0;
    const i = width - n;

    if (n === this.n && !this.verbose)
      return;

    this.n = n;

    this.carriage();

    if (this.isTTY)
      this.write('\u001b[J');

    this.color(90, `  ${this.open}`);
    this.write(Array(n).join(this.complete));
    this.write(Array(i).join(this.incomplete));
    this.color(90, this.close);

    if (this.verbose)
      this.color(90, ` ${stats.tests} of ${stats.total}`);
  }

  end(mocha) {
    this.show();
    this.write('\n');
    this.epilogue(mocha);
  }
}

ProgressReporter.id = 'progress';
ProgressReporter.buffer = true;

/**
 * SpecReporter
 */

class SpecReporter extends Reporter {
  constructor(stream, options) {
    super(stream, options);
  }

  suiteStart(suite) {
    if (suite.name) {
      if (!suite.parent.name)
        this.log('');
      this.log(`${suite.name}`, suite.depth);
    }
  }

  testEnd(test) {
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

    if (test.stats.duration > test.slow)
      line.push(` \x1b[31m(${test.stats.duration}ms)\x1b[m`);
    else if (test.stats.duration > (test.slow >>> 1))
      line.push(` \x1b[33m(${test.stats.duration}ms)\x1b[m`);

    this.log(line.join(''), test.depth);
  }

  end(mocha) {
    this.epilogue(mocha);
  }
}

SpecReporter.id = 'spec';
SpecReporter.buffer = false;

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
  constructor(send, isTTY = false, columns = 75) {
    assert(typeof send === 'function');
    assert(typeof isTTY === 'boolean');
    assert((columns >>> 0) === columns);

    super();

    this.send = send;
    this.writable = true;
    this.isTTY = isTTY;
    this.columns = columns;
    this.sending = false;
    this.buffer = '';
    this.onSend = this._onSend.bind(this);
    this.flushers = [];
  }

  cursorTo(x, y) {
    return;
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

    if (this.isTTY) {
      str = str.replace(/\x1b\[m/g, '\x1b[0m');
      str = str.replace(/\x1b\[38;5;\d+m/g, '');
    } else {
      str = str.replace(/\x1b\[[^m]*m/g, '');
    }

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

let mocha = null;

exports = (stream, reporter, options) => {
  if (mocha)
    return mocha;

  if (stream && typeof stream !== 'object') {
    options = reporter;
    reporter = stream;
    stream = null;
  }

  const proc = typeof process === 'object' && process;

  if (stream == null && proc)
    stream = proc.stdout;

  if (stream == null)
    stream = new Stream();

  mocha = new MochaLocal(stream, reporter, options);

  if (proc)
    mocha.exit = proc.exit;

  return mocha;
};

exports.style = style;
exports.Runnable = Runnable;
exports.Mocha = Mocha;
exports.MochaLocal = MochaLocal;
exports.Suite = Suite;
exports.Executable = Executable;
exports.Hook = Hook;
exports.Test = Test;
exports.Context = Context;
exports.Job = Job;
exports.Stats = Stats;
exports.Reporter = Reporter;
exports.DotReporter = DotReporter;
exports.JSONReporter = JSONReporter;
exports.JSONStreamReporter = JSONStreamReporter;
exports.LandingReporter = LandingReporter;
exports.ListReporter = ListReporter;
exports.MinReporter = MinReporter;
exports.NyanReporter = NyanReporter;
exports.ProgressReporter = ProgressReporter;
exports.SpecReporter = SpecReporter;
exports.Stream = Stream;
exports.SendStream = SendStream;
exports.ConsoleStream = ConsoleStream;
exports.DOMStream = DOMStream;

module.exports = exports;
