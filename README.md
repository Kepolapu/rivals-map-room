# Rivals Map Room

A buildless progressive web app with a grid of large map-title tiles. Each card shows the complete map title and its game mode. Choose a title to inspect one annotated map fullscreen. All source annotations are baked into the map file. The viewer supports zooming, panning, fitting the whole map and returning to the grid.

[Source repository](https://github.com/Kepolapu/rivals-map-room) · [GitHub Pages](https://kepolapu.github.io/rivals-map-room/)

## Run

Requires Node.js. No dependency installation or build is needed.

```sh
npm run dev
npm run check
```

Open the printed local URL. HTTPS or localhost is required for service workers and browser installation. Install through the browser's app menu; on iPhone or iPad, use Share → Add to Home Screen. Browser fullscreen falls back to a full-viewport viewer when the native API is unavailable.

## Map data

The catalog preserves all 39 entries from [MarvelRivals.gg](https://marvelrivals.gg/maps/), including individual Domination arenas and the source's combined map entries. There are 38 available annotated WebP layouts. The source provides no layout for Blood-Night New York; its tile is disabled, with the reason in its accessible label and tooltip.

`dist/maps/<id>.webp` contains one complete original annotated image per available map. `dist/maps.json` supplies the catalog, dimensions and exact source links. `source/maps-source.json` records the inspected source entries. No map geometry, health packs or routes are invented.

To retrieve the verified source files again, install Pillow for Python and run `npm run import:maps`. The importer validates the images and reuses existing valid files. The source asset URLs were read from each map page's Full-size map link.

All available layouts save automatically in the background after the app loads online. Keep the app open while the first download finishes. No download progress or success message interrupts the title grid. A download error explains that saving will retry when the connection returns or the app reopens. The unavailable source entry cannot be downloaded. Browser storage may be evicted by the device; missing app files and maps are checked and restored on launch. Cached map images are retained across updates when device storage allows.

Map imagery and annotations are credited to MarvelRivals.gg / DotGG. Marvel Rivals belongs to Marvel and NetEase Games. This is an unofficial map viewer.

## Hosting

Serve or deploy the static `dist` directory directly. There is no server runtime or account database.

### GitHub Pages

The project includes `.github/workflows/pages.yml`. Choose **Settings → Pages → Source → GitHub Actions** to use the workflow. A push to the repository's default branch checks and publishes `dist`; the workflow can also be run manually. Relative asset paths, manifest scope and hash routes support repository subdirectories.
