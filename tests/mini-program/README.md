# Native mini-program checks

These checks execute project JavaScript and inspect actual WXML/WXSS files. They
are a local compatibility aid, **not** the official WeChat compiler, developer
tools, simulator, login, payment, or physical-device acceptance.

## Static and VM checks

```sh
node --test apps/wechat/test/native-*.test.cjs
```

- `native-structure` discovers current `app.json` routes, checks local Page/template
  files, parses the supported WXML expression subset and balanced XML-like tags,
  checks literal event names against the actual Page methods, and rejects missing
  literal navigation destinations and temporary Figma asset URLs.
- `native-page` loads each Page and its relative CommonJS helpers in an isolated
  VM. Requests are explicit test responses only, never network calls. Each instance
  has separate data, field-path-aware `setData`, controllable requests/storage/modal
  outcomes and manual interval registration. It does not implement every wx API.
- `native-transport` independently exercises the real finite-path transport,
  anonymous statistics, account-change fencing, download fencing, final create
  receipt details, UI read tokens, Beijing time and fail-closed random IDs.

The parser deliberately supports the subset used by these project templates:
property/index access, literals, arrays/objects, arithmetic/comparison/logical
operators and ternaries. Calls, assignments, optional chaining and JavaScript
globals must be precomputed into Page data. Unsupported constructs fail visibly;
they are not silently treated as valid WeChat syntax.

## Static layout preview

```sh
node scripts/preview-wechat.mjs --page=home --out=/tmp/mini-home.html
node scripts/preview-wechat.mjs --page=players --data=/tmp/synthetic-page-data.json --width=320 --height=844 --out=/tmp/mini-players-320.html
```

Run from the repository root. `--data` is a JSON field map merged into that Page's
actual initial data; use only synthetic examples, never credentials or production
private records. The script uses the actual registered Page, WXML, global WXSS
and page WXSS; it does not substitute a separately drawn webpage. It expands
`wx:for`, conditions, single-decoded XML entities, bindings and file-local named
templates/data maps, maps core native tags to HTML, converts rpx at
the selected width, and renders inside a fixed viewport iframe. Local
`usingComponents` mappings are resolved from app/page/component JSON. Their real
Component JS defaults, passed properties, data, WXML and WXSS are expanded, with
recursion/path guards and scoped compatibility CSS. No component lifetimes,
observers, methods or requests are run. The surrounding
notice stays explicit about this being static compatibility output. It does not
execute UI event handlers or open a server/port.

Discrete local images are embedded byte-for-byte. Remote, wxfile and private
service media are not downloaded; the preview keeps them unavailable. Its CSP
blocks network and scripts. Native headers, fonts, controls, safe areas, scroll
component style isolation and rendering engines are approximations; inspect the actual WeChat developer
tools and devices before release.

Initial environment inspection found the Playwright package but no installed
Chromium/Chrome executable, and no official WeChat compiler/automator/simulate.
The HTML generator can run without a browser. Browser screenshots or layout
results must only be reported when an independently available browser was
actually used, with its own environment and limitations stated.
