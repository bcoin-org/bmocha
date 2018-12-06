'use strict';

const assert = require('assert');
const {EventEmitter} = require('events');
const fs = require('fs');
const http = require('http');
const {join, resolve, normalize} = require('path');
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
    this.bound = false;

    this.init();
  }

  init() {
    this.server.on('listening', () => this.emit('listening', this.address()));
    this.server.on('connection', socket => this.emit('connection', socket));
    this.server.on('request', (req, res) => this.emit('request', req, res));
    this.server.on('close', err => this.emit('close'));

    this.server.on('error', (err) => {
      if (this.bound)
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
        this.bound = true;
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

        this.bound = false;

        resolve();
      };

      try {
        this.server.close(cb);
      } catch (e) {
        reject(e);
      }
    });
  }

  async compileIndex(title) {
    return template('index.html', {
      title: escapeHTML(title),
      font: style.font,
      fg: style.fg,
      bg: style.bg
    });
  }

  async compileError(title, msg) {
    return template('error.html', {
      title: escapeHTML(title),
      msg: escapeHTML(msg),
      font: style.font,
      fg: style.fg,
      bg: style.bg
    });
  }

  async compileSuite() {
    const {mocha} = this;
    const path = require.resolve('../bmocha.js');
    const functions = [];
    const requires = [];

    for (const file of this.files) {
      assert(typeof file === 'string');
      functions.push(`() => require(${JSON.stringify(file)})`);
    }

    for (const file of this.requires) {
      assert(typeof file === 'string');

      const path = pathResolve(file, extraDirs);

      requires.push(`require(${JSON.stringify(path)});`);
    }

    return template('index.js', {
      functions: functions.join(',\n  '),
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
      requires: requires.join('\n'),
      istty: process.stdout.isTTY
    });
  }

  async compileStack(err) {
    if (err == null || typeof err !== 'object')
      err = String(err);

    if (typeof err === 'string')
      err = new Error(err);

    assert(err && typeof err === 'object');

    let str = '';

    str += 'The server encountered an error:\n';
    str += '\n';
    str += String(err.stack);

    str = escapeHTML(str);
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

  send(res, code, type, msg) {
    assert(res && typeof res.setHeader === 'function');
    assert((code >>> 0) === code);
    assert(typeof type === 'string');
    assert(typeof msg === 'string' || Buffer.isBuffer(msg));

    const length = Buffer.byteLength(msg, 'utf8');

    res.statusCode = code;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', length.toString(10));
    res.write(msg);
    res.end();
  }

  sendText(res, code, msg) {
    return this.send(res, code, 'text/plain; charset=utf-8', msg);
  }

  sendHTML(res, code, msg) {
    return this.send(res, code, 'text/html; charset=utf-8', msg);
  }

  sendJS(res, code, msg) {
    return this.send(res, code, 'application/javascript; charset=utf-8', msg);
  }

  sendJSON(res, code, msg) {
    if (typeof msg !== 'string')
      msg = JSON.stringify(msg);

    return this.send(res, code, 'application/json; charset=utf-8', msg);
  }

  sendIcon(res, code, msg) {
    return this.send(res, code, 'image/x-icon', msg);
  }

  async sendError(res, code, msg = 'Error.') {
    const page = await this.compileError(`bmocha: ${code}`, String(msg));
    return this.sendHTML(res, code, page);
  }

  async handle(req, res) {
    if (req.method !== 'GET')
      return this.sendError(res, 404);

    if (req.url === '/' || req.url === '/index.html') {
      const msg = await this.compileIndex('bmocha');
      return this.sendHTML(res, 200, msg);
    }

    if (req.url === '/index.js') {
      let code, msg;

      try {
        code = await this.compileSuite();
        msg = await this.browserify(code);
      } catch (e) {
        msg = await this.compileStack(e);
      }

      return this.sendJS(res, 200, msg);
    }

    if (req.url === '/favicon.ico') {
      let msg;

      try {
        msg = await readFile(favicon);
      } catch (e) {
        this.emit('error', e);
        return this.sendError(res, 500);
      }

      return this.sendIcon(res, 200, msg);
    }

    if (isFilePath(req.url)) {
      const path = parseFilePath(req.url);

      if (path == null) {
        return this.sendJSON(res, 400, {
          message: 'Invalid file path.'
        });
      }

      let msg;

      try {
        msg = await readFile(path, 'base64');
      } catch (e) {
        return this.sendJSON(res, 400, {
          message: e.message,
          name: e.name,
          errno: e.errno,
          code: e.code,
          syscall: e.syscall
        });
      }

      return this.sendText(res, 200, msg);
    }

    return this.sendError(res, 200);
  }
}

/*
 * Helpers
 */

function escapeHTML(str) {
  assert(typeof str === 'string');

  str = str.replace(/&/g, '&amp;');
  str = str.replace(/</g, '&lt;');
  str = str.replace(/>/g, '&gt;');
  str = str.replace(/"/g, '&quot;');
  str = str.replace(/'/g, '&#39;');

  return str;
}

async function readFile(path, enc) {
  return new Promise((resolve, reject) => {
    const cb = (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    };

    try {
      fs.readFile(path, enc, cb);
    } catch (e) {
      reject(e);
    }
  });
}

async function template(file, values) {
  assert(typeof file === 'string');
  assert(values && typeof values === 'object');

  const path = resolve(__dirname, 'templates', file);

  let text = await readFile(path, 'utf8');

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

function isFilePath(url) {
  assert(typeof url === 'string');

  if (url.length < 11)
    return false;

  return url.substring(0, 11) === '/file?path=';
}

function parseFilePath(url) {
  assert(typeof url === 'string');
  try {
    const encoded = url.substring(11);
    const decoded = decodeURIComponent(encoded);

    return join(cwd, normalize(decoded));
  } catch (e) {
    return null;
  }
}

/*
 * Expose
 */

module.exports = Server;
