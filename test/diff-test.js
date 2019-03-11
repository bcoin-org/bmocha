/* eslint-env mocha */

'use strict';

const assert = require('assert');

describe('Diff', () => {
  it('should diff (1)', () => {
    assert.deepStrictEqual([
      'hello',
      'world',
      'foo',
      'bar',
      'baz'
    ], [
      'hello',
      'world',
      'foz',
      'bar',
      'baz'
    ]);
  });

  it('should diff (2)', () => {
    const d = new Date();
    assert.deepStrictEqual({
      hello: 1,
      world: 'a',
      foo: /bar/,
      bar: d,
      baz: 3
    }, {
      hello: 1,
      world: 'a',
      foz: /bar/,
      bar: d,
      baz: 3
    });
  });
});
