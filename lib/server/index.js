/*!
 * server.js - http server for bmocha
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

const assert = require('assert');
const {EventEmitter} = require('events');
const fs = require('fs');
const path = require('path');
const {Stream} = require('stream');
const {style} = require('../bmocha');
const notify = require('../notify');
const globalRequire = require('../require');
const transform = require('./transform');

const {
  dirname,
  join,
  normalize,
  resolve
} = path;

let highlight = null;

/*
 * Constants
 */

const cwd = resolve(process.cwd(), '.');
const favicon = resolve(__dirname, '..', '..', 'etc', 'favicon.ico');

const CSP = [
  'child-src \'self\' blob: data:',
  'connect-src \'self\' blob: data:',
  'worker-src \'self\' blob: data:'
].join(';') + ';';

/**
 * Server
 */

class Server extends EventEmitter {
  constructor(options) {
    assert(options && typeof options === 'object');

    super();

    this.options = options;

    const http = this.getBackend();
    const opt = this.toHTTP();

    this.server = http.createServer(opt);
    this._reject = null;
    this.registered = Object.create(null);
    this.lastBundle = null;

    this.init();
  }

  init() {
    this.server.on('listening', () => this.emit('listening', this.address()));
    this.server.on('connection', socket => this.emit('connection', socket));
    this.server.on('request', (req, res) => this.emit('request', req, res));
    this.server.on('close', err => this.emit('close'));

    this.server.on('error', (err) => {
      const reject = this._reject;

      if (reject) {
        this._reject = null;
        reject(err);
        return;
      }

      this.emit('error', err);
    });

    this.on('request', async (req, res) => {
      try {
        req.on('error', e => this.emit('error', e));
        res.on('error', e => this.emit('error', e));
        await this.handle(req, res);
      } catch (e) {
        if (!res.headersSent) {
          try {
            await this.sendError(res, 500, 'Server Error');
          } catch (e) {
            this.emit('error', e);
          }
        }
        this.emit('error', e);
      }
    });
  }

  getBackend() {
    return this.options.ssl ? require('https') : require('http');
  }

  toHTTP() {
    if (!this.options.ssl)
      return undefined;

    return {
      key: this.options.key,
      cert: this.options.cert
    };
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
      this._reject = reject;

      args.push(() => {
        this._reject = null;
        resolve(this.address());
      });

      try {
        this.server.listen(...args);
      } catch (e) {
        this._reject = null;
        reject(e);
      }
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this._reject = reject;

      const cb = (err) => {
        this._reject = null;

        if (err) {
          reject(err);
          return;
        }

        resolve();
      };

      try {
        this.server.close(cb);
      } catch (e) {
        this._reject = null;
        reject(e);
      }
    });
  }

  async browserify(code, file) {
    let bpkg;

    try {
      bpkg = globalRequire('bpkg');
    } catch (e) {
      return this._browserify(code, file);
    }

    return bpkg({
      env: 'browser',
      input: file,
      code,
      ignoreMissing: true
    });
  }

  async _browserify(code, file) {
    assert(typeof code === 'string');
    assert(file == null || typeof file === 'string');

    let browserify;
    let builtins;
    let basedir;

    try {
      browserify = globalRequire('browserify');
      builtins = globalRequire('browserify/lib/builtins');
    } catch (e) {
      throw new Error('Browserify not installed!');
    }

    if (file)
      basedir = dirname(file);

    const ctx = browserify([], {
      ignoreMissing: true,
      builtins
    });

    return new Promise((resolve, reject) => {
      const input = new Stream();

      if (file)
        input.file = file;

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
          basedir,
          ignoreMissing: true
        });
        ctx.transform(transform);
        ctx.bundle(cb);
      } catch (e) {
        reject(e);
      }
    });
  }

  async compileIndex(title) {
    return template('index.html', {
      title: escape(title),
      font: style.font,
      fg: style.fg,
      bg: style.bg
    });
  }

  async compileError(title, msg) {
    return template('error.html', {
      title: escape(title),
      msg: escape(msg),
      font: style.font,
      fg: style.fg,
      bg: style.bg
    });
  }

  async compileSuite() {
    const {options} = this;
    const path = require.resolve('../bmocha.js');
    const functions = [];
    const requires = [];

    for (const file of options.files) {
      assert(typeof file === 'string');
      functions.push(`() => require(${JSON.stringify(file)})`);
    }

    for (const file of options.requires) {
      assert(typeof file === 'string');

      const path = globalRequire.resolve(file);

      requires.push(`require(${JSON.stringify(path)});`);
    }

    return template('index.js', {
      path: JSON.stringify(path),
      requires: requires.join('\n'),
      functions: functions.join(',\n  '),
      options: JSON.stringify({
        allowMultiple: options.allowMultiple,
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
        uncaught: options.uncaught,
        windows: options.windows
      }, null, 2),
      platform: JSON.stringify({
        arch: process.arch,
        argv: process.argv,
        argv0: process.argv0,
        constants: fs.constants,
        env: process.env,
        pid: process.pid,
        platform: process.platform,
        ppid: process.ppid,
        version: process.version,
        versions: process.versions
      }, null, 2)
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

    str = escape(str);
    str = str.replace(/ /g, '&nbsp;');
    str = str.replace(/\n/g, '<br>');

    return template('stack.js', {
      msg: JSON.stringify(str)
    });
  }

  async compileHTML(title) {
    if (!this.lastBundle)
      await this.browserifySuite();

    if (!highlight)
      highlight = require('./highlight');

    const code = this.lastBundle;
    const lines = highlight(code).split('\n');
    const max = (lines.length + 1).toString(10).length;

    let msg = '';

    for (let i = 0; i < lines.length; i++) {
      const num = (i + 1).toString(10);
      const pad = ' '.repeat(max - num.length);

      msg += `<a name="L${num}" href="#L${num}">`
           + `${pad}${num}`
           + '</a>'
           + '  '
           + `${lines[i]}`
           + '\n';
    }

    msg = msg.slice(0, -1);

    return template('code.html', {
      title: escape(title),
      font: style.font,
      fg: style.fg,
      bg: style.bg,
      msg
    });
  }

  async browserifySuite() {
    const suite = await this.compileSuite();
    const code = await this.browserify(suite);

    this.lastBundle = code;

    return code;
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
    res.setHeader('Content-Security-Policy', CSP);
    res.write(msg, 'utf8');
    res.end();
  }

  sendHTML(res, code, msg) {
    return this.send(res, code, 'text/html; charset=utf-8', msg);
  }

  sendJS(res, code, msg) {
    return this.send(res, code, 'application/javascript; charset=utf-8', msg);
  }

  sendJSON(res, code, msg) {
    if (typeof msg !== 'string')
      msg = JSON.stringify(msg, null, 2);

    return this.send(res, code, 'application/json; charset=utf-8', msg);
  }

  sendIcon(res, code, msg) {
    return this.send(res, code, 'image/x-icon', msg);
  }

  async sendError(res, code, msg = 'Error.') {
    const page = await this.compileError(`bmocha: ${code}`, String(msg));
    return this.sendHTML(res, code, page);
  }

  async readBody(req) {
    return new Promise((resolve, reject) => {
      try {
        this._readBody(req, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  _readBody(req, resolve, reject) {
    if (req.method !== 'POST') {
      resolve();
      return;
    }

    let json = Object.create(null);
    let out = '';

    req.setEncoding('utf8');

    req.on('data', (data) => {
      if (out.length > 1000000)
        out = '';

      out += data;
    });

    req.on('end', () => {
      out = out.trim();

      try {
        if (out.length > 0)
          json = JSON.parse(out);
      } catch (e) {
        reject(e);
        return;
      }

      if (!json || typeof json !== 'object') {
        reject(new Error('Invalid JSON body.'));
        return;
      }

      resolve(json);
    });
  }

  async handle(req, res) {
    if (req.method === 'GET')
      return this.handleGet(req, res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      res.setHeader('Content-Security-Policy', CSP);
      res.end();
      return undefined;
    }

    if (req.method === 'POST') {
      try {
        const body = await this.readBody(req);
        return await this.handlePost(req, res, body);
      } catch (e) {
        if (res.headersSent)
          throw e;

        return this.sendJSON(res, 400, {
          message: e.message,
          name: e.name,
          errno: e.errno,
          code: e.code,
          syscall: e.syscall
        });
      }
    }

    return this.sendError(res, 404, 'Not Found');
  }

  async handleGet(req, res) {
    if (req.url === '/' || req.url === '/index.html') {
      const msg = await this.compileIndex('bmocha');
      return this.sendHTML(res, 200, msg);
    }

    if (req.url === '/index.js') {
      let msg;

      try {
        msg = await this.browserifySuite();
      } catch (e) {
        if (this.options.headless) {
          process.stderr.write(e.stack + '\n');
          process.exit(1);
        }

        msg = await this.compileStack(e);
      }

      return this.sendJS(res, 200, msg);
    }

    if (req.url === '/index.js.html') {
      const html = await this.compileHTML('index.js');
      return this.sendHTML(res, 200, html);
    }

    if (req.url === '/favicon.ico') {
      const msg = await fsReadFile(favicon);
      return this.sendIcon(res, 200, msg);
    }

    if (this.registered[req.url]) {
      const code = this.registered[req.url];
      return this.sendJS(res, 200, code);
    }

    return this.sendError(res, 404, 'Not Found');
  }

  async handlePost(req, res, args) {
    if (req.url !== '/' || !Array.isArray(args))
      throw new Error('Invalid arguments.');

    const action = String(args[0]);

    switch (action) {
      case 'access': {
        if (args.length < 3)
          throw new Error('Invalid access arguments.');

        const path = parsePath(args[1]);
        const mode = args[2];

        await fsAccess(path, mode);

        return this.sendJSON(res, 200, {});
      }

      case 'exists': {
        const path = parsePath(args[1]);
        const exists = await fsExists(path);

        return this.sendJSON(res, 200, { exists });
      }

      case 'lstat': {
        const path = parsePath(args[1]);
        const stat = await fsLstat(path);

        return this.sendJSON(res, 200, statify(stat));
      }

      case 'notify': {
        notify(args[1]);
        return this.sendJSON(res, 200, {});
      }

      case 'readdir': {
        const path = parsePath(args[1]);
        const list = await fsReaddir(path);

        return this.sendJSON(res, 200, list);
      }

      case 'readfile': {
        if (args.length < 3)
          throw new Error('Invalid read arguments.');

        const path = parsePath(args[1]);
        const enc = String(args[2] || 'base64');
        const data = await fsReadFile(path, enc);

        return this.sendJSON(res, 200, { data });
      }

      case 'stat': {
        const path = parsePath(args[1]);
        const stat = await fsStat(path);

        return this.sendJSON(res, 200, statify(stat));
      }

      case 'register': {
        let name = String(args[1]);

        name = name.replace(/\/{2,}/g, '/');

        if (name.length > 0 && name[0] !== '/')
          name = '/' + name;

        if (name.length > 1 && name[name.length - 1] === '/')
          name = name.slice(0, -1);

        if (name.length === 0 || args.length < 3)
          throw new Error('Invalid register arguments.');

        if (!this.registered[name]) {
          const path = parsePath(args[2]);
          const code = await fsReadFile(path, 'utf8');
          const bundle = await this.browserify(code, path);

          this.registered[name] = bundle;
        }

        return this.sendJSON(res, 200, {});
      }

      case 'write': {
        const text = String(args[1]);
        this.options.stream.write(text);
        return this.sendJSON(res, 200, {});
      }

      case 'exit': {
        process.exit(args[1] >>> 0);
        break;
      }

      case 'close': {
        process.exitCode = args[1] >>> 0;
        req.destroy();
        return this.close();
      }
    }

    return this.sendError(res, 400, 'Bad Request');
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

async function template(file, values) {
  assert(typeof file === 'string');
  assert(values && typeof values === 'object');

  const path = resolve(__dirname, 'templates', file);

  let text = await fsReadFile(path, 'utf8');

  text = text.replace(/\/\*[^*]*\*\//g, '');

  return text.replace(/(__[0-9a-zA-Z]+__)/g, (name) => {
    name = name.slice(2, -2).toLowerCase();
    return String(values[name]);
  });
}

function parsePath(path) {
  if (typeof path !== 'string')
    throw new Error('Invalid path.');

  path = join(cwd, path);
  path = normalize(path);

  if (path.indexOf('..') !== -1
      || path.indexOf(normalize(cwd)) !== 0) {
    const msg = 'read EACCES: Permission denied';
    const err = new Error(msg);

    err.errno = -13;
    err.code = 'EACCES';
    err.syscall = 'read';
    err.path = path;

    if (Error.captureStackTrace)
      Error.captureStackTrace(err, parsePath);

    throw err;
  }

  return path;
}

/*
 * File System Helpers
 */

async function fsAccess(path, mode) {
  return new Promise((resolve, reject) => {
    const cb = (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    };

    try {
      fs.access(path, mode, cb);
    } catch (e) {
      reject(e);
    }
  });
}

async function fsExists(path) {
  return new Promise((resolve, reject) => {
    try {
      fs.exists(path, resolve);
    } catch (e) {
      reject(e);
    }
  });
}

async function fsLstat(path) {
  return new Promise((resolve, reject) => {
    const cb = (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    };

    try {
      fs.lstat(path, cb);
    } catch (e) {
      reject(e);
    }
  });
}

async function fsReaddir(path) {
  return new Promise((resolve, reject) => {
    const cb = (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    };

    try {
      fs.readdir(path, cb);
    } catch (e) {
      reject(e);
    }
  });
}

async function fsReadFile(path, enc) {
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

async function fsStat(path) {
  return new Promise((resolve, reject) => {
    const cb = (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    };

    try {
      fs.stat(path, cb);
    } catch (e) {
      reject(e);
    }
  });
}

function statify(stat) {
  assert(stat && typeof stat === 'object');
  assert(typeof stat.isBlockDevice === 'function');

  return {
    isBlockDevice: stat.isBlockDevice(),
    isCharacterDevice: stat.isCharacterDevice(),
    isDirectory: stat.isDirectory(),
    isFIFO: stat.isFIFO(),
    isFile: stat.isFile(),
    isSocket: stat.isSocket(),
    isSymbolicLink: stat.isSymbolicLink(),
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    uid: stat.uid,
    gid: stat.gid,
    rdev: stat.rdev,
    size: stat.size,
    blksize: stat.blksize,
    blocks: stat.blocks,
    atime: stat.atime.getTime(),
    mtime: stat.mtime.getTime(),
    ctime: stat.ctime.getTime(),
    birthtime: stat.birthtime.getTime()
  };
}

/*
 * Expose
 */

module.exports = Server;
