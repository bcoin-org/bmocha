/*!
 * notify.js - growl notifications for bmocha
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

const assert = require('assert');
const {resolve} = require('path');

/*
 * Constants
 */

const ERROR_IMG = resolve(__dirname, '..', 'etc', 'error.png');
const OK_IMG = resolve(__dirname, '..', 'etc', 'ok.png');

/*
 * Notify
 */

function notify(stats) {
  const growl = require('../vendor/growl');

  assert(stats && typeof stats === 'object');
  assert((stats.passes >>> 0) === stats.passes);
  assert((stats.failures >>> 0) === stats.failures);
  assert((stats.total >>> 0) === stats.total);
  assert((stats.duration >>> 0) === stats.duration);

  if (stats.failures > 0) {
    const msg = `${stats.failures} of ${stats.total} tests failed`;

    growl(msg, {
      name: 'bmocha',
      title: 'Failed',
      image: ERROR_IMG
    });
  } else {
    const msg = `${stats.passes} tests passed in ${stats.duration}ms`;

    growl(msg, {
      name: 'bmocha',
      title: 'Passed',
      image: OK_IMG
    });
  }
}

/*
 * Expose
 */

module.exports = notify;
