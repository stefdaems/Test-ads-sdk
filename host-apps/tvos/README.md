# tvOS Host Apps

Two Xcode project stubs for validating the ad SDK on Apple TV (tvOS) real hardware.

## Directory layout

```
tvos/
├── good/       # Correct SDK integration
└── bad/        # Intentional misuse scenarios
```

## good/ — Correct integration

The "Good" host app:
1. Implements a `UIFocusEnvironment` that explicitly yields focus back to the host app when an ad finishes or is dismissed.
2. Ensures the ad container view is **not** set as the `preferredFocusEnvironments` root unless the ad is active, preventing accidental focus traps.
3. Handles all D-Pad key events (`UIPress.PressType`): `.upArrow`, `.downArrow`, `.leftArrow`, `.rightArrow`, `.select`, `.menu`.
4. Uses `AVPlayerViewController` for video ads with correct `allowsPictureInPicturePlayback = false`.
5. Removes the ad view in `viewDidDisappear(_:)` to reclaim memory.

### Build & run

```bash
cd host-apps/tvos/good
open GoodTVHostApp.xcodeproj
```

Select a **physical Apple TV** (not tvOS Simulator) and run.

## bad/ — Intentional misuse scenarios

| Scenario | What it tests |
|---|---|
| Focus trap | Ad view retains focus; user cannot navigate back to host app |
| Menu button ignored | `menu` press event consumed by SDK — user cannot go back |
| No focus restoration | After ad closes, focus lands on wrong UI element |
| Background init | SDK init attempted while app is in background |
| Rapid channel switch | User swipes away quickly during preroll |

### Build & run

```bash
cd host-apps/tvos/bad
open BadTVHostApp.xcodeproj
```

Use the on-screen bad-scenario selector (navigated via D-Pad).

## Key testing notes

- **No touch events exist on tvOS.** Every interaction must be driven by D-Pad simulation via Appium's `mobileKeyEvent` or the physical Apple TV remote.
- Test with both **Siri Remote** hardware and an Appium-simulated remote to catch any input-handling gaps.
- Verify the **Menu button always dismisses the ad** within 500 ms.
