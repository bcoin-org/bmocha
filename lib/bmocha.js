/*!
 * bmocha.js - minimal mocha implementation
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

/* eslint no-control-regex: "off" */

'use strict';

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

const nullStream = {
  write: _ => true,
  isTTY: true
};

/**
 * Mocha
 */

class Mocha {
  constructor(stream = nullStream, Reporter = SpecReporter) {
    assert(stream && typeof stream.write === 'function');
    assert(typeof Reporter === 'function');

    this.stream = stream;
    this.colors = Boolean(stream.isTTY);
    this.reporter = new Reporter(stream);
    this.bail = false;
    this.grep = null;
    this.fgrep = null;
    this.invert = false;
    this.depth = -1;
    this.slow = 75;
    this.timeout = 2000;
    this.timeouts = true;
    this.retries = 0;
    this.skip = false;
    this.mocha = this;
    this.parent = null;
    this.name = '';
    this.matching = false;
    this.beforeEaches = [];
    this.afterEaches = [];
    this.results = [];
    this.passing = 0;
    this.pending = 0;
    this.failing = 0;
    this.elapsed = 0;
  }

  report(Reporter) {
    assert(typeof Reporter === 'function');
    this.reporter = new Reporter(this.stream);
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
    assert(Array.isArray(funcs));

    this.results = [];
    this.passing = 0;
    this.pending = 0;
    this.failing = 0;
    this.elapsed = 0;

    this.reporter.colors = this.colors;
    this.reporter.start(this);

    const start = Date.now();

    for (const func of funcs) {
      const suite = Suite.from(this, func);

      if (!await suite.run())
        break;
    }

    this.elapsed = Math.ceil((Date.now() - start) / 1000);

    this.reporter.finish(this);

    return Math.min(this.failing, 255);
  }
}

/**
 * Suite
 */

class Suite {
  constructor(mocha, parent, name, func) {
    assert(mocha instanceof Mocha);
    assert((parent instanceof Mocha)
        || (parent instanceof Suite));
    assert(typeof name === 'string');
    assert(typeof func === 'function');

    this.mocha = mocha;
    this.reporter = mocha.reporter;
    this.parent = parent;
    this.name = name;
    this.func = func;
    this.matching = parent.matching || mocha.matches(name);
    this.depth = parent.depth + 1;
    this.slow = parent.slow;
    this.timeout = parent.timeout;
    this.timeouts = parent.timeouts;
    this.retries = parent.retries;
    this.skip = parent.skip;
    this.befores = [];
    this.afters = [];
    this.beforeEaches = parent.beforeEaches.slice();
    this.afterEaches = parent.afterEaches.slice();
    this.tests = [];
    this.suites = [];
    this.context = new Context(this);

    this.init();
  }

  log(str) {
    this.mocha.log(str, this.depth);
  }

  describe(name, func) {
    const {mocha} = this;
    const suite = new Suite(mocha, this, name, func);

    this.suites.push(suite);
  }

  before(func) {
    assert(typeof func === 'function');
    this.befores.push(func);
  }

  after(func) {
    assert(typeof func === 'function');
    this.afters.push(func);
  }

  beforeEach(func) {
    assert(typeof func === 'function');
    this.beforeEaches.push(func);
  }

  afterEach(func) {
    assert(typeof func === 'function');
    this.afterEaches.push(func);
  }

  it(name, func) {
    assert(typeof name === 'string');
    assert(typeof func === 'function');

    if (this.matching || this.mocha.matches(name))
      this.tests.push([name.substring(0, 300), func]);
  }

  init() {
    const describe = global.describe;
    const before = global.before;
    const after = global.after;
    const beforeEach = global.beforeEach;
    const afterEach = global.afterEach;
    const it = global.it;

    global.describe = this.describe.bind(this);
    global.before = this.before.bind(this);
    global.after = this.after.bind(this);
    global.beforeEach = this.beforeEach.bind(this);
    global.afterEach = this.afterEach.bind(this);
    global.it = this.it.bind(this);

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
    let count = this.tests.length;

    for (const suite of this.suites)
      count += suite.total();

    return count;
  }

  test(name, func) {
    return new Test(this, name, func);
  }

  hook(hook, name, func) {
    assert(typeof hook === 'string');
    assert(typeof name === 'string');

    let title = `"${hook}" hook`;

    if (name)
      title += ` for "${name}"`;

    return new Test(this, title, func);
  }

  succeed(test) {
    assert(test instanceof Test);

    if (test.skip)
      this.mocha.pending += 1;
    else
      this.mocha.passing += 1;

    this.mocha.results.push(test);

    this.reporter.test(test);
  }

  fail(test) {
    assert(test instanceof Test);

    test.id = this.mocha.failing + 1;

    this.mocha.failing += 1;
    this.mocha.results.push(test);

    this.reporter.test(test);

    return !this.mocha.bail;
  }

  async run() {
    if (this.total() === 0)
      return true;

    if (this.skip)
      return true;

    this.reporter.begin(this);

    const ok = await this.exec();

    this.reporter.end(this);

    return ok;
  }

  async exec() {
    for (const func of this.befores) {
      const hook = this.hook('before all', '', func);

      if (!await hook.run())
        return this.fail(hook);
    }

    for (const [name, func] of this.tests) {
      for (const func of this.beforeEaches) {
        const hook = this.hook('before each', name, func);

        if (!await hook.run())
          return this.fail(hook);
      }

      const test = this.test(name, func);

      if (!await test.run()) {
        if (!this.fail(test))
          return false;
      } else {
        this.succeed(test);
      }

      for (const func of this.afterEaches) {
        const hook = this.hook('after each', name, func);

        if (!await hook.run())
          return this.fail(hook);
      }
    }

    for (const suite of this.suites) {
      if (!await suite.run())
        return false;
    }

    for (const func of this.afters) {
      const hook = this.hook('after all', '', func);

      if (!await hook.run())
        return this.fail(hook);
    }

    return true;
  }

  static from(mocha, func) {
    return new this(mocha, mocha, '', func);
  }
}

/**
 * Test
 */

class Test {
  constructor(suite, name, func) {
    assert(suite instanceof Suite);
    assert(typeof name === 'string');
    assert(typeof func === 'function');

    this.suite = suite;
    this.depth = suite.depth;
    this.name = name;
    this.func = func;
    this.id = 0;
    this.elapsed = 0;
    this.failed = false;
    this.error = null;
    this.stack = '';
    this.slow = suite.slow;
    this.timeout = suite.timeout;
    this.timeouts = suite.timeouts;
    this.retries = suite.retries;
    this.skip = suite.skip;
    this.context = new Context(this);
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
    this.elapsed = 0;
    this.failed = false;
    this.error = null;
    this.stack = '';

    if (this.skip)
      return true;

    const start = Date.now();

    let failed, err;

    for (let i = 0; i < this.retries + 1; i++) {
      failed = false;

      try {
        await this.exec();
      } catch (e) {
        failed = true;
        err = e;
      }

      if (this.skip)
        break;

      if (!failed)
        break;
    }

    this.elapsed = Date.now() - start;

    if (failed) {
      this.failed = true;
      this.error = castError(err);
      this.stack = formatStack(this.error.stack);
      return this.skip;
    }

    return true;
  }
}

/**
 * Context
 */

class Context {
  constructor(runnable) {
    assert((runnable instanceof Suite)
        || (runnable instanceof Test));
    this.runnable = runnable;
  }

  runnable(value) {
    throw new Error('Unimplemented.');
  }

  timeout(ms) {
    this.runnable.timeout = ms >>> 0;
    return this;
  }

  enableTimeouts(enabled) {
    this.runnable.timeouts = Boolean(enabled);
    return this;
  }

  slow(ms) {
    this.runnable.slow = ms >>> 0;
    return this;
  }

  skip() {
    this.runnable.skip = true;
    return this;
  }

  retries(n) {
    this.runnable.retries = n >>> 0;
    return this;
  }
}

/**
 * Job
 */

class Job {
  constructor(test, resolve, reject) {
    assert(test instanceof Test);
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
  constructor(stream = nullStream) {
    assert(stream && typeof stream.write === 'function');

    this.stream = stream;
    this.colors = false;
  }

  log(str, depth) {
    const out = indent(str, depth);
    return this.stream.write(out + '\n');
  }

  start(mocha) {
    assert(mocha instanceof Mocha);
  }

  begin(suite) {
    assert(suite instanceof Suite);
  }

  test(test) {
    assert(test instanceof Test);
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
  constructor(stream) {
    super(stream);
  }

  log(str, depth) {
    assert(typeof str === 'string');

    if (!this.colors)
      str = str.replace(/\x1b\[[^m]*?m/g, '');

    return super.log(str, depth);
  }

  begin(suite) {
    assert(suite instanceof Suite);

    if (suite.name) {
      this.log('', suite.depth);
      this.log(`${suite.name}`, suite.depth);
    }
  }

  test(test) {
    assert(test instanceof Test);

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

    const passed = `\x1b[32m${mocha.passing} passing\x1b[m`;
    const time = `\x1b[90m(${mocha.elapsed}s)\x1b[m`;

    this.log('');
    this.log(`${passed} ${time}`, 1);

    if (mocha.pending > 0)
      this.log(`\x1b[36m${mocha.pending} pending\x1b[m`, 1);

    if (mocha.failing > 0)
      this.log(`\x1b[31m${mocha.failing} failing\x1b[m`, 1);

    this.log('');

    for (const test of mocha.results) {
      if (!test.failed || test.skip)
        continue;

      const {suite, error} = test;

      if (suite.name) {
        this.log(`${test.id}) ${suite.name}`, 1);
        this.log(`${test.name}:`, 3);
      } else {
        this.log(`${test.id}) ${test.name}:`, 1);
      }

      this.log('');
      this.log(`\x1b[31m${error.name}: ${error.message}\x1b[m`, 3);

      if (error.code === 'ERR_ASSERTION') {
        this.log('\x1b[32m+ expected\x1b[m \x1b[31m- actual\x1b[m', 3);
        this.log('');
        this.log(`\x1b[31m-${error.actual}\x1b[m`, 3);
        this.log(`\x1b[32m+${error.expected}\x1b[m`, 3);
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
  constructor(stream) {
    super(stream);
  }

  start(mocha) {
    assert(mocha instanceof Mocha);

    this.log('{');
    this.log('  "suites": [');
  }

  begin(suite) {
    assert(suite instanceof Suite);

    const depth = suite.depth * 2;

    this.log('    {', depth);

    if (suite.name)
      this.log(`      "name": ${JSON.stringify(suite.name)},`, depth);

    this.log('      "tests": [', depth);
  }

  test(test) {
    assert(test instanceof Test);

    const json = {
      name: test.name,
      elapsed: test.elapsed,
      skip: test.skip,
      failed: test.failed,
      error: test.failed ? test.error.message : null,
      stack: test.failed ? test.stack : null
    };

    const str = JSON.stringify(json, null, 2);

    this.log(str + ',', test.depth * 2 + 4);
  }

  end(suite) {
    assert(suite instanceof Suite);

    const depth = suite.depth * 2;

    this.log('        null', depth);
    this.log('      ]', depth);
    this.log('    },', depth);
  }

  finish(mocha) {
    assert(mocha instanceof Mocha);

    this.log('    null');
    this.log('  ],');
    this.log(`  "passing": ${mocha.passing},`);
    this.log(`  "pending": ${mocha.pending},`);
    this.log(`  "failing": ${mocha.failing},`);
    this.log(`  "elapsed": ${mocha.elapsed}`);
    this.log('}');
  }
}

/**
 * DOMStream
 */

class DOMStream {
  constructor(node) {
    if (node == null) {
      if (global.document)
        node = global.document.body;
    }

    assert(node && node.style, 'Must pass a DOM element.');

    this.isTTY = true;
    this.node = node;
    this.init();
  }

  init() {
    this.node.style.cssText = 'background-color: #ffffff;';
    this.node.innerHTML = '';
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
    str = str.replace(/\x1b\[31m/g, '<span style="color:#ff0000">'); // red
    str = str.replace(/\x1b\[32m/g, '<span style="color:#008000">'); // green
    str = str.replace(/\x1b\[33m/g, '<span style="color:#777700">'); // yellow
    str = str.replace(/\x1b\[36m/g, '<span style="color:#0000aa">'); // cyan
    str = str.replace(/\x1b\[90m/g, '<span style="color:#393939">'); // grey
    str = str.replace(/\x1b\[m/g, '</span>');
    str = str.replace(/\x1b\[[^m]*?m/g, '');

    this.node.innerHTML += str;

    return true;
  }
}

/*
 * Helpers
 */

function assert(ok, msg) {
  if (!ok)
    throw new Error(msg || 'Assertion failure');
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

  const index = str.indexOf('\n    at ');

  if (index !== -1)
    str = str.substring(index + 1);

  return str.replace(/^ +/gm, '');
}

/*
 * Expose
 */

exports.Mocha = Mocha;
exports.Suite = Suite;
exports.Test = Test;
exports.Context = Context;
exports.Job = Job;
exports.Reporter = Reporter;
exports.SpecReporter = SpecReporter;
exports.JSONReporter = JSONReporter;
exports.DOMStream = DOMStream;
