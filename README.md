# jamesbursey.com

Static portfolio site, migrated 1:1 from Webflow and hosted on GitHub Pages.

- Pages: `index.html`, `projects.html`, `pilot.html`, `nook.html`, `xesto-fit.html`, `about.html`, `art.html`, `404.html`
- Styles: `css/site.css` (the original Webflow stylesheet)
- Behaviour: `js/site.js` replaces Webflow's runtime — scroll/hover interactions (driven by the `#ix-data` JSON on each page), Lottie playback, nav menu, sliders, background videos, anchor scrolling, and the Pilot count-up stats
- Assets: `assets/` (images, videos, Lottie JSON, fonts, resume)

## Local preview

```sh
npm install
npm run serve      # http://localhost:4173 — same URL rules as GitHub Pages (/pilot -> pilot.html)
```

## Tests

```sh
npm test           # Playwright, desktop + mobile
```
