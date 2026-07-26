/**
 * Viewability & Rendering Tests
 *
 * Validates that:
 *   1. The ad is fully visible and not obscured by host-app elements.
 *   2. The ad correctly pauses when the host app moves to the background.
 *   3. The ad resumes correctly when the host app returns to the foreground.
 *   4. Click / tap targets are not blocked by transparent overlays.
 *   5. Orientation changes are handled without layout breakage.
 *   6. CTV / tvOS D-Pad navigation works and does NOT create focus traps.
 */

import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../helpers/driver';

const PLATFORM = (process.env.PLATFORM ?? 'android').toLowerCase();
const APP_BUNDLE_ID = process.env.APP_BUNDLE_ID ?? '';

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
// Ad visibility
// ---------------------------------------------------------------------------

describe('Ad visibility', () => {
  test('should display the ad container in the visible viewport', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.waitForDisplayed({ timeout: 10_000 });
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    expect(await adContainer.isDisplayedInViewport()).toBe(true);
  });

  test('should NOT have a transparent overlay blocking the ad click target', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    await adContainer.click();

    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('click_registered');
  });
});

// ---------------------------------------------------------------------------
// Background / foreground lifecycle
// ---------------------------------------------------------------------------

describe('Background / foreground lifecycle', () => {
  test('should pause video playback when the app enters the background', async () => {
    const loadVideoAdButton = await driver.$('~LoadVideoAdButton');
    await loadVideoAdButton.waitForDisplayed({ timeout: 10_000 });
    await loadVideoAdButton.click();

    const videoPlayer = await driver.$('~VideoPlayer');
    await videoPlayer.waitForDisplayed({ timeout: 20_000 });

    await driver.pause(3_000);

    // -1 = stay in background indefinitely.
    await driver.background(-1);
    await driver.pause(2_000);

    await driver.activate(APP_BUNDLE_ID || (await driver.getCurrentPackage?.() ?? ''));

    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('video_paused');
    expect(logText).toContain('video_resumed');
    expect(logText).not.toContain('false_complete');
  });

  test('should not fire a completion event when ad is backgrounded before it ends', async () => {
    const loadVideoAdButton = await driver.$('~LoadVideoAdButton');
    await loadVideoAdButton.click();

    const videoPlayer = await driver.$('~VideoPlayer');
    await videoPlayer.waitForDisplayed({ timeout: 20_000 });

    await driver.background(3);

    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).not.toContain('/quartile/complete');
  });
});

// ---------------------------------------------------------------------------
// Orientation changes
// ---------------------------------------------------------------------------

describe('Orientation changes', () => {
  test('should handle portrait-to-landscape orientation without breaking layout', async () => {
    if (PLATFORM === 'tvos') return; // tvOS has no orientation.

    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    await driver.setOrientation('LANDSCAPE');
    await driver.pause(1_000);
    expect(await adContainer.isDisplayedInViewport()).toBe(true);

    await driver.setOrientation('PORTRAIT');
    await driver.pause(1_000);
    expect(await adContainer.isDisplayedInViewport()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CTV / tvOS — D-Pad navigation and focus trap prevention
// ---------------------------------------------------------------------------

describe('CTV / tvOS D-Pad navigation', () => {
  test('should not trap focus inside the ad on tvOS (user can navigate out)', async () => {
    if (PLATFORM !== 'tvos') return;

    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    await driver.execute('mobile: pressButton', { name: 'Menu' });
    await driver.pause(1_000);

    const mainNav = await driver.$('~MainNavigationElement');
    expect(await mainNav.isFocused()).toBe(true);
  });

  test('should respond to D-Pad select on tvOS ad interactive element', async () => {
    if (PLATFORM !== 'tvos') return;

    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    await driver.execute('mobile: pressButton', { name: 'Select' });
    await driver.pause(1_000);

    const diagnosticLog = await driver.$('~DiagnosticLog');
    const logText = await diagnosticLog.getText();
    expect(logText).toContain('click_registered');
  });
});
