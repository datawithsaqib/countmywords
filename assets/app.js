/* CountMyWords — shared counting logic. No dependencies.
   All counting happens in the browser. Text is never uploaded or stored.
   Analytics: none built in. See README.md for the (disabled) GA4 notes. */
(function () {
  'use strict';

  /* ---------- Grapheme counting ---------- */
  // One visible character = one grapheme cluster.
  // "Hello 😀" = 7 graphemes (H e l l o space 😀). A family emoji joined
  // with ZWJ (👨‍👩‍👧‍👦), a flag (🇵🇰), a skin-tone emoji (👍🏽) and a letter
  // with a combining accent (é, even as e + U+0301) each count as 1.
  var graphemeSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }
  } catch (e) { graphemeSegmenter = null; }

  // Characters that extend the previous grapheme in the fallback:
  // combining marks, variation selectors, skin-tone modifiers, the
  // keycap mark (U+20E3) and tag characters.
  var GRAPHEME_EXTEND_RE = /[\p{Mn}\p{Me}\p{Mc}\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}\u20E3\u{E0020}-\u{E007F}]/u;
  var REGIONAL_INDICATOR_RE = /[\u{1F1E6}-\u{1F1FF}]/u;
  var ZWJ = '\u200D';

  // Proper grapheme-cluster fallback (NOT Array.from / .length, which
  // would count a flag as 2, a ZWJ family as 4+ and a combining accent
  // as a separate character). This is a simplified UAX #29 walk: it
  // joins combining marks, variation selectors, skin tones and keycap
  // marks to the base character, joins ZWJ sequences, and pairs
  // regional indicators into flags. It is approximate for scripts with
  // complex conjunct rules (e.g. some Indic clusters); Intl.Segmenter
  // is the primary path and is correct there.
  function graphemeClustersFallback(text) {
    var cps = Array.from(text); // code points, used only to iterate
    var clusters = [];
    var i = 0;
    while (i < cps.length) {
      var cluster = cps[i];
      var riCount = REGIONAL_INDICATOR_RE.test(cps[i]) ? 1 : 0;
      i++;
      var afterZwj = false;
      while (i < cps.length) {
        var cp = cps[i];
        if (afterZwj) {
          // The character after a ZWJ always joins the cluster.
          afterZwj = false;
          riCount = REGIONAL_INDICATOR_RE.test(cp) ? 1 : 0;
          cluster += cp; i++; continue;
        }
        if (cp === ZWJ) { afterZwj = true; cluster += cp; i++; continue; }
        if (GRAPHEME_EXTEND_RE.test(cp)) { cluster += cp; i++; continue; }
        // Regional indicators pair up: the second one joins, a third
        // one starts a new flag.
        if (REGIONAL_INDICATOR_RE.test(cp) && riCount === 1) {
          riCount = 2; cluster += cp; i++; continue;
        }
        break;
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  function graphemeClusters(text) {
    if (graphemeSegmenter) {
      var out = [];
      var it = graphemeSegmenter.segment(text);
      for (var seg of it) out.push(seg.segment);
      return out;
    }
    return graphemeClustersFallback(text);
  }

  function countGraphemes(text) {
    if (!text) return 0;
    return graphemeClusters(text).length;
  }

  function countChars(text) {
    return countGraphemes(text);
  }

  function countCharsNoSpaces(text) {
    // "Chars, no spaces" removes all whitespace, including line breaks.
    return countGraphemes(text.replace(/\s/g, ''));
  }

  function countCodePoints(text) {
    if (!text) return 0;
    return Array.from(text).length;
  }

  function countUtf8Bytes(text) {
    if (!text) return 0;
    try {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    } catch (e) { /* fall through */ }
    return unescape(encodeURIComponent(text)).length;
  }

  // X (Twitter) weighted count, simplified: most visible characters
  // count 1, an emoji counts 2, and a web link counts 23 characters
  // (the length of a shortened t.co link). This is an approximation
  // of X's published weighting rules, not X's own counter — always
  // check the count in X itself before posting.
  function xWeightedCount(text) {
    if (!text) return 0;
    var clusters = graphemeClusters(text);
    var n = 0, i;
    for (i = 0; i < clusters.length; i++) {
      n += /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u.test(clusters[i]) ? 2 : 1;
    }
    var urls = text.match(/https?:\/\/\S+/g) || [];
    for (i = 0; i < urls.length; i++) {
      n += 23 - countGraphemes(urls[i]);
    }
    return n < 0 ? 0 : n;
  }

  // Character breakdown: each visible character is classed once, in
  // this order — whitespace, emoji, letter, digit, punctuation, then
  // anything else (symbols, currency signs, maths signs, and so on).
  function charBreakdown(text) {
    var b = { letters: 0, digits: 0, spaces: 0, punct: 0, emoji: 0, symbols: 0 };
    if (!text) return b;
    var clusters = graphemeClusters(text);
    for (var i = 0; i < clusters.length; i++) {
      var c = clusters[i];
      if (/\s/.test(c)) b.spaces++;
      else if (/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u.test(c)) b.emoji++;
      else if (/\p{L}/u.test(c)) b.letters++;
      else if (/\p{N}/u.test(c)) b.digits++;
      else if (/\p{P}/u.test(c)) b.punct++;
      else b.symbols++;
    }
    return b;
  }

  /* ---------- Word counting ---------- */
  // Primary: Intl.Segmenter with granularity "word", using isWordLike.
  // That handles space-separated languages and, unlike a letter-run
  // regex, splits Chinese/Japanese text into word units
  // (e.g. 你好世界 = 你好 + 世界 = 2 words). Convention, documented on
  // the Word Counter page: for Chinese/Japanese the count is the
  // Segmenter word count, not the character count, and it is
  // approximate — no word counter can be exact for every language.
  // Two Segmenter behaviours are corrected to match Word/Google Docs
  // and the documented convention: word-like segments joined by a
  // single internal apostrophe or hyphen (don't, well-known) are merged
  // into one word, and a decimal such as 3.14 is already one segment.
  // A dotted abbreviation such as p.m. counts as one word.
  // Fallback (no Intl.Segmenter): the previous regex, which treats a
  // run of letters/numbers as one word — so Chinese/Japanese text
  // counts as 1 word per unbroken run in old browsers. That difference
  // is documented on the Word Counter page.
  // Combining marks after a letter stay attached to it, so a letter
  // written with a combining accent (e + U+0301) is one word, not two.
  var WORD_RE = /[\p{L}\p{N}]+(?:,\d{3})*[\p{M}]*(?:['’\-][\p{L}\p{N}]+)*(?:\.(?:\d+|\p{L}{1,3}))*/gu;

  var wordSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    }
  } catch (e) { wordSegmenter = null; }

  function standaloneEmojiTokens(text) {
    // A whitespace-separated token with no letter or number that
    // contains an emoji/pictograph counts once, as in Word/Google Docs:
    // "Hello 😀" = 2 words. Pure punctuation ("—") and currency ("$")
    // do not count.
    var tokens = text.split(/\s+/);
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t && !/[\p{L}\p{N}]/u.test(t) &&
          /[\p{So}\u{1F1E6}-\u{1F1FF}]|\p{Extended_Pictographic}/u.test(t)) {
        out.push(t);
      }
    }
    return out;
  }

  function wordTokens(text) {
    if (!text) return [];
    var tokens;
    if (wordSegmenter) {
      var segs = [];
      var it = wordSegmenter.segment(text);
      for (var s of it) { if (s.isWordLike) segs.push(s); }
      tokens = [];
      for (var i = 0; i < segs.length; i++) {
        var cur = segs[i];
        while (i + 1 < segs.length) {
          var nxt = segs[i + 1];
          var gapStart = cur.index + cur.segment.length;
          var gap = text.slice(gapStart, nxt.index);
          if ((gap === "'" || gap === '’' || gap === '-') && nxt.index === gapStart + 1) {
            cur = { segment: cur.segment + gap + nxt.segment, index: cur.index };
            i++;
          } else break;
        }
        tokens.push(cur.segment);
      }
    } else {
      var m = text.match(WORD_RE);
      tokens = m ? m.slice() : [];
    }
    return tokens.concat(standaloneEmojiTokens(text));
  }

  function countWords(text) {
    return wordTokens(text).length;
  }

  function uniqueWordCount(text) {
    var tokens = wordTokens(text);
    var seen = {};
    var n = 0;
    for (var i = 0; i < tokens.length; i++) {
      var k = tokens[i].toLocaleLowerCase();
      if (!seen[k]) { seen[k] = true; n++; }
    }
    return n;
  }

  function averageWordLength(text) {
    var tokens = wordTokens(text);
    if (!tokens.length) return 0;
    var total = 0;
    for (var i = 0; i < tokens.length; i++) total += countGraphemes(tokens[i]);
    return total / tokens.length;
  }

  /* ---------- Sentences and paragraphs ---------- */
  // Sentence splitting. Intl.Segmenter (modern browsers) already
  // handles the hard cases correctly — "He lives in the U.S. He
  // left." is 2 sentences, "It is 3 p.m. He left." is 2, and
  // "He lives in the U.S. today." is 1 — but it splits in two places
  // it should not: single-letter initials ("J. R. R. Tolkien" comes
  // out as separate segments) and titles such as "Dr.", and it splits
  // "The U.S. Government announced…" after "U.S." even though
  // "U.S." there is an adjective, not the end of a sentence. So the
  // Segmenter result is post-processed: a segment ending in a title
  // (Dr., Mr., …), in "e.g." / "i.e.", in a single-letter initial
  // ("J."), or in "U.S." / "U.K." / "U.S.A." when the next segment
  // starts with a word that commonly follows it as an adjective
  // (Government, Senate, Congress, Army, President, Department,
  // Supreme, Federal, Treasury, State, House, Court, …) is merged
  // with the next segment. The fallback (no Intl.Segmenter) protects
  // the same abbreviations and decimals before splitting on . ! ? …
  // and applies the same merge. Remaining limitation, documented on
  // the Sentence Counter page: an abbreviation the counter does not
  // know, or "U.S." before a capitalised word that is not in the
  // adjective list, can still be miscounted. Sentence counting is a
  // guide to the shape of your writing, not a grammar check.
  var sentenceSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    }
  } catch (e) { sentenceSegmenter = null; }

  var US_ADJECTIVE_WORDS = ['government', 'senate', 'congress', 'army', 'navy', 'air', 'president', 'department', 'supreme', 'federal', 'treasury', 'state', 'house', 'court', 'constitution', 'economy', 'military', 'embassy', 'citizens', 'passport', 'postal', 'border', 'trade', 'defence', 'defense', 'intelligence', 'attorney', 'marshal', 'capitol'];

  function firstWord(segment) {
    var m = segment.trim().match(/^[\p{L}][\p{L}'’\-]*/u);
    return m ? m[0].toLocaleLowerCase() : '';
  }

  function endsWithAbbreviation(segment) {
    var t = segment.trim();
    if (!t) return false;
    var last = t.split(/\s+/).pop();
    // Titles and e.g./i.e. never end a sentence.
    if (/^(?:Dr|Mr|Mrs|Ms|St|Sr|Jr|Prof|Capt|Lt|Col|Gen|Sgt|Rev|Hon|Mt|Ft)\.$/i.test(last)) return true;
    if (/^(?:e\.g\.|i\.e\.)$/i.test(last)) return true;
    // A single-letter initial ("J.", "R.") never ends a sentence
    // on its own — it belongs to the name that follows it.
    if (/^[A-Z]\.$/.test(last)) return true;
    return false;
  }

  function endsWithUsAdjective(segment, nextSegment) {
    var t = segment.trim();
    if (!t) return false;
    var last = t.split(/\s+/).pop();
    if (!/^(?:U\.S\.|U\.K\.|U\.S\.A\.)$/i.test(last)) return false;
    return US_ADJECTIVE_WORDS.indexOf(firstWord(nextSegment || '')) !== -1;
  }

  function mergeAbbreviationSegments(segments) {
    var out = [];
    for (var i = 0; i < segments.length; i++) {
      if (out.length > 0 &&
          (endsWithAbbreviation(out[out.length - 1]) ||
           endsWithUsAdjective(out[out.length - 1], segments[i]))) {
        out[out.length - 1] += segments[i];
      } else {
        out.push(segments[i]);
      }
    }
    return out;
  }

  function splitSentences(text) {
    if (!text || !text.trim()) return [];
    var segments, merged, i;
    if (sentenceSegmenter) {
      segments = [];
      var it = sentenceSegmenter.segment(text);
      for (var seg of it) segments.push(seg.segment);
      merged = mergeAbbreviationSegments(segments);
      return merged.map(function (s) { return s.trim(); })
        .filter(function (s) { return /[\p{L}\p{N}]/u.test(s); });
    }
    // Fallback: protect dots that are not sentence ends, then split.
    var protectedText = text
      .replace(/(\d)\.(\d)/g, '$1\u0001$2')
      .replace(/\b(?:Dr|Mr|Mrs|Ms|St|Sr|Jr|Prof|Capt|Lt|Col|Gen|Sgt|Rev|Hon|Mt|Ft|e\.g|i\.e)\./g, function (m) {
        return m.replace(/\./g, '\u0001');
      })
      .replace(/\b[A-Z]\.(?=\s+[A-Z])/g, function (m) { return m.replace('.', '\u0001'); })
      // U.S. / U.K. / p.m. / a.m.: protect the dots when the next
      // word starts with a small letter (mid-sentence) or is a word
      // that commonly follows as an adjective; otherwise leave the
      // dots as a sentence end.
      .replace(/\b(?:U\.S\.A?\.|U\.K\.|p\.m\.|a\.m\.)(?=\s|$)/g, function (m, off, full) {
        var rest = full.slice(off + m.length).replace(/^\s+/, '');
        var next = (rest.match(/^[\p{L}][\p{L}'’\-]*/u) || [''])[0].toLocaleLowerCase();
        var lower = next && next[0] === next[0].toLocaleLowerCase() && next[0] !== next[0].toLocaleUpperCase();
        if (lower || US_ADJECTIVE_WORDS.indexOf(next) !== -1) return m.replace(/\./g, '\u0001');
        return m;
      });
    var parts = protectedText.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [];
    merged = mergeAbbreviationSegments(parts);
    var out = [];
    for (i = 0; i < merged.length; i++) {
      var s = merged[i].replace(/\u0001/g, '.').trim();
      if (/[\p{L}\p{N}]/u.test(s)) out.push(s);
    }
    return out;
  }

  function countSentences(text, wordCount) {
    return splitSentences(text).length;
  }

  // Paragraphs: non-empty blocks separated by blank lines.
  function countParagraphs(text) {
    if (!text || !text.trim()) return 0;
    var parts = text.split(/\n\s*\n/).filter(function (p) { return p.trim() !== ''; });
    return parts.length;
  }

  function longestWord(text) {
    var tokens = wordTokens(text);
    if (!tokens.length) return '—';
    var longest = tokens[0];
    for (var i = 1; i < tokens.length; i++) {
      if (countGraphemes(tokens[i]) > countGraphemes(longest)) longest = tokens[i];
    }
    var clusters = graphemeClusters(longest);
    return clusters.length > 18 ? clusters.slice(0, 18).join('') + '…' : longest;
  }

  function truncate(s, n) {
    var clusters = graphemeClusters(s);
    return clusters.length > n ? clusters.slice(0, n).join('') + '…' : s;
  }

  /* ---------- Reading / speaking time ---------- */
  // Estimates only. Reading defaults to 200 words per minute; the
  // Reading Time Calculator page offers Slow (150), Normal (200),
  // Fast (250) and Research (238, Brysbaert 2019 — see the page),
  // plus a custom speed from 50 to 1000 words per minute. Other
  // pages have no speed control and always use 200. Speaking defaults
  // to about 130 words per minute, with a custom field (50–300) on
  // the reading-time page.
  function readSpeed() {
    var custom = document.getElementById('readSpeedCustom');
    if (custom && custom.value !== '') {
      var cv = parseInt(custom.value, 10);
      if (cv >= 50 && cv <= 1000) return cv;
    }
    var sel = document.getElementById('readSpeed');
    if (sel) {
      var v = parseInt(sel.value, 10);
      if (v > 0) return v;
    }
    return 200;
  }
  function speakSpeed() {
    var custom = document.getElementById('speakSpeedCustom');
    if (custom && custom.value !== '') {
      var cv = parseInt(custom.value, 10);
      if (cv >= 50 && cv <= 300) return cv;
    }
    return 130;
  }
  function plural(n, word) {
    return n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's');
  }
  // Minutes + seconds, never whole minutes only: 200 words at
  // 200 wpm is "1 min", 250 words is "1 min 15 sec", 45 words is
  // "14 sec" (at 200 wpm).
  function fmtTime(mins) {
    if (!mins || mins <= 0) return '0 sec';
    var s = Math.round(mins * 60);
    if (s < 60) return s + (s === 1 ? ' second' : ' seconds');
    var m = Math.floor(s / 60), r = s % 60;
    return r ? m + ' min ' + r + ' sec' : m + ' min';
  }
  function fmtSeconds(mins) {
    return fmtTime(mins);
  }

  // Alternative inputs on the reading-time page: a word count typed
  // in directly takes priority, then a page count (1 page = about
  // 250 words, double-spaced — the guide used across this site),
  // then the words in the text box.
  function effectiveWords(text) {
    var wc = document.getElementById('wordCountInput');
    if (wc && wc.value !== '') {
      var w = parseInt(wc.value, 10);
      if (w > 0) return { words: w, source: 'word-count input' };
    }
    var pc = document.getElementById('pageCountInput');
    if (pc && pc.value !== '') {
      var p = parseFloat(pc.value);
      if (p > 0) return { words: Math.round(p * 250), source: 'page count (' + p + ' pages at about 250 words per page, double-spaced)' };
    }
    return { words: countWords(text), source: 'text box' };
  }

  /* ---------- Case conversion (Unicode-aware) ---------- */
  // Locale-aware conversion: toLocaleUpperCase / toLocaleLowerCase
  // use the visitor's browser locale, so Turkish dotted/dotless I and
  // Greek final sigma are handled as that locale expects, instead of
  // always using English rules. "ß".toLocaleUpperCase() is "SS".
  // Known trade-off, documented on the Case Converter page: names
  // with an internal capital (McDonald, iPhone) are split at that
  // capital by the camelCase splitter, so snake_case gives
  // "mc_donald" / "i_phone". That is what the camel-boundary split
  // means; check names before using them as code or file names.
  function splitWords(s) {
    // An apostrophe inside a word ("don't") is removed first, so it
    // does not split the word: "don't" -> "dont", not "don" + "t".
    // Hyphens and other punctuation still split words, which is what
    // camelCase / snake_case / kebab-case require.
    var cleaned = s.replace(/([\p{L}\p{N}])['’]([\p{L}\p{N}])/gu, '$1$2');
    return cleaned.split(/[^\p{L}\p{N}]+/u)
      .flatMap(function (p) { return p.split(/(?<=[\p{Ll}\p{N}])(?=[\p{Lu}])/u); })
      .filter(Boolean);
  }
  function capWord(w) {
    if (!w) return w;
    var first = Array.from(w)[0];
    return first.toLocaleUpperCase() + w.slice(first.length);
  }
  function toTitle(s) {
    // Capitalise the first letter of each word, including after a
    // hyphen ("well-known" -> "Well-Known"). Small words such as
    // "and" / "of" / "the" are also capitalised — check a title
    // against your style guide if it keeps them small.
    return s.toLocaleLowerCase().replace(/(^|[\s\(\["“\-])(\S)/gu, function (m, p, c) {
      return p + c.toLocaleUpperCase();
    });
  }
  function convertCase(s, mode) {
    var w, out = s;
    if (mode === 'upper') out = s.toLocaleUpperCase();
    else if (mode === 'lower') out = s.toLocaleLowerCase();
    else if (mode === 'title') out = toTitle(s);
    else if (mode === 'sentence') {
      out = s.toLocaleLowerCase().replace(/(^\s*[\p{L}])|([.!?]\s+[\p{L}])/gu, function (m) {
        return m.toLocaleUpperCase();
      });
    }
    else if (mode === 'camel') {
      // Split before lowercasing: lowercasing first would destroy the
      // camelCase boundaries that splitWords needs to see.
      w = splitWords(s).map(function (x) { return x.toLocaleLowerCase(); });
      out = w.map(function (x, i) { return i === 0 ? x : capWord(x); }).join('');
    }
    else if (mode === 'pascal') {
      w = splitWords(s).map(function (x) { return x.toLocaleLowerCase(); });
      out = w.map(capWord).join('');
    }
    else if (mode === 'snake') {
      w = splitWords(s).map(function (x) { return x.toLocaleLowerCase(); });
      out = w.join('_');
    }
    else if (mode === 'kebab') {
      w = splitWords(s).map(function (x) { return x.toLocaleLowerCase(); });
      out = w.join('-');
    }
    else if (mode === 'constant') {
      w = splitWords(s).map(function (x) { return x.toLocaleLowerCase(); });
      out = w.join('_').toLocaleUpperCase();
    }
    else if (mode === 'alternating') {
      // First letter small, then alternate per letter; spaces and
      // punctuation stay as they are and do not change the pattern.
      // "hello world" -> "hElLo WoRlD".
      var upper = false, res = '';
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (/\p{L}/u.test(ch)) { res += upper ? ch.toLocaleUpperCase() : ch.toLocaleLowerCase(); upper = !upper; }
        else res += ch;
      }
      out = res;
    }
    return out;
  }

  /* ---------- Page wiring ---------- */
  var ta = document.getElementById('mainText');
  if (!ta) return;

  function set(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  function setBar(fillId, textId, value, limit) {
    var fill = document.getElementById(fillId);
    var txt = document.getElementById(textId);
    if (fill) {
      var pct = limit > 0 ? Math.min(100, (value / limit) * 100) : 0;
      fill.style.width = pct + '%';
      fill.classList.toggle('over', value > limit);
      fill.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
    if (txt) {
      var over = value > limit ? ' — over by ' + (value - limit).toLocaleString() : ' — ' + (limit - value).toLocaleString() + ' left';
      txt.textContent = value.toLocaleString() + ' / ' + limit.toLocaleString() + (value === 0 ? '' : over);
    }
  }

  var selectedGoal = null;

  function updateWordGoal(words) {
    var fill = document.getElementById('goalProgressFill');
    if (!fill) return;
    var textEl = document.getElementById('goalProgressText');
    var safeEl = document.getElementById('goalSafeText');
    if (!selectedGoal) {
      fill.style.width = '0%';
      if (textEl) textEl.textContent = 'Choose a word goal above to track your progress.';
      if (safeEl) safeEl.textContent = '';
      return;
    }
    var goal = selectedGoal;
    var pct = Math.min(100, (words / goal) * 100);
    fill.style.width = pct + '%';
    fill.classList.toggle('over', words > goal * 1.1);
    var low = Math.round(goal * 0.9), high = Math.round(goal * 1.1);
    var status = words < low ? 'Below the safe zone — add about ' + (low - words).toLocaleString() + ' words to reach it.'
      : words > high ? 'Above the safe zone — cut about ' + (words - high).toLocaleString() + ' words to get back inside it.'
      : 'Inside the safe zone.';
    if (textEl) textEl.textContent = words.toLocaleString() + ' / ' + goal.toLocaleString() + ' words (' + Math.round((words / goal) * 100) + '%) — ' + status;
    if (safeEl) safeEl.textContent = 'Safe zone (±10%): ' + low.toLocaleString() + '–' + high.toLocaleString() + ' words.';
  }

  function updateSentencePanel(text, words, sentences) {
    var listEl = document.getElementById('sentenceList');
    if (!listEl) return;
    var sents = splitSentences(text);
    var avg = sents.length ? (words / sents.length) : 0;
    set('stAvgSent', sents.length ? avg.toFixed(1) : '0');
    if (sents.length) {
      var withCounts = sents.map(function (s) { return { text: s, words: countWords(s) }; });
      var longest = withCounts[0], shortest = withCounts[0];
      withCounts.forEach(function (sc) {
        if (sc.words > longest.words) longest = sc;
        if (sc.words < shortest.words) shortest = sc;
      });
      set('stLongestSent', longest.words + ' words');
      set('stLongestSentPreview', truncate(longest.text, 120));
      set('stShortestSent', shortest.words + ' words');
      set('stShortestSentPreview', truncate(shortest.text, 120));
      var shown = withCounts.slice(0, 200);
      var html = '<ol>';
      shown.forEach(function (sc, i) {
        var flag = sc.words > 25 ? ' <strong class="long-flag">Long — over 25 words</strong>' : '';
        html += '<li><strong>(' + sc.words + (sc.words === 1 ? ' word' : ' words') + ')</strong>' + flag + '<br/>' + escapeHtml(sc.text) + '</li>';
      });
      html += '</ol>';
      if (withCounts.length > 200) html += '<p class="small">Showing the first 200 of ' + withCounts.length + ' sentences.</p>';
      listEl.innerHTML = html;
    } else {
      set('stLongestSent', '—'); set('stLongestSentPreview', '');
      set('stShortestSent', '—'); set('stShortestSentPreview', '');
      listEl.innerHTML = '<p class="small">Type or paste text to see each sentence listed here, with its word count.</p>';
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function sentenceReportText(text) {
    var sents = splitSentences(text);
    var lines = ['Sentence report — CountMyWords', ''];
    lines.push('Total sentences: ' + sents.length);
    lines.push('Total words: ' + countWords(text));
    lines.push('Average words per sentence: ' + (sents.length ? (countWords(text) / sents.length).toFixed(1) : '0'));
    lines.push('');
    sents.forEach(function (s, i) {
      var n = countWords(s);
      lines.push('#' + (i + 1) + ' (' + n + (n === 1 ? ' word' : ' words') + ')' + (n > 25 ? ' — LONG (over 25 words)' : '') + ': ' + s);
    });
    return lines.join('\n');
  }

  function updateCaseCards() {
    var modes = ['upper', 'lower', 'title', 'sentence', 'camel', 'pascal', 'snake', 'kebab', 'constant', 'alternating'];
    var any = false;
    modes.forEach(function (mode) {
      var el = document.getElementById('casePrev' + mode.charAt(0).toUpperCase() + mode.slice(1));
      if (el) { any = true; el.textContent = ta.value ? convertCase(ta.value, mode) : '—'; }
    });
    return any;
  }

  function update() {
    var text = ta.value;
    var eff = effectiveWords(text);
    var words = eff.words;
    var textWords = countWords(text);
    var sentences = countSentences(text, textWords);
    var speed = readSpeed();
    var speak = speakSpeed();
    var readMins = words / speed;
    var speakMins = words / speak;
    var chars = countChars(text);
    var charsNo = countCharsNoSpaces(text);
    set('stWords', words.toLocaleString());
    set('stChars', chars.toLocaleString());
    set('stCharsNo', charsNo.toLocaleString());
    set('stSent', sentences.toLocaleString());
    set('stPara', countParagraphs(text).toLocaleString());
    set('stRead', fmtTime(readMins));
    set('stSpeak', fmtTime(speakMins));
    set('stLong', longestWord(text));
    set('stUniqueWords', uniqueWordCount(text).toLocaleString());
    set('stLongestWord', longestWord(text));
    set('stAvgWordLen', textWords ? averageWordLength(text).toFixed(1) : '0');
    set('stReadDetail', words === 0 ? 'Enter text to see an estimate.' :
      'About ' + fmtSeconds(readMins) + ' to read (' + plural(words, 'word') + ' at about ' + speed + ' words per minute, from the ' + eff.source + ').');
    set('stSpeakDetail', words === 0 ? '' :
      'About ' + fmtSeconds(speakMins) + ' to speak aloud (' + plural(words, 'word') + ' at about ' + speak + ' words per minute).');
    // Word-goal progress (word counter page).
    updateWordGoal(words);
    // Platform limit bars — character count is what the limits count.
    setBar('limitXFill', 'limitXText', chars, 280);
    setBar('limitInstagramFill', 'limitInstagramText', chars, 2200);
    setBar('limitLinkedInFill', 'limitLinkedInText', chars, 3000);
    setBar('limitMetaFill', 'limitMetaText', chars, 160);
    setBar('limitSmsFill', 'limitSmsText', chars, 160);
    // Character page: X-weighted count and SMS segments.
    var weighted = xWeightedCount(text);
    set('stXWeighted', weighted.toLocaleString());
    var hasNonGsm = /[^\u0000-\u007F]/.test(text) || /[\p{Extended_Pictographic}]/u.test(text);
    var segSize = hasNonGsm ? 70 : 160;
    set('stSmsSegments', chars === 0 ? '0' : Math.ceil(chars / segSize).toLocaleString() + ' (' + segSize + ' chars each)');
    set('stCodePoints', countCodePoints(text).toLocaleString());
    set('stUtf8Bytes', countUtf8Bytes(text).toLocaleString());
    var bd = charBreakdown(text);
    set('stLetters', bd.letters.toLocaleString());
    set('stDigits', bd.digits.toLocaleString());
    set('stSpaces', bd.spaces.toLocaleString());
    set('stPunct', bd.punct.toLocaleString());
    set('stEmoji', bd.emoji.toLocaleString());
    set('stSymbols', bd.symbols.toLocaleString());
    // Character platform picker (character counter page).
    var picker = document.getElementById('charPlatform');
    if (picker) {
      var limits = { x: 280, sms: 160, instagram: 2200, linkedin: 3000, meta: 160 };
      var lim = limits[picker.value] || 280;
      var val = picker.value === 'x' ? weighted : chars;
      setBar('charPickedFill', 'charPickedText', val, lim);
      var smsNote = document.getElementById('charSmsNote');
      if (smsNote) smsNote.textContent = picker.value === 'sms'
        ? 'One SMS holds ' + segSize + ' characters for this text (' + (hasNonGsm ? '70 because it has emoji or non-Latin characters' : '160 for plain Latin text') + '), so this text needs ' + (chars === 0 ? '0' : Math.ceil(chars / segSize)) + ' message' + (Math.ceil(chars / segSize) === 1 ? '' : 's') + '.'
        : '';
    }
    updateSentencePanel(text, textWords, sentences);
    updateCaseCards();
  }
  ta.addEventListener('input', update);

  // Reading-speed choice and custom speeds (only on the reading-time page).
  var speedSel = document.getElementById('readSpeed');
  if (speedSel) speedSel.addEventListener('change', update);
  ['readSpeedCustom', 'speakSpeedCustom', 'wordCountInput', 'pageCountInput'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', update);
  });

  // Word-goal presets (only on the word counter page).
  document.querySelectorAll('[data-goal]').forEach(function (b) {
    b.addEventListener('click', function () {
      selectedGoal = parseInt(b.dataset.goal, 10);
      document.querySelectorAll('[data-goal]').forEach(function (x) {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      update();
    });
  });

  // Case converter buttons (only on the case converter page).
  // These replace the text in the box, as before; the "all styles"
  // cards below them only preview, and never change the text.
  document.querySelectorAll('[data-case]').forEach(function (b) {
    b.addEventListener('click', function () {
      ta.value = convertCase(ta.value, b.dataset.case);
      update();
      ta.focus();
    });
  });

  // Per-card Copy buttons on the case converter page.
  document.querySelectorAll('[data-copy-case]').forEach(function (b) {
    b.addEventListener('click', function () {
      var out = convertCase(ta.value, b.dataset.copyCase);
      var msg = document.getElementById('caseCopyMsg');
      function done(ok) { if (msg) { msg.textContent = ok ? 'Copied ' + b.dataset.copyCase + ' version.' : 'Copy did not work — select the text and copy it by hand.'; setTimeout(function () { msg.textContent = ''; }, 2500); } }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(out).then(function () { done(true); }, function () { done(false); });
      } else done(false);
    });
  });

  // Batch line-by-line conversion (case converter page).
  var btnBatch = document.getElementById('btnBatchConvert');
  if (btnBatch) {
    btnBatch.addEventListener('click', function () {
      var src = document.getElementById('batchText');
      var sel = document.getElementById('batchCase');
      var outEl = document.getElementById('batchOutput');
      if (!src || !outEl) return;
      var mode = sel ? sel.value : 'snake';
      outEl.value = src.value.split('\n').map(function (line) {
        return line.trim() === '' ? '' : convertCase(line, mode);
      }).join('\n');
    });
  }
  var btnCopyBatch = document.getElementById('btnCopyBatch');
  if (btnCopyBatch) {
    btnCopyBatch.addEventListener('click', function () {
      var outEl = document.getElementById('batchOutput');
      var msg = document.getElementById('batchMsg');
      if (!outEl) return;
      function done(ok) { if (msg) { msg.textContent = ok ? 'Copied batch result.' : 'Copy did not work — select the text and copy it by hand.'; setTimeout(function () { msg.textContent = ''; }, 2500); } }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(outEl.value).then(function () { done(true); }, function () { done(false); });
      } else done(false);
    });
  }

  // File upload for .txt files (sentence and character counter pages).
  // The file is read in the browser only — it is never uploaded.
  function wireFileUpload(inputId, msgId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      var msg = document.getElementById(msgId);
      if (!file) return;
      if (!/\.txt$/i.test(file.name)) {
        if (msg) msg.textContent = 'Please choose a .txt file.';
        input.value = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        ta.value = String(reader.result || '');
        update();
        if (msg) msg.textContent = 'Loaded "' + file.name + '" (' + file.size.toLocaleString() + ' bytes). The file stays on your device.';
      };
      reader.onerror = function () { if (msg) msg.textContent = 'That file could not be read.'; };
      reader.readAsText(file);
    });
  }
  wireFileUpload('fileUploadSent', 'fileUploadSentMsg');
  wireFileUpload('fileUploadChar', 'fileUploadCharMsg');

  // Copy / download the per-sentence report (sentence counter page).
  var btnCopySent = document.getElementById('btnCopySentReport');
  if (btnCopySent) {
    btnCopySent.addEventListener('click', function () {
      var msg = document.getElementById('sentReportMsg');
      function done(ok) { if (msg) { msg.textContent = ok ? 'Sentence report copied.' : 'Copy did not work — select the text and copy it by hand.'; setTimeout(function () { msg.textContent = ''; }, 2500); } }
      var report = sentenceReportText(ta.value);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(report).then(function () { done(true); }, function () { done(false); });
      } else done(false);
    });
  }
  var btnDlSent = document.getElementById('btnDownloadSentReport');
  if (btnDlSent) {
    btnDlSent.addEventListener('click', function () {
      var blob = new Blob([sentenceReportText(ta.value)], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sentence-report.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
      var msg = document.getElementById('sentReportMsg');
      if (msg) { msg.textContent = 'Downloaded sentence-report.txt.'; setTimeout(function () { msg.textContent = ''; }, 2500); }
    });
  }

  // Copy / Clear buttons (present on every tool page).
  var btnCopy = document.getElementById('btnCopy');
  var copyMsg = document.getElementById('copyMsg');
  if (btnCopy) {
    btnCopy.addEventListener('click', function () {
      function done(ok) {
        if (copyMsg) {
          copyMsg.textContent = ok ? 'Copied.' : 'Copy did not work — select the text and copy it by hand.';
          setTimeout(function () { copyMsg.textContent = ''; }, 2500);
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { done(false); });
      } else {
        ta.select();
        try { done(document.execCommand('copy')); } catch (e) { done(false); }
      }
    });
  }
  var btnClear = document.getElementById('btnClear');
  if (btnClear) {
    btnClear.addEventListener('click', function () {
      ta.value = '';
      update();
      ta.focus();
    });
  }
  var btnSample = document.getElementById('btnSample');
  if (btnSample) {
    btnSample.addEventListener('click', function () {
      ta.value = 'Good writing is clear writing. A word counter helps you check length before you send an essay, an article, or a job application.\n\nPaste your own text here and watch the numbers change as you type. Nothing you write leaves your device — every count happens right here in your browser.';
      update();
    });
  }

  update();
})();
