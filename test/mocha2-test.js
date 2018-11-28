/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('assert');

describe('Mocha 2', function() {
  this.timeout(120000);

  let x = 0;
  let y = 0;
  let z = 1;

  beforeEach(() => {
    x += 1;
  });

  afterEach(() => {
    x += 1;
  });

  before(() => {
    y = 1;
  });

  after(() => {
    y = 0;
  });

  it('should succeed', () => {
    assert.strictEqual(x, 1);
    assert.strictEqual(y, 1);
    assert.strictEqual(1, 1);
  });

  it('should fail (randomly)', () => {
    if (Math.random() < 0.30) {
      z = 0;
      assert.strictEqual(0, 1);
    }
  });

  it('should take a while (1)', async () => {
    assert.strictEqual(x, 4 + z);
    await new Promise(r => setTimeout(r, 30));
  });

  it('should take a while (2)', async () => {
    assert.strictEqual(x, 6 + z);
    await new Promise(r => setTimeout(r, 130));
  });

  it('should take a while (3)', (cb) => {
    this.timeout(2000);
    assert.strictEqual(x, 8 + z);
    setTimeout(cb, 30);
  });

  describe('Mocha 3', function() {
    this.timeout(2000);

    it('should succeed', () => {
      assert.strictEqual(x, 9 + z);
      assert.strictEqual(y, 0);
      assert.strictEqual(1, 1);
    });

    it('should fail (randomly)', () => {
      if (Math.random() < 0.30)
        assert.strictEqual(0, 1);
    });
  });
});
