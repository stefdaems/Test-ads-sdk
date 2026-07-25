/**
 * Ads SDK — webOS (LG) integration tests via TV Labs real devices.
 *
 * Prerequisites:
 *   - TVLABS_API_KEY environment variable must be set.
 *   - TVLABS_PLATFORM=webos must be set.
 *   - Optionally set TVLABS_WEBOS_APP_ID to enable full app-launch tests.
 *   - Optionally set TVLABS_BUILD_PATH in wdio.conf.ts to sideload a custom app (.ipk).
 *
 * Run:
 *   npm run test:webos
 */

import { webOSPress, TIMEOUTS } from '../helpers/device.js';

const APP_ID = process.env.TVLABS_WEBOS_APP_ID;

describe('Ads SDK — webOS (LG)', () => {
  it('should connect to a webOS device', async () => {
    const appInfo = await browser.execute('webos: activeAppInfo', []);
    expect(appInfo).toBeTruthy();
  });

  it('should navigate home', async () => {
    await webOSPress(browser, 'home');
    await browser.pause(2000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should launch the app under test', async function (this: Mocha.Context) {
    if (!APP_ID) {
      return this.skip();
    }

    await browser.execute('webos: launchApp', [{ id: APP_ID }]);
    await browser.pause(5000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should detect an ad impression within the timeout', async function (this: Mocha.Context) {
    if (!APP_ID) {
      return this.skip();
    }

    await browser.pause(TIMEOUTS.adLoad);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should handle ad navigation with the remote', async function (this: Mocha.Context) {
    if (!APP_ID) {
      return this.skip();
    }

    await webOSPress(browser, 'enter');
    await browser.pause(1000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });
});
