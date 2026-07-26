/**
 * Bitmovin Player — Web Integration Tests
 *
 * Exercises the full Ads SDK feature matrix against Bitmovin Player running
 * in Chromium via Playwright.
 *
 * Prerequisites:
 *   Start the Bitmovin host page server:
 *     cd host-apps/web/players/bitmovin && npx serve . --listen 3003
 */

import type { Browser, Page } from 'playwright';
import {
  launchBrowser, closeBrowser, newPage,
  collectAdEvents, readDiagnosticLog,
  clickLoadContent, waitForAdContainer, waitForAdContainerGone,
  isAdInViewport, clickSkipButton, clickAd,
  simulatePageHidden, simulatePageVisible, getHeapUsedMb, blockUrl,
} from '../../helpers/webPlayer';
import { clearHar, readCapturedUrls, readSdkEntries, countMatches, findInsecureUrls, entriesMissingHeader } from '../../helpers/har';
import { VAST_FIXTURES, AD_EVENTS } from '../../helpers/adFeatures';

let browser: Browser;
let page: Page;

beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async ()  => { await closeBrowser(browser); });
beforeEach(async () => {
  clearHar();
  page = await newPage(browser, 'bitmovin');
});
afterEach(async () => { await page.close().catch(() => {/**/}); });

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------

describe('Bitmovin Web — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    expect(await readDiagnosticLog(page)).toContain('sdk_initialized');
  });

  test('Bitmovin advertising module adapter attaches', async () => {
    expect(await readDiagnosticLog(page)).toContain('adapter_attached:bitmovin');
  });

  test('SDK rejects null publisher ID gracefully', async () => {
    const bad = await newPage(browser, 'bitmovin', 'bad');
    const log = await readDiagnosticLog(bad);
    await bad.close();
    expect(log).toContain('invalid_publisher_id');
    expect(log).not.toContain('FATAL');
  });

  test('double-init logs already_initialized without crash', async () => {
    await page.evaluate(() => { (window as Record<string, () => void>).triggerDoubleInit?.(); });
    const log = await readDiagnosticLog(page);
    expect(log).toContain('already_initialized');
    expect(log).not.toContain('FATAL');
  });
});

// ---------------------------------------------------------------------------
// 2. Ad Scheduling
// ---------------------------------------------------------------------------

describe('Bitmovin Web — Ad Scheduling', () => {
  test('pre-roll plays before content begins', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    const names = (await getEvents()).map((e) => e.name);
    expect(names).toContain(AD_EVENTS.CONTENT_PAUSE_REQUESTED);
    expect(names).toContain(AD_EVENTS.AD_STARTED);
  });

  test('mid-roll fires at configured offset', async () => {
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('midroll_break_started'),
      { timeout: 90_000 },
    );
    expect(await readDiagnosticLog(page)).toContain('midroll_break_started');
  });

  test('VMAP schedules pre/mid/post breaks', async () => {
    await page.evaluate((url: string) => { (window as Record<string, (u: string) => void>).loadVmapTag?.(url); }, VAST_FIXTURES.vmap);
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('postroll_break_started'),
      { timeout: 120_000 },
    );
    const log = await readDiagnosticLog(page);
    expect(log).toContain('preroll_break_started');
    expect(log).toContain('midroll_break_started');
    expect(log).toContain('postroll_break_started');
  });

  test('ad pod plays all ads sequentially', async () => {
    await page.evaluate((url: string) => { (window as Record<string, (u: string) => void>).loadVastTag?.(url); }, VAST_FIXTURES.pod3);
    await clickLoadContent(page);
    await page.waitForFunction(() => (document.getElementById('diagnostic-log')?.innerText ?? '').match(/ad_complete/g)?.length ?? 0 >= 3, { timeout: 120_000 });
    expect((await readDiagnosticLog(page)).match(/ad_complete/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Skip
// ---------------------------------------------------------------------------

describe('Bitmovin Web — Skip', () => {
  test('skip button appears at declared offset', async () => {
    await page.evaluate((url: string) => { (window as Record<string, (u: string) => void>).loadVastTag?.(url); }, VAST_FIXTURES.skippable);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.locator('#skip-btn').waitFor({ state: 'visible', timeout: 15_000 });
    expect(await page.locator('#skip-btn').isVisible()).toBe(true);
  });

  test('skipping fires skip pixel', async () => {
    await page.evaluate((url: string) => { (window as Record<string, (u: string) => void>).loadVastTag?.(url); }, VAST_FIXTURES.skippable);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await clickSkipButton(page);
    await page.waitForTimeout(2_000);
    expect(countMatches(readCapturedUrls(), '/skip')).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. VAST Compliance
// ---------------------------------------------------------------------------

describe('Bitmovin Web — VAST Compliance', () => {
  test('VAST linear plays to completion', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('ad_complete'),
      { timeout: 60_000 },
    );
    expect((await getEvents()).map((e) => e.name)).toContain(AD_EVENTS.AD_COMPLETE);
  });

  test('VAST non-linear overlay renders without blocking content', async () => {
    await page.evaluate((url: string) => { (window as Record<string, (u: string) => void>).loadVastTag?.(url); }, VAST_FIXTURES.nonLinear);
    await clickLoadContent(page);
    await page.locator('#overlay-container').waitFor({ state: 'visible', timeout: 20_000 });
    const t1 = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.currentTime ?? 0);
    await page.waitForTimeout(2_000);
    expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.currentTime ?? 0)).toBeGreaterThan(t1);
  });

  test('VAST wrapper chain resolves and plays', async () => {
    await page.evaluate((url: string) => { (window as Record<string, (u: string) => void>).loadVastTag?.(url); }, VAST_FIXTURES.wrapper);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    expect(await readDiagnosticLog(page)).toContain('vast_wrapper_resolved');
  });

  test('empty VAST — content resumes gracefully', async () => {
    await page.evaluate((url: string) => { (window as Record<string, (u: string) => void>).loadVastTag?.(url); }, VAST_FIXTURES.empty);
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('content_resumed'),
      { timeout: 20_000 },
    );
    const log = await readDiagnosticLog(page);
    expect(log).toContain('vast_error');
    expect(log).toContain('content_resumed');
  });

  test('companion ad renders in companion slot', async () => {
    await clickLoadContent(page);
    await page.locator('#companion-slot').waitFor({ state: 'visible', timeout: 30_000 });
    expect(await readDiagnosticLog(page)).toContain('companion_loaded');
  });
});

// ---------------------------------------------------------------------------
// 5. Tracking
// ---------------------------------------------------------------------------

describe('Bitmovin Web — Tracking', () => {
  test('impression pixel fires exactly once', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForTimeout(3_000);
    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
  });

  test('click pixel fires exactly once', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await clickAd(page);
    await page.waitForTimeout(2_000);
    expect(countMatches(readCapturedUrls(), '/click')).toBe(1);
  });

  test('quartile pixels fire in order', async () => {
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('quartile/complete'),
      { timeout: 60_000 },
    );
    const urls = readCapturedUrls();
    for (const pattern of ['/quartile/start', '/quartile/first', '/quartile/midpoint', '/quartile/third', '/quartile/complete']) {
      expect(countMatches(urls, pattern)).toBe(1);
    }
  });

  test('all SDK requests use HTTPS', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForTimeout(3_000);
    expect(findInsecureUrls(readCapturedUrls())).toHaveLength(0);
  });

  test('consent header present on every SDK request', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForTimeout(3_000);
    expect(entriesMissingHeader(readSdkEntries(), 'x-consent-string')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Player Integration
// ---------------------------------------------------------------------------

describe('Bitmovin Web — Player Integration', () => {
  test('content is paused while pre-roll plays', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.paused ?? true)).toBe(true);
  });

  test('content resumes after ad completes', async () => {
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('content_resumed'),
      { timeout: 60_000 },
    );
    expect(await readDiagnosticLog(page)).toContain('content_resumed');
  });

  test('seeking disabled during ad', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    expect(await readDiagnosticLog(page)).toContain('seek_blocked');
  });

  test('SDK emits full lifecycle event sequence', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('ad_complete'),
      { timeout: 60_000 },
    );
    const names = (await getEvents()).map((e) => e.name);
    for (const evt of [AD_EVENTS.AD_LOADED, AD_EVENTS.AD_STARTED, AD_EVENTS.AD_IMPRESSION, AD_EVENTS.AD_COMPLETE]) {
      expect(names).toContain(evt);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Viewability
// ---------------------------------------------------------------------------

describe('Bitmovin Web — Viewability', () => {
  test('ad container is visible in viewport', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    expect(await isAdInViewport(page)).toBe(true);
  });

  test('ad pauses on page hidden; no false completion', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForTimeout(2_000);
    await simulatePageHidden(page);
    await page.waitForTimeout(3_000);
    expect((await getEvents()).some((e) => e.name === AD_EVENTS.AD_COMPLETE)).toBe(false);
    await simulatePageVisible(page);
    expect(await readDiagnosticLog(page)).not.toContain('false_complete');
  });
});

// ---------------------------------------------------------------------------
// 8. Memory
// ---------------------------------------------------------------------------

describe('Bitmovin Web — Memory', () => {
  test('ad container removed after ad completes', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('ad_complete'),
      { timeout: 60_000 },
    );
    await waitForAdContainerGone(page);
  });

  test('heap stable across 5 ad cycles', async () => {
    const before = await getHeapUsedMb(page);
    if (before < 0) return;
    for (let i = 0; i < 5; i++) {
      await clickLoadContent(page);
      await waitForAdContainer(page);
      await page.waitForFunction(
        () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('ad_complete'),
        { timeout: 60_000 },
      );
      await page.evaluate(() => { (window as Record<string, () => void>).resetForNextAd?.(); });
      await page.waitForTimeout(500);
    }
    expect(await getHeapUsedMb(page) - before).toBeLessThan(50);
  });
});
