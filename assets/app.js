/* CountMyWords — shared counting logic. No dependencies.
   All counting happens in the browser. Text is never uploaded or stored. */
(function () {
  'use strict';

  /* ---------- Counting ---------- */

  // Words: letters and numbers, with internal apostrophes and hyphens kept.
  // "don't" = 1 word, "well-known" = 1 word, "2026" = 1 word, Unicode counts.
  // A decimal such as 3.14 is one word: the trailing (?:\.\d+)* group keeps
  // the digits after the point attached to the number.
  var WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*(?:\.\d+)*/gu;

  function countWords(text) {
    var m = text.match(WORD_RE);
    var n = m ? m.length : 0;
    // Standalone emoji count as words, as in Word/Google Docs:
    // "Hello 😀" = 2 words. A whitespace-separated token with no letter or
    // number that contains an emoji/pictograph (including flag sequences,
    // which are not Extended_Pictographic) counts once. Pure punctuation
    // such as "—" and currency such as "$" do not count.
    var tokens = text.split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t && !/[\p{L}\p{N}]/u.test(t) &&
          /[\p{So}\u{1F1E6}-\u{1F1FF}]|\p{Extended_Pictographic}/u.test(t)) {
        n++;
      }
    }
    return n;
  }

  // Grapheme counting: one visible character = one grapheme.
  // "Hello 😀" = 7 graphemes (H e l l o space 😀). Flags and combined
  // characters also count as one grapheme each.
  var graphemeSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }
  } catch (e) { graphemeSegmenter = null; }

  function countGraphemes(text) {
    if (!text) return 0;
    if (graphemeSegmenter) {
      var n = 0;
      var it = graphemeSegmenter.segment(text);
      for (var _ of it) n++;
      return n;
    }
    return Array.from(text).length; // code-point fallback
  }

  function countChars(text) {
    return countGraphemes(text);
  }

  function countCharsNoSpaces(text) {
    return countGraphemes(text.replace(/\s/g, ''));
  }

  // Sentences: Intl.Segmenter when available, keeping only segments that
  // contain a letter or number. Fallback protects decimals (3.14) before
  // splitting on . ! ? … Empty text = 0. Text with words but no terminator = 1.
  var sentenceSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    }
  } catch (e) { sentenceSegmenter = null; }

  function countSentences(text, wordCount) {
    if (!text || !text.trim()) return 0;
    if (sentenceSegmenter) {
      var n = 0;
      var it = sentenceSegmenter.segment(text);
      for (var seg of it) {
        if (/[\p{L}\p{N}]/u.test(seg.segment)) n++;
      }
      return n;
    }
    var protectedText = text.replace(/(\d)\.(\d)/g, '$1\u0001$2');
    var parts = protectedText.split(/[.!?…]+/).filter(function (p) {
      return /[\p{L}\p{N}]/u.test(p);
    });
    return parts.length > 0 ? parts.length : (wordCount > 0 ? 1 : 0);
  }

  // Paragraphs: non-empty blocks separated by blank lines.
  function countParagraphs(text) {
    if (!text || !text.trim()) return 0;
    var parts = text.split(/\n\s*\n/).filter(function (p) { return p.trim() !== ''; });
    return parts.length;
  }

  function longestWord(text) {
    var m = text.match(WORD_RE);
    if (!m) return '—';
    var longest = m[0];
    for (var i = 1; i < m.length; i++) {
      if (Array.from(m[i]).length > Array.from(longest).length) longest = m[i];
    }
    return longest.length > 18 ? longest.slice(0, 18) + '…' : longest;
  }

  /* ---------- Reading / speaking time ---------- */
  // Estimates only: reading 200 words per minute, speaking 130 wpm.
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
  function splitWords(s) {
    // Split on non-letters/numbers, and also on camelCase boundaries, so
    // converting already-camelCase text ("helloWorld") still works.
    return s.split(/[^\p{L}\p{N}]+/u)
      .flatMap(function (p) { return p.split(/(?<=[\p{Ll}\p{N}])(?=[\p{Lu}])/u); })
      .filter(Boolean);
  }
  function capWord(w) {
    if (!w) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  function toTitle(s) {
    return s.toLowerCase().replace(/(^|[\s\(\["“])(\S)/gu, function (m, p, c) {
      return p + c.toUpperCase();
    });
  }
  function convertCase(s, mode) {
    var w, out = s;
    if (mode === 'upper') out = s.toUpperCase();
    else if (mode === 'lower') out = s.toLowerCase();
    else if (mode === 'title') out = toTitle(s);
    else if (mode === 'sentence') {
      out = s.toLowerCase().replace(/(^\s*[\p{L}])|([.!?]\s+[\p{L}])/gu, function (m) {
        return m.toUpperCase();
      });
    }
    else if (mode === 'camel') {
      // Split before lowercasing: lowercasing first would destroy the
      // camelCase boundaries that splitWords needs to see.
      w = splitWords(s).map(function (x) { return x.toLowerCase(); });
      out = w.map(function (x, i) { return i === 0 ? x : capWord(x); }).join('');
    }
    else if (mode === 'pascal') {
      w = splitWords(s).map(function (x) { return x.toLowerCase(); });
      out = w.map(capWord).join('');
    }
    else if (mode === 'snake') {
      w = splitWords(s).map(function (x) { return x.toLowerCase(); });
      out = w.join('_');
    }
    else if (mode === 'kebab') {
      w = splitWords(s).map(function (x) { return x.toLowerCase(); });
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
    var readMins = words / 200;
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
      'About ' + fmtSeconds(readMins) + ' to read (' + words.toLocaleString() + ' words at about 200 words per minute).');
    set('stSpeakDetail', words === 0 ? '' :
      'About ' + fmtSeconds(speakMins) + ' to speak aloud (' + words.toLocaleString() + ' words at about 130 words per minute).');
  }
  ta.addEventListener('input', update);

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
