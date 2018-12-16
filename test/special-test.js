/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

describe('Special', () => {
  it('should skip test', $ => $.skip());
  it('should skip test', _ => _.skip());
  it('should skip test', x => x.skip());
  it('should not skip test', cb => cb());
});
