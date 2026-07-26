# theoplayer iOS Host App

Minimal iOS stub integrating the Ads SDK with the theoplayer iOS SDK.

## Prerequisites
- Xcode 15+
- Ads SDK XCFramework obtained from ops
- Player iOS SDK licence key (where required)
- Provisioning profile for a test device

## Setup
1. Open the xcodeproj in Xcode.
2. Add the Ads SDK XCFramework under *Frameworks, Libraries, and Embedded Content*.
3. Add the player iOS SDK (CocoaPods or SPM).
4. Set the publisher ID and player licence key in `Config.xcconfig`.
5. Build and install to the device (or use `xcodebuild`).

## Accessibility IDs used by tests
| Element | Accessibility ID |
|---|---|
| Load content button | `LoadContentButton` |
| Ad container | `AdContainer` |
| Skip button | `SkipButton` |
| Diagnostic log | `DiagnosticLog` |
| Memory label | `MemoryLabel` |
