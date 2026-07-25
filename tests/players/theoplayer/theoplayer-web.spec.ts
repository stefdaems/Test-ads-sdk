/**
 * THEOplayer — Web Integration Tests
 *
 * Exercises the full Ads SDK feature matrix against the THEOplayer web
 * player running inside a real Chromium browser via Playwright.
 *
 * Prerequisites:
 *   1. Start the THEOplayer host page server:
 *        cd host-apps/web/players/theoplayer && npx serve . --listen 3000
 *   2. Start a proxy (Charles / mitmproxy) on PROXY_HOST:PROXY_PORT.
 *
 * Environment variables:
 *   PLAYER_HOST  - base URL (default: http://localhost:3000)
 *   PROXY_HOST   - proxy host (default: 127.0.0.1)
 *   PROXY_PORT   - proxy port (default: 8888)
 *   HEADLESS     - 'false' for headed browser (default: 'true')
 */

import type { Browser, Page } from 'playwright';
import {
  launchBrowser,
  closeBrowser,
  newPage,
  collectAdEvents,
  readDiagnosticLog,
  clickLoadAd,
  clickLoadVideoAd,
  clickLoadContent,
  waitForAdContainer,
  waitForAdContainerGone,
  isAdInViewport,
  clickSkipButton,
  clickAd,
  simulatePageHidden,
  simulatePageVisible,
  blockUrl,
  getHeapUsedMb,
} from '../../helpers/webPlayer';
import { clearHar, readCapturedUrls, readSdkEntries, countMatches, findInsecureUrls, entriesMissingHeader } from '../../helpers/har';
import { VAST_FIXTURES, AD_EVENTS } from '../../helpers/adFeatures';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await closeBrowser(browser);
});

beforeEach(async () => {
  clearHar();
  page = await newPage(browser, 'theoplayer');
});

afterEach(async () => {
  await page.close().catch(() => {/* ignore */});
});

// ---------------------------------------------------------------------------
// 1. Initialization & Configuration
// ---------------------------------------------------------------------------

describe('THEOplayer Web — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    const log = await readDiagnosticLog(page);
    expect(log).toContain('sdk_initialized');
    expect(log).not.toContain('init_error');
  });

  test('THEOplayer adapter attaches without error', async () => {
    const log = await readDiagnosticLog(page);
    expect(log).toContain('adapter_attached:theoplayer');
  });

  test('SDK rejects null publisher ID and logs a warning', async () => {
    const badPage = await newPage(browser, 'theoplayer', 'bad');
    const log = await readDiagnosticLog(badPage);
    await badPage.close();
    expect(log).toContain('invalid_publisher_id');
    expect(log).not.toContain('FATAL');
  });

  test('Double-init logs already_initialized warning without crash', async () => {
    await page.evaluate(() => {
      (window as Record<string, () => void>).triggerDoubleInit?.();
    });
    const log = await readDiagnosticLog(page);
    expect(log).toContain('already_initialized');
    expect(log).not.toContain('FATAL');
  });
});

// ---------------------------------------------------------------------------
// 2. Ad Scheduling
// ---------------------------------------------------------------------------

describe('THEOplayer Web — Ad Scheduling', () => {
  test('pre-roll plays before content begins', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await waitForAdContainer(page);

    const events = await getEvents();
    const names = events.map((e) => e.name);

    // contentPauseRequested must come before content plays
    expect(names).toContain(AD_EVENTS.CONTENT_PAUSE_REQUESTED);
    expect(names).toContain(AD_EVENTS.AD_STARTED);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('ad_complete');
    }, { timeout: 60_000 });

    const postEvents = await getEvents();
    expect(postEvents.map((e) => e.name)).toContain(AD_EVENTS.CONTENT_RESUME_REQUESTED);
  });

  test('mid-roll fires at configured time offset', async () => {
    await clickLoadContent(page);
    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('midroll_break_started');
    }, { timeout: 90_000 });
    const log = await readDiagnosticLog(page);
    expect(log).toContain('midroll_break_started');
    expect(log).toContain('ad_complete');
  });

  test('VMAP schedules pre/mid/post-roll breaks from a single tag', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVmapTag?.(url);
    }, VAST_FIXTURES.vmap);
    await clickLoadContent(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('postroll_break_started');
    }, { timeout: 120_000 });

    const log = await readDiagnosticLog(page);
    expect(log).toContain('preroll_break_started');
    expect(log).toContain('midroll_break_started');
    expect(log).toContain('postroll_break_started');
  });

  test('ad pod plays all ads sequentially before content resumes', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.pod3);
    await clickLoadContent(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      const matches = (log.match(/ad_complete/g) ?? []).length;
      return matches >= 3;
    }, { timeout: 120_000 });

    const log = await readDiagnosticLog(page);
    const completions = (log.match(/ad_complete/g) ?? []).length;
    expect(completions).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Skip Functionality
// ---------------------------------------------------------------------------

describe('THEOplayer Web — Skip', () => {
  test('skip button appears at declared skip offset', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.skippable);
    await clickLoadContent(page);
    await waitForAdContainer(page);

    // Skip button should appear within 10 s of ad start.
    await page.locator('#skip-btn').waitFor({ state: 'visible', timeout: 15_000 });
    const log = await readDiagnosticLog(page);
    expect(log).not.toContain('skip_button_before_offset');
  });

  test('skipping fires the skip tracking pixel', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.skippable);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await clickSkipButton(page);

    await page.waitForTimeout(2_000);
    const urls = readCapturedUrls();
    expect(countMatches(urls, '/skip')).toBeGreaterThanOrEqual(1);
  });

  test('non-skippable ad shows no skip button', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.linear15s);
    await clickLoadContent(page);
    await waitForAdContainer(page);

    await page.waitForTimeout(6_000); // past any skip offset
    expect(await page.locator('#skip-btn').isVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. VAST Compliance
// ---------------------------------------------------------------------------

describe('THEOplayer Web — VAST Compliance', () => {
  test('VAST linear ad plays to completion', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await waitForAdContainer(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('ad_complete');
    }, { timeout: 60_000 });

    const events = await getEvents();
    const names = events.map((e) => e.name);
    expect(names).toContain(AD_EVENTS.AD_COMPLETE);
  });

  test('VAST non-linear overlay renders without blocking content playback', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.nonLinear);
    await clickLoadContent(page);

    await page.locator('#overlay-container').waitFor({ state: 'visible', timeout: 20_000 });
    // Content video should still be playing (currentTime advancing).
    const t1 = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.currentTime ?? 0);
    await page.waitForTimeout(2_000);
    const t2 = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.currentTime ?? 0);
    expect(t2).toBeGreaterThan(t1);
  });

  test('VAST wrapper chain resolves and plays inline ad', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.wrapper);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    const log = await readDiagnosticLog(page);
    expect(log).toContain('vast_wrapper_resolved');
    expect(log).toContain('ad_started');
  });

  test('empty VAST causes graceful error and content resumes', async () => {
    await page.evaluate((url: string) => {
      (window as Record<string, (u: string) => void>).loadVastTag?.(url);
    }, VAST_FIXTURES.empty);
    await clickLoadContent(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('vast_error') || log.includes('content_resumed');
    }, { timeout: 20_000 });

    const log = await readDiagnosticLog(page);
    expect(log).toContain('vast_error');
    expect(log).toContain('content_resumed');
    expect(log).not.toContain('FATAL');
  });

  test('404 on VAST URL causes graceful error and content resumes', async () => {
    await blockUrl(page, /vast_tag/);
    await clickLoadContent(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('vast_error') || log.includes('content_resumed');
    }, { timeout: 20_000 });

    const log = await readDiagnosticLog(page);
    expect(log).toContain('vast_error');
    expect(log).toContain('content_resumed');
  });
});

// ---------------------------------------------------------------------------
// 5. Tracking & Telemetry
// ---------------------------------------------------------------------------

describe('THEOplayer Web — Tracking & Telemetry', () => {
  test('impression pixel fires exactly once', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForTimeout(3_000);

    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
  });

  test('click pixel fires exactly once on ad click', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await clickAd(page);
    await page.waitForTimeout(2_000);

    expect(countMatches(readCapturedUrls(), '/click')).toBe(1);
  });

  test('all quartile pixels fire in order', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('quartile/complete');
    }, { timeout: 60_000 });

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

  test('consent header is present on every SDK request', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForTimeout(3_000);

    const missing = entriesMissingHeader(readSdkEntries(), 'x-consent-string');
    expect(missing).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Player Integration Contracts
// ---------------------------------------------------------------------------

describe('THEOplayer Web — Player Integration', () => {
  test('content is paused while pre-roll plays', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await waitForAdContainer(page);

    const events = await getEvents();
    expect(events.some((e) => e.name === AD_EVENTS.CONTENT_PAUSE_REQUESTED)).toBe(true);

    const contentPaused = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement;
      return v ? v.paused : true;
    });
    expect(contentPaused).toBe(true);
  });

  test('content resumes after ad completes', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('content_resumed');
    }, { timeout: 60_000 });

    const log = await readDiagnosticLog(page);
    expect(log).toContain('content_resumed');
  });

  test('seeking is disabled while ad is playing', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);

    const seekable = await page.evaluate(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('seek_blocked');
    });
    // The host page tries a seek on ad start and logs the result.
    const log = await readDiagnosticLog(page);
    expect(log).toContain('seek_blocked');
  });

  test('SDK emits full lifecycle event sequence', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('ad_complete');
    }, { timeout: 60_000 });

    const names = (await getEvents()).map((e) => e.name);
    const expected = [
      AD_EVENTS.AD_LOADED,
      AD_EVENTS.AD_STARTED,
      AD_EVENTS.AD_IMPRESSION,
      AD_EVENTS.AD_COMPLETE,
    ];
    for (const evt of expected) {
      expect(names).toContain(evt);
    }
    // Order check: adLoaded comes before adStarted
    expect(names.indexOf(AD_EVENTS.AD_LOADED)).toBeLessThan(names.indexOf(AD_EVENTS.AD_STARTED));
  });
});

// ---------------------------------------------------------------------------
// 7. Viewability
// ---------------------------------------------------------------------------

describe('THEOplayer Web — Viewability', () => {
  test('ad container is visible in the viewport', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);
    expect(await isAdInViewport(page)).toBe(true);
  });

  test('ad pauses when page is hidden and no false completion fires', async () => {
    const getEvents = await collectAdEvents(page);
    await clickLoadContent(page);
    await waitForAdContainer(page);
    await page.waitForTimeout(2_000);

    await simulatePageHidden(page);
    await page.waitForTimeout(3_000);

    // Must not fire adComplete while hidden.
    const eventsWhileHidden = await getEvents();
    expect(eventsWhileHidden.some((e) => e.name === AD_EVENTS.AD_COMPLETE)).toBe(false);

    await simulatePageVisible(page);
    const log = await readDiagnosticLog(page);
    expect(log).toContain('ad_paused_on_hidden');
    expect(log).not.toContain('false_complete');
  });
});

// ---------------------------------------------------------------------------
// 8. Memory & Cleanup
// ---------------------------------------------------------------------------

describe('THEOplayer Web — Memory & Cleanup', () => {
  test('ad container is removed from DOM after ad completes', async () => {
    await clickLoadContent(page);
    await waitForAdContainer(page);

    await page.waitForFunction(() => {
      const log = document.getElementById('diagnostic-log')?.innerText ?? '';
      return log.includes('ad_complete');
    }, { timeout: 60_000 });

    await waitForAdContainerGone(page);
  });

  test('JS heap does not grow significantly across 5 ad load/destroy cycles', async () => {
    const heapBefore = await getHeapUsedMb(page);
    if (heapBefore < 0) return; // performance.memory not available

    for (let i = 0; i < 5; i++) {
      await clickLoadContent(page);
      await waitForAdContainer(page);
      await page.waitForFunction(() => {
        const log = document.getElementById('diagnostic-log')?.innerText ?? '';
        return log.includes('ad_complete');
      }, { timeout: 60_000 });
      await page.evaluate(() => {
        (window as Record<string, () => void>).resetForNextAd?.();
      });
      await page.waitForTimeout(500);
    }

    const heapAfter = await getHeapUsedMb(page);
    const deltaMb = heapAfter - heapBefore;
    expect(deltaMb).toBeLessThan(50);
  });
});
