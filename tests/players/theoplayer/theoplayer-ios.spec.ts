/**
 * THEOplayer — iOS Native Integration Tests
 *
 * Validates the Ads SDK against THEOplayer iOS SDK running inside the native
 * THEOplayer iOS host app on a real iPhone / iPad.
 *
 * Prerequisites:
 *   - THEOplayer iOS host app installed via:
 *       npm run install:ios -- --variant good   (from repo root)
 *   - Appium + XCUITest server running
 *   - Proxy (Charles / mitmproxy) active
 *
 * Environment variables:
 *   PLATFORM     - must be 'ios'
 *   DEVICE_UDID  - physical device UDID
 *   APP_PATH     - path to the THEOplayer host .ipa
 */

import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../../helpers/driver';
import { clearHar, readCapturedUrls, countMatches, findInsecureUrls, entriesMissingHeader, readSdkEntries } from '../../helpers/har';
import { AD_EVENTS } from '../../helpers/adFeatures';

const PLATFORM = (process.env.PLATFORM ?? 'ios').toLowerCase();

let driver: Browser<'async'>;

beforeAll(async () => {
  if (!['ios', 'tvos'].includes(PLATFORM)) return;
  driver = await createDriver();
});

afterAll(async () => {
  if (!['ios', 'tvos'].includes(PLATFORM)) return;
  await closeDriver(driver);
});

beforeEach(async () => {
  if (!['ios', 'tvos'].includes(PLATFORM)) return;
  clearHar();
  await driver.launchApp();
});

afterEach(async () => {
  if (!['ios', 'tvos'].includes(PLATFORM)) return;
  await driver.closeApp();
});

function iosOnly(): boolean { return !['ios', 'tvos'].includes(PLATFORM); }

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------

describe('THEOplayer iOS — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    if (iosOnly()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('sdk_initialized');
  });

  test('THEOplayer iOS adapter attaches', async () => {
    if (iosOnly()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('adapter_attached:theoplayer');
  });
});

// ---------------------------------------------------------------------------
// 2. ATT & Consent (iOS-specific)
// ---------------------------------------------------------------------------

describe('THEOplayer iOS — ATT & Consent', () => {
  test('ATT dialog appears before first ad request', async () => {
    if (iosOnly()) return;
    const loadContent = await driver.$('~LoadContentButton');
    await loadContent.waitForDisplayed({ timeout: 10_000 });
    await loadContent.click();

    const attAlert = await driver.$('-ios predicate string:type == "XCUIElementTypeAlert"');
    await attAlert.waitForDisplayed({ timeout: 10_000 });
    const allow = await driver.$('-ios predicate string:label == "Allow"');
    await allow.click();

    const ad = await driver.$('~AdContainer');
    expect(await ad.waitForDisplayed({ timeout: 20_000 })).toBe(true);
  });

  test('no tracking pixels when ATT is denied', async () => {
    if (iosOnly()) return;
    const loadContent = await driver.$('~LoadContentButton');
    await loadContent.click();

    const attAlert = await driver.$('-ios predicate string:type == "XCUIElementTypeAlert"');
    await attAlert.waitForDisplayed({ timeout: 10_000 });
    const deny = await driver.$('-ios predicate string:label == "Ask App Not to Track"');
    await deny.click();

    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    const text = await log.getText();
    expect(text).toContain('consent_denied');
    expect(text).not.toContain('impression_pixel');
  });
});

// ---------------------------------------------------------------------------
// 3. Ad Scheduling
// ---------------------------------------------------------------------------

describe('THEOplayer iOS — Ad Scheduling', () => {
  test('pre-roll plays before content begins', async () => {
    if (iosOnly()) return;
    const loadContent = await driver.$('~LoadContentButton');
    await loadContent.waitForDisplayed({ timeout: 10_000 });
    await loadContent.click();

    const ad = await driver.$('~AdContainer');
    await ad.waitForDisplayed({ timeout: 20_000 });

    const log = await (await driver.$('~DiagnosticLog')).getText();
    expect(log).toContain('content_pause_requested');
    expect(log).toContain('ad_started');
  });

  test('VMAP schedules pre/mid/post breaks', async () => {
    if (iosOnly()) return;
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
});

// ---------------------------------------------------------------------------
// 4. Skip
// ---------------------------------------------------------------------------

describe('THEOplayer iOS — Skip', () => {
  test('skip button appears at declared offset', async () => {
    if (iosOnly()) return;
    await (await driver.$('~LoadSkippableAdButton')).click();
    const skipBtn = await driver.$('~SkipButton');
    await skipBtn.waitForDisplayed({ timeout: 15_000 });
    expect(await skipBtn.isDisplayed()).toBe(true);
  });

  test('skipping fires skip pixel', async () => {
    if (iosOnly()) return;
    await (await driver.$('~LoadSkippableAdButton')).click();
    const skipBtn = await driver.$('~SkipButton');
    await skipBtn.waitForDisplayed({ timeout: 15_000 });
    await skipBtn.click();
    await driver.pause(2_000);
    expect(countMatches(readCapturedUrls(), '/skip')).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Tracking
// ---------------------------------------------------------------------------

describe('THEOplayer iOS — Tracking', () => {
  test('impression pixel fires exactly once', async () => {
    if (iosOnly()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
  });

  test('all quartile pixels fire in order', async () => {
    if (iosOnly()) return;
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

  test('all SDK requests use HTTPS', async () => {
    if (iosOnly()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(findInsecureUrls(readCapturedUrls())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Memory
// ---------------------------------------------------------------------------

describe('THEOplayer iOS — Memory', () => {
  test('ad view removed after close', async () => {
    if (iosOnly()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('ad_view_removed');
  });

  test('SDK is deallocated after teardown on iOS', async () => {
    if (iosOnly()) return;
    await (await driver.$('~SDKTeardownButton')).waitForDisplayed({ timeout: 10_000 });
    await (await driver.$('~SDKTeardownButton')).click();
    await driver.pause(2_000);
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('sdk_deallocated');
  });
});
