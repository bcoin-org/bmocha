/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */
/* global register, Worker */

'use strict';

const assert = require('assert');
const fs = require('fs');
const hooks = require('perf_hooks');
const {resolve, sep} = require('path');
const wrap = require('./util/wrap');

const fsAccess = wrap(fs.access);
const fsExists = wrap(fs.exists);
const fsLstat = wrap(fs.lstat);
const fsReadFile = wrap(fs.readFile);
const fsStat = wrap(fs.stat);

const x = (Math.random() * 0x100000000) >>> 0;
const y = x.toString(32);
const z = `i-dont-exist${y}`;

const FILE = resolve(__dirname, '..', 'package.json');
const NOENT = resolve(__dirname, '..', z);
const ACCES = `${__dirname}${sep}..${sep}..${sep}${z}`;

if (process.browser) {
  assert.rejects = async (func, ...args) => {
    try {
      await func();
    } catch (e) {
      assert.throws(() => {
        throw e;
      }, ...args);
      return;
    }
    assert.throws(() => {}, ...args);
  };
}

describe('Mocha', function() {
  describe('Sanity', function() {
    describe('Level 1', function() {
      this.timeout(120000);

      let x = 0;
      let y = 0;

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

      it('should fail (randomly)', function() {
        this.retries(1000);
        if (Math.random() < 0.30)
          assert.strictEqual(0, 1);
      });

      it('should take a while (1)', async () => {
        assert.strictEqual(x, 5);
        await new Promise(r => setTimeout(r, 40));
      });

      it('should take a while (2)', async () => {
        assert.strictEqual(x, 7);
        await new Promise(r => setTimeout(r, 130));
      });

      it('should take a while (3)', (cb) => {
        this.timeout(2000);
        assert.strictEqual(x, 9);
        setTimeout(cb, 30);
      });

      describe('Level 2', function() {
        this.timeout(2000);

        after(() => {
          x = 1;
        });

        it('should succeed', () => {
          assert.strictEqual(x, 13);
          assert.strictEqual(y, 1);
          assert.strictEqual(1, 1);
        });

        it('should fail (randomly)', function() {
          this.retries(1000);
          if (Math.random() < 0.30)
            assert.strictEqual(0, 1);
        });
      });

      it('should happen before describe', () => {
        assert.strictEqual(x, 11);
      });
    });

    describe('Level 3', function() {
      it('should skip', function() {
        this.skip();
        assert.strictEqual(0, 1);
      });

      it('should not skip', function() {
        assert.strictEqual(1, 1);
      });
    });
  });

  describe('Global', function() {
    it('should do setImmediate', (cb) => {
      assert(typeof setImmediate === 'function');
      setImmediate(cb);
    });
  });

  describe('Process', function() {
    it('should have properties', () => {
      assert(typeof process.arch === 'string' && process.arch.length > 0);
      assert(typeof process.argv0 === 'string' && process.argv0.length > 0);
      assert(Array.isArray(process.argv) && process.argv.length > 0);
      assert(process.env && typeof process.env === 'object');
      assert(typeof process.env.PATH === 'string');
      assert(typeof process.env.HOME === 'string');
      assert(typeof process.env.NODE_TEST === 'string');
      assert(typeof process.env.BMOCHA === 'string');
      assert(typeof process.pid === 'number');
      assert(typeof process.ppid === 'number');
      assert(typeof process.version === 'string' && process.version.length > 0);
      assert(process.versions && typeof process.versions === 'object');
      assert(typeof process.versions.node === 'string');
    });

    it('should have streams', () => {
      assert(process.stdin && typeof process.stdin === 'object');
      assert(process.stdout && typeof process.stdout === 'object');
      assert(process.stderr && typeof process.stderr === 'object');
      assert(typeof process.stdin.on === 'function');
      assert(typeof process.stdout.write === 'function');
      assert(typeof process.stderr.write === 'function');
    });

    it('should do hrtime', () => {
      assert(typeof process.hrtime === 'function');

      const [sec, ns] = process.hrtime();

      assert(typeof sec === 'number');
      assert(typeof ns === 'number');

      const result = process.hrtime([sec, ns]);
      assert(Array.isArray(result));

      assert(typeof result[0] === 'number');
      assert(typeof result[1] === 'number');
    });

    if (process.browser || process.hrtime.bigint) {
      it('should do hrtime.bigint', (cb) => {
        assert(typeof process.hrtime.bigint === 'function');

        const time = process.hrtime.bigint();
        setTimeout(() => {
          assert(process.hrtime.bigint() > time);
          cb();
        }, 1);
      });
    }

    it('should get memory usage', () => {
      assert(typeof process.memoryUsage === 'function');
      const mem = process.memoryUsage();
      assert(mem && typeof mem === 'object');
      assert(typeof mem.rss === 'number');
      assert(typeof mem.heapTotal === 'number');
      assert(typeof mem.heapUsed === 'number');
      assert(typeof mem.external === 'number');
    });

    it('should get uptime', () => {
      assert(typeof process.uptime === 'function');
      assert(typeof process.uptime() === 'number');
    });
  });

  describe('Performance', function() {
    it('should have perf hooks', () => {
      assert(hooks && typeof hooks === 'object');
      assert(typeof hooks.performance === 'object');
      assert(typeof hooks.performance.now() === 'number');
    });
  });

  describe('FS', function() {
    it('should access file', () => {
      fs.accessSync(FILE, fs.constants.R_OK);

      assert.throws(() => {
        fs.accessSync(NOENT, fs.constants.R_OK);
      }, /ENOENT/);

      assert.throws(() => {
        fs.accessSync(ACCES, fs.constants.R_OK);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should check file existence', () => {
      assert(fs.existsSync(FILE));
      assert(!fs.existsSync(NOENT));
      assert(!fs.existsSync(ACCES));
    });

    it('should lstat file', () => {
      const stat = fs.lstatSync(FILE);
      assert(stat && stat.isFile());

      assert.throws(() => {
        fs.lstatSync(NOENT);
      }, /ENOENT/);

      assert.throws(() => {
        fs.lstatSync(ACCES);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should read file', () => {
      const text = fs.readFileSync(FILE, 'utf8');
      const json = JSON.parse(text);

      assert.strictEqual(json.name, 'bmocha');

      assert.throws(() => {
        fs.readFileSync(NOENT, 'utf8');
      }, /ENOENT/);

      assert.throws(() => {
        fs.readFileSync(ACCES, 'utf8');
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should read file (buffer)', () => {
      const raw = fs.readFileSync(FILE);

      assert(Buffer.isBuffer(raw));

      const text = raw.toString('utf8');
      const json = JSON.parse(text);

      assert.strictEqual(json.name, 'bmocha');
    });

    it('should stat file', () => {
      const stat = fs.statSync(FILE);
      assert(stat && stat.isFile());

      assert.throws(() => {
        fs.statSync(NOENT);
      }, /ENOENT/);

      assert.throws(() => {
        fs.statSync(ACCES);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should access file (async)', async () => {
      await fsAccess(FILE, fs.constants.R_OK);

      await assert.rejects(() => {
        return fsAccess(NOENT, fs.constants.R_OK);
      }, /ENOENT/);

      await assert.rejects(() => {
        return fsAccess(ACCES, fs.constants.R_OK);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should check file existence (async)', async () => {
      assert(await fsExists(FILE));
      assert(!await fsExists(NOENT));
      assert(!await fsExists(ACCES));
    });

    it('should lstat file (async)', async () => {
      const stat = await fsLstat(FILE);
      assert(stat && stat.isFile());

      await assert.rejects(() => {
        return fsLstat(NOENT);
      }, /ENOENT/);

      await assert.rejects(() => {
        return fsLstat(ACCES);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should read file (async)', async () => {
      const text = await fsReadFile(FILE, 'utf8');
      const json = JSON.parse(text);

      assert.strictEqual(json.name, 'bmocha');

      await assert.rejects(() => {
        return fsReadFile(NOENT, 'utf8');
      }, /ENOENT/);

      await assert.rejects(() => {
        return fsReadFile(ACCES, 'utf8');
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should read file (buffer) (async)', async () => {
      const raw = await fsReadFile(FILE);

      assert(Buffer.isBuffer(raw));

      const text = raw.toString('utf8');
      const json = JSON.parse(text);

      assert.strictEqual(json.name, 'bmocha');
    });

    it('should stat file (async)', async () => {
      const stat = await fsStat(FILE);
      assert(stat && stat.isFile());

      await assert.rejects(() => {
        return fsStat(NOENT);
      }, /ENOENT/);

      await assert.rejects(() => {
        return fsStat(ACCES);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });
  });

  describe('BFS', function() {
    let fs;

    try {
      fs = require('bfile');
    } catch (e) {
      return;
    }

    it('should access file', () => {
      fs.accessSync(FILE, fs.constants.R_OK);

      assert.throws(() => {
        fs.accessSync(NOENT, fs.constants.R_OK);
      }, /ENOENT/);

      assert.throws(() => {
        fs.accessSync(ACCES, fs.constants.R_OK);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should check file existence', () => {
      assert(fs.existsSync(FILE));
      assert(!fs.existsSync(NOENT));
      assert(!fs.existsSync(ACCES));
    });

    it('should lstat file', () => {
      const stat = fs.lstatSync(FILE);
      assert(stat && stat.isFile());

      assert.throws(() => {
        fs.lstatSync(NOENT);
      }, /ENOENT/);

      assert.throws(() => {
        fs.lstatSync(ACCES);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should read file', () => {
      const text = fs.readFileSync(FILE, 'utf8');
      const json = JSON.parse(text);

      assert.strictEqual(json.name, 'bmocha');

      assert.throws(() => {
        fs.readFileSync(NOENT, 'utf8');
      }, /ENOENT/);

      assert.throws(() => {
        fs.readFileSync(ACCES, 'utf8');
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should read file (buffer)', () => {
      const raw = fs.readFileSync(FILE);

      assert(Buffer.isBuffer(raw));

      const text = raw.toString('utf8');
      const json = JSON.parse(text);

      assert.strictEqual(json.name, 'bmocha');
    });

    it('should stat file', () => {
      const stat = fs.statSync(FILE);
      assert(stat && stat.isFile());

      assert.throws(() => {
        fs.statSync(NOENT);
      }, /ENOENT/);

      assert.throws(() => {
        fs.statSync(ACCES);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should access file (async)', async () => {
      await fs.access(FILE, fs.constants.R_OK);

      await assert.rejects(() => {
        return fs.access(NOENT, fs.constants.R_OK);
      }, /ENOENT/);

      await assert.rejects(() => {
        return fs.access(ACCES, fs.constants.R_OK);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should check file existence (async)', async () => {
      assert(await fs.exists(FILE));
      assert(!await fs.exists(NOENT));
      assert(!await fs.exists(ACCES));
    });

    it('should lstat file (async)', async () => {
      const stat = await fs.lstat(FILE);
      assert(stat && stat.isFile());

      await assert.rejects(() => {
        return fs.lstat(NOENT);
      }, /ENOENT/);

      await assert.rejects(() => {
        return fs.lstat(ACCES);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should read file (async)', async () => {
      const text = await fs.readFile(FILE, 'utf8');
      const json = JSON.parse(text);

      assert.strictEqual(json.name, 'bmocha');

      await assert.rejects(() => {
        return fs.readFile(NOENT, 'utf8');
      }, /ENOENT/);

      await assert.rejects(() => {
        return fs.readFile(ACCES, 'utf8');
      }, process.browser ? /EACCES/ : /ENOENT/);
    });

    it('should read file (buffer) (async)', async () => {
      const raw = await fs.readFile(FILE);

      assert(Buffer.isBuffer(raw));

      const text = raw.toString('utf8');
      const json = JSON.parse(text);

      assert.strictEqual(json.name, 'bmocha');
    });

    it('should stat file (async)', async () => {
      const stat = await fs.stat(FILE);
      assert(stat && stat.isFile());

      await assert.rejects(() => {
        return fs.stat(NOENT);
      }, /ENOENT/);

      await assert.rejects(() => {
        return fs.stat(ACCES);
      }, process.browser ? /EACCES/ : /ENOENT/);
    });
  });

  if (!process.browser)
    return;

  describe('Worker', function() {
    it('should register worker', () => {
      assert(typeof register === 'function');
      register('/worker.js', [__dirname, 'util', 'worker.js']);
    });

    it('should create worker', (cb) => {
      const worker = new Worker('/worker.js');

      worker.onmessage = ({data}) => {
        try {
          assert(typeof data === 'string');
          assert(data === 'hello world');
          cb();
        } catch (e) {
          cb(e);
        }
      };

      worker.postMessage('hello');
    });
  });
});
