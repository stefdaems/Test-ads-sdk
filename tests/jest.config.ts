import type { Config } from 'jest';

/**
 * Jest configuration for the Ads SDK device lab test suite.
 *
 * Tests are written in TypeScript and executed via ts-jest.
 *
 * Two categories of tests are supported:
 *
 *   1. Backend API (Node fetch) — api/ optiview-api.spec.ts
 *      Requires: OPTIVIEW_API_KEY, OPTIVIEW_API_SECRET, OPTIVIEW_ORG_ID.
 *      Tests skip gracefully when credentials are absent.
 *
 *   2. Native (Appium)  — consent/, network/, viewability/, memory/,
 *                         players/ *-android.spec.ts, *-ios.spec.ts
 *      Requires: Appium server + real device connected.
 *      Env vars: PLATFORM, DEVICE_UDID | DEVICE_SERIAL, APP_PATH,
 *                APPIUM_HOST, APPIUM_PORT
 *
 *   3. Web (Playwright) — players/ *-web.spec.ts
 *      Requires: Playwright Chromium installed (`npm run playwright:install`),
 *                local player host servers running, proxy active.
 *      Env vars: HEADLESS, PLAYER_HOST, PROXY_HOST, PROXY_PORT
 *
 * Run subsets with:
 *   npm run test:api              — OptiView backend API tests (no device needed)
 *   npm run test:players          — all player specs
 *   npm run test:web-players      — web-only player specs (Playwright)
 *   npm run test:native           — native-only player specs (Appium)
 *   npm run test:theoplayer       — THEOplayer specs only
 *   npm run test:exoplayer        — ExoPlayer specs only
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Discover TypeScript specs in all sub-directories.
  testMatch: ['**/*.spec.ts'],

  // ts-jest settings.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },

  // Appium / Playwright sessions are slow.
  testTimeout: 180_000,

  // Run one suite at a time (one Appium/Playwright session per suite).
  maxWorkers: 1,

  // Verbose output.
  verbose: true,

  // Global teardown.
  globalTeardown: './helpers/globalTeardown.ts',
};

export default config;
