// Turns a photo into a puzzle: finds the grid, its squares, and reads the clues.
import * as V from './vision.js';
import * as P from './puzzle.js';
import { recognizeBlocks } from './ocr.js';

export function scaledCanvas(img, maxDim) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, maxDim / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.round(iw * s); c.height = Math.round(ih * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, scale: s };
}

export function grayOf(canvas) {
  return V.grayFromImageData(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
}

// Straighten the grid area and detect rows/cols (unless given) and black squares.
export function analyzeGrid(img, corners, size = null, maxDim = 1800) {
  const { canvas, scale } = scaledCanvas(img, maxDim);
  const warp = V.warpGray(grayOf(canvas), corners.map(([x, y]) => [x * scale, y * scale]), 900, 900);
  const { rows, cols } = size || V.detectGridSize(warp);
  return { rows, cols, blocks: V.classifyCells(warp, rows, cols), warp };
}

// maxDim: photos are fine at 1000px; PDFs need full resolution, as their grid lines are hairlines.
export function findCorners(img, maxDim = 1000) {
  const { canvas, scale } = scaledCanvas(img, maxDim);
  return V.detectGridCorners(grayOf(canvas)).map(([x, y]) => [x / scale, y / scale]);
}

// Read all clue text in the image (or within `rect`), column by column, skipping the grid.
export async function readClueText(img, { exclude = null, rect = null } = {}, onProgress) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const [rx0, ry0, rx1, ry1] = rect || [0, 0, iw, ih];
  const rw = rx1 - rx0, rh = ry1 - ry0;
  const scale = Math.min(1, 2000 / Math.max(rw, rh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(rw * scale)); c.height = Math.max(1, Math.round(rh * scale));
  c.getContext('2d').drawImage(img, rx0, ry0, rw, rh, 0, 0, c.width, c.height);
  const ex = exclude && exclude.map(([x, y]) => [(x - rx0) * scale, (y - ry0) * scale]);
  const { blocks, textHeight } = V.findTextBlocks(grayOf(c), ex);
  if (!blocks.length) return '';
  // Tesseract does best with letters ~28px tall.
  const xh = textHeight / scale;
  const s = Math.min(3, Math.max(1, 28 / xh));
  const pad = xh * 0.6;
  const canvases = blocks.map(b => {
    const x0 = Math.max(0, rx0 + b.x0 / scale - pad), y0 = Math.max(0, ry0 + b.y0 / scale - pad);
    const x1 = Math.min(iw, rx0 + b.x1 / scale + pad), y1 = Math.min(ih, ry0 + b.y1 / scale + pad);
    const out = document.createElement('canvas');
    out.width = Math.round((x1 - x0) * s); out.height = Math.round((y1 - y0) * s);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
    return out;
  });
  return recognizeBlocks(canvases, onProgress);
}

// OCR text -> clue lists matched against the grid.
export function cluesFromOcr(text, num, defaultSection = 'across') {
  return P.reconcileClues(P.parseClueText(text, defaultSection), num);
}

// ---- PDFs: exact text instead of OCR ----

const centre = it => [(it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2];
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// The "Solution No. 30,168" heading and the small solution grid below it (Guardian print PDFs).
function solutionArea(items, canvas) {
  const head = items.find(it => /^\s*solution\b/i.test(it.str));
  if (!head) return null;
  const h = head.y1 - head.y0;
  return { head, x0: head.x0 - h, y0: head.y0 - h * 0.5, x1: canvas.width, y1: canvas.height };
}

// Page text in reading order (columns handled like photos), skipping the grid and the solution grid.
export function textFromPdfItems(canvas, items, corners) {
  const sol = solutionArea(items, canvas);
  const inSol = it => sol && centre(it)[0] >= sol.x0 && centre(it)[1] >= sol.y0;
  const keep = items.filter(it => !inSol(it) && !(corners && inPolygon(...centre(it), corners)));
  // Layout on the rendered page, with the solution area blanked out.
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  if (sol) { ctx.fillStyle = '#fff'; ctx.fillRect(sol.x0, sol.y0, sol.x1 - sol.x0, sol.y1 - sol.y0); }
  const { blocks } = V.findTextBlocks(grayOf(c), corners);
  const used = new Set();
  const out = [];
  const lineText = line => {
    line.sort((a, b) => a.x0 - b.x0);
    let s = '';
    line.forEach((it, k) => {
      const gap = k ? it.x0 - line[k - 1].x1 : 0;
      if (k && gap > (it.y1 - it.y0) * 0.12 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += ' ';
      s += it.str;
    });
    return s.replace(/\s+/g, ' ').trim();
  };
  const linesOf = list => {
    const lines = [];
    for (const it of [...list].sort((a, b) => centre(a)[1] - centre(b)[1])) {
      const yc = centre(it)[1], hgt = it.y1 - it.y0;
      const line = lines.find(l => Math.abs(l.yc - yc) < hgt * 0.5);
      if (line) line.items.push(it); else lines.push({ yc, items: [it] });
    }
    return lines.sort((a, b) => a.yc - b.yc).map(l => lineText(l.items));
  };
  for (const b of blocks) {
    const mine = keep.filter(it => {
      if (used.has(it)) return false;
      const [x, y] = centre(it);
      return x >= b.x0 - 4 && x <= b.x1 + 4 && y >= b.y0 - 4 && y <= b.y1 + 4;
    });
    mine.forEach(it => used.add(it));
    out.push(...linesOf(mine));
  }
  const rest = keep.filter(it => !used.has(it));
  if (rest.length) out.push(...linesOf(rest));
  return out.join('\n');
}

// The previous puzzle's solution printed on Guardian PDFs: { number, letters[] (row-major, '' for blocks) }
// sized rows x cols. Returns null if it can't be read cleanly.
export function solutionFromPdf(canvas, items, rows, cols) {
  const sol = solutionArea(items, canvas);
  if (!sol) return null;
  const m = sol.head.str.match(/(\d{1,3}(?:,\d{3})+|\d{2,6})/) ||
    (items.find(it => it !== sol.head && Math.abs(it.y0 - sol.head.y0) < 4 && /\d/.test(it.str)) || { str: '' }).str.match(/(\d{1,3}(?:,\d{3})+|\d{2,6})/);
  if (!m) return null;
  const number = m[1].replace(/,/g, '');
  // Find the small grid's outline in the area below the heading.
  const x0 = Math.max(0, Math.floor(sol.x0)), y0 = Math.floor(sol.head.y1);
  const w = Math.min(canvas.width, Math.ceil(sol.x1)) - x0, h = Math.min(canvas.height, Math.ceil(sol.y1)) - y0;
  if (w < 20 || h < 20) return null;
  const crop = document.createElement('canvas');
  crop.width = w; crop.height = h;
  crop.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
  const gc = V.detectGridCorners(grayOf(crop)).map(([x, y]) => [x + x0, y + y0]);
  const gx0 = Math.min(gc[0][0], gc[3][0]), gx1 = Math.max(gc[1][0], gc[2][0]);
  const gy0 = Math.min(gc[0][1], gc[1][1]), gy1 = Math.max(gc[2][1], gc[3][1]);
  const cw = (gx1 - gx0) / cols, ch = (gy1 - gy0) / rows;
  const letters = new Array(rows * cols).fill('');
  for (const it of items) {
    if (it === sol.head) continue;
    const str = it.str.replace(/\s+/g, '');
    if (!/^[A-Za-z]+$/.test(str)) continue;
    const [cx0, cy] = [it.x0, centre(it)[1]];
    if (cy < gy0 || cy > gy1 || it.x1 < gx0 || cx0 > gx1) continue;
    // An item may hold several letters in a row; spread them over its width.
    const step = (it.x1 - it.x0) / str.length;
    [...str].forEach((ch2, k) => {
      const x = cx0 + step * (k + 0.5);
      const c = Math.floor((x - gx0) / cw), r = Math.floor((cy - gy0) / ch);
      if (r >= 0 && c >= 0 && r < rows && c < cols) letters[r * cols + c] = ch2.toUpperCase();
    });
  }
  return { number, letters };
}
