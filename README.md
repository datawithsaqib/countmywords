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

- Words: `Intl.Segmenter` (word) with `isWordLike` where supported.
  Segments joined by one internal apostrophe or hyphen are merged
  (`don't` = 1 word, `well-known` = 1 word). Numbers count, decimals
  such as `3.14` and numbers such as `1,000` count as one word, and a
  standalone emoji token counts as one word, as in Word/Google Docs
  (`Hello 😀` = 2 words). Chinese/Japanese are counted by the
  Segmenter word units (你好世界 = 2 words) — approximate, not exact.
  Fallback (no `Intl.Segmenter`): a letter/number regex; a run of
  Chinese/Japanese characters then counts as 1 word.
- Characters: Unicode grapheme counting via `Intl.Segmenter`
  (grapheme), with a proper grapheme-cluster fallback (combining
  marks, ZWJ sequences, flag pairs, skin tones, keycaps) — NOT
  `Array.from` / `.length`. `Hello 😀` = 7 characters including the
  space, 6 without it. 👨‍👩‍👧‍👦 = 1, 🇵🇰 = 1, é = 1 even with a
  combining accent. "Chars, no spaces" removes all whitespace.
- Sentences: `Intl.Segmenter` (sentence) when available, with a
  fallback that does not split decimals such as 3.14. Titles
  (Dr., Mr.) and e.g./i.e. are merged with the following sentence;
  abbreviations that can end a sentence (p.m., U.S.) are a known
  limitation — see the Sentence Counter page. Empty text = 0
  sentences; text with words but no end mark = 1 sentence.
- Paragraphs: non-empty blocks separated by blank lines.
- Reading time: words / reading speed (Slow 150, Normal 200,
  Fast 250 words per minute — the choice is on the Reading Time
  Calculator page only; other pages use 200). Speaking time:
  words / 130 per minute. Both are labelled as estimates; empty
  text = 0 min.
- Case converter: locale-aware (`toLocaleUpperCase` /
  `toLocaleLowerCase`, using the visitor's browser locale) for
  Turkish I/ı and Greek letters; ß uppercases to SS. An apostrophe
  inside a word is removed, not split (`don't` → `dontStop`).
  Names with an internal capital (McDonald, iPhone) are split at
  that capital by the camelCase splitter — see the Case Converter
  page.

## Search Console (already verified)

Ownership of https://datawithsaqib.github.io/countmywords/ was
verified on 5 Nov 2026 with the HTML file
`googled462ea83888bcba5.html` in the repository root — do not
delete that file. The sitemap
https://datawithsaqib.github.io/countmywords/sitemap.xml was
submitted the same day; Google first reported "Couldn't fetch"
(the file itself returns 200 and is valid XML — it was a first-try
fetch failure). If it still says "Couldn't fetch", resubmit it in
Search Console under Indexing → Sitemaps. As of the morning of
6 Nov 2026, Google showed 0 indexed pages and Performance said
"Processing data" — indexing had not happened yet. Do not claim
indexing or traffic until Search Console shows it.

To verify ownership again (if ever needed): in Search Console,
add the property `https://datawithsaqib.github.io/countmywords/`,
choose the HTML-file method, download the file, place it in the
repository root, push, wait for the live URL to return 200, then
press Verify. Then submit `sitemap.xml` under Sitemaps.

## Analytics (not connected — disabled by default)

There is no analytics on this site and no tracking ID anywhere in
the code. Do not invent a Google Analytics 4 Measurement ID.

To add GA4 later, the owner must:

1. Create a GA4 property at analytics.google.com and get a real
   Measurement ID (looks like `G-XXXXXXXXXX`).
2. Add the official Google tag (`gtag.js`) with that ID to every
   page, just before `</head>`, or through a shared include.
3. Update `privacy/index.html`: state that Google Analytics is used,
   what it collects, and link to Google's privacy policy and opt-out.
4. Push, wait for deployment, and check in GA4 Realtime that visits
   are recorded before claiming analytics works.

Until those steps are done, report traffic only from Search Console
(which is verified) and never invent visitor numbers.

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
- Graphemes: 👨‍👩‍👧‍👦 = 1 character, 🇵🇰 = 1, 👍🏽 = 1, é = 1
  (including e + combining accent), 1️⃣ = 1.
- International: 你好世界 = 2 words, 4 characters;
  こんにちは世界 = 2 words, 7 characters; `café naïve façade` =
  3 words; `İstanbul Ankara ıspanak` = 3 words;
  `مرحبا بالعالم` = 2 words. (In a browser without
  `Intl.Segmenter`, Chinese/Japanese count as 1 word per unbroken
  run — see Counting rules above.)
- Abbreviations: `Dr. Smith left. He paid $3.14.` = 2 sentences;
  `Mr. Jones met Dr. Lee at 3 p.m. He left.` = 2 sentences.
  Known limitation: `He lives in the U.S. He left.` may count as 3.
- Case converter: `don't stop` → camelCase `dontStop`,
  snake_case `dont_stop`; `well-known fact` → Title Case
  `Well-Known Fact`; `helloWorldTest` → PascalCase `HelloWorldTest`.
- Reading speed: on the Reading Time Calculator page, 300 words at
  Slow (150 wpm) = 2 min, at Fast (250 wpm) = 1 min; empty text = 0 min.
- Copy and Clear buttons, empty input, and a long pasted text
  (5,000 words counts in well under a second — the counters run on
  every keystroke with no network call).
- Direct URLs and refresh on every tool page.

Automated check (Node 18+): the counting logic in `assets/app.js`
can be run with a small DOM stub; see the test results in the
project notes. `node --check assets/app.js` must pass. No
live-browser visual test has been done by an agent — check the
live site on a real phone and desktop browser after deploying.
