import { NextResponse } from 'next/server';

/**
 * Next.js 16 Proxy (replaces the old middleware.js).
 *
 * Two responsibilities:
 *  1. Custom-domain rewrite — if the request's Host is a registered custom
 *     domain (looked up in Firebase RTDB at /domains/{key}), rewrite the root
 *     path to /view/{sceneId} so the customer's domain serves their scene.
 *  2. Auth gate for the editor — anything outside /login, /api, /view requires
 *     the __session cookie (Firebase Hosting strips every other cookie).
 */

// Hosts that always pass through without a domain lookup.
const DEFAULT_HOST_SUFFIXES = ['.web.app', '.firebaseapp.com', '.vercel.app', '.run.app'];
const DEFAULT_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

const SESSION_COOKIE = '__session';

// Firebase RTDB REST base URL — set via env. Public read on /domains/* must be
// enabled in the database rules for this lookup to work without auth.
const DB_URL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '';

// Module-level cache of host → sceneId. Survives between warm invocations.
// `null` is a sentinel meaning "lookup attempted, no match" so we don't refetch
// every request for the same unknown host.
const domainCache = new Map();
const CACHE_TTL_MS = 60_000;

function getCachedScene(host) {
  const entry = domainCache.get(host);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    domainCache.delete(host);
    return undefined;
  }
  return entry.sceneId; // string | null
}

function setCachedScene(host, sceneId) {
  domainCache.set(host, { sceneId, expiresAt: Date.now() + CACHE_TTL_MS });
}

function isDefaultHost(host) {
  if (DEFAULT_HOSTS.has(host)) return true;
  for (const suffix of DEFAULT_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

function domainToKey(host) {
  return host.replace(/\./g, ',');
}

async function lookupSceneIdForHost(host) {
  if (!DB_URL) return null;
  const cached = getCachedScene(host);
  if (cached !== undefined) return cached;
  try {
    const url = `${DB_URL.replace(/\/$/, '')}/domains/${domainToKey(host)}.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      setCachedScene(host, null);
      return null;
    }
    const sceneId = await res.json();
    const value = typeof sceneId === 'string' && sceneId ? sceneId : null;
    setCachedScene(host, value);
    return value;
  } catch {
    setCachedScene(host, null);
    return null;
  }
}

function isProtectedRoute(pathname) {
  if (pathname.startsWith('/login')) return false;
  if (pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/view/')) return false;
  if (pathname === '/view') return false;
  if (pathname === '/') return true;
  if (pathname.startsWith('/scenes')) return true;
  return false;
}

export async function proxy(request) {
  const url = request.nextUrl;
  const { pathname } = url;

  // ── 1. Custom-domain rewrite ──
  // Only rewrite the root path. Sub-paths and assets pass through untouched
  // (the rendered /view/{id} page may request /_next/*, /api/*, etc.).
  if (pathname === '/' || pathname === '') {
    const rawHost = (request.headers.get('host') || '').toLowerCase().split(':')[0];
    if (rawHost && !isDefaultHost(rawHost)) {
      const sceneId = await lookupSceneIdForHost(rawHost);
      if (sceneId) {
        const rewriteUrl = new URL(`/view/${sceneId}`, request.url);
        return NextResponse.rewrite(rewriteUrl);
      }
    }
  }

  // ── 2. Auth gate for the editor ──
  if (isProtectedRoute(pathname)) {
    const session = request.cookies.get(SESSION_COOKIE);
    if (!session?.value) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
