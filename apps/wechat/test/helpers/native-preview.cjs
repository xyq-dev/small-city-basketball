const fs = require('node:fs');
const path = require('node:path');
const {
  parseWxml,
  bindingParts,
  eventHandlers,
  evaluate,
  decodeEntities: entities,
} = require('./wxml.cjs');
const { loadPage, loadComponent } = require('./native-page.cjs');

function localFile(filename, root, kind) {
  const file = path.resolve(filename);
  if (!file.startsWith(path.resolve(root) + path.sep))
    throw new Error(kind + ' escaped mini-program root');
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep))
    throw new Error(kind + ' symlink escaped mini-program root');
  return file;
}

function componentMappings(mapping, directory, root) {
  return Object.fromEntries(
    Object.entries(mapping).map(([name, target]) => {
      if (typeof target !== 'string' || /[:\\\u0000-\u001f]/.test(target))
        throw new Error('Unsupported component source');
      const file = target.startsWith('/')
        ? path.resolve(root, '.' + target)
        : path.resolve(directory, target);
      if (!file.startsWith(path.resolve(root) + path.sep))
        throw new Error('Component escaped mini-program root');
      return [name, '/' + path.relative(root, file).split(path.sep).join('/')];
    }),
  );
}

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
function attribute(value, data, options) {
  if (value === true) return true;
  const parts = bindingParts(value, options);
  if (parts.length === 1 && parts[0].type === 'expression') return evaluate(parts[0].value, data);
  return parts
    .map((part) =>
      part.type === 'expression' ? (evaluate(part.value, data) ?? '') : entities(part.value),
    )
    .join('');
}

function renderWxml(source, data, options = {}) {
  const {
    root,
    pageDirectory,
    assets = [],
    width = 390,
    usingComponents = {},
    globalComponents = {},
    componentStack = [],
    componentStyles = new Map(),
    componentInstances = [],
    defaultSlot = '',
    templates,
    templateStack = [],
  } = options;
  const tree = typeof source === 'string' ? parseWxml(source) : source;
  const localTemplates = templates || new Map();
  if (!templates) {
    function collect(node) {
      if (node.type === 'element' && node.name === 'template' && node.attributes.name) {
        const name = entities(node.attributes.name);
        if (localTemplates.has(name)) throw new Error('Duplicate local template: ' + name);
        localTemplates.set(name, node);
      }
      for (const child of node.children || []) collect(child);
    }
    collect(tree);
  }
  const tagNames = {
    view: 'div',
    text: 'span',
    button: 'button',
    input: 'input',
    textarea: 'textarea',
    label: 'label',
    image: 'img',
    video: 'video',
    navigator: 'a',
    'scroll-view': 'div',
    'checkbox-group': 'div',
    checkbox: 'input',
    'radio-group': 'div',
    radio: 'input',
    picker: 'div',
    'picker-view': 'div',
    'picker-view-column': 'div',
    form: 'form',
    'rich-text': 'div',
    progress: 'progress',
    switch: 'input',
  };
  const booleans = new Set([
    'disabled',
    'checked',
    'multiple',
    'autofocus',
    'controls',
    'loop',
    'muted',
    'hidden',
  ]);
  function imageSource(value) {
    if (typeof value !== 'string' || !value || !root || !pageDirectory) return null;
    // No network or private service content is fetched by this compatibility preview.
    if (/^(?:https?:|data:|wxfile:)/i.test(value)) return null;
    const target = value.startsWith('/')
      ? path.resolve(root, '.' + value)
      : path.resolve(pageDirectory, value);
    if (!target.startsWith(path.resolve(root) + path.sep))
      throw new Error('Preview asset escaped mini-program root');
    const kind = path.extname(target).toLowerCase();
    const types = {
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    if (!types[kind]) throw new Error('Unsupported local preview image: ' + value);
    const bytes = fs.readFileSync(localFile(target, root, 'Preview asset'));
    if (!bytes.length || bytes.length > 8 * 1024 * 1024)
      throw new Error('Invalid preview image size');
    assets.push({ path: path.relative(root, target), bytes: bytes.length });
    return 'data:' + types[kind] + ';base64,' + bytes.toString('base64');
  }
  function children(nodes, scope) {
    let chain = false,
      matched = false;
    const output = [];
    for (const node of nodes) {
      if (node.type === 'text') {
        if (node.value.trim()) chain = false;
        output.push(
          bindingParts(node.value)
            .map((part) =>
              escape(part.type === 'text' ? entities(part.value) : evaluate(part.value, scope)),
            )
            .join(''),
        );
        continue;
      }
      const a = node.attributes;
      if ('wx:for' in a) {
        chain = false;
        output.push(element(node, scope));
      } else if ('wx:if' in a) {
        chain = true;
        matched = !!attribute(a['wx:if'], scope);
        if (matched) output.push(element(node, scope, true));
      } else if ('wx:elif' in a) {
        if (!chain) throw new Error('Missing conditional branch');
        const show = !matched && !!attribute(a['wx:elif'], scope);
        if (show) output.push(element(node, scope, true));
        matched ||= show;
      } else if ('wx:else' in a) {
        if (!chain) throw new Error('Missing conditional branch');
        if (!matched) output.push(element(node, scope, true));
        chain = false;
      } else {
        chain = false;
        output.push(element(node, scope, true));
      }
    }
    return output.join('');
  }
  function element(node, scope, conditionHandled = false) {
    const a = node.attributes;
    if ('wx:for' in a) {
      const collection = attribute(a['wx:for'], scope);
      const rows = Array.isArray(collection)
        ? collection.map((value, index) => [index, value])
        : collection && typeof collection === 'object'
          ? Object.entries(collection)
          : [];
      return rows
        .map(([index, value]) => {
          const next = {
            ...scope,
            [entities(a['wx:for-item'] || 'item')]: value,
            [entities(a['wx:for-index'] || 'index')]: index,
          };
          const copy = { ...node, attributes: { ...a } };
          delete copy.attributes['wx:for'];
          return element(copy, next);
        })
        .join('');
    }
    if (!conditionHandled && 'wx:if' in a && !attribute(a['wx:if'], scope)) return '';
    if (node.name === 'block') return children(node.children, scope);
    if (node.name === 'slot') return defaultSlot;
    if (node.name === 'template') {
      if (a.name) return '';
      const name = attribute(a.is || '', scope);
      const definition = localTemplates.get(name);
      if (!definition) throw new Error('Unknown local template: ' + name);
      if (templateStack.includes(name) || templateStack.length >= 12)
        throw new Error('Recursive local template expansion');
      const payload = a.data ? attribute(a.data, scope, { objectFields: true }) : {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Template data must be an object');
      return renderWxml({ type: 'root', children: definition.children }, payload, {
        ...options,
        root,
        pageDirectory,
        assets,
        width,
        usingComponents,
        globalComponents,
        componentStack,
        componentStyles,
        componentInstances,
        defaultSlot,
        templates: localTemplates,
        templateStack: [...templateStack, name],
      });
    }
    if (['wxs', 'import', 'include'].includes(node.name))
      throw new Error('Template feature outside compatibility preview subset: ' + node.name);
    if (Object.hasOwn(usingComponents, node.name)) {
      if (!root || !pageDirectory)
        throw new Error('Component resolution requires a native project root');
      const target = usingComponents[node.name];
      if (typeof target !== 'string' || /[:\\\u0000-\u001f]/.test(target))
        throw new Error('Unsupported component source');
      const file = target.startsWith('/')
        ? path.resolve(root, '.' + target)
        : path.resolve(pageDirectory, target);
      if (!file.startsWith(path.resolve(root) + path.sep))
        throw new Error('Component escaped mini-program root');
      const logical = path.relative(root, file).split(path.sep).join('/');
      if (componentStack.includes(file) || componentStack.length >= 12)
        throw new Error('Recursive component expansion');
      const config = JSON.parse(
        fs.readFileSync(localFile(file + '.json', root, 'Component'), 'utf8'),
      );
      if (config.component !== true) throw new Error('Missing native component declaration');
      const properties = {};
      for (const [key, raw] of Object.entries(a)) {
        if (!key.startsWith('wx:') && !/^(?:capture-)?(?:bind|catch)/.test(key)) {
          properties[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = attribute(
            raw,
            scope,
          );
        }
      }
      const loaded = loadComponent({ root, route: logical, properties });
      if (loaded.wx.calls.some((call) => call.type === 'request'))
        throw new Error('Static component has top-level request side effects');
      const componentSource = fs.readFileSync(
        localFile(file + '.wxml', root, 'Component template'),
        'utf8',
      );
      for (const handler of eventHandlers(parseWxml(componentSource))) {
        if (typeof loaded.instance[handler] !== 'function')
          throw new Error('Missing Component event method: ' + handler);
      }
      const scopeId = 'component-' + Buffer.from(logical).toString('hex');
      if (!componentStyles.has(file))
        componentStyles.set(
          file,
          scopedCss(
            convertWxss(readWxss(file + '.wxss', root), width),
            '[data-mini-component-id="' + scopeId + '"]',
          ),
        );
      componentInstances.push({
        tag: node.name,
        path: logical,
        properties: loaded.instance.properties,
      });
      const content = renderWxml(componentSource, loaded.instance.data, {
        ...options,
        root,
        pageDirectory: path.dirname(file),
        assets,
        width,
        usingComponents: {
          ...globalComponents,
          ...componentMappings(config.usingComponents || {}, path.dirname(file), root),
        },
        globalComponents,
        componentStack: [...componentStack, file],
        componentStyles,
        componentInstances,
        defaultSlot: children(node.children, scope),
        templates: undefined,
        templateStack: [],
      });
      const host = [
        'data-mini-component="' + escape(node.name) + '"',
        'data-mini-component-id="' + scopeId + '"',
      ];
      if (a.class) host.push('class="' + escape(attribute(a.class, scope)) + '"');
      if (a.style)
        host.push('style="' + escape(convertWxss(String(attribute(a.style, scope)), width)) + '"');
      if (a.hidden && attribute(a.hidden, scope)) host.push('hidden');
      return '<div ' + host.join(' ') + '>' + content + '</div>';
    }
    if (node.name.includes('-') && !Object.hasOwn(tagNames, node.name))
      throw new Error('Unregistered native component: ' + node.name);
    const tag = tagNames[node.name] || 'div';
    const result = ['data-mini-tag="' + escape(node.name) + '"'];
    let textareaValue = null;
    for (const [key, raw] of Object.entries(a)) {
      if (key.startsWith('wx:')) continue;
      const value = attribute(raw, scope);
      if (/^(?:capture-)?(?:bind|catch)/.test(key)) {
        result.push('data-mini-' + escape(key.replace(':', '-')) + '="' + escape(value) + '"');
      } else if (key === 'src' && node.name === 'image') {
        const src = imageSource(value);
        if (src) result.push('src="' + escape(src) + '"');
        else result.push('alt="远程媒体未在兼容预览中加载"');
      } else if (key === 'src' || key === 'poster') {
        // In particular, no automatic video/private-file loads from fixture data.
        result.push('data-mini-' + key + '="' + escape(value) + '"');
      } else if (key === 'url' && node.name === 'navigator') {
        result.push('data-mini-url="' + escape(value) + '"');
      } else if (key === 'value' && node.name === 'textarea') textareaValue = value;
      else if (booleans.has(key)) {
        if (value) result.push(key);
      } else if (key === 'password') {
        if (value) result.push('type="password"');
      } else if (key === 'style') {
        if (value != null) result.push('style="' + escape(convertWxss(String(value), width)) + '"');
      } else if (
        key === 'type' &&
        node.name === 'input' &&
        ['digit', 'number', 'idcard'].includes(value)
      ) {
        result.push('type="text" inputmode="decimal"');
      } else if (
        [
          'id',
          'class',
          'style',
          'value',
          'type',
          'placeholder',
          'maxlength',
          'name',
          'min',
          'max',
        ].includes(key) ||
        key.startsWith('data-')
      ) {
        if (value != null) result.push(key + '="' + escape(value) + '"');
      }
    }
    if (node.name === 'checkbox' || node.name === 'switch') result.push('type="checkbox"');
    if (node.name === 'radio') result.push('type="radio"');
    if (node.name === 'video') result.push('preload="none"');
    if (node.name === 'scroll-view') {
      const axes = [
        attribute(a['scroll-x'] || '', scope) && 'x',
        attribute(a['scroll-y'] || '', scope) && 'y',
      ].filter(Boolean);
      result.push('data-mini-scroll="' + axes.join('') + '"');
    }
    const start = '<' + tag + ' ' + result.join(' ') + '>';
    if (tag === 'input' || tag === 'img') return start;
    return (
      start +
      (textareaValue === null ? children(node.children, scope) : escape(textareaValue)) +
      '</' +
      tag +
      '>'
    );
  }
  return children(tree.children, data);
}

function readWxss(filename, root, seen = new Set()) {
  if (!fs.existsSync(filename)) return '';
  const resolved = path.resolve(filename);
  if (!resolved.startsWith(path.resolve(root) + path.sep))
    throw new Error('WXSS import escaped mini-program root');
  localFile(resolved, root, 'WXSS import');
  if (seen.has(resolved)) throw new Error('Cyclic WXSS import');
  const next = new Set(seen).add(resolved);
  return fs
    .readFileSync(resolved, 'utf8')
    .replace(/@import\s+["']([^"']+)["']\s*;/g, (_, target) =>
      readWxss(path.resolve(path.dirname(resolved), target), root, next),
    );
}

function convertWxss(css, width) {
  const tags = {
    page: 'body',
    view: 'div',
    text: 'span',
    image: 'img',
    'scroll-view': 'div',
    'checkbox-group': 'div',
    checkbox: 'input',
    'radio-group': 'div',
    radio: 'input',
    picker: 'div',
  };
  return css
    .replace(/(-?\d*\.?\d+)rpx\b/g, (_, value) => ((Number(value) * width) / 750).toFixed(4) + 'px')
    .replace(
      /(^|[\s},>+~])([a-z][a-z-]*)(?=[\s,.#:[{>+~]|$)/g,
      (match, before, tag) => before + (tags[tag] || tag),
    );
}

function scopedCss(css, selector) {
  // Scope plain component selectors. Preserve supported nested CSS blocks;
  // this is still a compatibility aid, not WeChat's style-isolation engine.
  let cursor = 0,
    result = '';
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open < 0) return result + css.slice(cursor);
    let end = open + 1,
      depth = 1,
      quote = null;
    for (; end < css.length && depth; end++) {
      const char = css[end];
      if (quote) {
        if (char === '\\') end++;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    if (depth) throw new Error('Unclosed component WXSS block');
    const head = css.slice(cursor, open).trim(),
      body = css.slice(open + 1, end - 1);
    if (/^@(media|supports|layer)\b/.test(head))
      result += head + '{' + scopedCss(body, selector) + '}';
    else if (head.startsWith('@')) result += head + '{' + body + '}';
    else
      result +=
        head
          .split(',')
          .map((part) =>
            part.includes(':host')
              ? part.trim().replace(/:host\b/g, selector)
              : selector + ' ' + part.trim(),
          )
          .join(',') +
        '{' +
        body +
        '}';
    cursor = end;
  }
  return result;
}

function buildPreview({ root, route, data = {}, width = 390, height = 844 }) {
  root = path.resolve(root);
  if (!/^pages\/[a-z0-9-]+\/index$/.test(route)) throw new Error('Invalid preview route');
  if (
    !Number.isInteger(width) ||
    width < 280 ||
    width > 1024 ||
    !Number.isInteger(height) ||
    height < 400 ||
    height > 1600
  )
    throw new Error('Invalid preview dimensions');
  const manifest = JSON.parse(
    fs.readFileSync(localFile(path.join(root, 'app.json'), root, 'Manifest'), 'utf8'),
  );
  if (!manifest.pages.includes(route)) throw new Error('Page is not registered: ' + route);
  const pageFile = path.join(root, route + '.js');
  const harness = loadPage({ root, route });
  harness.page.setData(data);
  const configPath = path.join(root, route + '.json');
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(localFile(configPath, root, 'Page config'), 'utf8'))
    : {};
  const assets = [];
  const componentStyles = new Map(),
    componentInstances = [];
  const globalComponents = componentMappings(manifest.usingComponents || {}, root, root);
  const markup = renderWxml(
    fs.readFileSync(localFile(path.join(root, route + '.wxml'), root, 'Page template'), 'utf8'),
    harness.page.data,
    {
      root,
      pageDirectory: path.dirname(pageFile),
      assets,
      width,
      usingComponents: {
        ...globalComponents,
        ...componentMappings(config.usingComponents || {}, path.dirname(pageFile), root),
      },
      globalComponents,
      componentStyles,
      componentInstances,
    },
  );
  const title = config.navigationBarTitleText || manifest.window.navigationBarTitleText;
  const background =
    config.navigationBarBackgroundColor || manifest.window.navigationBarBackgroundColor || '#fff';
  const foreground =
    (config.navigationBarTextStyle || manifest.window.navigationBarTextStyle) === 'white'
      ? '#fff'
      : '#132c49';
  const css =
    convertWxss(
      readWxss(path.join(root, 'app.wxss'), root) +
        '\n' +
        readWxss(path.join(root, route + '.wxss'), root),
      width,
    ) +
    '\n' +
    [...componentStyles.values()].join('\n');
  const nativeDefaults =
    '*{box-sizing:border-box}html,body{margin:0;min-height:100%;width:100%;}button,input,textarea{font:inherit}button{cursor:default;max-width:100%}button::after{border:0}button[disabled]{cursor:default}img{display:block;max-width:100%}input[type=checkbox],input[type=radio]{width:20px;height:20px;flex-shrink:0;accent-color:#132c49}textarea{max-width:100%}form{margin:0}[data-mini-tag=picker]{display:block}[data-mini-scroll=x]{overflow-x:auto}[data-mini-scroll=y]{overflow-y:auto}[data-mini-scroll=xy]{overflow:auto}.mini-native-status{height:32px;padding:4px 24px;font:12px/24px sans-serif;display:flex;justify-content:space-between}.mini-native-nav{height:64px;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;font:600 18px/28px sans-serif}.mini-native-bar{background:' +
    background +
    ';color:' +
    foreground +
    '}';
  const phone =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:"><style>' +
    nativeDefaults +
    '\n' +
    css +
    '</style></head><body><header class="mini-native-bar"><div class="mini-native-status"><span>9:41</span><span>● ▰</span></div><div class="mini-native-nav"><span>' +
    escape(title) +
    '</span><span>•••</span></div></header>' +
    markup +
    '</body></html>';
  const html =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>原生模板兼容预览</title><style>body{margin:0;padding:20px;background:#e8edf2;font:13px/1.7 sans-serif;color:#132c49}.preview-note{max-width:760px;margin:0 auto 16px;padding:12px 16px;background:#fff;border-radius:8px}.preview-frame{display:block;margin:auto;border:0;border-radius:20px;background:white;box-shadow:0 12px 40px #132c4920;width:' +
    width +
    'px;height:' +
    height +
    'px;max-width:100%}</style></head><body><aside class="preview-note"><strong>原生 WXML/WXSS 静态兼容预览</strong> · 合成场景 · 非微信运行时/开发工具/真机。<br>用于布局自查，不执行点击、支付、登录或任何网络请求。路由：' +
    escape(route) +
    '；视口：' +
    width +
    '×' +
    height +
    '。</aside><iframe title="小程序静态兼容预览" class="preview-frame" sandbox srcdoc="' +
    escape(phone) +
    '"></iframe></body></html>';
  return {
    html,
    phone,
    data: harness.page.data,
    assets,
    components: componentInstances,
    route,
    width,
    height,
  };
}

module.exports = { renderWxml, readWxss, convertWxss, buildPreview, attribute, scopedCss };
