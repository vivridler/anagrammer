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
export function analyzeGrid(img, corners, size = null) {
  const { canvas, scale } = scaledCanvas(img, 1800);
  const warp = V.warpGray(grayOf(canvas), corners.map(([x, y]) => [x * scale, y * scale]), 900, 900);
  const { rows, cols } = size || V.detectGridSize(warp);
  return { rows, cols, blocks: V.classifyCells(warp, rows, cols), warp };
}

export function findCorners(img) {
  const { canvas, scale } = scaledCanvas(img, 1000);
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
