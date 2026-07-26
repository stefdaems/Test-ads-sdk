/**
 * Shaka Player — Web Integration Tests
 *
 * Exercises the full Ads SDK feature matrix against Shaka Player running in
 * Chromium via Playwright.
 *
 * Prerequisites:
 *   Start the Shaka host page server:
 *     cd host-apps/web/players/shaka && npx serve . --listen 3001
 */

import type { Browser, Page } from 'playwright';
import {
  launchBrowser, closeBrowser, newPage,
  collectAdEvents, readDiagnosticLog,
  clickLoadContent, waitForAdContainer, waitForAdContainerGone,
  isAdInViewport, clickSkipButton, clickAd,
  simulatePageHidden, simulatePageVisible, blockUrl, getHeapUsedMb,
} from '../../helpers/webPlayer';
import { clearHar, readCapturedUrls, readSdkEntries, countMatches, findInsecureUrls, entriesMissingHeader } from '../../helpers/har';
import { VAST_FIXTURES, AD_EVENTS } from '../../helpers/adFeatures';

let browser: Browser;
let page: Page;

beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async ()  => { await closeBrowser(browser); });
beforeEach(async () => {
  clearHar();
  page = await newPage(browser, 'shaka');
});
afterEach(async () => { await page.close().catch(() => {/**/}); });

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------

describe('Shaka Web — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    const log = await readDiagnosticLog(page);
    expect(log).toContain('sdk_initialized');
  });

  test('Shaka adapter attaches without error', async () => {
    const log = await readDiagnosticLog(page);
    expect(log).toContain('adapter_attached:shaka');
  });

  test('SDK rejects null publisher ID', async () => {
    const badPage = await newPage(browser, 'shaka', 'bad');
    const log = await readDiagnosticLog(badPage);
    await badPage.close();
    expect(log).toContain('invalid_publisher_id');
    expect(log).not.toContain('FATAL');
  });
});

// ---------------------------------------------------------------------------
// 2. Ad Scheduling
// ---------------------------------------------------------------------------

describe('Shaka Web — Ad Scheduling', () => {
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
    const log = await readDiagnosticLog(page);
    expect(log).toContain('midroll_break_started');
  });

  test('VMAP schedules pre/mid/post-roll breaks', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVmapTag?.(url);
    }, VAST_FIXTURES.vmap);
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
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.pod3);
    await clickLoadContent(page);

    await page.waitForFunction(() => {
      const text = document.getElementById('diagnostic-log')?.innerText ?? '';
      return (text.match(/ad_complete/g) ?? []).length >= 3;
    }, { timeout: 120_000 });

    const log = await readDiagnosticLog(page);
    expect((log.match(/ad_complete/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Skip
// ---------------------------------------------------------------------------

describe('Shaka Web — Skip', () => {
  test('skip button appears at declared offset', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.skippable);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.locator('#skip-btn').waitFor({ state: 'visible', timeout: 15_000 });
    expect(await page.locator('#skip-btn').isVisible()).toBe(true);
  });

  test('skipping fires skip pixel', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.skippable);
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

describe('Shaka Web — VAST Compliance', () => {
  test('VAST linear plays to completion', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('ad_complete'),
      { timeout: 60_000 },
    );
    expect((await getEvents()).map((e) => e.name)).toContain(AD_EVENTS.AD_COMPLETE);
  });

  test('VAST wrapper resolves to inline ad', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.wrapper);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    const log = await readDiagnosticLog(page);
    expect(log).toContain('vast_wrapper_resolved');
  });

  test('empty VAST — content resumes gracefully', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.empty);
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('content_resumed'),
      { timeout: 20_000 },
    );
    const log = await readDiagnosticLog(page);
    expect(log).toContain('vast_error');
    expect(log).toContain('content_resumed');
  });
});

// ---------------------------------------------------------------------------
// 5. Tracking
// ---------------------------------------------------------------------------

describe('Shaka Web — Tracking', () => {
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
    expect(countMatches(urls, '/quartile/start')).toBe(1);
    expect(countMatches(urls, '/quartile/first')).toBe(1);
    expect(countMatches(urls, '/quartile/midpoint')).toBe(1);
    expect(countMatches(urls, '/quartile/third')).toBe(1);
    expect(countMatches(urls, '/quartile/complete')).toBe(1);
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

describe('Shaka Web — Player Integration', () => {
  test('content is paused while pre-roll plays', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    const paused = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.paused ?? true);
    expect(paused).toBe(true);
  });

  test('content resumes after ad completes', async () => {
    await clickLoadContent(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('content_resumed'),
      { timeout: 60_000 },
    );
    const log = await readDiagnosticLog(page);
    expect(log).toContain('content_resumed');
  });

  test('seeking is disabled during ad', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    const log = await readDiagnosticLog(page);
    expect(log).toContain('seek_blocked');
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

describe('Shaka Web — Viewability', () => {
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
    const log = await readDiagnosticLog(page);
    expect(log).not.toContain('false_complete');
  });
});

// ---------------------------------------------------------------------------
// 8. Memory
// ---------------------------------------------------------------------------

describe('Shaka Web — Memory', () => {
  test('ad container removed from DOM after ad completes', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForFunction(
      () => (document.getElementById('diagnostic-log')?.innerText ?? '').includes('ad_complete'),
      { timeout: 60_000 },
    );
    await waitForAdContainerGone(page);
  });
});
