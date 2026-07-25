import { defineConfig } from '@wdio/config';
import { TVLabsService } from '@tvlabs/wdio-service';
import type { Services } from '@wdio/types';
import {
  rokuCapabilities,
  webOSCapabilities,
  fireTVCapabilities,
} from './test/helpers/device.js';

function resolveCapabilities(): WebdriverIO.Capabilities[] {
  const platform = (process.env.TVLABS_PLATFORM ?? 'roku').toLowerCase();
  switch (platform) {
    case 'webos':
      return [webOSCapabilities() as WebdriverIO.Capabilities];
    case 'firetv':
      return [fireTVCapabilities() as WebdriverIO.Capabilities];
    case 'roku':
    default:
      return [rokuCapabilities() as WebdriverIO.Capabilities];
  }
}

export const config = defineConfig({
  runner: 'local',

  specs: ['./test/specs/**/*.spec.ts'],

  maxInstances: 1,

  capabilities: resolveCapabilities(),

  logLevel: 'info',

  bail: 0,

  waitforTimeout: 30000,

  connectionRetryTimeout: 120000,

  connectionRetryCount: 3,

  hostname: 'appium.tvlabs.ai',
  port: 4723,
  protocol: 'https',

  services: [
    [
      TVLabsService,
      {
        apiKey: process.env.TVLABS_API_KEY ?? '',
        // Optionally pass buildPath to sideload an app:
        // buildPath: process.env.TVLABS_BUILD_PATH,
      },
    ] as Services.ServiceEntry,
  ],

  framework: 'mocha',

  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
});
