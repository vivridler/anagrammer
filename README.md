# Anagrammer

## Crossword Solver (`crossword/`)

A phone app (installable web app) that turns a photo of a crossword into a puzzle you can solve on screen.

**Use it:** once deployed to GitHub Pages, open `https://<user>.github.io/anagrammer/crossword/` on your phone,
then *Share → Add to Home Screen* (iPhone) or *⋮ → Install app* (Android). It then opens full-screen like a
normal app and works offline (except clue scanning the first time, which downloads the text recogniser).

**How it works**

1. **Photo** – take a picture or pick a screenshot of the crossword.
2. **Find the grid** – the grid's corners are detected automatically; drag them to fine-tune (a magnifier helps).
   Rotate if the photo is sideways.
3. **Check the grid** – the photo is straightened, the number of rows/columns and the black squares are detected.
   Tap a square to fix it, or adjust rows/cols.
4. **Clues** – scan them from the same or another photo (on-device OCR via Tesseract.js) or type/paste them,
   one per line starting with the number. A counter shows which clue numbers are missing. Optional: you can
   also just view the photo while solving.
5. **Solve** – tap a square (tap again to switch Across/Down), type with the built-in keyboard, tap the clue bar
   to switch direction, ‹ › to move between clues, ☰ for the clue list, 🖼 to view the original photo,
   ⋯ for the anagram helper, editing, renaming and clearing.

Puzzles and progress are stored on the device (IndexedDB); nothing is uploaded.

**Limitations:** grids with black squares only (barred cryptic grids aren't supported), up to 30×30; there is no
answer checking because a photo doesn't contain the answers.

**Code:** plain HTML/CSS/ES modules, no build step.
`js/vision.js` (grid detection, perspective correction), `js/puzzle.js` (numbering, clue parsing),
`js/app.js` (screens), `js/store.js` (storage), `js/ocr.js` (text recognition), `sw.js` (offline cache).
