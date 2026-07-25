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

describe('Viewability & Rendering', () => {
  beforeEach(async () => {
    await driver.launchApp();
  });

  afterEach(async () => {
    await driver.closeApp();
  });

  // ---------------------------------------------------------------------------
  // Ad visibility
  // ---------------------------------------------------------------------------

  it('should display the ad container in the visible viewport', async () => {
    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.waitForDisplayed({ timeout: 10000 });
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    const isDisplayed = await adContainer.isDisplayedInViewport();
    expect(isDisplayed).toBe(true);
  });

  it('should NOT have a transparent overlay blocking the ad click target', async () => {
    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    // Attempt to click the ad. If an overlay is blocking it, the diagnostic log
    // will not contain 'click_registered'.
    await adContainer.click();

    const diagnosticLog = await $('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('click_registered');
  });

  // ---------------------------------------------------------------------------
  // Background / foreground lifecycle
  // ---------------------------------------------------------------------------

  it('should pause video playback when the app enters the background', async () => {
    const loadVideoAdButton = await $('~LoadVideoAdButton');
    await loadVideoAdButton.waitForDisplayed({ timeout: 10000 });
    await loadVideoAdButton.click();

    const videoPlayer = await $('~VideoPlayer');
    await videoPlayer.waitForDisplayed({ timeout: 20000 });

    // Wait briefly so the video is playing.
    await browser.pause(3000);

    // Send the app to the background.
    await driver.background(-1); // -1 = stay in background indefinitely

    await browser.pause(2000);

    // Bring the app back to the foreground.
    await driver.activate(driver.getCurrentPackage ? await driver.getCurrentPackage() : process.env.APP_BUNDLE_ID);

    const diagnosticLog = await $('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10000 });
    const logText = await diagnosticLog.getText();

    expect(logText).toContain('video_paused');
    expect(logText).toContain('video_resumed');
    // Confirm no false completion event was fired during the background period.
    expect(logText).not.toContain('false_complete');
  });

  it('should not fire a completion event when ad is backgrounded before it ends', async () => {
    const loadVideoAdButton = await $('~LoadVideoAdButton');
    await loadVideoAdButton.click();

    const videoPlayer = await $('~VideoPlayer');
    await videoPlayer.waitForDisplayed({ timeout: 20000 });

    // Background immediately.
    await driver.background(3); // 3 seconds in background

    const diagnosticLog = await $('~DiagnosticLog');
    await diagnosticLog.waitForDisplayed({ timeout: 10000 });
    const logText = await diagnosticLog.getText();

    expect(logText).not.toContain('/quartile/complete');
  });

  // ---------------------------------------------------------------------------
  // Orientation changes
  // ---------------------------------------------------------------------------

  it('should handle portrait-to-landscape orientation without breaking layout', async function () {
    if (process.env.PLATFORM === 'tvos') return this.skip(); // tvOS has no orientation

    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    // Rotate to landscape.
    await driver.setOrientation('LANDSCAPE');
    await browser.pause(1000);

    const isDisplayedLandscape = await adContainer.isDisplayedInViewport();
    expect(isDisplayedLandscape).toBe(true);

    // Rotate back.
    await driver.setOrientation('PORTRAIT');
    await browser.pause(1000);

    const isDisplayedPortrait = await adContainer.isDisplayedInViewport();
    expect(isDisplayedPortrait).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // CTV / tvOS — D-Pad navigation and focus trap prevention
  // ---------------------------------------------------------------------------

  it('should not trap focus inside the ad on tvOS (user can navigate out)', async function () {
    if (process.env.PLATFORM !== 'tvos') return this.skip();

    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    // Simulate pressing the Menu / Back button.
    await driver.execute('mobile: pressButton', { name: 'Menu' });

    await browser.pause(1000);

    // After pressing Menu the ad should be dismissed and focus should return
    // to the host app's main navigation element.
    const mainNav = await $('~MainNavigationElement');
    const isFocused = await mainNav.isFocused();
    expect(isFocused).toBe(true);
  });

  it('should respond to D-Pad select on tvOS ad interactive element', async function () {
    if (process.env.PLATFORM !== 'tvos') return this.skip();

    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    // Press Select (centre D-Pad) to activate the CTA inside the ad.
    await driver.execute('mobile: pressButton', { name: 'Select' });

    await browser.pause(1000);

    const diagnosticLog = await $('~DiagnosticLog');
    const logText = await diagnosticLog.getText();
    expect(logText).toContain('click_registered');
  });
});
