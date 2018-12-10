# bmocha

Minimal implementation of mocha.

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
    --exit                  force shutdown of the event loop after test run
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

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

- Copyright (c) 2018, Christopher Jeffrey (MIT License).

See LICENSE for more info.
