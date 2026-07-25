/**
 * Shaka Player — Android Integration Tests
 *
 * Shaka Player on Android is embedded inside ExoPlayer via
 * the Shaka-Exoplayer extension.  This suite validates the Ads SDK
 * integration inside the Shaka Android host app.
 *
 * Environment variables:
 *   PLATFORM       - must be 'android'
 *   DEVICE_SERIAL  - adb device serial
 *   APP_PATH       - path to Shaka Android host APK
 */

import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../../helpers/driver';
import { clearHar, readCapturedUrls, countMatches, findInsecureUrls } from '../../helpers/har';
import { AD_EVENTS } from '../../helpers/adFeatures';

const PLATFORM = (process.env.PLATFORM ?? 'android').toLowerCase();
let driver: Browser<'async'>;

beforeAll(async () => { if (PLATFORM === 'android') driver = await createDriver(); });
afterAll(async ()  => { if (PLATFORM === 'android') await closeDriver(driver); });
beforeEach(async () => { if (PLATFORM === 'android') { clearHar(); await driver.launchApp(); } });
afterEach(async ()  => { if (PLATFORM === 'android') await driver.closeApp(); });

function skip() { return PLATFORM !== 'android'; }

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

describe('Shaka Android — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    if (skip()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('sdk_initialized');
  });

  test('Shaka-ExoPlayer adapter attaches', async () => {
    if (skip()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('adapter_attached:shaka-android');
  });
});

// ---------------------------------------------------------------------------
// Ad Scheduling
// ---------------------------------------------------------------------------

describe('Shaka Android — Ad Scheduling', () => {
  test('pre-roll plays before content begins', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('content_pause_requested');
    expect(text).toContain('ad_started');
  });

  test('mid-roll fires at configured offset', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('midroll_break_started'),
      { timeout: 90_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('midroll_break_started');
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
});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

describe('Shaka Android — Tracking', () => {
  test('impression pixel fires exactly once', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(countMatches(readCapturedUrls(), '/impression')).toBe(1);
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

  test('all SDK requests use HTTPS', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(findInsecureUrls(readCapturedUrls())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

describe('Shaka Android — Consent', () => {
  test('TCF v2 string is passed in ad requests', async () => {
    if (skip()) return;
    await (await driver.$('~TCFConsentToggle')).click();
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('tcf_consent_read');
  });

  test('no tracking when GDPR denied', async () => {
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
});

// ---------------------------------------------------------------------------
// Player Integration
// ---------------------------------------------------------------------------

describe('Shaka Android — Player Integration', () => {
  test('content resumes after ad completes', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('content_resumed'),
      { timeout: 60_000, interval: 2_000 },
    );
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('content_resumed');
  });

  test('seeking disabled during ad', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('seek_blocked');
  });
});
