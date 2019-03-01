/*!
 * transform.js - browserify transform for bmocha
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

const assert = require('assert');
const {extname} = require('path');
const Stream = require('stream');
const {StringDecoder} = require('string_decoder');

/*
 * Constants
 */

const EMPTY = Buffer.alloc(0);

/**
 * Base
 */

class Base extends Stream.Transform {
  constructor(file) {
    assert(typeof file === 'string');
    super(file);
    this.file = file;
    this.isJS = extname(file) === '.js';
    this.decoder = new StringDecoder('utf8');
    this.code = '';
  }

  _preprocess(code) {
    return code;
  }

  _transform(chunk, encoding, cb) {
    assert(Buffer.isBuffer(chunk));

    this.code += this.decoder.write(chunk);

    cb(null, EMPTY);
  }

  _flush(cb) {
    const code = this._preprocess(this.code);
    const raw = Buffer.from(code, 'utf8');

    this.push(raw);

    cb();
  }
}

/**
 * Transform
 */

class Transform extends Base {
  constructor(file) {
    super(file);
  }

  _preprocess(code) {
    const x = '$1BigInt($2)$3';
    const y = '$1BigInt(\'$2\')$3';

    if (!this.isJS)
      return code;

    code = code.replace(/(^|[^\w])(0[Bb][0-1]{1,53})n([^\w]|$)/g, x);
    code = code.replace(/(^|[^\w])(0[Oo][0-7]{1,17})n([^\w]|$)/g, x);
    code = code.replace(/(^|[^\w])(0[Xx][0-9a-fA-F]{1,13})n([^\w]|$)/g, x);
    code = code.replace(/(^|[^\w])([0-9]{1,15})n([^\w]|$)/g, x);

    code = code.replace(/(^|[^\w])(0[Bb][0-1]+)n([^\w]|$)/g, y);
    code = code.replace(/(^|[^\w])(0[Oo][0-7]+)n([^\w]|$)/g, y);
    code = code.replace(/(^|[^\w])(0[Xx][0-9a-fA-F]+)n([^\w]|$)/g, y);
    code = code.replace(/(^|[^\w])([0-9]+)n([^\w]|$)/g, y);

    return code;
  }
}

/*
 * Expose
 */

module.exports = file => new Transform(file);
