/*!
 * require.js - custom require for bmocha
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

const path = require('path');

const {
  basename,
  dirname,
  join,
  resolve
} = path;

/*
 * Require
 */

function globalRequire(id, root = '.') {
  return require(globalResolve(id, root));
}

function globalResolve(id, root = '.') {
  if (typeof id !== 'string')
    throw new TypeError('"id" must be a string.');

  if (typeof root !== 'string')
    throw new TypeError('"root" must be a string.');

  if (id === '.' ||
      id === '..' ||
      id.startsWith('./') ||
      id.startsWith('../') ||
      id.startsWith('.\\') ||
      id.startsWith('..\\')) {
    id = resolve(root, id);
  }

  if (!require.resolve.paths) {
    const undo = injectPaths(root);

    try {
      return require.resolve(id);
    } finally {
      undo();
    }
  }

  return require.resolve(id, {
    paths: nodeModulePaths(root)
  });
};

globalRequire.resolve = globalResolve;

/*
 * Helpers
 */

function nodeModulePaths(root) {
  if (typeof root !== 'string')
    throw new TypeError('"root" must be a string.');

  const paths = [];

  let dir = resolve(root);

  for (;;) {
    if (basename(dir) !== 'node_modules')
      paths.push(join(dir, 'node_modules'));

    const next = dirname(dir);

    if (next === dir)
      break;

    dir = next;
  }

  if (process.platform === 'win32') {
    const {APPDATA} = process.env;
    if (APPDATA)
      paths.push(resolve(APPDATA, 'npm', 'node_modules'));
  } else {
    const PREFIX = resolve(process.execPath, '..', '..');
    paths.push(join(PREFIX, 'lib', 'node_modules'));
  }

  return paths;
}

function injectPaths(root) {
  const paths = nodeModulePaths(root);
  const save = module.paths.slice();

  module.paths.length = 0;
  module.paths.push(...paths);

  return () => {
    module.paths.length = 0;
    module.paths.push(...save);
  };
}

/*
 * Expose
 */

module.exports = globalRequire;
