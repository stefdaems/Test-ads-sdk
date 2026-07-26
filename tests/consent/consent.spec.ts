/**
 * Initialization & Consent Tests
 *
 * Validates that the SDK:
 *   1. Reads user consent signals before making any ad request.
 *   2. Correctly blocks tracking payloads when consent is denied.
 *   3. Handles ATT (iOS) and GDPR / CCPA / TCF (global) flows.
 *
 * These tests must be run on a REAL device — simulators do not enforce ATT
 * dialogs.
 *
 * Environment variables expected:
 *   PLATFORM  - ios | android | tvos (controls which consent flows to exercise)
 */

import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../helpers/driver';

const PLATFORM = (process.env.PLATFORM ?? 'android').toLowerCase();

let driver: Browser<'async'>;

beforeAll(async () => {
  driver = await createDriver();
});

afterAll(async () => {
  await closeDriver(driver);
});

beforeEach(async () => {
  await driver.launchApp();
});

afterEach(async () => {
  await driver.closeApp();
});

// ---------------------------------------------------------------------------
// ATT (iOS / tvOS only)
// ---------------------------------------------------------------------------

describe('ATT (iOS / tvOS)', () => {
  test('should prompt for ATT before any ad request on iOS', async () => {
    if (!['ios', 'tvos'].includes(PLATFORM)) return;

    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.waitForDisplayed({ timeout: 10_000 });
    await loadAdButton.click();

    const attAlert = await driver.$('-ios predicate string:type == "XCUIElementTypeAlert"');
    await attAlert.waitForDisplayed({ timeout: 10_000 });

    const allowButton = await driver.$('-ios predicate string:label == "Allow"');
    await allowButton.click();

    const adContainer = await driver.$('~AdContainer');
    await expect(adContainer.waitForDisplayed({ timeout: 20_000 })).resolves.toBe(true);
  });

  test('should NOT fire tracking pixels when ATT is denied on iOS', async () => {
    if (!['ios', 'tvos'].includes(PLATFORM)) return;

    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const attAlert = await driver.$('-ios predicate string:type == "XCUIElementTypeAlert"');
    await attAlert.waitForDisplayed({ timeout: 10_000 });

    const dontAllowButton = await driver.$('-ios predicate string:label == "Ask App Not to Track"');
    await dontAllowButton.click();

    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).not.toContain('impression_pixel');
    expect(logText).not.toContain('click_pixel');
    expect(logText).toContain('consent_denied');
  });
});

// ---------------------------------------------------------------------------
// GDPR / TCF (Android)
// ---------------------------------------------------------------------------

describe('GDPR / TCF (Android)', () => {
  test('should read a valid TCF v2 consent string before ad request', async () => {
    if (PLATFORM !== 'android') return;

    const tcfToggle = await driver.$('~TCFConsentToggle');
    await tcfToggle.waitForDisplayed({ timeout: 10_000 });
    await tcfToggle.click();

    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    const diagnosticLog = await driver.$('~DiagnosticLog');
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('tcf_consent_read');
  });

  test('should drop tracking payloads when GDPR consent is denied', async () => {
    if (PLATFORM !== 'android') return;

    const tcfToggle = await driver.$('~TCFConsentToggle');
    await tcfToggle.waitForDisplayed({ timeout: 10_000 });
    // Leave toggle OFF (no consent).

    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 15_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('consent_denied');
    expect(logText).not.toContain('impression_pixel');
  });
});

// ---------------------------------------------------------------------------
// CCPA (Android + iOS)
// ---------------------------------------------------------------------------

describe('CCPA', () => {
  test('should honour CCPA opt-out and suppress sale-related tracking', async () => {
    const ccpaToggle = await driver.$('~CCPAOptOutToggle');
    await ccpaToggle.waitForDisplayed({ timeout: 10_000 });
    await ccpaToggle.click();

    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 15_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('ccpa_opt_out');
    expect(logText).not.toContain('sale_tracking');
  });
});

// ---------------------------------------------------------------------------
// Bad host — double init
// ---------------------------------------------------------------------------

describe('Bad host scenarios', () => {
  test('should not crash or duplicate requests when initialized twice', async () => {
    await driver.execute('mobile: deepLink', {
      url: 'adsdk://bad-host/double-init',
      package: process.env.BAD_APP_BUNDLE_ID,
    });

    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 15_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('already_initialized');
    expect(logText).not.toContain('FATAL');
    expect(logText).not.toContain('crash');
  });
});
