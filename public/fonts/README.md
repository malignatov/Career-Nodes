# Bundled fonts

Self-hosted so the desktop app renders correctly **offline** — a missed Google
Fonts fetch used to drop Cyrillic text to a serif fallback (Karla carries no
Cyrillic glyphs; Manrope is the Cyrillic-capable partner in every sans stack).

| Family | Role | Cyrillic |
|---|---|---|
| **Karla** | UI / chrome (Latin) | no — falls through to Manrope |
| **Manrope** | UI / chrome (Cyrillic) | yes |
| **Lora** | titles, node names, counselor voice, captions | yes |

The `.woff2` files and `../fonts.css` were generated from the Google Fonts
CSS2 API (`scripts/`-free, one-off): the API's `@font-face` blocks were fetched
with a desktop UA and their `fonts.gstatic.com` URLs rewritten to `/fonts/…`.
Subsetting and `unicode-range` splits are Google's own, so only the subsets a
page actually needs get downloaded.

## License

All three families are licensed under the **SIL Open Font License 1.1**
(OFL-1.1), which permits bundling and redistribution:

- Karla — https://fonts.google.com/specimen/Karla
- Manrope — https://fonts.google.com/specimen/Manrope
- Lora — https://fonts.google.com/specimen/Lora

Full license text: https://openfontlicense.org/

The OFL applies to these font files only; the rest of this project is MIT
(see the repository `LICENSE`).

## Regenerating

If a family or weight changes, re-fetch the CSS2 URL with a browser
User-Agent, download the referenced `.woff2` files into this directory, and
rewrite the URLs in `public/fonts.css` to `/fonts/<file>`.
