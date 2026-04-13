# RUE3 Vocabulary Trainer

A minimal static single-page app for Clozemaster-style gap-fill vocabulary practice (Czech learners of English). It uses vanilla HTML, CSS, and JavaScript with no build step, suitable for hosting on GitHub Pages.

## Running locally

Because the app loads word data with `fetch`, open it through a local HTTP server (opening `index.html` directly as a `file://` URL may block the request in some browsers).

Example:

```bash
# From this folder
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Project layout

- `index.html` — markup and views
- `css/style.css` — styles (dark theme, purple accent)
- `js/app.js` — navigation, quiz logic, spaced repetition (Leitner-style) in `localStorage`
- `data/b2_tech.json` — B2 tech vocabulary (alpha set)

## Spaced repetition

Progress is stored in the browser under the key `rue3_srs`. A separate key `rue3_session_index` tracks how many practice sessions have been started, which drives due dates for higher boxes.

## Licence

Use and modify as needed for your learning project.
