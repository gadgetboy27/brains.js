# Languages

UI text lives in `src/ui/strings/`, one file per language:

- `en.js` — English, the reference set. Every key must exist here.
- `mi.js` — te reo Māori. **Drafted by the development team for review by a
  fluent speaker before public use.**

Components never inline text; they call `t('key', params)`.

## Adding a built-in language

Copy `en.js` to `<code>.js`, translate the values (keep `{placeholders}`),
and add it to `BUILT_IN` in `index.js`. The strings test checks that every
reference key is covered and placeholders match.

## Venue community languages (no code change)

A venue can add languages — or re-word an existing one — in its venue JSON:

```jsonc
"languages": {
  "sm": {
    "name": "Gagana Sāmoa",
    "strings": {
      "picker.title": "O fea e te alu i ai?",
      "hud.arrived": "Ua e taunuu i {name}"
    }
  },
  "en": { "name": "English", "strings": { "hud.noDestination": "Where to today?" } }
}
```

Keys are the ids in `en.js`; anything not translated falls back to English.
The app registers these at boot, lists them in the picker's language menu,
and honours `?lang=<code>`, the stored preference, then the browser's
languages.
