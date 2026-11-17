// Text recognition for clues, using Tesseract.js (loaded on first use, needs internet once;
// the English language data is then cached by the browser).
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise = null;
let progressCb = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the text recogniser. Are you online?'));
    document.head.appendChild(s);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('eng', 1, {
        logger: m => progressCb && progressCb(m),
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// canvas: an HTMLCanvasElement containing the clue text.
export async function recognizeText(canvas, onProgress) {
  progressCb = onProgress;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    progressCb = null;
  }
}
