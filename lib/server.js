'use strict';

const assert = require('assert');
const {EventEmitter} = require('events');
const fs = require('fs');
const http = require('http');
const {join, resolve} = require('path');
const {Stream} = require('stream');
const {style} = require('./bmocha');

/*
 * Constants
 */

const cwd = process.cwd();
const favicon = resolve(__dirname, '..', 'etc', 'favicon.ico');
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

    return outdent(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${escape(title)}</title>
          <style>
            body {
              font-family: ${style.font};
              color: ${style.fg};
              background-color: ${style.bg};
            }
          </style>
        </head>
        <body>
          <p>Loading...</p>
          <script src="/index.js"></script>
        </body>
      </html>
    `, 3);
  }

  compileError(title, msg) {
    assert(typeof title === 'string');
    assert(typeof msg === 'string');

    return outdent(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${escape(title)}</title>
          <style>
            body {
              font-family: ${style.font};
              color: ${style.fg};
              background-color: ${style.bg};
            }
          </style>
        </head>
        <body>
          <p>${escape(msg)}</p>
        </body>
      </html>
    `, 3);
  }

  compileSuite() {
    const {mocha, files, requires} = this;
    const path = require.resolve('./bmocha.js');
    const options = mocha.reporter.options;
    const jpath = JSON.stringify(path);
    const joptions = JSON.stringify(options);
    const reporter = mocha.reporter.constructor.name;

    let funcs = [];
    let reqs = [];

    for (const file of files) {
      assert(typeof file === 'string');
      funcs.push(`() => require(${JSON.stringify(file)})`);
    }

    funcs = funcs.join(',\n');
    funcs = indent(funcs, 4);

    for (const file of requires) {
      assert(typeof file === 'string');

      const path = pathResolve(file, extraDirs);

      reqs.push(`require(${JSON.stringify(path)});`);
    }

    reqs = reqs.join('\n');
    reqs = indent(reqs, 3);

    if (reqs.length === 0)
      reqs = '// No requires.';

    return outdent(`
      'use strict';

      const funcs = [
        ${funcs}
      ];

      const util = require('util');
      const bmocha = require(${jpath});

      const {
        Mocha,
        ConsoleStream,
        DOMStream,
        ${reporter}
      } = bmocha;

      let stream = null;

      if (${mocha.console}) {
        stream = new ConsoleStream(console);
        document.body.innerHTML = 'Running... (press Ctrl+Shift+I)';
      } else {
        stream = new DOMStream(document.body);

        const format = (options, ...args) => {
          if (args.length > 0 && typeof args[0] === 'string')
            return util.format(...args);
          return util.inspect(args[0], options);
        };

        console.log = (...args) => {
          const options = { colors: ${mocha.colors} };
          const str = format(options, ...args);

          stream.write(str + '\\n');
        };

        console.error = console.log;

        console.dir = (obj, options) => {
          if (options == null || typeof options !== 'object')
            options = {};

          options = Object.assign({}, options);

          if (options.colors == null)
            options.colors = false;

          if (options.customInspect == null)
            options.customInspect = false;

          const str = format(options, ...args);

          stream.write(str + '\\n');
        };
      }

      process.stdout = stream;
      process.stderr = stream;
      process.env.NODE_BACKEND = 'js';

      process.hrtime = (time) => {
        let now = Date.now();

        if (time) {
          const [hi, lo] = time;
          const start = hi * 1000 + lo / 1e6;
          now = now - Math.floor(start);
        }

        const ms = now % 1000;
        const hi = (now - ms) / 1000;
        const lo = ms * 1e6;

        return [hi, lo];
      };

      global.onerror = (err) => {
        if (err && err.stack)
          err = String(err.stack);
        stream.write(err + '\\n');
      };

      global.onunhandledrejection = ({reason}) => {
        stream.write('Unhandled rejection:\\n');
        stream.write('\\n');
        stream.write(reason + '\\n');
      };

      const mocha = new Mocha(stream);

      if (${mocha.colors} !== ${process.stdout.isTTY})
        mocha.colors = ${mocha.colors};

      mocha.bail = ${mocha.bail};
      mocha.grep = ${mocha.grep};
      mocha.fgrep = ${JSON.stringify(mocha.fgrep)};
      mocha.invert = ${mocha.invert};
      mocha.slow = ${mocha.slow};
      mocha.timeout = ${mocha.timeout};
      mocha.timeouts = ${mocha.timeouts};
      mocha.retries = ${mocha.retries};

      mocha.report(${reporter}, ${joptions});

      ${reqs}

      mocha.run(funcs).catch((err) => {
        stream.write('An error occured outside of the test suite:\\n');
        stream.write('\\n');
        if (err && err.stack)
          err = String(err.stack);
        stream.write(err + '\\n');
      });
    `, 3);
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

    return outdent(`
      'use strict';

      document.body.innerHTML = ${JSON.stringify(str)};
    `, 3);
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

function indent(str, depth) {
  if (depth == null)
    depth = 0;

  assert(typeof str === 'string');
  assert((depth >>> 0) === depth);

  if (depth === 0)
    return str.trim();

  let spaces = '';

  for (let i = 0; i < depth * 2; i++)
    spaces += ' ';

  return str.replace(/^/gm, spaces).trim();
}

function outdent(str, depth) {
  if (depth == null)
    depth = 0;

  assert(typeof str === 'string');
  assert((depth >>> 0) === depth);

  if (depth === 0)
    return str.trim();

  const rx = new RegExp(`^ {1,${depth * 2}}`, 'gm');

  return str.replace(rx, '').trim();
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
