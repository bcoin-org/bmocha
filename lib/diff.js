/*!
 * diff.js - diff implementation
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 *
 * Parts of this software are based on nodejs/node:
 *   Copyright Node.js contributors. All rights reserved.
 *   https://github.com/nodejs/node
 */

'use strict';

const inspect = require('./inspect');

/*
 * Constants
 */

const MAX_SHORT_LENGTH = 10;

const errorStrings = {
  __proto__: null,
  bufferEqual: 'Expected buffers to be strictly equal:',
  deepStrictEqual: 'Expected values to be strictly deep-equal:',
  strictEqual: 'Expected values to be strictly equal:',
  strictEqualObject: 'Expected "actual" to be reference-equal to "expected":',
  deepEqual: 'Expected values to be loosely deep-equal:',
  equal: 'Expected values to be loosely equal:',
  notBufferEqual: 'Expected "actual" to be strictly unequal to:',
  notDeepStrictEqual: 'Expected "actual" not to be strictly deep-equal to:',
  notStrictEqual: 'Expected "actual" to be strictly unequal to:',
  notStrictEqualObject:
    'Expected "actual" not to be reference-equal to "expected":',
  notDeepEqual: 'Expected "actual" not to be loosely deep-equal to:',
  notEqual: 'Expected "actual" to be loosely unequal to:',
  notIdentical: 'Values identical but not reference-equal:'
};

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const WHITE = '\x1b[39m';

/*
 * Diff
 */

function diff(actual, expected, operator, colors) {
  const actualInspected = inspect(actual);
  const actualLines = actualInspected.split('\n');
  const expectedLines = inspect(expected).split('\n');

  let red = '';
  let green = '';
  let blue = '';
  let white = '';

  if (colors) {
    red = RED;
    green = GREEN;
    blue = BLUE;
    white = WHITE;
  }

  let other = '';
  let res = '';
  let lastPos = 0;
  let end = '';
  let skipped = false;
  let i = 0;
  let indicator = '';

  // In case both values are objects explicitly
  // mark them as not reference equal for the
  // `strictEqual` operator.
  if (operator === 'strictEqual'
      && typeof actual === 'object'
      && typeof expected === 'object'
      && actual !== null
      && expected !== null) {
    operator = 'strictEqualObject';
  }

  // If "actual" and "expected" fit on a single
  // line and they are not strictly equal, check
  // further special handling.
  if (actualLines.length === 1
      && expectedLines.length === 1
      && actualLines[0] !== expectedLines[0]) {
    const inputLength = actualLines[0].length + expectedLines[0].length;

    // If the character length of "actual" and
    // "expected" together is less than
    // MAX_SHORT_LENGTH and if neither is an
    // object and at least one of them is not
    // `zero`, use the strict equal comparison
    // to visualize the output.
    if (inputLength <= MAX_SHORT_LENGTH) {
      if ((typeof actual !== 'object' || actual === null)
          && (typeof expected !== 'object' || expected === null)
          && (actual !== 0 || expected !== 0)) {
        return `${errorStrings[operator]}\n\n`
             + `${actualLines[0]} !== ${expectedLines[0]}\n`;
      }
    } else if (operator !== 'strictEqualObject') {
      // If the stderr is a tty and the input
      // length is lower than the current
      // columns per line, add a mismatch
      // indicator below the output. If it is
      // not a tty, use a default value of 80
      // characters.
      if (inputLength < 80) {
        while (actualLines[0][i] === expectedLines[0][i])
          i += 1;

        // Ignore the first characters.
        if (i > 2) {
          // Add position indicator for the
          // first mismatch in case it is a
          // single line and the input length
          // is less than the column length.
          indicator = `\n  ${' '.repeat(i)}^`;
          i = 0;
        }
      }
    }
  }

  // Remove all ending lines that match (this
  // optimizes the output for readability by
  // reducing the number of total changed
  // lines).
  let a = actualLines[actualLines.length - 1];
  let b = expectedLines[expectedLines.length - 1];

  while (a === b) {
    if (i < 2)
      end = `\n  ${a}${end}`;
    else
      other = a;

    i += 1;

    actualLines.pop();
    expectedLines.pop();

    if (actualLines.length === 0
        || expectedLines.length === 0) {
      break;
    }

    a = actualLines[actualLines.length - 1];
    b = expectedLines[expectedLines.length - 1];
  }

  const maxLines = Math.max(actualLines.length,
                            expectedLines.length);

  // Strict equal with identical objects that
  // are not identical by reference. e.g.
  //   assert.deepStrictEqual({ a: Symbol() },
  //                          { a: Symbol() })
  if (maxLines === 0) {
    // We have to get the result again.
    // The lines were all removed before.
    const actualLines = actualInspected.split('\n');

    // Only remove lines in case it makes sense
    // to collapse those.
    if (actualLines.length > 30) {
      actualLines[26] = `${blue}...${white}`;

      while (actualLines.length > 27)
        actualLines.pop();
    }

    return `${errorStrings.notIdentical}\n\n`
         + `${actualLines.join('\n')}\n`;
  }

  if (i > 3) {
    end = `\n${blue}...${white}${end}`;
    skipped = true;
  }

  if (other !== '') {
    end = `\n  ${other}${end}`;
    other = '';
  }

  const msg = `${errorStrings[operator]}\n\n`
            + `${green}+ actual${white} `
            + `${red}- expected${white}`;

  const skippedMsg = ` ${blue}...${white} Lines skipped`;

  let printedLines = 0;

  for (i = 0; i < maxLines; i++) {
    // Only extra expected lines exist.
    const cur = i - lastPos;

    if (actualLines.length < i + 1) {
      // If the last diverging line is more
      // than one line above and the current
      // line is at least line three, add some
      // of the former lines and also add dots
      // to indicate skipped entries.
      if (cur > 1 && i > 2) {
        if (cur > 4) {
          res += `\n${blue}...${white}`;
          skipped = true;
        } else if (cur > 3) {
          res += `\n  ${expectedLines[i - 2]}`;
          printedLines += 1;
        }

        res += `\n  ${expectedLines[i - 1]}`;
        printedLines += 1;
      }

      // Mark the current line as the last diverging one.
      lastPos = i;

      // Add the expected line to the cache.
      other += `\n${red}- ${expectedLines[i]}${white}`;
      printedLines += 1;
    } else if (expectedLines.length < i + 1) {
      // Only extra actual lines exist.
      // If the last diverging line is more
      // than one line above and the current
      // line is at least line three, add
      // some of the former lines and also
      // add dots to indicate skipped entries.
      if (cur > 1 && i > 2) {
        if (cur > 4) {
          res += `\n${blue}...${white}`;
          skipped = true;
        } else if (cur > 3) {
          res += `\n  ${actualLines[i - 2]}`;
          printedLines += 1;
        }
        res += `\n  ${actualLines[i - 1]}`;
        printedLines += 1;
      }

      // Mark the current line as the last
      // diverging one.
      lastPos = i;

      // Add the actual line to the result.
      res += `\n${green}+ ${actualLines[i]}${white}`;
      printedLines += 1;
    } else {
      // Lines diverge.
      const expectedLine = expectedLines[i];

      let actualLine = actualLines[i];

      // If the lines diverge, specifically
      // check for lines that only diverge by
      // a trailing comma. In that case it
      // is actually identical and we should
      // mark it as such.
      let divergingLines = false;

      if (actualLine !== expectedLine) {
        divergingLines = !actualLine.endsWith(',')
                      || actualLine.slice(0, -1) !== expectedLine;
      }

      // If the expected line has a trailing
      // comma but is otherwise identical,
      // add a comma at the end of the actual
      // line. Otherwise the output could
      // look weird as in:
      //
      //   [
      //     1       // No comma at the end!
      // +   2
      //   ]
      //
      if (divergingLines
          && expectedLine.endsWith(',')
          && expectedLine.slice(0, -1) === actualLine) {
        divergingLines = false;
        actualLine += ',';
      }

      if (divergingLines) {
        // If the last diverging line is more
        // than one line above and the current
        // line is at least line three, add
        // some of the former lines and also
        // add dots to indicate skipped entries.
        if (cur > 1 && i > 2) {
          if (cur > 4) {
            res += `\n${blue}...${white}`;
            skipped = true;
          } else if (cur > 3) {
            res += `\n  ${actualLines[i - 2]}`;
            printedLines += 1;
          }
          res += `\n  ${actualLines[i - 1]}`;
          printedLines += 1;
        }

        // Mark the current line as the last
        // diverging one.
        lastPos = i;

        // Add the actual line to the result
        // and cache the expected diverging
        // line so consecutive diverging lines
        // show up as +++--- and not +-+-+-.
        res += `\n${green}+ ${actualLine}${white}`;
        other += `\n${red}- ${expectedLine}${white}`;
        printedLines += 2;
      } else {
        // Lines are identical.
        // Add all cached information to the
        // result before adding other things
        // and reset the cache.
        res += other;
        other = '';

        // If the last diverging line is
        // exactly one line above or if it
        // is the very first line, add the
        // line to the result.
        if (cur === 1 || i === 0) {
          res += `\n  ${actualLine}`;
          printedLines++;
        }
      }
    }

    // Inspected object to big.
    // Show ~20 rows max.
    if (printedLines > 20 && i < maxLines - 2) {
      return `${msg}${skippedMsg}\n`
           + `${res}\n`
           + `${blue}...${white}${other}\n`
           + `${blue}...${white}`;
    }
  }

  return `${msg}${skipped ? skippedMsg : ''}\n`
       + `${res}${other}${end}${indicator}`;
}

/*
 * Helpers
 */

function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/*
 * API
 */

function isDiffable(error) {
  if (error == null)
    return false;

  if (error.showDiff === false)
    return false;

  if (!hasOwnProperty(error, 'actual')
      && !hasOwnProperty(error, 'expected')) {
    return false;
  }

  let {operator} = error;

  if (operator == null)
    operator = 'strictEqual';

  if (typeof operator !== 'string')
    return false;

  if (operator === '==')
    operator = 'equal';
  else if (operator === '!=')
    operator = 'notEqual';

  if (errorStrings[operator] == null)
    return false;

  return true;
}

function createDiff(error, options = {}) {
  if (error == null)
    error = {};

  let {actual, expected, operator} = error;

  if (typeof operator !== 'string')
    operator = 'strictEqual';
  else if (operator === '==')
    operator = 'equal';
  else if (operator === '!=')
    operator = 'notEqual';

  if (errorStrings[operator] == null)
    operator = 'strictEqual';

  return diff(actual, expected, operator, options.colors);
}

/*
 * Expose
 */

exports.isDiffable = isDiffable;
exports.createDiff = createDiff;
