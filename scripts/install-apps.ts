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
 *   ts-node scripts/install-apps.ts --platform android --player exoplayer
 *   ts-node scripts/install-apps.ts --platform web --player theoplayer --variant bad
 *   ts-node scripts/install-apps.ts --platform ios --remote browserstack
 *   ts-node scripts/install-apps.ts --platform android --remote aws
 *   ts-node scripts/install-apps.ts --platform android --remote firebase
 *   ts-node scripts/install-apps.ts --platform ios --agent-host user@lab.example.com
 *
 * Environment variables:
 *   DEVICE_UDID              - iOS / tvOS physical device UDID (xcode: xcrun xctrace list devices)
 *   DEVICE_SERIAL            - Android device serial (adb devices)
 *   ANDROID_VARIANT          - debug | release (default: debug)
 *   IOS_TEAM_ID              - Apple development team ID for signing
 *
 *   -- BrowserStack (--remote browserstack) --
 *   BROWSERSTACK_USERNAME    - BrowserStack account username
 *   BROWSERSTACK_ACCESS_KEY  - BrowserStack access key
 *
 *   -- AWS Device Farm (--remote aws) --
 *   AWS_PROJECT_ARN          - AWS Device Farm project ARN
 *   AWS_DEVICE_POOL_ARN      - AWS Device Farm device pool ARN
 *
 *   -- Firebase Test Lab (--remote firebase) --
 *   FIREBASE_PROJECT         - GCP project ID used with gcloud
 *
 * Players:
 *   Web     : theoplayer | shaka | videojs | bitmovin | all (default)
 *   Android : exoplayer  | shaka | theoplayer | bitmovin | all (default)
 *   iOS     : theoplayer | bitmovin | all (default)
 */

import { execSync, ExecSyncOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = 'ios' | 'android' | 'tvos' | 'web' | 'all';
type Variant = 'good' | 'bad' | 'all';
type WebPlayer    = 'theoplayer' | 'shaka' | 'videojs' | 'bitmovin' | 'all';
type AndroidPlayer = 'exoplayer' | 'shaka' | 'theoplayer' | 'bitmovin' | 'all';
type IosPlayer    = 'theoplayer' | 'bitmovin' | 'all';
type RemoteTarget = 'browserstack' | 'aws' | 'firebase';

interface InstallOptions {
  platform: Platform;
  variant: Variant;
  player: string;
  remote?: RemoteTarget;
  agentHost?: string;
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

/** Execute a command on a remote agent machine via SSH. */
function runRemoteSsh(agentHost: string, cmd: string): void {
  console.log(`\n▶ [SSH → ${agentHost}] ${cmd}`);
  const opts: ExecSyncOptions = { stdio: 'inherit' };
  execSync(`ssh -o StrictHostKeyChecking=no ${agentHost} '${cmd.replace(/'/g, "'\\''")}'`, opts);
}

function parseArgs(): InstallOptions {
  const args = process.argv.slice(2);
  const platformIdx  = args.indexOf('--platform');
  const variantIdx   = args.indexOf('--variant');
  const playerIdx    = args.indexOf('--player');
  const remoteIdx    = args.indexOf('--remote');
  const agentHostIdx = args.indexOf('--agent-host');

  const platform: Platform = (platformIdx !== -1 ? args[platformIdx + 1] : 'all') as Platform;
  const variant: Variant = (variantIdx !== -1 ? args[variantIdx + 1] : 'all') as Variant;
  const player: string = playerIdx !== -1 ? args[playerIdx + 1] : 'all';
  const remote = remoteIdx !== -1 ? args[remoteIdx + 1] as RemoteTarget : undefined;
  const agentHost = agentHostIdx !== -1 ? args[agentHostIdx + 1] : undefined;

  const validPlatforms: Platform[] = ['ios', 'android', 'tvos', 'web', 'all'];
  const validVariants: Variant[] = ['good', 'bad', 'all'];
  const validRemotes: RemoteTarget[] = ['browserstack', 'aws', 'firebase'];

  if (!validPlatforms.includes(platform)) {
    console.error(`❌ Invalid platform "${platform}". Choose from: ${validPlatforms.join(', ')}`);
    process.exit(1);
  }
  if (!validVariants.includes(variant)) {
    console.error(`❌ Invalid variant "${variant}". Choose from: ${validVariants.join(', ')}`);
    process.exit(1);
  }
  if (remote && !validRemotes.includes(remote)) {
    console.error(`❌ Invalid remote "${remote}". Choose from: ${validRemotes.join(', ')}`);
    process.exit(1);
  }
  if (remote && platform === 'web') {
    console.error('❌ --remote is not applicable to the web platform.');
    process.exit(1);
  }
  if (remote === 'firebase' && platform !== 'android') {
    console.error('❌ Firebase Test Lab only supports the android platform.');
    process.exit(1);
  }
  if (remote && agentHost) {
    console.error('❌ --remote and --agent-host are mutually exclusive.');
    process.exit(1);
  }

  return { platform, variant, player, remote, agentHost };
}

function getVariants(variant: Variant): Array<'good' | 'bad'> {
  return variant === 'all' ? ['good', 'bad'] : [variant];
}

// ---------------------------------------------------------------------------
// Remote upload helpers
// ---------------------------------------------------------------------------

/** Upload an IPA or APK to BrowserStack and return the app URL. */
function uploadToBrowserStack(artifactPath: string): string {
  const username = process.env.BROWSERSTACK_USERNAME;
  const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;
  if (!username || !accessKey) {
    throw new Error('BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be set.');
  }
  console.log(`\n☁ Uploading ${artifactPath} to BrowserStack…`);
  const result = execSync(
    `curl -s -u "${username}:${accessKey}" ` +
    `-X POST "https://api-cloud.browserstack.com/app-automate/upload" ` +
    `-F "file=@${artifactPath}"`,
  ).toString();
  const parsed = JSON.parse(result) as { app_url?: string; error?: string };
  if (!parsed.app_url) {
    throw new Error(`BrowserStack upload failed: ${result}`);
  }
  console.log(`✅ BrowserStack app URL: ${parsed.app_url}`);
  return parsed.app_url;
}

/** Upload an APK to AWS Device Farm and schedule a run. */
function uploadToAws(artifactPath: string, platform: 'ios' | 'android'): void {
  const projectArn = process.env.AWS_PROJECT_ARN;
  const devicePoolArn = process.env.AWS_DEVICE_POOL_ARN;
  if (!projectArn || !devicePoolArn) {
    throw new Error('AWS_PROJECT_ARN and AWS_DEVICE_POOL_ARN must be set.');
  }
  const uploadType = platform === 'android' ? 'ANDROID_APP' : 'IOS_APP';
  const fileName = path.basename(artifactPath);

  console.log(`\n☁ Creating AWS Device Farm upload (${uploadType})…`);
  const createResult = JSON.parse(
    execSync(
      `aws devicefarm create-upload --project-arn "${projectArn}" ` +
      `--name "${fileName}" --type "${uploadType}"`,
    ).toString(),
  ) as { upload: { arn: string; url: string } };
  const { arn: uploadArn, url: presignedUrl } = createResult.upload;

  console.log(`  Uploading to presigned S3 URL…`);
  execSync(`curl -T "${artifactPath}" "${presignedUrl}"`, { stdio: 'inherit' });

  console.log(`  Scheduling run on device pool ${devicePoolArn}…`);
  const runResult = JSON.parse(
    execSync(
      `aws devicefarm schedule-run --project-arn "${projectArn}" ` +
      `--app-arn "${uploadArn}" --device-pool-arn "${devicePoolArn}" ` +
      `--name "ads-sdk-test-run" --test type=BUILTIN_FUZZ`,
    ).toString(),
  ) as { run: { arn: string } };
  console.log(`✅ AWS Device Farm run ARN: ${runResult.run.arn}`);
  console.log(`   Poll status: aws devicefarm get-run --arn "${runResult.run.arn}"`);
}

/** Run tests on Firebase Test Lab (Android only). */
function uploadToFirebase(apkPath: string): void {
  const project = process.env.FIREBASE_PROJECT;
  const projectFlag = project ? `--project "${project}" ` : '';
  console.log(`\n☁ Scheduling Firebase Test Lab run…`);
  execSync(
    `gcloud firebase test android run ${projectFlag}` +
    `--app "${apkPath}" --type instrumentation`,
    { stdio: 'inherit' },
  );
  console.log('✅ Firebase Test Lab run scheduled.');
}

// ---------------------------------------------------------------------------
// Platform installers
// ---------------------------------------------------------------------------

function installIos(variant: Variant, player: string, remote?: RemoteTarget, agentHost?: string): void {
  const udid = process.env.DEVICE_UDID;
  if (!udid && !remote && !agentHost) {
    console.warn('⚠ DEVICE_UDID not set — skipping install to device (build only).');
  }
  const teamId = process.env.IOS_TEAM_ID ?? '';
  const allPlayers: IosPlayer[] = ['theoplayer', 'bitmovin'];
  const targetPlayers: IosPlayer[] = player === 'all'
    ? allPlayers
    : allPlayers.filter(p => p === player);

  // Legacy good/bad top-level iOS apps (no player subfolder)
  for (const v of getVariants(variant)) {
    const dir = path.join(HOST_APPS, 'ios', v);
    const projectName = v === 'good' ? 'GoodHostApp' : 'BadHostApp';
    const scheme = projectName;
    const xcodeproj = path.join(dir, `${projectName}.xcodeproj`);

    if (fs.existsSync(xcodeproj)) {
      console.log(`\n📱 iOS ${v} — building ${scheme}...`);
      const archiveDir = path.join(dir, 'build', `${projectName}.xcarchive`);
      const ipaDir = path.join(dir, 'build', 'ipa');

      if (remote) {
        // Build an exportable archive for farm upload
        const archiveCmd = [
          'xcodebuild',
          '-project', `${projectName}.xcodeproj`,
          '-scheme', scheme,
          '-configuration', 'Debug',
          '-archivePath', archiveDir,
          teamId ? `DEVELOPMENT_TEAM=${teamId}` : '',
          'archive',
        ].filter(Boolean).join(' ');
        run(archiveCmd, dir);
        run(
          `xcodebuild -exportArchive -archivePath "${archiveDir}" ` +
          `-exportPath "${ipaDir}" -exportOptionsPlist ExportOptions.plist`,
          dir,
        );
        const ipaPath = path.join(ipaDir, `${projectName}.ipa`);
        if (remote === 'browserstack') {
          uploadToBrowserStack(ipaPath);
        } else if (remote === 'aws') {
          uploadToAws(ipaPath, 'ios');
        }
      } else if (agentHost) {
        runRemoteSsh(agentHost, `ideviceinstaller -u ${udid} -i "$(ls ${ipaDir}/*.ipa | head -1)"`);
        console.log(`✅ iOS ${v} installed on remote agent ${agentHost}`);
      } else {
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
  }

  // Player-specific iOS apps
  for (const p of targetPlayers) {
    for (const v of getVariants(variant)) {
      const dir = path.join(HOST_APPS, 'ios', 'players', p);
      const projectName = `${p}-ios-test`;
      const xcodeproj = path.join(dir, `${projectName}.xcodeproj`);

      if (!fs.existsSync(xcodeproj)) {
        console.warn(`⚠ ${xcodeproj} not found — skipping (see ${dir}/README.md to create the Xcode project).`);
        continue;
      }

      console.log(`\n📱 iOS ${p} ${v} — building ${projectName}...`);
      const ipaDir = path.join(dir, 'build', 'ipa');

      if (remote) {
        const archiveDir = path.join(dir, 'build', `${projectName}.xcarchive`);
        const archiveCmd = [
          'xcodebuild',
          '-project', `${projectName}.xcodeproj`,
          '-scheme', projectName,
          '-configuration', 'Debug',
          '-archivePath', archiveDir,
          teamId ? `DEVELOPMENT_TEAM=${teamId}` : '',
          `ADS_SDK_VARIANT=${v}`,
          'archive',
        ].filter(Boolean).join(' ');
        run(archiveCmd, dir);
        run(
          `xcodebuild -exportArchive -archivePath "${archiveDir}" ` +
          `-exportPath "${ipaDir}" -exportOptionsPlist ExportOptions.plist`,
          dir,
        );
        const ipaPath = path.join(ipaDir, `${projectName}.ipa`);
        if (remote === 'browserstack') {
          uploadToBrowserStack(ipaPath);
        } else if (remote === 'aws') {
          uploadToAws(ipaPath, 'ios');
        }
      } else if (agentHost) {
        runRemoteSsh(agentHost, `ideviceinstaller -u ${udid} -i "$(ls ${ipaDir}/*.ipa | head -1)"`);
        console.log(`✅ iOS ${p} ${v} installed on remote agent ${agentHost}`);
      } else {
        const buildCmd = [
          'xcodebuild',
          '-project', `${projectName}.xcodeproj`,
          '-scheme', projectName,
          '-configuration', 'Debug',
          udid ? `-destination "id=${udid}"` : '-destination "generic/platform=iOS"',
          teamId ? `DEVELOPMENT_TEAM=${teamId}` : '',
          `ADS_SDK_VARIANT=${v}`,
          'clean build',
        ].filter(Boolean).join(' ');
        run(buildCmd, dir);

        if (udid) {
          run(
            `xcodebuild -project ${projectName}.xcodeproj -scheme ${projectName} -configuration Debug -destination "id=${udid}" install`,
            dir,
          );
          console.log(`✅ iOS ${p} ${v} installed to device ${udid}`);
        }
      }
    }
  }
}

function installAndroid(variant: Variant, player: string, remote?: RemoteTarget, agentHost?: string): void {
  const serial = process.env.DEVICE_SERIAL;
  const androidVariant = process.env.ANDROID_VARIANT ?? 'debug';
  const gradleTask = `install${androidVariant.charAt(0).toUpperCase()}${androidVariant.slice(1)}`;
  const assembleTask = `assemble${androidVariant.charAt(0).toUpperCase()}${androidVariant.slice(1)}`;
  const allPlayers: AndroidPlayer[] = ['exoplayer', 'shaka', 'theoplayer', 'bitmovin'];
  const targetPlayers: AndroidPlayer[] = player === 'all'
    ? allPlayers
    : allPlayers.filter(p => p === player);
  const adbEnv = serial ? `ANDROID_SERIAL=${serial} ` : '';

  // Legacy good/bad top-level Android apps
  for (const v of getVariants(variant)) {
    const dir = path.join(HOST_APPS, 'android', v);
    const gradlew = path.join(dir, 'gradlew');

    if (fs.existsSync(gradlew)) {
      console.log(`\n🤖 Android ${v} — running ./gradlew ${remote ? assembleTask : gradleTask}...`);

      if (remote) {
        run(`./gradlew ${assembleTask}`, dir);
        const apkPath = path.join(dir, 'app', 'build', 'outputs', 'apk', androidVariant, `app-${androidVariant}.apk`);
        if (remote === 'browserstack') {
          uploadToBrowserStack(apkPath);
        } else if (remote === 'aws') {
          uploadToAws(apkPath, 'android');
        } else if (remote === 'firebase') {
          uploadToFirebase(apkPath);
        }
      } else if (agentHost) {
        run(`./gradlew ${assembleTask}`, dir);
        const apkPath = path.join(dir, 'app', 'build', 'outputs', 'apk', androidVariant, `app-${androidVariant}.apk`);
        runRemoteSsh(agentHost, `adb ${serial ? `-s ${serial}` : ''} install -r "${apkPath}"`);
        console.log(`✅ Android ${v} installed on remote agent ${agentHost}`);
      } else {
        run(`${adbEnv}./gradlew ${gradleTask}`.trim(), dir);
        console.log(`✅ Android ${v} installed${serial ? ` to device ${serial}` : ''}`);
      }
    }
  }

  // Player-specific Android apps
  for (const p of targetPlayers) {
    const dir = path.join(HOST_APPS, 'android', 'players', p);
    const gradlew = path.join(dir, 'gradlew');

    if (!fs.existsSync(gradlew)) {
      console.warn(`⚠ ${gradlew} not found — skipping (see ${dir}/README.md to create the Android project).`);
      continue;
    }

    console.log(`\n🤖 Android ${p} — running ./gradlew ${remote ? assembleTask : gradleTask}...`);

    if (remote) {
      run(`./gradlew ${assembleTask}`, dir);
      const apkPath = path.join(dir, 'app', 'build', 'outputs', 'apk', androidVariant, `app-${androidVariant}.apk`);
      if (remote === 'browserstack') {
        uploadToBrowserStack(apkPath);
      } else if (remote === 'aws') {
        uploadToAws(apkPath, 'android');
      } else if (remote === 'firebase') {
        uploadToFirebase(apkPath);
      }
    } else if (agentHost) {
      run(`./gradlew ${assembleTask}`, dir);
      const apkPath = path.join(dir, 'app', 'build', 'outputs', 'apk', androidVariant, `app-${androidVariant}.apk`);
      runRemoteSsh(agentHost, `adb ${serial ? `-s ${serial}` : ''} install -r "${apkPath}"`);
      console.log(`✅ Android ${p} installed on remote agent ${agentHost}`);
    } else {
      run(`${adbEnv}./gradlew ${gradleTask}`.trim(), dir);
      console.log(`✅ Android ${p} installed${serial ? ` to device ${serial}` : ''}`);
    }
  }
}

function installTvos(variant: Variant, player: string): void {
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

function installWeb(variant: Variant, player: string): void {
  const allPlayers: WebPlayer[] = ['theoplayer', 'shaka', 'videojs', 'bitmovin'];
  const targetPlayers: WebPlayer[] = player === 'all'
    ? allPlayers
    : allPlayers.filter(p => p === player);

  // Default port assignment per player
  const PLAYER_PORTS: Record<WebPlayer, number> = {
    theoplayer: 3000,
    shaka:      3001,
    videojs:    3002,
    bitmovin:   3003,
    all:        3000, // unused
  };

  if (targetPlayers.length > 0) {
    // Player-specific subdirectories
    for (const p of targetPlayers) {
      for (const v of getVariants(variant)) {
        const dir = path.join(HOST_APPS, 'web', 'players', p, v);
        const indexHtml = path.join(dir, 'index.html');
        if (!fs.existsSync(indexHtml)) {
          console.warn(`⚠ ${dir}/index.html not found — skipping.`);
          continue;
        }
        const port = PLAYER_PORTS[p] + (v === 'bad' ? 10 : 0);
        console.log(`\n🌐 Web ${p} ${v} — starting on port ${port}...`);
        run(`npx serve . --listen ${port} --no-clipboard`, dir);
      }
    }
    return;
  }

  // Fall back to legacy good/bad top-level pages
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
