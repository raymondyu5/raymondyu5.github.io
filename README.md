# raymondyu5.github.io

Personal research page for Raymond Yu. Plain static HTML/CSS/JS — no build step.
GitHub Pages serves the files directly (`.nojekyll` disables Jekyll).

- `index.html` — home: about, news
- `research.html` — papers
- `styles.css` — styling; colors/fonts are tokens at the top (`:root`), dark mode below them
- `viz.js` — the canvas animations (banner + inline figures)
- `lab.html` — every animation side by side, for picking/tuning (not linked from the site)

## Animations

Any `<div class="viz" data-viz="NAME">` becomes an animation. Options:

- `data-viz`: `reveal`, `murmur`, `stipple`, `topo`, `flock`, `slime`, `coral`, `rain`
- `data-image="assets/viz/x.jpg"`: target picture for `reveal` / `stipple`
- `data-focus="0.15"`: which vertical slice of the picture to keep (0 top … 1 bottom)
- `data-invert`: use the bright parts of the picture instead of the dark ones
- `data-shape`: target for `stipple` / `murmur` — `tree`, `landscape`, `spiral`, or `rainier`
  (with `data-image="assets/viz/rainier.jpg"`: Rainier's skyline is traced from the photo)
- `data-height`, `data-caption`

Target images (`assets/viz/`) are public domain: Van Gogh, *The Starry Night* (1889);
*Mount Rainier over Tacoma* (Wikimedia Commons, public domain), cropped.

Add `?warm=600` to a URL to fast-forward the simulations (handy for screenshots).

## Editing

To add a paper, copy an `<article class="pub">` block and drop the teaser in `assets/publications/`.
To add news, add an `<li>` to `<ol class="timeline">`.

Preview locally: `python3 -m http.server` then open http://localhost:8000.
