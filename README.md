## This Fork is a version 4.2.0 edition of Brian McLeer's draw advanced widget that is translated into swedish. Brian has in newer version of the widget a new way of translating widgets, so use the latest version of his widget instead.

# Advanced Draw Widget for ArcGIS Experience Builder

An advanced drawing widget for ArcGIS Experience Builder with a full measurement system, live tooltips, snapping, buffers, line arrows, rich text styling, a My Drawings manager with local-storage save, and import/export across GeoJSON, KML, zipped shapefile, and legacy JSON.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

- **Authors:** Brian McLeer (City of Grand Junction, CO) and Jeffrey Thompson (City of Arlington, TX)
- **Built and tested on:** ArcGIS Experience Builder Developer Edition 1.19 and 1.20
- **Minimum supported:** Developer Edition 1.17 (Enterprise 11.5)
- **Discussion, feedback, and original post:** [Advanced Draw Widget on Esri Community](https://community.esri.com/t5/experience-builder-custom-widgets/advanced-draw-widget-improvements-import-export/ba-p/1618579)

> The widget folder itself lives in [`draw-advanced/`](draw-advanced). This repo wraps it with project files (license, this readme) so it works for both downloading a release and cloning.

<!-- Tip: add a screenshot or GIF of the widget here to give people a quick visual. -->

## Getting the widget

There are two ways to get it. Both end with you placing a `draw-advanced` folder into your Experience Builder install.

### Option 1: Download a release (recommended)

1. Go to the [Releases](https://github.com/brianmcleer/draw-advanced-widget/releases) page.
2. Under the latest release, download the `draw-advanced.zip` asset.
3. Extract it. You will get a `draw-advanced` folder.

### Option 2: Clone or download the repo

```bash
git clone https://github.com/brianmcleer/draw-advanced-widget.git
```

Or use the green **Code** button above and choose **Download ZIP**. The `draw-advanced` folder is inside.

## Installation

1. Copy the `draw-advanced` folder into your Experience Builder install:

   ```
   <ArcGISExperienceBuilder>/client/your-extensions/widgets/draw-advanced
   ```

   Keep `manifest.json` directly inside `draw-advanced/`, not nested a second level deep. Nesting is the usual cause of the widget not registering.

2. From the Experience Builder **client** directory, run the standard install:

   ```bash
   npm install
   ```

   Because the widget includes a `package.json` and `package-lock.json` and lives in `your-extensions`, Experience Builder installs its dependencies automatically. You do not install shp-write, shpjs, or jszip by hand.

3. Start (or restart) the client and refresh the Builder window. The widget appears under **Insert Widget > Custom**.

> If you add the widget to an Experience Builder that is already running, re-run the client install and restart the dev server so the new dependencies are picked up.

## Requirements

- ArcGIS Experience Builder Developer Edition 1.17 or later, with 1.19 and 1.20 being the build/test targets.
- The measurement functions use ArcGIS Maps SDK 4.32 features, so editions earlier than 1.17 are not supported.

Dependencies (installed automatically, pinned in `draw-advanced/package-lock.json`): `@mapbox/shp-write`, `shpjs`, `jszip`. `proj4` and `seamless-immutable` resolve from the SDK and the jimu framework.

## Features

- Drawing tools for point, line, freehand line, text, rectangle, polygon, freehand polygon, circle, and an optional triangle tool, plus optional curve tools enabled in the widget settings.
- Real-time measurement (area, perimeter, length, radius, coordinates) with geodetic or planar calculation, custom units, per-segment labels, and configurable precision.
- Live tooltips, multi-layer snapping with a 15 pixel tolerance, and an optional alignment grid.
- Buffers (with outline-only and independent custom fill/outline colors), line arrows, an expanded text-styling tool, and drawing-layer management.
- A My Drawings manager: local-storage save, sorting, filtering, locking, notes, undo/redo, bulk operations, and draw-order control.
- Import and export across GeoJSON, KML, zipped shapefile, and legacy JSON, plus EB Draw widget compatible JSON.
- Optional integration with the Mailing Labels and Identify By Query custom widgets.
- Configurable settings: per-tool and per-feature toggles, default buffer and measurement options, and XML import/export to copy a configuration between applications.

See [`draw-advanced/README.md`](draw-advanced/README.md) for the full feature reference, known issues, and changelog.

## Feedback and issues

Please report bugs and enhancement requests either on the [Esri Community blog post](https://community.esri.com/t5/experience-builder-custom-widgets/advanced-draw-widget-improvements-import-export/ba-p/1618579) or in this repo's [Issues](https://github.com/brianmcleer/draw-advanced-widget/issues) tab.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright City of Grand Junction, CO.

## Credits

Created by Brian McLeer (City of Grand Junction, CO) and Jeffrey Thompson (City of Arlington, TX), building on contributions from Robert Scheitlin, Adrien Hoff, Mattias Ekström, Jérôme Ray, and Nicholas Cramer. Thanks to the Esri Experience Builder community for feedback and testing.
