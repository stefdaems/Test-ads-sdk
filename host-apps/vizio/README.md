# Vizio SmartCast Host Apps

HTML/JavaScript host app stubs for validating the Ads SDK on Vizio SmartCast devices.

## Directory layout

```text
vizio/
└── players/
    └── theoplayer/
        ├── manifest.json
        ├── index.html
        ├── good/
        └── bad/
```

SmartCast host apps are standard web apps submitted through the **Vizio Developer Portal**.

## Packaging notes

- Deployment target: **Vizio SmartCast**
- Resolution: **1920x1080**
- Bundle the app as a **zip** archive for submission
- The **Vizio SmartCast SDK** may be used when deeper platform integration is needed, but it is optional for these stubs
- `manifest.json` describes the app metadata and entry page

## Scenario folders

- `good/` — baseline THEOplayer integration flow
- `bad/` — intentionally invalid Ads SDK initialisation flow

## Notes

- SmartCast remotes generally map to standard browser key input, so no extra platform-specific key handler is included here.
- Replace placeholder SDK endpoints, publisher IDs, and player licence values before submission or device testing.
