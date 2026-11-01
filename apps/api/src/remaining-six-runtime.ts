import { readRequiredSecret } from './env.js';
import type { LocalSearchOptions } from './local-services-service.js';
function flag(name: string) {
  const value = process.env[name] ?? 'false';
  if (value !== 'true' && value !== 'false')
    throw Error('Remaining feature configuration is invalid');
  return value === 'true';
}
/** Explicit opt-in only. Configuration loading creates no network or financial side effect. */
export function readRemainingSixOptions() {
  const matching = flag('SCB_R6_MATCHING_ENABLED'),
    training = flag('SCB_R6_TRAINING_ENABLED'),
    dispatch = flag('SCB_R6_DISPATCH_ENABLED'),
    autoDispatch = flag('SCB_R6_DISPATCH_AUTO_DISPATCH');
  if (autoDispatch && !dispatch) throw Error('Dispatch automation requires the dispatch feature');
  const localSearch: LocalSearchOptions = {};
  if (
    process.env.SCB_LOCAL_SEARCH_CURSOR_KEY !== undefined ||
    process.env.SCB_LOCAL_SEARCH_CURSOR_KEY_FILE !== undefined
  ) {
    const raw = readRequiredSecret('SCB_LOCAL_SEARCH_CURSOR_KEY');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32 || key.toString('base64') !== raw)
      throw Error('Local search cursor configuration is invalid');
    localSearch.cursorKey = key;
  }
  return {
    matching: { enabled: matching },
    training: { enabled: training },
    dispatch: { enabled: dispatch, autoDispatch },
    localSearch,
  };
}
