const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const reserved = new Set([
  'globalThis',
  'global',
  'window',
  'document',
  'process',
  'require',
  'module',
  'eval',
  'Function',
]);
const precedence = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '===': 6,
  '!==': 6,
  '<': 7,
  '>': 7,
  '<=': 7,
  '>=': 7,
  '<<': 8,
  '>>': 8,
  '>>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
};
const expressions = new Map();

function entityValue(code) {
  const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  if (Object.hasOwn(names, code)) return names[code];
  const number = code.startsWith('#x') ? parseInt(code.slice(2), 16) : Number(code.slice(1));
  return number > 0 && number <= 0x10ffff && (number < 0xd800 || number > 0xdfff)
    ? String.fromCodePoint(number)
    : '�';
}

function decodedUnit(value, position) {
  const match =
    value[position] === '&'
      ? /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/.exec(value.slice(position))
      : null;
  return match
    ? { value: entityValue(match[1]), end: position + match[0].length }
    : { value: value[position], end: position + 1 };
}

function decodeEntities(value) {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, code) =>
    entityValue(code),
  );
}

/** Parser for the supported template subset; no eval, calls, assignments or globals. */
function compileExpression(expression) {
  if (expressions.has(expression)) return expressions.get(expression);
  const tokens = [];
  let cursor = 0;
  while (cursor < expression.length) {
    if (/\s/.test(expression[cursor])) {
      cursor++;
      continue;
    }
    const rest = expression.slice(cursor);
    let match;
    if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0];
      let text = '',
        index = 1;
      for (; index < rest.length && rest[index] !== quote; index++) {
        if (rest[index] === '\\') {
          const escaped = rest[++index];
          const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' };
          if (escaped === 'u' || escaped === 'x') {
            const length = escaped === 'u' ? 4 : 2;
            const digits = rest.slice(index + 1, index + 1 + length);
            if (!new RegExp('^[0-9a-fA-F]{' + length + '}$').test(digits))
              throw new Error('Invalid binding escape');
            text += String.fromCharCode(parseInt(digits, 16));
            index += length;
          } else if (escaped === undefined) throw new Error('Invalid binding escape');
          else text += escapes[escaped] ?? escaped;
        } else text += rest[index];
      }
      if (rest[index] !== quote) throw new Error('Unclosed binding string');
      tokens.push({ type: 'literal', value: text });
      cursor += index + 1;
    } else if ((match = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(rest))) {
      tokens.push({ type: 'literal', value: Number(match[0]) });
      cursor += match[0].length;
    } else if ((match = /^[A-Za-z_$][\w$]*/.exec(rest))) {
      tokens.push({ type: 'identifier', value: match[0] });
      cursor += match[0].length;
    } else if (
      (match = /^(===|!==|>>>|==|!=|<=|>=|&&|\|\||<<|>>|[+\-*/%<>&|^!~?:.,()[\]{}])/.exec(rest))
    ) {
      tokens.push({ type: 'operator', value: match[0] });
      cursor += match[0].length;
    } else throw new Error('Unsupported WXML expression (precompute in Page data): ' + expression);
  }
  let index = 0;
  const peek = () => tokens[index]?.value;
  function take(value) {
    const token = tokens[index++];
    if (!token || (value !== undefined && token.value !== value))
      throw new Error('Invalid WXML expression: ' + expression);
    return token;
  }
  function primary() {
    let node;
    const token = take();
    if (token.type === 'literal') node = { type: 'literal', value: token.value };
    else if (token.type === 'identifier') {
      if (reserved.has(token.value) || forbidden.has(token.value))
        throw new Error('Unsafe WXML identifier');
      node = { type: 'identifier', value: token.value };
    } else if (token.value === '(') {
      node = expressionAt();
      take(')');
    } else if (['!', '+', '-', '~'].includes(token.value))
      node = { type: 'unary', op: token.value, value: primary() };
    else if (token.value === '[') {
      const items = [];
      while (peek() !== ']') {
        items.push(expressionAt());
        if (peek() !== ',') break;
        take(',');
      }
      take(']');
      node = { type: 'array', items };
    } else if (token.value === '{') {
      const entries = [];
      while (peek() !== '}') {
        const key = take();
        if (!['identifier', 'literal'].includes(key.type) || forbidden.has(String(key.value)))
          throw new Error('Unsafe WXML object key');
        take(':');
        entries.push([key.value, expressionAt()]);
        if (peek() !== ',') break;
        take(',');
      }
      take('}');
      node = { type: 'object', entries };
    } else throw new Error('Invalid WXML expression: ' + expression);
    while (peek() === '.' || peek() === '[') {
      if (peek() === '.') {
        take('.');
        const property = take();
        if (property.type !== 'identifier' || forbidden.has(property.value))
          throw new Error('Unsafe WXML property');
        node = { type: 'property', object: node, key: { type: 'literal', value: property.value } };
      } else {
        take('[');
        const key = expressionAt();
        take(']');
        node = { type: 'property', object: node, key };
      }
    }
    return node;
  }
  function expressionAt(minimum = 0) {
    let node = primary();
    while ((precedence[peek()] || 0) > minimum) {
      const op = take().value;
      node = { type: 'binary', op, left: node, right: expressionAt(precedence[op]) };
    }
    if (minimum === 0 && peek() === '?') {
      take('?');
      const yes = expressionAt();
      take(':');
      node = { type: 'conditional', condition: node, yes, no: expressionAt() };
    }
    return node;
  }
  const result = expressionAt();
  if (index !== tokens.length)
    throw new Error('Unsupported WXML expression (precompute in Page data): ' + expression);
  expressions.set(expression, result);
  return result;
}

function validateExpression(expression) {
  compileExpression(expression);
  return expression;
}

function readBinding(value, start, objectFields = false) {
  let end = start + 2;
  let quote = null;
  let depth = 0;
  let escaped = false;
  let expression = '';
  while (end < value.length) {
    const unit = decodedUnit(value, end);
    const char = unit.value;
    // WeChat's compiler does not decode entities in binding code: `{{a &amp;&amp; b}}` fails.
    if (!quote && unit.end - end > 1)
      throw new Error('HTML entity used as WXML binding code; write the operator directly');
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth++;
    else if (char === '}' && depth > 0) depth--;
    else if (char === '}' && decodedUnit(value, unit.end).value === '}' && depth === 0) {
      expression = expression.trim();
      if (!expression) throw new Error('Empty WXML binding');
      if (objectFields) {
        try {
          validateExpression(expression);
        } catch {
          expression = '{' + expression + '}';
          validateExpression(expression);
        }
      } else validateExpression(expression);
      return { expression, end: decodedUnit(value, unit.end).end };
    }
    expression += char;
    end = unit.end;
  }
  throw new Error('Unclosed WXML binding');
}

function bindingParts(value, { objectFields = false } = {}) {
  const parts = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('{{', cursor);
    if (start < 0) {
      parts.push({ type: 'text', value: value.slice(cursor) });
      break;
    }
    if (start > cursor) parts.push({ type: 'text', value: value.slice(cursor, start) });
    const { expression, end } = readBinding(value, start, objectFields);
    parts.push({ type: 'expression', value: expression });
    cursor = end;
  }
  return parts;
}

function parseWxml(source) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let cursor = 0;
  while (cursor < source.length) {
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4);
      if (end < 0) throw new Error('Unclosed WXML comment');
      cursor = end + 3;
      continue;
    }
    if (source[cursor] !== '<') {
      const start = cursor;
      while (cursor < source.length) {
        if (source.startsWith('{{', cursor)) {
          cursor = readBinding(source, cursor).end;
        } else if (source[cursor] === '<') break;
        else cursor++;
      }
      const value = source.slice(start, cursor);
      bindingParts(value);
      stack.at(-1).children.push({ type: 'text', value });
      continue;
    }
    const closing = source.startsWith('</', cursor);
    const nameStart = cursor + (closing ? 2 : 1);
    const name = /^[A-Za-z][\w:.-]*/.exec(source.slice(nameStart))?.[0];
    if (!name) throw new Error('Invalid WXML tag near ' + source.slice(cursor, cursor + 30));
    cursor = nameStart + name.length;
    if (closing) {
      while (/\s/.test(source[cursor] || '')) cursor++;
      if (source[cursor++] !== '>') throw new Error('Invalid WXML closing tag');
      const open = stack.pop();
      if (!open || open === root || open.name !== name)
        throw new Error('Mismatched WXML closing tag: ' + name);
      continue;
    }
    const attributes = {};
    let selfClosing = false;
    while (cursor < source.length) {
      while (/\s/.test(source[cursor] || '')) cursor++;
      if (source.startsWith('/>', cursor)) {
        selfClosing = true;
        cursor += 2;
        break;
      }
      if (source[cursor] === '>') {
        cursor++;
        break;
      }
      const attribute = /^[^\s"'<>/=]+/.exec(source.slice(cursor))?.[0];
      if (!attribute) throw new Error('Invalid WXML attribute in ' + name);
      if (Object.prototype.hasOwnProperty.call(attributes, attribute))
        throw new Error('Duplicate WXML attribute: ' + attribute);
      cursor += attribute.length;
      while (/\s/.test(source[cursor] || '')) cursor++;
      let value = true;
      if (source[cursor] === '=') {
        cursor++;
        while (/\s/.test(source[cursor] || '')) cursor++;
        const quote = source[cursor++];
        if (quote !== '"' && quote !== "'") throw new Error('WXML attribute values must be quoted');
        const end = source.indexOf(quote, cursor);
        if (end < 0) throw new Error('Unclosed WXML attribute');
        value = source.slice(cursor, end);
        bindingParts(value, { objectFields: name === 'template' && attribute === 'data' });
        cursor = end + 1;
      }
      attributes[attribute] = value;
    }
    const node = { type: 'element', name, attributes, children: [] };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error('Unclosed WXML tag: ' + stack.at(-1).name);
  function siblings(children) {
    let branch = false;
    let finalElse = false;
    for (const node of children) {
      if (node.type === 'text') {
        if (node.value.trim()) branch = false;
        continue;
      }
      const a = node.attributes;
      if ('wx:if' in a) {
        branch = true;
        finalElse = false;
      } else if ('wx:elif' in a || 'wx:else' in a) {
        if (!branch || finalElse) throw new Error('Orphan WXML conditional branch');
        finalElse = 'wx:else' in a;
      } else branch = false;
      if ('wx:for' in a) {
        for (const key of ['wx:for-item', 'wx:for-index']) {
          if (a[key] && !/^[A-Za-z_$][\w$]*$/.test(decodeEntities(a[key])))
            throw new Error('Invalid WXML loop alias');
        }
      }
      siblings(node.children);
    }
  }
  siblings(root.children);
  return root;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function eventHandlers(tree) {
  const handlers = [];
  walk(tree, (node) => {
    for (const [name, value] of Object.entries(node.attributes || {})) {
      if (/^(?:capture-)?(?:bind|catch)(?::?[\w-]+)$/.test(name)) {
        if (typeof value !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(decodeEntities(value))) {
          throw new Error('Event handlers must name a Page method: ' + name);
        }
        handlers.push(decodeEntities(value));
      }
    }
  });
  return [...new Set(handlers)];
}

function evaluate(expression, data) {
  const operators = {
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '/': (a, b) => a / b,
    '%': (a, b) => a % b,
    '<': (a, b) => a < b,
    '>': (a, b) => a > b,
    '<=': (a, b) => a <= b,
    '>=': (a, b) => a >= b,
    '===': (a, b) => a === b,
    '!==': (a, b) => a !== b,
    '==': (a, b) => a == b,
    '!=': (a, b) => a != b,
    '&': (a, b) => a & b,
    '|': (a, b) => a | b,
    '^': (a, b) => a ^ b,
    '<<': (a, b) => a << b,
    '>>': (a, b) => a >> b,
    '>>>': (a, b) => a >>> b,
  };
  function value(node) {
    if (node.type === 'literal') return node.value;
    if (node.type === 'identifier') {
      if (node.value === 'true') return true;
      if (node.value === 'false') return false;
      if (node.value === 'null') return null;
      return Object.hasOwn(data, node.value) ? data[node.value] : undefined;
    }
    if (node.type === 'array') return node.items.map(value);
    if (node.type === 'object')
      return Object.fromEntries(node.entries.map(([key, next]) => [key, value(next)]));
    if (node.type === 'property') {
      const object = value(node.object),
        key = value(node.key);
      return object != null && !forbidden.has(String(key)) && Object.hasOwn(object, key)
        ? object[key]
        : undefined;
    }
    if (node.type === 'conditional')
      return value(node.condition) ? value(node.yes) : value(node.no);
    if (node.type === 'unary') {
      const input = value(node.value);
      return node.op === '!'
        ? !input
        : node.op === '+'
          ? +input
          : node.op === '-'
            ? -input
            : ~input;
    }
    if (node.op === '||') return value(node.left) || value(node.right);
    if (node.op === '&&') return value(node.left) && value(node.right);
    return operators[node.op](value(node.left), value(node.right));
  }
  return value(compileExpression(expression));
}

module.exports = {
  validateExpression,
  bindingParts,
  parseWxml,
  walk,
  eventHandlers,
  evaluate,
  decodeEntities,
};
