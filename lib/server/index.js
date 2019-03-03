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
const {style} = require('../bmocha');
const browserify = require('./browserify');
const notify = require('../notify');

const {
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

  async compileIndex(title) {
    return browserify.template('index.html', {
      title: escape(title),
      font: style.font,
      fg: style.fg,
      bg: style.bg
    });
  }

  async compileError(title, msg) {
    return browserify.template('error.html', {
      title: escape(title),
      msg: escape(msg),
      font: style.font,
      fg: style.fg,
      bg: style.bg
    });
  }

  async compileSuite() {
    const options = browserify.convert(this.options);
    const code = await browserify.compile('index.js', options);

    this.lastBundle = code;

    return code;
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

    return browserify.template('stack.js', {
      msg: JSON.stringify(str)
    });
  }

  async compileHTML(title) {
    if (!this.lastBundle)
      await this.compileSuite();

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

    return browserify.template('code.html', {
      title: escape(title),
      font: style.font,
      fg: style.fg,
      bg: style.bg,
      msg
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
          syscall: e.syscall,
          stack: e.stack
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
        msg = await this.compileSuite();
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
        await notify(args[1]);
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
          const bundle = await browserify.compile(path);

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

function parsePath(path) {
  if (typeof path !== 'string')
    throw new Error('Invalid path.');

  path = join(cwd, path);
  path = normalize(path);

  if (path.includes('..')
      || !path.startsWith(normalize(cwd))) {
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
