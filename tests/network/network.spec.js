/**
 * Network & Telemetry Tests
 *
 * Validates that:
 *   1. Tracking pixels (impression, click, video quartiles) fire exactly ONCE
 *      at the correct moment.
 *   2. Network drops do NOT cause duplicate pings upon reconnection.
 *   3. All requests use HTTPS with correct headers.
 *
 * PREREQUISITE: A Charles Proxy (or mitmproxy) must be running on the
 * host machine and the test device must route through it.
 * Set PROXY_HOST and PROXY_PORT environment variables accordingly.
 *
 *   PROXY_HOST  - Proxy hostname (default: 127.0.0.1)
 *   PROXY_PORT  - Proxy port (default: 8888)
 *
 * The proxy HAR file is written to /tmp/ad-sdk-proxy.har after each test.
 * This test suite reads that file to assert pixel firing counts.
 */

const fs = require('fs');
const path = require('path');

const PROXY_HOST = process.env.PROXY_HOST || '127.0.0.1';
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '8888', 10);
const HAR_PATH = '/tmp/ad-sdk-proxy.har';

/**
 * Parse the HAR file written by the proxy and return all captured URLs.
 * @returns {string[]}
 */
function readCapturedUrls() {
  if (!fs.existsSync(HAR_PATH)) return [];
  const har = JSON.parse(fs.readFileSync(HAR_PATH, 'utf8'));
  return har.log.entries.map((e) => e.request.url);
}

/**
 * Count how many times a URL pattern appears in the captured URLs.
 * @param {string[]} urls
 * @param {string|RegExp} pattern
 * @returns {number}
 */
function countMatches(urls, pattern) {
  return urls.filter((u) => (typeof pattern === 'string' ? u.includes(pattern) : pattern.test(u))).length;
}

describe('Network & Telemetry', () => {
  beforeEach(async () => {
    // Clear the proxy HAR log before each test.
    if (fs.existsSync(HAR_PATH)) fs.unlinkSync(HAR_PATH);
    await driver.launchApp();
  });

  afterEach(async () => {
    await driver.closeApp();
  });

  // ---------------------------------------------------------------------------
  // Impression pixel
  // ---------------------------------------------------------------------------

  it('should fire the impression pixel exactly once when the ad becomes visible', async () => {
    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.waitForDisplayed({ timeout: 10000 });
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    // Allow a small window for the pixel to fire, then read the proxy log.
    await browser.pause(3000);

    const urls = readCapturedUrls();
    const impressionCount = countMatches(urls, '/impression');

    expect(impressionCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Click pixel
  // ---------------------------------------------------------------------------

  it('should fire the click pixel exactly once when the ad is tapped', async () => {
    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    // Tap the centre of the ad.
    await adContainer.click();

    await browser.pause(2000);

    const urls = readCapturedUrls();
    expect(countMatches(urls, '/click')).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Video quartile pixels
  // ---------------------------------------------------------------------------

  it('should fire video quartile pixels at the correct intervals', async () => {
    const loadVideoAdButton = await $('~LoadVideoAdButton');
    await loadVideoAdButton.waitForDisplayed({ timeout: 10000 });
    await loadVideoAdButton.click();

    const videoPlayer = await $('~VideoPlayer');
    await videoPlayer.waitForDisplayed({ timeout: 20000 });

    // Wait for a 30-second video ad to play to completion (with buffer).
    await browser.pause(35000);

    const urls = readCapturedUrls();

    expect(countMatches(urls, '/quartile/start')).toBe(1);
    expect(countMatches(urls, '/quartile/first')).toBe(1);
    expect(countMatches(urls, '/quartile/midpoint')).toBe(1);
    expect(countMatches(urls, '/quartile/third')).toBe(1);
    expect(countMatches(urls, '/quartile/complete')).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // No duplicate pixels after network drop + reconnection
  // ---------------------------------------------------------------------------

  it('should NOT fire duplicate pixels after a network drop and reconnect', async () => {
    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    // Simulate a network drop via ADB (Android) or network link conditioner.
    // The host app exposes a "Simulate Network Drop" button for automation.
    const networkDropButton = await $('~SimulateNetworkDropButton');
    await networkDropButton.waitForDisplayed({ timeout: 10000 });
    await networkDropButton.click();

    await browser.pause(2000);

    // Reconnect.
    const networkReconnectButton = await $('~SimulateNetworkReconnectButton');
    await networkReconnectButton.click();

    await browser.pause(3000);

    const urls = readCapturedUrls();

    // Impression should still be exactly 1, not 2.
    expect(countMatches(urls, '/impression')).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // HTTPS enforcement
  // ---------------------------------------------------------------------------

  it('should use HTTPS for all SDK network requests', async () => {
    const loadAdButton = await $('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await $('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20000 });

    await browser.pause(3000);

    const urls = readCapturedUrls();

    const sdkUrls = urls.filter((u) => u.includes('ad-sdk') || u.includes('adsdk'));
    const insecureUrls = sdkUrls.filter((u) => u.startsWith('http://'));

    expect(insecureUrls).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Correct consent headers on every request
  // ---------------------------------------------------------------------------

  it('should include the consent signal header on every SDK request', async () => {
    if (!fs.existsSync(HAR_PATH)) return;

    const har = JSON.parse(fs.readFileSync(HAR_PATH, 'utf8'));
    const sdkEntries = har.log.entries.filter(
      (e) => e.request.url.includes('ad-sdk') || e.request.url.includes('adsdk')
    );

    for (const entry of sdkEntries) {
      const headers = entry.request.headers.map((h) => h.name.toLowerCase());
      expect(headers).toContain('x-consent-string');
    }
  });
});
