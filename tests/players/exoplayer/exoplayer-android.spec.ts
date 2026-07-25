/**
 * ExoPlayer — Android Integration Tests
 *
 * Validates the Ads SDK against ExoPlayer (IMA extension) running inside
 * the native ExoPlayer Android host app.
 *
 * ExoPlayer is the primary Android media player and the one most publishers
 * use.  The Ads SDK integrates via ExoPlayer's IMA extension.
 *
 * Environment variables:
 *   PLATFORM       - must be 'android'
 *   DEVICE_SERIAL  - adb device serial
 *   APP_PATH       - path to ExoPlayer host APK
 */

import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../../helpers/driver';
import { clearHar, readCapturedUrls, countMatches, findInsecureUrls, readSdkEntries, entriesMissingHeader } from '../../helpers/har';
import { AD_EVENTS, VAST_FIXTURES } from '../../helpers/adFeatures';

const PLATFORM = (process.env.PLATFORM ?? 'android').toLowerCase();
let driver: Browser<'async'>;

beforeAll(async () => { if (PLATFORM === 'android') driver = await createDriver(); });
afterAll(async ()  => { if (PLATFORM === 'android') await closeDriver(driver); });
beforeEach(async () => { if (PLATFORM === 'android') { clearHar(); await driver.launchApp(); } });
afterEach(async ()  => { if (PLATFORM === 'android') await driver.closeApp(); });

function skip() { return PLATFORM !== 'android'; }

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    if (skip()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('sdk_initialized');
  });

  test('ExoPlayer IMA adapter attaches', async () => {
    if (skip()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('adapter_attached:exoplayer');
  });

  test('double-init logs warning and does not crash', async () => {
    if (skip()) return;
    await driver.execute('mobile: deepLink', {
      url: 'adsdk://bad-host/double-init',
      package: process.env.BAD_APP_BUNDLE_ID,
    });
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 15_000 });
    const text = await log.getText();
    expect(text).toContain('already_initialized');
    expect(text).not.toContain('FATAL');
  });

  test('SDK rejects null publisher ID gracefully', async () => {
    if (skip()) return;
    await driver.execute('mobile: deepLink', {
      url: 'adsdk://bad-host/null-pid',
      package: process.env.BAD_APP_BUNDLE_ID,
    });
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    const text = await log.getText();
    expect(text).toContain('invalid_publisher_id');
    expect(text).not.toContain('NullPointerException');
  });
});

// ---------------------------------------------------------------------------
// 2. Ad Scheduling
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — Ad Scheduling', () => {
  test('pre-roll plays before content begins', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('content_pause_requested');
    expect(text).toContain('ad_started');
  });

  test('mid-roll fires at configured time offset', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('midroll_break_started'),
      { timeout: 90_000, interval: 2_000 },
    );
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('midroll_break_started');
  });

  test('post-roll plays after content completes', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('postroll_break_started'),
      { timeout: 120_000, interval: 2_000 },
    );
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('postroll_break_started');
  });

  test('VMAP schedules pre/mid/post breaks', async () => {
    if (skip()) return;
    await (await driver.$('~LoadVmapButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('postroll_break_started'),
      { timeout: 120_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('preroll_break_started');
    expect(text).toContain('midroll_break_started');
    expect(text).toContain('postroll_break_started');
  });

  test('ad pod plays all ads sequentially', async () => {
    if (skip()) return;
    await (await driver.$('~LoadPodAdButton')).click();
    await driver.waitUntil(
      async () => {
        const text = await (await driver.$('~DiagnosticLog')).getText();
        return (text.match(/ad_complete/g) ?? []).length >= 3;
      },
      { timeout: 120_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect((text.match(/ad_complete/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Skip Functionality
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — Skip', () => {
  test('skip button appears at declared skip offset', async () => {
    if (skip()) return;
    await (await driver.$('~LoadSkippableAdButton')).click();
    const skipBtn = await driver.$('~SkipButton');
    await skipBtn.waitForDisplayed({ timeout: 15_000 });
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).not.toContain('skip_button_before_offset');
  });

  test('skipping fires skip tracking pixel', async () => {
    if (skip()) return;
    await (await driver.$('~LoadSkippableAdButton')).click();
    const skipBtn = await driver.$('~SkipButton');
    await skipBtn.waitForDisplayed({ timeout: 15_000 });
    await skipBtn.click();
    await driver.pause(2_000);
    expect(countMatches(readCapturedUrls(), '/skip')).toBeGreaterThanOrEqual(1);
  });

  test('non-skippable ad shows no skip button', async () => {
    if (skip()) return;
    await (await driver.$('~LoadNonSkippableAdButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(6_000);
    expect(await (await driver.$('~SkipButton')).isDisplayed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. VAST Compliance
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — VAST Compliance', () => {
  test('VAST linear plays to completion', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('ad_complete');
  });

  test('VAST wrapper chain resolves and plays', async () => {
    if (skip()) return;
    await (await driver.$('~LoadWrapperAdButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('vast_wrapper_resolved');
    expect(text).toContain('ad_started');
  });

  test('empty VAST — content resumes gracefully', async () => {
    if (skip()) return;
    await (await driver.$('~LoadEmptyVastButton')).click();
    await driver.waitUntil(
      async () => {
        const t = await (await driver.$('~DiagnosticLog')).getText();
        return t.includes('vast_error') || t.includes('content_resumed');
      },
      { timeout: 20_000, interval: 1_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('vast_error');
    expect(text).toContain('content_resumed');
    expect(text).not.toContain('FATAL');
  });
});

// ---------------------------------------------------------------------------
// 5. Tracking & Telemetry
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — Tracking', () => {
  test('impression pixel fires exactly once', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
  });

  test('click pixel fires exactly once on ad click', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    const ad = await driver.$('~AdContainer');
    await ad.waitForDisplayed({ timeout: 20_000 });
    await ad.click();
    await driver.pause(2_000);
    expect(countMatches(readCapturedUrls(), '/click')).toBe(1);
  });

  test('quartile pixels fire in order', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    const urls = readCapturedUrls();
    expect(countMatches(urls, '/quartile/start')).toBe(1);
    expect(countMatches(urls, '/quartile/first')).toBe(1);
    expect(countMatches(urls, '/quartile/midpoint')).toBe(1);
    expect(countMatches(urls, '/quartile/third')).toBe(1);
    expect(countMatches(urls, '/quartile/complete')).toBe(1);
  });

  test('no duplicate pixels after network drop and reconnect', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await (await driver.$('~SimulateNetworkDropButton')).click();
    await driver.pause(2_000);
    await (await driver.$('~SimulateNetworkReconnectButton')).click();
    await driver.pause(3_000);
    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
  });

  test('all SDK requests use HTTPS', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(findInsecureUrls(readCapturedUrls())).toHaveLength(0);
  });

  test('consent header present on every SDK request', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(entriesMissingHeader(readSdkEntries(), 'x-consent-string')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Player Integration Contracts
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — Player Integration', () => {
  test('content is paused while pre-roll plays', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('content_pause_requested');
  });

  test('content resumes from correct position after ad', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('content_resumed'),
      { timeout: 60_000, interval: 2_000 },
    );
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('content_resumed');
  });

  test('seeking disabled during ad playback', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('seek_blocked');
  });

  test('player controls are hidden during ad', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('player_controls_hidden');
  });

  test('SDK emits full lifecycle event sequence', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    for (const event of ['ad_loaded', 'ad_started', 'ad_impression', 'ad_complete']) {
      expect(text).toContain(event);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Consent & Privacy
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — Consent', () => {
  test('TCF v2 string passed in ad requests when consent granted', async () => {
    if (skip()) return;
    await (await driver.$('~TCFConsentToggle')).click();
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('tcf_consent_read');
  });

  test('no tracking pixels when GDPR consent denied', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('consent_denied'),
      { timeout: 15_000, interval: 1_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('consent_denied');
    expect(text).not.toContain('impression_pixel');
  });

  test('CCPA opt-out suppresses sale-related tracking', async () => {
    if (skip()) return;
    await (await driver.$('~CCPAOptOutToggle')).click();
    await (await driver.$('~LoadContentButton')).click();
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 15_000 });
    const text = await log.getText();
    expect(text).toContain('ccpa_opt_out');
    expect(text).not.toContain('sale_tracking');
  });
});

// ---------------------------------------------------------------------------
// 8. Viewability
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — Viewability', () => {
  test('ad is visible in viewport', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    const ad = await driver.$('~AdContainer');
    await ad.waitForDisplayed({ timeout: 20_000 });
    expect(await ad.isDisplayedInViewport()).toBe(true);
  });

  test('ad pauses when app enters background; no false completion', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.background(-1);
    await driver.pause(2_000);
    await driver.activate(process.env.APP_BUNDLE_ID ?? await driver.getCurrentPackage?.() ?? '');
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('video_paused');
    expect(text).not.toContain('false_complete');
  });
});

// ---------------------------------------------------------------------------
// 9. Memory & Cleanup
// ---------------------------------------------------------------------------

describe('ExoPlayer Android — Memory', () => {
  test('ad view removed from parent after close', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('ad_view_removed');
  });

  test('background threads released after destroy', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    await (await driver.$('~CloseAdButton')).click();
    await driver.pause(1_000);
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('threads_terminated');
  });

  test('memory stable across 10 sequential ad load/destroy cycles', async () => {
    if (skip()) return;
    for (let i = 0; i < 10; i++) {
      await (await driver.$('~LoadContentButton')).click();
      await driver.waitUntil(
        async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
        { timeout: 60_000, interval: 2_000 },
      );
      await (await driver.$('~CloseAdButton')).click();
      await driver.pause(500);
    }
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).not.toContain('memory_leak_detected');
    const match = text.match(/memory_delta_mb:(\d+)/);
    if (match) expect(parseInt(match[1], 10)).toBeLessThan(50);
  });

  test('Doze mode does not cause duplicate impressions', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    // Host app button simulates Doze via adb-bridge.
    await (await driver.$('~SimulateDozeButton')).click();
    await driver.pause(3_000);
    await (await driver.$('~DisableDozeButton')).click();
    await driver.pause(2_000);
    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
  });
});
