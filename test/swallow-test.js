/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

describe('Swallow', () => {
  it('should warn', (cb) => {
    cb();
    throw new Error('foobar');
  });
});
