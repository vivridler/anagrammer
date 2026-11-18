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
    s.onerror = () => reject(new Error('Could not load the text reader. Are you online?'));
    document.head.appendChild(s);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(TESSERACT_URL);
      const worker = await window.Tesseract.createWorker('eng', 1, {
        logger: m => progressCb && progressCb(m),
      });
      // Each block we pass is a single column of text.
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// Reads each canvas in turn and joins the text in that order.
// onProgress({ label, progress }) with progress in 0..1 (or null while loading).
const STALL_MS = 90000;

export async function recognizeBlocks(canvases, onProgress = () => {}) {
  let index = 0;
  // Watchdog: if nothing happens for a while (e.g. a download silently failed), give up
  // and reset the worker so the next attempt starts clean.
  let stallTimer, stallReject;
  const stalled = new Promise((_, reject) => { stallReject = reject; });
  const poke = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      const wp = workerPromise;
      workerPromise = null;
      if (wp) wp.then(w => w.terminate()).catch(() => {});
      stallReject(new Error('Reading the clues stalled. Check your connection and try again.'));
    }, STALL_MS);
  };
  progressCb = m => {
    poke();
    if (m.status === 'recognizing text') {
      onProgress({ label: 'Reading clues', progress: (index + m.progress) / canvases.length });
    } else if (m.status === 'loading language traineddata') {
      onProgress({ label: 'Downloading the text reader (first time only)', progress: null });
    } else if (m.status) {
      onProgress({ label: 'Starting the text reader', progress: null });
    }
  };
  try {
    poke();
    onProgress({ label: 'Starting the text reader', progress: null });
    const worker = await Promise.race([getWorker(), stalled]);
    const parts = [];
    for (; index < canvases.length; index++) {
      const { data } = await Promise.race([worker.recognize(canvases[index]), stalled]);
      parts.push(data.text);
    }
    return parts.join('\n');
  } finally {
    clearTimeout(stallTimer);
    progressCb = null;
  }
}
