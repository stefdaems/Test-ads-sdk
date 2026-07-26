/**
 * har.ts
 *
 * Utilities for reading and asserting against Charles / mitmproxy HAR files
 * written to disk during network tests.
 *
 * Usage:
 *   import { readCapturedUrls, readCapturedEntries, countMatches } from '../helpers/har';
 */

import * as fs from 'fs';

export const HAR_PATH = process.env.HAR_PATH ?? '/tmp/ad-sdk-proxy.har';

// ---------------------------------------------------------------------------
// HAR types (subset)
// ---------------------------------------------------------------------------

export interface HarHeader { name: string; value: string; }

export interface HarRequest {
  url: string;
  method: string;
  headers: HarHeader[];
}

export interface HarEntry {
  request: HarRequest;
  response: { status: number };
}

export interface HarFile {
  log: { entries: HarEntry[] };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function clearHar(): void {
  if (fs.existsSync(HAR_PATH)) fs.unlinkSync(HAR_PATH);
}

export function harExists(): boolean {
  return fs.existsSync(HAR_PATH);
}

export function readHar(): HarFile {
  return JSON.parse(fs.readFileSync(HAR_PATH, 'utf8')) as HarFile;
}

// ---------------------------------------------------------------------------
// URL / header accessors
// ---------------------------------------------------------------------------

/** Returns all captured request URLs from the proxy HAR. */
export function readCapturedUrls(): string[] {
  if (!harExists()) return [];
  return readHar().log.entries.map((e) => e.request.url);
}

/**
 * URL substrings that identify Ads SDK network traffic.
 * Matches local SDK patterns as well as the OptiView staging / production API.
 */
const SDK_URL_PATTERNS: readonly string[] = [
  'adsdk',
  'ad-sdk',
  'optiview-ads',
  'optiview-ads-api',
  // Allow the full staging hostname to be matched even without the short form
  'staging.dolbyio.com',
];

/** Returns all HAR entries whose URL is recognised as Ads SDK traffic. */
export function readSdkEntries(extraPattern?: string): HarEntry[] {
  if (!harExists()) return [];
  const patterns = extraPattern ? [...SDK_URL_PATTERNS, extraPattern] : SDK_URL_PATTERNS;
  return readHar().log.entries.filter(
    (e) => patterns.some((p) => e.request.url.includes(p)),
  );
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Count how many captured URLs match `pattern`. */
export function countMatches(urls: string[], pattern: string | RegExp): number {
  return urls.filter((u) =>
    typeof pattern === 'string' ? u.includes(pattern) : pattern.test(u),
  ).length;
}

/**
 * Assert that every SDK entry carries the named header (case-insensitive).
 * Returns an array of entries that are missing the header (empty = all good).
 */
export function entriesMissingHeader(entries: HarEntry[], headerName: string): HarEntry[] {
  const lower = headerName.toLowerCase();
  return entries.filter(
    (e) => !e.request.headers.some((h) => h.name.toLowerCase() === lower),
  );
}

/** Assert all SDK URLs use HTTPS. Returns any insecure URLs found. */
export function findInsecureUrls(urls: string[]): string[] {
  return urls
    .filter((u) =>
      u.includes('adsdk') ||
      u.includes('ad-sdk') ||
      u.includes('optiview-ads') ||
      u.includes('staging.dolbyio.com')
    )
    .filter((u) => u.startsWith('http://'));
}
