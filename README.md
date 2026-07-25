# Test-ads-sdk

Integration tests for the Ads SDK running on **real TV devices** via the [TV Labs](https://tvlabs.ai) cloud platform.

Tests cover three platforms — **Roku**, **webOS (LG)**, and **Fire TV** — and run automatically on every push/PR through the included GitHub Actions workflow.

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18.20 |
| npm | ≥ 8 |
| TV Labs account | [tvlabs.ai](https://tvlabs.ai) |

## Setup

### 1. Obtain a TV Labs API key

1. Log in at [tvlabs.ai](https://tvlabs.ai) and navigate to **Settings → API Keys**.
2. Click **Create New Key** and copy the generated key.

### 2. Install dependencies

```bash
npm install
```

### 3. Export the API key

```bash
export TVLABS_API_KEY=your_api_key_here
```

## Running tests

### All platforms

```bash
npm test
```

### Individual platforms

```bash
npm run test:roku    # Roku only
npm run test:webos   # webOS (LG) only
npm run test:firetv  # Fire TV only
```

### Optional environment variables

| Variable | Description |
|---|---|
| `TVLABS_ROKU_CHANNEL_ID` | Roku channel ID to launch during the test run |
| `TVLABS_WEBOS_APP_ID` | webOS app ID to launch during the test run |
| `TVLABS_FIRETV_PACKAGE` | Android package name to activate during the test run |
| `TVLABS_BUILD_PATH` | Path to a build artifact to sideload (`.zip` / `.ipk` / `.apk`) |

If an app-specific variable is not set, the corresponding tests are skipped gracefully.

## CI / GitHub Actions

The workflow file at [`.github/workflows/tvlabs.yml`](.github/workflows/tvlabs.yml) runs all three platform jobs in parallel on every push to `main` and on every pull request.

### Required secret

Add `TVLABS_API_KEY` as a [GitHub Actions secret](https://docs.github.com/en/actions/security-guides/encrypted-secrets) in your repository settings.

### Optional variables

Add any of the optional variables from the table above as [GitHub Actions variables](https://docs.github.com/en/actions/learn-github-actions/variables) (not secrets) to enable full app-launch tests in CI.

### Manual dispatch

You can also trigger the workflow manually from the **Actions** tab and choose a specific platform (`roku`, `webos`, `firetv`, or `all`).

## Project structure

```
.
├── wdio.conf.ts                  # Shared WebdriverIO + TV Labs config
├── test/
│   ├── helpers/
│   │   └── device.ts             # Shared capability builders and remote helpers
│   └── specs/
│       ├── roku.spec.ts          # Roku test suite
│       ├── webos.spec.ts         # webOS (LG) test suite
│       └── firetv.spec.ts        # Fire TV test suite
└── .github/
    └── workflows/
        └── tvlabs.yml            # CI workflow
```

## How it works

1. The [`@tvlabs/wdio-service`](https://www.npmjs.com/package/@tvlabs/wdio-service) package connects to TV Labs over a WebSocket before each Appium session.
2. It matches your `tvlabs:constraints` (platform, make, model, …) to an available real device in the TV Labs cloud fleet.
3. Once a device is matched, it starts a standard Appium session proxied through `appium.tvlabs.ai:4723`.
4. Tests interact with the device using Appium WebDriver commands and platform-specific script extensions (`roku: pressKey`, `webos: pressKey`, Android key codes, …).
5. Session recordings are available at `https://tvlabs.ai/app/sessions/<session-id>` after the run.
