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

  /* ---------- Sentences and paragraphs ---------- */
  // Sentences: Intl.Segmenter when available, keeping only segments
  // that contain a letter or number. Fallback protects decimals (3.14)
  // before splitting on . ! ? … Empty text = 0. Text with words but
  // no terminator = 1.
  // Known limitation, documented on the Sentence Counter page:
  // abbreviations can fool a segmenter. Titles ("Dr.", "Mr.") and
  // "e.g." / "i.e." at the end of a segment are merged with the
  // following segment, which fixes the common cases ("Dr. Smith left."
  // = 2 sentences, not 3). Abbreviations that can also end a sentence
  // ("p.m.", "U.S.") are deliberately NOT merged — "It is 3 p.m. He
  // left." is 2 sentences — so an unlisted abbreviation, or one such
  // as "U.S." in the middle of a sentence, can still be miscounted.
  var sentenceSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    }
  } catch (e) { sentenceSegmenter = null; }

  function endsWithAbbreviation(segment) {
    var t = segment.trim();
    if (!t) return false;
    var last = t.split(/\s+/).pop();
    // Titles and e.g./i.e. never end a sentence, so a segment ending
    // with one of them is a false split. p.m., a.m., U.S. and U.K. can
    // end a sentence, so they are not merged here.
    return /^(?:Dr|Mr|Mrs|Ms|St|Sr|Jr|Prof|Capt|Lt|Col|Gen|Sgt|Rev|Hon|Mt|Ft)\.$/i.test(last) ||
      /^(?:e\.g\.|i\.e\.)$/i.test(last);
  }

  function mergeAbbreviationSegments(segments) {
    var out = [];
    for (var i = 0; i < segments.length; i++) {
      if (out.length > 0 && endsWithAbbreviation(out[out.length - 1])) {
        out[out.length - 1] += segments[i];
      } else {
        out.push(segments[i]);
      }
    }
    return out;
  }

  function countSentences(text, wordCount) {
    if (!text || !text.trim()) return 0;
    var segments, merged, n = 0, i;
    if (sentenceSegmenter) {
      segments = [];
      var it = sentenceSegmenter.segment(text);
      for (var seg of it) segments.push(seg.segment);
      merged = mergeAbbreviationSegments(segments);
      for (i = 0; i < merged.length; i++) {
        if (/[\p{L}\p{N}]/u.test(merged[i])) n++;
      }
      return n;
    }
    var protectedText = text
      // "p.m." / "a.m." / "U.S." / "U.K." can end a sentence, so their
      // dots are hidden but a marker (\u0002) is left as the sentence
      // terminator. "e.g." / "i.e." never end a sentence and are left
      // for the abbreviation merge below. This is the fallback only;
      // Intl.Segmenter handles these correctly in modern browsers.
      .replace(/\b(?:p\.m\.|a\.m\.|U\.S\.|U\.K\.)/g, function (m) {
        return m.replace(/\./g, '\u0001') + '\u0002';
      })
      .replace(/(\d)\.(\d)/g, '$1\u0001$2');
    var parts = protectedText.match(/[^.!?…\u0002]+[.!?…\u0002]+|[^.!?…\u0002]+$/g) || [];
    merged = mergeAbbreviationSegments(parts);
    for (i = 0; i < merged.length; i++) {
      if (/[\p{L}\p{N}]/u.test(merged[i])) n++;
    }
    return n;
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

  /* ---------- Reading / speaking time ---------- */
  // Estimates only. Reading defaults to 200 words per minute; the
  // Reading Time Calculator page offers Slow (150), Normal (200) and
  // Fast (250) — other pages have no speed control and always use 200.
  // Speaking is always about 130 words per minute.
  function readSpeed() {
    var sel = document.getElementById('readSpeed');
    if (sel) {
      var v = parseInt(sel.value, 10);
      if (v > 0) return v;
    }
    return 200;
  }
  function plural(n, word) {
    return n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's');
  }
  function fmtTime(mins) {
    if (mins <= 0) return '0 min';
    if (mins < 1) return '<1 min';
    return Math.round(mins) + ' min';
  }
  function fmtSeconds(mins) {
    var s = Math.round(mins * 60);
    if (s <= 0) return '0 seconds';
    if (s < 60) return s + (s === 1 ? ' second' : ' seconds');
    var m = Math.floor(s / 60), r = s % 60;
    return r ? m + ' min ' + r + ' sec' : m + ' min';
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
    return out;
  }

  /* ---------- Page wiring ---------- */
  var ta = document.getElementById('mainText');
  if (!ta) return;

  function set(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function update() {
    var text = ta.value;
    var words = countWords(text);
    var sentences = countSentences(text, words);
    var speed = readSpeed();
    var readMins = words / speed;
    var speakMins = words / 130;
    set('stWords', words.toLocaleString());
    set('stChars', countChars(text).toLocaleString());
    set('stCharsNo', countCharsNoSpaces(text).toLocaleString());
    set('stSent', sentences.toLocaleString());
    set('stPara', countParagraphs(text).toLocaleString());
    set('stRead', fmtTime(readMins));
    set('stSpeak', fmtTime(speakMins));
    set('stLong', longestWord(text));
    set('stReadDetail', words === 0 ? 'Enter text to see an estimate.' :
      'About ' + fmtSeconds(readMins) + ' to read (' + plural(words, 'word') + ' at about ' + speed + ' words per minute).');
    set('stSpeakDetail', words === 0 ? '' :
      'About ' + fmtSeconds(speakMins) + ' to speak aloud (' + plural(words, 'word') + ' at about 130 words per minute).');
  }
  ta.addEventListener('input', update);

  // Reading-speed choice (only on the reading-time page).
  var speedSel = document.getElementById('readSpeed');
  if (speedSel) speedSel.addEventListener('change', update);

  // Case converter buttons (only on the case converter page).
  document.querySelectorAll('[data-case]').forEach(function (b) {
    b.addEventListener('click', function () {
      ta.value = convertCase(ta.value, b.dataset.case);
      update();
      ta.focus();
    });
  });

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
