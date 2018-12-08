/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('assert');

describe('Deep Equal', function() {
  if (assert.bufferEqual) {
    it('should fail (1)', () => {
      assert.bufferEqual(Buffer.from('01020304', 'hex'), '010203');
    });

    it('should fail (2)', () => {
      assert.notBufferEqual(Buffer.from('010203', 'hex'), '010203');
    });
  }

  it('should fail (3)', () => {
    assert.deepStrictEqual('01020304', '010203');
  });

  it('should fail (4)', () => {
    assert.notDeepStrictEqual('010203', '010203');
  });

  it('should fail (5)', () => {
    assert.fail('foobar');
  });

  it('should fail (6)', () => {
    assert.ok(false);
  });

  it('should fail (7)', () => {
    assert.throws(() => {});
  });

  if (assert.rejects) {
    it('should fail (8)', async () => {
      await assert.rejects(async () => {});
    });
  }

  it('should fail (9)', () => {
    const makeObj = () => {
      const now = 1544200539595;
      return {
        undef: undefined,
        nil: null,
        nan: NaN,
        inf: Infinity,
        ninf: -Infinity,
        error: new Error('foo'),
        number: 1,
        string: 'foo',
        buffer: Buffer.from([1, 2, 3]),
        time: new Date(now),
        regex: /hello/,
        arraybuffer: new Uint8Array([1, 2, 3]).buffer,
        uint8array: new Uint8Array([1, 2, 3]),
        float32array: new Float32Array([1, 2, 3]),
        args: arguments,
        map: new Map([[1, 'a'], [2, 'b'], [3, 'c']]),
        map2: new Map([[{foo:1}, 'bar'], [/foo/, 'bar'], ['spaced key', 100]]),
        'spaced key': 100,
        set: new Set([1, 2, 3]),
        array: [1, 2, 3],
        object: { a: 1, b: 2, c: 3 }
      };
    };

    const a = makeObj();
    const b = makeObj();

    delete a.map2;
    delete b.map2;

    a.number = 0;
    a.z = 1;

    assert.deepStrictEqual(a, b);
  });

  it('should fail (10)', () => {
    const makeObj = () => {
      const now = 1544200539595;
      return {
        undef: undefined,
        nil: null,
        nan: NaN,
        inf: Infinity,
        ninf: -Infinity,
        error: new Error('foo'),
        number: 1,
        string: 'foo',
        buffer: Buffer.from([1, 2, 3]),
        time: new Date(now),
        regex: /hello/,
        arraybuffer: new Uint8Array([1, 2, 3]).buffer,
        uint8array: new Uint8Array([1, 2, 3]),
        float32array: new Float32Array([1, 2, 3]),
        args: arguments,
        map: new Map([[1, 'a'], [2, 'b'], [3, 'c']]),
        map2: new Map([[{foo:1}, 'bar'], [/foo/, 'bar'], ['spaced key', 100]]),
        'spaced key': 100,
        set: new Set([1, 2, 3]),
        array: [1, 2, 3],
        object: { a: 1, b: 2, c: 3 }
      };
    };

    const a = makeObj();
    const b = makeObj();

    delete a.map2;
    delete b.map2;

    assert.notDeepStrictEqual(a, b);
  });
});
