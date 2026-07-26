/**
 * THEOplayer — Android Native Integration Tests
 *
 * Validates the Ads SDK against the THEOplayer Android SDK running inside the
 * native THEOplayer Android host app.
 *
 * Prerequisites:
 *   - THEOplayer Android host app installed via:
 *       npm run install:android -- --variant good   (from repo root)
 *   - Appium server running on APPIUM_HOST:APPIUM_PORT
 *   - Proxy (Charles / mitmproxy) active on PROXY_HOST:PROXY_PORT
 *
 * Environment variables:
 *   PLATFORM          - must be 'android'
 *   DEVICE_SERIAL     - adb device serial
 *   APP_PATH          - path to THEOplayer host APK
 *   BAD_APP_BUNDLE_ID - bundle ID of the bad-variant host app
 */

import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../../helpers/driver';
import { clearHar, readCapturedUrls, readSdkEntries, countMatches, findInsecureUrls, entriesMissingHeader } from '../../helpers/har';
import { AD_EVENTS, VAST_FIXTURES } from '../../helpers/adFeatures';

const PLATFORM = (process.env.PLATFORM ?? 'android').toLowerCase();

let driver: Browser<'async'>;

beforeAll(async () => {
  if (PLATFORM !== 'android') return;
  driver = await createDriver();
});

afterAll(async () => {
  if (PLATFORM !== 'android') return;
  await closeDriver(driver);
});

beforeEach(async () => {
  if (PLATFORM !== 'android') return;
  clearHar();
  await driver.launchApp();
});

afterEach(async () => {
  if (PLATFORM !== 'android') return;
  await driver.closeApp();
});

// ---------------------------------------------------------------------------
// Guard — skip entire file on wrong platform
// ---------------------------------------------------------------------------

function androidOnly() {
  if (PLATFORM !== 'android') {
    // Return a resolution that causes the test body to be skipped.
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------

describe('THEOplayer Android — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    if (androidOnly()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('sdk_initialized');
  });

  test('THEOplayer Android adapter attaches', async () => {
    if (androidOnly()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('adapter_attached:theoplayer');
  });

  test('double-init does not crash or duplicate requests', async () => {
    if (androidOnly()) return;
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
});

// ---------------------------------------------------------------------------
// 2. Ad Scheduling
// ---------------------------------------------------------------------------

describe('THEOplayer Android — Ad Scheduling', () => {
  test('pre-roll plays before content begins', async () => {
    if (androidOnly()) return;
    const loadContentBtn = await driver.$('~LoadContentButton');
    await loadContentBtn.waitForDisplayed({ timeout: 10_000 });
    await loadContentBtn.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    const log = await driver.$('~DiagnosticLog');
    const text = await log.getText();
    expect(text).toContain('content_pause_requested');
    expect(text).toContain('ad_started');
  });

  test('mid-roll fires at configured time offset', async () => {
    if (androidOnly()) return;
    const loadContentBtn = await driver.$('~LoadContentButton');
    await loadContentBtn.click();

    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('midroll_break_started'),
      { timeout: 90_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('midroll_break_started');
  });

  test('VMAP schedules pre/mid/post breaks', async () => {
    if (androidOnly()) return;
    const vmapBtn = await driver.$('~LoadVmapButton');
    await vmapBtn.waitForDisplayed({ timeout: 10_000 });
    await vmapBtn.click();

    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('postroll_break_started'),
      { timeout: 120_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('preroll_break_started');
    expect(text).toContain('midroll_break_started');
    expect(text).toContain('postroll_break_started');
  });
});

// ---------------------------------------------------------------------------
// 3. Skip Functionality
// ---------------------------------------------------------------------------

describe('THEOplayer Android — Skip', () => {
  test('skip button appears at declared skip offset', async () => {
    if (androidOnly()) return;
    const loadSkippableBtn = await driver.$('~LoadSkippableAdButton');
    await loadSkippableBtn.waitForDisplayed({ timeout: 10_000 });
    await loadSkippableBtn.click();

    const skipBtn = await driver.$('~SkipButton');
    await skipBtn.waitForDisplayed({ timeout: 15_000 });
    const log = await (await driver.$('~DiagnosticLog')).getText();
    expect(log).not.toContain('skip_button_before_offset');
  });

  test('skipping fires the skip tracking pixel', async () => {
    if (androidOnly()) return;
    const loadSkippableBtn = await driver.$('~LoadSkippableAdButton');
    await loadSkippableBtn.click();

    const skipBtn = await driver.$('~SkipButton');
    await skipBtn.waitForDisplayed({ timeout: 15_000 });
    await skipBtn.click();

    await driver.pause(2_000);
    expect(countMatches(readCapturedUrls(), '/skip')).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Tracking & Telemetry
// ---------------------------------------------------------------------------

describe('THEOplayer Android — Tracking', () => {
  test('impression pixel fires exactly once', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
  });

  test('all quartile pixels fire in order', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
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

  test('all SDK requests use HTTPS', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(findInsecureUrls(readCapturedUrls())).toHaveLength(0);
  });

  test('no duplicate pixels after network drop and reconnect', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });

    await (await driver.$('~SimulateNetworkDropButton')).click();
    await driver.pause(2_000);
    await (await driver.$('~SimulateNetworkReconnectButton')).click();
    await driver.pause(3_000);

    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Player Integration
// ---------------------------------------------------------------------------

describe('THEOplayer Android — Player Integration', () => {
  test('content is paused while pre-roll plays', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const log = await (await driver.$('~DiagnosticLog')).getText();
    expect(log).toContain('content_pause_requested');
  });

  test('content resumes after ad completes', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('content_resumed'),
      { timeout: 60_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('content_resumed');
  });

  test('seeking is disabled during ad playback', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const log = await (await driver.$('~DiagnosticLog')).getText();
    expect(log).toContain('seek_blocked');
  });
});

// ---------------------------------------------------------------------------
// 6. Consent
// ---------------------------------------------------------------------------

describe('THEOplayer Android — Consent', () => {
  test('TCF v2 string is passed in ad requests', async () => {
    if (androidOnly()) return;
    const tcfToggle = await driver.$('~TCFConsentToggle');
    await tcfToggle.waitForDisplayed({ timeout: 10_000 });
    await tcfToggle.click();

    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });

    const log = await (await driver.$('~DiagnosticLog')).getText();
    expect(log).toContain('tcf_consent_read');
  });

  test('no tracking pixels when GDPR consent is denied', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();

    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('consent_denied'),
      { timeout: 15_000, interval: 1_000 },
    );
    const log = await (await driver.$('~DiagnosticLog')).getText();
    expect(log).toContain('consent_denied');
    expect(log).not.toContain('impression_pixel');
  });
});

// ---------------------------------------------------------------------------
// 7. Memory
// ---------------------------------------------------------------------------

describe('THEOplayer Android — Memory', () => {
  test('ad view is removed after close', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    const log = await (await driver.$('~DiagnosticLog')).getText();
    expect(log).toContain('ad_view_removed');
  });

  test('background threads are released after destroy', async () => {
    if (androidOnly()) return;
    const btn = await driver.$('~LoadContentButton');
    await btn.click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    await (await driver.$('~CloseAdButton')).click();
    await driver.pause(1_000);
    const log = await (await driver.$('~DiagnosticLog')).getText();
    expect(log).toContain('threads_terminated');
  });
});
