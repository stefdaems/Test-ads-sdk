# shaka Android Host App

Minimal Android stub that integrates the Ads SDK with the shaka player.

## Prerequisites
- Android Studio Arctic Fox+
- Ads SDK AAR (or Maven coordinate) obtained from ops
- Player Android SDK licence key (where required)

## Setup
1. Open the player directory in Android Studio.
2. Add the Ads SDK dependency to `app/build.gradle`.
3. Add the player dependency to `app/build.gradle`.
4. Set the publisher ID and any player licence key in `local.properties`.
5. Run → select connected device → Deploy.

## Accessibility IDs used by tests
| Element | Accessibility ID |
|---|---|
| Load content button | `LoadContentButton` |
| Ad container | `AdContainer` |
| Skip button | `SkipButton` |
| Diagnostic log | `DiagnosticLog` |
| Memory label | `MemoryLabel` |
