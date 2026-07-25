/**
 * Memory Teardown Tests
 *
 * Validates that the SDK does not retain memory after an ad is destroyed.
 * Publishers will remove your SDK from their apps if it causes noticeable
 * memory growth or if background threads are left running after teardown.
 *
 * These tests verify observable side-effects surfaced by the host app's
 * diagnostic log. Detailed heap profiling must be done separately with:
 *   - iOS:     Xcode Instruments (Leaks / Allocations)
 *   - Android: Android Studio Memory Profiler
 *
 * Environment variables:
 *   PLATFORM  - ios | android | tvos
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
// Ad view teardown
// ---------------------------------------------------------------------------

describe('Ad view teardown', () => {
  test('should remove the ad view from its parent after the ad is closed', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.waitForDisplayed({ timeout: 10_000 });
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    // Dismiss the ad via the host app's close button.
    const closeAdButton = await driver.$('~CloseAdButton');
    await closeAdButton.waitForDisplayed({ timeout: 10_000 });
    await closeAdButton.click();

    await driver.pause(1_000);

    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('ad_view_removed');
    expect(logText).not.toContain('view_retained');
  });

  test('should kill all SDK background threads after ad teardown', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    const closeAdButton = await driver.$('~CloseAdButton');
    await closeAdButton.click();

    await driver.pause(2_000);

    const diagnosticLog = await driver.$('~DiagnosticLog');
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('threads_terminated');
    expect(logText).not.toContain('thread_leaked');
  });
});

// ---------------------------------------------------------------------------
// Rapid ad reload — memory leak detection
// ---------------------------------------------------------------------------

describe('Rapid ad reload', () => {
  test('should not grow memory unboundedly after 10 sequential ad loads', async () => {
    const RELOAD_COUNT = 10;

    for (let i = 0; i < RELOAD_COUNT; i++) {
      const loadAdButton = await driver.$('~LoadAdButton');
      await loadAdButton.waitForDisplayed({ timeout: 10_000 });
      await loadAdButton.click();

      const adContainer = await driver.$('~AdContainer');
      await adContainer.waitForDisplayed({ timeout: 20_000 });

      const closeAdButton = await driver.$('~CloseAdButton');
      await closeAdButton.waitForDisplayed({ timeout: 10_000 });
      await closeAdButton.click();

      await driver.pause(500);
    }

    // The host app exposes the memory delta via its diagnostic log.
    // A delta above 50 MB after 10 cycles is considered a leak.
    const diagnosticLog = await driver.$('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10_000 });
    const logText = await diagnosticLog.getText();

    expect(logText).not.toContain('memory_leak_detected');

    const memDeltaMatch = logText.match(/memory_delta_mb:(\d+)/);
    if (memDeltaMatch) {
      const deltaMb = parseInt(memDeltaMatch[1], 10);
      expect(deltaMb).toBeLessThan(50);
    }
  });
});

// ---------------------------------------------------------------------------
// SDK teardown between sessions
// ---------------------------------------------------------------------------

describe('SDK session teardown', () => {
  test('should allow re-initialisation after explicit SDK teardown', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    const closeAdButton = await driver.$('~CloseAdButton');
    await closeAdButton.click();

    // Trigger SDK teardown via a host app button.
    const sdkTeardownButton = await driver.$('~SDKTeardownButton');
    await sdkTeardownButton.waitForDisplayed({ timeout: 10_000 });
    await sdkTeardownButton.click();

    await driver.pause(1_000);

    // Re-initialise and load a new ad — must not crash.
    const sdkInitButton = await driver.$('~SDKInitButton');
    await sdkInitButton.waitForDisplayed({ timeout: 10_000 });
    await sdkInitButton.click();

    await loadAdButton.click();

    const newAdContainer = await driver.$('~AdContainer');
    await expect(newAdContainer.waitForDisplayed({ timeout: 20_000 })).resolves.toBe(true);

    const diagnosticLog = await driver.$('~DiagnosticLog');
    const logText = await diagnosticLog.getText();

    expect(logText).not.toContain('FATAL');
    expect(logText).not.toContain('crash');
  });

  test('should not retain memory after full SDK teardown on iOS', async () => {
    if (PLATFORM !== 'ios') return;

    const sdkTeardownButton = await driver.$('~SDKTeardownButton');
    await sdkTeardownButton.waitForDisplayed({ timeout: 10_000 });
    await sdkTeardownButton.click();

    await driver.pause(2_000);

    const diagnosticLog = await driver.$('~DiagnosticLog');
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('sdk_deallocated');
  });
});
