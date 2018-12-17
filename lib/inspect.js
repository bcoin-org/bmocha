/*!
 * inspect.js - inspect implementation
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

/*
 * Inspector
 */

class Inspector {
  constructor() {
    this.stack = new Set();
    this.showHidden = false;
  }

  /*
   * Primitives
   */

  bigint(value, prefix) {
    return `${prefix}${value.toString()}n`;
  }

  boolean(value, prefix) {
    return `${prefix}${value.toString()}`;
  }

  nil(value, prefix) {
    return `${prefix}null`;
  }

  number(value, prefix) {
    return `${prefix}${value.toString()}`;
  }

  string(value, prefix) {
    value = JSON.stringify(value).slice(1, -1);
    value = value.replace(/\\"/g, '"');
    value = value.replace(/'/g, '\\\'');
    return `${prefix}'${value}'`;
  }

  symbol(value, prefix) {
    return `${prefix}${value.toString()}`;
  }

  undef(value, prefix) {
    return `${prefix}undefined`;
  }

  unknown(value, prefix) {
    return `${prefix}[${typeof value}]`;
  }

  /*
   * Objects
   */

  *entries(obj) {
    let indexed = false;

    if (isArrayBuffer(obj))
      obj = new Uint8Array(obj);

    if (isArrayLike(obj)) {
      indexed = true;

      for (let i = 0; i < obj.length; i++)
        yield [null, obj[i], false];
    } else if (isSet(obj)) {
      for (const key of obj)
        yield [null, key, false];
    } else if (isMap(obj)) {
      for (const [key, value] of obj) {
        const id = typeof key === 'string'
          ? this.string(key, '')
          : this.key(key);

        yield [id, value, false];
      }
    }

    const keys = this.showHidden
               ? Object.getOwnPropertyNames(obj)
               : Object.keys(obj);

    if (isError(obj) && !isSimpleError(obj))
      keys.push('name', 'message');

    keys.sort();

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      if (this.showHidden && typeof obj === 'function') {
        if (key === 'prototype' || key === 'constructor')
          continue;
      }

      if (indexed && /^\d+$/.test(key)) {
        if ((key >>> 0) < obj.length)
          continue;
      }

      yield this.property(obj, key);
    }

    const symbols = this.showHidden
                  ? Object.getOwnPropertySymbols(obj)
                  : [];

    for (let i = 0; i < symbols.length; i++)
      yield this.property(obj, symbols[i]);
  }

  property(obj, key) {
    let desc = Object.getOwnPropertyDescriptor(obj, key);

    if (!desc) {
      desc = {
        value: obj[key],
        get: null,
        set: null
      };
    }

    if (typeof key === 'symbol') {
      key = `[${key.toString()}]`;
    } else {
      key = /[^\$\w]/.test(key)
        ? this.string(key, '')
        : key;
    }

    if (desc.get && desc.set)
      return [key, '[Getter/Setter]', true];

    if (desc.get)
      return [key, '[Getter]', true];

    if (desc.set)
      return [key, '[Setter]', true];

    return [key, desc.value, false];
  }

  key(key) {
    const str = this.stringify(key, '');

    if (str.indexOf('\n') !== -1) {
      if (str[0] === '[') {
        const index = str.indexOf(']');
        if (index !== -1)
          return str.substring(0, index + 1);
      }

      return `[${objectName(key)}]`;
    }

    if (str === '[Circular]')
      return `[${objectName(key)}]`;

    return str;
  }

  values(name, brackets, obj, prefix) {
    const [open, close] = brackets;

    let str = prefix;
    let has = false;

    if (name)
      str += name + ' ';

    str += open;
    str += '\n';

    this.stack.add(obj);

    for (const [key, value, raw] of this.entries(obj)) {
      let line = value;

      if (!raw) {
        line = this.stringify(value, prefix + '  ');
        line = line.substring(prefix.length + 2);
      }

      str += prefix + '  ';

      if (key != null)
        str += key + ': ';

      str += line;
      str += ',';
      str += '\n';

      has = true;
    }

    if (has) {
      str = str.slice(0, -2);
      str += '\n';
      str += prefix;
      str += close;
    } else {
      if (name) {
        str = prefix + name;
      } else {
        str = str.slice(0, -1);
        str += close;
      }
    }

    this.stack.delete(obj);

    return str;
  }

  args(obj, prefix) {
    return this.values('[Arguments]', '[]', obj, prefix);
  }

  array(obj, prefix) {
    return this.values(null, '[]', obj, prefix);
  }

  arrayBuffer(obj, prefix) {
    const buffer = Buffer.from(obj, 0, obj.byteLength);
    const name = `[ArrayBuffer: ${buffer.toString('hex')}]`;

    return this.values(name, '{}', obj, prefix);
  }

  buffer(obj, prefix) {
    const name = `[Buffer: ${obj.toString('hex')}]`;
    return this.values(name, '{}', obj, prefix);
  }

  circular(obj, prefix) {
    return `${prefix}[Circular]`;
  }

  date(obj, prefix) {
    const name = `[Date: ${obj.toISOString()}]`;
    return this.values(name, '{}', obj, prefix);
  }

  error(obj, prefix) {
    const name = isSimpleError(obj)
               ? `[${obj.name}: ${obj.message}]`
               : `[${objectName(obj)}]`;

    return this.values(name, '{}', obj, prefix);
  }

  func(obj, prefix) {
    let name = `[${objectName(obj)}`;

    if (typeof obj.name === 'string' && obj.name.length > 0)
      name += `: ${obj.name}`;

    name += ']';

    return this.values(name, '{}', obj, prefix);
  }

  map(obj, prefix) {
    return this.values('[Map]', '{}', obj, prefix);
  }

  object(obj, prefix) {
    let name = `[${objectName(obj)}]`;

    if (name === '[Object]')
      name = null;

    return this.values(name, '{}', obj, prefix);
  }

  regexp(obj, prefix) {
    return this.values(obj.toString(), '{}', obj, prefix);
  }

  set(obj, prefix) {
    return this.values('[Set]', '[]', obj, prefix);
  }

  uint8array(obj, prefix) {
    const buffer = Buffer.from(obj.buffer,
                               obj.byteOffset,
                               obj.byteLength);

    const name = `[Uint8Array: ${buffer.toString('hex')}]`;

    return this.values(name, '{}', obj, prefix);
  }

  view(obj, prefix) {
    const name = `[${objectName(obj)}]`;
    return this.values(name, '[]', obj, prefix);
  }

  /*
   * Stringification
   */

  stringify(value, prefix = '') {
    if (this.stack.has(value))
      return this.circular(value, prefix);

    switch (typeof value) {
      case 'undefined':
        return this.undef(value, prefix);
      case 'object':
        if (value === null)
          return this.nil(value, prefix);

        if (isArguments(value))
          return this.args(value, prefix);

        if (isArray(value))
          return this.array(value, prefix);

        if (isMap(value))
          return this.map(value, prefix);

        if (isSet(value))
          return this.set(value, prefix);

        if (isBuffer(value))
          return this.buffer(value, prefix);

        if (isDate(value))
          return this.date(value, prefix);

        if (isRegExp(value))
          return this.regexp(value, prefix);

        if (isError(value))
          return this.error(value, prefix);

        if (isArrayBuffer(value))
          return this.arrayBuffer(value, prefix);

        if (isUint8Array(value))
          return this.uint8array(value, prefix);

        if (isView(value))
          return this.view(value, prefix);

        return this.object(value, prefix);
      case 'boolean':
        return this.boolean(value, prefix);
      case 'number':
        return this.number(value, prefix);
      case 'string':
        return this.string(value, prefix);
      case 'symbol':
        return this.symbol(value, prefix);
      case 'function':
        return this.func(value, prefix);
      case 'bigint':
        return this.bigint(value, prefix);
      default:
        return this.unknown(value, prefix);
    }
  }
}

/*
 * API
 */

function inspect(value) {
  const ins = new Inspector();
  return ins.stringify(value, '');
}

function single(value) {
  const ins = new Inspector();
  return ins.key(value);
}

function type(value) {
  const type = typeof value;

  if (type === 'object')
    return objectType(value).toLowerCase();

  return type;
}

/*
 * Helpers
 */

function objectString(obj) {
  if (obj === undefined)
    return '[object Undefined]';

  if (obj === null)
    return '[object Null]';

  return Object.prototype.toString.call(obj);
}

function objectType(obj) {
  return objectString(obj).slice(8, -1);
}

function objectName(value) {
  if (value === undefined)
    return 'undefined';

  if (value === null)
    return 'null';

  const name = objectType(value);

  if (name !== 'Object' && name !== 'Error')
    return name;

  if (!value.constructor
      || typeof value.constructor.name !== 'string'
      || value.constructor.name.length === 0) {
    return name;
  }

  return value.constructor.name;
}

function isArguments(obj) {
  return objectString(obj) === '[object Arguments]';
}

function isArray(obj) {
  return Array.isArray(obj);
}

function isArrayBuffer(obj) {
  return objectString(obj) === '[object ArrayBuffer]';
}

function isArrayLike(obj) {
  return isArray(obj) || isView(obj) || isArguments(obj);
}

function isBuffer(obj) {
  return Buffer.isBuffer(obj);
}

function isDate(obj) {
  return objectString(obj) === '[object Date]';
}

function isError(obj) {
  return obj instanceof Error;
}

function isSimpleError(obj) {
  return isError(obj)
      && typeof obj.name === 'string'
      && obj.name.length > 0
      && typeof obj.message === 'string'
      && obj.message.length > 0
      && obj.message.indexOf('\n') === -1;
}

function isMap(obj) {
  return objectString(obj) === '[object Map]';
}

function isRegExp(obj) {
  return objectString(obj) === '[object RegExp]';
}

function isSet(obj) {
  return objectString(obj) === '[object Set]';
}

function isUint8Array(obj) {
  return objectString(obj) === '[object Uint8Array]';
}

function isView(view) {
  return ArrayBuffer.isView(view);
}

/*
 * Expose
 */

inspect.single = single;
inspect.type = type;

module.exports = inspect;
