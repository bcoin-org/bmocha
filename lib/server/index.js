'use strict';

const assert = require('assert');
const {EventEmitter} = require('events');
const fs = require('fs');
const http = require('http');
const {join, resolve} = require('path');
const {Stream} = require('stream');
const {style} = require('../bmocha');
const transform = require('./transform');

/*
 * Constants
 */

const cwd = process.cwd();
const favicon = resolve(__dirname, '..', '..', 'etc', 'favicon.ico');
const extraDirs = [cwd, join(cwd, 'node_modules')];

let globalDirs = [
  '/usr/lib/node_modules',
  '/usr/local/lib/node_modules'
];

if (process.platform === 'win32') {
  const USERPROFILE = process.env.USERPROFILE;

  globalDirs = [
    `${USERPROFILE}\\AppData\\npm\\node_modules`,
    `${USERPROFILE}\\AppData\\Roaming\\npm\\node_modules`
  ];
}

/**
 * Server
 */

class Server extends EventEmitter {
  constructor(mocha, files, requires) {
    assert(mocha && mocha.reporter);
    assert(Array.isArray(files));
    assert(Array.isArray(requires));

    super();

    this.mocha = mocha;
    this.files = files;
    this.requires = requires;
    this.server = http.createServer();
    this._listening = false;
    this.reqIndex = false;
    this.reqTest = false;

    this.init();
  }

  init() {
    this.server.on('listening', () => this.emit('listening', this.address()));
    this.server.on('connection', socket => this.emit('connection', socket));
    this.server.on('request', (req, res) => this.emit('request', req, res));
    this.server.on('close', err => this.emit('close'));

    this.server.on('error', (err) => {
      if (this._listening)
        this.emit('error', err);
    });

    this.on('request', async (req, res) => {
      try {
        req.on('error', e => this.emit('error', e));
        res.on('error', e => this.emit('error', e));
        await this.handle(req, res);
      } catch (e) {
        this.emit('error', e);
      }
    });
  }

  address() {
    return this.server.address();
  }

  ref() {
    this.server.ref();
    return this;
  }

  unref() {
    this.server.unref();
    return this;
  }

  listen(...args) {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);

      args.push(() => {
        this.server.removeListener('error', reject);
        this._listening = true;
        resolve(this.address());
      });

      try {
        this.server.listen(...args);
      } catch (e) {
        this.server.removeListener('error', reject);
        reject(e);
      }
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      const cb = (err) => {
        if (err) {
          reject(err);
          return;
        }

        this._listening = false;

        resolve();
      };

      try {
        this.server.close(cb);
      } catch (e) {
        reject(e);
      }
    });
  }

  compileIndex(title) {
    assert(typeof title === 'string');

    return template('index.html', {
      title: escape(title),
      font: style.font,
      fg: style.fg,
      bg: style.bg
    });
  }

  compileError(title, msg) {
    assert(typeof title === 'string');
    assert(typeof msg === 'string');

    return template('error.html', {
      title: escape(title),
      msg: escape(msg),
      font: style.font,
      fg: style.fg,
      bg: style.bg
    });
  }

  compileSuite() {
    const {mocha, files, requires} = this;
    const path = require.resolve('../bmocha.js');
    const funcs = [];
    const reqs = [];

    for (const file of files) {
      assert(typeof file === 'string');
      funcs.push(`() => require(${JSON.stringify(file)})`);
    }

    for (const file of requires) {
      assert(typeof file === 'string');

      const path = pathResolve(file, extraDirs);

      reqs.push(`require(${JSON.stringify(path)});`);
    }

    return template('index.js', {
      funcs: funcs.join(',\n  '),
      path: JSON.stringify(path),
      reporter: mocha.reporter.constructor.name,
      console: mocha.console,
      colors: mocha.colors,
      bail: mocha.bail,
      grep: mocha.grep,
      fgrep: JSON.stringify(mocha.fgrep),
      invert: mocha.invert,
      slow: mocha.slow,
      timeout: mocha.timeout,
      timeouts: mocha.timeouts,
      retries: mocha.retries,
      options: JSON.stringify(mocha.reporter.options),
      requires: reqs.join('\n'),
      istty: process.stdout.isTTY
    });
  }

  compileStack(err) {
    if (err == null || typeof err !== 'object')
      err = String(err);

    if (typeof err === 'string')
      err = new Error(err);

    assert(err && typeof err === 'object');

    let str = '';

    str += 'The server encountered an error:\n';
    str += '\n';
    str += String(err.stack);

    str = escape(str);
    str = str.replace(/ /g, '&nbsp;');
    str = str.replace(/\n/g, '<br>');

    return template('stack.js', {
      msg: JSON.stringify(str)
    });
  }

  async browserify(code) {
    assert(typeof code === 'string');

    let browserify;

    try {
      browserify = pathRequire('browserify', globalDirs);
    } catch (e) {
      throw new Error('Browserify not installed!');
    }

    const ctx = browserify();

    return new Promise((resolve, reject) => {
      const input = new Stream();

      input.readable = true;
      input.writable = false;

      setImmediate(() => {
        input.emit('data', code);
        input.emit('end');
      });

      input.on('error', reject);
      ctx.on('error', reject);

      const cb = (err, buf) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(buf.toString('utf8'));
      };

      try {
        ctx.add(input, {
          ignoreMissing: true
        });
        ctx.transform(transform);
        ctx.bundle(cb);
      } catch (e) {
        reject(e);
      }
    });
  }

  isFull() {
    return this.reqIndex && this.reqTest;
  }

  async handle(req, res) {
    if (req.method === 'GET' && req.url === '/') {
      const msg = this.compileIndex('bmocha');
      const len = Buffer.byteLength(msg, 'utf8');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', len.toString(10));

      res.write(msg);
      res.end();

      this.reqIndex = true;

      if (this.isFull())
        this.emit('full');

      return;
    }

    if (req.method === 'GET' && req.url === '/index.js') {
      let code, msg;

      try {
        code = this.compileSuite();
        msg = await this.browserify(code);
      } catch (e) {
        msg = this.compileStack(e);
      }

      const len = Buffer.byteLength(msg, 'utf8');

      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Content-Length', len.toString(10));

      res.write(msg);
      res.end();

      this.reqTest = true;

      if (this.isFull())
        this.emit('full');

      return;
    }

    if (req.method === 'GET' && req.url === '/favicon.ico') {
      const msg = fs.readFileSync(favicon);
      const len = msg.length;

      res.setHeader('Content-Type', 'image/x-icon');
      res.setHeader('Content-Length', len.toString(10));

      res.write(msg);
      res.end();

      return;
    }

    {
      const msg = this.compileError('bmocha: 404', 'Not found.');
      const len = Buffer.byteLength(msg, 'utf8');

      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', len.toString(10));

      res.write(msg);
      res.end();

      return;
    }
  }
}

/*
 * Helpers
 */

function escape(str) {
  assert(typeof str === 'string');

  str = str.replace(/&/g, '&amp;');
  str = str.replace(/</g, '&lt;');
  str = str.replace(/>/g, '&gt;');
  str = str.replace(/"/g, '&quot;');
  str = str.replace(/'/g, '&#39;');

  return str;
}

function template(file, values) {
  assert(typeof file === 'string');
  assert(values && typeof values === 'object');

  const path = resolve(__dirname, 'templates', file);

  let text = fs.readFileSync(path, 'utf8');

  text = text.replace(/\/\*[^\n*]+\*\//g, '');

  return text.replace(/(__[0-9a-zA-Z]+__)/g, (name) => {
    name = name.slice(2, -2).toLowerCase();
    return String(values[name]);
  });
}

function pathResolve(name, dirs) {
  assert(typeof name === 'string');
  assert(Array.isArray(dirs));

  for (const path of dirs)
    assert(typeof path === 'string');

  const save = module.paths.slice();

  module.paths.push(...dirs);

  try {
    return require.resolve(name);
  } finally {
    module.paths.length = 0;

    for (const path of save)
      module.paths.push(path);
  }
}

function pathRequire(name, dirs) {
  return require(pathResolve(name, dirs));
}

/*
 * Expose
 */

module.exports = Server;
