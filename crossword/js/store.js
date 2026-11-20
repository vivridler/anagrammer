// Puzzles are kept on the device in IndexedDB (photos included).
const DB_NAME = 'crossword-solver';
const STORE = 'puzzles';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getPuzzle = id => tx('readonly', s => s.get(id));
export const listPuzzles = async () =>
  ((await tx('readonly', s => s.getAll())) || []).sort((a, b) => b.updated - a.updated);
export const savePuzzle = p => { p.updated = Date.now(); return tx('readwrite', s => s.put(p)); };
export const deletePuzzle = id => tx('readwrite', s => s.delete(id));
// Store a puzzle exactly as given (used when restoring a backup, keeps its 'updated' time).
export const putPuzzleRaw = p => tx('readwrite', s => s.put(p));
