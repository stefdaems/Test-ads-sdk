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
const APP_PATH      = process.env.APP_PATH        ?? '';
const DEVICE_UDID   = process.env.DEVICE_UDID     ?? '';
const DEVICE_SERIAL = process.env.DEVICE_SERIAL   ?? '';

// TV Labs — when TVLABS_API_KEY is set the driver routes through appium.tvlabs.ai
const TVLABS_API_KEY    = process.env.TVLABS_API_KEY    ?? '';
const TVLABS_BUILD_ID   = process.env.TVLABS_BUILD_ID   ?? '';
const TVLABS_PLATFORM   = process.env.TVLABS_PLATFORM   ?? '';  // e.g. 'roku', 'webos', 'tizen', 'android'
const TVLABS_MAKE       = process.env.TVLABS_MAKE        ?? '';
const TVLABS_MODEL      = process.env.TVLABS_MODEL       ?? '';
const TVLABS_DEVICE_TYPE = process.env.TVLABS_DEVICE_TYPE ?? ''; // 'tv' | 'stb' | 'mobile'

const IS_TVLABS = TVLABS_API_KEY !== '';

// Fall back to direct Appium when not using TV Labs
const APPIUM_HOST = IS_TVLABS ? 'appium.tvlabs.ai' : (process.env.APPIUM_HOST ?? '127.0.0.1');
const APPIUM_PORT = IS_TVLABS ? 4723               : parseInt(process.env.APPIUM_PORT ?? '4723', 10);

// ---------------------------------------------------------------------------
// Capabilities per platform
// ---------------------------------------------------------------------------

function buildCapabilities(): WebdriverIO.Capabilities {
  let caps: WebdriverIO.Capabilities;

  switch (PLATFORM) {
    case 'ios':
      caps = {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': DEVICE_UDID,
        'appium:app': APP_PATH,
        'appium:noReset': false,
      };
      break;
    case 'tvos':
      caps = {
        platformName: 'tvOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': DEVICE_UDID,
        'appium:app': APP_PATH,
        'appium:noReset': false,
      };
      break;
    case 'android':
    default:
      caps = {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': DEVICE_SERIAL,
        'appium:app': APP_PATH,
        'appium:noReset': false,
      };
      break;
  }

  if (IS_TVLABS) {
    // Associate the session with the uploaded build artifact
    if (TVLABS_BUILD_ID) {
      (caps as Record<string, unknown>)['tvlabs:build'] = TVLABS_BUILD_ID;
    }

    // Device targeting constraints
    const constraints: Record<string, unknown> = {};
    if (TVLABS_PLATFORM)    constraints.platform_key = TVLABS_PLATFORM;
    if (TVLABS_MAKE)        constraints.make         = TVLABS_MAKE;
    if (TVLABS_MODEL)       constraints.model        = TVLABS_MODEL;
    if (TVLABS_DEVICE_TYPE) constraints.device_type  = TVLABS_DEVICE_TYPE;
    if (Object.keys(constraints).length > 0) {
      (caps as Record<string, unknown>)['tvlabs:constraints'] = constraints;
    }
  }

  return caps;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Creates and returns a new WebdriverIO remote session pointing at the
 * Appium server defined by APPIUM_HOST / APPIUM_PORT.
 *
 * When TVLABS_API_KEY is set the session is routed through appium.tvlabs.ai
 * and the Authorization header is added automatically.
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

  if (IS_TVLABS) {
    options.headers = { Authorization: `****** };
  }

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
