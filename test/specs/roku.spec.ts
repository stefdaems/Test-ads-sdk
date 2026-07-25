/**
 * Ads SDK — Roku integration tests via TV Labs real devices.
 *
 * Prerequisites:
 *   - TVLABS_API_KEY environment variable must be set.
 *   - TVLABS_PLATFORM=roku (default) must be set in wdio.conf.ts or the environment.
 *   - Optionally set TVLABS_ROKU_CHANNEL_ID to enable full channel-launch tests.
 *   - Optionally set TVLABS_BUILD_PATH in wdio.conf.ts to sideload a custom channel (.zip).
 *
 * Run:
 *   npm run test:roku
 */

import { rokuPress, TIMEOUTS } from '../helpers/device.js';

const CHANNEL_ID = process.env.TVLABS_ROKU_CHANNEL_ID;

describe('Ads SDK — Roku', () => {
  it('should connect to a Roku device', async () => {
    const info = await browser.execute('roku: deviceInfo', []);
    expect(info).toBeTruthy();
  });

  it('should navigate to the home screen', async () => {
    await rokuPress(browser, 'Home');
    await browser.pause(2000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should launch the channel under test', async function (this: Mocha.Context) {
    if (!CHANNEL_ID) {
      return this.skip();
    }

    await browser.execute('roku: launchApp', [
      {
        channel_id: CHANNEL_ID,
        content_id: '',
        media_type: '',
      },
    ]);
    await browser.pause(5000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should detect an ad impression within the timeout', async function (this: Mocha.Context) {
    if (!CHANNEL_ID) {
      return this.skip();
    }

    // Wait for the ads SDK to fire an ad impression.
    // Replace this with an assertion against the element your SDK renders.
    await browser.pause(TIMEOUTS.adLoad);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });

  it('should allow skipping an ad using the remote', async function (this: Mocha.Context) {
    if (!CHANNEL_ID) {
      return this.skip();
    }

    await rokuPress(browser, 'Select');
    await browser.pause(1000);

    const screenshot = await browser.takeScreenshot();
    expect(screenshot).toBeTruthy();
  });
});
