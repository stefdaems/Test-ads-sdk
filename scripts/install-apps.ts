#!/usr/bin/env ts-node
/**
 * Centralised App Installer
 *
 * Builds and deploys host apps to real devices from a single entry point.
 *
 * Usage:
 *   ts-node scripts/install-apps.ts --platform <ios|android|tvos|web|all>
 *   ts-node scripts/install-apps.ts --platform ios --variant good
 *   ts-node scripts/install-apps.ts --platform android --variant bad
 *
 * Environment variables:
 *   DEVICE_UDID     - iOS / tvOS physical device UDID (xcode: xcrun xctrace list devices)
 *   DEVICE_SERIAL   - Android device serial (adb devices)
 *   ANDROID_VARIANT - debug | release (default: debug)
 *   IOS_TEAM_ID     - Apple development team ID for signing
 */

import { execSync, ExecSyncOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = 'ios' | 'android' | 'tvos' | 'web' | 'all';
type Variant = 'good' | 'bad' | 'all';

interface InstallOptions {
  platform: Platform;
  variant: Variant;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');
const HOST_APPS = path.join(ROOT, 'host-apps');

function run(cmd: string, cwd: string): void {
  console.log(`\n▶ ${cmd}\n  (cwd: ${cwd})`);
  const opts: ExecSyncOptions = { cwd, stdio: 'inherit' };
  execSync(cmd, opts);
}

function parseArgs(): InstallOptions {
  const args = process.argv.slice(2);
  const platformIdx = args.indexOf('--platform');
  const variantIdx = args.indexOf('--variant');

  const platform: Platform = (platformIdx !== -1 ? args[platformIdx + 1] : 'all') as Platform;
  const variant: Variant = (variantIdx !== -1 ? args[variantIdx + 1] : 'all') as Variant;

  const validPlatforms: Platform[] = ['ios', 'android', 'tvos', 'web', 'all'];
  const validVariants: Variant[] = ['good', 'bad', 'all'];

  if (!validPlatforms.includes(platform)) {
    console.error(`❌ Invalid platform "${platform}". Choose from: ${validPlatforms.join(', ')}`);
    process.exit(1);
  }
  if (!validVariants.includes(variant)) {
    console.error(`❌ Invalid variant "${variant}". Choose from: ${validVariants.join(', ')}`);
    process.exit(1);
  }

  return { platform, variant };
}

function getVariants(variant: Variant): Array<'good' | 'bad'> {
  return variant === 'all' ? ['good', 'bad'] : [variant];
}

// ---------------------------------------------------------------------------
// Platform installers
// ---------------------------------------------------------------------------

function installIos(variant: Variant): void {
  const udid = process.env.DEVICE_UDID;
  if (!udid) {
    console.warn('⚠ DEVICE_UDID not set — skipping install to device (build only).');
  }
  const teamId = process.env.IOS_TEAM_ID ?? '';

  for (const v of getVariants(variant)) {
    const dir = path.join(HOST_APPS, 'ios', v);
    const projectName = v === 'good' ? 'GoodHostApp' : 'BadHostApp';
    const scheme = projectName;
    const xcodeproj = path.join(dir, `${projectName}.xcodeproj`);

    if (!fs.existsSync(xcodeproj)) {
      console.warn(`⚠ ${xcodeproj} not found — skipping (stub directory, create the Xcode project first).`);
      continue;
    }

    console.log(`\n📱 iOS ${v} — building ${scheme}...`);

    const buildCmd = [
      'xcodebuild',
      '-project', `${projectName}.xcodeproj`,
      '-scheme', scheme,
      '-configuration', 'Debug',
      udid ? `-destination "id=${udid}"` : '-destination "generic/platform=iOS"',
      teamId ? `DEVELOPMENT_TEAM=${teamId}` : '',
      'clean build',
    ].filter(Boolean).join(' ');

    run(buildCmd, dir);

    if (udid) {
      run(
        `xcodebuild -project ${projectName}.xcodeproj -scheme ${scheme} -configuration Debug -destination "id=${udid}" install`,
        dir,
      );
      console.log(`✅ iOS ${v} installed to device ${udid}`);
    }
  }
}

function installAndroid(variant: Variant): void {
  const serial = process.env.DEVICE_SERIAL;
  const androidVariant = process.env.ANDROID_VARIANT ?? 'debug';
  const gradleTask = `install${androidVariant.charAt(0).toUpperCase()}${androidVariant.slice(1)}`;

  for (const v of getVariants(variant)) {
    const dir = path.join(HOST_APPS, 'android', v);
    const gradlew = path.join(dir, 'gradlew');

    if (!fs.existsSync(gradlew)) {
      console.warn(`⚠ ${gradlew} not found — skipping (stub directory, create the Android project first).`);
      continue;
    }

    console.log(`\n🤖 Android ${v} — running ./gradlew ${gradleTask}...`);

    const adbEnv = serial ? `ANDROID_SERIAL=${serial}` : '';
    run(`${adbEnv} ./gradlew ${gradleTask}`.trim(), dir);
    console.log(`✅ Android ${v} installed${serial ? ` to device ${serial}` : ''}`);
  }
}

function installTvos(variant: Variant): void {
  const udid = process.env.DEVICE_UDID;
  if (!udid) {
    console.warn('⚠ DEVICE_UDID not set — skipping install to Apple TV (build only).');
  }
  const teamId = process.env.IOS_TEAM_ID ?? '';

  for (const v of getVariants(variant)) {
    const dir = path.join(HOST_APPS, 'tvos', v);
    const projectName = v === 'good' ? 'GoodTVHostApp' : 'BadTVHostApp';
    const scheme = projectName;
    const xcodeproj = path.join(dir, `${projectName}.xcodeproj`);

    if (!fs.existsSync(xcodeproj)) {
      console.warn(`⚠ ${xcodeproj} not found — skipping (stub directory, create the Xcode project first).`);
      continue;
    }

    console.log(`\n📺 tvOS ${v} — building ${scheme}...`);

    const buildCmd = [
      'xcodebuild',
      '-project', `${projectName}.xcodeproj`,
      '-scheme', scheme,
      '-configuration', 'Debug',
      udid ? `-destination "id=${udid}"` : '-destination "generic/platform=tvOS"',
      teamId ? `DEVELOPMENT_TEAM=${teamId}` : '',
      'clean build',
    ].filter(Boolean).join(' ');

    run(buildCmd, dir);

    if (udid) {
      run(
        `xcodebuild -project ${projectName}.xcodeproj -scheme ${scheme} -configuration Debug -destination "id=${udid}" install`,
        dir,
      );
      console.log(`✅ tvOS ${v} installed to device ${udid}`);
    }
  }
}

function installWeb(variant: Variant): void {
  for (const v of getVariants(variant)) {
    const dir = path.join(HOST_APPS, 'web', v);
    const indexHtml = path.join(dir, 'index.html');

    if (!fs.existsSync(indexHtml)) {
      console.warn(`⚠ ${dir}/index.html not found — skipping (stub directory, create the web app first).`);
      continue;
    }

    console.log(`\n🌐 Web ${v} — starting local server...`);
    const port = v === 'good' ? 3000 : 3001;
    run(`npx serve . --listen ${port} --no-clipboard`, dir);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const { platform, variant } = parseArgs();

  console.log(`\n🚀 Ads SDK Host App Installer`);
  console.log(`   Platform : ${platform}`);
  console.log(`   Variant  : ${variant}`);
  console.log(`   SDK URL  : https://Ads-sdk.xnappet.live\n`);

  const platforms: Array<Exclude<Platform, 'all'>> =
    platform === 'all' ? ['ios', 'android', 'tvos', 'web'] : [platform];

  for (const p of platforms) {
    switch (p) {
      case 'ios':
        installIos(variant);
        break;
      case 'android':
        installAndroid(variant);
        break;
      case 'tvos':
        installTvos(variant);
        break;
      case 'web':
        installWeb(variant);
        break;
    }
  }

  console.log('\n✅ All installs complete.\n');
}

main();
