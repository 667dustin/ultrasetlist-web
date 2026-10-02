# Ultrasetlist Setlists (web)

A small web app for arranging Setlists from **Dustin's MIDI Setlist Ultratool** on any phone (made for Android) and printing them as PDFs.

**Live:** https://667dustin.github.io/ultrasetlist-web/

## How it works

1. In the app (Mac, iPad or iPhone): **Export Setlists for Web…** saves a `.ultrasetlists` file.
2. Open that file here. Create, rename and rearrange Setlists (Songs and breaks), and save them as PDFs (Song names only), laid out like the app's Names Only PDF.
3. **Send File Back** shares or downloads a `.ultrasetlists` file to import in the app.

Rules: Songs are read-only here; they're never created, renamed or deleted. You can only delete Setlists made here that were never sent. Everything stays in the browser (`localStorage`); there is no server and nothing is uploaded.

## File format

See `js/format.js`. It's the same format as `UltrasetlistSetlists.swift` in the app, and both sides use the same validation rules.

## Development

Plain HTML, CSS and ES modules: no build step and no dependencies. Run it locally with any static server, for example:

```sh
python3 -m http.server 8000
```

then open http://localhost:8000.
