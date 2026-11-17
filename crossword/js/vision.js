// Image processing for finding a crossword grid in a photo.
// All functions work on plain grayscale buffers: { w, h, data: Uint8ClampedArray }.

export function grayFromImageData({ width: w, height: h, data }) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return { w, h, data: g };
}

// Bradley adaptive threshold: a pixel is "dark" if it is noticeably darker than
// its neighbourhood. Copes with shadows and uneven lighting in phone photos.
export function adaptiveDarkMask(gray, win, k = 0.18) {
  const { w, h, data } = gray;
  const W = w + 1;
  const ii = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x];
      ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + rowSum;
    }
  }
  const r = win >> 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = ii[(y1 + 1) * W + x1 + 1] - ii[y0 * W + x1 + 1] - ii[(y1 + 1) * W + x0] + ii[y0 * W + x0];
      if (data[y * w + x] * count < sum * (1 - k)) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function dilate(mask, w, h) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] || (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) ||
          (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])) out[i] = 1;
    }
  }
  return out;
}

// Find the connected dark blob most likely to be the grid (lots of connected
// line pixels) and return its four extreme corners [tl, tr, br, bl].
function bestComponentCorners(mask, w, h) {
  const labels = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best = null;
  const minCount = w * h * 0.004;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = 1;
    let count = 0, touches = false;
    let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
    let tl, br, tr, bl;
    while (sp) {
      const i = stack[--sp];
      const x = i % w, y = (i - x) / w;
      count++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      const s = x + y, d = x - y;
      if (s < minS) { minS = s; tl = [x, y]; }
      if (s > maxS) { maxS = s; br = [x, y]; }
      if (d > maxD) { maxD = d; tr = [x, y]; }
      if (d < minD) { minD = d; bl = [x, y]; }
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !labels[i - w]) { labels[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !labels[i + w]) { labels[i + w] = 1; stack[sp++] = i + w; }
    }
    if (count < minCount) continue;
    // Grids are dense (many lines inside their bounding box); page outlines and
    // shadows are sparse. Weight by density so an outline can't win on size alone.
    const bboxArea = Math.max(1, (maxS - minS) * (maxD - minD) / 2);
    const score = count * Math.min(1, count / bboxArea) * (touches ? 0.05 : 1);
    if (!best || score > best.score) best = { score, corners: [tl, tr, br, bl] };
  }
  return best && best.corners;
}

export function defaultCorners(w, h, inset = 0.08) {
  const ix = w * inset, iy = h * inset;
  return [[ix, iy], [w - ix, iy], [w - ix, h - iy], [ix, h - iy]];
}

export function detectGridCorners(gray) {
  const { w, h } = gray;
  const win = Math.max(15, Math.round(Math.min(w, h) / 12)) | 1;
  const mask = dilate(adaptiveDarkMask(gray, win), w, h);
  const corners = bestComponentCorners(mask, w, h);
  if (!corners) return defaultCorners(w, h);
  // Reject degenerate results (tiny or sliver-shaped).
  const area = Math.abs(polygonArea(corners));
  if (area < w * h * 0.02) return defaultCorners(w, h);
  return corners.map(([x, y]) => [x + 0.5, y + 0.5]);
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// ---- Perspective correction ----

function gaussSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    if (Math.abs(piv) < 1e-12) throw new Error('Singular matrix');
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Homography mapping points `from[i]` onto `to[i]` (4 points each).
export function solveHomography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...gaussSolve(A, b), 1];
}

export function applyH(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}

// Warp the quadrilateral `corners` [tl,tr,br,bl] of `gray` into an outW x outH image.
export function warpGray(gray, corners, outW, outH) {
  const { w, h, data } = gray;
  const H = solveHomography([[0, 0], [outW, 0], [outW, outH], [0, outH]], corners);
  const out = new Uint8ClampedArray(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let [sx, sy] = applyH(H, x + 0.5, y + 0.5);
      sx -= 0.5; sy -= 0.5;
      sx = Math.min(Math.max(sx, 0), w - 1.001);
      sy = Math.min(Math.max(sy, 0), h - 1.001);
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i = y0 * w + x0;
      const top = data[i] * (1 - fx) + data[i + 1] * fx;
      const bot = data[i + w] * (1 - fx) + data[i + w + 1] * fx;
      out[y * outW + x] = top * (1 - fy) + bot * fy;
    }
  }
  return { w: outW, h: outH, data: out };
}

// ---- Grid size and black-square detection on a warped (straightened) grid ----

// Keep only thin peaks (grid lines): subtract a running median, which removes the
// broad darkness contributed by black squares.
function highPass(profile, r) {
  const L = profile.length, out = new Float32Array(L), win = [];
  for (let x = 0; x < L; x++) {
    win.length = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(L - 1, x + r); k++) win.push(profile[k]);
    win.sort((a, b) => a - b);
    out[x] = Math.max(0, profile[x] - win[win.length >> 1]);
  }
  return out;
}

function bestPeriod(rawProfile, minN = 4, maxN = 30) {
  const L = rawProfile.length;
  const profile = highPass(rawProfile, Math.max(3, Math.round(L * 0.012)));
  // Lines may be slightly off their ideal spot; allow a small, absolute tolerance.
  const lw = Math.max(1, Math.round(L * 0.005));
  const scores = [];
  for (let N = minN; N <= maxN; N++) {
    const cell = L / N;
    let ls = 0;
    // Interior lines only: the thick outer border is there for every N.
    for (let k = 1; k < N; k++) {
      const c = Math.round(k * cell);
      let m = 0;
      for (let x = Math.max(0, c - lw); x <= Math.min(L - 1, c + lw); x++) m = Math.max(m, profile[x]);
      ls += m;
    }
    scores.push({ N, score: ls / (N - 1) });
  }
  // Very small N have only a couple of interior lines, so their scores are noisy;
  // leave them out of the reference score.
  const top = Math.max(...scores.filter(s => s.N >= 5).map(s => s.score));
  // Divisors of the true size score just as well (every 3rd line is still a line)
  // while multiples score about half, so take the largest N close to the best.
  let pick = scores[0].N;
  for (const s of scores) if (s.score >= top * 0.7) pick = s.N;
  return pick;
}

export function detectGridSize(warp) {
  const { w, h, data } = warp;
  const colP = new Float32Array(w), rowP = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = 255 - data[y * w + x];
      colP[x] += d; rowP[y] += d;
    }
  }
  for (let x = 0; x < w; x++) colP[x] /= h;
  for (let y = 0; y < h; y++) rowP[y] /= w;
  return { rows: bestPeriod(rowP), cols: bestPeriod(colP) };
}

// Returns an array (row-major) of 1 for black squares, 0 for white.
export function classifyCells(warp, rows, cols) {
  const { w, h, data } = warp;
  const cw = w / cols, ch = h / rows;
  const means = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Sample the lower-right middle of the cell to avoid the printed clue number.
      const x0 = Math.floor((c + 0.3) * cw), x1 = Math.ceil((c + 0.8) * cw);
      const y0 = Math.floor((r + 0.35) * ch), y1 = Math.ceil((r + 0.8) * ch);
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += data[y * w + x]; n++; }
      means.push(n ? s / n : 255);
    }
  }
  // Two-cluster split (1-D k-means).
  let lo = Math.min(...means), hi = Math.max(...means);
  for (let it = 0; it < 20; it++) {
    const t = (lo + hi) / 2;
    let sl = 0, nl = 0, sh = 0, nh = 0;
    for (const m of means) { if (m < t) { sl += m; nl++; } else { sh += m; nh++; } }
    if (!nl || !nh) break;
    lo = sl / nl; hi = sh / nh;
  }
  if (hi - lo < 60) return means.map(() => 0);
  const t = (lo + hi) / 2;
  return means.map(m => (m < t ? 1 : 0));
}
