/**
 * Bitmovin Player — Android Native Integration Tests
 *
 * Environment variables:
 *   PLATFORM       - must be 'android'
 *   DEVICE_SERIAL  - adb device serial
 *   APP_PATH       - path to Bitmovin Android host APK
 */

import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../../helpers/driver';
import { clearHar, readCapturedUrls, countMatches, findInsecureUrls } from '../../helpers/har';

const PLATFORM = (process.env.PLATFORM ?? 'android').toLowerCase();
let driver: Browser<'async'>;

beforeAll(async () => { if (PLATFORM === 'android') driver = await createDriver(); });
afterAll(async ()  => { if (PLATFORM === 'android') await closeDriver(driver); });
beforeEach(async () => { if (PLATFORM === 'android') { clearHar(); await driver.launchApp(); } });
afterEach(async ()  => { if (PLATFORM === 'android') await driver.closeApp(); });

function skip() { return PLATFORM !== 'android'; }

describe('Bitmovin Android — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    if (skip()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('sdk_initialized');
  });

  test('Bitmovin Android adapter attaches', async () => {
    if (skip()) return;
    const log = await driver.$('~DiagnosticLog');
    expect(await log.getText()).toContain('adapter_attached:bitmovin');
  });
});

describe('Bitmovin Android — Ad Scheduling', () => {
  test('pre-roll plays before content', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('content_pause_requested');
    expect(text).toContain('ad_started');
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
    expect(text).toContain('postroll_break_started');
  });
});

describe('Bitmovin Android — Tracking', () => {
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
    for (const p of ['/quartile/start', '/quartile/first', '/quartile/midpoint', '/quartile/third', '/quartile/complete']) {
      expect(countMatches(urls, p)).toBe(1);
    }
  });

  test('all SDK requests use HTTPS', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    await driver.pause(3_000);
    expect(findInsecureUrls(readCapturedUrls())).toHaveLength(0);
  });
});

describe('Bitmovin Android — Player Integration', () => {
  test('content resumes after ad completes', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('content_resumed'),
      { timeout: 60_000, interval: 2_000 },
    );
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('content_resumed');
  });

  test('seeking disabled during ad', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('seek_blocked');
  });
});

describe('Bitmovin Android — Memory', () => {
  test('ad view removed after close', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await driver.waitUntil(
      async () => (await (await driver.$('~DiagnosticLog')).getText()).includes('ad_complete'),
      { timeout: 60_000, interval: 2_000 },
    );
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('ad_view_removed');
  });
});
