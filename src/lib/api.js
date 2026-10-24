// The one network call the extension makes: GET https://rrmacademy.org/api/library/lookup with
// exactly one of doi, pmid or q. Never throws; every failure is a reason the card can render.

export const LOOKUP_URL = 'https://rrmacademy.org/api/library/lookup';
const PARAMS = ['doi', 'pmid', 'q'];
const Q_MAX = 300;

// Returns the lookup URL for params, or null when params is not exactly one of
// { doi }, { pmid }, { q } with a non-empty string value.
export function lookupUrl(params) {
  if (!params || typeof params !== 'object') return null;
  const keys = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null);
  if (keys.length !== 1 || !PARAMS.includes(keys[0])) return null;
  const key = keys[0];
  let value = String(params[key]).trim();
  if (!value) return null;
  if (key === 'q') value = value.slice(0, Q_MAX);
  const u = new URL(LOOKUP_URL);
  u.searchParams.set(key, value);
  return u.toString();
}

// Resolves { ok: true, data } for a 200 whose body has v === 1, otherwise
// { ok: false, reason } with reason one of 'invalid' (bad params or a 4xx), 'unavailable' (5xx),
// 'network' (fetch threw or timed out) or 'schema' (200 but not the v1 shape).
export async function lookup(params, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const url = lookupUrl(params);
  if (!url) return { ok: false, reason: 'invalid' };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      signal: controller ? controller.signal : undefined,
    });
  } catch {
    if (timer) clearTimeout(timer);
    return { ok: false, reason: 'network' };
  }

  if (!res || typeof res.status !== 'number') {
    if (timer) clearTimeout(timer);
    return { ok: false, reason: 'network' };
  }

  if (res.status >= 500) {
    if (timer) clearTimeout(timer);
    return { ok: false, reason: 'unavailable' };
  }
  if (res.status !== 200) {
    if (timer) clearTimeout(timer);
    // 429 is the route's own rate limit; the card treats it like an outage, not a bad request.
    return { ok: false, reason: res.status === 429 ? 'unavailable' : 'invalid' };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    if (timer) clearTimeout(timer);
    return { ok: false, reason: 'schema' };
  }
  if (timer) clearTimeout(timer);

  if (!data || typeof data !== 'object' || data.v !== 1 || typeof data.found !== 'boolean') {
    return { ok: false, reason: 'schema' };
  }
  if (data.found && (!data.record || typeof data.record !== 'object')) {
    return { ok: false, reason: 'schema' };
  }
  return { ok: true, data };
}
