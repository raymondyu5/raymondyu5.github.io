# raymondyu5.github.io

Personal research page for Raymond Yu, served by GitHub Pages at
[raymondyu5.github.io](https://raymondyu5.github.io). Plain HTML, CSS, and JS — no build step
(`.nojekyll` tells Pages to serve the files as-is).

```
index.html      home: banner, bio, links
research.html   papers
styles.css      all styling; colours are tokens at the top, dark mode right below
viz.js          the banner animations (scenes and options are documented at the top)
theme.js        the light/dark toggle
assets/
  icon.png              favicon
  profile-pics/         portrait
  publications/         paper teasers (images, gifs, video)
  viz/rainier.jpg       photo the Rainier skyline is traced from
googlef0696328b30b87db.html   Google Search Console verification
```

## Editing

- **Bio / links:** `index.html`, in the `about` section.
- **A new paper:** in `research.html`, copy an `<article class="pub">` block, update the text and
  links, and put the teaser in `assets/publications/`.
- **Banner scenes:** `data-scenes` on the `.viz` element picks them, in order —
  `rainier`, `grove` (home) and `city`, `workshop` (research).

## Cache busting

Pages link `styles.css?v=N`, `viz.js?v=N` and `theme.js?v=N`. Bump N in all three HTML files when
you change those files, so visitors' browsers fetch the new versions.

## Preview locally

```
python3 -m http.server
```

then open http://localhost:8000. Append `?warm=600` to a URL to fast-forward the animation.

## Credits

`assets/viz/rainier.jpg` is cropped from *Mount Rainier over Tacoma* (Wikimedia Commons, public
domain).
