# Anagrammer

## Squares – crossword solver (`crossword/`)

Squares is a phone app (installable web app) that turns a photo of a crossword into a puzzle you can solve on
screen.

**Use it:** once deployed to GitHub Pages, open `https://<user>.github.io/anagrammer/crossword/` on your phone,
then *Share → Add to Home Screen* (iPhone) or *⋮ → Install app* (Android). It then opens full-screen like a
normal app and works offline (except clue scanning the first time, which downloads the text recogniser).

**How it works**

0. **Your puzzles** – each shows its source, setter, number and publishing date (sort by date, last edited,
   source or setter; newest first by default; filter to complete or incomplete,
   and press and hold Source or Setter to show just one of them), the first clue, how much is filled in and the time spent. Tap + to add one.
1. **PDF** – + → *Add from Files* and pick a crossword PDF (e.g. a newspaper's print version) or an image. PDFs are
   read exactly: the grid from the drawing, the clues as text.
1. **Photo** – take a picture or pick a screenshot of a crossword page. That's it: the app finds the grid,
   straightens it, works out its size and black squares, and opens the puzzle ready to solve.
2. **Clues load automatically** in the background (on-device text recognition with Tesseract.js). The page
   layout is analysed first, so multi-column clue lists are read column by column, Across/Down headings are
   followed, and the grid is used to repair misread clue numbers and fill in missing (lengths).
3. **Solve** – tap a square (tap again to switch Across/Down), type with the built-in keyboard, tap the clue bar
   to switch direction, swipe it left/right for the next/previous clue, ☰ for the clue list. The keyboard's
   bottom-left key toggles pencil mode (grey letters for guesses). A timer runs under the title.
4. **Fix mistakes if you spot one** – ⋯ → *Edit this clue* edits that clue with the photo beside it;
   ⋯ → *Edit clues* shows all clues under the zoomable photo; ⋯ → *Fix grid* lets you move the grid corners and
   toggle squares over the photo. ⋯ also has *Show photo*, the anagram helper, re-reading the clues, *Details*
   (source, setter, number, date; setter and number are guessed from the page heading) and clearing.

Puzzles and progress are stored on the device (IndexedDB); nothing is uploaded. On iPhone, Safari and the
home-screen app each have their own storage, and deleting the home-screen icon deletes its puzzles: use + →
*Back up & restore* on the puzzles screen to move them (back up in one, restore in the other).

**Limitations:** grids with black squares only (barred cryptic grids aren't supported), up to 30×30; there is no
answer checking because a photo doesn't contain the answers.

**Code:** plain HTML/CSS/ES modules, no build step.
`js/vision.js` (grid detection, perspective correction, clue-column layout), `js/puzzle.js` (numbering, clue
parsing and repair),
`js/importer.js` (photo → puzzle pipeline), `js/pdfimport.js` (PDF reading), `js/backup.js`
(back up / restore), `js/app.js` (screens), `js/store.js` (storage), `js/ocr.js`
(text recognition), `sw.js` (offline cache).
