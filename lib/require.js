/*!
 * require.js - custom require for bmocha
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

const path = require('path');

const {
  basename,
  join,
  resolve
} = path;

/*
 * Require
 */

function _require(location, root = process.cwd()) {
  const undo = injectPaths(root);
  try {
    return require(tryResolve(root, location));
  } finally {
    undo();
  }
}

_require.resolve = function resolve(location, root = process.cwd()) {
  const undo = injectPaths(root);
  try {
    return require.resolve(tryResolve(root, location));
  } finally {
    undo();
  }
};

/*
 * Helpers
 */

function injectPaths(root) {
  if (typeof root !== 'string')
    throw new TypeError('"root" must be a string.');

  const paths = [];

  let dir = root;

  for (;;) {
    if (basename(dir) !== 'node_modules')
      paths.push(join(dir, 'node_modules'));

    const next = resolve(dir, '..');

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

  const save = module.paths.slice();

  module.paths.length = 0;
  module.paths.push(...paths);

  return () => {
    module.paths.length = 0;
    module.paths.push(...save);
  };
}

function tryResolve(root, location) {
  if (typeof root !== 'string')
    throw new TypeError('"root" must be a string.');

  if (typeof location !== 'string')
    return location;

  if (location === '.'
      || location.startsWith('./')
      || location.startsWith('../')
      || location.startsWith('.\\')
      || location.startsWith('..\\')) {
    return resolve(root, location);
  }

  return location;
}

/*
 * Expose
 */

module.exports = _require;
