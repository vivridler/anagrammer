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
const CLUE = /^\s*(\d{1,3})(?:\s*[.:),]\s*|\s+)(\S.*)$/;

// Fix the commonest OCR confusions in a leading clue number ("l2" -> "12", "1O" -> "10").
function fixLeadingNumber(line) {
  return line.replace(/^(\s*)([0-9lI|O]{1,3})(?=[\s.:),])/, (m, sp, tok) =>
    /\d/.test(tok) ? sp + tok.replace(/[lI|]/g, '1').replace(/O/g, '0') : m);
}

// Parse free text (typed or OCR'd) into clues. Recognises "Across"/"Down"
// headers; lines without a leading number continue the previous clue.
// Returns { across: [[num, text], ...], down: [...] } in reading order.
export function parseClueText(text, defaultSection = 'across', useHeaders = true) {
  const out = { across: [], down: [] };
  let section = defaultSection;
  let current = null;
  for (let raw of String(text).split(/\r?\n/)) {
    let line = raw.replace(/[|_]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const hm = useHeaders && line.match(HEADER);
    if (hm) {
      section = hm[1].toLowerCase();
      current = null;
      line = hm[2].trim();
      if (!line) continue;
    }
    const m = fixLeadingNumber(line).match(CLUE);
    if (m) {
      current = [parseInt(m[1], 10), m[2].trim()];
      out[section].push(current);
    } else if (current) {
      current[1] = current[1].endsWith('-') && /^[a-z]/.test(line)
        ? current[1].slice(0, -1) + line
        : current[1] + ' ' + line;
    }
  }
  return out;
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
