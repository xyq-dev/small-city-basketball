const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomBytes } = require('node:crypto');

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function setPath(target, key, value) {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(key)) {
    throw new Error('Unsupported setData path: ' + key);
  }
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (parts.some((part) => forbidden.has(part))) throw new Error('Unsafe setData path');
  let node = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    if (node[part] === null || typeof node[part] !== 'object') {
      node[part] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    }
    node = node[part];
  }
  node[parts.at(-1)] = clone(value);
}

/**
 * A deliberately small, explicit wx test double. It never contacts the network.
 * It exercises real local Page/utils code; it is not a WeChat runtime or compiler.
 */
function createWx({ request, storage = new Map(), modalAnswers = [] } = {}) {
  const calls = [];
  let pending = 0;
  const api = {
    calls,
    storage,
    get pendingRequests() {
      return pending;
    },
    request(options) {
      calls.push({ type: 'request', ...options });
      let aborted = false;
      pending++;
      Promise.resolve()
        .then(() => {
          if (request) return request(options);
          return {
            statusCode: 404,
            data: { error: { code: 'TEST_UNHANDLED', message: 'No explicit test response' } },
          };
        })
        .then(
          (response) => {
            if (!aborted) options.success?.(response);
          },
          (error) => {
            if (!aborted) options.fail?.(error);
          },
        )
        .finally(() => {
          pending--;
          options.complete?.();
        });
      return {
        abort() {
          aborted = true;
        },
      };
    },
    getStorageSync(key) {
      calls.push({ type: 'getStorageSync', key });
      return clone(storage.get(key));
    },
    setStorageSync(key, value) {
      calls.push({ type: 'setStorageSync', key, value: clone(value) });
      storage.set(key, clone(value));
    },
    removeStorageSync(key) {
      calls.push({ type: 'removeStorageSync', key });
      storage.delete(key);
    },
    getRandomValues(options) {
      const bytes = randomBytes(options.length);
      const randomValues = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      options.success?.({ randomValues });
    },
    showModal(options) {
      calls.push({ type: 'showModal', ...options });
      const confirm = modalAnswers.shift() === true;
      queueMicrotask(() => options.success?.({ confirm, cancel: !confirm }));
    },
    showToast(options) {
      calls.push({ type: 'showToast', ...options });
    },
    showLoading(options) {
      calls.push({ type: 'showLoading', ...options });
    },
    hideLoading() {
      calls.push({ type: 'hideLoading' });
    },
    navigateTo(options) {
      calls.push({ type: 'navigateTo', ...options });
      options.success?.();
    },
    redirectTo(options) {
      calls.push({ type: 'redirectTo', ...options });
      options.success?.();
    },
    reLaunch(options) {
      calls.push({ type: 'reLaunch', ...options });
      options.success?.();
    },
    navigateBack(options = {}) {
      calls.push({ type: 'navigateBack', ...options });
      options.success?.();
    },
    switchTab(options) {
      calls.push({ type: 'switchTab', ...options });
      options.success?.();
    },
    setNavigationBarTitle(options) {
      calls.push({ type: 'setNavigationBarTitle', ...options });
    },
    stopPullDownRefresh() {},
    login(options) {
      options.fail?.({ errMsg: 'No real WeChat identity in a VM test' });
    },
    chooseMessageFile(options) {
      options.fail?.({ errMsg: 'Explicit file fixture required' });
    },
    getSystemInfoSync() {
      return { windowWidth: 390, windowHeight: 844, safeArea: { bottom: 810 } };
    },
  };
  return api;
}

/** Load the actual entry and its relative CommonJS helpers in one isolated VM. */
function loadPage({ root, route, wx = createWx(), modules = {}, globals = {}, component = false }) {
  const programRoot = path.resolve(root);
  const routePattern = component
    ? /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/
    : /^pages\/[a-z0-9-]+\/index$/;
  if (!routePattern.test(route) || route.includes('..')) throw new Error('Invalid native route');
  let definition;
  const moduleCache = new Map();
  const intervals = new Map();
  const app = { globalData: {} };
  let nextInterval = 0;
  const context = vm.createContext({
    wx,
    Page(value) {
      if (component) throw new Error('Expected Component registration');
      if (definition) throw new Error('Page registered more than once');
      definition = value;
    },
    Component(value) {
      if (!component) throw new Error('Expected Page registration');
      if (definition) throw new Error('Component registered more than once');
      definition = value;
    },
    App() {},
    getApp() {
      return app;
    },
    getCurrentPages() {
      return [];
    },
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    setInterval(fn) {
      const id = ++nextInterval;
      intervals.set(id, fn);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    ...globals,
  });

  function localModule(filename) {
    const file = path.resolve(filename);
    if (file !== programRoot && !file.startsWith(programRoot + path.sep)) {
      throw new Error('Relative module escaped mini-program root');
    }
    const realFile = fs.realpathSync(file),
      realRoot = fs.realpathSync(programRoot);
    if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
      throw new Error('Relative module symlink escaped mini-program root');
    }
    if (Object.prototype.hasOwnProperty.call(modules, file)) return modules[file];
    if (moduleCache.has(file)) return moduleCache.get(file).exports;
    const module = { exports: {} };
    moduleCache.set(file, module);
    if (file.endsWith('.json')) {
      module.exports = JSON.parse(fs.readFileSync(file, 'utf8'));
      return module.exports;
    }
    const source = fs.readFileSync(file, 'utf8');
    const run = new vm.Script(
      '(function(require,module,exports,__filename,__dirname){\n' + source + '\n})',
      {
        filename: file,
      },
    ).runInContext(context);
    run(
      (specifier) => {
        if (Object.prototype.hasOwnProperty.call(modules, specifier)) return modules[specifier];
        if (!specifier.startsWith('.')) throw new Error('Unmocked external module: ' + specifier);
        const resolved = path.resolve(path.dirname(file), specifier);
        const candidate = path.extname(resolved) ? resolved : resolved + '.js';
        return localModule(candidate);
      },
      module,
      module.exports,
      file,
      path.dirname(file),
    );
    return module.exports;
  }

  localModule(path.join(programRoot, route + '.js'));
  if (!definition || typeof definition !== 'object') throw new Error('Missing Page registration');
  const updates = [];
  const page = {
    ...definition,
    route,
    data: clone(definition.data || {}),
    setData(value, callback) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('setData expects a field map');
      }
      for (const [key, next] of Object.entries(value)) {
        if (next === undefined) throw new Error('setData cannot write undefined: ' + key);
        setPath(this.data, key, next);
      }
      updates.push(clone(value));
      callback?.();
    },
  };
  return {
    page,
    wx,
    updates,
    definition,
    intervals,
    requireLocal(relative) {
      return localModule(path.resolve(programRoot, relative));
    },
    async flush(limit = 30) {
      for (let i = 0; i < limit; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        if (wx.pendingRequests === 0) {
          await new Promise((resolve) => setImmediate(resolve));
          if (wx.pendingRequests === 0) return;
        }
      }
      throw new Error('Pending explicit test requests did not settle');
    },
    unload() {
      page.onUnload?.();
    },
  };
}

function loadComponent({ root, route, properties = {} }) {
  const harness = loadPage({ root, route, component: true });
  const values = {};
  for (const [name, definition] of Object.entries(harness.definition.properties || {})) {
    const spec = typeof definition === 'function' ? { type: definition } : definition || {};
    const kind = spec.type?.name;
    let value = Object.hasOwn(properties, name)
      ? properties[name]
      : Object.hasOwn(spec, 'value')
        ? spec.value
        : kind === 'String'
          ? ''
          : kind === 'Number'
            ? 0
            : kind === 'Boolean'
              ? false
              : null;
    if (kind === 'String') value = value == null ? '' : String(value);
    if (kind === 'Number') value = Number(value) || 0;
    if (kind === 'Boolean') value = !!value;
    values[name] = clone(value);
  }
  harness.page.setData(values);
  harness.page.properties = values;
  Object.assign(harness.page, harness.definition.methods || {});
  return { ...harness, instance: harness.page };
}

module.exports = { createWx, loadPage, loadComponent, setPath };
