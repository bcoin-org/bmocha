'use strict';

const assert = require('assert');
const {EventEmitter} = require('events');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {Stream} = require('stream');
const {style} = require('../bmocha');
const transform = require('./transform');

const {
  dirname,
  join,
  normalize,
  resolve
} = path;

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
  constructor(mocha, files, requires, options = {}) {
    assert(mocha && mocha.reporter);
    assert(Array.isArray(files));
    assert(Array.isArray(requires));
    assert(options && typeof options === 'object');

    super();

    this.mocha = mocha;
    this.files = files;
    this.requires = requires;
    this.server = http.createServer();
    this.bound = false;
    this.registered = Object.create(null);
    this.doExit = Boolean(options.doExit);
    this.useConsole = Boolean(options.useConsole);
    this.headless = Boolean(options.headless);

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
        if (!res.headersSent) {
          try {
            await this.sendError(res, 500);
          } catch (e) {
            this.emit('error', e);
          }
        }
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
      arch: JSON.stringify(process.arch),
      argv: JSON.stringify(process.argv),
      argv0: JSON.stringify(process.argv0),
      bail: mocha.bail,
      colors: mocha.colors,
      console: this.useConsole,
      constants: JSON.stringify(fs.constants, null, 2),
      env: JSON.stringify(process.env, null, 2),
      exit: this.doExit,
      fgrep: JSON.stringify(mocha.fgrep),
      functions: functions.join(',\n  '),
      grep: mocha.grep,
      headless: this.headless,
      invert: mocha.invert,
      istty: process.stdout.isTTY,
      options: JSON.stringify(mocha.reporter.options),
      path: JSON.stringify(path),
      pid: process.pid,
      platform: JSON.stringify(process.platform),
      ppid: process.ppid,
      reporter: mocha.reporter.constructor.name,
      requires: requires.join('\n'),
      retries: mocha.retries,
      slow: mocha.slow,
      timeout: mocha.timeout,
      timeouts: mocha.timeouts,
      version: JSON.stringify(process.version),
      versions: JSON.stringify(process.versions, null, 2)
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

  async browserify(code, file) {
    assert(typeof code === 'string');
    assert(file == null || typeof file === 'string');

    let browserify;
    let builtins;
    let basedir;

    try {
      browserify = pathRequire('browserify', globalDirs);
      builtins = pathRequire('browserify/lib/builtins', globalDirs);
    } catch (e) {
      throw new Error('Browserify not installed!');
    }

    if (file)
      basedir = dirname(file);

    // builtins = Object.assign({}, builtins, {
    //   _process: require.resolve('./builtins/process'),
    //   perf_hooks: require.resolve('./builtins/perf_hooks')
    // });

    const ctx = browserify([], { builtins });

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

  send(res, code, type, msg) {
    assert(res && typeof res.setHeader === 'function');
    assert((code >>> 0) === code);
    assert(typeof type === 'string');
    assert(typeof msg === 'string' || Buffer.isBuffer(msg));

    const length = Buffer.byteLength(msg, 'utf8');

    res.statusCode = code;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', length.toString(10));
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

    return this.sendError(res, 404);
  }

  async handleGet(req, res) {
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
        if (this.headless) {
          process.stderr.write(e.stack + '\n');
          process.exit(1);
        }

        msg = await this.compileStack(e);
      }

      return this.sendJS(res, 200, msg);
    }

    if (req.url === '/favicon.ico') {
      const msg = await fsReadFile(favicon);
      return this.sendIcon(res, 200, msg);
    }

    if (this.registered[req.url]) {
      const code = this.registered[req.url];
      return this.sendJS(res, 200, code);
    }

    return this.sendError(res, 404);
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

      case 'read': {
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
        process.stdout.write(text);
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

    return this.sendError(res, 400);
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

function pathResolve(name, dirs) {
  assert(typeof name === 'string');
  assert(Array.isArray(dirs));

  for (const path of dirs)
    assert(typeof path === 'string');

  const save = module.paths.slice();

  try {
    module.paths.push(...dirs);
    return require.resolve(name);
  } finally {
    module.paths.length = 0;
    module.paths.push(...save);
  }
}

function pathRequire(name, dirs) {
  return require(pathResolve(name, dirs));
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
