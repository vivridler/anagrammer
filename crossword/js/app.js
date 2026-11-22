import * as V from './vision.js';
import * as P from './puzzle.js';
import * as DB from './store.js';
import { analyzeGrid, findCorners, readClueText, cluesFromOcr, scaledCanvas, textFromPdfItems } from './importer.js';
import { readPdf } from './pdfimport.js';
import { makeBackup, restoreBackup, saveFile } from './backup.js';

const app = document.getElementById('app');
// Replace the screen's content; optional parts passed as null/false are skipped (not shown as "null").
const setApp = (...kids) => app.replaceChildren(...kids.flat().filter(k => k != null && k !== false));

// ---------- small helpers ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

let teardown = [];
function onCleanup(fn) { teardown.push(fn); }
function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  onCleanup(() => target.removeEventListener(type, fn, opts));
}

function toast(msg, ms = 3000) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

function header(title, { back, actions = [] } = {}) {
  return h('header', { class: 'bar' },
    back ? h('button', { class: 'icon', 'aria-label': 'Back', onclick: () => go(back) }, '‹') : h('span', { class: 'icon-spacer' }),
    h('h1', {}, title),
    h('div', { class: 'actions' }, actions));
}

function sheet(title, body, { onClose, tall } = {}) {
  const close = () => { wrap.remove(); onClose && onClose(); };
  const wrap = h('div', { class: 'sheet-wrap' + (tall ? ' tall' : ''), onclick: e => { if (e.target === wrap) close(); } },
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon', 'aria-label': 'Close', onclick: close }, '✕')),
      h('div', { class: 'sheet-body' }, body)));
  document.body.append(wrap);
  onCleanup(() => wrap.remove());
  return { close, el: wrap };
}

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, url };
}

const canvasToBlob = (c, q = 0.88) => new Promise(r => c.toBlob(r, 'image/jpeg', q));

async function normalizeImport(file) {
  const { img, url } = await loadImage(file);
  const { canvas } = scaledCanvas(img, 2400);
  URL.revokeObjectURL(url);
  return canvasToBlob(canvas);
}

function grayToCanvas(g) {
  const c = document.createElement('canvas');
  c.width = g.w; c.height = g.h;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(g.w, g.h);
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) {
    id.data[j] = id.data[j + 1] = id.data[j + 2] = g.data[i]; id.data[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

function fitCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function filePicker({ capture, accept = 'image/*' } = {}) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, capture: capture ? 'environment' : null, style: 'display:none' });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

const otherDir = d => (d === 'across' ? 'down' : 'across');

const fmtTime = ms => {
  const t = Math.floor((ms || 0) / 1000), hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60;
  return (hh ? `${hh}:${String(mm).padStart(2, '0')}` : `${mm}`) + ':' + String(ss).padStart(2, '0');
};
const isoDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDay = iso => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return y ? new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
};
// Puzzle details: source (paper), setter, number, publishing date.
function metaOf(p) {
  p.meta = p.meta || {};
  return { source: p.meta.source || '', setter: p.meta.setter || '', number: p.meta.number || '', date: p.meta.date || isoDay(p.created || Date.now()) };
}
function displayTitle(p) {
  const m = metaOf(p);
  if (!m.source && !m.setter && !m.number) return p.title || 'Crossword';
  return [m.source, m.setter].filter(Boolean).join(' · ') + (m.number ? `${m.source || m.setter ? ' ' : ''}#${m.number}` : '');
}
// The most recent source used, to pre-fill new puzzles (you probably import the same paper).
async function lastSource() {
  const list = await DB.listPuzzles();
  const withSource = list.filter(x => x.meta && x.meta.source).sort((a, b) => (b.created || 0) - (a.created || 0));
  return withSource.length ? withSource[0].meta.source : '';
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const dirLabel = d => (d === 'across' ? 'Across' : 'Down');

// ---------- puzzle storage (one shared object per puzzle, so views and background jobs agree) ----------

const cache = new Map();
async function loadPuzzle(id) {
  if (!cache.has(id)) {
    const p = await DB.getPuzzle(id);
    if (!p) return null;
    cache.set(id, p);
  }
  return cache.get(id);
}

let saveTimer = null;
const pendingSaves = new Set();
function flushSave() {
  clearTimeout(saveTimer);
  const list = [...pendingSaves];
  pendingSaves.clear();
  return Promise.all(list.map(p => DB.savePuzzle(p)));
}
function saveSoon(p) {
  pendingSaves.add(p);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}
// Don't lose the last keystrokes if the app is closed or switched away from.
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);

function resetFill(p) { p.fill = new Array(p.rows * p.cols).fill(''); }
const numbering = p => P.numberGrid(p.rows, p.cols, p.blocks);

// ---------- background clue reading ----------

const jobs = new Map();         // puzzle id -> { label, progress }
const bus = new EventTarget();  // 'clues' events: detail = { id, done, report, error }

function startClueJob(p, { replace = false } = {}) {
  if (!p.image || jobs.has(p.id)) return;
  const job = { label: 'Reading clues', progress: null };
  jobs.set(p.id, job);
  p.cluesStatus = 'pending';
  saveSoon(p);
  const emit = extra => bus.dispatchEvent(new CustomEvent('clues', { detail: { id: p.id, ...extra } }));
  emit({});
  (async () => {
    const { img, url } = await loadImage(p.image);
    try {
      const text = await readClueText(img, { exclude: p.corners }, m => { Object.assign(job, m); emit({}); });
      let extraText = '';
      if (p.clueImage) {
        const second = await loadImage(p.clueImage);
        try { extraText = await readClueText(second.img, {}, m => { Object.assign(job, m); emit({}); }); }
        finally { URL.revokeObjectURL(second.url); }
      }
      const num = numbering(p);
      const rec = cluesFromOcr(text + '\n' + extraText, num);
      // Keep anything the user typed while we were reading.
      for (const d of ['across', 'down']) {
        if (replace || !p.cluesText[d].trim()) p.cluesText[d] = P.cluesToText(rec[d]);
      }
      p.clues = P.cluesFromText(p.cluesText);
      p.cluesStatus = 'done';
      p.ocrText = text;
      const guess = P.guessMeta(text);
      p.meta = p.meta || {};
      for (const k of ['setter', 'number']) if (!p.meta[k] && guess[k]) p.meta[k] = guess[k];
      emit({ done: true, report: P.clueReport(num, p.clues) });
    } catch (err) {
      console.error(err);
      p.cluesStatus = 'failed';
      emit({ done: true, error: err.message || String(err) });
    } finally {
      URL.revokeObjectURL(url);
      jobs.delete(p.id);
      saveSoon(p);
    }
  })();
}

function jobLabel(id) {
  const j = jobs.get(id);
  if (!j) return '';
  return j.label + (j.progress != null ? ` ${Math.round(j.progress * 100)}%` : '') + '…';
}

// ---------- photo viewer (pinch / buttons to zoom, drag to pan) ----------

// Which side of the photo the clues are on (the side without the grid).
function clueSide(p) {
  if (!p.corners || !p.imageWidth) return 'start';
  const cx = p.corners.reduce((a, c) => a + c[0], 0) / 4;
  return cx > p.imageWidth / 2 ? 'start' : 'end';
}

function photoPane(blobs, { className = '', side = 'start' } = {}) {
  const holder = h('div', { class: 'photo-pane ' + className });
  const inner = h('div', { class: 'photo-inner' });
  holder.append(inner);
  let zoom = 1;
  const imgs = [];
  Promise.all(blobs.filter(Boolean).map(loadImage)).then(list => {
    for (const { img, url } of list) { onCleanup(() => URL.revokeObjectURL(url)); imgs.push(img); inner.append(img); }
    // Wide pages: start filling the pane's height (readable text), scrolled to the clues.
    requestAnimationFrame(() => {
      const first = imgs[0];
      if (!first || !holder.clientWidth) return;
      const fitH = holder.clientHeight / (holder.clientWidth * first.naturalHeight / first.naturalWidth);
      zoom = 1;
      applyZoom(Math.max(1, Math.min(4, fitH)), 0, 0);
      holder.scrollLeft = side === 'end' ? holder.scrollWidth : 0;
      holder.scrollTop = 0;
    });
  });
  function applyZoom(z, cx, cy) {
    const old = zoom;
    zoom = Math.min(6, Math.max(1, z));
    // Keep the point under (cx, cy) in place.
    const px = cx ?? holder.clientWidth / 2, py = cy ?? holder.clientHeight / 2;
    const ax = (holder.scrollLeft + px) / old, ay = (holder.scrollTop + py) / old;
    inner.style.width = zoom * 100 + '%';
    holder.scrollLeft = ax * zoom - px;
    holder.scrollTop = ay * zoom - py;
  }
  let pinch = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  holder.addEventListener('touchstart', e => {
    if (e.touches.length === 2) pinch = { d: dist(e.touches), z: zoom };
  }, { passive: true });
  holder.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const r = holder.getBoundingClientRect();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    applyZoom(pinch.z * dist(e.touches) / pinch.d, cx, cy);
  }, { passive: false });
  holder.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
  holder.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = holder.getBoundingClientRect();
    applyZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  const controls = h('div', { class: 'zoom-ctl' },
    h('button', { 'aria-label': 'Zoom out', onclick: () => applyZoom(zoom / 1.5) }, '−'),
    h('button', { 'aria-label': 'Zoom in', onclick: () => applyZoom(zoom * 1.5) }, '+'));
  return h('div', { class: 'photo-wrap ' + className }, holder, controls);
}

// ---------- router ----------

async function route() {
  await flushSave();
  teardown.forEach(fn => fn());
  teardown = [];
  document.querySelectorAll('.sheet-wrap').forEach(el => el.remove());
  document.body.classList.remove('list-open');
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (parts[0] === 'p' && parts[1]) {
      const p = await loadPuzzle(parts[1]);
      if (!p) return go('#/');
      const view = { corners: cornersView, grid: gridView, clues: cluesView }[parts[2]] || solveView;
      await view(p);
    } else {
      await homeView();
    }
  } catch (err) {
    console.error(err);
    setApp(header('Something went wrong', { back: '#/' }),
      h('div', { class: 'pad' }, h('p', {}, String(err.message || err))));
  }
}

// ---------- home / library ----------

function progressOf(p) {
  if (!p.blocks || !p.fill) return null;
  let open = 0, filled = 0;
  p.blocks.forEach((b, i) => { if (!b) { open++; if (p.fill[i]) filled++; } });
  return open ? Math.round(100 * filled / open) : 0;
}

function busy(msg) {
  const el = h('div', { class: 'busy' }, h('div', { class: 'spinner' }), h('p', {}, msg));
  document.body.append(el);
  return () => el.remove();
}

async function createFromImage(file) {
  if (!file) return;
  const done = busy('Finding the crossword…');
  try {
    const blob = await normalizeImport(file);
    const { img, url } = await loadImage(blob);
    // Let the spinner paint before the heavy work.
    await new Promise(r => setTimeout(r, 30));
    const corners = findCorners(img);
    const grid = analyzeGrid(img, corners);
    const source = await lastSource();
    const p = {
      id: newId(), title: 'Crossword ' + new Date().toLocaleDateString(), created: Date.now(),
      meta: { source, setter: '', number: '', date: isoDay(Date.now()) },
      image: blob, imageWidth: img.naturalWidth, clueImage: null, corners, rows: grid.rows, cols: grid.cols, blocks: grid.blocks,
      detectedFor: JSON.stringify(corners),
      cluesText: { across: '', down: '' }, clues: { across: {}, down: {} }, fill: null, stage: 'solve',
    };
    URL.revokeObjectURL(url);
    resetFill(p);
    cache.set(p.id, p);
    await DB.savePuzzle(p);
    startClueJob(p);
    go(`#/p/${p.id}/solve`);
  } catch (err) {
    console.error(err);
    toast('Could not open that image: ' + (err.message || err), 4000);
  } finally {
    done();
  }
}

async function createBlank() {
  const ans = prompt('Grid size (e.g. 15 or 13x15):', '15');
  if (!ans) return;
  const m = ans.match(/(\d+)\s*(?:[x×*]\s*(\d+))?/i);
  if (!m) return;
  const rows = Math.min(30, Math.max(3, +m[1])), cols = Math.min(30, Math.max(3, +(m[2] || m[1])));
  const p = {
    id: newId(), title: 'Crossword ' + new Date().toLocaleDateString(), created: Date.now(),
    meta: { source: await lastSource(), setter: '', number: '', date: isoDay(Date.now()) },
    image: null, clueImage: null, corners: null, rows, cols, blocks: new Array(rows * cols).fill(0),
    cluesText: { across: '', down: '' }, clues: { across: {}, down: {} }, fill: null, stage: 'solve',
  };
  resetFill(p);
  cache.set(p.id, p);
  await DB.savePuzzle(p);
  go(`#/p/${p.id}/grid`);
}

const SORTS = { date: 'Date', edited: 'Edited', source: 'Source', setter: 'Setter' };

// Header: a random synonym of "cross", in boxed letters (🄰–🅉), different each time the screen loads.
// Each with a dictionary-style entry for the sense that relates to "cross" (every definition uses the word).
const CROSS_WORDS = [
  ['ANGRY', 'adj.', '', 'feeling or showing strong annoyance or hostility; very cross.'],
  ['IRATE', 'adj.', '', 'extremely cross; feeling or showing great anger.'],
  ['VEXED', 'adj.', '', 'cross, frustrated or worried.'],
  ['IRKED', 'adj.', '', 'irritated; made cross.'],
  ['TESTY', 'adj.', '', 'easily made cross; impatient and somewhat bad-tempered.'],
  ['TETCHY', 'adj.', '', 'bad-tempered and irritable; quick to get cross.'],
  ['CRABBY', 'adj.', 'informal', 'irritable and cross; ill-humoured.'],
  ['GRUMPY', 'adj.', '', 'cross and sulky.'],
  ['CRANKY', 'adj.', 'informal', 'ill-tempered and cross.'],
  ['PEEVED', 'adj.', 'informal', 'annoyed; mildly cross.'],
  ['MIFFED', 'adj.', 'informal', 'slightly put out; a little cross.'],
  ['NARKED', 'adj.', 'Brit. & Aus. informal', 'annoyed; cross.'],
  ['SHIRTY', 'adj.', 'Brit. informal', 'bad-tempered or cross.'],
  ['STROPPY', 'adj.', 'Brit. informal', 'bad-tempered, cross and argumentative.'],
  ['RATTY', 'adj.', 'informal', 'irritable; cross.'],
  ['HUFFY', 'adj.', '', 'easily offended; sulkily cross.'],
  ['SNAPPY', 'adj.', '', 'cross and inclined to speak sharply.'],
  ['ANNOYED', 'adj.', '', 'slightly angry; cross.'],
  ['PETULANT', 'adj.', '', 'childishly sulky or cross.'],
  ['IRRITABLE', 'adj.', '', 'easily annoyed or made cross.'],
  ['TRAVERSE', 'v.', '', 'to travel across or through; to cross.'],
  ['SPAN', 'v.', '', 'to extend from side to side of; to cross.'],
  ['BRIDGE', 'v.', '', 'to make or be a way across (a gap, river, etc.); to cross.'],
  ['FORD', 'v.', '', 'to cross (a river or stream) at a shallow place.'],
  ['INTERSECT', 'v.', '', 'to cross or pass across each other.'],
  ['HYBRID', 'n.', '', 'the offspring of two plants or animals of different kinds; a cross.'],
  ['MONGREL', 'n.', '', 'a dog of no definable breed; a cross between breeds.'],
  ['BLEND', 'n.', '', 'a mixture of different kinds; a cross between two things.'],
  ['THWART', 'v.', '', 'to prevent (someone) from accomplishing something; to cross.'],
  ['OPPOSE', 'v.', '', 'to set oneself against; to cross or contradict.'],
  ['FOIL', 'v.', '', 'to prevent (something) from succeeding; to cross (a plan).'],
  ['CRUCIFIX', 'n.', '', 'a cross bearing a figure of Christ.'],
  ['ROOD', 'n.', 'archaic', 'a cross or crucifix, especially one above a church screen.'],
  ['BURDEN', 'n.', '', 'a heavy load of duty or suffering; a cross to bear.'],
  ['TRIAL', 'n.', '', 'a source of annoyance or hardship; a cross to bear.'],
  ['TRAVAIL', 'n.', 'literary', 'painful or laborious effort; a cross to bear.'],
].map(([word, pos, label, def]) => ({ word, pos, label, def }));
const boxed = word => [...word].map(ch => String.fromCodePoint(0x1F130 + ch.charCodeAt(0) - 65)).join('');
function crossWord() {
  const last = store.get('squares.lastHeader', '');
  const options = CROSS_WORDS.filter(e => e.word !== last);
  const entry = options[Math.floor(Math.random() * options.length)];
  store.set('squares.lastHeader', entry.word);
  return entry;
}

function sortPuzzles(list, key, dir) {
  const byDate = (a, b) => metaOf(b).date.localeCompare(metaOf(a).date) || (b.created || 0) - (a.created || 0);
  const cmp = {
    date: byDate,
    edited: (a, b) => (b.updated || 0) - (a.updated || 0), // last saved, i.e. last worked on
    source: (a, b) => metaOf(a).source.localeCompare(metaOf(b).source, undefined, { sensitivity: 'base' }),
    setter: (a, b) => metaOf(a).setter.localeCompare(metaOf(b).setter, undefined, { sensitivity: 'base' }),
  }[key];
  const empty = p => (key === 'source' || key === 'setter') && !metaOf(p)[key];
  return [...list].sort((a, b) => {
    if (empty(a) !== empty(b)) return empty(a) ? 1 : -1; // puzzles missing this detail go last
    const c = cmp(a, b) * (dir === 'asc' ? -1 : 1);
    return c || byDate(a, b);
  });
}

// First clue with real text (Across first), skipping "See 23-down" style cross-references.
function firstClue(p) {
  for (const d of ['across', 'down']) {
    const list = (p.clues && p.clues[d]) || {};
    for (const n of Object.keys(list).map(Number).sort((a, b) => a - b)) {
      const t = P.clueBody(list[n]);
      if (t && !/^see\b/i.test(t)) return t;
    }
  }
  return '';
}

function statusLine(p) {
  if (jobs.has(p.id)) return 'Reading clues…';
  if (p.completedTime != null) return `✓ Finished · ${fmtTime(p.completedTime)}`;
  const pct = progressOf(p);
  const parts = [pct === null ? '' : `${pct}%`, p.timeMs >= 1000 ? `⏱ ${fmtTime(p.timeMs)}` : ''].filter(Boolean);
  return parts.join(' · ') || 'Not started';
}

function addMenu() {
  const s = sheet('New crossword', h('div', { class: 'menu' },
    h('button', { class: 'primary', onclick: async () => { s.close(); createFromImage(await filePicker({ capture: true })); } }, '📷  Take a photo'),
    h('button', { onclick: async () => { s.close(); createFromImage(await filePicker()); } }, '🖼  Choose an image'),
    h('button', { onclick: async () => { s.close(); addFromFile(await filePicker({ accept: 'application/pdf,.pdf,image/*' })); } }, '📄  Add from Files'),
    h('button', { onclick: () => { s.close(); createBlank(); } }, '▦  Blank grid'),
    h('button', { class: 'menu-minor', onclick: () => { s.close(); backupMenu(); } }, 'Back up & restore…')));
}

// Files: PDFs are read exactly; images go through the photo pipeline.
function addFromFile(file) {
  if (!file) return;
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) createFromPdf(file);
  else createFromImage(file);
}

// A crossword PDF (e.g. a newspaper's print version): grid from the drawing, clues as exact text.
async function createFromPdf(file) {
  if (!file) return;
  const done = busy('Reading the PDF…');
  try {
    const { canvas, items } = await readPdf(file);
    const blob = await canvasToBlob(canvas, 0.9);
    const { img, url } = await loadImage(blob);
    const corners = findCorners(img, 2400);
    const grid = analyzeGrid(img, corners, null, 2400);
    URL.revokeObjectURL(url);
    const text = textFromPdfItems(canvas, items, corners);
    const num = P.numberGrid(grid.rows, grid.cols, grid.blocks);
    const rec = P.reconcileClues(P.parseClueText(text), num);
    const cluesText = { across: P.cluesToText(rec.across), down: P.cluesToText(rec.down) };
    const guess = P.guessMeta(text);
    const guardian = /guardian/i.test(text.split('\n').slice(0, 3).join(' '));
    const fileDay = (file.name || '').match(/(20\d\d)(\d\d)(\d\d)/);
    const meta = {
      source: guardian ? 'The Guardian' : await lastSource(),
      setter: guess.setter || '', number: guess.number || '',
      date: fileDay ? `${fileDay[1]}-${fileDay[2]}-${fileDay[3]}` : isoDay(Date.now()),
    };
    // Already imported? Open it instead of making a copy.
    const all = await DB.listPuzzles();
    const dup = meta.number && all.find(x => x.meta && x.meta.number === meta.number && (x.meta.source || '') === meta.source);
    if (dup) {
      toast(`You already have ${displayTitle(dup)}; opening it.`, 4000);
      go(`#/p/${dup.id}/solve`);
      return;
    }
    const p = {
      id: newId(), title: file.name ? file.name.replace(/\.pdf$/i, '') : 'Crossword', created: Date.now(), meta,
      image: blob, imageWidth: canvas.width, clueImage: null, corners, rows: grid.rows, cols: grid.cols, blocks: grid.blocks,
      detectedFor: JSON.stringify(corners), cluesText, clues: P.cluesFromText(cluesText), cluesStatus: 'done',
      ocrText: text, fill: null, stage: 'solve',
    };
    resetFill(p);
    cache.set(p.id, p);
    await DB.savePuzzle(p);
    go(`#/p/${p.id}/solve`);
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), 5000);
  } finally {
    done();
  }
}

// Back up / restore all puzzles (moving them between Safari and the home-screen app on iPhone).
function backupMenu() {
  const status = h('p', { class: 'hint' });
  const body = h('div', { class: 'menu' },
    h('p', { class: 'hint' }, 'On iPhone, Safari and the home-screen app keep separate puzzles, and deleting the home-screen icon deletes its puzzles. To move them, back up in one and restore in the other. Restoring only adds puzzles; it never deletes any.'),
    h('button', { onclick: prepare }, '⬆︎  Back up all puzzles'),
    h('button', { onclick: restore }, '⬇︎  Restore from a backup file'),
    status);
  const s = sheet('Back up & restore', body);
  async function prepare() {
    status.textContent = 'Preparing backup…';
    try {
      const { file, count } = await makeBackup();
      // Sharing needs a fresh tap on iPhone, so offer the file as a second step.
      const mb = (file.size / 1e6).toFixed(1);
      status.replaceChildren(`Backup ready: ${count} puzzle${count === 1 ? '' : 's'}, ${mb} MB. `,
        h('button', { class: 'primary small', onclick: async () => {
          const how = await saveFile(file);
          if (how !== 'cancelled') status.textContent = how === 'shared' ? 'Backup saved.' : `Backup downloaded as ${file.name}.`;
        } }, 'Save backup file'));
    } catch (err) {
      status.textContent = 'Could not make the backup: ' + (err.message || err);
    }
  }
  async function restore() {
    const file = await filePicker({ accept: '.json,application/json' });
    if (!file) return;
    status.textContent = 'Restoring…';
    try {
      const r = await restoreBackup(file);
      cache.clear();
      s.close();
      toast(`Restored ${r.added} new puzzle${r.added === 1 ? '' : 's'}` + (r.updated ? `, updated ${r.updated}` : '') + (r.skipped ? ` (${r.skipped} already up to date)` : '') + '.', 4500);
      route();
    } catch (err) {
      status.textContent = err.message || String(err);
    }
  }
}

async function homeView() {
  const headerWord = crossWord(); // { word, pos, label, def }
  const all = (await DB.listPuzzles()).map(p => cache.get(p.id) || p);
  let key = store.get('squares.sort', 'date');
  if (!SORTS[key]) key = 'date';
  let dir = store.get('squares.sortDir', 'desc');

  const listEl = h('ul', { class: 'library' });
  const chips = h('div', { class: 'sortbar', role: 'group', 'aria-label': 'Sort puzzles' });
  // Filter: all puzzles, or only incomplete / complete ones (complete = every square filled).
  const FILTERS = { all: 'All', incomplete: 'Incomplete', complete: 'Complete' };
  let filter = store.get('squares.filter', 'all');
  if (!FILTERS[filter]) filter = 'all';
  const isDone = p => p.completedTime != null;
  // A single chip: each tap moves to the next option (All → Incomplete → Complete → All).
  const order = Object.keys(FILTERS);
  const filterEl = h('button', {
    class: 'chip filter',
    onclick: () => { filter = order[(order.indexOf(filter) + 1) % order.length]; store.set('squares.filter', filter); render(); },
  });

  function render() {
    filterEl.className = 'chip filter' + (filter !== 'all' ? ' on' : '');
    filterEl.textContent = FILTERS[filter];
    filterEl.setAttribute('aria-label', `Showing ${FILTERS[filter].toLowerCase()} puzzles. Tap to change.`);
    chips.replaceChildren(...Object.entries(SORTS).map(([k, label]) =>
      h('button', {
        class: 'chip' + (k === key ? ' on' : ''), 'aria-pressed': k === key ? 'true' : 'false',
        onclick: () => {
          if (k === key) dir = dir === 'desc' ? 'asc' : 'desc';
          else { key = k; dir = 'desc'; }
          store.set('squares.sort', key); store.set('squares.sortDir', dir);
          render();
        },
      }, label, k === key ? (dir === 'desc' ? ' ↓' : ' ↑') : '')), h('span', { class: 'sort-sep' }), filterEl);
    const shown = all.filter(p => filter === 'all' || (filter === 'complete' ? isDone(p) : !isDone(p)));
    if (!shown.length) {
      listEl.replaceChildren(h('p', { class: 'hint filter-empty' }, filter === 'complete' ? 'No complete puzzles yet.' : 'No incomplete puzzles — all done!'));
      return;
    }
    listEl.replaceChildren(...sortPuzzles(shown, key, dir).map(p => {
      const clue = firstClue(p);
      return h('li', { onclick: () => go(`#/p/${p.id}/solve`) },
        h('div', { class: 'row1' },
          h('span', { class: 'title' }, displayTitle(p)),
          h('span', { class: 'date' }, fmtDay(metaOf(p).date))),
        clue ? h('div', { class: 'first-clue' }, clue) : null,
        h('div', { class: 'sub' }, statusLine(p)));
    }));
  }
  render();

  setApp(
    header(boxed(headerWord.word)),
    h('main', { class: 'scroll pad home' },
      all.length ? chips : null,
      all.length ? listEl : h('div', { class: 'empty' },
        h('div', { class: 'big' }, '▦'),
        h('p', {}, 'Snap a photo of a crossword from a newspaper, magazine or screen, and solve it here.'),
        h('p', { class: 'hint-add' }, 'Tap + to add your first crossword.'))),
    h('button', { class: 'fab', 'aria-label': 'Add a crossword', onclick: addMenu }, '+'));
  const bar = app.querySelector('.bar');
  bar.classList.add('home-bar');
  const h1 = bar.querySelector('h1');
  h1.classList.add('brand');
  // The boxed word, with its dictionary entry underneath.
  const e = headerWord;
  // The word as a row of crossword squares, ending in a black square. Drawn with CSS rather than the
  // boxed Unicode letters, so the squares match each other and look the same on every device.
  const wordEl = h('span', { class: 'brand-word', 'aria-hidden': 'true' },
    [...e.word].map(ch => h('span', { class: 'tile' }, ch)), h('span', { class: 'tile block' }));
  const defEl = h('span', { class: 'brand-def' },
      h('i', { class: 'pos' }, e.pos), ' ',
      e.label ? h('span', { class: 'label' }, e.label + ' ') : null,
      // Crossword style: the definition followed by the letter count, e.g. "slightly angry; cross (7)".
      `${e.def.replace(/\.$/, '')} (${e.word.length})`);
  h1.replaceChildren(wordEl, defEl);
  h1.setAttribute('aria-label', `${e.word.toLowerCase()}, ${e.pos === 'adj.' ? 'adjective' : e.pos === 'v.' ? 'verb' : 'noun'}: ${e.def} ${e.word.length} letters.`);
  // Big, but shrink a long word until it fits beside the menu button.
  requestAnimationFrame(() => {
    // Square size: up to 34px, smaller when the word (plus its black square) needs the room.
    const n = e.word.length + 1;
    const fit = Math.floor(wordEl.clientWidth / (n + (n - 1) * 0.14));
    wordEl.style.setProperty('--t', Math.max(16, Math.min(34, fit)) + 'px');
  });
}

// ---------- fix grid: corners ----------

async function cornersView(p) {
  const { img, url } = await loadImage(p.image);
  onCleanup(() => URL.revokeObjectURL(url));
  const IW = img.naturalWidth, IH = img.naturalHeight;
  if (!p.corners) { p.corners = findCorners(img); saveSoon(p); }

  const canvas = h('canvas', { class: 'stage-canvas' });
  const stage = h('div', { class: 'stage' }, canvas);
  const view = { s: 1, ox: 0, oy: 0, w: 0, h: 0 };
  let active = -1, pointer = null;

  const toScreen = ([x, y]) => [view.ox + x * view.s, view.oy + y * view.s];
  const toImage = (sx, sy) => [
    Math.min(IW, Math.max(0, (sx - view.ox) / view.s)),
    Math.min(IH, Math.max(0, (sy - view.oy) / view.s)),
  ];

  function layout() {
    const w = stage.clientWidth, hh = stage.clientHeight;
    if (!w || !hh) return;
    view.w = w; view.h = hh;
    view.s = Math.min((w - 40) / IW, (hh - 40) / IH);
    view.ox = (w - IW * view.s) / 2;
    view.oy = (hh - IH * view.s) / 2;
    draw();
  }

  function draw() {
    const ctx = fitCanvas(canvas, view.w, view.h);
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, view.w, view.h);
    ctx.drawImage(img, view.ox, view.oy, IW * view.s, IH * view.s);
    const pts = p.corners.map(toScreen);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, view.w, view.h);
    ctx.moveTo(...pts[0]); pts.slice(1).forEach(q => ctx.lineTo(...q)); ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill('evenodd');
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(...pts[0]); pts.slice(1).forEach(q => ctx.lineTo(...q)); ctx.closePath();
    ctx.strokeStyle = '#4af'; ctx.lineWidth = 2; ctx.stroke();
    pts.forEach(([x, y], i) => {
      ctx.beginPath(); ctx.arc(x, y, i === active ? 16 : 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(68,170,255,0.35)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
    if (active >= 0) drawLoupe(ctx, pts[active]);
  }

  function drawLoupe(ctx, [px]) {
    const R = 64, zoom = 3;
    const cx = px < view.w / 2 ? view.w - R - 12 : R + 12, cy = R + 12;
    const [ix, iy] = p.corners[active];
    const srcR = R / (view.s * zoom);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#000'; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.drawImage(img, ix - srcR, iy - srcR, srcR * 2, srcR * 2, cx - R, cy - R, 2 * R, 2 * R);
    ctx.strokeStyle = '#f44'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
  }

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    let best = -1, bd = 70;
    p.corners.forEach((c, i) => {
      const [x, y] = toScreen(c);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0) return;
    active = best;
    const [cx, cy] = toScreen(p.corners[best]);
    pointer = { dx: cx - sx, dy: cy - sy };
    canvas.setPointerCapture(e.pointerId);
    draw();
  });
  canvas.addEventListener('pointermove', e => {
    if (active < 0) return;
    const r = canvas.getBoundingClientRect();
    p.corners[active] = toImage(e.clientX - r.left + pointer.dx, e.clientY - r.top + pointer.dy);
    draw();
  });
  const end = () => { if (active >= 0) { active = -1; saveSoon(p); draw(); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  async function rotate(dir) {
    if (p.fill.some(Boolean) && !confirm('Rotating re-detects the grid and clears your answers. Continue?')) return;
    const c = document.createElement('canvas');
    c.width = IH; c.height = IW;
    const ctx = c.getContext('2d');
    ctx.translate(IH / 2, IW / 2); ctx.rotate(dir * Math.PI / 2); ctx.drawImage(img, -IW / 2, -IH / 2);
    p.image = await canvasToBlob(c, 0.9);
    p.imageWidth = IH;
    p.corners = null;
    p.detectedFor = null;
    await DB.savePuzzle(p);
    route();
  }

  setApp(
    header('Fix grid: corners', { back: `#/p/${p.id}/solve` }),
    h('p', { class: 'hint' }, 'Drag the four circles onto the outer corners of the crossword grid.'),
    stage,
    h('div', { class: 'toolbar' },
      h('button', { onclick: () => rotate(-1), 'aria-label': 'Rotate left' }, '⟲'),
      h('button', { onclick: () => rotate(1), 'aria-label': 'Rotate right' }, '⟳'),
      h('button', { onclick: () => { p.corners = findCorners(img); saveSoon(p); draw(); } }, 'Auto'),
      h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: () => go(`#/p/${p.id}/grid`) }, 'Next ›')));

  const ro = new ResizeObserver(layout);
  ro.observe(stage);
  onCleanup(() => ro.disconnect());
}

// ---------- fix grid: squares ----------

async function gridView(p) {
  let warpCanvas = null, warpGray = null, img = null;
  let showPhoto = !!p.image;
  let symmetric = !p.image;

  if (p.image) {
    const loaded = await loadImage(p.image);
    img = loaded.img;
    onCleanup(() => URL.revokeObjectURL(loaded.url));
    if (!p.corners) p.corners = findCorners(img);
    const key = JSON.stringify(p.corners);
    const fresh = p.detectedFor !== key;
    const g = analyzeGrid(img, p.corners, fresh ? null : { rows: p.rows, cols: p.cols });
    warpGray = g.warp;
    warpCanvas = grayToCanvas(warpGray);
    if (fresh) {
      const sameSize = g.rows === p.rows && g.cols === p.cols;
      p.rows = g.rows; p.cols = g.cols; p.blocks = g.blocks; p.detectedFor = key;
      if (!sameSize || !p.fill) resetFill(p);
      else p.blocks.forEach((b, i) => { if (b) p.fill[i] = ''; });
      saveSoon(p);
    }
  }

  const canvas = h('canvas', { class: 'stage-canvas' });
  const stage = h('div', { class: 'stage' }, canvas);
  const view = { x: 0, y: 0, w: 0, h: 0, cs: 0, W: 0, H: 0 };

  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    view.cs = Math.min((W - 24) / p.cols, (H - 24) / p.rows);
    view.w = view.cs * p.cols; view.h = view.cs * p.rows;
    view.x = (W - view.w) / 2; view.y = (H - view.h) / 2;
    view.W = W; view.H = H;
    draw();
  }

  function draw() {
    if (!view.W) return;
    const ctx = fitCanvas(canvas, view.W, view.H);
    ctx.clearRect(0, 0, view.W, view.H);
    const { x, y, w, h: hh, cs } = view;
    const num = numbering(p);
    if (showPhoto && warpCanvas) ctx.drawImage(warpCanvas, x, y, w, hh);
    else { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, hh); }
    for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
      const i = r * p.cols + c;
      if (p.blocks[i]) {
        ctx.fillStyle = showPhoto ? 'rgba(20,110,255,0.6)' : '#1a1a1a';
        ctx.fillRect(x + c * cs, y + r * cs, cs, cs);
      } else if (!showPhoto && num.numbers[i] && cs > 14) {
        ctx.fillStyle = '#333';
        ctx.font = `${Math.max(7, cs * 0.3)}px system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(num.numbers[i], x + c * cs + 2, y + r * cs + 1);
      }
    }
    ctx.strokeStyle = showPhoto ? 'rgba(255,60,60,0.85)' : '#555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r <= p.rows; r++) { ctx.moveTo(x, y + r * cs); ctx.lineTo(x + w, y + r * cs); }
    for (let c = 0; c <= p.cols; c++) { ctx.moveTo(x + c * cs, y); ctx.lineTo(x + c * cs, y + hh); }
    ctx.stroke();
    info.textContent = `${num.across.length} across · ${num.down.length} down`;
  }

  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - r.left - view.x) / view.cs);
    const row = Math.floor((e.clientY - r.top - view.y) / view.cs);
    if (c < 0 || row < 0 || c >= p.cols || row >= p.rows) return;
    const i = row * p.cols + c;
    const v = p.blocks[i] ? 0 : 1;
    const cellsToSet = symmetric ? [i, p.rows * p.cols - 1 - i] : [i];
    for (const j of cellsToSet) { p.blocks[j] = v; p.fill[j] = ''; }
    saveSoon(p);
    draw();
  });

  function setSize(rows, cols) {
    p.rows = Math.min(30, Math.max(3, rows));
    p.cols = Math.min(30, Math.max(3, cols));
    p.blocks = warpGray ? V.classifyCells(warpGray, p.rows, p.cols) : new Array(p.rows * p.cols).fill(0);
    resetFill(p);
    saveSoon(p);
    rowsOut.textContent = p.rows; colsOut.textContent = p.cols;
    layout();
  }

  const rowsOut = h('output', {}, p.rows), colsOut = h('output', {}, p.cols);
  const info = h('span', { class: 'info' });
  const stepper = (label, out, d) => h('div', { class: 'stepper' },
    h('span', {}, label),
    h('button', { onclick: () => d(-1) }, '−'), out, h('button', { onclick: () => d(1) }, '+'));
  const toggle = (label, get, set) => {
    const b = h('button', { class: get() ? 'on' : '', onclick: () => { set(!get()); b.className = get() ? 'on' : ''; draw(); } }, label);
    return b;
  };

  setApp(
    header(p.image ? 'Fix grid: squares' : 'Edit grid', { back: p.image ? `#/p/${p.id}/corners` : `#/p/${p.id}/solve` }),
    h('p', { class: 'hint' }, p.image
      ? 'The red lines should sit on the grid lines (if not, go back and move the corners). Tap a square to switch it between black and white.'
      : 'Tap squares to make them black.'),
    stage,
    h('div', { class: 'toolbar wrap' },
      stepper('Rows', rowsOut, d => setSize(p.rows + d, p.cols)),
      stepper('Cols', colsOut, d => setSize(p.rows, p.cols + d)),
      p.image ? toggle('Photo', () => showPhoto, v => { showPhoto = v; }) : null,
      toggle('Symmetry', () => symmetric, v => { symmetric = v; }),
      info),
    h('div', { class: 'toolbar' },
      p.image ? h('button', { onclick: () => { p.detectedFor = null; route(); } }, 'Re-detect') : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: () => go(`#/p/${p.id}/solve`) }, 'Done')));

  const ro = new ResizeObserver(layout);
  ro.observe(stage);
  onCleanup(() => ro.disconnect());
}

// ---------- edit clues ----------

function regionPicker(img) {
  const IW = img.naturalWidth, IH = img.naturalHeight;
  const canvas = h('canvas', { class: 'stage-canvas' });
  const stage = h('div', { class: 'stage picker' }, canvas);
  const view = { s: 1, ox: 0, oy: 0, w: 0, h: 0 };
  let rect = null, dragFrom = null;
  const toImg = e => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(IW, Math.max(0, (e.clientX - r.left - view.ox) / view.s)),
            Math.min(IH, Math.max(0, (e.clientY - r.top - view.oy) / view.s))];
  };
  function layout() {
    view.w = stage.clientWidth; view.h = stage.clientHeight;
    if (!view.w || !view.h) return;
    view.s = Math.min(view.w / IW, view.h / IH);
    view.ox = (view.w - IW * view.s) / 2; view.oy = (view.h - IH * view.s) / 2;
    draw();
  }
  function draw() {
    const ctx = fitCanvas(canvas, view.w, view.h);
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, view.w, view.h);
    ctx.drawImage(img, view.ox, view.oy, IW * view.s, IH * view.s);
    if (rect) {
      const [x0, y0, x1, y1] = rect;
      const sx = view.ox + Math.min(x0, x1) * view.s, sy = view.oy + Math.min(y0, y1) * view.s;
      const sw = Math.abs(x1 - x0) * view.s, sh = Math.abs(y1 - y0) * view.s;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.rect(0, 0, view.w, view.h); ctx.rect(sx, sy, sw, sh); ctx.fill('evenodd');
      ctx.strokeStyle = '#4af'; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, sw, sh);
    }
  }
  canvas.addEventListener('pointerdown', e => { dragFrom = toImg(e); rect = [...dragFrom, ...dragFrom]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (dragFrom) { rect = [...dragFrom, ...toImg(e)]; draw(); } });
  canvas.addEventListener('pointerup', () => { dragFrom = null; });
  const ro = new ResizeObserver(layout);
  ro.observe(stage);
  onCleanup(() => ro.disconnect());
  const getRect = () => {
    if (!rect || Math.abs(rect[2] - rect[0]) < 10 || Math.abs(rect[3] - rect[1]) < 10) return null;
    return [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  };
  return { el: stage, getRect };
}

async function cluesView(p) {
  const num = numbering(p);
  p.cluesText = p.cluesText || { across: '', down: '' };
  const boxes = {}, status = {};
  const jobLine = h('div', { class: 'job-line' });

  function refresh() {
    p.cluesText = { across: boxes.across.value, down: boxes.down.value };
    p.clues = P.cluesFromText(p.cluesText);
    const rep = P.clueReport(num, p.clues);
    for (const dir of ['across', 'down']) {
      const r = rep[dir];
      status[dir].textContent = `${r.found}/${r.total}` + (r.missing.length ? ` · missing ${r.missing.slice(0, 8).join(', ')}${r.missing.length > 8 ? '…' : ''}` : ' ✓');
      status[dir].className = 'status ' + (r.missing.length ? 'warn' : 'ok');
    }
    saveSoon(p);
  }
  function showJob() {
    jobLine.textContent = jobs.has(p.id) ? jobLabel(p.id) : '';
    jobLine.hidden = !jobs.has(p.id);
  }
  listen(bus, 'clues', e => {
    if (e.detail.id !== p.id) return;
    if (e.detail.done) { boxes.across.value = p.cluesText.across; boxes.down.value = p.cluesText.down; refresh(); }
    showJob();
  });

  async function scanArea(dir) {
    let img = null;
    const body = h('div', { class: 'scan' });
    const s = sheet(`Read ${dir} clues from an area`, body, { tall: true });
    const pickSource = async src => {
      if (src === 'new') {
        const f = await filePicker();
        if (!f) return;
        p.clueImage = await normalizeImport(f);
        saveSoon(p);
      }
      const loaded = await loadImage(src === 'puzzle' ? p.image : p.clueImage);
      onCleanup(() => URL.revokeObjectURL(loaded.url));
      img = loaded.img;
      showPicker(src === 'puzzle');
    };
    body.replaceChildren(
      h('p', {}, 'Where are the clues?'),
      h('div', { class: 'cta' },
        p.image ? h('button', { onclick: () => pickSource('puzzle') }, 'In the crossword photo') : null,
        p.clueImage ? h('button', { onclick: () => pickSource('clue') }, 'In my clue photo') : null,
        h('button', { onclick: () => pickSource('new') }, 'In a different photo')));

    function showPicker(isPuzzlePhoto) {
      const picker = regionPicker(img);
      const prog = h('div', { class: 'progress' });
      const run = async whole => {
        const rect = whole ? null : picker.getRect();
        if (!whole && !rect) return toast('Drag a box around the clues first');
        buttons.forEach(b => { b.disabled = true; });
        try {
          const text = await readClueText(img, { rect, exclude: isPuzzlePhoto ? p.corners : null },
            m => { prog.textContent = m.label + (m.progress != null ? ` ${Math.round(m.progress * 100)}%` : '') + '…'; });
          const rec = cluesFromOcr(text, num, dir);
          for (const d of ['across', 'down']) {
            if (!rec[d].length) continue;
            const box = boxes[d];
            box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + P.cluesToText(rec[d]);
          }
          refresh();
          s.close();
          const n = rec.across.length + rec.down.length;
          toast(n ? `Added ${n} clues` : 'No numbered clues found there. Try a different box.', 3500);
        } catch (err) {
          prog.textContent = err.message || String(err);
          buttons.forEach(b => { b.disabled = false; });
        }
      };
      const buttons = [
        h('button', { onclick: () => run(true) }, 'Whole image'),
        h('button', { class: 'primary', onclick: () => run(false) }, 'Read selection'),
      ];
      body.replaceChildren(
        h('p', { class: 'hint' }, `Drag a box around the clues. “Across” and “Down” headings are recognised; text without one goes to ${dir}.`),
        picker.el, prog, h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), buttons));
    }
  }

  const section = dir => {
    boxes[dir] = h('textarea', {
      spellcheck: 'false', rows: 8,
      placeholder: `1 ${dir === 'across' ? 'Feline pet (3)' : 'Opposite of up (4)'}\n2 …`,
      oninput: refresh,
    });
    boxes[dir].value = p.cluesText[dir] || '';
    status[dir] = h('span', { class: 'status' });
    return h('section', { class: 'clue-edit' },
      h('div', { class: 'row' },
        h('h2', {}, dirLabel(dir)), status[dir], h('span', { class: 'grow' }),
        h('button', { class: 'small', onclick: () => scanArea(dir) }, '📷 From area')),
      boxes[dir]);
  };

  const photos = [p.image, p.clueImage].filter(Boolean);
  setApp(
    header('Edit clues', {
      back: `#/p/${p.id}/solve`,
      actions: [h('button', { class: 'small primary', onclick: () => go(`#/p/${p.id}/solve`) }, 'Done')],
    }),
    photos.length ? photoPane(photos, { className: 'top', side: clueSide(p) }) : null,
    h('main', { class: 'scroll pad' },
      jobLine,
      h('p', { class: 'hint' }, 'One clue per line, starting with its number. Compare with the photo above (pinch or +/− to zoom).'),
      section('across'), section('down'),
      p.image ? h('button', {
        onclick: () => {
          if ((boxes.across.value.trim() || boxes.down.value.trim()) && !confirm('Replace all clues with a fresh reading of the photo?')) return;
          startClueJob(p, { replace: true });
          showJob();
        },
      }, '↻ Read all clues again') : null));
  refresh();
  showJob();
}

// ---------- solve ----------

async function solveView(p) {
  if (!p.blocks) return go(`#/p/${p.id}/${p.image ? 'corners' : 'grid'}`);
  const N = p.rows * p.cols;
  if (!p.fill || p.fill.length !== N) resetFill(p);
  p.cluesText = p.cluesText || { across: '', down: '' };
  p.clues = p.clues || { across: {}, down: {} };
  // Resume clue reading that was interrupted (e.g. app closed mid-way).
  if (p.cluesStatus === 'pending' && !jobs.has(p.id)) startClueJob(p);

  const num = numbering(p);
  const allWords = [...num.across, ...num.down];
  if (!allWords.length) return go(`#/p/${p.id}/grid`);
  const clueText = w => (p.clues[w.dir] && p.clues[w.dir][w.num]) || '';
  const wordOf = (i, d) => { const k = (d === 'across' ? num.acrossOf : num.downOf)[i]; return k < 0 ? null : num[d][k]; };
  if (!p.pencil || p.pencil.length !== N) p.pencil = new Array(N).fill(false);

  // Answers spread over several entries (e.g. 24-across + 2-down) act as one.
  let groups = new Map();
  const groupWords = w => (groups.get(w) ? groups.get(w).words : [w]);
  const mainOf = w => (groups.get(w) ? groups.get(w).main : w);
  const shortName = w => `${w.num}${w.dir === 'across' ? 'A' : 'D'}`;
  // Order for ‹ › : skip the "See 24-across" parts, they belong to their main clue.
  let navWords = allWords;
  const isComplete = () => p.fill.every((v, i) => p.blocks[i] || v);

  // References between clues ("That's 24-down"): who mentions whom.
  let mentionedIn = new Map(); // main word -> [main words whose clue mentions it]
  let anyRefs = false;
  const answerOf = w => {
    const letters = groupWords(w).flatMap(x => x.cells).map(i => p.fill[i]);
    if (!letters.every(Boolean)) return '';
    // Follow the referenced clue's letter pattern, e.g. (3,2) -> "ARC UP".
    return P.formatAnswer(letters.join(''), P.parseEnumeration(clueText(mainOf(w))));
  };
  const refSpan = w => h('span', { class: 'ref', 'data-dir': w.dir, 'data-num': w.num }, shortName(w));
  const refTarget = el => {
    const r = el && el.closest && el.closest('.ref');
    return r ? num[r.dataset.dir].find(x => x.num === +r.dataset.num) : null;
  };
  // Clue text with tappable references, each followed by its answer once filled in.
  function clueNodes(text) {
    const nodes = [];
    let at = 0;
    for (const r of P.findRefs(text, num)) {
      nodes.push(text.slice(at, r.start));
      nodes.push(h('span', { class: 'ref', 'data-dir': r.word.dir, 'data-num': r.word.num }, text.slice(r.start, r.end)));
      const ans = answerOf(r.word);
      if (ans) nodes.push(' ', h('span', { class: 'ref-ans' }, `[${ans}]`));
      at = r.end;
    }
    nodes.push(text.slice(at));
    return nodes;
  }
  function depsLine(w) {
    const deps = mentionedIn.get(mainOf(w));
    if (!deps || !deps.length) return null;
    return h('div', { class: 'clue-deps' }, 'Mentioned in ', ...deps.flatMap((d, k) => (k ? [', ', refSpan(d)] : [refSpan(d)])));
  }

  let sel = allWords[0].cells[0];
  let dir = allWords[0].dir;
  if (p.cursor && p.cursor.i < N && wordOf(p.cursor.i, p.cursor.dir)) { sel = p.cursor.i; dir = p.cursor.dir; }

  // grid
  const grid = h('div', { class: 'xw', style: `--cols:${p.cols};--rows:${p.rows}` });
  const cells = [];
  for (let i = 0; i < N; i++) {
    const cell = h('div', { class: 'cell' + (p.blocks[i] ? ' block' : '') },
      num.numbers[i] ? h('span', { class: 'n' }, num.numbers[i]) : null,
      h('span', { class: 'l' }));
    cell.letter = cell.lastChild;
    if (!p.blocks[i]) cell.addEventListener('pointerdown', e => { e.preventDefault(); tapCell(i); });
    cells.push(cell);
    grid.append(cell);
  }
  const gridWrap = h('div', { class: 'xw-wrap' }, grid);

  let keyboard = null;
  // clue bar
  const clueLabel = h('div', { class: 'clue-text' });
  const PENCIL_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path stroke="currentColor" stroke-width="2" d="M13.5 7.1l3.4 3.4"/></svg>';
  // Pencil mode lives on the keyboard's bottom-left key.
  const pencilKey = h('button', {
    class: 'key wide pencil-key', 'aria-label': 'Pencil mode', title: 'Pencil mode: enter letters in grey',
    onpointerdown: e => { e.preventDefault(); setPencil(!p.pencilMode); },
  });
  pencilKey.innerHTML = PENCIL_SVG;
  function setPencil(on) {
    p.pencilMode = on;
    pencilKey.classList.toggle('on', on);
    pencilKey.setAttribute('aria-pressed', on ? 'true' : 'false');
    keyboard && keyboard.classList.toggle('pencil', on);
    saveSoon(p);
  }
  // Clue bar: swipe left/right for the next/previous clue, tap to switch Across/Down.
  const clueNum = h('div', { class: 'clue-num' });
  const clueSlide = h('div', { class: 'clue-slide' }, clueNum, clueLabel);
  const clueBar = h('div', { class: 'cluebar', role: 'button', 'aria-label': 'Clue: swipe for next or previous, tap to switch direction' }, clueSlide);
  let swipe = null;
  clueBar.addEventListener('pointerdown', e => {
    e.preventDefault();
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, ref: refTarget(e.target) };
    clueBar.setPointerCapture(e.pointerId);
    clueSlide.style.transition = 'none';
  });
  clueBar.addEventListener('pointermove', e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    swipe.dx = e.clientX - swipe.x;
    if (Math.abs(swipe.dx) > 6) clueSlide.style.transform = `translateX(${swipe.dx * 0.6}px)`;
  });
  const endSwipe = cancelled => e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    const ref = swipe.ref;
    swipe = null;
    clueSlide.style.transition = 'transform .18s ease-out';
    clueSlide.style.transform = '';
    if (cancelled) return;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) jumpWord(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { if (ref) selectWord(ref); else toggleDir(); }
  };
  clueBar.addEventListener('pointerup', endSwipe(false));
  clueBar.addEventListener('pointercancel', endSwipe(true));

  // clue list
  const listItems = new Map();
  const clueList = h('div', { class: 'cluelist' });
  function renderList() {
    listItems.clear();
    clueList.replaceChildren(...['across', 'down'].map(d => h('section', {},
      h('h3', {}, dirLabel(d)),
      h('ol', {}, num[d].map(w => {
        const body = P.clueBody(clueText(w));
        const li = h('li', { onclick: e => { selectWord(refTarget(e.target) || w); document.body.classList.remove('list-open'); } },
          h('b', {}, w.num),
          h('div', { class: 'li-text' }, h('span', {}, body ? clueNodes(body) : h('i', {}, `(${w.cells.length})`)), mainOf(w) === w ? depsLine(w) : null));
        listItems.set(w, li);
        return li;
      })))));
  }
  // Word breaks / hyphens from the (lengths), drawn on the cell edges.
  function renderMarks() {
    grid.querySelectorAll('.mk').forEach(el => el.remove());
    const seen = new Set();
    for (const w of allWords) {
      const main = mainOf(w);
      if (seen.has(main)) continue;
      seen.add(main);
      for (const m of P.answerMarks(groupWords(main), P.parseEnumeration(clueText(main)))) {
        cells[m.cell].append(h('i', { class: `mk ${m.kind}-${m.dir === 'across' ? 'a' : 'd'}`, 'aria-hidden': 'true' }));
      }
    }
  }
  function refreshClues() {
    groups = P.linkWords(num, p.clues);
    navWords = allWords.filter(w => mainOf(w) === w);
    mentionedIn = new Map();
    anyRefs = false;
    for (const w of navWords) {
      for (const r of P.findRefs(P.clueBody(clueText(w)), num)) {
        anyRefs = true;
        const target = mainOf(r.word);
        if (target === w || groupWords(w).includes(r.word)) continue; // its own parts
        const list = mentionedIn.get(target) || [];
        if (!list.includes(w)) list.push(w);
        mentionedIn.set(target, list);
      }
    }
    renderList();
    renderMarks();
  }

  // keyboard
  const keyRows = ['QWERTYUIOP', 'ASDFGHJKL', '✏ZXCVBNM⌫'];
  keyboard = h('div', { class: 'kbd' }, keyRows.map(row => h('div', { class: 'krow' },
    [...row].map(k => k === '✏' ? pencilKey : h('button', {
      class: 'key' + (k === '⌫' ? ' wide' : ''),
      'aria-label': k === '⌫' ? 'Backspace' : k,
      onpointerdown: e => { e.preventDefault(); k === '⌫' ? backspace() : type(k); },
    }, k)))));

  function update() {
    const w = wordOf(sel, dir);
    const parts = w ? groupWords(w) : [];
    const inWord = new Set(parts.flatMap(x => x.cells));
    for (let i = 0; i < N; i++) {
      if (p.blocks[i]) continue;
      const c = cells[i];
      c.classList.toggle('sel', i === sel);
      c.classList.toggle('word', inWord.has(i) && i !== sel);
      c.classList.toggle('pencil', !!(p.fill[i] && p.pencil[i]));
      c.letter.textContent = p.fill[i] || '';
    }
    if (w) {
      const main = mainOf(w);
      const t = P.clueBody(clueText(main));
      const len = parts.reduce((a, x) => a + x.cells.length, 0);
      let fallback;
      if (jobs.has(p.id)) fallback = jobLabel(p.id);
      else if (p.cluesStatus === 'failed') fallback = `Couldn't read the clues — use ⋯ → Edit clue (${len} letters)`;
      else fallback = `No clue text — ${len} letters · ⋯ → Edit clue to add`;
      clueNum.replaceChildren(...parts.map(x => h('span', {}, shortName(x))));
      clueLabel.replaceChildren(...(t ? clueNodes(t) : [h('i', {}, fallback)]), depsLine(main) || '');
    } else { clueNum.textContent = ''; clueLabel.textContent = ''; }
    for (const [word, li] of listItems) {
      li.classList.toggle('current', parts.includes(word));
      li.classList.toggle('done', word.cells.every(i => p.fill[i]));
    }
    const cur = w && listItems.get(w);
    if (cur && !document.body.classList.contains('list-open')) cur.scrollIntoView({ block: 'nearest' });
    p.cursor = { i: sel, dir };
  }

  // When each answer went in: { "across:12": { t: timer ms, letters } }. Only answers whose squares are
  // all filled in normal (non-pencil) letters count; changing a completed answer re-times it.
  p.answerLog = p.answerLog || {};
  const answerKey = w => `${mainOf(w).dir}:${mainOf(w).num}`;
  function logAnswersAt(i) {
    for (const d of ['across', 'down']) {
      const w = wordOf(i, d);
      if (!w) continue;
      const cellsOf = groupWords(w).flatMap(x => x.cells);
      const key = answerKey(w);
      const inked = cellsOf.every(c => p.fill[c] && !p.pencil[c]);
      const letters = cellsOf.map(c => p.fill[c]).join('');
      if (!inked) delete p.answerLog[key];
      else if (!p.answerLog[key] || p.answerLog[key].letters !== letters) p.answerLog[key] = { t: elapsed(), letters };
    }
  }
  // First and last answers in, with their clues, for the finishing panel (and later the puzzle list).
  function firstAndLast() {
    const entries = Object.entries(p.answerLog).sort((a, b) => a[1].t - b[1].t);
    if (!entries.length) return null;
    const describe = ([key, v]) => {
      const [d, n] = key.split(':');
      const w = num[d].find(x => x.num === +n);
      if (!w) return null;
      const clue = P.clueBody(clueText(w));
      return {
        name: groupWords(w).map(shortName).join(', '),
        clue,
        answer: P.formatAnswer(v.letters, P.parseEnumeration(clue)),
        t: v.t,
      };
    };
    return { first: describe(entries[0]), last: describe(entries[entries.length - 1]) };
  }
  function showFinished() {
    const fl = p.finishSummary;
    const row = (label, x) => x && h('div', { class: 'fin-row' },
      h('div', { class: 'fin-label' }, label, h('span', { class: 'fin-time' }, fmtTime(x.t))),
      h('div', { class: 'fin-clue' }, h('b', {}, x.name), ' ', x.clue || h('i', {}, 'no clue text')),
      h('div', { class: 'fin-answer' }, x.answer));
    sheet(`🎉 Finished in ${fmtTime(p.completedTime)}`, h('div', { class: 'finished pad' },
      fl ? [row('First in', fl.first), fl.last && fl.last !== fl.first ? row('Last in', fl.last) : null]
        : h('p', { class: 'hint' }, 'Every square is filled.')));
  }

  function changed() {
    saveSoon(p);
    if (anyRefs) renderList();
    update();
    if (p.completedTime == null && isComplete()) {
      stopTimer();
      p.completedTime = p.timeMs;
      p.finishSummary = firstAndLast();
      renderTimer();
      saveSoon(p);
      showFinished();
    }
  }

  // Timer: counts while the puzzle is on screen, from first opening until every square is filled.
  p.timeMs = p.timeMs || 0;
  let runningSince = null;
  const timerEl = h('span', { class: 'timer', 'aria-label': 'Time' });
  const elapsed = () => p.timeMs + (runningSince ? Date.now() - runningSince : 0);
  function renderTimer() {
    timerEl.textContent = p.completedTime != null ? `✓ ${fmtTime(p.completedTime)}` : `⏱ ${fmtTime(elapsed())}`;
    timerEl.classList.toggle('done', p.completedTime != null);
  }
  function startTimer() {
    if (runningSince || p.completedTime != null || document.hidden) return;
    runningSince = Date.now();
  }
  function stopTimer() {
    if (!runningSince) return;
    p.timeMs += Date.now() - runningSince;
    runningSince = null;
    saveSoon(p);
    flushSave();
  }
  listen(document, 'visibilitychange', () => { if (document.hidden) stopTimer(); else startTimer(); renderTimer(); });
  listen(window, 'pagehide', stopTimer);
  let ticks = 0;
  const tick = setInterval(() => {
    // Bank the running time every few seconds so a crash or reload loses almost nothing.
    if (runningSince && ++ticks % 5 === 0) {
      const now = Date.now();
      p.timeMs += now - runningSince;
      runningSince = now;
      saveSoon(p);
    }
    renderTimer();
  }, 1000);
  onCleanup(() => { clearInterval(tick); stopTimer(); });

  function tapCell(i) {
    if (i === sel) toggleDir();
    else {
      sel = i;
      if (!wordOf(i, dir)) dir = otherDir(dir);
      update();
    }
  }
  function toggleDir() {
    if (wordOf(sel, otherDir(dir))) { dir = otherDir(dir); update(); }
  }
  function selectWord(w, empty = true) {
    dir = w.dir;
    sel = (empty ? w.cells.find(i => !p.fill[i]) : undefined) ?? w.cells[0];
    update();
  }
  // An answer is finished when every square has an inked (non-pencil) letter.
  const answerCells = w => groupWords(w).flatMap(x => x.cells.map(i => [x, i]));
  const isFinished = w => answerCells(w).every(([, i]) => p.fill[i] && !p.pencil[i]);
  function jumpWord(delta) {
    const w = wordOf(sel, dir);
    const k = w ? navWords.indexOf(mainOf(w)) : 0;
    const L = navWords.length;
    // Skip answers that are already finished (unless everything is).
    let next = navWords[(k + delta + L) % L];
    for (let step = 1; step <= L; step++) {
      const cand = navWords[(((k + delta * step) % L) + L) % L];
      if (!isFinished(cand)) { next = cand; break; }
    }
    // Land on the first empty square, else the first pencilled one, else the start.
    const cellsOf = answerCells(next);
    const target = cellsOf.find(([, i]) => !p.fill[i]) || cellsOf.find(([, i]) => p.pencil[i]);
    if (target) { dir = target[0].dir; sel = target[1]; update(); } else selectWord(next, false);
  }
  function type(ch) {
    p.fill[sel] = ch;
    p.pencil[sel] = !!p.pencilMode;
    logAnswersAt(sel);
    const w = wordOf(sel, dir);
    if (w) {
      const parts = groupWords(w);
      const pos = w.cells.indexOf(sel);
      const nextPart = parts[parts.indexOf(w) + 1];
      if (pos < w.cells.length - 1) sel = w.cells[pos + 1];
      else if (nextPart) { dir = nextPart.dir; sel = nextPart.cells[0]; }   // carry on into the next part
      // On the answer's last square: stay put (swipe the clue bar to move on).
    }
    changed();
  }
  function backspace() {
    const before = sel;
    if (p.fill[sel]) p.fill[sel] = '';
    else {
      const w = wordOf(sel, dir);
      const pos = w ? w.cells.indexOf(sel) : 0;
      const parts = w ? groupWords(w) : [];
      const prevPart = parts[parts.indexOf(w) - 1];
      if (pos > 0) { sel = w.cells[pos - 1]; p.fill[sel] = ''; }
      else if (prevPart) { dir = prevPart.dir; sel = prevPart.cells[prevPart.cells.length - 1]; p.fill[sel] = ''; }
    }
    p.pencil[sel] = false;
    logAnswersAt(before); logAnswersAt(sel);
    changed();
  }
  function move(dr, dc) {
    const want = dc ? 'across' : 'down';
    if (dir !== want && wordOf(sel, want)) { dir = want; update(); return; }
    let r = Math.floor(sel / p.cols), c = sel % p.cols;
    for (;;) {
      r += dr; c += dc;
      if (r < 0 || c < 0 || r >= p.rows || c >= p.cols) return;
      if (!p.blocks[r * p.cols + c]) { sel = r * p.cols + c; update(); return; }
    }
  }

  listen(document, 'keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.sheet-wrap')) return;
    if (/^[a-z]$/i.test(e.key)) { type(e.key.toUpperCase()); e.preventDefault(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { backspace(); e.preventDefault(); }
    else if (e.key === ' ') { toggleDir(); e.preventDefault(); }
    else if (e.key === 'Tab' || e.key === 'Enter') { jumpWord(e.shiftKey ? -1 : 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { move(0, -1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { move(0, 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { move(-1, 0); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { move(1, 0); e.preventDefault(); }
  });

  // Background clue reading: show progress, then the clues.
  listen(bus, 'clues', e => {
    if (e.detail.id !== p.id) return;
    if (e.detail.done) {
      titleEl.textContent = displayTitle(p);
      refreshClues();
      if (e.detail.error) toast(`Couldn't read the clues: ${e.detail.error}`, 4500);
      else {
        const r = e.detail.report;
        const found = r.across.found + r.down.found, total = r.across.total + r.down.total;
        toast(found === total ? `Clues loaded (${total}). Spot a typo? ⋯ → Edit clue.` : `Read ${found} of ${total} clues. Add the rest with ⋯ → Edit clue.`, 4500);
      }
    }
    update();
  });

  function layout() {
    // Leave room for the 1px gaps between cells and the 2px outer border.
    const W = gridWrap.clientWidth - 8 - 4 - (p.cols - 1);
    const H = gridWrap.clientHeight - 8 - 4 - (p.rows - 1);
    const cs = Math.max(12, Math.floor(Math.min(W / p.cols, H / p.rows)));
    grid.style.setProperty('--cell', cs + 'px');
  }
  const ro = new ResizeObserver(layout);
  ro.observe(gridWrap);
  onCleanup(() => ro.disconnect());

  // Edit the current clue, with the photo for reference.
  function editClue({ big = false } = {}) {
    const cur = wordOf(sel, dir);
    if (!cur) return;
    const w = mainOf(cur);
    const parts = groupWords(w);
    const input = h('textarea', { class: 'clue-input', rows: big ? 2 : 3, spellcheck: 'true' });
    input.value = clueText(w);
    const save = () => {
      p.cluesText[w.dir] = P.setClueLine(p.cluesText[w.dir], w.num, input.value);
      p.clues = P.cluesFromText(p.cluesText);
      saveSoon(p);
      refreshClues();
      update();
      s.close();
    };
    const photos = [p.image, p.clueImage].filter(Boolean);
    const totalLen = parts.reduce((a, x) => a + x.cells.length, 0);
    const name = `${parts.map(x => `${x.num} ${dirLabel(x.dir)}`).join(' + ')} · ${totalLen} letters`;
    const s = sheet(big ? `Photo · ${name}` : name, h('div', { class: 'edit-clue' + (big ? ' big' : '') },
      photos.length ? photoPane(photos, { className: big ? 'in-sheet full' : 'in-sheet', side: clueSide(p) }) : null,
      h('div', { class: 'pad' },
        input,
        h('div', { class: 'toolbar flat' },
          h('button', { class: 'small', onclick: () => go(`#/p/${p.id}/clues`) }, 'All clues…'),
          p.image && !jobs.has(p.id) && p.cluesStatus === 'failed'
            ? h('button', { class: 'small', onclick: () => { startClueJob(p); s.close(); update(); } }, '↻ Try reading again') : null,
          h('span', { class: 'grow' }),
          h('button', { class: 'primary', onclick: save }, 'Save')))), { tall: photos.length > 0 });
    // On the photo screen, don't pop the phone keyboard up over the photo straight away.
    if (!big) setTimeout(() => input.focus(), 50);
  }

  function anagram() {
    const w = wordOf(sel, dir);
    const pattern = w ? w.cells.map(i => p.fill[i] || '·').join('') : '';
    const input = h('input', { type: 'text', placeholder: 'Letters to rearrange', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
    const wheel = h('div', { class: 'wheel' });
    const draw = shuffle => {
      const letters = [...input.value.toUpperCase().replace(/[^A-Z]/g, '')];
      if (shuffle) for (let i = letters.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [letters[i], letters[j]] = [letters[j], letters[i]]; }
      wheel.replaceChildren(...letters.map((l, k) => {
        const a = (k / letters.length) * Math.PI * 2 - Math.PI / 2;
        const rad = letters.length > 1 ? 38 : 0;
        return h('span', { style: `left:${50 + rad * Math.cos(a)}%;top:${50 + rad * Math.sin(a)}%` }, l);
      }));
    };
    input.addEventListener('input', () => draw(false));
    sheet('Anagram helper', h('div', { class: 'anagram' },
      pattern ? h('p', { class: 'pattern' }, 'Current answer: ', h('code', {}, pattern), ` (${pattern.length})`) : null,
      input, wheel,
      h('div', { class: 'toolbar flat' }, h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: () => draw(true) }, 'Shuffle'))));
    setTimeout(() => input.focus(), 50);
  }

  // The photo, with the current clue editable underneath.
  function showPhoto() {
    if (![p.image, p.clueImage].some(Boolean)) return toast('This puzzle has no photo');
    editClue({ big: true });
  }

  function menu() {
    const s = sheet('Puzzle', h('div', { class: 'menu' },
      h('button', { onclick: () => { s.close(); editClue(); } }, '✎  Edit this clue'),
      p.image ? h('button', { onclick: () => { s.close(); showPhoto(); } }, '🖼  Show photo') : null,
      h('button', { onclick: () => { s.close(); anagram(); } }, '🔀  Anagram helper'),
      h('button', { onclick: () => go(`#/p/${p.id}/clues`) }, '✏️  Edit clues'),
      h('button', { onclick: () => go(`#/p/${p.id}/${p.image ? 'corners' : 'grid'}`) }, '▦  Fix grid'),
      p.image ? h('button', { onclick: () => {
        if (!confirm('Read all clues from the photo again? This replaces the current clues.')) return;
        startClueJob(p, { replace: true }); s.close(); update();
      } }, '↻  Read clues again') : null,
      h('button', { onclick: () => { s.close(); editDetails(); } }, '🏷  Details (source, setter, number, date)'),
      h('button', { onclick: () => {
        if (!confirm('Clear all your answers and reset the timer?')) return;
        stopTimer();
        resetFill(p); p.pencil = new Array(N).fill(false); p.answerLog = {}; p.finishSummary = null;
        p.timeMs = 0; p.completedTime = null;
        startTimer(); renderTimer(); changed(); s.close();
      } }, '🧹  Clear answers'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('Delete this puzzle?')) return;
        pendingSaves.delete(p);
        cache.delete(p.id);
        await DB.deletePuzzle(p.id);
        go('#/');
      } }, '🗑  Delete puzzle')));
  }

  async function editDetails() {
    const m = metaOf(p);
    const others = (await DB.listPuzzles()).filter(x => x.id !== p.id && x.meta);
    const options = k => [...new Set(others.map(x => x.meta[k]).filter(Boolean))].sort().map(v => h('option', { value: v }));
    const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
    const inputs = {
      source: h('input', { type: 'text', value: m.source, list: 'dl-source', placeholder: 'e.g. The Age', autocapitalize: 'words' }),
      setter: h('input', { type: 'text', value: m.setter, list: 'dl-setter', placeholder: 'e.g. DA', autocapitalize: 'words' }),
      number: h('input', { type: 'text', value: m.number, inputmode: 'numeric', placeholder: 'e.g. 1335' }),
      date: h('input', { type: 'date', value: m.date }),
    };
    const s = sheet('Details', h('div', { class: 'details pad' },
      field('Source', inputs.source), h('datalist', { id: 'dl-source' }, options('source')),
      field('Setter', inputs.setter), h('datalist', { id: 'dl-setter' }, options('setter')),
      field('Number', inputs.number),
      field('Published', inputs.date),
      h('div', { class: 'toolbar flat' }, h('span', { class: 'grow' }, ), h('button', {
        class: 'primary', onclick: () => {
          p.meta = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
          if (!p.meta.date) p.meta.date = isoDay(p.created || Date.now());
          titleEl.textContent = displayTitle(p);
          saveSoon(p);
          s.close();
        },
      }, 'Save'))));
  }

  const bar = header(displayTitle(p), {
    back: '#/',
    actions: [
      h('button', { class: 'icon list-btn', 'aria-label': 'Clue list', onclick: () => document.body.classList.toggle('list-open') }, '☰'),
      h('button', { class: 'icon', 'aria-label': 'Menu', onclick: menu }, '⋯'),
    ],
  });
  const h1 = bar.querySelector('h1');
  const titleEl = h('span', { class: 't' }, displayTitle(p));
  h1.replaceChildren(titleEl, timerEl);
  h1.classList.add('with-timer');
  document.body.classList.add('solving');
  onCleanup(() => document.body.classList.remove('solving'));

  setApp(h('div', { class: 'solve' },
    bar,
    h('div', { class: 'solve-main' }, gridWrap, clueList),
    clueBar, keyboard));
  refreshClues();
  setPencil(!!p.pencilMode);
  // Older puzzles finished before the timer existed.
  if (p.completedTime == null && isComplete()) p.completedTime = p.timeMs;
  startTimer();
  renderTimer();
  update();
}

// ---------- boot ----------

// The iPhone colours the strip behind the status bar from the theme colour, and doesn't follow a
// light/dark switch by itself, so keep it equal to the header colour whenever the appearance changes.
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  if (meta && colour) meta.setAttribute('content', colour);
}
syncThemeColor();
const darkQuery = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
if (darkQuery) {
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', syncThemeColor);
  else if (darkQuery.addListener) darkQuery.addListener(syncThemeColor);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncThemeColor(); });

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // When an updated version takes over, reload once so it shows straight away (after saving).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController || reloading) return;
    reloading = true;
    await flushSave();
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(reg => reg.update())
    .catch(() => {});
}
