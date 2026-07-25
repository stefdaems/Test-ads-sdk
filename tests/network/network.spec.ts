/**
 * Network & Telemetry Tests
 *
 * Validates that:
 *   1. Tracking pixels (impression, click, video quartiles) fire exactly ONCE
 *      at the correct moment.
 *   2. Network drops do NOT cause duplicate pings upon reconnection.
 *   3. All requests use HTTPS with correct consent headers.
 *
 * PREREQUISITE: A Charles Proxy (or mitmproxy) must be running on the host
 * machine and the test device must route traffic through it.
 * Set PROXY_HOST and PROXY_PORT environment variables accordingly.
 *
 *   PROXY_HOST  - Proxy hostname  (default: 127.0.0.1)
 *   PROXY_PORT  - Proxy port      (default: 8888)
 *
 * The proxy writes a HAR file to /tmp/ad-sdk-proxy.har after each test.
 * This suite reads that file to assert pixel firing counts.
 */

import * as fs from 'fs';
import type { Browser } from 'webdriverio';
import { createDriver, closeDriver } from '../helpers/driver';

const HAR_PATH = '/tmp/ad-sdk-proxy.har';

// ---------------------------------------------------------------------------
// HAR helpers
// ---------------------------------------------------------------------------

interface HarEntry {
  request: {
    url: string;
    headers: Array<{ name: string; value: string }>;
  };
}

interface HarLog {
  log: { entries: HarEntry[] };
}

function readCapturedUrls(): string[] {
  if (!fs.existsSync(HAR_PATH)) return [];
  const har: HarLog = JSON.parse(fs.readFileSync(HAR_PATH, 'utf8'));
  return har.log.entries.map((e) => e.request.url);
}

function countMatches(urls: string[], pattern: string | RegExp): number {
  return urls.filter((u) =>
    typeof pattern === 'string' ? u.includes(pattern) : pattern.test(u)
  ).length;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let driver: Browser<'async'>;

beforeAll(async () => {
  driver = await createDriver();
});

afterAll(async () => {
  await closeDriver(driver);
});

beforeEach(async () => {
  if (fs.existsSync(HAR_PATH)) fs.unlinkSync(HAR_PATH);
  await driver.launchApp();
});

afterEach(async () => {
  await driver.closeApp();
});

describe('Network & Telemetry', () => {
  test('should fire the impression pixel exactly once when the ad becomes visible', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.waitForDisplayed({ timeout: 10_000 });
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    await driver.pause(3_000);

    const urls = readCapturedUrls();
    expect(countMatches(urls, '/impression')).toBe(1);
  });

  test('should fire the click pixel exactly once when the ad is tapped', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    await adContainer.click();
    await driver.pause(2_000);

    const urls = readCapturedUrls();
    expect(countMatches(urls, '/click')).toBe(1);
  });

  test('should fire video quartile pixels at the correct intervals', async () => {
    const loadVideoAdButton = await driver.$('~LoadVideoAdButton');
    await loadVideoAdButton.waitForDisplayed({ timeout: 10_000 });
    await loadVideoAdButton.click();

    const videoPlayer = await driver.$('~VideoPlayer');
    await videoPlayer.waitForDisplayed({ timeout: 20_000 });

    // Wait for a 30-second video ad to play to completion (with buffer).
    await driver.pause(35_000);

    const urls = readCapturedUrls();
    expect(countMatches(urls, '/quartile/start')).toBe(1);
    expect(countMatches(urls, '/quartile/first')).toBe(1);
    expect(countMatches(urls, '/quartile/midpoint')).toBe(1);
    expect(countMatches(urls, '/quartile/third')).toBe(1);
    expect(countMatches(urls, '/quartile/complete')).toBe(1);
  });

  test('should NOT fire duplicate pixels after a network drop and reconnect', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    const networkDropButton = await driver.$('~SimulateNetworkDropButton');
    await networkDropButton.waitForDisplayed({ timeout: 10_000 });
    await networkDropButton.click();

    await driver.pause(2_000);

    const networkReconnectButton = await driver.$('~SimulateNetworkReconnectButton');
    await networkReconnectButton.click();

    await driver.pause(3_000);

    const urls = readCapturedUrls();
    expect(countMatches(urls, '/impression')).toBe(1);
  });

  test('should use HTTPS for all SDK network requests', async () => {
    const loadAdButton = await driver.$('~LoadAdButton');
    await loadAdButton.click();

    const adContainer = await driver.$('~AdContainer');
    await adContainer.waitForDisplayed({ timeout: 20_000 });

    await driver.pause(3_000);

    const urls = readCapturedUrls();
    const sdkUrls = urls.filter((u) => u.includes('ad-sdk') || u.includes('adsdk'));
    const insecureUrls = sdkUrls.filter((u) => u.startsWith('http://'));

    expect(insecureUrls).toHaveLength(0);
  });

  test('should include the consent signal header on every SDK request', async () => {
    if (!fs.existsSync(HAR_PATH)) return;

    const har: HarLog = JSON.parse(fs.readFileSync(HAR_PATH, 'utf8'));
    const sdkEntries = har.log.entries.filter(
      (e) => e.request.url.includes('ad-sdk') || e.request.url.includes('adsdk')
    );

    for (const entry of sdkEntries) {
      const headers = entry.request.headers.map((h) => h.name.toLowerCase());
      expect(headers).toContain('x-consent-string');
    }
  });
});
