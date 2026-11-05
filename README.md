# CountMyWords

Free text tools that run in your browser: Word Counter, Character Counter,
Case Converter, Sentence Counter and Reading Time Calculator. No account,
no sign-up, no server — text is counted on the visitor's own device.

Live site: https://datawithsaqib.github.io/countmywords/

Note: this version is a cleanup of the first single-page build — all
internal research notes were removed from the public pages.

## Files

- `index.html` — homepage (Word Counter)
- `word-counter/` — Word Counter page
- `character-counter/` — Character Counter page
- `case-converter/` — Case Converter page
- `sentence-counter/` — Sentence Counter page
- `reading-time-calculator/` — Reading Time Calculator page
- `about/`, `contact/`, `privacy/`, `terms/` — information pages
- `assets/style.css` — shared styles (no external fonts or scripts)
- `assets/app.js` — shared counting logic (no dependencies)
- `sitemap.xml`, `robots.txt` — search engine files

## How it works

There is no build step and no cost. Every page is a plain HTML file that
links the shared `assets/style.css` and `assets/app.js`. All links inside
the site are relative, so the site works under the GitHub Pages project
path `/countmywords/` and direct visits / refreshes work on every page.

Counting rules (see `assets/app.js`):

- Words: letters and numbers, with internal apostrophes and hyphens kept
  (`don't` = 1 word, `well-known` = 1 word, numbers count, Unicode counts).
  Decimals such as `3.14` count as one word, and a standalone emoji token
  counts as one word, as in Word/Google Docs (`Hello 😀` = 2 words).
- Characters: Unicode grapheme counting via `Intl.Segmenter` (grapheme),
  with an `Array.from` fallback. `Hello 😀` = 7 characters including the
  space, 6 without it.
- Sentences: `Intl.Segmenter` (sentence) when available, with a fallback
  that does not split decimals such as 3.14. Empty text = 0 sentences;
  text with words but no end mark = 1 sentence.
- Paragraphs: non-empty blocks separated by blank lines.
- Reading time: words / 200 per minute; speaking time: words / 130 per
  minute. Both are labelled as estimates.

## Edit

Edit any HTML file in a text editor, and edit the shared styles in
`assets/style.css` or the counting logic in `assets/app.js`. Keep links
relative (for example `../assets/style.css` from a sub-page) so the site
keeps working on GitHub Pages.

## Deploy (GitHub Pages)

1. Push these files to the `main` branch of the repository
   `datawithsaqib/countmywords`.
2. In the repository, go to Settings → Pages.
3. Under Build and deployment, set Source to **Deploy from a branch**,
   Branch to **main**, Folder to **/(root)**, then Save.
4. After a minute or two the site is live at
   https://datawithsaqib.github.io/countmywords/

## Test

Open each tool page in a browser (desktop and mobile) and check:

- `Hello world!` → 2 words, 12 characters including the space,
  11 without it, 1 sentence, 1 paragraph.
- `Hello 😀` → 2 words, 7 characters including the space, 6 without it.
- `Hello world. How are you? I am fine!` → 8 words, 3 sentences,
  1 paragraph.
- Copy and Clear buttons, empty input, and a long pasted text.
- Direct URLs and refresh on every tool page.
