/**
 * Custom domain helpers — normalization, validation, and the set of hosts
 * that should NEVER be treated as customer custom domains (so the proxy
 * doesn't try to look them up).
 */

/**
 * Hosts the proxy serves natively. Any host in this list (or matching one of
 * the suffix patterns) is passed through without a domain → scene lookup.
 */
const DEFAULT_HOST_SUFFIXES = [
  '.web.app',
  '.firebaseapp.com',
  '.vercel.app',
  '.run.app', // Firebase frameworks backend
];

const DEFAULT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

/**
 * Normalize a user-entered host string for storage and lookup.
 * Strips protocol, path, port, trailing slash; lowercases.
 * Returns '' for falsy or unparseable input.
 */
export function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return '';
  let s = input.trim().toLowerCase();
  if (!s) return '';
  // Strip protocol
  s = s.replace(/^https?:\/\//, '');
  // Strip path / query / fragment
  s = s.split('/')[0].split('?')[0].split('#')[0];
  // Strip port
  s = s.split(':')[0];
  return s;
}

/** Loose host regex: labels of [a-z0-9-], separated by dots, ending in a TLD label. */
const HOST_RE = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function isValidDomain(domain) {
  if (!domain) return false;
  if (!HOST_RE.test(domain)) return false;
  return !isReservedHost(domain);
}

/**
 * True for hosts the proxy owns (the default app domains, localhost, etc.).
 * These can't be used as customer custom domains.
 */
export function isReservedHost(host) {
  const h = normalizeDomain(host);
  if (!h) return true;
  if (DEFAULT_HOSTS.has(h)) return true;
  for (const suffix of DEFAULT_HOST_SUFFIXES) {
    if (h.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * RTDB-safe encoding of a domain for use as a key under /domains/.
 * Dots aren't allowed in RTDB paths; replace with commas.
 */
export function domainToKey(domain) {
  return normalizeDomain(domain).replace(/\./g, ',');
}
