# bmocha

Minimal implementation of mocha (requires no external dependencies).

## Docs

Because bmocha is more or less a full clone of mocha, the MochaJS docs should
be sufficient for any typical use-case: https://mochajs.org/

## Usage

### CLI

```
  Usage: bmocha [options] [files]

  Options:

    -V, --version           output the version number
    -c, --colors            force enabling of colors
    -C, --no-colors         force disabling of colors
    -O, --reporter-options  reporter-specific options
    -R, --reporter <name>   specify the reporter to use (default: spec)
    -S, --sort              sort test files
    -b, --bail              bail after first test failure
    -g, --grep <pattern>    only run tests matching <pattern>
    -f, --fgrep <string>    only run tests containing <string>
    -i, --invert            inverts --grep and --fgrep matches
    -r, --require <name>    require the given module
    -s, --slow <ms>         "slow" test threshold in milliseconds [75]
    -t, --timeout <ms>      set test-case timeout in milliseconds [2000]
    -u, --ui <name>         specify user-interface (bdd) (default: bdd)
    --interfaces            display available interfaces
    --exit                  force shutdown of the event loop after test run
    --allow-uncaught        enable uncaught errors to propagate
    --no-timeouts           disables timeouts
    --recursive             include sub directories
    --reporters             display available reporters
    --retries <times>       set numbers of time to retry a failed test case
    --file <file>           include a file to be ran during the suite
    --exclude <file>        a file to ignore
    -l, --listen            serve client-side test files (requires browserify)
    -p, --port <port>       port to listen on [8080]
    -o, --open              open browser after serving
    -H, --headless          run tests in headless chrome
    -m, --cmd <cmd>         set browser command
    -z, --console           use console in browser
    -h, --help              output usage information
```

#### Examples

``` bash
$ bmocha --reporter spec test/
$ bmocha --help
```

``` bash
# Bundle tests with browserify and
# start server on designated port.
$ bmocha --listen --port 8080
$ bmocha -l -p 8080
$ bmocha -p 8080
```

``` bash
# Bundle tests with browserify,
# start server, and open browser.
$ bmocha --open
$ bmocha -o
$ bmocha --cmd 'chromium --app=%s'
$ bmocha -m 'chromium --app=%s'
```

## API

### JS

``` js
const assert = require('assert');
const {Mocha} = require('bmocha');
const mocha = new Mocha(process.stdout);

const code = await mocha.run(() => {
  describe('Foobar', function() {
    this.timeout(5000);

    it('should check 1 == 1', function() {
      this.retries(10);
      assert.equal(1, 1);
    });
  });
});

if (code !== 0)
  process.exit(code);
```

### Browser

``` js
const {Mocha, DOMStream} = require('bmocha');
const stream = new DOMStream(document.body);
const mocha = new Mocha(stream);

await mocha.run(...);
```

## API Changes

### Arrow Functions

bmocha supports arrow functions in a backwardly compatible way:

``` js
describe('Suite', (ctx) => {
  ctx.timeout(1000);

  it('should skip test', (ctx) => {
    ctx.skip();
    assert(1 === 0);
  });
});
```

For `it` calls, the argument name _must_ end be `ctx`. Any single parameter
function with a `ctx` argument is considered a "context" variable instead of a
callback.

However, it is also possible to use callbacks _and_ contexts.

``` js
describe('Suite', (ctx) => {
  ctx.timeout(1000);

  it('should run test (async)', (done) => {
    done.slow(100);
    assert(1 === 1);
    setTimeout(done, 100);
  });
});
```

The context's properties are injected into the callback whenever a callback
function is requested.

#### Single-Letter Context Variables

Typing `ctx` repeatedly may seem unwieldly compared to writing normal arrow
functions. For this reason, there are 3 more "reserved arguments": `$`, `_`,
and `x`.

``` js
describe('Suite', () => {
  it('should skip test', $ => $.skip());
  it('should skip test', _ => _.skip());
  it('should skip test', x => x.skip());
});
```

All three will work as "context variables".

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

- Copyright (c) 2018, Christopher Jeffrey (MIT License).

See LICENSE for more info.
