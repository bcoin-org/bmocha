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
  resolve
} = path;

/*
 * Caches
 */

const rootCache = Object.create(null);
const importCache = Object.create(null);

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

function isModule(path) {
  const root = findRoot(path);

  if (root == null)
    return false;

  const cache = rootCache[root];

  if (cache != null)
    return cache;

  const json = readJSON(join(root, 'package.json'));

  if (json == null)
    return false;

  const result = json.type === 'module';

  rootCache[root] = result;

  return result;
}

function isImport(path) {
  assert(typeof path === 'string');

  switch (extname(path)) {
    case '.cjs':
    case '.mjs':
    case '.wasm':
      return true;
    case '.json':
    case '.node':
      return false;
  }

  path = resolve(path, '..');

  const cache = importCache[path];

  if (cache != null)
    return cache;

  const result = isModule(path);

  importCache[path] = result;

  return result;
}

/*
 * Expose
 */

exports.isModule = isModule;
exports.isImport = isImport;
