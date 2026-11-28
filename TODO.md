# Squares (crossword solver) – to-do

Ideas and fixes for the crossword app (`crossword/`). Newest at the bottom.

- [x] **Pencil mode** – move the ✎ (edit clue) button to the top bar and put a pencil toggle in its place on
  the clue bar. In pencil mode, letters are entered in a lighter colour, for tentative answers.
- [x] **Less padding around the clue-bar buttons**, so the clue text doesn't wrap so much.
- [x] **Colour below the keyboard** – the strip under the keyboard (the phone's home-bar area) should match
  the keyboard colour.
- [x] **Answers spread over several grid entries** (e.g. 24-across + 2-down, 23-down + 1-across) – treat them
  as one answer: highlight all parts together, carry typing from one part into the next, and make
  "See 24-across" entries go to the full clue.
- [x] **Word breaks in the grid** – use the lengths in brackets to mark where words end in multi-word answers:
  a thicker divider for word breaks, e.g. (5,2), and a hyphen mark for hyphens, e.g. (5-4,6).
- [x] **Timer** – time how long the puzzle is open, from starting to solve until the crossword is finished.
- [x] **Pencil letters not italic** – just grey.
- [x] **Header under the iPhone's Dynamic Island** – the header now extends up behind the status bar, with a
  little extra room, and the page's theme colour matches the header. *(Needs checking on a real iPhone.)*
- [x] **Clue number centred** on the left of the clue bar.
- [x] **Pencil-mode toggle on the keyboard's bottom-left key** (replacing the Across/Down switch; tap the clue
  bar or tap a square twice to switch direction).
- [x] **Swipe the clue bar** left/right for the next/previous clue; arrows removed.
- [x] **Skip finished clues** (no empty and no pencilled squares) when moving to the next clue.
- [ ] **Setter's note** – show a note or instruction from the setter for the crossword. *(Details to be agreed
  first: where the note comes from and where it's shown.)*
- [x] **Tidy the top bar** – move the *Edit clue* and *Show photo* buttons into the ⋯ menu.
- [ ] **Header still slightly blurred on iPhone** (home-screen app, see screenshot from 19 Nov): the iPhone
  blurs the top strip of the screen, and the header still sits inside it. Tried removing `viewport-fit=cover`
  (20 Nov): that moved the keyboard down the screen, so it was undone. Needs another approach.
- [ ] **External references menu** – a second menu next to ⋯ with look-ups, e.g. search a word on Power
  Thesaurus or Wikipedia, search the clue online. *(Needs working out first.)*
- [x] **Edit the clue from the photo screen** – when viewing the photo, be able to edit the current clue right
  there, without going back to the menu.
- [x] **Stay on the last square** – after typing the final letter of an answer, keep the cursor on that square
  instead of jumping to the next clue. (Multi-part answers still carry on into their next part.)
- [x] **Show referenced answers in clues** – when a clue mentions another entry (e.g. "Dispute cited beer?
  That's 24-down"), show that entry's answer once it's filled in, in capitals: either replacing the reference
  ("That's CASSAVA") or after it in square brackets ("That's 24-down [CASSAVA]"). Done as the bracket
  version, so the original wording stays visible.
- [x] **Tap a reference to jump to it** – in clues that mention another entry (e.g. "That's 24-down"), tapping
  the reference moves to that clue.
- [x] **Show which clues depend on this one** – e.g. 24-down shows "Mentioned in 10A, 12A" (tappable), so you
  can see which clues use its answer.
- [x] **Referenced answers follow the letter pattern** – the bracketed answer is laid out like its clue's
  lengths, e.g. 24-down (3,2) shows as "[ARC UP]", not "[ARCUP]"; hyphens are kept.
- [x] **Puzzle library** – each puzzle has a source, setter, number and publishing date (⋯ → *Details*; setter
  and number guessed from the page heading, source carried over from the last puzzle, date = import day).
  Sorted by publishing date by default, or by source or setter. Grid previews removed; shows % filled,
  time spent and the first clue. New puzzles via a + button at the bottom right.
- [x] **Rename the app to Squares** with a placeholder icon: white squircle, black outline, "42" top right.
- [x] **Back up & restore** – ⋯ on the puzzles screen saves all puzzles to a file and restores them. On iPhone,
  Safari and the home-screen app keep separate storage (and deleting the home-screen icon deletes its puzzles),
  so this is how to move puzzles between them. Restoring only adds or updates, never deletes.
- [x] **First clue shown in full** on the puzzles screen (wraps instead of being cut off).
- [x] **Header word** – the puzzles screen's header shows a random synonym of "cross" (ANGRY, TRAVERSE, ROOD…) in
  boxed letters like 🅂🅀🅄🄰🅁🄴🅂, different each time the screen loads. The app's name stays Squares.
- [ ] **Status-bar strip (top) and home-bar strip (bottom) colours on iPhone** – the top strip is the app area, now
  header-coloured at the top and page-coloured at the bottom (fixes the bottom strip); the theme colour, which
  the iPhone also uses for the top strip, now follows light/dark switches (21 Nov). To check on the phone.
- [x] **Add from Files** – + → *Add from Files* takes a crossword PDF (e.g. a newspaper's print version: grid from
  the drawing, clues as exact text, filed by direction using the grid) or an image.
- [x] ~~Guardian list and Check answers~~ – built, then removed (21 Nov): the Guardian's API doesn't include the
  crosswords, so it relied on opening and saving print PDFs, which was awkward; Add from Files covers it.
- [x] **Dictionary entry under the header word** – part of speech, usage label where relevant, and a definition of
  the sense related to "cross" (e.g. BRIDGE · *v.* to make or be a way across (a gap, river, etc.)). Small grey
  sans serif, left-aligned; every definition uses the word "cross".
- [x] **Back up & restore moved into the + menu** (a smaller option beneath the others).
- [x] **Multi-part clues written with slashes** (e.g. "1/13/24 …", "18/12 …", "See 18 Down") now link up;
  text after a clue's (lengths), like a prize-puzzle footer, no longer gets stuck onto the last clue.
- [x] **Filter puzzles by complete / incomplete** – a chip next to the sort chips; each tap steps All → Incomplete →
  Complete; remembered; complete = every square filled. Sort by Number removed so it all fits on one line.
- [x] **Black square after the header word** – the word is now drawn as a row of crossword squares (instead of boxed
  Unicode letters, which iPhone draws in its own style), ending in a matching black square.
- [x] **First and last answers in** – when a puzzle is finished, a panel shows the time plus the first and last
  answers entered (clue, answer laid out by its lengths, and the time each went in). Only answers in normal
  (non-pencil) letters count; changing a completed answer re-times it. Recorded from 21 Nov onwards.
- [x] **First/last in on the puzzle list** – finished puzzles show "100% · 26:06 · WAY — ARC UP" (first answer in —
  last answer in); "✓ Finished" and the stopwatch emoji removed.
- [x] **Header text colour in dark mode** – white outlines and letters on the squares, and a white outline around the
  trailing black square.
- [ ] **Search** – a search bar on the puzzles screen that searches the full text of clues and answers.
- [ ] **Redesigned finished screen** – a new design for the panel shown when a puzzle is finished. *(Details to
  be agreed.)*
- [x] **Header fixed in place** – the page itself no longer scrolls or bounces; only the list/content areas do.
  *(iPhone rubber-banding can't be fully reproduced in the emulator; check on the phone.)*
- [x] **Letter count after the header definition**, crossword-style, e.g. "slightly angry; cross (7)".
- [x] **New icon** – the squircle outline divided into four quadrants: bottom-right black, a "1" in the top-left
  corner of the top-left quadrant, like a tiny crossword.
- [x] **Sort by edit date** – an *Edited* chip sorts by when each puzzle was last worked on (newest first; tap again
  to flip).
- [x] **References vs linked answers** – "13 21-down stuck in… (5)" is a reference, not a two-part answer: a leading
  entry number only links when the clue's (lengths) cover both entries. Existing puzzles are fixed when opened.
- [x] **Filter by source / setter** – press and hold the Source or Setter chip to pick one value to show (with counts,
  including "No source/setter", or All); the chip then shows that value (e.g. "DA"); remembered; tap still sorts.

## Notes on how these work

- Pencil letters count as filled for finishing the puzzle (so the timer stops when the last square is filled).
- The timer counts only while the puzzle is on screen, and *Clear answers* resets it.
