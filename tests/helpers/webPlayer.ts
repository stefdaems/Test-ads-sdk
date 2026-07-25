/**
 * webPlayer.ts
 *
 * Playwright-backed browser helper for web player integration tests
 * (THEOplayer, Shaka, VideoJS, Bitmovin).
 *
 * A single Chromium instance is created per test-file (via beforeAll /
 * afterAll) so that tests share the same browser context but each get a
 * fresh page.
 *
 * Usage:
 *   import { launchBrowser, newPage, closeBrowser } from '../helpers/webPlayer';
 *   import type { Browser, Page } from 'playwright';
 *
 *   let browser: Browser, page: Page;
 *   beforeAll(async () => { browser = await launchBrowser(); });
 *   beforeEach(async () => { page = await newPage(browser, playerUrl); });
 *   afterEach(async  () => { await page.close(); });
 *   afterAll(async  () => { await closeBrowser(browser); });
 *
 * Environment variables:
 *   HEADLESS     - 'false' to run in headed mode (default: 'true')
 *   PLAYER_HOST  - base URL of the local player host server (default: http://localhost:3000)
 *   PROXY_HOST   - proxy hostname for HAR export (default: 127.0.0.1)
 *   PROXY_PORT   - proxy port                    (default: 8888)
 */

import { chromium } from 'playwright';
import type { Browser, Page, BrowserContext, Route } from 'playwright';

const HEADLESS    = process.env.HEADLESS !== 'false';
const PLAYER_HOST = process.env.PLAYER_HOST ?? 'http://localhost:3000';
const PROXY_HOST  = process.env.PROXY_HOST  ?? '127.0.0.1';
const PROXY_PORT  = parseInt(process.env.PROXY_PORT ?? '8888', 10);

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

/** Launch a Chromium instance configured to route through the proxy. */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: HEADLESS,
    proxy: {
      server: `http://${PROXY_HOST}:${PROXY_PORT}`,
    },
  });
}

/** Close the browser gracefully. */
export async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close().catch(() => {/* already closed */});
}

// ---------------------------------------------------------------------------
// Page / context lifecycle
// ---------------------------------------------------------------------------

/**
 * Opens a fresh page navigated to `playerUrl` within a new browser context.
 * Each call creates an isolated context (no shared cookies / storage).
 *
 * @param browser  - Playwright Browser instance
 * @param player   - one of 'theoplayer' | 'shaka' | 'videojs' | 'bitmovin'
 * @param variant  - 'good' | 'bad' (default: 'good')
 */
export async function newPage(
  browser: Browser,
  player: 'theoplayer' | 'shaka' | 'videojs' | 'bitmovin',
  variant: 'good' | 'bad' = 'good',
): Promise<Page> {
  const context: BrowserContext = await browser.newContext({
    baseURL: PLAYER_HOST,
    permissions: [],
    bypassCSP: true,
  });

  const page = await context.newPage();
  await page.goto(`${PLAYER_HOST}/players/${player}/${variant}/index.html`, {
    waitUntil: 'domcontentloaded',
    timeout:   30_000,
  });

  return page;
}

// ---------------------------------------------------------------------------
// Ad event collection
// ---------------------------------------------------------------------------

export interface AdEventRecord {
  name: string;
  timestamp: number;
  detail?: unknown;
}

/**
 * Attaches a listener on the page that collects every ad SDK event dispatched
 * on `window`.  Returns an async function that resolves the collected events
 * when called.
 */
export async function collectAdEvents(page: Page): Promise<() => Promise<AdEventRecord[]>> {
  await page.evaluate(() => {
    (window as Record<string, unknown>).__adEvents = [] as AdEventRecord[];
    const events = [
      'adBreakStarted', 'adBreakEnded',
      'adLoaded', 'adStarted', 'adImpression',
      'adFirstQuartile', 'adMidpoint', 'adThirdQuartile',
      'adComplete', 'adSkipped', 'adClicked', 'adError',
      'contentPauseRequested', 'contentResumeRequested',
      'companionLoaded', 'adDestroyed',
    ];
    events.forEach((name) => {
      window.addEventListener(name, (e) => {
        ((window as Record<string, unknown>).__adEvents as AdEventRecord[]).push({
          name,
          timestamp: Date.now(),
          detail: (e as CustomEvent).detail,
        });
      });
    });
  });

  return async (): Promise<AdEventRecord[]> =>
    page.evaluate(
      () => (window as Record<string, unknown>).__adEvents as AdEventRecord[],
    );
}

// ---------------------------------------------------------------------------
// Diagnostic log helpers
// ---------------------------------------------------------------------------

/**
 * Reads the text content of the `#diagnostic-log` element exposed by all
 * good/bad host pages.
 */
export async function readDiagnosticLog(page: Page): Promise<string> {
  const el = page.locator('#diagnostic-log');
  await el.waitFor({ timeout: 15_000 });
  return el.innerText();
}

// ---------------------------------------------------------------------------
// Player control helpers
// ---------------------------------------------------------------------------

/** Clicks the host page's "Load Ad" button. */
export async function clickLoadAd(page: Page): Promise<void> {
  await page.locator('#load-ad-btn').click();
}

/** Clicks the host page's "Load Video Ad" button. */
export async function clickLoadVideoAd(page: Page): Promise<void> {
  await page.locator('#load-video-ad-btn').click();
}

/** Clicks the host page's "Load Content" button to start the content stream. */
export async function clickLoadContent(page: Page): Promise<void> {
  await page.locator('#load-content-btn').click();
}

/** Waits for the ad container to be visible. */
export async function waitForAdContainer(page: Page, timeout = 20_000): Promise<void> {
  await page.locator('#ad-container').waitFor({ state: 'visible', timeout });
}

/** Waits for the ad container to be removed from the DOM. */
export async function waitForAdContainerGone(page: Page, timeout = 10_000): Promise<void> {
  await page.locator('#ad-container').waitFor({ state: 'detached', timeout });
}

/** Returns true when `#ad-container` is visible and within the viewport. */
export async function isAdInViewport(page: Page): Promise<boolean> {
  return page.locator('#ad-container').isVisible();
}

/** Clicks the skip button once it appears. */
export async function clickSkipButton(page: Page, timeout = 30_000): Promise<void> {
  await page.locator('#skip-btn').waitFor({ state: 'visible', timeout });
  await page.locator('#skip-btn').click();
}

/** Clicks the ad to trigger click-through. */
export async function clickAd(page: Page): Promise<void> {
  await page.locator('#ad-container').click();
}

/** Simulates the page going into background (visibility API). */
export async function simulatePageHidden(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden',     { value: true,   writable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Simulates the page returning to foreground. */
export async function simulatePageVisible(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden',     { value: false,   writable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Intercept all requests to block a specific URL pattern (simulate 404). */
export async function blockUrl(page: Page, pattern: string | RegExp): Promise<void> {
  await page.route(pattern, (route: Route) => route.abort('failed'));
}

/**
 * Returns the current memory usage from the browser's performance API
 * (Chrome only). Returns -1 when not available.
 */
export async function getHeapUsedMb(page: Page): Promise<number> {
  return page.evaluate(() => {
    const perf = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return perf ? perf.usedJSHeapSize / (1024 * 1024) : -1;
  });
}
