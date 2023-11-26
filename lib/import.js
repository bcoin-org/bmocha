/*!
 * import.js - import for bmocha
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

/*
 * Imports
 */

async function imports(url) {
  return import(url);
}

/*
 * Static
 */

imports.supported = true;

/*
 * Test
 */

if (!(imports('./empty.js') instanceof Promise))
  throw new Error();

/*
 * Expose
 */

module.exports = imports;
