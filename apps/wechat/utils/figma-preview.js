const REQUEST_VALUE = 'figma';

function requested(query) {
  return !!query && query.uiPreview === REQUEST_VALUE;
}

function environment(runtime) {
  if (!runtime || typeof runtime.getAccountInfoSync !== 'function') return '';
  try {
    const account = runtime.getAccountInfoSync();
    const value = account && account.miniProgram && account.miniProgram.envVersion;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function enabled(query, runtime) {
  return requested(query) && environment(runtime) === 'develop';
}

module.exports = { enabled, environment, requested };
