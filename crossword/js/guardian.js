// Import crosswords from the Guardian via its public Content API (content.guardianapis.com),
// which apps may call directly from the browser. Needs an API key: the shared "test" key
// works for light use, or register a free developer key at open-platform.theguardian.com.
import { numberGrid } from './puzzle.js';

const API = 'https://content.guardianapis.com';
const KEY_STORE = 'squares.guardianKey';

export function apiKey() {
  try { return localStorage.getItem(KEY_STORE) || 'test'; } catch { return 'test'; }
}
export function setApiKey(k) {
  try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
}

async function getJson(url) {
  let res;
  try { res = await fetch(url); } catch { throw new Error("Couldn't reach the Guardian. Are you online?"); }
  if (res.status === 401 || res.status === 403) throw new Error('The Guardian refused the API key. Set your own key in the list (⚙︎).');
  if (res.status === 429) throw new Error('Too many requests to the Guardian right now. Try again shortly, or set your own API key (⚙︎).');
  if (!res.ok) throw new Error(`The Guardian returned an error (${res.status}).`);
  return res.json();
}

// Recent puzzles in a series, newest first: [{ id, title, date, url }].
export async function recentPuzzles(series = 'cryptic', count = 30) {
  const url = `${API}/crosswords/series/${encodeURIComponent(series)}?page-size=${count}&order-by=newest&api-key=${encodeURIComponent(apiKey())}`;
  const data = await getJson(url);
  const results = (data.response && data.response.results) || [];
  return results.map(r => ({ id: r.id, title: r.webTitle, date: r.webPublicationDate, url: r.webUrl }));
}

// The crossword data for one puzzle (Guardian crossword JSON: dimensions, entries, creator…).
export async function fetchCrossword(id) {
  const url = `${API}/${id}?show-fields=all&api-key=${encodeURIComponent(apiKey())}`;
  const data = await getJson(url);
  const content = data.response && data.response.content;
  const cw = content && (content.crossword || (content.fields && content.fields.crossword));
  if (!cw || !cw.entries || !cw.dimensions) throw new Error("The Guardian didn't send the crossword itself for this puzzle.");
  return cw;
}

const dirOf = id => (/-down$/.test(id) ? 'down' : 'across');
const numOf = id => parseInt(id, 10);

// Guardian crossword JSON -> fields for one of our puzzles.
// Returns { rows, cols, blocks, cluesText, solution, meta, title, sourceId } or throws if it doesn't fit.
export function toPuzzle(cw) {
  const cols = cw.dimensions.cols, rows = cw.dimensions.rows;
  const blocks = new Array(rows * cols).fill(1);
  const solution = new Array(rows * cols).fill('');
  for (const e of cw.entries) {
    for (let k = 0; k < e.length; k++) {
      const x = e.position.x + (e.direction === 'across' ? k : 0);
      const y = e.position.y + (e.direction === 'down' ? k : 0);
      if (x >= cols || y >= rows) throw new Error('This puzzle has an unusual grid that Squares can’t show yet.');
      blocks[y * cols + x] = 0;
      if (e.solution && e.solution[k]) solution[y * cols + x] = e.solution[k].toUpperCase();
    }
  }
  // Our numbering must agree with the Guardian's, or the clues would land on the wrong entries.
  const num = numberGrid(rows, cols, blocks);
  const ours = new Set([...num.across.map(w => `${w.num}-across`), ...num.down.map(w => `${w.num}-down`)]);
  const theirs = cw.entries.map(e => `${e.number}-${e.direction}`);
  if (theirs.length !== ours.size || theirs.some(k => !ours.has(k))) {
    throw new Error('This puzzle’s grid (e.g. a barred grid) isn’t supported yet.');
  }

  const lines = { across: [], down: [] };
  for (const e of [...cw.entries].sort((a, b) => a.number - b.number)) {
    const group = (e.group || [e.id]).filter(Boolean);
    let text = String(e.clue || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (group.length > 1 && group[0] === e.id) {
      // Main part of a linked answer: say which other entries it continues into.
      const rest = group.slice(1).map(g => `${numOf(g)}-${dirOf(g)}`).join(', ');
      text = `(with ${rest}) ${text}`;
    } else if (group.length > 1) {
      // Other parts: point at the main entry, with its direction so the link is unambiguous.
      text = `See ${numOf(group[0])}-${dirOf(group[0])}`;
    }
    lines[e.direction].push(`${e.number} ${text}`);
  }
  const date = new Date(typeof cw.date === 'number' ? cw.date : Date.parse(cw.date || cw.webPublicationDate || Date.now()));
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const hasSolution = cw.solutionAvailable !== false && solution.some((v, i) => !blocks[i] && v) &&
    solution.every((v, i) => blocks[i] || v);
  return {
    rows, cols, blocks,
    cluesText: { across: lines.across.join('\n'), down: lines.down.join('\n') },
    solution: hasSolution ? solution : null,
    meta: {
      source: 'The Guardian',
      setter: (cw.creator && cw.creator.name) || '',
      number: cw.number != null ? String(cw.number) : '',
      date: iso,
    },
    title: cw.name || `Guardian crossword ${cw.number || ''}`.trim(),
    sourceId: cw.id ? `guardian:${cw.id}` : null,
  };
}
