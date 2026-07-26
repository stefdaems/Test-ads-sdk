# Tizen Host Apps

HTML/JavaScript host app stubs for validating the Ads SDK on Samsung Smart TV devices running Tizen.

## Directory layout

```text
tizen/
└── players/
    ├── shaka/
    │   ├── config.xml
    │   ├── index.html
    │   ├── good/
    │   └── bad/
    └── theoplayer/
        ├── config.xml
        ├── index.html
        ├── good/
        └── bad/
```

Each player directory is a Tizen web application packaged with `config.xml` in W3C Widget format.

## Packaging and build

- Target platform: **Samsung Smart TV**
- Minimum target: **Tizen 5.5**
- Build with the `tizen` CLI from **Tizen Studio**
- Package with `tizen package -t wgt`, which produces a `.wgt` bundle
- The root `index.html` is the app entry point declared by `config.xml`

## Scenario folders

- `good/` — baseline integration flow for the player adapter
- `bad/` — intentionally invalid initialisation flow for failure-path validation

## TV-specific notes

- Register the remote **Return** key and handle key code `10009` for back / exit flows.
- Replace placeholder SDK values before signing and deploying to a TV or emulator.
