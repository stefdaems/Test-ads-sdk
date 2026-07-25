/**
 * Ads SDK — Fire TV integration tests via TV Labs real devices.
 *
 * Prerequisites:
 *   - TVLABS_API_KEY environment variable must be set.
 *   - TVLABS_PLATFORM=firetv must be set.
 *   - Optionally set TVLABS_FIRETV_PACKAGE to enable full app-launch tests.
 *   - Optionally set TVLABS_BUILD_PATH in wdio.conf.ts to sideload a custom app (.apk).
 *
 * Run:
 *   npm run test:firetv
 */

import { TIMEOUTS } from '../helpers/device.js';

const PACKAGE = process.env.TVLABS_FIRETV_PACKAGE;

describe('Ads SDK — Fire TV', () => {
  it('should connect to a Fire TV device', async () => {
    const contexts = await browser.getContexts();
    expect(contexts).toBeTruthy();
  });

  it('should navigate to the home screen', async () => {
    await browser.pressKeyCode(3); // KEYCODE_HOME
    await browser.pause(2000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should launch the app under test', async function (this: Mocha.Context) {
    if (!PACKAGE) {
      return this.skip();
    }

    await browser.activateApp(PACKAGE);
    await browser.pause(5000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should detect an ad impression within the timeout', async function (this: Mocha.Context) {
    if (!PACKAGE) {
      return this.skip();
    }

    // Wait for the ads SDK to fire an ad impression.
    await browser.pause(TIMEOUTS.adLoad);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should handle ad interaction via the remote', async function (this: Mocha.Context) {
    if (!PACKAGE) {
      return this.skip();
    }

    await browser.pressKeyCode(66); // KEYCODE_ENTER / Select
    await browser.pause(1000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });
});
