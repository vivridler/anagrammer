// Backup / restore of all puzzles as a single JSON file. Needed on iPhone, where Safari and the
// home-screen app keep separate storage: back up in one, restore in the other.
import * as DB from './store.js';

const FORMAT = 'squares-backup';
const BLOB_FIELDS = ['image', 'clueImage'];

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const dataUrlToBlob = async url => (await fetch(url)).blob();

// Returns a File containing every puzzle (photos included).
export async function makeBackup() {
  const puzzles = await DB.listPuzzles();
  const out = [];
  for (const p of puzzles) {
    const copy = { ...p };
    for (const k of BLOB_FIELDS) if (copy[k] instanceof Blob) copy[k] = { dataUrl: await blobToDataUrl(copy[k]) };
    out.push(copy);
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const json = JSON.stringify({ format: FORMAT, version: 1, exported: d.toISOString(), puzzles: out });
  return { file: new File([json], `squares-backup-${stamp}.json`, { type: 'application/json' }), count: out.length };
}

// Adds the puzzles from a backup file. Never deletes anything: a puzzle that's already here is only
// replaced if the backup's copy is more recent. Returns { added, updated, skipped }.
export async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("That file isn't a Squares backup."); }
  if (!data || data.format !== FORMAT || !Array.isArray(data.puzzles)) throw new Error("That file isn't a Squares backup.");
  const res = { added: 0, updated: 0, skipped: 0 };
  for (const p of data.puzzles) {
    if (!p || !p.id) { res.skipped++; continue; }
    const existing = await DB.getPuzzle(p.id);
    if (existing && (existing.updated || 0) >= (p.updated || 0)) { res.skipped++; continue; }
    const copy = { ...p };
    for (const k of BLOB_FIELDS) if (copy[k] && copy[k].dataUrl) copy[k] = await dataUrlToBlob(copy[k].dataUrl);
    await DB.putPuzzleRaw(copy);
    res[existing ? 'updated' : 'added']++;
  }
  return res;
}

// Hand the file to the user: the share sheet where available (iPhone: "Save to Files"), else a download.
export async function saveFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return 'shared'; }
    catch (err) { if (err && err.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
