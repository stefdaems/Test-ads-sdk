# ExoPlayer Android Host App

Minimal Android stub that integrates the Ads SDK with ExoPlayer (Media3).

## Prerequisites
- Android Studio Arctic Fox+
- Ads SDK AAR (or Maven coordinate) obtained from ops
- Android 6.0+ (Doze-mode tests require API 23+)

## Setup
1. Open `host-apps/android/players/exoplayer/` in Android Studio.
2. Add the Ads SDK + Media3 ExoPlayer dependencies to `app/build.gradle`.
3. Set the publisher ID in `local.properties`.
4. Run → select connected device → Deploy.

## Accessibility IDs used by tests
| Element | Accessibility ID |
|---|---|
| Load content button | `LoadContentButton` |
| Ad container | `AdContainer` |
| Skip button | `SkipButton` |
| Diagnostic log | `DiagnosticLog` |
| Memory label | `MemoryLabel` |
