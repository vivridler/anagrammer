// Crossword structure: numbering, words and clue text parsing.

export function numberGrid(rows, cols, blocks) {
  const n = rows * cols;
  const numbers = new Array(n).fill(0);
  const across = [], down = [];
  const acrossOf = new Array(n).fill(-1), downOf = new Array(n).fill(-1);
  let num = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (blocks[i]) continue;
      const startA = (c === 0 || blocks[i - 1]) && c + 1 < cols && !blocks[i + 1];
      const startD = (r === 0 || blocks[i - cols]) && r + 1 < rows && !blocks[i + cols];
      if (!startA && !startD) continue;
      numbers[i] = ++num;
      if (startA) {
        const cells = [];
        for (let cc = c; cc < cols && !blocks[r * cols + cc]; cc++) cells.push(r * cols + cc);
        cells.forEach(j => { acrossOf[j] = across.length; });
        across.push({ num, dir: 'across', cells });
      }
      if (startD) {
        const cells = [];
        for (let rr = r; rr < rows && !blocks[rr * cols + c]; rr++) cells.push(rr * cols + c);
        cells.forEach(j => { downOf[j] = down.length; });
        down.push({ num, dir: 'down', cells });
      }
    }
  }
  return { numbers, across, down, acrossOf, downOf };
}

// A header is the word alone, or followed by ":" or straight away by a clue number.
const HEADER = /^\s*(across|down)\s*(?:[:.\-]\s*)?(?=$|\d)(.*)$/i;
// "12 Clue", "12. Clue", and linked clues such as "24,2-down Clue", "1, 5 Clue" or "1/13/24 Clue".
// ("23 1-across Clue", without a comma, is decided later against the grid: link or just a reference.)
const CLUE = /^\s*(\d{1,3})((?:\s*[,/]\s*\d{1,3}(?:\s*-?\s*(?:across|down|ac|dn|a|d)\b)?|\s*\.\s*\d{1,3}\s*-?\s*(?:across|down)\b)*)(?:\s*[.:)]\s*|\s+)(\S.*)$/i;
const ENUM_END = /\(\s*\d[\d\s,.\-]*\)\s*$/;

// Fix the commonest OCR confusions in a leading clue number ("l2" -> "12", "1O" -> "10").
function fixLeadingNumber(line) {
  return line
    .replace(/^(\s*)[§$](?=\d?\s)/, '$15')                  // bold "5" read as "§" or "$"
    .replace(/^(\s*)([0-9lI|O]{1,3})(?=[\s.:),])/, (m, sp, tok) =>
      /\d/.test(tok) ? sp + tok.replace(/[lI|]/g, '1').replace(/O/g, '0') : m);
}

// Tidy common OCR slips in clue text.
export function cleanClue(t) {
  return t
    .replace(/(^|\s)\|(?=\s)/g, '$1I')                       // "|" read for "I"
    .replace(/\s*\(?\s*(\d+(?:\s*[.,\-]\s*\d+)*)\s*\)\s*$/,    // "(5.6)" / "9)" -> "(5,6)" / "(9)"
      (m, g) => ` (${g.replace(/\s*\.\s*/g, ',').replace(/\s+/g, '')})`)
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse free text (typed or OCR'd) into clues. Recognises "Across"/"Down"
// headers; lines without a leading number continue the previous clue.
// Returns { across: [[num, text], ...], down: [...] } in reading order.
export function parseClueText(text, defaultSection = 'across', useHeaders = true) {
  const out = { across: [], down: [] };
  const lines = String(text).split(/\r?\n/);
  const hasHeaders = useHeaders && lines.some(l => HEADER.test(l.trim()));
  let section = defaultSection;
  let current = null;
  let prevNum = 0;
  for (const raw of lines) {
    let line = raw.replace(/[|_]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const hm = useHeaders && line.match(HEADER);
    if (hm) {
      section = hm[1].toLowerCase();
      current = null;
      prevNum = 0;
      line = hm[2].trim();
      if (!line) continue;
    }
    if (/^\d+$/.test(line)) continue; // stray page/puzzle numbers
    const m = fixLeadingNumber(line).match(CLUE);
    if (m) {
      const n = parseInt(m[1], 10);
      // No headings at all: a restart of the numbering means the Down list began.
      if (useHeaders && !hasHeaders && section === 'across' && n < prevNum) section = 'down';
      prevNum = n;
      const links = m[2].replace(/^\s*[,./]?\s*/, '').replace(/\s*[,./]\s*/g, ', ').replace(/\s*-?\s*(across|down|ac|dn|a|d)\b/gi,
        (x, d) => '-' + (/^a/i.test(d) ? 'across' : 'down'));
      current = [n, (links ? `(with ${links}) ` : '') + m[3].trim()];
      out[section].push(current);
    } else if (current) {
      // A clue ends with its (lengths), or is just "See 12": anything after that isn't part of it
      // (e.g. a prize-puzzle footer below the last clue).
      if (ENUM_END.test(current[1]) || /^see\s+\d{1,3}(\s*-?\s*(across|down))?$/i.test(current[1].trim())) { current = null; continue; }
      // Keep a line-end hyphen ("hold-" + "up" = "hold-up"): in clues it is usually real.
      current[1] = current[1].endsWith('-') ? current[1] + line : current[1] + ' ' + line;
    }
  }
  for (const sec of ['across', 'down']) for (const c of out[sec]) c[1] = cleanClue(c[1]);
  return out;
}

// Digits OCR tends to confuse with each other.
const LOOKALIKE = { 0: '689', 1: '74', 2: '7', 3: '85', 4: '19', 5: '63', 6: '850', 7: '12', 8: '3690', 9: '84' };
function numberVariants(n) {
  const s = String(n), out = new Set();
  for (let i = 0; i < s.length; i++) {
    if (s.length > 1) out.add(s.slice(0, i) + s.slice(i + 1));        // extra digit ("217" -> "27")
    for (const d of LOOKALIKE[s[i]] || '') out.add(s.slice(0, i) + d + s.slice(i + 1));
  }
  return [...out].filter(v => v && !/^0/.test(v)).map(Number);
}

// Put each clue under the direction the grid says it belongs to. Page layouts sometimes put Down
// clues beside the Across ones, before the "Down" heading. A clue moves only when its number doesn't
// exist in its current direction, is already taken there, or its (length) only fits the other one.
function rebinByGrid(parsed, num) {
  const len = { across: new Map(num.across.map(w => [w.num, w.cells.length])), down: new Map(num.down.map(w => [w.num, w.cells.length])) };
  const total = t => { const e = parseEnumeration(t); return e ? e.lengths.reduce((a, b) => a + b, 0) : null; };
  const out = { across: [], down: [] };
  const taken = { across: new Set(), down: new Set() };
  for (const dir of ['across', 'down']) {
    for (const [n, t] of parsed[dir]) {
      const other = dir === 'across' ? 'down' : 'across';
      const fits = d => len[d].has(n) && !/^\(with /i.test(t) && total(t) != null ? total(t) === len[d].get(n) : len[d].has(n);
      let to = dir;
      if (len[other].has(n) && !taken[other].has(n)) {
        if (!len[dir].has(n) || taken[dir].has(n) || (fits(other) && !fits(dir))) to = other;
      }
      taken[to].add(n);
      out[to].push([n, t]);
    }
  }
  for (const d of ['across', 'down']) out[d].sort((a, b) => a[0] - b[0]);
  return out;
}

// Use the grid to repair OCR'd clues: fix impossible clue numbers, split a list
// whose "Down" heading was missed, and add missing (length) enumerations.
export function reconcileClues(parsed, num) {
  const lists = rebinByGrid(parsed, num);
  if (!lists.down.length) {
    const k = lists.across.findIndex((c, i) => i > 0 && c[0] < lists.across[i - 1][0] - 3);
    if (k > 0) lists.down = lists.across.splice(k);
  }
  const result = {};
  for (const dir of ['across', 'down']) {
    const lens = new Map(num[dir].map(w => [w.num, w.cells.length]));
    const used = new Set();
    const out = [];
    lists[dir].forEach(([n, t], k) => {
      let fixed = n;
      if (!lens.has(n) || used.has(n)) {
        const prev = out.length ? out[out.length - 1][0] : 0;
        const nextRaw = lists[dir][k + 1] && lists[dir][k + 1][0];
        const next = lens.has(nextRaw) && !used.has(nextRaw) ? nextRaw : Infinity;
        fixed = numberVariants(n).find(c => lens.has(c) && !used.has(c) && c > prev && c < next) ?? null;
      }
      if (fixed == null) { out.push([n, t]); return; } // leave as-is for the user to see
      used.add(fixed);
      if (!ENUM_END.test(t) && !/^see\b/i.test(t)) t = `${t} (${lens.get(fixed)})`;
      const w = num[dir].find(x => x.num === fixed);
      const unwrapped = w && unwrapFalseLink(t, w, num);
      if (unwrapped != null) t = unwrapped;
      else if (w) t = relinkByLength(t, w, num);
      out.push([fixed, t]);
    });
    result[dir] = out;
  }
  return result;
}

export function cluesToText(list) {
  return list.map(([n, t]) => `${n} ${t}`).join('\n');
}

// Turn the two clue text boxes into { across: {num: text}, down: {num: text} }.
export function cluesFromText({ across = '', down = '' }) {
  const toMap = (text, sec) => {
    const map = {};
    // The box decides the direction, so headers inside it are ignored.
    const clean = text.replace(/^\s*(across|down)\s*:?\s*$/gim, '');
    for (const [n, t] of parseClueText(clean, sec, false)[sec]) map[n] = t;
    return map;
  };
  return { across: toMap(across, 'across'), down: toMap(down, 'down') };
}

// Compare the clue numbers to the grid and report gaps.
export function clueReport(num, clues) {
  const rep = {};
  for (const dir of ['across', 'down']) {
    const want = num[dir].map(w => w.num);
    const have = Object.keys(clues[dir] || {}).map(Number);
    rep[dir] = {
      total: want.length,
      found: want.filter(n => n in (clues[dir] || {})).length,
      missing: want.filter(n => !(n in (clues[dir] || {}))),
      extra: have.filter(n => !want.includes(n)),
    };
  }
  return rep;
}

// Replace (or add, in number order) the line for clue `n` in a clue text box.
export function setClueLine(text, n, clue) {
  const lines = String(text || '').split('\n').filter(l => l.trim());
  const entries = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^\s*(\d{1,3})\b/);
    if (m) { cur = { n: +m[1], lines: [l] }; entries.push(cur); }
    else if (cur) cur.lines.push(l);
    else entries.push({ n: -1, lines: [l] });
  }
  const line = clue.trim() ? `${n} ${clue.trim().replace(/\s*\n\s*/g, ' ')}` : null;
  const k = entries.findIndex(e => e.n === n);
  if (k >= 0) {
    if (line) entries[k].lines = [line]; else entries.splice(k, 1);
  } else if (line) {
    const at = entries.findIndex(e => e.n > n);
    entries.splice(at < 0 ? entries.length : at, 0, { n, lines: [line] });
  }
  return entries.map(e => e.lines.join('\n')).join('\n');
}

// ---- Linked answers and word breaks ----

// "(5-4,6)" at the end of a clue -> { lengths: [5,4,6], seps: ['-', ','] }, or null.
export function parseEnumeration(text) {
  const m = String(text || '').match(/\(\s*(\d+(?:\s*[,\-\s]\s*\d+)*)\s*\)\s*$/);
  if (!m) return null;
  const parts = m[1].split(/\s*([,\-]|\s)\s*/);
  const lengths = [], seps = [];
  parts.forEach((t, k) => { if (k % 2) seps.push(t.trim() === '-' ? '-' : ','); else lengths.push(+t); });
  return { lengths, seps };
}

// Strip the "(with 2-down) " prefix we store on linked clues.
export const clueBody = t => String(t || '').replace(/^\(with [^)]*\)\s*/i, '');

// Groups of entries that form one answer, e.g. 24-across "(with 2-down) …" and
// 2-down "See 24-across". Returns Map(word -> { words: [main, ...rest], main }).
export function linkWords(num, clues) {
  const byKey = new Map();
  for (const d of ['across', 'down']) for (const w of num[d]) byKey.set(`${d}:${w.num}`, w);
  const find = (n, d, prefer) => (d ? byKey.get(`${d}:${n}`)
    : byKey.get(`${prefer}:${n}`) || byKey.get(`${prefer === 'across' ? 'down' : 'across'}:${n}`));
  const refDir = s => (!s ? null : /^a/i.test(s) ? 'across' : 'down');
  const groupOf = new Map();
  const text = w => (clues[w.dir] && clues[w.dir][w.num]) || '';

  // 1. Main clues that name their other parts: "(with 2-down) …".
  for (const d of ['across', 'down']) for (const w of num[d]) {
    const m = text(w).match(/^\(with ([^)]*)\)/i);
    if (!m) continue;
    const words = [w];
    for (const ref of m[1].split(',')) {
      const r = ref.trim().match(/^(\d{1,3})\s*-?\s*(across|down|a|d)?$/i);
      const other = r && find(+r[1], refDir(r[2]), w.dir);
      if (other && !words.includes(other) && !groupOf.has(other)) words.push(other);
    }
    if (words.length > 1 && !groupOf.has(w)) {
      const g = { words, main: w };
      words.forEach(x => groupOf.set(x, g));
    }
  }
  // 2. "See 24-across" entries without a matching main clue above.
  for (const d of ['across', 'down']) for (const w of num[d]) {
    if (groupOf.has(w)) continue;
    const m = text(w).match(/^see\s+(\d{1,3})\s*-?\s*(across|down|a|d)?\b/i);
    if (!m) continue;
    const main = find(+m[1], refDir(m[2]), w.dir === 'across' ? 'down' : 'across');
    if (!main || main === w) continue;
    const g = groupOf.get(main) || { words: [main], main };
    g.words.push(w);
    g.words.forEach(x => groupOf.set(x, g));
  }
  return groupOf;
}

// Where to draw word breaks and hyphens for an answer spread over `words`.
// Returns [{ cell, dir, kind: 'break' | 'hyphen' }]: the mark goes after `cell`
// (on its right edge for across, bottom edge for down).
export function answerMarks(words, enumeration) {
  if (!enumeration) return [];
  const seq = words.flatMap(w => w.cells.map((cell, k) => ({ cell, dir: w.dir, last: k === w.cells.length - 1 })));
  const total = enumeration.lengths.reduce((a, b) => a + b, 0);
  if (total !== seq.length) return []; // lengths don't fit the grid: probably misread, so draw nothing
  const marks = [];
  let pos = 0;
  enumeration.lengths.slice(0, -1).forEach((len, k) => {
    pos += len;
    const at = seq[pos - 1];
    if (!at.last) marks.push({ cell: at.cell, dir: at.dir, kind: enumeration.seps[k] === '-' ? 'hyphen' : 'break' });
  });
  return marks;
}

// ---- References to other entries inside clue text ----

// Finds mentions like "24-down", "9 Down", "27-across" that match an entry in the grid.
// Returns [{ start, end, word }] in order.
export function findRefs(text, num) {
  const out = [];
  const re = /\b(\d{1,3})\s*-?\s*(across|down)\b/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const d = m[2].toLowerCase();
    const word = num[d].find(w => w.num === +m[1]);
    if (word) out.push({ start: m.index, end: m.index + m[0].length, word });
  }
  return out;
}

// Lay out answer letters to match a clue's (lengths): "ARCUP" + (3,2) -> "ARC UP", (5-4,6) keeps the hyphen.
// Letters are returned unchanged if the lengths don't fit.
export function formatAnswer(letters, enumeration) {
  if (!enumeration || enumeration.lengths.reduce((a, b) => a + b, 0) !== letters.length) return letters;
  let out = '', at = 0;
  enumeration.lengths.forEach((len, k) => {
    out += letters.slice(at, at + len);
    at += len;
    if (k < enumeration.seps.length) out += enumeration.seps[k] === '-' ? '-' : ' ';
  });
  return out;
}

// ---- Puzzle details from the page heading ----

// Guess the setter ("by DA") and puzzle number ("No. 1335", "#1335", or a lone number)
// from OCR'd page text. Returns only what it finds, e.g. { setter: 'DA', number: '1335' }.
export function guessMeta(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const firstHeader = lines.findIndex(l => HEADER.test(l));
  const head = firstHeader >= 0 ? lines.slice(0, firstHeader) : lines.slice(0, 3);
  const out = {};
  for (const l of head) {
    const m = l.match(/\bby\s+([A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,2})/);
    if (m) { out.setter = m[1].replace(/\s+\d+$/, '').trim(); break; }
  }
  for (const l of head) {
    const m = l.match(/(?:\bno\.?|\bnumber|#)\s*(\d{1,3}(?:,\d{3})+|\d{2,6})\b/i) || l.match(/\s(\d{3,6})\s*$/);
    if (m) { out.number = m[1].replace(/,/g, ''); break; }
  }
  if (!out.number) {
    // A number on a line of its own anywhere (e.g. "1335" in the corner of the heading).
    const lone = lines.find(l => /^\d{3,6}$/.test(l));
    if (lone) out.number = lone;
  }
  return out;
}

// "13 21-down stuck in tunnel (5)" names another entry but isn't a linked answer: its (length) covers only
// entry 13. Parsing reads the leading "21-down" as a link ("(with 21-down) …"), so undo that whenever the
// length fits the entry on its own rather than all the parts together. Returns the fixed text, or null.
export function unwrapFalseLink(text, word, num) {
  const m = String(text || '').match(/^\(with ([^)]*)\)\s*(.*)$/i);
  if (!m) return null;
  const e = parseEnumeration(m[2]);
  if (!e) return null;
  const total = e.lengths.reduce((a, b) => a + b, 0);
  let sum = word.cells.length;
  for (const ref of m[1].split(',')) {
    const r = ref.trim().match(/^(\d{1,3})\s*-?\s*(across|down|a|d)?$/i);
    const d = r && r[2] ? (/^a/i.test(r[2]) ? 'across' : 'down') : null;
    const other = r && (d ? num[d].find(w => w.num === +r[1])
      : num[word.dir].find(w => w.num === +r[1]) || num[word.dir === 'across' ? 'down' : 'across'].find(w => w.num === +r[1]));
    if (other) sum += other.cells.length;
  }
  if (total !== word.cells.length || total === sum) return null;
  return `${m[1]} ${m[2]}`;
}

// Apply unwrapFalseLink to every clue. Returns { across, down } maps and whether anything changed.
export function fixFalseLinks(clues, num) {
  let changed = false;
  const out = { across: { ...(clues.across || {}) }, down: { ...(clues.down || {}) } };
  for (const d of ['across', 'down']) {
    for (const w of num[d]) {
      const fixed = unwrapFalseLink(out[d][w.num], w, num);
      if (fixed != null) { out[d][w.num] = fixed; changed = true; }
    }
  }
  return { clues: out, changed };
}

// "23 1-across Trains here (5,7)": an OCR'd linked clue whose comma was lost. Treat a leading "N-direction" as a
// link only when the (lengths) add up to this entry plus that one; otherwise it's a reference, left as written.
export function relinkByLength(text, word, num) {
  const m = String(text || '').match(/^(\d{1,3})\s*-\s*(across|down)\s+(\S.*)$/i);
  if (!m) return text;
  const e = parseEnumeration(m[3]);
  const other = num[m[2].toLowerCase()].find(w => w.num === +m[1]);
  if (!e || !other || other === word) return text;
  const total = e.lengths.reduce((a, b) => a + b, 0);
  return total === word.cells.length + other.cells.length && total !== word.cells.length
    ? `(with ${m[1]}-${m[2].toLowerCase()}) ${m[3]}` : text;
}
