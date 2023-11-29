/*!
 * browserify.js - browserification for bmocha
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const {StringDecoder} = require('string_decoder');
const globalRequire = require('../require');

const {
  basename,
  dirname,
  join,
  resolve
} = path;

/*
 * Constants
 */

const EMPTY = Buffer.alloc(0);

/*
 * Compilation
 */

async function template(file, values) {
  assert(typeof file === 'string');
  assert(values && typeof values === 'object');

  const path = resolve(__dirname, 'templates', file);

  return preprocess(await read(path), values);
}

async function compile(file, values, target = 'cjs') {
  assert(typeof file === 'string');
  assert(values == null || typeof values === 'object');
  assert(target === 'cjs' || target === 'esm');

  const input = resolve(__dirname, 'templates', file);

  try {
    return await tryBPKG(input, values, target);
  } catch (e) {
    if (e.code === 'ERR_NOT_INSTALLED')
      return tryBrowserify(input, values);
    throw e;
  }
}

async function tryBPKG(input, values, target) {
  assert(typeof input === 'string');
  assert(values == null || typeof values === 'object');
  assert(target === 'cjs' || target === 'esm');

  let bpkg;

  try {
    bpkg = globalRequire('bpkg');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      const err = new Error('bpkg is not installed!');
      err.code = 'ERR_NOT_INSTALLED';
      throw err;
    }
    throw e;
  }

  return await bpkg({
    env: 'browser',
    target,
    input: input,
    ignoreMissing: true,
    plugins: [
      [Plugin, {
        root: input,
        values
      }]
    ]
  });
}

async function tryBrowserify(input, values) {
  assert(typeof input === 'string');
  assert(values == null || typeof values === 'object');

  let browserify;

  try {
    browserify = globalRequire('browserify');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      const err = new Error('browserify is not installed!');
      err.code = 'ERR_NOT_INSTALLED';
      throw err;
    }
    throw e;
  }

  const options = { ignoreMissing: true };
  const transform = Transform.create(input, values);
  const ctx = browserify(options);

  return new Promise((resolve, reject) => {
    const cb = (err, buf) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(buf.toString('utf8'));
    };

    try {
      ctx.on('error', reject);
      ctx.add(input, options);
      ctx.transform(transform);
      ctx.bundle(cb);
    } catch (e) {
      reject(e);
    }
  });
}

function convert(options, target = 'cjs') {
  assert(options && typeof options === 'object');
  assert(Array.isArray(options.files));
  assert(Array.isArray(options.requires));
  assert(target === 'cjs' || target === 'esm');

  const requires = [];
  const functions = [];

  for (const file of options.requires) {
    const path = globalRequire.resolve(file);

    requires.push(`require(${JSON.stringify(path)});`);
  }

  if (target === 'esm') {
    for (const file of options.files)
      functions.push(`async () => import(${JSON.stringify(file)})`);
  } else {
    for (const file of options.files)
      functions.push(`() => require(${JSON.stringify(file)})`);
  }

  if (requires.length === 0)
    requires.push('// No requires');

  if (functions.length === 0)
    functions.push('// No functions');

  let bfile;
  try {
    bfile = globalRequire.resolve('bfile');
  } catch (e) {
    bfile = 'bfile';
  }

  return {
    requires: requires.join('\n'),
    functions: functions.join(',\n  '),
    bfile: JSON.stringify(bfile),
    options: JSON.stringify({
      allowUncaught: options.allowUncaught,
      asyncOnly: options.asyncOnly,
      backend: options.backend,
      bail: options.bail,
      checkLeaks: options.checkLeaks,
      colors: options.colors,
      columns: options.stream.isTTY ? options.stream.columns : 75,
      console: options.console,
      delay: options.delay,
      diff: options.diff,
      env: options.env,
      exit: options.exit,
      fgrep: options.fgrep,
      forbidOnly: options.forbidOnly,
      forbidPending: options.forbidPending,
      fullTrace: options.fullTrace,
      grep: options.grep ? options.grep.source : null,
      growl: options.growl,
      headless: options.headless,
      invert: options.invert,
      isTTY: Boolean(options.stream.isTTY),
      reporterOptions: options.reporterOptions,
      globals: options.globals,
      reporter: options.reporter,
      retries: options.retries,
      slow: options.slow,
      stream: null,
      swallow: options.swallow,
      timeout: options.timeout,
      timeouts: options.timeouts,
      why: options.why,
      windows: options.windows
    }, null, 2),
    platform: JSON.stringify({
      argv: process.argv,
      constants: fs.constants,
      env: process.env
    }, null, 2)
  };
}

/**
 * Plugin
 */

class Plugin {
  constructor(bundle, options) {
    assert(options && typeof options === 'object');
    assert(typeof options.root === 'string');
    assert(options.values == null || typeof options.values === 'object');

    this.root = resolve(options.root, '.');
    this.values = options.values;
  }

  async compile(module, code) {
    if (!this.values)
      return code;

    if (resolve(module.filename, '.') !== this.root)
      return code;

    return preprocess(code, this.values);
  }
}

/**
 * Transform
 */

class Transform extends stream.Transform {
  constructor(file, root, values) {
    assert(typeof file === 'string');
    assert(typeof root === 'string');
    assert(values == null || typeof values === 'object');

    super();

    this.file = file;
    this.isRoot = resolve(file, '.') === resolve(root, '.');
    this.values = values;
    this.decoder = new StringDecoder('utf8');
    this.code = '';
  }

  static create(root, values) {
    return function transform(file) {
      return new Transform(file, root, values);
    };
  }

  _preprocess(code) {
    if (this.isRoot && this.values)
      code = preprocess(code, this.values);

    return code;
  }

  _transform(chunk, encoding, cb) {
    assert(Buffer.isBuffer(chunk));

    this.code += this.decoder.write(chunk);

    cb(null, EMPTY);
  }

  _flush(cb) {
    const code = this._preprocess(this.code);
    const raw = Buffer.from(code, 'utf8');

    this.push(raw);

    cb();
  }
}

/*
 * Helpers
 */

function preprocess(text, values) {
  assert(typeof text === 'string');
  assert(values && typeof values === 'object');

  text = text.replace(/\n?\/\*[^*]*\*\/\n?/g, '');

  return text.replace(/(__[0-9a-zA-Z]+__)/g, (name) => {
    name = name.slice(2, -2).toLowerCase();
    return String(values[name]);
  });
}

async function read(path) {
  assert(typeof path === 'string');

  return new Promise((resolve, reject) => {
    const cb = (err, res) => {
      if (err)
        reject(err);
      else
        resolve(res);
    };

    try {
      fs.readFile(path, 'utf8', cb);
    } catch (e) {
      reject(e);
    }
  });
}

function stat(file) {
  assert(typeof file === 'string');

  let st;

  try {
    st = fs.statSync(file);
  } catch (e) {
    if ((e.errno | 0) < 0)
      return e.errno | 0;

    return -1;
  }

  if (st.isFile())
    return 0;

  if (st.isDirectory())
    return 1;

  return -1;
}

function findRoot(path) {
  assert(typeof path === 'string');

  path = resolve(path);

  if (stat(path) === 0)
    path = dirname(path);

  let dir = path;

  for (;;) {
    if (basename(dir) === 'node_modules')
      return null;

    const loc = join(dir, 'package.json');

    if (stat(loc) === 0)
      return dir;

    const next = dirname(dir);

    if (next === dir)
      return null;

    dir = next;
  }
}

function readJSON(file) {
  assert(typeof file === 'string');

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function isESM(path) {
  const root = findRoot(path);

  if (root == null)
    return false;

  const json = readJSON(join(root, 'package.json'));

  if (json == null)
    return false;

  return json.type === 'module';
}

function getTarget(path, files) {
  assert(typeof path === 'string');
  assert(Array.isArray(files));

  try {
    globalRequire.resolve('bpkg');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND')
      return 'cjs';
    throw e;
  }

  for (const file of files) {
    assert(typeof file === 'string');

    if (file.endsWith('.mjs'))
      return 'esm';
  }

  if (isESM(path))
    return 'esm';

  return 'cjs';
}

/*
 * Expose
 */

exports.template = template;
exports.compile = compile;
exports.convert = convert;
exports.getTarget = getTarget;
