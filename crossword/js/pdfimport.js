// Reading crossword PDFs (e.g. the Guardian's print versions) with pdf.js:
// renders the first page to a canvas and returns its text with positions.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the PDF reader. Are you online?'));
    document.head.appendChild(s);
  });
}

async function pdfjs() {
  if (!window.pdfjsLib) await loadScript(PDFJS);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
  return window.pdfjsLib;
}

// Returns { canvas, items: [{ str, x0, y0, x1, y1 }] } with item boxes in canvas pixels.
export async function readPdf(file, maxDim = 2200) {
  const lib = await pdfjs();
  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new Error("That file couldn't be opened as a PDF.");
  }
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: maxDim / Math.max(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    const t = lib.Util.transform(viewport.transform, it.transform);
    const h = Math.hypot(t[2], t[3]);
    const x0 = t[4], baseline = t[5];
    const w = it.width * viewport.scale;
    items.push({ str: it.str, x0, x1: x0 + w, y0: baseline - h * 0.85, y1: baseline + h * 0.15 });
  }
  return { canvas, items };
}
