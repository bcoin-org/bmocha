/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('assert');

const IS_MOCHA = Boolean(process.env.LOADED_MOCHA_OPTS);

describe('Deep Equal', function() {
  if (assert.bufferEqual) {
    it('should fail (buffer equal)', () => {
      assert.bufferEqual(Buffer.from('01020304', 'hex'), '010203');
    });

    it('should fail (not buffer equal)', () => {
      assert.notBufferEqual(Buffer.from('010203', 'hex'), '010203');
    });
  }

  it('should fail (strict equal string)', () => {
    assert.strictEqual('01020304', '010203');
  });

  it('should fail (not strict equal string)', () => {
    assert.notStrictEqual('010203', '010203');
  });

  it('should fail (strict equal number)', () => {
    assert.strictEqual(1, 2);
  });

  it('should fail (not strict equal number)', () => {
    assert.notStrictEqual(1, 1);
  });

  it('should fail (deep equal string)', () => {
    assert.deepStrictEqual('01020304', '010203');
  });

  it('should fail (not deep equal string)', () => {
    assert.notDeepStrictEqual('010203', '010203');
  });

  it('should fail (deep equal number)', () => {
    assert.deepStrictEqual(1, 2);
  });

  it('should fail (not deep equal number)', () => {
    assert.notDeepStrictEqual(1, 1);
  });

  it('should fail (fail)', () => {
    assert.fail('foobar');
  });

  it('should fail (assert)', () => {
    assert.ok(false);
  });

  it('should fail (throws)', () => {
    assert.throws(() => {});
  });

  if (assert.rejects) {
    it('should fail (rejects)', async () => {
      await assert.rejects(async () => {});
    });
  }

  it('should fail (strict equal)', () => {
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

    delete a.args;
    delete a.map2;

    delete b.args;
    delete b.map2;

    a.number = 0;
    a.z = 1;

    assert.deepStrictEqual(a, b);
  });

  it('should fail (not strict equal)', () => {
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

    delete a.args;
    delete a.nan;
    delete a.map2;

    delete b.args;
    delete b.nan;
    delete b.map2;

    assert.notDeepStrictEqual(a, b);
  });

  it('should fail (double call)', (cb) => {
    setImmediate(cb);
    setImmediate(cb);
  });

  it('should fail (overspecified promise)', (cb) => {
    return Promise.resolve();
  });

  it('should fail (timeout)', (cb) => {
    ;
  });

  if (!IS_MOCHA) {
    it('should succeed (context)', async (ctx) => {
      assert(ctx && typeof ctx === 'object');
      assert(typeof ctx.timeout === 'function');
    });
  } else {
    it('should fail (overspecified async func)', async (cb) => {
      assert(1);
    });
  }
});
