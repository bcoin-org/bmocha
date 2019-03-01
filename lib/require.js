/*!
 * require.js - global require for bmocha
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
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
 * Inject Paths
 */

function inject() {
  const paths = [];

  let dir = process.cwd();

  paths.push(dir);

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

  module.paths.length = 0;
  module.paths.push(...paths);

  return require;
}

/*
 * Expose
 */

module.exports = inject();
