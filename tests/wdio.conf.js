/**
 * WebdriverIO + Appium configuration for the ad SDK device lab.
 *
 * Environment variables:
 *   PLATFORM        - ios | android | tvos | web  (default: android)
 *   DEVICE_UDID     - iOS / tvOS device UDID
 *   DEVICE_SERIAL   - Android device serial (adb devices)
 *   APP_PATH        - Absolute path to the .ipa / .apk under test
 *   APPIUM_HOST     - Appium server host (default: 127.0.0.1)
 *   APPIUM_PORT     - Appium server port (default: 4723)
 */

const platform = process.env.PLATFORM || 'android';

const iosCapabilities = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:udid': process.env.DEVICE_UDID,
  'appium:app': process.env.APP_PATH,
  'appium:noReset': false,
};

const tvosCapabilities = {
  platformName: 'tvOS',
  'appium:automationName': 'XCUITest',
  'appium:udid': process.env.DEVICE_UDID,
  'appium:app': process.env.APP_PATH,
  'appium:noReset': false,
};

const androidCapabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:udid': process.env.DEVICE_SERIAL,
  'appium:app': process.env.APP_PATH,
  'appium:noReset': false,
};

const capabilitiesMap = {
  ios: iosCapabilities,
  tvos: tvosCapabilities,
  android: androidCapabilities,
};

exports.config = {
  runner: 'local',
  hostname: process.env.APPIUM_HOST || '127.0.0.1',
  port: parseInt(process.env.APPIUM_PORT || '4723', 10),
  path: '/',

  specs: [
    './consent/**/*.spec.js',
    './network/**/*.spec.js',
    './viewability/**/*.spec.js',
    './memory/**/*.spec.js',
  ],

  capabilities: [capabilitiesMap[platform] || androidCapabilities],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 30000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },

  reporters: ['spec'],
};
