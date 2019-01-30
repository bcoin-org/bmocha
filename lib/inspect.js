/*!
 * inspect.js - inspect implementation
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

/*
 * Globals
 */

const {
  Array,
  ArrayBuffer,
  Date,
  Error,
  Map,
  Object,
  RegExp,
  Set
} = global;

/*
 * Inspector
 */

class Inspector {
  constructor() {
    this.seen = new Set();
    this.maxArrayLength = 512;
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
    let total = 0;
    let count = 0;

    if (isArrayLike(obj)) {
      if (!isBuffer(obj) && !isUint8Array(obj)) {
        total += obj.length;

        for (let i = 0; i < obj.length; i++) {
          if (count >= this.maxArrayLength)
            break;

          count += 1;

          yield [null, obj[i], false];
        }
      }
    } else if (isSet(obj)) {
      total += obj.size;

      for (const key of obj) {
        if (count >= this.maxArrayLength)
          break;

        count += 1;

        yield [null, key, false];
      }
    } else if (isMap(obj)) {
      total += obj.size;

      for (const [key, value] of obj) {
        if (count >= this.maxArrayLength)
          break;

        count += 1;

        const id = typeof key === 'string'
          ? this.string(key, '')
          : this.key(key);

        yield [id, value, false];
      }
    }

    const keys = getKeys(obj, this.showHidden);

    const symbols = this.showHidden
      ? Object.getOwnPropertySymbols(obj)
      : [];

    if (isError(obj) && !isSimpleError(obj)) {
      if (!keys.includes('name'))
        keys.push('name');

      if (!keys.includes('message'))
        keys.push('message');
    }

    keys.sort();

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      if (this.showHidden && typeof obj === 'function') {
        if (key === 'prototype' || key === 'constructor')
          continue;
      }

      yield this.property(obj, key);
    }

    for (let i = 0; i < symbols.length; i++)
      yield this.property(obj, symbols[i]);

    if (count < total)
      yield [null, `... ${total - count} more items`, true];
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

    this.seen.add(obj);

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

    this.seen.delete(obj);

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
    const name = `[ArrayBuffer: ${toHex(buffer, this.maxArrayLength)}]`;

    return this.values(name, '{}', obj, prefix);
  }

  buffer(obj, prefix) {
    const name = `[Buffer: ${toHex(obj, this.maxArrayLength)}]`;
    return this.values(name, '{}', obj, prefix);
  }

  circular(obj, prefix) {
    return `${prefix}[Circular]`;
  }

  date(obj, prefix) {
    let name;

    try {
      name = `[Date: ${obj.toISOString()}]`;
    } catch (e) {
      name = `[Date: ${obj.toString()}]`;
    }

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

    const name = `[Uint8Array: ${toHex(buffer, this.maxArrayLength)}]`;

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
    if (this.seen.has(value))
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
  const inspector = new Inspector();
  try {
    return inspector.stringify(value, '');
  } catch (e) {
    return `[${objectType(value)}: invalid]`;
  }
}

function single(value) {
  const inspector = new Inspector();
  try {
    return inspector.key(value);
  } catch (e) {
    return `[${objectType(value)}: invalid]`;
  }
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
  return obj instanceof ArrayBuffer;
}

function isArrayLike(obj) {
  return isArray(obj) || isView(obj) || isArguments(obj);
}

function isBuffer(obj) {
  return Buffer.isBuffer(obj);
}

function isDate(obj) {
  return obj instanceof Date;
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
  return obj instanceof Map;
}

function isRegExp(obj) {
  return obj instanceof RegExp;
}

function isSet(obj) {
  return obj instanceof Set;
}

function isUint8Array(obj) {
  return obj instanceof Uint8Array;
}

function isView(obj) {
  return ArrayBuffer.isView(obj);
}

function isIndex(obj, key) {
  return /^\d+$/.test(key) && (key >>> 0) < obj.length;
}

function getKeys(obj, showHidden) {
  if (isView(obj))
    return [];

  const keys = showHidden
    ? Object.getOwnPropertyNames(obj)
    : Object.keys(obj);

  if (isArrayLike(obj))
    return keys.filter(key => !isIndex(obj, key));

  return keys;
}

function toHex(buf, max) {
  if (buf.length > max) {
    const hex = buf.toString('hex', 0, max);
    const left = buf.length - max;

    return  `${hex} ... ${left} more bytes`;
  }

  return buf.toString('hex');
}

/*
 * Expose
 */

inspect.single = single;
inspect.type = type;

module.exports = inspect;
