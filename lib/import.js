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

imports.supported = async function supported() {
  try {
    await imports('./empty.js');
    return true;
  } catch (e) {
    return false;
  }
};

/*
 * Expose
 */

module.exports = imports;
