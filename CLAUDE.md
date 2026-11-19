# Notes for Claude

## Workflow

- When a change is finished and tested, merge it into `main` straight away (open a pull request and merge
  it) so it goes live on GitHub Pages. Don't ask first, unless there's a good reason not to merge, such as
  untested or risky changes, or anything that could lose saved puzzles. In that case, explain and ask.
- Keep `TODO.md` up to date: add new requests to it, and tick items off when they're done.

## Project

- `crossword/` is the Crossword Solver phone app: plain HTML/CSS/ES modules, no build step, published by the
  GitHub Pages workflow on pushes to `main`. See `README.md` for how it works and what each file does.
- Bump `CACHE` in `crossword/sw.js` whenever app files change, so installed copies update.
