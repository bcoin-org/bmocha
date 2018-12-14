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
const inspect = require('./inspect');

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

const colors = {
  __proto__: null,
  suite: 0,
  title: 0,
  plane: 0,
  fail: 31,
  crash: 31,
  slow: 31,
  message: 31,
  checkmark: 32,
  green: 32,
  medium: 33,
  pending: 36,
  light: 90,
  fast: 90,
  stack: 90,
  pass: 90,
  runway: 90,
  progress: 90
};

const symbolsUnix = {
  __proto__: null,
  ok: '\u2713',
  err: '\u2716',
  dot: '\u2024',
  dash: '-',
  comma: ',',
  bang: '!',
  plane: '\u2708',
  runway: '\u22c5',
  open: '[',
  complete: '\u25ac',
  incomplete: '\u2024',
  close: ']'
};

const symbolsWindows = {
  __proto__: null,
  ok: '\u221a',
  err: '\u00d7',
  dot: '.',
  dash: '-',
  comma: ',',
  bang: '!',
  plane: '\u2708',
  runway: '\u22c5',
  open: '[',
  complete: '\u25ac',
  incomplete: '.',
  close: ']'
};

const PENDING = new Error('pending');

/**
 * Runnable
 */

class Runnable {
  constructor() {
    this.mocha = null;
    this.suite = null;
    this.parent = null;
    this.name = '';
    this.title = '';
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

  get duration() {
    return this.stats.duration;
  }

  get elapsed() {
    return this.stats.elapsed;
  }

  get speed() {
    if (this.duration > this.slow)
      return 'slow';

    if (this.duration > (this.slow >>> 1))
      return 'medium';

    return 'fast';
  }

  titlePath() {
    const path = [this.title];

    let parent = this.parent;

    while (parent) {
      if (parent.title)
        path.push(parent.title);
      parent = parent.parent;
    }

    return path.reverse();
  }

  fullTitle() {
    return this.titlePath().join(' ');
  }
}

/**
 * Mocha
 */

class Mocha extends Runnable {
  constructor(options) {
    super();

    // Runnable Properties
    this.mocha = this;
    this.suite = null;
    this.parent = null;
    this.name = '';
    this.title = '';
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

    // Mocha Options
    this.stream = new Stream();
    this.reporter = 'spec';
    this.reporterOptions = Object.create(null);
    this.global = true;
    this.windows = false;
    this.colors = false;
    this.bail = false;
    this.grep = null;
    this.fgrep = '';
    this.invert = false;

    // State
    this.report = null;
    this.current = null;
    this.exclusive = false;
    this.beforeEaches = [];
    this.afterEaches = [];
    this.results = [];
    this.job = null;
    this.catcher = this._catcher.bind(this);
    this.uncatcher = null;
    this.exit = this._exit.bind(this);

    // API
    this.before = this._before.bind(this);
    this.after = this._after.bind(this);
    this.beforeEach = this._beforeEach.bind(this);
    this.afterEach = this._afterEach.bind(this);
    this.describe = this._describe.bind(this);
    this.it = this._it.bind(this);

    this.init();
    this.set(options);
  }

  init() {
    for (const method of [this.describe, this.it]) {
      method.only = (title, func) => method(title, func, 'only');
      method.skip = (title, func) => method(title, func, 'skip');
    }
  }

  set(options) {
    if (options == null)
      return this;

    if (typeof options === 'function'
        || typeof options === 'string')
      options = { reporter: options };

    assert(typeof options === 'object');

    if (typeof options.write === 'function')
      options = { stream: options };

    if (options.slow != null)
      this.slow = options.slow >>> 0;

    if (options.timeout != null)
      this.timeout = options.timeout >>> 0;

    if (options.timeouts != null)
      this.timeouts = Boolean(options.timeouts);

    if (options.retries != null)
      this.retries = options.retries >>> 0;

    if (options.stream != null) {
      assert(typeof options.stream.write === 'function');
      this.stream = options.stream;
      this.colors = Boolean(options.stream.isTTY);
    }

    if (options.reporter != null)
      this.reporter = Base.get(options.reporter).id;

    if (options.reporterOptions != null) {
      assert(options.reporterOptions);
      assert(typeof options.reporterOptions === 'object');
      this.reporterOptions = options.reporterOptions;
    }

    if (options.global != null)
      this.global = options.global;

    if (options.windows != null)
      this.windows = Boolean(options.windows);

    if (options.colors != null)
      this.colors = Boolean(options.colors);

    if (options.bail != null)
      this.bail = Boolean(options.bail);

    if (options.grep != null)
      this.grep = RegExp(options.grep);

    if (options.fgrep != null)
      this.fgrep = String(options.fgrep);

    if (options.invert != null)
      this.invert = Boolean(options.invert);

    return this;
  }

  _suite() {
    if (!this.current)
      throw new Error('No suite is currently initializing.');
    return this.current;
  }

  _before(desc, func) {
    return this._suite().before(desc, func);
  }

  _after(desc, func) {
    return this._suite().after(desc, func);
  }

  _beforeEach(desc, func) {
    return this._suite().beforeEach(desc, func);
  }

  _afterEach(desc, func) {
    return this._suite().afterEach(desc, func);
  }

  _describe(title, func, action) {
    return this._suite().describe(title, func, action);
  }

  _it(title, func, action) {
    return this._suite().it(title, func, action);
  }

  globalize() {
    if (!this.global)
      return null;

    const api = {
      before: this.before,
      after: this.after,
      beforeEach: this.beforeEach,
      afterEach: this.afterEach,
      describe: this.describe,
      it: this.it
    };

    return {
      exports: inject(exports, api),
      global: inject(global, api)
    };
  }

  unglobalize(snapshot) {
    if (this.global) {
      assert(snapshot);
      restore(exports, snapshot.exports);
      restore(global, snapshot.global);
    }

    return this;
  }

  _catcher(reject) {
    return null;
  }

  _exit(code) {
    throw new Error(`Test suite failed: ${code >>> 0}.`);
  }

  catch() {
    if (this.global) {
      const reject = this.reject.bind(this);
      this.uncatcher = this.catcher(reject);
    }

    return this;
  }

  uncatch() {
    const uncatcher = this.uncatcher;

    if (uncatcher) {
      this.uncatcher = null;
      uncatcher();
    }

    return this;
  }

  reject(err) {
    assert(err && typeof err === 'object');

    if (!this.job || this.job.done) {
      this.uncatch();
      this.error(err);
      return;
    }

    this.job.reject(err);
  }

  error(error) {
    const err = toError(error);

    this.stream.write('\n');
    this.stream.write(toMessage(err) + '\n');
    this.stream.write('\n');
    this.stream.write(toStack(err) + '\n');

    if (this.global)
      this.exit(1);
  }

  matches(title) {
    assert(typeof title === 'string');

    let ret = !this.invert;

    if (this.grep)
      ret = this.grep.test(title);
    else if (this.fgrep)
      ret = title.indexOf(this.fgrep) !== -1;

    if (this.invert)
      ret = !ret;

    return ret;
  }

  async run(funcs) {
    const Reporter = Base.get(this.reporter);

    this.stats = new Stats();
    this.results = [];

    if (this.stream instanceof SendStream)
      this.stream.error = this.error.bind(this);

    this.report = new Reporter(this.stream, this.reporterOptions);
    this.report.stats = this.stats;
    this.report.colors = this.colors;
    this.report.windows = this.windows;

    this.suite = new Suite(this);
    this.suite.init(funcs);

    this.running = true;
    this.stats.mark();
    this.stats.total = this.suite.total();

    if (this.stats.total > 0)
      this.report.start(this);

    this.catch();

    await this.suite.run();

    this.uncatch();

    this.stats.mark();
    this.running = false;

    if (this.stats.total > 0)
      this.report.end(this);

    return Math.min(this.stats.failures, 255);
  }
}

/**
 * Suite
 */

class Suite extends Runnable {
  constructor(parent, title = '') {
    assert((parent instanceof Mocha)
        || (parent instanceof Suite));
    assert(typeof title === 'string');

    if (/[\x00-\x1f\x7f]/.test(title))
      throw new Error('Invalid suite title.');

    super();

    this.mocha = parent.mocha;
    this.suite = this;
    this.parent = parent;
    this.name = '';
    this.title = title;
    this.matching = parent.matching || parent.mocha.matches(title);
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

    this.root = this.depth === 0;
    this.befores = [];
    this.afters = [];
    this.beforeEaches = parent.beforeEaches.slice();
    this.afterEaches = parent.afterEaches.slice();
    this.tests = [];
    this.suites = [];
  }

  before(desc, func) {
    if (typeof desc === 'function')
      [desc, func] = [func, desc];

    const hook = new Hook(this, 'before all', desc, func);

    this.befores.push(hook);
  }

  after(desc, func) {
    if (typeof desc === 'function')
      [desc, func] = [func, desc];

    const hook = new Hook(this, 'after all', desc, func);

    this.afters.push(hook);
  }

  beforeEach(desc, func) {
    if (typeof desc === 'function')
      [desc, func] = [func, desc];

    const hook = new Hook(this, 'before each', desc, func);

    this.beforeEaches.push(hook);
  }

  afterEach(desc, func) {
    if (typeof desc === 'function')
      [desc, func] = [func, desc];

    const hook = new Hook(this, 'after each', desc, func);

    this.afterEaches.push(hook);
  }

  describe(title, func, action) {
    const suite = new Suite(this, title);

    if (action === 'only')
      suite.context.only();
    else if (action === 'skip')
      suite.context.skip();
    else if (action != null)
      throw new Error(`Invalid action: ${action}`);

    suite.init(func);

    this.suites.push(suite);

    return suite.context;
  }

  it(title, func, action) {
    const test = new Test(this, title, func);

    if (action === 'only')
      test.context.only();
    else if (action === 'skip')
      test.context.skip();
    else if (action != null)
      throw new Error(`Invalid action: ${action}`);

    this.tests.push(test);

    return test.context;
  }

  init(funcs) {
    if (typeof funcs === 'function')
      funcs = [funcs];

    assert(Array.isArray(funcs));

    for (const func of funcs)
      assert(typeof func === 'function');

    const ctx = this.context;
    const current = this.mocha.current;
    const save = this.mocha.globalize();

    this.mocha.current = this;

    try {
      for (const func of funcs) {
        const result = func.call(ctx, ctx);

        if (isPromise(result))
          throw new Error('Cannot resolve asynchronous test suites.');
      }
    } finally {
      this.mocha.unglobalize(save);
      this.mocha.current = current;
    }

    return this;
  }

  total() {
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

    this.mocha.report.testEnd(test);
  }

  fail(test) {
    assert(test instanceof Executable);

    this.mocha.stats.failures += 1;
    this.mocha.stats.tests += 1;
    this.mocha.results.push(test);

    this.mocha.report.testEnd(test);

    return !this.mocha.bail;
  }

  async run() {
    if (this.total() === 0)
      return true;

    this.stats = new Stats();

    this.running = true;
    this.stats.mark();

    if (!this.root)
      this.mocha.stats.suites += 1;

    this.mocha.report.suiteStart(this);

    const ok = await this.exec();

    this.stats.mark();
    this.running = false;

    this.mocha.report.suiteEnd(this);

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

      this.mocha.report.testStart(test);

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

      await nextTick();
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
}

/**
 * Executable
 */

class Executable extends Runnable {
  constructor(parent, name, title, body) {
    assert(parent instanceof Suite);
    assert(typeof name === 'string');
    assert(typeof title === 'string');
    assert(typeof body === 'function');

    super();

    this.mocha = parent.mocha;
    this.suite = parent;
    this.parent = parent;
    this.name = name;
    this.title = title;
    this.matching = parent.matching || parent.mocha.matches(title);
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

    this.body = body;
    this.retry = 0;
    this.failed = false;
    this.error = null;
    this.message = '';
    this.stack = '';
  }

  async exec() {
    return new Promise((resolve, reject) => {
      const ctx = this.context;
      const job = new Job(this, resolve, reject);

      let callbackable;
      try {
        callbackable = isCallbackable(this.body);
      } catch (e) {
        job.reject(e);
        return;
      }

      if (callbackable) {
        const done = job.callback();

        ctx._inject(done);

        let result;

        try {
          result = this.body.call(ctx, done);
        } catch (e) {
          job.reject(e);
          return;
        }

        if (isPromise(result)) {
          job.reject(new Error(''
            + 'Resolution method is overspecified. '
            + 'Specify a callback *or* return a '
            + 'Promise; not both.'));
          return;
        }
      } else {
        let result;

        try {
          if (this.body.length > 0)
            result = this.body.call(ctx, ctx);
          else
            result = this.body.call(ctx);
        } catch (e) {
          job.reject(e);
          return;
        }

        if (!isPromise(result)) {
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
    this.failed = false;
    this.error = null;
    this.message = '';
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
      this.error = toError(err);
      this.message = toMessage(this.error);
      this.stack = toStack(this.error);
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
      title: this.title,
      fullTitle: this.fullTitle(),
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
  constructor(parent, type, desc, body) {
    if (desc == null)
      desc = '';

    assert(typeof type === 'string');
    assert(typeof desc === 'string');
    assert(typeof body === 'function');

    if (/[\x00-\x1f\x7f]/.test(desc))
      throw new Error('Invalid hook description.');

    let name = `"${type}" hook`;

    if (!desc && body.name)
      desc = body.name;

    if (desc)
      name += `: ${desc}`;

    super(parent, name, '', body);
  }

  async run(test) {
    assert(test == null || (test instanceof Test));

    if (test) {
      this.context = test.context;
      this.title = `${this.name} for "${test.title}"`;
    } else {
      this.context = this.suite.context;
      this.title = this.name;
    }

    return super.run();
  }
}

/**
 * Test
 */

class Test extends Executable {
  constructor(parent, title, body) {
    assert(typeof title === 'string');

    // Note:
    // Temporary hack to get
    // bcoin tests passing.
    title = singlify(title);

    if (/[\x00-\x1f\x7f]/.test(title))
      throw new Error('Invalid test title.');

    super(parent, '', title, body);
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

  _inject(func) {
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
    this.done = false;
    this.called = false;
    this._resolve = resolve;
    this._reject = reject;

    assert(!this.test.mocha.job);

    this.test.mocha.job = this;
  }

  resolve() {
    if (this.done)
      return;

    this.done = true;
    this.clear();
    this._resolve();
  }

  reject(err) {
    if (this.done)
      return;

    this.done = true;
    this.clear();
    this._reject(err);
  }

  _callback(err) {
    if (this.called) {
      this.reject(new Error('done() called multiple times'));
      return;
    }

    this.called = true;

    setImmediate(() => {
      if (err)
        this.reject(err);
      else
        this.resolve();
    });
  }

  callback() {
    const self = this;
    return function done(err) {
      return self._callback(err);
    };
  }

  start() {
    const {timeout, timeouts} = this.test;

    if (this.done)
      return;

    if (!timeouts)
      return;

    if (timeout === 0)
      return;

    assert(this.timer == null);

    this.timer = setTimeout(() => {
      this.reject(new Error(''
        + `Timeout of ${timeout}ms exceeded. `
        + 'For async tests and hooks, ensure '
        + '"done()" is called; if returning a '
        + 'Promise, ensure it resolves.'));
    }, timeout);
  }

  clear() {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    assert(this.test.mocha.job === this);

    this.test.mocha.job = null;
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
 * Base
 */

class Base {
  constructor(stream, options) {
    if (options == null)
      options = Object.create(null);

    assert(stream && typeof stream.write === 'function');
    assert(options && typeof options === 'object');

    this.stats = new Stats();
    this.stream = stream;
    this.options = options;
    this.colors = false;
    this.windows = false;
    this.color = this._color.bind(this);
  }

  get id() {
    return this.constructor.id;
  }

  get isTTY() {
    return this.stream.isTTY && typeof this.stream.columns === 'number';
  }

  get columns() {
    if (typeof this.stream.columns === 'number')
      return this.stream.columns;
    return 75;
  }

  get width() {
    return (Math.min(100, this.columns) * 0.75) >>> 0;
  }

  get symbols() {
    return this.windows ? symbolsWindows : symbolsUnix;
  }

  _color(col, str) {
    if (!this.colors)
      return str;

    if (typeof col === 'string')
      col = colors[col];

    return `\x1b[${col >>> 0}m${str}\x1b[0m`;
  }

  write(str) {
    return this.stream.write(String(str));
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

    const {color, stats} = this;

    const duration = stats.duration >= 1000
      ? Math.ceil(stats.duration / 1000) + 's'
      : stats.duration + 'ms';

    this.write('\n');

    this.write(' '
      + color('green', ` ${stats.passes} passing`)
      + color('light', ` (${duration})`)
      + '\n');

    if (stats.pending > 0) {
      this.write('  '
        + color('pending', `${stats.pending} pending`)
        + '\n');
    }

    if (stats.failures > 0) {
      this.write('  '
        + color('fail', `${stats.failures} failing`)
        + '\n');
    }

    this.write('\n');

    for (let i = 0; i < mocha.results.length; i++) {
      const test = mocha.results[i];

      if (!test.failed)
        continue;

      const id = (i + 1).toString(10);
      const path = test.titlePath();

      for (let j = 0; j < path.length; j++) {
        let title = path[j];

        if (j === path.length - 1)
          title += ':';

        const padding = '  '.repeat(j + 1);

        if (j === 0) {
          this.write(padding
            + color('title', `${id}) ${title}`)
            + '\n');
        } else {
          this.write(padding
            + ' '.repeat(id.length)
            + '  '
            + color('title', title)
            + '\n');
        }
      }

      this.write('\n');
      this.write('      '
        + color('message', test.message)
        + '\n');

      if (diff.isDiffable(test.error)) {
        const text = diff.createDiff(test.error, this);

        this.write('\n');
        this.write(indent(text, 3) + '\n');
      }

      if (test.stack.length > 0) {
        const stack = color('stack', test.stack);

        this.write('\n');
        this.write(indent(stack, 3) + '\n');
      }

      this.write('\n');
    }
  }

  static get(reporter) {
    if (reporter == null)
      return SpecReporter;

    if (typeof reporter === 'string') {
      switch (reporter) {
        case 'doc':
          reporter = DocReporter;
          break;
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
        case 'markdown':
          reporter = MarkdownReporter;
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
        case 'tap':
          reporter = TapReporter;
          break;
        case 'xunit':
          reporter = XUnitReporter;
          break;
        default:
          throw new Error(`Unknown reporter: ${reporter}.`);
      }
    }

    assert(typeof reporter === 'function');
    assert(typeof reporter.id === 'string');

    return reporter;
  }
}

Base.id = '';

/**
 * DocReporter
 */

class DocReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
  }

  suiteStart(suite) {
    const indent = '  '.repeat(suite.depth);

    this.write(indent + '<section class="suite">\n');

    if (!suite.root)
      this.write(indent + `  <h1>${escape(suite.title)}</h1>\n`);

    this.write(indent + '  <dl>\n');
  }

  suiteEnd(suite) {
    const indent = '  '.repeat(suite.depth);

    this.write(indent + '  </dl>\n');
    this.write(indent + '</section>\n');
  }

  testEnd(test) {
    const indent = '  '.repeat(test.depth + 2);
    const code = escape(clean(test.body));

    if (test.failed)  {
      const message = escape(test.message);
      const stack = escape(test.stack);

      this.write(indent
        + `<dt class="error">${escape(test.title)}</dt>`
        + '\n');

      this.write(indent
        + `<dd class="error"><pre><code>${code}</code></pre></dd>`
        + '\n');

      this.write(indent
        + `<dd class="error">${message}\n\n${stack}</dd>`
        + '\n');

      return;
    }

    this.write(indent
      + `<dt>${escape(test.title)}</dt>`
      + '\n');

    this.write(indent
      + `<dd><pre><code>${code}</code></pre></dd>`
      + '\n');
  }
}

DocReporter.id = 'doc';

/**
 * DotReporter
 */

class DotReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
    this.n = -1;
  }

  start(mocha) {
    this.n = -1;
    this.write('\n');
  }

  testEnd(test) {
    const {color} = this;
    const {comma, bang, dot} = this.symbols;

    if (++this.n % this.width === 0)
      this.write('\n  ');

    if (test.skip)
      this.write(color('pending', comma));
    else if (test.failed)
      this.write(color('fail', bang));
    else
      this.write(color(test.speed, dot));
  }

  end(mocha) {
    this.write('\n');
    this.epilogue(mocha);
  }
}

DotReporter.id = 'dot';

/**
 * JSONReporter
 */

class JSONReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
    this.pending = [];
    this.failures = [];
    this.passes = [];
    this.tests = [];
  }

  json(json) {
    this.write(JSON.stringify(json, null, 2) + '\n');
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

/**
 * JSONStreamReporter
 */

class JSONStreamReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
  }

  json(json) {
    this.write(JSON.stringify(json) + '\n');
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

/**
 * LandingReporter
 */

class LandingReporter extends Base {
  constructor(stream, options) {
    super(stream, options);

    this.crashed = -1;
    this.n = 0;
  }

  runway() {
    const {color, symbols} = this;
    const width = Math.max(0, this.width - 1);
    const line = symbols.dash.repeat(width);

    this.write('  ' + color('runway', line));
  }

  start(mocha) {
    this.crashed = -1;
    this.n = 0;
    this.write('\n\n\n  ');
    this.hide();
  }

  testEnd(test) {
    const {color, symbols} = this;
    const {plane, runway} = symbols;

    const col = this.crashed === -1
      ? (this.width * ++this.n / this.stats.total) >>> 0
      : this.crashed;

    let icon = color('plane', plane);

    if (test.failed) {
      icon = color('crash', plane);
      this.crashed = col;
    }

    if (this.isTTY)
      this.write(`\x1b[${this.width + 1}D\x1b[2A`);
    else
      this.write('\n');

    const x = Math.max(0, col - 1);
    const y = Math.max(0, this.width - col - 1);

    this.runway();
    this.write('\n');

    this.write('  '
      + color('runway', runway.repeat(x))
      + icon
      + color('runway', runway.repeat(y))
      + '\n');

    this.runway();
    this.write('\x1b[0m');
  }

  end(mocha) {
    this.show();
    this.write('\n');
    this.epilogue(mocha);
  }
}

LandingReporter.id = 'landing';

/**
 * ListReporter
 */

class ListReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
  }

  start(mocha) {
    this.write('\n');
  }

  testStart(test) {
    const {color} = this;

    if (this.isTTY) {
      this.write('    '
        + color('pass', `${test.fullTitle()}:`)
        + ' ');
    }
  }

  testEnd(test) {
    const {color, symbols} = this;

    if (test.skip) {
      this.carriage();

      this.write('  '
        + color('checkmark', symbols.dash)
        + ' '
        + color('pending', `${test.fullTitle()}`)
        + '\n');

      return;
    }

    if (test.failed) {
      this.carriage();

      this.write('  '
        + color('fail', `${test.id}) ${test.fullTitle()}`)
        + '\n');

      return;
    }

    this.carriage();

    this.write('  '
      + color('checkmark', symbols.ok)
      + ' '
      + color('pass', `${test.fullTitle()}:`)
      + ' '
      + color(test.speed, `${test.duration}ms`)
      + '\n');
  }

  end(mocha) {
    this.epilogue(mocha);
  }
}

ListReporter.id = 'list';

/**
 * MarkdownReporter
 */

class MarkdownReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
    this.buffer = '';
  }

  title(suite) {
    return '#'.repeat(suite.depth) + ' ' + suite.title;
  }

  slug(str) {
    assert(typeof str === 'string');

    return str
      .toLowerCase()
      .replace(/ +/g, '-')
      .replace(/[^-\w]/g, '');
  }

  mapTOC(suite, obj) {
    const key = '$' + suite.title;

    if (!obj[key])
      obj[key] = { suite };

    for (const child of suite.suites)
      this.mapTOC(child, obj[key]);

    return obj;
  }

  stringifyTOC(obj, level) {
    level += 1;

    let buffer = '';
    let link;

    for (const key of Object.keys(obj)) {
      if (key === 'suite')
        continue;

      if (key !== '$') {
        link = `- [${key.substring(1)}]`;
        link += `(#${this.slug(obj[key].suite.fullTitle())})\n`;
        buffer += '  '.repeat(level - 2) + link;
      }

      buffer += this.stringifyTOC(obj[key], level);
    }

    return buffer;
  }

  generateTOC(suite) {
    const obj = this.mapTOC(suite, {});
    return this.stringifyTOC(obj, 0);
  }

  start(mocha) {
    this.buffer = '';
  }

  suiteStart(suite) {
    if (suite.root)
      return;

    const slug = this.slug(suite.fullTitle());

    this.buffer += `<a name="${slug}"></a>\n\n`;
    this.buffer += this.title(suite) + '\n\n';
  }

  testEnd(test) {
    if (test.failed || test.skip)
      return;

    const code = clean(test.body);

    this.buffer += test.title + '.\n';
    this.buffer += '\n```js\n';
    this.buffer += code + '\n';
    this.buffer += '```\n\n';
  }

  end(mocha) {
    this.write('# TOC\n');
    this.write('\n');
    this.write(this.generateTOC(mocha.suite));
    this.write('\n');
    this.write(this.buffer.replace(/\n+$/, '\n'));
  }
}

MarkdownReporter.id = 'markdown';

/**
 * MinReporter
 */

class MinReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
  }

  start(mocha) {
    if (this.isTTY) {
      this.write('\x1b[2J');
      this.write('\x1b[1;3H');
    }
  }

  end(mocha) {
    this.epilogue(mocha);
  }
}

MinReporter.id = 'min';

/**
 * NyanReporter
 */

class NyanReporter extends Base {
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
    this.tick ^= 1;
  }

  drawScoreboard() {
    const {color} = this;
    const stats = this.stats;

    const draw = (col, n) => {
      this.write(' ' + color(col, n) + '\n');
    };

    draw('green', stats.passes);
    draw('fail', stats.failures);
    draw('pending', stats.pending);

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
      if (this.isTTY)
        this.write(`\x1b[${this.scoreboardWidth}C`);
      this.write(line.join('') + '\n');
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

    this.write('_,------,\n');

    if (this.isTTY)
      this.write(dist);

    padding = this.tick ? '  ' : '   ';

    this.write(`_|${padding}/\\_/\\ \n`);

    if (this.isTTY)
      this.write(dist);

    padding = this.tick ? '_' : '__';
    tail = this.tick ? '~' : '^';

    this.write(`${tail}|${padding}${this.face()} \n`);

    if (this.isTTY)
      this.write(dist);

    padding = this.tick ? ' ' : '  ';

    this.write(`${padding}""  "" \n`);

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
    if (!this.colors || !this.isTTY)
      return str;

    const len = this.rainbowColors.length;
    const color = this.rainbowColors[this.colorIndex % len];

    this.colorIndex += 1;

    return `\x1b[38;5;${color}m${str}\x1b[0m`;
  }
}

NyanReporter.id = 'nyan';

/**
 * ProgressReporter
 */

class ProgressReporter extends Base {
  constructor(stream, options) {
    super(stream, options);

    const {symbols} = this;

    this.n = -1;
    this.open = symbols.open;
    this.complete = symbols.complete;
    this.incomplete = symbols.incomplete;
    this.close = symbols.close;
    this.verbose = false;

    if (typeof this.options.open === 'string')
      this.open = this.options.open;

    if (typeof this.options.complete === 'string')
      this.complete = this.options.complete;

    if (typeof this.options.incomplete === 'string')
      this.incomplete = this.options.incomplete;

    if (typeof this.options.close === 'string')
      this.close = this.options.close;

    if (typeof this.options.verbose === 'boolean')
      this.verbose = this.options.verbose;
  }

  start(mocha) {
    this.n = -1;
    this.write('\n');
    this.hide();
  }

  testEnd(test) {
    const {color} = this;
    const stats = this.stats;
    const percent = stats.tests / stats.total;
    const width = this.width;

    let n = (width * percent) >>> 0;
    let i = width - n;

    if (n === this.n && !this.verbose)
      return;

    this.n = n;

    if (this.isTTY) {
      this.carriage();
      this.write('\x1b[J');
    } else {
      this.write('\n');
    }

    n = Math.max(0, n - 1);
    i = Math.max(0, i - 1);

    this.write('  '
      + color('progress', this.open)
      + this.complete.repeat(n)
      + this.incomplete.repeat(i)
      + color('progress', this.close));

    if (this.verbose) {
      this.write(' '
        + color('progress', `${stats.tests} of ${stats.total}`));
    }
  }

  end(mocha) {
    this.show();
    this.write('\n');
    this.epilogue(mocha);
  }
}

ProgressReporter.id = 'progress';

/**
 * SpecReporter
 */

class SpecReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
    this.n = 0;
  }

  start(mocha) {
    this.n = 0;
  }

  suiteStart(suite) {
    const {color} = this;

    if (suite.root)
      return;

    if (suite.depth === 1)
      this.write('\n');

    this.write('  '.repeat(suite.depth)
      + color('suite', suite.title)
      + '\n');
  }

  testEnd(test) {
    const {color, symbols} = this;
    const padding = '  '.repeat(test.depth);

    if (test.skip) {
      this.write(color('pending', padding
        + '  '
        + `${symbols.dash} ${test.title}`)
        + '\n');
      return;
    }

    if (test.failed) {
      this.n += 1;
      this.write(color('fail', padding
        + '  '
        + `${this.n}) ${test.title}`)
        + '\n');
      return;
    }

    this.write(padding
      + '  '
      + color('checkmark', symbols.ok)
      + ' '
      + color('pass', test.title));

    if (test.speed !== 'fast')
      this.write(' ' + color(test.speed, `(${test.duration}ms)`));

    this.write('\n');
  }

  end(mocha) {
    this.epilogue(mocha);
  }
}

SpecReporter.id = 'spec';

/**
 * TapReporter
 */

class TapReporter extends Base {
  constructor(stream, options) {
    super(stream, options);
    this.n = 1;
    this.passes = 0;
    this.failures = 0;
  }

  title(test) {
    return test.fullTitle().replace(/#/g, '');
  }

  start(mocha) {
    this.n = 1;
    this.passes = 0;
    this.failures = 0;
    this.write(`1..${mocha.stats.total}\n`, 1);
  }

  testEnd(test) {
    this.n += 1;

    if (test.skip) {
      this.write(`ok ${this.n} ${this.title(test)} # SKIP -\n`);
      return;
    }

    if (test.failed) {
      this.failures += 1;
      this.write(`not ok ${this.n} ${this.title(test)}\n`);
      this.write(`  ${test.message}\n`);
      this.write('\n');
      this.write(indent(test.stack, 1) + '\n');
      this.write('\n');
      return;
    }

    this.passes += 1;
    this.write(`ok ${this.n} ${this.title(test)}\n`);
  }

  end(mocha) {
    this.write(`# tests ${this.passes + this.failures}\n`);
    this.write(`# pass ${this.passes}\n`);
    this.write(`# fail ${this.failures}\n`);
  }
}

TapReporter.id = 'tap';

/**
 * XUnitReporter
 */

class XUnitReporter extends Base {
  constructor(stream, options) {
    super(stream, options);

    this.suiteName = 'Mocha Tests';

    if (typeof this.options.suiteName === 'string')
      this.suiteName = this.options.suiteName;
  }

  end(mocha) {
    const testTag = this.tag('testsuite', {
      name: this.suiteName,
      tests: this.stats.tests,
      failures: this.stats.failures,
      errors: this.stats.failures,
      skipped: this.stats.pending,
      timestamp: new Date().toUTCString(),
      time: this.stats.duration / 1000
    }, false);

    this.write(testTag + '\n');

    for (const test of mocha.results)
      this.test(test);

    this.write('</testsuite>\n');
  }

  test(test) {
    const attrs = {
      classname: test.parent.fullTitle(),
      name: test.title,
      time: test.duration / 1000
    };

    if (test.skip) {
      const skipTag = this.tag('skipped', {}, true);
      const testTag = this.tag('testcase', attrs, false, skipTag);

      this.write(testTag + '\n');

      return;
    }

    if (test.failed) {
      const message = escape(test.message);
      const stack = escape(test.stack);

      const failTag = this.tag('failure', {}, false,
                               `${message}\n\n${stack}`);

      const testTag = this.tag('testcase', attrs, false, failTag);

      this.write(testTag + '\n');

      return;
    }

    this.write(this.tag('testcase', attrs, true) + '\n');
  }

  tag(name, attrs, close, content = null) {
    const end = close ? '/>' : '>';
    const pairs = [];

    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      pairs.push(`${key}="${escape(value)}"`);
    }

    let tag = '<' + name;

    if (pairs.length > 0)
      tag += ' ' + pairs.join(' ');

    tag += end;

    if (content)
      tag += content + '</' + name + end;

    return tag;
  }
}

XUnitReporter.id = 'xunit';

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

    this.writable = true;
    this.send = send;
    this.isTTY = isTTY;
    this.columns = columns;
    this.sending = false;
    this.buffer = '';
    this.flushers = [];
    this.onSend = this._onSend.bind(this);
    this.error = () => {};
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
  constructor(console, isTTY = false) {
    super();

    if (!console || typeof console.log !== 'function')
      throw new Error('Must pass a console.');

    assert(typeof isTTY === 'boolean');

    this.writable = true;
    this.console = console;
    this.isTTY = isTTY;
    this.buffer = '';
  }

  write(str) {
    str = String(str);

    if (str.length === 0)
      return true;

    if (this.isTTY)
      str = str.replace(/\x1b\[m/g, '\x1b[0m');

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

    if (!node || !node.ownerDocument)
      throw new Error('Must pass a DOM element.');

    this.writable = true;
    this.isTTY = true;
    this.document = node.ownerDocument;
    this.node = node;
    this.replace = this._replace.bind(this);

    this.init();
  }

  init() {
    this.node.style.cssText = `font-family: ${style.font};`;
    this.node.style.cssText = `color: ${style.fg};`;
    this.node.style.cssText = `background-color: ${style.bg};`;
    this.node.innerHTML = '';
  }

  scroll() {
    const {document} = this;

    let node = this.node;

    if (document.body && node === document.body)
      node = document.scrollingElement || document.body;

    node.scrollTop = node.scrollHeight;
  }

  write(str) {
    str = String(str);

    // Escape HTML.
    str = escape(str);
    str = str.replace(/ /g, '&nbsp;');
    str = str.replace(/\n/g, '<br>');

    // Convert CSI codes to HTML.
    if (this.isTTY)
      str = str.replace(/\x1b\[([^m]*)m/g, this.replace);

    const child = this.document.createElement('span');

    child.innerHTML = str;

    this.node.appendChild(child);

    this.scroll();

    return true;
  }

  _replace(str, args) {
    assert(typeof str === 'string');
    assert(typeof args === 'string');

    let out = '';

    for (const code of args.split(';')) {
      if (code === '38' || code === '48')
        return '';
      out += this.convert(code);
    }

    return out;
  }

  convert(str) {
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

async function nextTick() {
  return new Promise(r => setImmediate(r));
}

function hasSpecialArg(func) {
  assert(typeof func === 'function');

  if (func.length !== 1)
    return false;

  const str = func.toString();
  const brace = str.indexOf('{');
  const arrow = str.indexOf('=>');

  let i = brace;

  if (arrow !== -1) {
    if (brace === -1 || arrow < brace)
      i = arrow;
  }

  if (i === -1) {
    throw new Error(''
      + 'Function parsing failed. '
      + 'This may caused unexpected behavior. '
      + 'Please report this as a bug.');
  }

  let ch = 0x00;

  for (i -= 1; i >= 0; i--) {
    ch = str.charCodeAt(i);

    if (ch > 0x20 && ch !== 0x29) // ')'
      break;
  }

  switch (ch) {
    case 0x24: // '$'
    case 0x5f: // '_'
      if (i === 0)
        return true;
      ch = str.charCodeAt(i - 1);
      return ch <= 0x20 || ch === 0x28; // '('
    case 0x78: // 'x'
      return true;
  }

  return false;
}

function isCallbackable(func) {
  return typeof func === 'function'
      && func.length > 0
      && !hasSpecialArg(func);
}

function isPromise(value) {
  if (!value)
    return false;

  if (value instanceof Promise)
    return true;

  return typeof value.then === 'function'
      && typeof value.catch === 'function';
}

function inject(target, values) {
  assert(target && typeof target === 'object');
  assert(values && typeof values === 'object');

  const snapshot = [];

  for (const key of Object.keys(values)) {
    const desc = Object.getOwnPropertyDescriptor(target, key);

    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: values[key]
    });

    snapshot.push([key, desc]);
  }

  return snapshot;
}

function restore(target, snapshot) {
  assert(target && typeof target === 'object');
  assert(Array.isArray(snapshot));

  for (const [key, desc] of snapshot) {
    if (!desc) {
      delete target[key];
      continue;
    }

    Object.defineProperty(target, key, desc);
  }
}

/*
 * Text Processing
 */

function indent(str, depth) {
  if (depth == null)
    depth = 0;

  assert(typeof str === 'string');
  assert((depth >>> 0) === depth);

  if (depth === 0)
    return str;

  return str.replace(/^/gm, ' '.repeat(depth * 2));
}

function sanitize(str) {
  str = String(str);
  str = str.replace(/^\ufeff/, '');
  str = str.replace(/\r\n/g, '\n');
  str = str.replace(/[\r\u2028\u2029]/g, '\n');
  str = str.replace(/\t/g, '  ');
  str = str.replace(/\x1b\[[\?\d;]*[a-zA-Z]/g, '');
  str = str.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
  return str;
}

function singlify(str) {
  str = String(str);

  const index = str.indexOf('\n');

  if (index !== -1)
    str = str.substring(0, index) + '...';

  return str;
}

function trim(str) {
  str = String(str);
  str = str.replace(/^\n+/, '');
  str = str.replace(/\s+$/, '');
  return str;
}

function escape(str) {
  str = String(str);
  str = str.replace(/&/g, '&amp;');
  str = str.replace(/</g, '&lt;');
  str = str.replace(/>/g, '&gt;');
  str = str.replace(/"/g, '&quot;');
  str = str.replace(/'/g, '&#39;');
  return str;
}

function clean(func) {
  assert(typeof func === 'function');

  let str = sanitize(func);
  let braceless = false;
  let state = 0;

  if (str.length < 4)
    return '';

  let i = 0;
  let j = str.length - 1;

outer:
  for (; i < str.length; i++) {
    const ch = str.charAt(i);

    switch (state) {
      case 0:
        switch (ch) {
          case '=':
            state = 1;
            break;
          case '{':
            i += 1;
            break outer;
        }
        break;
      case 1:
        switch (ch) {
          case '>':
            state = 2;
            break;
          default:
            i = 0;
            break outer;
        }
        break;
      case 2:
        switch (ch) {
          case '{':
            i += 1;
            break outer;
          default:
            if (ch > ' ') {
              braceless = true;
              break outer;
            }
            break;
        }
        break;
    }
  }

  if (!braceless) {
    for (; j > i; j--) {
      if (str.charAt(j) === '}')
        break;
    }
  }

  if (i >= j)
    return '';

  str = str.substring(i, j);
  str = trim(str);

  if (braceless)
    return `${str.trim()};`;

  let tab = false;
  let sp = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);

    if (ch !== ' ' && ch !== '\t')
      break;

    tab = ch === '\t';
    sp += 1;
  }

  if (sp === 0)
    return str;

  const ch = tab ? '\t' : ' ';
  const re = new RegExp(`^${ch}{${sp}}`, 'gm');

  return str.replace(re, '');
}

/*
 * Error Processing
 */

function toError(error, allowString = false) {
  if (allowString && typeof error === 'string')
    error = new Error(error);

  if (error instanceof Error)
    return error;

  if (error && typeof error.message === 'string')
    return error;

  const type = inspect.type(error);
  const data = inspect.single(error);

  return new Error(`the ${type} ${data} was thrown, throw an Error :)`);
}

function toMessage(error) {
  assert(error && typeof error === 'object');

  let name = sanitize(error.name || 'Error');
  let message = sanitize(error.message);
  let operator = error.operator;

  if (error.uncaught) {
    if (error.rejected)
      name = `Unhandled ${name}`;
    else
      name = `Uncaught ${name}`;
  }

  name = singlify(name);

  if (error.generatedMessage && diff.isDiffable(error)) {
    if (message.indexOf('\n') !== -1) {
      if (typeof operator !== 'string')
        operator = 'assertion';
      else if (operator === '==')
        operator = 'equal';
      else if (operator === '!=')
        operator = 'notEqual';

      message = `${operator} failed.`;
    }
  } else {
    message = singlify(message);
  }

  return `${name}: ${message}`;
}

function toStack(error) {
  assert(error && typeof error === 'object');

  let stack = String(error.stack || '');

  if (typeof error.message === 'string') {
    let index = stack.indexOf(error.message);

    if (index !== -1) {
      index += error.message.length;
      // Set 0 to 1 for longer stack traces.
      stack = stack.substring(index + 1);
    }
  }

  stack = sanitize(stack);

  if (typeof __filename === 'string') {
    // Note: very v8 specific, I imagine.
    let index = stack.indexOf(`(${__filename}:`);

    while (index >= 0 && stack[index] !== '\n')
      index -= 1;

    if (index !== -1)
      stack = stack.substring(0, index);
  }

  stack = stack.replace(/^ +/gm, '');
  stack = trim(stack);

  return stack;
}

/*
 * Expose
 */

exports.diff = diff;
exports.inspect = inspect;
exports.style = style;
exports.Runnable = Runnable;
exports.Mocha = Mocha;
exports.Suite = Suite;
exports.Executable = Executable;
exports.Hook = Hook;
exports.Test = Test;
exports.Context = Context;
exports.Job = Job;
exports.Stats = Stats;
exports.Base = Base;
exports.DocReporter = DocReporter;
exports.DotReporter = DotReporter;
exports.JSONReporter = JSONReporter;
exports.JSONStreamReporter = JSONStreamReporter;
exports.LandingReporter = LandingReporter;
exports.ListReporter = ListReporter;
exports.MarkdownReporter = MarkdownReporter;
exports.MinReporter = MinReporter;
exports.NyanReporter = NyanReporter;
exports.ProgressReporter = ProgressReporter;
exports.SpecReporter = SpecReporter;
exports.TapReporter = TapReporter;
exports.XUnitReporter = XUnitReporter;
exports.Stream = Stream;
exports.SendStream = SendStream;
exports.ConsoleStream = ConsoleStream;
exports.DOMStream = DOMStream;
exports.toError = toError;
