/**
 * Bitmovin Player — iOS Native Integration Tests
 *
 * Environment variables:
 *   PLATFORM    - must be 'ios'
 *   DEVICE_UDID - physical device UDID
 *   APP_PATH    - path to Bitmovin iOS host .ipa
 */

import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../../helpers/driver';
import { clearHar, readCapturedUrls, countMatches, findInsecureUrls } from '../../helpers/har';

const PLATFORM = (process.env.PLATFORM ?? 'ios').toLowerCase();
let driver: Browser<'async'>;

beforeAll(async () => { if (['ios', 'tvos'].includes(PLATFORM)) driver = await createDriver(); });
afterAll(async ()  => { if (['ios', 'tvos'].includes(PLATFORM)) await closeDriver(driver); });
beforeEach(async () => { if (['ios', 'tvos'].includes(PLATFORM)) { clearHar(); await driver.launchApp(); } });
afterEach(async ()  => { if (['ios', 'tvos'].includes(PLATFORM)) await driver.closeApp(); });

function skip() { return !['ios', 'tvos'].includes(PLATFORM); }

describe('Bitmovin iOS — Initialization', () => {
  test('SDK initialises with valid publisher ID', async () => {
    if (skip()) return;
    const log = await driver.$('~DiagnosticLog');
    await log.waitForDisplayed({ timeout: 10_000 });
    expect(await log.getText()).toContain('sdk_initialized');
  });

  test('Bitmovin iOS adapter attaches', async () => {
    if (skip()) return;
    expect(await (await driver.$('~DiagnosticLog')).getText()).toContain('adapter_attached:bitmovin');
  });
});

describe('Bitmovin iOS — ATT & Consent', () => {
  test('ATT dialog appears before first ad request', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    const attAlert = await driver.$('-ios predicate string:type == "XCUIElementTypeAlert"');
    await attAlert.waitForDisplayed({ timeout: 10_000 });
    await (await driver.$('-ios predicate string:label == "Allow"')).click();
    expect(await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 })).toBe(true);
  });

  test('no tracking when ATT denied', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    const attAlert = await driver.$('-ios predicate string:type == "XCUIElementTypeAlert"');
    await attAlert.waitForDisplayed({ timeout: 10_000 });
    await (await driver.$('-ios predicate string:label == "Ask App Not to Track"')).click();
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('consent_denied');
    expect(text).not.toContain('impression_pixel');
  });
});

describe('Bitmovin iOS — Ad Scheduling', () => {
  test('pre-roll plays before content', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
    const text = await (await driver.$('~DiagnosticLog')).getText();
    expect(text).toContain('content_pause_requested');
    expect(text).toContain('ad_started');
  });
});

describe('Bitmovin iOS — Tracking', () => {
  test('impression pixel fires exactly once', async () => {
    if (skip()) return;
    await (await driver.$('~LoadContentButton')).click();
    await (await driver.$('~AdContainer')).waitForDisplayed({ timeout: 20_000 });
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
});

describe('Bitmovin iOS — Memory', () => {
  test('SDK is deallocated after teardown', async () => {
    if (skip()) return;
    await (await driver.$('~SDKTeardownButton')).waitForDisplayed({ timeout: 10_000 });
    await (await driver.$('~SDKTeardownButton')).click();
    await driver.pause(2_000);
    expect((await (await driver.$('~DiagnosticLog')).getText())).toContain('sdk_deallocated');
  });
});
