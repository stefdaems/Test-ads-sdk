/**
 * Shared helpers and constants for TV Labs device tests.
 */

import type { TVLabsCapabilities } from '@tvlabs/wdio-service';

/** Default timeouts (ms) */
export const TIMEOUTS = {
  /** How long to wait for a UI element to appear */
  element: 15_000,
  /** How long to wait for an ad to load and play */
  adLoad: 30_000,
  /** How long TV Labs may take to match a device */
  deviceMatch: 120_000,
};

/** Common capability defaults applied to every device config */
export const BASE_CAPS: Partial<TVLabsCapabilities> = {
  'tvlabs:match_timeout': TIMEOUTS.deviceMatch,
  'tvlabs:device_timeout': 600_000,
};

/**
 * Build a set of TV Labs capabilities for a Roku device.
 *
 * @param overrides - Extra or overriding capability fields.
 */
export function rokuCapabilities(
  overrides: Partial<TVLabsCapabilities> = {},
): TVLabsCapabilities {
  return {
    ...BASE_CAPS,
    'tvlabs:constraints': {
      platform_key: 'roku',
    },
    ...overrides,
  };
}

/**
 * Build a set of TV Labs capabilities for a webOS (LG) device.
 *
 * @param overrides - Extra or overriding capability fields.
 */
export function webOSCapabilities(
  overrides: Partial<TVLabsCapabilities> = {},
): TVLabsCapabilities {
  return {
    ...BASE_CAPS,
    'tvlabs:constraints': {
      platform_key: 'webos',
      make: 'LG',
    },
    ...overrides,
  };
}

/**
 * Build a set of TV Labs capabilities for a Fire TV (Android) device.
 *
 * @param overrides - Extra or overriding capability fields.
 */
export function fireTVCapabilities(
  overrides: Partial<TVLabsCapabilities> = {},
): TVLabsCapabilities {
  return {
    ...BASE_CAPS,
    'tvlabs:constraints': {
      platform_key: 'android',
      device_type: 'tv',
      make: 'Amazon',
    },
    ...overrides,
  };
}

/**
 * Press a Roku remote key and wait briefly for the UI to react.
 *
 * @param driver - Active WebdriverIO remote instance.
 * @param key    - Roku key name (e.g. 'Up', 'Down', 'Select', 'Back').
 */
export async function rokuPress(
  driver: WebdriverIO.Browser,
  key: string,
): Promise<void> {
  await driver.execute('roku: pressKey', [{ key }]);
  await driver.pause(500);
}

/**
 * Press a webOS remote key and wait briefly for the UI to react.
 *
 * @param driver - Active WebdriverIO remote instance.
 * @param key    - webOS key name (e.g. 'up', 'down', 'enter', 'back').
 */
export async function webOSPress(
  driver: WebdriverIO.Browser,
  key: string,
): Promise<void> {
  await driver.execute('webos: pressKey', [{ key }]);
  await driver.pause(500);
}
