# bmocha

Minimal implementation of mocha.

## Usage

### CLI

``` bash
$ bmocha --reporter spec test/
$ bmocha --help
```

### JS

``` js
const assert = require('assert');
const {Mocha} = require('bmocha');
const mocha = new Mocha(process.stdout);

const code = await mocha.run([() => {
  describe('Foobar', function() {
    this.timeout(5000);

    it('should check 1 == 1', function() {
      this.retries(10);
      assert.equal(1, 1);
    });
  });
}]);

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
