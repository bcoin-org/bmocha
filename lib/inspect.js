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
      || typeof value.constructor.name !== 'string'
      || value.constructor.name === 'Object') {
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

  if (obj instanceof Error)
    keys.push('name', 'message');

  keys.push(...symbols);

  let str = prefix;

  if (name !== 'Object') {
    if (typeof obj === 'function' && obj.name)
      str += `[${name}: ${obj.name}] `;
    else
      str += `[${name}] `;
  }

  if (keys.length === 0) {
    if (name !== 'Object')
      return str;
    str += '{}';
    return str;
  }

  str += '{\n';

  stack.add(obj);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = obj[key];

    let slug = '';
    let line = '';

    if (typeof key === 'symbol')
      slug = `[${key.toString()}]`;
    else if (!/^[$\w]+$/.test(key))
      slug = stringifyString(key);
    else
      slug = key;

    line = stringify(val, stack, prefix + '  ');
    line = line.substring(prefix.length + 2);

    str += prefix + '  ';
    str += slug + ': ';
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

    let slug = '';
    let line = '';

    if (typeof key === 'string') {
      slug = stringifyString(key);
    } else {
      slug = inspect(key);
      if (slug.indexOf('\n') !== -1
          || slug === '[Circular]') {
        slug = objectName(key);
        slug = `[${slug}]`;
      }
    }

    line = stringify(val, stack, prefix + '  ');
    line = line.substring(prefix.length + 2);

    str += prefix + '  ';
    str += slug + ': ';
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

      if (Array.isArray(value))
        return stringifyArray(value, stack, prefix);

      if (value instanceof Map)
        return stringifyMap(value, stack, prefix);

      if (value instanceof Set)
        return stringifySet(value, stack, prefix);

      if (Buffer.isBuffer(value))
        return prefix + `[Buffer: ${value.toString('hex')}]`;

      if (value instanceof Date)
        return prefix + `[Date: ${value.toISOString()}]`;

      if (value instanceof RegExp)
        return prefix + value;

      if (value instanceof Error) {
        if (Object.keys(value).length > 0)
          return stringifyObject(value, stack, prefix);

        const name = objectName(value);

        if (typeof value.message === 'string'
            && value.message.indexOf('\n') === -1) {
          return prefix + `[${name}: ${value.message}]`;
        }

        return prefix + `[${name}]`;
      }

      if (value instanceof ArrayBuffer)
        value = new Uint8Array(value);

      if (ArrayBuffer.isView(value)) {
        if (value instanceof Uint8Array) {
          const buffer = Buffer.from(value.buffer,
                                     value.byteOffset,
                                     value.byteLength);
          return prefix + `[Uint8Array: ${buffer.toString('hex')}]`;
        }
        return stringifyArray(value, stack, prefix);
      }

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
      if (Object.keys(value).length > 0)
        return stringifyObject(value, stack, prefix);

      if (value.name)
        return prefix + `[${objectName(value)}: ${value.name}]`;

      return prefix + `[${objectName(value)}]`;
    case 'bigint':
      return prefix + `${value.toString()}n`;
    default:
      return prefix + `[${typeof value}]`;
  }
}

function inspect(value) {
  return stringify(value, new Set(), '');
}

/*
 * Expose
 */

module.exports = inspect;
