'use strict';

const assert = require('assert');
const {join} = require('path');
const {Stream} = require('stream');
const http = require('http');

/*
 * Constants
 */

const cwd = process.cwd();
const extraDirs = [cwd, join(cwd, 'node_modules')];
const globalDirs = process.platform !== 'win32'
  ? ['/usr/lib/node_modules']
  : [];

/*
 * Serve
 */

function compileIndex(title) {
  assert(typeof title === 'string');

  return outdent(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escape(title)}</title>
      </head>
      <body>
        <p>Loading...</p>
        <script src="/index.js"></script>
      </body>
    </html>
  `, 2);
}

function compileError(title, msg) {
  assert(typeof title === 'string');
  assert(typeof msg === 'string');

  return outdent(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escape(title)}</title>
      </head>
      <body>
        <p>${escape(msg)}</p>
      </body>
    </html>
  `, 2);
}

function compileSuite(mocha, files, requires) {
  assert(mocha && mocha.reporter);
  assert(Array.isArray(files));
  assert(Array.isArray(requires));

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
  funcs = indent(funcs, 3);

  for (const file of requires) {
    assert(typeof file === 'string');

    const path = pathResolve(file, extraDirs);

    reqs.push(`require(${JSON.stringify(path)});`);
  }

  reqs = reqs.join('\n');
  reqs = indent(reqs, 2);

  if (reqs.length === 0)
    reqs = '// No requires.';

  return outdent(`
    'use strict';

    const funcs = [
      ${funcs}
    ];

    const util = require('util');
    const {Mocha, DOMStream, ${reporter}} = require(${jpath});
    const stream = new DOMStream(document.body);
    const mocha = new Mocha(stream);

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

    const formatWithOptions = (options, ...args) => {
      if (typeof args[0] === 'string')
        return util.format(...args);
      return util.inspect(args[0], options);
    };

    process.stdout = stream;
    process.stderr = stream;

    console.log = (...args) => {
      const options = { colors: mocha.colors };
      const str = formatWithOptions(options, ...args);
      stream.write(str + '\\n');
    };

    console.error = console.log;

    console.dir = (obj, options) => {
      if (!options)
        options = {};

      options = Object.assign({}, options);

      if (options.colors == null)
        options.colors = false;

      options.customInspect = false;

      const str = formatWithOptions(options, ...args);
      stream.write(str + '\\n');
    };

    mocha.colors = ${mocha.colors};
    mocha.bail = ${mocha.bail};
    mocha.grep = ${JSON.stringify(mocha.grep)};
    mocha.fgrep = ${mocha.fgrep};
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
  `, 2);
}

function compileStack(err) {
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
  `, 2);
}

async function browserify(code) {
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

async function handle(mocha, files, requires, req, res) {
  if (req.method === 'GET' && req.url === '/index.js') {
    let code, msg;

    try {
      code = compileSuite(mocha, files, requires);
      msg = await browserify(code);
    } catch (e) {
      msg = compileStack(e);
    }

    const len = Buffer.byteLength(msg, 'utf8');

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Length', len.toString(10));

    res.write(msg);
    res.end();

    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const msg = compileIndex('bmocha');
    const len = Buffer.byteLength(msg, 'utf8');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', len.toString(10));

    res.write(msg);
    res.end();

    return;
  }

  {
    const msg = compileError('bmocha: 404', 'Not found');
    const len = Buffer.byteLength(msg, 'utf8');

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', len.toString(10));

    res.write(msg);
    res.end();

    return;
  }
}

function serve(mocha, files, requires, port) {
  assert(mocha && mocha.reporter);
  assert(Array.isArray(files));
  assert(Array.isArray(requires));
  assert((port & 0xffff) === port);
  assert(port !== 0);

  const server = http.createServer();

  server.on('request', async (req, res) => {
    try {
      req.on('error', e => server.emit('error', e));
      res.on('error', e => server.emit('error', e));
      await handle(mocha, files, requires, req, res);
    } catch (e) {
      server.emit('error', e);
    }
  });

  server.listen(port, 'localhost');

  return server;
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

module.exports = serve;
