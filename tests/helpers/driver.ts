/**
 * Shared WebdriverIO / Appium driver factory.
 *
 * Usage in a test file:
 *   import { createDriver, closeDriver } from '../helpers/driver';
 *   import type { Browser } from 'webdriverio';
 *
 *   let driver: Browser<'async'>;
 *
 *   beforeAll(async () => { driver = await createDriver(); });
 *   afterAll(async ()  => { await closeDriver(driver); });
 */

import { remote } from 'webdriverio';
import type { RemoteOptions, Browser } from 'webdriverio';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const PLATFORM      = (process.env.PLATFORM      ?? 'android').toLowerCase();
const APPIUM_HOST   = process.env.APPIUM_HOST     ?? '127.0.0.1';
const APPIUM_PORT   = parseInt(process.env.APPIUM_PORT ?? '4723', 10);
const APP_PATH      = process.env.APP_PATH        ?? '';
const DEVICE_UDID   = process.env.DEVICE_UDID     ?? '';
const DEVICE_SERIAL = process.env.DEVICE_SERIAL   ?? '';

// ---------------------------------------------------------------------------
// Capabilities per platform
// ---------------------------------------------------------------------------

function buildCapabilities(): WebdriverIO.Capabilities {
  switch (PLATFORM) {
    case 'ios':
      return {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': DEVICE_UDID,
        'appium:app': APP_PATH,
        'appium:noReset': false,
      };
    case 'tvos':
      return {
        platformName: 'tvOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': DEVICE_UDID,
        'appium:app': APP_PATH,
        'appium:noReset': false,
      };
    case 'android':
    default:
      return {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': DEVICE_SERIAL,
        'appium:app': APP_PATH,
        'appium:noReset': false,
      };
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Creates and returns a new WebdriverIO remote session pointing at the
 * Appium server defined by APPIUM_HOST / APPIUM_PORT.
 */
export async function createDriver(): Promise<Browser<'async'>> {
  const options: RemoteOptions = {
    hostname:    APPIUM_HOST,
    port:        APPIUM_PORT,
    path:        '/',
    capabilities: buildCapabilities(),
    logLevel:    'warn',
    connectionRetryTimeout: 120_000,
    connectionRetryCount:   3,
  };
  return remote(options);
}

/**
 * Terminates an existing WebdriverIO session gracefully.
 * Safe to call even if the session has already been closed.
 */
export async function closeDriver(driver: Browser<'async'>): Promise<void> {
  try {
    await driver.deleteSession();
  } catch {
    // Session may already be dead — ignore.
  }
}
