/**
 * Initialization & Consent Tests
 *
 * Validates that the SDK:
 *   1. Reads user consent signals before making any ad request.
 *   2. Correctly blocks tracking payloads when consent is denied.
 *   3. Handles ATT (iOS) and GDPR/CCPA/TCF (global) flows.
 *
 * These tests must be run on a REAL device — simulators do not enforce ATT dialogs.
 *
 * Environment variables expected:
 *   PLATFORM  - ios | android | tvos (controls which consent flows to exercise)
 */

describe('Initialization & Consent', () => {
  beforeEach(async () => {
    // Start from the host app home screen before each test.
    await driver.launchApp();
  });

  afterEach(async () => {
    // Terminate the app to reset SDK state between tests.
    await driver.closeApp();
  });

  // ---------------------------------------------------------------------------
  // ATT (iOS / tvOS only)
  // ---------------------------------------------------------------------------

  it('should prompt for ATT before any ad request on iOS', async function () {
    if (!['ios', 'tvos'].includes(process.env.PLATFORM)) return this.skip();

    // Tap the "Load Ad" button — ATT dialog should appear first.
    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.waitForDisplayed({ timeout: 10000 });
    await loadAdButton.click();

    // Expect the system ATT alert to appear.
    const attAlert = await $('-ios predicate string:type == "XCUIElementTypeAlert"');
    await attAlert.waitForDisplayed({ timeout: 10000 });

    // Allow tracking and verify an ad request is made.
    const allowButton = await $('-ios predicate string:label == "Allow"');
    await allowButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });
  });

  it('should NOT fire tracking pixels when ATT is denied on iOS', async function () {
    if (!['ios', 'tvos'].includes(process.env.PLATFORM)) return this.skip();

    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const attAlert = await $('-ios predicate string:type == "XCUIElementTypeAlert"');
    await attAlert.waitForDisplayed({ timeout: 10000 });

    // Deny tracking.
    const dontAllowButton = await $('-ios predicate string:label == "Ask App Not to Track"');
    await dontAllowButton.click();

    // Read the SDK diagnostic log exposed by the Good host app.
    const diagnosticLog = await $('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10000 });
    const logText = await diagnosticLog.getText();

    expect(logText).not.toContain('impression_pixel');
    expect(logText).not.toContain('click_pixel');
    expect(logText).toContain('consent_denied');
  });

  // ---------------------------------------------------------------------------
  // GDPR / TCF (Android + global)
  // ---------------------------------------------------------------------------

  it('should read a valid TCF v2 consent string before ad request on Android', async function () {
    if (process.env.PLATFORM !== 'android') return this.skip();

    // The Good host app pre-populates IABTCF_TCString in SharedPreferences.
    const tcfToggle = await $('~TCFConsentToggle');
    await tcfToggle.waitForDisplayed({ timeout: 10000 });
    await tcfToggle.click(); // turns on full consent

    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    const diagnosticLog = await $('~DiagnosticLog');
    const logText = await diagnosticLog.getText();
    expect(logText).toContain('tcf_consent_read');
  });

  it('should drop tracking payloads when GDPR consent is denied', async function () {
    if (process.env.PLATFORM !== 'android') return this.skip();

    // Deny all GDPR purposes via the host app consent toggle.
    const tcfToggle = await $('~TCFConsentToggle');
    await tcfToggle.waitForDisplayed({ timeout: 10000 });
    // Leave toggle OFF (no consent)

    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const diagnosticLog = await $('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 15000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('consent_denied');
    expect(logText).not.toContain('impression_pixel');
  });

  // ---------------------------------------------------------------------------
  // CCPA (Android + iOS)
  // ---------------------------------------------------------------------------

  it('should honour CCPA opt-out and suppress sale-related tracking', async () => {
    const ccpaToggle = await $('~CCPAOptOutToggle');
    await ccpaToggle.waitForDisplayed({ timeout: 10000 });
    await ccpaToggle.click(); // opt out

    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const diagnosticLog = await $('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 15000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('ccpa_opt_out');
    expect(logText).not.toContain('sale_tracking');
  });

  // ---------------------------------------------------------------------------
  // Bad host — double init
  // ---------------------------------------------------------------------------

  it('should not crash or duplicate requests when initialized twice', async () => {
    // Switch to the Bad host app scenario via an app-level deep link or flag.
    await driver.execute('mobile: deepLink', {
      url: 'adsdk://bad-host/double-init',
      package: process.env.BAD_APP_BUNDLE_ID,
    });

    const diagnosticLog = await $('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 15000 });
    const logText = await diagnosticLog.getText();

    // SDK must log a warning but must NOT have crashed.
    expect(logText).toContain('already_initialized');
    expect(logText).not.toContain('FATAL');
    expect(logText).not.toContain('crash');
  });
});
