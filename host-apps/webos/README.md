# WebOS Host Apps

HTML/JavaScript host app stubs for validating the Ads SDK on LG webOS TV devices.

## Directory layout

```text
webos/
└── players/
    ├── shaka/
    │   ├── appinfo.json
    │   ├── index.html
    │   ├── good/
    │   └── bad/
    └── theoplayer/
        ├── appinfo.json
        ├── index.html
        ├── good/
        └── bad/
```

Each player directory is a standalone webOS app packaged with `appinfo.json`. The root `index.html` can be used as a launcher page, while `good/` and `bad/` contain the actual harness scenarios.

## webOS specifics

- Target platform: **LG webOS TV**
- App type: packaged web app (`type: "web"`)
- Default resolution: **1920x1080**
- Remote control input should handle the **Back** key (`keyCode 461`)
- Package and deploy with the webOS CLI / Developer Mode workflow used for LG TV apps

## Scenario folders

- `good/` — baseline integration flow intended to represent a correct Ads SDK attachment
- `bad/` — intentionally invalid initialisation flow for negative-path testing

## Notes

- Replace placeholder SDK endpoints, publisher IDs, and player licence values before device testing.
- Add production artwork for `icon.png` if the app is prepared for distribution outside the local test workflow.
