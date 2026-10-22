## This Fork is a version 4.2.0 edition of Brian McLeer's draw advanced widget that is translated into swedish. Brian has in newer version of the widget a new way of translating widgets, so use the latest version of his widget instead.



# Advanced Draw Widget for ArcGIS Experience Builder

An advanced drawing widget for ArcGIS Experience Builder. It builds on the work of Robert Scheitlin, Adrien Hoff, and others to add a full measurement system, live tooltips, snapping, buffers, line arrows, rich text styling, a My Drawings manager with local-storage save, and import/export across GeoJSON, KML, zipped shapefile, and legacy JSON.

- **Authors:** Brian McLeer, GIS Administrator/Developer, City of Grand Junction, CO; and Jeffrey Thompson, City of Arlington, TX
- **License:** Apache-2.0
- **Discussion, downloads, and feedback:** [Advanced Draw Widget on Esri Community](https://community.esri.com/t5/experience-builder-custom-widgets/advanced-draw-widget-improvements-import-export/ba-p/1618579)

Built and tested on **ArcGIS Experience Builder Developer Edition 1.19 and 1.20**. Per the community thread, the earliest compatible release is Developer Edition 1.17 (Enterprise 11.5); the measurement functions use API features added in 4.32, so it will not run on versions earlier than 1.17.

---

## Installation

This widget ships with a `package.json` and `package-lock.json`, so you do not install each dependency by hand. To add it to your Experience Builder Developer Edition:

1. Copy the `draw-advanced` folder into your client extensions directory:

   ```
   <ExperienceBuilder>/client/your-extensions/widgets/draw-advanced
   ```

   The `manifest.json` must sit directly inside `your-extensions/widgets/draw-advanced/`, not one level deeper (for example `widgets/draw-advanced/draw-advanced/`). Nesting it a second level is the usual cause of a widget not registering.

2. From your Experience Builder **client** directory, run:

   ```bash
   npm ci
   ```

   `npm ci` installs the exact versions captured in `package-lock.json`. Because the widget lives in `your-extensions` and carries its own `package.json`, Experience Builder installs its dependencies automatically. You do not install shp-write, shpjs, or jszip by hand.

3. Start (or restart) the client, then refresh the Builder window. The widget appears under **Insert Widget > Custom**.

> If you add the widget to an Experience Builder that is already running, re-run the client install and restart the dev server so the new dependencies are picked up. Editing a source file generally only needs a Builder refresh.

### Manual install (only if you are not using the lockfile)

```bash
npm install --save @mapbox/shp-write
npm install --save shpjs jszip
```

## Dependencies

| Package | Purpose |
| --- | --- |
| `@mapbox/shp-write` | Export drawings to zipped shapefile |
| `shpjs` | Parse imported shapefiles to GeoJSON |
| `jszip` | Read and write the shapefile ZIP container |

`proj4` and `seamless-immutable` are resolved from the ArcGIS Maps SDK and the jimu framework, so they are not listed here. Exact versions of the listed packages are pinned in `package.json` and frozen in `package-lock.json`.

---

## Features

### Draw tab
- **Drawing tools:** point, line, freehand line, text, rectangle, polygon, freehand polygon, circle, and an optional triangle tool, in a two-row layout with clear Drawing Mode, Edit Mode, and No Drawings indicators. Optional curve drawing tools can be enabled in the widget settings.
- **Measurement system:** real-time area, perimeter, length, radius, and coordinate calculations; geodetic or planar based on spatial reference; distance and area units including user-defined custom units; per-segment line measurements; configurable decimal precision and per-metric toggles.
- **Tooltips:** live length, area, perimeter, radius, and coordinate readouts while drawing, with smart placement and styling.
- **Snapping:** detects all visible snappable layers (feature, graphics, CSV, GeoJSON, WFS, sublayers) with a 15 pixel tolerance, self-snapping, and temporary disable via Ctrl/Cmd. Optional alignment grid.
- **Buffers:** add buffers to points, lines, polygons, and circles with configurable distance, unit, and opacity; an outline-only option (transparent fill, solid stroke) and optional custom buffer colors, with independent fill and outline colors, that override the color inherited from the source drawing. Buffers update when the parent is reshaped and are included in import and export.
- **Line arrows:** add direction arrowheads to straight and freehand lines.
- **Text tool:** expanded font library, real-time preview, rotation, multi-line support, and outline/halo controls.
- **Layer management:** toggle the drawing layer in the map layer list and set a custom layer name.

### My Drawings tab
- **Save and restore:** local-storage save with user consent, per-application or global scope, and session continuity on the same device and browser.
- **Import/Export:** GeoJSON, KML, zipped shapefile, and legacy JSON, plus a format compatible with the out-of-the-box EB Draw widget import/export.
- **Organization:** individual and bulk selection, manual and attribute-based sorting, name filtering, collapse/expand, zoom-all and zoom-to, and move up/down to control draw order.
- **Editing:** inline rename, symbol and text styling, copy/duplicate, lock to prevent edits, notes and labeling, and per-drawing visibility and measurement toggles.
- **Operations:** undo/redo, bulk delete with confirmation, Delete All, and copy/paste of features from map layers.

### Integration
- Send a drawn geometry to the Mailing Labels widget as a selection.
- Optional integration with the custom Identify By Query widget.

### Settings & configuration
- **Granular toggles:** enable or disable each drawing tool, major feature (symbol editor, measurements, snapping, buffer, undo/redo, copy-from-map), and each My Drawings action independently.
- **Defaults:** configure default draw mode, layer name, storage scope, maximum saved drawings, default tab, default buffer distance/unit/opacity/color, and customizable measurement label templates.
- **Settings import/export:** save the full widget configuration to an XML file and load it into another application to copy settings between experiences.

For the complete narrative of capabilities and known issues, see the [Esri Community post](https://community.esri.com/t5/experience-builder-custom-widgets/advanced-draw-widget-improvements-import-export/ba-p/1618579).

---

## Known issues

- **Circles are 60-sided polygons.** Any polygon with exactly 60 sides is treated as a circle and given a radius, so a hand-drawn 60-sided polygon or a distorted circle will be measured as a circle.
- **Freehand line segments** generate too many segment labels to be useful; avoid segment labels on freehand lines.
- **Custom units in the Builder** clear the selected default unit on save. Pick a temporary unit, save, then switch back and save again.
- **Background color picker** needs a Standard Color chosen first before the other color options behave.
- **Curve segment toolbar** (Bezier and arc) is not available. That floating editor is owned by the ArcGIS Sketch widget's internal lifecycle and cannot be triggered from external create calls; it will return if Esri exposes a public plugin API.

---

## Troubleshooting: `draw-advanced is duplicated`

When you run the client install, Experience Builder registers each widget by the `name` in its `manifest.json` and throws `draw-advanced is duplicated` when that name registers more than once. A single, correctly placed copy cannot duplicate itself, so a second copy is present somewhere. Check, in order:

1. A nested folder `widgets\draw-advanced\draw-advanced`. The manifest must sit directly inside the widget folder, not a second level deep.
2. A leftover folder from an earlier build or version, including any `-copy` folder or a folder under a previous name.
3. A stale compiled build in `client\dist\widgets`. Stop the client, delete the matching folder under `dist\widgets` (or run a clean build), then start again.

---

## Feedback

Please report bugs, ideas, and questions on the [Esri Community blog post](https://community.esri.com/t5/experience-builder-custom-widgets/advanced-draw-widget-improvements-import-export/ba-p/1618579).

---

## Changelog

- 2026-07-01 v4.2.2: Fixed the triangle and true-curve tools not switching the widget into Drawing Mode, which had left the Identify widget enabled during those draws. Buffer custom color now supports independent fill and outline colors, and changing one buffer's color no longer restyles the others. Consistent "Send All (N)" count formatting between the Mailing Labels and Identify buttons. Title-case pass across UI labels: buffer options, Clear All Graphics and its delete confirmation, the drawing-mode messages, and the curve menu items. Security: replaced the settings-import XML parser with a controlled text scan and a key allowlist, resolving a CodeQL DOM-based XSS alert (js/xss-through-dom).

- 2026-06-25 v4.2.0: Outline-only buffer option (transparent fill, solid stroke) toggled per buffer; applies live to selected buffers and to new buffers, and persists across reloads. Optional custom buffer color, chosen at creation, that overrides the color inherited from the source drawing. Buffer geometry is now included in all export formats (GeoJSON, shapefile, KML, and ExB Draw) as its own feature, not just as parent attributes. Settings: developer-configurable buffer defaults (distance, unit, opacity, color) and measurement label templates; XML import/export of the full widget configuration to copy settings between applications; settings panel standardized on Jimu UI with developer tooltips and accessibility (WCAG) improvements.

- 2026-06-23 v4.1.0: Triangle tool and optional curve tools (enabled in settings); on-map tooltip overhaul with native Esri styling and Calcite Design System tokens; UI tokenization pass across the widget chrome; text style editor overflow fix; triangle-tool jitter fix.

- 2026-06-11 v4.0.2: Security fixes for CodeQL code scanning alerts

- 2026-06-11 v4.0.1: Security fixes for CodeQL code scanning alerts

- **2026-05-05** Minor bug fix to version 4.0 resolving an issue when merging multiple buffered features.
- **2026-05-01** Version 4: integration with the Identify By Query widget; multi-line numbers supported for text.
- **2026-04-01** Developer Edition 1.20 build available (3.2 = DE 1.20, 3.1 = DE 1.19).
- **2026-02-24** Version 3.1: lock drawing, measurement on/off for one or all, copy one or multiple features, multi-select by click or shape, merge before paste, send to Mailing Labels, more tool/function settings, and sort-order and prior-session bug fixes.
- **2026-02-12** Fixed import of SHP files using regional coordinate systems (for example EPSG:5514).
- **2026-02-05** Version 3: shapefile and KML import/export, storage scope setting, and a My Drawings UI overhaul.
- **2025-10-15** Version 2: buffers, line arrows, GeoJSON import/export, measurement label editing, and Delete All.
- **2025-05-28** Version 1.0.0: initial release.

---

## Credits

Created by **Brian McLeer** (City of Grand Junction, CO) and **Jeffrey Thompson** (City of Arlington, TX), building on contributions from Robert Scheitlin, Adrien Hoff, Mattias Ekström, Jérôme Ray, and Nicholas Cramer. Thanks to the Esri Experience Builder community for feedback and testing.
