/* eslint-env mocha */

'use strict';

const assert = require('assert');

describe('Show', () => {
  it('should show assert', (ctx) => {
    ctx.show(assert, { showHidden: false });
  });

  it('should diff', (ctx) => {
    ctx.diff({
      a: 1,
      b: 2
    }, {
      a: 2,
      b: 3
    });
  });
});
