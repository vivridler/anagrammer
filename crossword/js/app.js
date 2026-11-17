import * as V from './vision.js';
import * as P from './puzzle.js';
import * as DB from './store.js';
import { recognizeText } from './ocr.js';

const app = document.getElementById('app');

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

const go = hash => { location.hash = hash; };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

let teardown = [];
function onCleanup(fn) { teardown.push(fn); }
function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  onCleanup(() => target.removeEventListener(type, fn, opts));
}

function toast(msg, ms = 2500) {
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

function sheet(title, body, { onClose } = {}) {
  const close = () => { wrap.remove(); onClose && onClose(); };
  const wrap = h('div', { class: 'sheet-wrap', onclick: e => { if (e.target === wrap) close(); } },
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

function scaledCanvas(img, maxDim) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, maxDim / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.round(iw * s); c.height = Math.round(ih * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, scale: s };
}

function grayOf(canvas) {
  return V.grayFromImageData(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
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

const canvasToBlob = (c, q = 0.88) => new Promise(r => c.toBlob(r, 'image/jpeg', q));

async function normalizeImport(file) {
  const { img, url } = await loadImage(file);
  const { canvas } = scaledCanvas(img, 2400);
  URL.revokeObjectURL(url);
  return canvasToBlob(canvas);
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

let saveTimer = null, pendingSave = null;
function flushSave() {
  clearTimeout(saveTimer);
  if (pendingSave) { DB.savePuzzle(pendingSave); pendingSave = null; }
}
function saveSoon(p) {
  clearTimeout(saveTimer);
  pendingSave = p;
  saveTimer = setTimeout(flushSave, 300);
}
// Don't lose the last keystrokes if the app is closed or switched away from.
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);

function filePicker({ capture } = {}) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: 'image/*', capture: capture ? 'environment' : null, style: 'display:none' });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// ---------- router ----------

async function route() {
  flushSave();
  teardown.forEach(fn => fn());
  teardown = [];
  document.querySelectorAll('.sheet-wrap').forEach(el => el.remove());
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (parts[0] === 'p' && parts[1]) {
      const p = await DB.getPuzzle(parts[1]);
      if (!p) return go('#/');
      const view = { corners: cornersView, grid: gridView, clues: cluesView, solve: solveView }[parts[2]] || solveView;
      await view(p);
    } else {
      await homeView();
    }
  } catch (err) {
    console.error(err);
    app.replaceChildren(header('Something went wrong', { back: '#/' }),
      h('div', { class: 'pad' }, h('p', {}, String(err.message || err))));
  }
}

// ---------- home / library ----------

function miniGrid(p) {
  const c = h('canvas', { class: 'thumb' });
  const size = 56, dpr = window.devicePixelRatio || 1;
  c.width = c.height = size * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  if (p.blocks) {
    const cs = size / Math.max(p.rows, p.cols);
    for (let r = 0; r < p.rows; r++) for (let col = 0; col < p.cols; col++) {
      const i = r * p.cols + col;
      if (p.blocks[i]) { ctx.fillStyle = '#222'; ctx.fillRect(col * cs, r * cs, cs, cs); }
      else if (p.fill && p.fill[i]) { ctx.fillStyle = '#8ab4f8'; ctx.fillRect(col * cs + cs * .2, r * cs + cs * .2, cs * .6, cs * .6); }
    }
  }
  return c;
}

function progressOf(p) {
  if (!p.blocks || !p.fill) return null;
  let open = 0, filled = 0;
  p.blocks.forEach((b, i) => { if (!b) { open++; if (p.fill[i]) filled++; } });
  return open ? Math.round(100 * filled / open) : 0;
}

async function createFromImage(file) {
  if (!file) return;
  const blob = await normalizeImport(file);
  const p = {
    id: newId(), title: 'Crossword ' + new Date().toLocaleDateString(), created: Date.now(),
    image: blob, clueImage: null, corners: null, rows: 15, cols: 15, blocks: null,
    cluesText: { across: '', down: '' }, clues: { across: {}, down: {} }, fill: null, stage: 'corners',
  };
  await DB.savePuzzle(p);
  go(`#/p/${p.id}/corners`);
}

async function createBlank() {
  const ans = prompt('Grid size (e.g. 15 or 13x15):', '15');
  if (!ans) return;
  const m = ans.match(/(\d+)\s*(?:[x×*]\s*(\d+))?/i);
  if (!m) return;
  const rows = Math.min(30, Math.max(3, +m[1])), cols = Math.min(30, Math.max(3, +(m[2] || m[1])));
  const p = {
    id: newId(), title: 'Crossword ' + new Date().toLocaleDateString(), created: Date.now(),
    image: null, clueImage: null, corners: null, rows, cols, blocks: new Array(rows * cols).fill(0),
    cluesText: { across: '', down: '' }, clues: { across: {}, down: {} }, fill: null, stage: 'grid',
  };
  await DB.savePuzzle(p);
  go(`#/p/${p.id}/grid`);
}

async function homeView() {
  const puzzles = await DB.listPuzzles();
  const list = puzzles.length
    ? h('ul', { class: 'library' }, puzzles.map(p => {
        const pct = progressOf(p);
        const stageLabel = { corners: 'Finding grid…', grid: 'Checking grid…', clues: 'Adding clues…' }[p.stage];
        return h('li', { onclick: () => go(`#/p/${p.id}/${p.stage || 'solve'}`) },
          miniGrid(p),
          h('div', { class: 'meta' },
            h('div', { class: 'title' }, p.title),
            h('div', { class: 'sub' }, stageLabel || (pct === null ? '' : `${pct}% filled`) ,
              ' · ', new Date(p.updated).toLocaleDateString())));
      }))
    : h('div', { class: 'empty' },
        h('div', { class: 'big' }, '▦'),
        h('p', {}, 'Snap a photo of a crossword from a newspaper, magazine or screen, and solve it here.'));

  app.replaceChildren(
    header('Crossword Solver'),
    h('main', { class: 'scroll pad' },
      h('div', { class: 'cta' },
        h('button', { class: 'primary', onclick: async () => createFromImage(await filePicker({ capture: true })) }, '📷  Take a photo'),
        h('button', { onclick: async () => createFromImage(await filePicker()) }, '🖼  Choose an image'),
        h('button', { class: 'ghost', onclick: createBlank }, '▦  Blank grid')),
      puzzles.length ? h('h2', { class: 'section' }, 'Your puzzles') : null,
      list));
}

// ---------- step 1: corners ----------

async function cornersView(p) {
  const { img, url } = await loadImage(p.image);
  onCleanup(() => URL.revokeObjectURL(url));
  const IW = img.naturalWidth, IH = img.naturalHeight;

  const autoDetect = () => {
    const { canvas, scale } = scaledCanvas(img, 1000);
    return V.detectGridCorners(grayOf(canvas)).map(([x, y]) => [x / scale, y / scale]);
  };
  if (!p.corners) { p.corners = autoDetect(); saveSoon(p); }

  const canvas = h('canvas', { class: 'stage-canvas' });
  const stage = h('div', { class: 'stage' }, canvas);
  let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0 };
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
    // dim outside the grid
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

  function drawLoupe(ctx, [px, py]) {
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
    const c = document.createElement('canvas');
    c.width = IH; c.height = IW;
    const ctx = c.getContext('2d');
    ctx.translate(IH / 2, IW / 2); ctx.rotate(dir * Math.PI / 2); ctx.drawImage(img, -IW / 2, -IH / 2);
    p.image = await canvasToBlob(c, 0.9);
    p.corners = null;
    await DB.savePuzzle(p);
    route();
  }

  app.replaceChildren(
    header('1. Find the grid', { back: '#/' }),
    h('p', { class: 'hint' }, 'Drag the four circles onto the outer corners of the crossword grid.'),
    stage,
    h('div', { class: 'toolbar' },
      h('button', { onclick: () => rotate(-1), 'aria-label': 'Rotate left' }, '⟲'),
      h('button', { onclick: () => rotate(1), 'aria-label': 'Rotate right' }, '⟳'),
      h('button', { onclick: () => { p.corners = autoDetect(); saveSoon(p); draw(); } }, 'Auto'),
      h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: async () => { p.stage = 'grid'; await DB.savePuzzle(p); go(`#/p/${p.id}/grid`); } }, 'Next ›')));

  const ro = new ResizeObserver(layout);
  ro.observe(stage);
  onCleanup(() => ro.disconnect());
}

// ---------- step 2: grid ----------

function resetFill(p) {
  p.fill = new Array(p.rows * p.cols).fill('');
}

async function gridView(p) {
  let warpCanvas = null, warpGray = null;
  let showPhoto = !!p.image;
  let symmetric = !p.image;

  if (p.image) {
    const { img, url } = await loadImage(p.image);
    URL.revokeObjectURL(url);
    const { canvas, scale } = scaledCanvas(img, 1800);
    const corners = p.corners.map(([x, y]) => [x * scale, y * scale]);
    warpGray = V.warpGray(grayOf(canvas), corners, 900, 900);
    warpCanvas = grayToCanvas(warpGray);
    const key = JSON.stringify(p.corners);
    if (!p.blocks || p.detectedFor !== key) {
      const size = V.detectGridSize(warpGray);
      p.rows = size.rows; p.cols = size.cols;
      p.blocks = V.classifyCells(warpGray, p.rows, p.cols);
      p.detectedFor = key;
      resetFill(p);
      saveSoon(p);
    }
  }

  const canvas = h('canvas', { class: 'stage-canvas' });
  const stage = h('div', { class: 'stage' }, canvas);
  let view = { x: 0, y: 0, w: 0, h: 0, cs: 0 };

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
    const ctx = fitCanvas(canvas, view.W, view.H);
    ctx.clearRect(0, 0, view.W, view.H);
    const { x, y, w, h: hh, cs } = view;
    const num = P.numberGrid(p.rows, p.cols, p.blocks);
    if (showPhoto && warpCanvas) {
      ctx.drawImage(warpCanvas, x, y, w, hh);
    } else {
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, hh);
    }
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
    p.blocks[i] = v;
    if (symmetric) p.blocks[p.rows * p.cols - 1 - i] = v;
    resetFill(p);
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

  const photoToggle = h('button', { class: showPhoto ? 'on' : '', onclick: () => { showPhoto = !showPhoto; photoToggle.className = showPhoto ? 'on' : ''; draw(); } }, 'Photo');
  const symToggle = h('button', { class: symmetric ? 'on' : '', onclick: () => { symmetric = !symmetric; symToggle.className = symmetric ? 'on' : ''; } }, 'Symmetry');

  app.replaceChildren(
    header('2. Check the grid', { back: p.image ? `#/p/${p.id}/corners` : '#/' }),
    h('p', { class: 'hint' }, p.image
      ? 'Make sure the red lines sit on the grid lines. Tap a square to switch it between black and white.'
      : 'Tap squares to make them black.'),
    stage,
    h('div', { class: 'toolbar wrap' },
      stepper('Rows', rowsOut, d => setSize(p.rows + d, p.cols)),
      stepper('Cols', colsOut, d => setSize(p.rows, p.cols + d)),
      p.image ? photoToggle : null,
      symToggle,
      info),
    h('div', { class: 'toolbar' },
      p.image ? h('button', { onclick: () => { p.detectedFor = null; route(); } }, 'Re-detect') : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: async () => {
        if (!p.fill || p.fill.length !== p.rows * p.cols) resetFill(p);
        p.stage = p.stage === 'solve' ? 'solve' : 'clues';
        await DB.savePuzzle(p);
        go(`#/p/${p.id}/clues`);
      } }, 'Next ›')));

  const ro = new ResizeObserver(layout);
  ro.observe(stage);
  onCleanup(() => ro.disconnect());
}

// ---------- step 3: clues ----------

function regionPicker(img, onPick) {
  // Lets the user drag a rectangle over the image. Calls onPick([x0,y0,x1,y1]) in image px.
  const IW = img.naturalWidth, IH = img.naturalHeight;
  const canvas = h('canvas', { class: 'stage-canvas' });
  const stage = h('div', { class: 'stage picker' }, canvas);
  let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0 }, rect = null, dragFrom = null;
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

function ocrCanvas(img, [x0, y0, x1, y1]) {
  const w = x1 - x0, hh = y1 - y0;
  const s = Math.min(3, Math.max(1, 1600 / w));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(hh * s);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.3)';
  ctx.drawImage(img, x0, y0, w, hh, 0, 0, c.width, c.height);
  return c;
}

async function cluesView(p) {
  const num = P.numberGrid(p.rows, p.cols, p.blocks);
  p.cluesText = p.cluesText || { across: '', down: '' };

  const boxes = {};
  const status = {};
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

  function addText(dir, list) {
    if (!list.length) return;
    const box = boxes[dir];
    box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + P.cluesToText(list);
  }

  async function scan(dir) {
    let img = null, url = null;
    const pickSource = async src => {
      const blob = src === 'puzzle' ? p.image : await filePicker();
      if (!blob) return;
      if (src !== 'puzzle') { p.clueImage = await normalizeImport(blob); saveSoon(p); }
      ({ img, url } = await loadImage(src === 'puzzle' ? p.image : p.clueImage));
      onCleanup(() => URL.revokeObjectURL(url));
      showPicker();
    };
    const body = h('div', { class: 'scan' });
    const s = sheet(`Scan ${dir} clues`, body);
    s.el.classList.add('tall');

    const choose = () => body.replaceChildren(
      h('p', {}, 'Where are the clues?'),
      h('div', { class: 'cta' },
        p.image ? h('button', { onclick: () => pickSource('puzzle') }, 'In the crossword photo') : null,
        p.clueImage ? h('button', { onclick: async () => { ({ img, url } = await loadImage(p.clueImage)); showPicker(); } }, 'In my clue photo') : null,
        h('button', { onclick: () => pickSource('new') }, 'In a different photo')));

    function showPicker() {
      const picker = regionPicker(img, () => {});
      const prog = h('div', { class: 'progress' });
      const run = async whole => {
        const rect = whole ? [0, 0, img.naturalWidth, img.naturalHeight] : picker.getRect();
        if (!rect) return toast('Drag a box around the clues first');
        prog.textContent = 'Starting text recognition…';
        buttons.forEach(b => { b.disabled = true; });
        try {
          const text = await recognizeText(ocrCanvas(img, rect), m => {
            if (m.status === 'recognizing text') prog.textContent = `Reading clues… ${Math.round(m.progress * 100)}%`;
            else if (m.status) prog.textContent = m.status.replace(/^\w/, c => c.toUpperCase()) + '…';
          });
          const parsed = P.parseClueText(text, dir);
          addText('across', parsed.across);
          addText('down', parsed.down);
          refresh();
          s.close();
          const n = parsed.across.length + parsed.down.length;
          toast(n ? `Found ${n} clues — check them for mistakes` : 'No numbered clues found. Try a tighter box.', 3500);
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
        h('p', { class: 'hint' }, `Drag a box around the ${dir} clues (or both lists — “Across”/“Down” headings are recognised).`),
        picker.el, prog, h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), buttons));
    }
    choose();
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
        h('h2', {}, dir === 'across' ? 'Across' : 'Down'), status[dir], h('span', { class: 'grow' }),
        h('button', { class: 'small', onclick: () => scan(dir) }, '📷 Scan')),
      boxes[dir]);
  };

  app.replaceChildren(
    header('3. Clues', { back: `#/p/${p.id}/grid` }),
    h('main', { class: 'scroll pad' },
      h('p', { class: 'hint' }, 'Scan the clues from a photo, or type them: one per line, starting with the clue number. You can also skip this and read clues from the photo while solving.'),
      section('across'), section('down')),
    h('div', { class: 'toolbar' },
      h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: async () => {
        refresh(); flushSave();
        p.stage = 'solve';
        await DB.savePuzzle(p);
        go(`#/p/${p.id}/solve`);
      } }, 'Solve ›')));
  refresh();
}

// ---------- step 4: solve ----------

async function solveView(p) {
  if (!p.blocks) return go(`#/p/${p.id}/${p.image ? 'corners' : 'grid'}`);
  const N = p.rows * p.cols;
  if (!p.fill || p.fill.length !== N) resetFill(p);
  const num = P.numberGrid(p.rows, p.cols, p.blocks);
  const allWords = [...num.across, ...num.down];
  const clueText = w => (p.clues && p.clues[w.dir] && p.clues[w.dir][w.num]) || '';
  const wordOf = (i, d) => { const k = (d === 'across' ? num.acrossOf : num.downOf)[i]; return k < 0 ? null : num[d][k]; };

  if (!allWords.length) return go(`#/p/${p.id}/grid`);
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
    if (!p.blocks[i]) cell.addEventListener('pointerdown', e => { e.preventDefault(); tapCell(i); });
    cells.push(cell);
    grid.append(cell);
  }
  const gridWrap = h('div', { class: 'xw-wrap' }, grid);

  // clue bar
  const clueLabel = h('div', { class: 'clue-text' });
  const clueBar = h('div', { class: 'cluebar' },
    h('button', { class: 'icon', 'aria-label': 'Previous clue', onpointerdown: e => { e.preventDefault(); jumpWord(-1); } }, '‹'),
    h('div', { class: 'clue-mid', onpointerdown: e => { e.preventDefault(); toggleDir(); } }, clueLabel),
    h('button', { class: 'icon', 'aria-label': 'Next clue', onpointerdown: e => { e.preventDefault(); jumpWord(1); } }, '›'));

  // clue list
  const listItems = new Map();
  const clueList = h('div', { class: 'cluelist' },
    ['across', 'down'].map(d => h('section', {},
      h('h3', {}, d === 'across' ? 'Across' : 'Down'),
      h('ol', {}, num[d].map(w => {
        const li = h('li', { onclick: () => { selectWord(w); document.body.classList.remove('list-open'); } },
          h('b', {}, w.num), h('span', {}, clueText(w) || h('i', {}, `(${w.cells.length})`)));
        listItems.set(w, li);
        return li;
      })))));
  onCleanup(() => document.body.classList.remove('list-open'));

  // keyboard
  const keyRows = ['QWERTYUIOP', 'ASDFGHJKL', '⇄ZXCVBNM⌫'];
  const keyboard = h('div', { class: 'kbd' }, keyRows.map(row => h('div', { class: 'krow' },
    [...row].map(k => h('button', {
      class: 'key' + (k === '⌫' || k === '⇄' ? ' wide' : ''),
      'aria-label': k === '⌫' ? 'Backspace' : k === '⇄' ? 'Switch direction' : k,
      onpointerdown: e => { e.preventDefault(); k === '⌫' ? backspace() : k === '⇄' ? toggleDir() : type(k); },
    }, k)))));

  function update() {
    const w = wordOf(sel, dir);
    const inWord = new Set(w ? w.cells : []);
    for (let i = 0; i < N; i++) {
      if (p.blocks[i]) continue;
      const c = cells[i];
      c.classList.toggle('sel', i === sel);
      c.classList.toggle('word', inWord.has(i) && i !== sel);
      c.lastChild.textContent = p.fill[i] || '';
    }
    if (w) {
      const t = clueText(w);
      clueLabel.replaceChildren(h('b', {}, `${w.num}${dir === 'across' ? 'A' : 'D'}`), ' ',
        t || h('i', {}, `No clue text — ${w.cells.length} letters`));
    } else clueLabel.textContent = '';
    for (const [word, li] of listItems) {
      li.classList.toggle('current', word === w);
      li.classList.toggle('done', word.cells.every(i => p.fill[i]));
    }
    const cur = w && listItems.get(w);
    if (cur && !document.body.classList.contains('list-open')) cur.scrollIntoView({ block: 'nearest' });
    p.cursor = { i: sel, dir };
  }

  function changed() {
    saveSoon(p);
    update();
    if (p.fill.every((v, i) => p.blocks[i] || v) && !p.completeShown) {
      p.completeShown = true;
      toast('🎉 Every square is filled!', 3500);
    }
  }

  function tapCell(i) {
    if (i === sel) toggleDir();
    else {
      sel = i;
      if (!wordOf(i, dir)) dir = dir === 'across' ? 'down' : 'across';
      update();
    }
  }
  function toggleDir() {
    const other = dir === 'across' ? 'down' : 'across';
    if (wordOf(sel, other)) { dir = other; update(); }
  }
  function selectWord(w, empty = true) {
    dir = w.dir;
    sel = (empty && w.cells.find(i => !p.fill[i])) ?? w.cells[0];
    update();
  }
  function jumpWord(delta) {
    const w = wordOf(sel, dir);
    const k = w ? allWords.indexOf(w) : 0;
    selectWord(allWords[(k + delta + allWords.length) % allWords.length]);
  }
  function type(ch) {
    p.fill[sel] = ch;
    p.completeShown = p.completeShown && p.fill.every((v, i) => p.blocks[i] || v);
    const w = wordOf(sel, dir);
    if (w) {
      const pos = w.cells.indexOf(sel);
      if (pos < w.cells.length - 1) sel = w.cells[pos + 1];
      else if (!w.cells.every(i => p.fill[i])) sel = w.cells.find(i => !p.fill[i]);
      else jumpWord(1);
    }
    changed();
  }
  function backspace() {
    if (p.fill[sel]) p.fill[sel] = '';
    else {
      const w = wordOf(sel, dir);
      const pos = w ? w.cells.indexOf(sel) : 0;
      if (pos > 0) { sel = w.cells[pos - 1]; p.fill[sel] = ''; }
    }
    p.completeShown = false;
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

  // size the grid to fit its area
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

  // photo viewer
  async function showPhoto() {
    const blobs = [p.image, p.clueImage].filter(Boolean);
    if (!blobs.length) return toast('This puzzle has no photo');
    let zoom = 1;
    const imgs = await Promise.all(blobs.map(async b => {
      const { img, url } = await loadImage(b);
      onCleanup(() => URL.revokeObjectURL(url));
      return img;
    }));
    const holder = h('div', { class: 'photo-holder' }, imgs);
    const setZoom = z => { zoom = Math.min(5, Math.max(1, z)); imgs.forEach(i => { i.style.width = zoom * 100 + '%'; }); };
    const s = sheet('Photo', h('div', { class: 'photo-view' },
      holder,
      h('div', { class: 'toolbar' },
        h('button', { onclick: () => setZoom(zoom / 1.5) }, '−'),
        h('button', { onclick: () => setZoom(zoom * 1.5) }, '+'))));
    s.el.classList.add('tall');
  }

  function anagram() {
    const w = wordOf(sel, dir);
    const pattern = w ? w.cells.map(i => p.fill[i] || '·').join('') : '';
    const input = h('input', { type: 'text', placeholder: 'Letters to rearrange', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
    const wheel = h('div', { class: 'wheel' });
    const draw = (shuffle) => {
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
      h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: () => draw(true) }, 'Shuffle'))));
    setTimeout(() => input.focus(), 50);
  }

  function menu() {
    const s = sheet('Puzzle', h('div', { class: 'menu' },
      h('button', { onclick: () => { s.close(); anagram(); } }, '🔀  Anagram helper'),
      h('button', { onclick: () => go(`#/p/${p.id}/clues`) }, '✏️  Edit clues'),
      h('button', { onclick: () => {
        if (p.fill.some(Boolean) && !confirm('Editing the grid clears your answers. Continue?')) return;
        go(`#/p/${p.id}/${p.image ? 'corners' : 'grid'}`);
      } }, '▦  Edit grid'),
      h('button', { onclick: () => {
        const t = prompt('Name this puzzle:', p.title);
        if (t) { p.title = t.trim(); titleEl.textContent = p.title; saveSoon(p); }
        s.close();
      } }, '🏷  Rename'),
      h('button', { onclick: () => {
        if (!confirm('Clear all your answers?')) return;
        resetFill(p); p.completeShown = false; changed(); s.close();
      } }, '🧹  Clear answers'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('Delete this puzzle?')) return;
        await DB.deletePuzzle(p.id); go('#/');
      } }, '🗑  Delete puzzle')));
  }

  const bar = header(p.title, {
    back: '#/',
    actions: [
      p.image ? h('button', { class: 'icon', 'aria-label': 'Show photo', onclick: showPhoto }, '🖼') : null,
      h('button', { class: 'icon list-btn', 'aria-label': 'Clue list', onclick: () => document.body.classList.toggle('list-open') }, '☰'),
      h('button', { class: 'icon', 'aria-label': 'Menu', onclick: menu }, '⋯'),
    ],
  });
  const titleEl = bar.querySelector('h1');

  app.replaceChildren(h('div', { class: 'solve' },
    bar,
    h('div', { class: 'solve-main' }, gridWrap, clueList),
    clueBar, keyboard));
  update();
}

// ---------- boot ----------

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
