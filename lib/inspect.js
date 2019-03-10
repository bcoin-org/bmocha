/*!
 * inspect.js - inspect implementation
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

/*
 * Globals
 */

const {
  Array,
  ArrayBuffer,
  Buffer,
  Date,
  Error,
  Map,
  Object,
  RegExp,
  Set,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  DataView
} = global;

const BigInt64Array = global.BigInt64Array || Int8Array;
const BigUint64Array = global.BigUint64Array || Uint8Array;

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
    return `${prefix}${value}n`;
  }

  boolean(value, prefix) {
    return `${prefix}${value}`;
  }

  nil(value, prefix) {
    return `${prefix}null`;
  }

  number(value, prefix) {
    return `${prefix}${value}`;
  }

  string(value, prefix) {
    value = JSON.stringify(value).slice(1, -1);
    value = value.replace(/\\"/g, '"');
    value = value.replace(/'/g, '\\\'');
    return `${prefix}'${value}'`;
  }

  symbol(value, prefix) {
    return `${prefix}${toString(value)}`;
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
        const length = get(obj, 'length') >>> 0;

        total += length;

        for (let i = 0; i < length; i++) {
          if (count >= this.maxArrayLength)
            break;

          count += 1;

          yield [null, obj[i], false];
        }
      }
    } else if (isSet(obj)) {
      total += get(obj, 'size') >>> 0;

      for (const key of iterate(obj)) {
        if (count >= this.maxArrayLength)
          break;

        count += 1;

        yield [null, key, false];
      }
    } else if (isMap(obj)) {
      total += get(obj, 'size') >>> 0;

      for (const pair of iterate(obj)) {
        let key, value;

        try {
          [key, value] = pair;
        } catch (e) {
          continue;
        }

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
    const symbols = getOwnPropertySymbols(obj);

    if (isError(obj) && !isSimpleError(obj)) {
      if (!keys.includes('name'))
        keys.push('name');

      if (!keys.includes('message'))
        keys.push('message');
    }

    keys.sort();

    for (let i = 0; i < keys.length; i++)
      yield this.property(obj, keys[i]);

    for (let i = 0; i < symbols.length; i++)
      yield this.property(obj, symbols[i]);

    if (count < total)
      yield [null, `... ${total - count} more items`, true];
  }

  property(obj, key) {
    let desc = getOwnPropertyDescriptor(obj, key);

    if (!desc) {
      desc = {
        value: get(obj, key),
        get: null,
        set: null
      };
    }

    if (typeof key === 'symbol') {
      key = `[${toString(key)}]`;
    } else {
      key = /[^\$\w]/.test(key)
        ? this.string(key, '')
        : key;
    }

    const get_ = get(desc, 'get');
    const set_ = get(desc, 'set');

    if (get_ && set_)
      return [key, '[Getter/Setter]', true];

    if (get_)
      return [key, '[Getter]', true];

    if (set_)
      return [key, '[Setter]', true];

    return [key, get(desc, 'value'), false];
  }

  key(key) {
    const str = this.stringify(key, '');

    if (str.includes('\n')) {
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
    let buffer;

    try {
      buffer = Buffer.from(obj, 0, obj.byteLength);
    } catch (e) {
      return this.object(obj, prefix);
    }

    const name = `[ArrayBuffer: ${toHex(buffer, this.maxArrayLength)}]`;

    return this.values(name, '{}', obj, prefix);
  }

  buffer(obj, prefix) {
    let name;

    try {
      name = `[Buffer: ${toHex(obj, this.maxArrayLength)}]`;
    } catch (e) {
      return this.object(obj, prefix);
    }

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
      name = `[Date: ${toString(obj)}]`;
    }

    return this.values(name, '{}', obj, prefix);
  }

  error(obj, prefix) {
    let name;

    if (isSimpleError(obj)) {
      try {
        name = `[${obj.name}: ${obj.message}]`;
      } catch (e) {
        ;
      }
    }

    if (name == null)
      name = `[${objectName(obj)}]`;

    return this.values(name, '{}', obj, prefix);
  }

  func(obj, prefix) {
    let name = `[${objectName(obj)}`;

    const fname = get(obj, 'name');

    if (typeof fname === 'string' && fname.length > 0)
      name += `: ${fname}`;

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
    return this.values(toString(obj), '{}', obj, prefix);
  }

  set(obj, prefix) {
    return this.values('[Set]', '[]', obj, prefix);
  }

  uint8array(obj, prefix) {
    let buffer;

    try {
      buffer = Buffer.from(obj.buffer,
                           obj.byteOffset,
                           obj.byteLength);
    } catch (e) {
      return this.object(obj, prefix);
    }

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

  try {
    return Object.prototype.toString.call(obj);
  } catch (e) {
    return '[object Object]';
  }
}

function objectType(obj) {
  return objectString(obj).slice(8, -1);
}

function objectName(value) {
  const type = objectType(value);

  if (type !== 'Object' && type !== 'Error')
    return type;

  const ctor = get(value, 'constructor');

  if (ctor == null)
    return type;

  const name = get(ctor, 'name');

  if (typeof name !== 'string' || name.length === 0)
    return type;

  return name;
}

function isArguments(obj) {
  return objectString(obj) === '[object Arguments]';
}

function isArray(obj) {
  try {
    return Array.isArray(obj)
        && obj !== Array.prototype;
  } catch (e) {
    return false;
  }
}

function isArrayBuffer(obj) {
  return instanceOf(obj, ArrayBuffer);
}

function isArrayLike(obj) {
  return isArray(obj) || isView(obj) || isArguments(obj);
}

function isBuffer(obj) {
  try {
    return Buffer.isBuffer(obj)
        && obj !== Buffer.prototype;
  } catch (e) {
    return false;
  }
}

function isDate(obj) {
  return instanceOf(obj, Date);
}

function isError(obj) {
  return instanceOf(obj, Error);
}

function isSimpleError(obj) {
  if (!isError(obj))
    return false;

  const name = get(obj, 'name');
  const message = get(obj, 'message');

  return typeof name === 'string'
      && name.length > 0
      && typeof message === 'string'
      && message.length > 0
      && !message.includes('\n');
}

function isMap(obj) {
  return instanceOf(obj, Map);
}

function isRegExp(obj) {
  return instanceOf(obj, RegExp);
}

function isSet(obj) {
  return instanceOf(obj, Set);
}

function isUint8Array(obj) {
  return instanceOf(obj, Uint8Array);
}

function isView(obj) {
  try {
    return ArrayBuffer.isView(obj)
        && obj !== Int8Array.prototype
        && obj !== Uint8Array.prototype
        && obj !== Uint8ClampedArray.prototype
        && obj !== Int16Array.prototype
        && obj !== Uint16Array.prototype
        && obj !== Int32Array.prototype
        && obj !== Uint32Array.prototype
        && obj !== Float32Array.prototype
        && obj !== Float64Array.prototype
        && obj !== DataView.prototype
        && obj !== BigInt64Array.prototype
        && obj !== BigUint64Array.prototype;
  } catch (e) {
    return false;
  }
}

function isIndex(obj, key) {
  return /^\d+$/.test(key) && (key >>> 0) < obj.length;
}

function getKeys(obj, showHidden) {
  if (isView(obj))
    return [];

  const keys = showHidden
    ? getOwnPropertyNames(obj)
    : getOwnKeys(obj);

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
 * Safety
 */

function instanceOf(obj, ctor) {
  try {
    return (obj instanceof ctor) && ctor !== obj.prototype;
  } catch (e) {
    return false;
  }
}

function get(obj, prop) {
  try {
    return obj[prop];
  } catch (e) {
    return undefined;
  }
}

function getOwnKeys(obj) {
  try {
    return Object.keys(obj);
  } catch (e) {
    return [];
  }
}

function getOwnPropertyDescriptor(obj, prop) {
  try {
    return Object.getOwnPropertyDescriptor(obj, prop);
  } catch (e) {
    return undefined;
  }
}

function getOwnPropertyNames(obj) {
  try {
    return Object.getOwnPropertyNames(obj);
  } catch (e) {
    return [];
  }
}

function getOwnPropertySymbols(obj) {
  try {
    return Object.getOwnPropertySymbols(obj);
  } catch (e) {
    return [];
  }
}

function* iterate(obj) {
  try {
    for (const item of obj)
      yield item;
  } catch (e) {
    ;
  }
}

function toString(obj) {
  try {
    return String(obj);
  } catch (e) {
    return 'Object';
  }
}

/*
 * Expose
 */

inspect.single = single;
inspect.type = type;

module.exports = inspect;
