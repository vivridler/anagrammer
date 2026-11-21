// Guardian crosswords. The Guardian's Content API lists puzzles (needs a free developer key from
// open-platform.theguardian.com) but doesn't include the crosswords themselves, and the puzzle pages
// block automated access. Each puzzle has a print PDF, which Squares imports (+ → Import a PDF).
const API = 'https://content.guardianapis.com';
const KEY_STORE = 'squares.guardianKey';

export function apiKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
export function setApiKey(k) {
  try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
}

const isoUTC = d => d.toISOString().slice(0, 10);

// The print PDF for the cryptic published on `day` (YYYY-MM-DD).
export const pdfUrl = day => `https://crosswords-static.guim.co.uk/gdn.cryptic.${day.replace(/-/g, '')}.pdf`;

// Recent cryptics with their numbers (needs an API key), newest first: [{ number, day }].
export async function recentPuzzles(series = 'cryptic', count = 30) {
  const key = apiKey();
  if (!key) throw new Error('No API key');
  const res = await fetch(`${API}/crosswords/series/${encodeURIComponent(series)}?page-size=${count}&order-by=newest&api-key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`The Guardian returned an error (${res.status}).`);
  const data = await res.json();
  return ((data.response && data.response.results) || []).map(r => ({
    number: (r.id.match(/(\d+)$/) || [])[1] || '',
    day: isoUTC(new Date(r.webPublicationDate)),
  }));
}

// Without a key: the last few weeks by date (no Sunday puzzle), newest first.
export function recentDates(days = 21) {
  const out = [];
  const d = new Date();
  for (let k = 0; k < days; k++) {
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - k));
    if (day.getUTCDay() !== 0) out.push({ number: '', day: isoUTC(day) });
  }
  return out;
}
