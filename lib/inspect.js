/*!
 * inspect.js - inspect implementation
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bmocha
 */

'use strict';

function objectName(value) {
  if (value === undefined)
    return 'undefined';

  if (value === null)
    return 'null';

  if (!value.constructor
      || typeof value.constructor.name !== 'string') {
    return 'Object';
  }

  return value.constructor.name;
}

function stringifyString(key) {
  key = JSON.stringify(key).slice(1, -1);
  key = key.replace(/\\"/g, '"');
  key = key.replace(/'/g, '\\\'');
  return `'${key}'`;
}

function stringifyObject(obj, stack, prefix) {
  const name = objectName(obj);
  const keys = Object.keys(obj).sort();
  const symbols = Object.getOwnPropertySymbols(obj);

  if (isError(obj))
    keys.push('name', 'message');

  keys.push(...symbols);

  let str = prefix;

  if (name !== 'Object') {
    if (typeof obj === 'function' && obj.name)
      str += `[${name}: ${obj.name}]`;
    else
      str += `[${name}]`;

    if (keys.length === 0)
      return str;

    str += ' ';
  } else {
    if (keys.length === 0) {
      str += '{}';
      return str;
    }
  }

  str += '{\n';

  stack.add(obj);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = obj[key];

    let id = '';
    let line = '';

    if (typeof key === 'symbol')
      id = `[${key.toString()}]`;
    else if (!/^[$\w]+$/.test(key))
      id = stringifyString(key);
    else
      id = key;

    line = stringify(val, stack, prefix + '  ');
    line = line.substring(prefix.length + 2);

    str += prefix + '  ';
    str += id + ': ';
    str += line;

    if (i !== keys.length - 1)
      str += ',';

    str += '\n';
  }

  stack.delete(obj);

  str += prefix + '}';

  return str;
}

function stringifyArray(arr, stack, prefix) {
  const name = objectName(arr);

  let str = prefix;

  if (name !== 'Array')
    str += `[${name}] `;

  if (arr.length === 0) {
    str += '[]';
    return str;
  }

  str += '[\n';

  stack.add(arr);

  for (let i = 0; i < arr.length; i++) {
    const val = arr[i];

    str += stringify(val, stack, prefix + '  ');

    if (i !== arr.length - 1)
      str += ',';

    str += '\n';
  }

  stack.delete(arr);

  str += prefix + ']';

  return str;
}

function stringifyMap(map, stack, prefix) {
  const name = objectName(map);
  const keys = [...map.keys()].sort();

  let str = prefix + `[${name}] `;

  if (keys.length === 0) {
    str += '{}';
    return str;
  }

  str += '{\n';

  stack.add(map);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = map.get(key);

    let id = '';
    let line = '';

    if (typeof key === 'string')
      id = stringifyString(key);
    else
      id = inspect.single(key);

    line = stringify(val, stack, prefix + '  ');
    line = line.substring(prefix.length + 2);

    str += prefix + '  ';
    str += id + ': ';
    str += line;

    if (i !== keys.length - 1)
      str += ',';

    str += '\n';
  }

  stack.delete(map);

  str += prefix + '}';

  return str;
}

function stringifySet(set, stack, prefix) {
  const name = objectName(set);

  let str = prefix + `[${name}] `;
  let i = 0;

  if (set.size === 0) {
    str += '[]';
    return str;
  }

  str += '[\n';

  stack.add(set);

  for (const key of set) {
    str += stringify(key, stack, prefix + '  ');

    if (i !== set.size - 1)
      str += ',';

    str += '\n';
    i += 1;
  }

  stack.delete(set);

  str += prefix + ']';

  return str;
}

function stringify(value, stack, prefix) {
  if (stack.has(value))
    return prefix + '[Circular]';

  switch (typeof value) {
    case 'undefined':
      return prefix + 'undefined';
    case 'object':
      if (value === null)
        return prefix + 'null';

      if (isArray(value))
        return stringifyArray(value, stack, prefix);

      if (isMap(value))
        return stringifyMap(value, stack, prefix);

      if (isSet(value))
        return stringifySet(value, stack, prefix);

      if (isBuffer(value))
        return prefix + `[Buffer: ${value.toString('hex')}]`;

      if (isDate(value))
        return prefix + `[Date: ${value.toISOString()}]`;

      if (isRegExp(value))
        return prefix + value;

      if (isError(value)) {
        if (Object.keys(value).length > 0)
          return stringifyObject(value, stack, prefix);

        const name = objectName(value);

        if (typeof value.message === 'string'
            && value.message.indexOf('\n') === -1) {
          return prefix + `[${name}: ${value.message}]`;
        }

        return prefix + `[${name}]`;
      }

      if (isArrayBuffer(value))
        value = new Uint8Array(value);

      if (isUint8Array(value)) {
        const buffer = Buffer.from(value.buffer,
                                   value.byteOffset,
                                   value.byteLength);
        return prefix + `[Uint8Array: ${buffer.toString('hex')}]`;
      }

      if (isView(value))
        return stringifyArray(value, stack, prefix);

      return stringifyObject(value, stack, prefix);
    case 'boolean':
      return prefix + value.toString();
    case 'number':
      return prefix + value.toString();
    case 'string':
      return prefix + stringifyString(value);
    case 'symbol':
      return prefix + value.toString();
    case 'function':
      return stringifyObject(value, stack, prefix);
    case 'bigint':
      return prefix + `${value.toString()}n`;
    default:
      return prefix + `[${typeof value}]`;
  }
}

function inspect(value) {
  return stringify(value, new Set(), '');
}

function single(value) {
  const str = inspect(value);

  if (str.indexOf('\n') !== -1
      || str === '[Circular]') {
    return `[${objectName(value)}]`;
  }

  return str;
}

function type(value) {
  const type = typeof value;

  if (type === 'object')
    return objectName(value).toLowerCase();

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

function isArray(obj) {
  return Array.isArray(obj);
}

function isArrayBuffer(obj) {
  return objectString(obj) === '[object ArrayBuffer]';
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
  return !isBuffer(view) && ArrayBuffer.isView(view);
}

/*
 * Expose
 */

inspect.single = single;
inspect.type = type;

module.exports = inspect;
