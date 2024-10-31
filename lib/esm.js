/*!
 * esm.js - package.json type checker for bmocha
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  basename,
  dirname,
  extname,
  join,
  resolve,
  sep
} = path;

/*
 * Caches
 */

const rootCache = Object.create(null);
const importCache = Object.create(null);

/*
 * Flags
 */

const parts = process.version.split(/[^\d]/);
const execArgv = process.execArgv || [];

const NODE_VERSION = (0
  + (parts[1] & 0xff) * 0x10000
  + (parts[2] & 0xff) * 0x00100
  + (parts[3] & 0xff) * 0x00001);

const DEFAULT_TYPE = (() => {
  if (execArgv.includes('--experimental-default-type=commonjs'))
    return 'commonjs';

  if (execArgv.includes('--experimental-default-type=module'))
    return 'module';

  const index = execArgv.indexOf('--experimental-default-type');

  if (index + 1 >= execArgv.length)
    return null;

  const arg = execArgv[index + 1];

  if (arg === 'commonjs' || arg === 'module')
    return arg;

  return null;
})();

// Module detection is default in 22.7.0.
const DETECT_MODULE = NODE_VERSION >= 0x160700
                    ? !execArgv.includes('--no-experimental-detect-module')
                    : execArgv.includes('--experimental-detect-module');

const STRIP_TYPES = execArgv.includes('--experimental-strip-types')
                 || execArgv.includes('--experimental-transform-types');

const TRANSFORM_TYPES = execArgv.includes('--experimental-transform-types');

const WASM_MODULES = execArgv.includes('--experimental-wasm-modules');

/*
 * ESM
 */

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

function readPackageType(path) {
  assert(typeof path === 'string');

  const root = findRoot(path);

  if (root != null) {
    const cache = rootCache[root];

    if (cache !== undefined)
      return cache;

    const json = readJSON(join(root, 'package.json'));

    if (json != null && (json.type === 'commonjs' || json.type === 'module')) {
      rootCache[root] = json.type;
      return json.type;
    }

    rootCache[root] = null;
  }

  return null;
}

function isModule(path) {
  return readPackageType(path) === 'module';
}

function isImport(path) {
  assert(typeof path === 'string');

  path = resolve(path);

  const cache = importCache[path];

  if (cache != null)
    return cache;

  switch (stat(path)) {
    case 0:
      break;
    case 1:
      importCache[path] = isModule(path);
      return importCache[path];
    default:
      importCache[path] = false;
      return false;
  }

  const ext = extname(path);

  switch (ext) {
    case '.mjs':
    case '.mts':
    case '.wasm':
      return true;
    case '.cjs':
    case '.cts':
    case '.json':
    case '.node':
      return false;
  }

  const type = readPackageType(dirname(path));

  if (type != null) {
    importCache[path] = type === 'module';
    return type === 'module';
  }

  if (DEFAULT_TYPE != null && (ext === '.js' || ext === '.ts')) {
    const result = !path.includes(`${sep}node_modules${sep}`)
                && DEFAULT_TYPE === 'module';
    importCache[path] = result;
    return result;
  }

  if (WASM_MODULES && ext === '' && detectWasmBinary(path)) {
    importCache[path] = true;
    return true;
  }

  if (DETECT_MODULE && detectModuleSyntax(path)) {
    importCache[path] = true;
    return true;
  }

  importCache[path] = false;

  return false;
}

/*
 * Syntax Detection
 */

const CJS_SCOPE = [
  'exports',
  'require',
  'module',
  '__filename',
  '__dirname'
];

// https://github.com/nodejs/node/blob/ed5cb37/src/node_contextify.cc#L1406
// Node 12.11.0 and up
const MODULE_ERRORS = [
  'Cannot use import statement outside a module', // `import` statements
  'Unexpected token \'export\'',                  // `export` statements
  'Cannot use \'import.meta\' outside a module'   // `import.meta` references
];

// https://github.com/nodejs/node/blob/63d04d4/src/node_contextify.cc#L1422
const RETRY_ERRORS = [
  'Identifier \'module\' has already been declared',
  'Identifier \'exports\' has already been declared',
  'Identifier \'require\' has already been declared',
  'Identifier \'__filename\' has already been declared',
  'Identifier \'__dirname\' has already been declared',
  // Node 15.1.0 and up
  'await is only valid in async functions and the top level bodies of modules',
  // Node 8.0.0 and up
  'await is only valid in async function'
];

let amaro = null;

function tsCompile(file, code) {
  if (!amaro) {
    try {
      amaro = require('bpkg/vendor/amaro');
    } catch (e) {
      try {
        amaro = require('amaro');
      } catch (e) {
        return null;
      }
    }
  }

  const {code:output} = amaro.transformSync(code, {
    __proto__: null,
    mode: TRANSFORM_TYPES ? 'transform' : 'strip-only',
    sourceMap: false,
    filename: file,
    transform: {
      verbatimModuleSyntax: true
    }
  });

  return output;
}

function hasError(err, messages) {
  for (const msg of messages) {
    if (err.message.includes(msg))
      return true;
  }
  return false;
}

function stripBOM(text) {
  assert(typeof text === 'string');

  // UTF-16 BOM (also slices UTF-8 BOM).
  if (text.charCodeAt(0) === 0xfeff)
    text = text.substring(1);

  return text;
}

function stripHashbang(code) {
  assert(typeof code === 'string');

  if (code.length < 2
      || code.charCodeAt(0) !== 0x23
      || code.charCodeAt(1) !== 0x21) {
    return code;
  }

  let i = 2;
  let j = 1;

  for (; i < code.length; i++) {
    const ch = code.charCodeAt(i);

    // LF
    if (ch === 0x0a)
      break;

    // CR
    if (ch === 0x0d) {
      // CRLF
      if (i + 1 < code.length) {
        if (code.charCodeAt(i + 1) === 0x0a)
          j = 2;
      }

      break;
    }
  }

  if (i === code.length)
    return '';

  return code.substring(i + j);
}

function detectModuleSyntax(path) {
  assert(typeof path === 'string');

  let code;

  try {
    code = fs.readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR')
      return false;
    throw e;
  }

  code = stripHashbang(stripBOM(code));

  if (extname(path) === '.ts') {
    code = tsCompile(path, code);
    if (code == null)
      return true;
  }

  const args = [...CJS_SCOPE, code];

  try {
    new Function(...args);
  } catch (e) {
    if (hasError(e, MODULE_ERRORS))
      return true;

    if (hasError(e, RETRY_ERRORS)) {
      const wrapped = `(async function() {${code}})();`;
      const args = [...CJS_SCOPE, wrapped];

      try {
        new Function(...args);
      } catch (e) {
        return hasError(e, MODULE_ERRORS);
      }

      return true;
    }
  }

  return false;
}

function detectWasmBinary(path) {
  assert(typeof path === 'string');

  let data;

  try {
    data = fs.readFileSync(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR')
      return false;
    throw e;
  }

  return data.readUInt32BE(0) === 0x0061736d;
}

/*
 * Expose
 */

exports.isModule = isModule;
exports.isImport = isImport;
exports.DEFAULT_TYPE = DEFAULT_TYPE;
exports.DETECT_MODULE = DETECT_MODULE;
exports.STRIP_TYPES = STRIP_TYPES;
exports.TRANSFORM_TYPES = TRANSFORM_TYPES;
exports.WASM_MODULES = WASM_MODULES;
