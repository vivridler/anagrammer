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
// "12 Clue", "12. Clue", and linked clues such as "24,2-down Clue" or "1, 5 Clue".
const CLUE = /^\s*(\d{1,3})((?:\s*,\s*\d{1,3}(?:\s*-?\s*(?:across|down|ac|dn|a|d)\b)?|\s*,?\s+\d{1,3}\s*-\s*(?:across|down)\b)*)(?:\s*[.:)]\s*|\s+)(\S.*)$/i;
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
      const links = m[2].replace(/^\s*,?\s*/, '').replace(/\s*,\s*/g, ', ').replace(/\s*-?\s*(across|down|ac|dn|a|d)\b/gi,
        (x, d) => '-' + (/^a/i.test(d) ? 'across' : 'down'));
      current = [n, (links ? `(with ${links}) ` : '') + m[3].trim()];
      out[section].push(current);
    } else if (current) {
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

// Use the grid to repair OCR'd clues: fix impossible clue numbers, split a list
// whose "Down" heading was missed, and add missing (length) enumerations.
export function reconcileClues(parsed, num) {
  const lists = { across: [...parsed.across], down: [...parsed.down] };
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
