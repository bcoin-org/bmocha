'use strict';

/* global __REQUIRES__ */
/* global __FUNCTIONS__ */
/* global __OPTIONS__ */
/* global document */

const bmocha = require('../../bmocha');
const common = require('./common');
const {Mocha, DOMStream} = bmocha;

/*
 * Constants
 */

const options = __OPTIONS__;

const body = document.getElementById('bmocha');
const stream = new DOMStream(body);

/*
 * Mocha
 */

options.stream = stream;
options.delay = true;

const mocha = new Mocha(options);

if (options.growl)
  mocha.notify = common.notify;

if (!options.allowUncaught)
  mocha.catcher = common.catcher;

/*
 * Execute
 */

const requires = [
  __REQUIRES__
];

const funcs = [
  __FUNCTIONS__
];

(async () => {
  for (const [loader, file] of requires)
    await mocha.plugin(await loader(), file);

  await mocha.run(funcs);
})().catch((err) => {
  stream.write(err.stack + '\n');
});
