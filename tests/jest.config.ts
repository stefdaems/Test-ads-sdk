import type { Config } from 'jest';

/**
 * Jest configuration for the Ads SDK device lab test suite.
 *
 * Tests are written in TypeScript and executed via ts-jest.
 * All specs target a real Appium server connected to physical devices.
 *
 * Required environment variables (passed at runtime):
 *   PLATFORM        - ios | android | tvos | web   (default: android)
 *   DEVICE_UDID     - iOS / tvOS device UDID
 *   DEVICE_SERIAL   - Android device serial (from `adb devices`)
 *   APP_PATH        - Absolute path to the .ipa / .apk under test
 *   APPIUM_HOST     - Appium server host   (default: 127.0.0.1)
 *   APPIUM_PORT     - Appium server port   (default: 4723)
 *
 * Example:
 *   PLATFORM=ios DEVICE_UDID=<udid> APP_PATH=/path/to/app.ipa npm test
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

  // Appium sessions are slow — allow plenty of time per test and per suite.
  testTimeout: 180_000,

  // Run one suite at a time so a single Appium session can be shared.
  maxWorkers: 1,

  // Print a full test-name line for every result.
  verbose: true,

  // Global teardown closes any leaked Appium sessions.
  globalTeardown: './helpers/globalTeardown.ts',
};

export default config;
