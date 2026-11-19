# Crossword Solver – to-do

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
- [ ] **Tidy the top bar** – move the *Edit clue* and *Show photo* buttons into the ⋯ menu.

## Notes on how these work

- Pencil letters count as filled for finishing the puzzle (so the timer stops when the last square is filled).
- The timer counts only while the puzzle is on screen, and *Clear answers* resets it.
