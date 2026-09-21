import { React } from 'jimu-core';
const { useState, useEffect, useRef } = React as any;
import { Button, TextInput, NumericInput, Switch, Slider, Label, AdvancedButtonGroup, Select, Option, Popper } from 'jimu-ui';
import { SymbolSelector, JimuSymbolType, JimuSymbol } from 'jimu-ui/advanced/map';
import GraphicsLayer from 'esri/layers/GraphicsLayer';
import Graphic from 'esri/Graphic';
import SketchViewModel from 'esri/widgets/Sketch/SketchViewModel';
import SimpleMarkerSymbol from 'esri/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from 'esri/symbols/SimpleLineSymbol';
import SimpleFillSymbol from 'esri/symbols/SimpleFillSymbol';
import TextSymbol from 'esri/symbols/TextSymbol';
import PictureMarkerSymbol from 'esri/symbols/PictureMarkerSymbol';
import Color from 'esri/Color';
import Font from 'esri/symbols/Font';
import { ThemeContext } from 'jimu-theme';
import { IMThemeVariables } from 'jimu-core';
import { JimuMapView } from 'jimu-arcgis';
import { ColorPicker } from 'jimu-ui/basic/color-picker';
import Point from "esri/geometry/Point";
import Polygon from "esri/geometry/Polygon";
import Polyline from "esri/geometry/Polyline";
import Multipoint from "esri/geometry/Multipoint";
import Extent from "esri/geometry/Extent";
import SpatialReference from "esri/geometry/SpatialReference";

const PolygonCompat = Polygon as typeof Polygon & {
    fromJSON: (json: any) => Polygon;
    fromExtent: (extent: any) => Polygon;
};
const GraphicCompat = Graphic as typeof Graphic & { fromJSON: (json: any) => Graphic };
import * as webMercatorUtils from "esri/geometry/support/webMercatorUtils";
import * as geometryEngine from 'esri/geometry/geometryEngine';
import * as densifyOperator from 'esri/geometry/operators/densifyOperator';
const proj4Module: any = require('proj4');
const proj4: any = proj4Module.default || proj4Module;
import shpwrite from '@mapbox/shp-write';
const JSZipModule: any = require('jszip');
const JSZip: any = JSZipModule.default || JSZipModule;
type GeoJsonProperties = { [name: string]: any } | null;
type Geometry = { type: string;[name: string]: any };
type FeatureCollection<G = Geometry, P = GeoJsonProperties> = {
    type: 'FeatureCollection';
    features: Array<{ type: 'Feature'; geometry: G; properties: P;[name: string]: any }>;
    [name: string]: any;
};
// shapefile import removed — using shpjs instead for built-in proj4 reprojection support
const ReactDOMModule: any = require('react-dom');
const ReactDOM: any = ReactDOMModule.default || ReactDOMModule;

// Optional: Import icons for text alignment if available
const hAlignLeft = require('jimu-icons/svg/outlined/editor/text-left.svg');
const hAlignCenter = require('jimu-icons/svg/outlined/editor/text-center.svg');
const hAlignRight = require('jimu-icons/svg/outlined/editor/text-right.svg');
const vAlignBase = require('../assets/text-align-v-base.svg');
const vAlignTop = require('../assets/text-align-v-t.svg');
const vAlignMid = require('../assets/text-align-v-m.svg');
const vAlignBot = require('../assets/text-align-v-b.svg');
const fsBoldIcon = require('../assets/bold.svg');
const fItalicIcon = require('../assets/italic.svg');
const fUnderlineIcon = require('../assets/underline.svg');

import { InputUnit } from 'jimu-ui/advanced/style-setting-components';
import { Icon } from 'jimu-ui';

import { TextStyleEditor } from './TextStyleEditor';

import { Alert } from 'jimu-ui';
// Modules loaded eagerly via AMD loader — starts immediately so they're ready before first user action.
// These cannot be statically imported in ExB 1.20; they require the ArcGIS AMD runtime loader.
// geometryEngine is sync, pure-JS in JSAPI 4.x/5.x — no WASM required.
// (The earlier "removed in 5.0" note was wrong.) Reprojection still uses
// webMercatorUtils (sync) and proj4 (always available).

/**
 * Dissolve self-intersections (spikes / pinches / overlapping rings) in a
 * polygon produced by the manual offset buffer. These overlaps are what render
 * with the even/odd fill rule and produce the "lighter triangle" artifact on
 * weird/crossing shapes. No-op if simplify is unavailable or throws.
 */
const _mdpSimplifyPolygonSafe = (geom: any): any => {
    if (!geom || geom.type !== 'polygon') return geom;
    try {
        const ge: any = (geometryEngine as any).default || geometryEngine;
        if (ge?.simplify) {
            const simplified = ge.simplify(geom);
            if (simplified) return Array.isArray(simplified) ? simplified[0] : simplified;
        }
    } catch (e) {
        console.warn('_mdpSimplifyPolygonSafe: simplify failed, returning input as-is', e);
    }
    return geom;
};

// ── Manual buffer helpers (no WASM required) ──────────────────────────────────
const _MDP_UNIT_TO_METERS: Record<string, number> = {
    meters: 1, meter: 1, esrimeters: 1,
    kilometers: 1000, kilometer: 1000, esrikilometers: 1000,
    feet: 0.3048, foot: 0.3048, esrifeet: 0.3048,
    miles: 1609.344, mile: 1609.344, esrimiles: 1609.344,
    yards: 0.9144, yard: 0.9144, esriyards: 0.9144,
    nauticalmiles: 1852, esrinauticalmiles: 1852,
};
const _mdpToMeters = (dist: number, unit: string): number =>
    dist * (_MDP_UNIT_TO_METERS[(unit || '').toLowerCase().replace(/-/g, '')] ?? 1);
const _mdpMakePoly = (rings: number[][][], sr: any): any =>
    PolygonCompat.fromJSON({ rings, spatialReference: sr?.toJSON ? sr.toJSON() : sr });

const _mdpCircleRing = (cx: number, cy: number, r: number, isGeo: boolean): number[][] => {
    const N = 72; const ring: number[][] = [];
    const cosLat = isGeo ? Math.cos(cy * Math.PI / 180) : 1;
    for (let i = 0; i <= N; i++) {
        const a = 2 * Math.PI * i / N;
        ring.push([cx + (r / (isGeo ? 111320 * cosLat : 1)) * Math.cos(a),
        cy + (r / (isGeo ? 111320 : 1)) * Math.sin(a)]);
    }
    return ring;
};
const _mdpArcPts = (cx: number, cy: number, r: number, from: number): number[][] => {
    const pts: number[][] = [];
    for (let i = 0; i <= 18; i++) pts.push([cx + r * Math.cos(from + Math.PI * i / 18), cy + r * Math.sin(from + Math.PI * i / 18)]);
    return pts;
};
const _mdpPathBuf = (path: number[][], d: number, sr: any): any => {
    if (path.length < 2) return null;
    const n = path.length;
    const sn = (i: number) => { const dx = path[i + 1][0] - path[i][0], dy = path[i + 1][1] - path[i][1], len = Math.sqrt(dx * dx + dy * dy) || 1; return { nx: -dy / len, ny: dx / len }; };
    const vn = (i: number) => { if (i === 0) return sn(0); if (i === n - 1) return sn(n - 2); const a = sn(i - 1), b = sn(i), mx = a.nx + b.nx, my = a.ny + b.ny, ml = Math.sqrt(mx * mx + my * my) || 1; return { nx: mx / ml, ny: my / ml }; };
    const L: number[][] = [], R: number[][] = [];
    for (let i = 0; i < n; i++) { const { nx, ny } = vn(i); L.push([path[i][0] + nx * d, path[i][1] + ny * d]); R.push([path[i][0] - nx * d, path[i][1] - ny * d]); }
    const ea = Math.atan2(path[n - 1][1] - path[n - 2][1], path[n - 1][0] - path[n - 2][0]);
    const sa = Math.atan2(path[0][1] - path[1][1], path[0][0] - path[1][0]);
    const ring = [...L, ..._mdpArcPts(path[n - 1][0], path[n - 1][1], d, ea + Math.PI / 2), ...[...R].reverse(), ..._mdpArcPts(path[0][0], path[0][1], d, sa + Math.PI / 2), L[0]];
    return _mdpMakePoly([ring], sr);
};

/**
 * Polygon offset buffer.
 * Offsets each vertex along the bisector of adjacent outward edge normals.
 * Convex corners get a rounded arc fillet (matches geometryEngine.buffer),
 * concave corners use a single bisector intersection (sharp inner corner).
 * Ring orientation is auto-detected via signed area (Shoelace).
 *
 * Mirrors the implementation in BufferControls.tsx so that buffers recreated
 * from localStorage on reload match buffers created during the initial draw.
 * Previously, this path stack only handled point + polyline + extent, so polygons
 * fell through to the extent branch and were reborn as circles around the
 * polygon centroid.
 */
const _mdpPolygonBuffer = (rings: number[][][], distM: number, sr: any): any => {
    if (!rings?.length) return null;

    const offsetRing = (ring: number[][]): number[][] => {
        const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
            ? ring.slice(0, -1) : ring;
        const n = pts.length;
        if (n < 3) return ring;

        // Signed area (Shoelace) to detect winding
        let area = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
        }
        // CCW (area>0): outward = RIGHT normal; CW (area<0): outward = LEFT normal
        const s = area > 0 ? 1 : -1;

        const edgeNorm = (i: number) => {
            const j = (i + 1) % n;
            const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            return { nx: s * dy / len, ny: s * (-dx) / len };
        };

        // Arc step ≈ 15°, but cap total points per fillet so very acute corners
        // don't blow up the ring count.
        const ARC_STEP = Math.PI / 12;
        const MAX_ARC_STEPS = 24;

        const result: number[][] = [];
        for (let i = 0; i < n; i++) {
            const prev = (i + n - 1) % n;
            const ea = edgeNorm(prev), eb = edgeNorm(i);
            const cross = ea.nx * eb.ny - ea.ny * eb.nx;
            const dot = ea.nx * eb.nx + ea.ny * eb.ny;
            const isConvex = cross * s > 0;
            if (isConvex) {
                // Rounded fillet: arc from ea-direction to eb-direction around pts[i]
                let a0 = Math.atan2(ea.ny, ea.nx);
                const a1 = Math.atan2(eb.ny, eb.nx);
                let delta = a1 - a0;
                // Sweep on the outward side (CCW for s=+1, CW for s=-1)
                if (s > 0) { while (delta <= 0) delta += 2 * Math.PI; if (delta > 2 * Math.PI) delta -= 2 * Math.PI; }
                else { while (delta >= 0) delta -= 2 * Math.PI; if (delta < -2 * Math.PI) delta += 2 * Math.PI; }
                const steps = Math.min(MAX_ARC_STEPS, Math.max(2, Math.ceil(Math.abs(delta) / ARC_STEP)));
                for (let k = 0; k <= steps; k++) {
                    const a = a0 + delta * (k / steps);
                    result.push([pts[i][0] + distM * Math.cos(a), pts[i][1] + distM * Math.sin(a)]);
                }
            } else {
                // Concave or straight: single bisector intersection (sharp inside corner)
                const mx = ea.nx + eb.nx, my = ea.ny + eb.ny;
                const mlen = Math.sqrt(mx * mx + my * my) || 1;
                const cosHalf = Math.sqrt(Math.max(0, (1 + dot) / 2));
                const miterLen = cosHalf < 0.05 ? distM * 4 : Math.min(distM / cosHalf, distM * 4);
                result.push([pts[i][0] + (mx / mlen) * miterLen, pts[i][1] + (my / mlen) * miterLen]);
            }
        }
        result.push(result[0]);
        return result;
    };

    return _mdpMakePoly(rings.map(r => offsetRing(r)), sr);
};

// True curves keep their shape in curvePaths and have an empty paths array, which
// every paths-based operation below (buffer, reproject, export) would treat as empty.
// Densify a curve into a plain polyline so those operations capture it.
const _mdpDensifyIfCurve = (geom: any): any => {
    try {
        if (!geom || geom.type !== 'polyline' || !(geom as any).curvePaths) return geom;
        const ext = (geom as any).extent;
        const span = ext ? Math.max(ext.width || 0, ext.height || 0) : 0;
        const maxSeg = Math.max(span ? span / 200 : 1, 1e-6);
        const dense: any = densifyOperator.execute(geom, maxSeg);
        return (dense && dense.paths && dense.paths.length) ? dense : geom;
    } catch (e) { console.warn('MyDrawings curve densify failed:', e); return geom; }
};

const _mdpManualBuffer = (geom: any, distM: number, sr: any): any => {
    if (!geom) return null;
    geom = _mdpDensifyIfCurve(geom);
    const isGeo = sr?.isGeographic || sr?.wkid === 4326;

    // Convert meters to the SR's native coordinate units (projected SRs only).
    // Geographic SRs keep meters and use the degree conversion inside the ring helpers.
    const srUnit = (sr?.unit || '').toString().toLowerCase();
    let distSR = distM;
    if (!isGeo) {
        if (srUnit.includes('foot') || srUnit.includes('feet') || srUnit === 'us-feet' || srUnit === 'us_survey_feet') {
            distSR = distM / 0.3048;
        } else if (srUnit.includes('mile')) {
            distSR = distM / 1609.344;
        } else if (srUnit.includes('kilometer') || srUnit === 'km') {
            distSR = distM / 1000;
        }
    }
    const dUse = isGeo ? distM : distSR;

    // 🔧 FIX (Bug: polygon buffer becomes circle on reload):
    // Don't trust geom.type. After Graphic.fromJSON the type field can be missing or
    // wrong for restored polygons, which previously routed through the extent
    // fallback at the bottom — producing a circle around the centroid instead of
    // a polygon outline buffer. Infer kind from the actual shape data first, and
    // only consult geom.type as a tiebreaker.
    const hasRings = Array.isArray(geom.rings) && geom.rings.length > 0 &&
        Array.isArray(geom.rings[0]) && geom.rings[0].length >= 3;
    const hasPaths = Array.isArray(geom.paths) && geom.paths.length > 0 &&
        Array.isArray(geom.paths[0]) && geom.paths[0].length >= 2;
    const hasXY = typeof geom.x === 'number' && typeof geom.y === 'number';

    // Polygon: rings present (shape-first detection, then fall back to type tag)
    if (hasRings || geom.type === 'polygon') {
        const rings = geom.rings || [];
        if (rings.length > 0) {
            const result = _mdpPolygonBuffer(rings, dUse, sr);
            if (result) return result;
        }
        // If rings are degenerate, fall through to extent fallback so we still
        // produce something visible rather than null.
    }

    // Polyline: paths present
    if (hasPaths || geom.type === 'polyline') {
        const paths: number[][][] = geom.paths || [];
        if (paths.length > 0) {
            if (paths.length === 1) return _mdpPathBuf(paths[0], dUse, sr);
            // Multi-path: stack rings (no geometryEngine.union available in JSAPI 5.0)
            const allRings: number[][][] = [];
            for (const p of paths) {
                const b = _mdpPathBuf(p, dUse, sr);
                if (b?.rings) for (const r of b.rings) allRings.push(r);
            }
            if (allRings.length > 0) return _mdpMakePoly(allRings, sr);
        }
    }

    // Point: x/y present
    if (hasXY || geom.type === 'point') {
        return _mdpMakePoly([_mdpCircleRing(geom.x, geom.y, distM, isGeo)], sr);
    }

    // Last-resort: bounding-circle fallback for genuinely unknown geometry.
    // We log a warning here because reaching this branch usually indicates the
    // geometry was malformed (missing rings/paths/xy), and the circle is a
    // visible-but-wrong shape that helps the user notice the problem.
    const ext = geom.extent;
    if (ext) {
        console.warn('_mdpManualBuffer falling back to bounding-circle for geometry without rings/paths/xy:', geom);
        const cx = (ext.xmin + ext.xmax) / 2, cy = (ext.ymin + ext.ymax) / 2;
        const r = Math.max(ext.width, ext.height) / 2 + dUse;
        return _mdpMakePoly([_mdpCircleRing(cx, cy, r, isGeo)], sr);
    }
    return null;
};

type FontStyle = 'bold' | 'italic' | 'underline';
type HorizontalAlign = 'left' | 'center' | 'right';
type VerticalAlign = 'baseline' | 'top' | 'middle' | 'bottom';


/**
 * Debounce function - delays execution until after wait time has elapsed since last call
 * Prevents excessive function calls for expensive operations
 */
function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const debouncedFn = function (...args: Parameters<T>) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };

    // Add cancel method for cleanup
    (debouncedFn as any).cancel = () => {
        if (timeout) clearTimeout(timeout);
    };

    return debouncedFn;
}

/**
 * Throttle function - ensures function is called at most once per interval
 */
function throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle: boolean;

    return function (...args: Parameters<T>) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

/**
 * RequestIdleCallback polyfill for browsers that don't support it
 * Allows deferring work until the browser is idle
 */
const requestIdleCallback = (window as any).requestIdleCallback || function (cb: IdleRequestCallback) {
    const start = Date.now();
    return setTimeout(() => {
        cb({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
        } as IdleDeadline);
    }, 1);
};

// ============================================================================
// ⚡ PERFORMANCE OPTIMIZATION: Async Thumbnail Generation
// ============================================================================
// KEY IMPROVEMENT: Non-blocking thumbnail generation using requestIdleCallback
// IMPACT: Reduces click handler time from 318ms to <16ms

const genThumb = async (g: any, jmv: JimuMapView): Promise<string | null> => {
    return new Promise((resolve) => {
        // Defer thumbnail generation to when browser is idle
        // This prevents blocking user interactions
        requestIdleCallback(async () => {
            try {
                if (!jmv?.view || !g?.geometry) {
                    resolve(null);
                    return;
                }

                const v = jmv.view;
                let ext = g.geometry.extent;

                // Handle point geometry
                if (g.geometry.type === 'point') {
                    const p = g.geometry as any;
                    const b = v.scale * 0.0001;
                    ext = {
                        xmin: p.x - b,
                        ymin: p.y - b,
                        xmax: p.x + b,
                        ymax: p.y + b,
                        spatialReference: p.spatialReference
                    } as any;
                } else if (ext) {
                    ext = ext.expand(1.2);
                }

                if (!ext) {
                    resolve(null);
                    return;
                }

                // Convert extent to screen coordinates
                const tl = v.toScreen({
                    x: ext.xmin,
                    y: ext.ymax,
                    spatialReference: ext.spatialReference
                } as any);

                const br = v.toScreen({
                    x: ext.xmax,
                    y: ext.ymin,
                    spatialReference: ext.spatialReference
                } as any);

                // Take screenshot
                const ss = await v.takeScreenshot({
                    area: {
                        x: tl.x,
                        y: tl.y,
                        width: br.x - tl.x,
                        height: br.y - tl.y
                    },
                    width: 100,
                    height: 70,
                    format: 'png'
                });

                resolve(ss?.dataUrl || null);
            } catch (error) {
                console.warn('⚠️ Thumbnail generation failed:', error);
                resolve(null);
            }
        }, { timeout: 2000 }); // Max 2 second wait for idle time
    });
};

interface ExtendedGraphic extends Graphic {
    measure?: {
        graphic: any | null;
        areaUnit?: string;
        lengthUnit?: string;
    };
    measureParent?: any;
    checked?: boolean;
    originalSymbol?: any;
    isBufferDrawing?: boolean;
    sourceGraphicId?: string;
    bufferGraphic?: ExtendedGraphic; // Direct reference to attached buffer
    bufferLabel?: any | null; // 🔧 NEW: Reference to buffer label
    drawingLabel?: any | null; // Reference to drawing name/notes label
    _selectionOverlay?: any | null;
    bufferSettings?: {
        distance: number;
        unit: string;
        enabled: boolean;
        opacity?: number;
        hasLabel?: boolean; // 🔧 NEW: Track if buffer has a label
        outlineOnly?: boolean;
        customColor?: string | null;
        customOutlineColor?: string | null;
    };
    // 🔧 MEASUREMENT FIX: Additional properties for measurement handling
    attributes: any["attributes"] & {
        hadMeasurements?: boolean;
        relatedSegmentLabels?: any[];
        relatedMeasurementLabels?: any[];
        uniqueId?: string;
        lengthUnit?: string;
        areaUnit?: string;
        isMeasurementLabel?: boolean;
        hideFromList?: boolean;
        parentGraphicId?: string;
        measurementType?: string;
        isSegmentLabel?: boolean;
        customized?: boolean;
        isBuffer?: boolean;
        name?: string;
        description?: string;
        drawMode?: string;
        measurementsHidden?: boolean;
        [key: string]: any;
    };
}

const asExtendedGraphic = (graphic: any): ExtendedGraphic => {
    return graphic as ExtendedGraphic;
};

interface MyDrawingsPanelProps {
    key?: string | number;
    ref?: React.Ref<MyDrawingsPanel>;
    graphicsLayer: GraphicsLayer;
    jimuMapView: JimuMapView;
    allowLocalStorage?: boolean;
    localStorageKey?: string;
    confirmOnDelete?: boolean;
    onDrawingSelect?: (graphic: any, index: number) => void;
    onDrawingsUpdate?: (graphics: any[]) => void;
    showAlert?: (message: string, type: 'success' | 'error' | 'info') => void;
    drawings?: any[]; // Optional prop to receive drawings from parent
    isActiveTab: boolean;
    onMeasurementSystemControl?: (enabled: boolean) => void;
    onClearSelectionOverlays?: () => void;
    measureRef?: React.RefObject<any>; // Reference to measurement component from parent
    sketchViewModel?: SketchViewModel; // CRITICAL: Use parent's SketchViewModel so measure.tsx can listen to it
    nls: (id: string, values?: Record<string, any>) => string;
    featureFlags?: {
        enableImport?: boolean;
        enableExport?: boolean;
        enableLock?: boolean;
        enableGroup?: boolean;
        enableMerge?: boolean;
        enableDuplicate?: boolean;
        enableZoomTo?: boolean;
        enableProperties?: boolean;
        enableSort?: boolean;
        maxDrawings?: number;
    };
}

// ---------------- MyDrawingsPanel.tsx ----------------
// STATE
interface MyDrawingsPanelState {
    // ===== Core collections =====
    drawings: ExtendedGraphic[];
    selectedGraphicIndex: number | null;
    sortOption: 'name' | 'type' | 'created';
    editingGraphicIndex: number | null;

    // ===== Alerts =====
    alertMessage: string;
    alertType: 'success' | 'error' | 'info' | 'warning';
    showAlert: boolean;

    // ===== Permissions / watchers =====
    consentGranted: boolean | null;
    graphicsWatchHandle: any | null;

    // ===== Confirm dialog =====
    confirmDialogOpen: boolean;
    confirmDialogAction: (() => void) | null;
    confirmDialogMessage: string;
    confirmDialogType: 'delete' | 'clearAll';
    confirmDialogItemIndex: number | null;

    // ===== Import =====
    importDialogOpen: boolean;
    importFile: File | null;
    importFileContent: string | null;

    // ===== Selection =====
    selectedGraphics: Set<number>;
    symbolEditingIndex: number | null;
    showStorageDisclaimer: boolean;
    collapsedDrawings: Set<number>;

    // ===== Text editor values =====
    textValue: string;

    // ===== Text symbol editing properties =====
    fontColor: string;
    fontSize: number;
    fontFamily: string;
    fontOpacity: number;
    fontRotation: number;

    // ===== Text alignment =====
    horizontalAlignment: 'left' | 'center' | 'right';
    verticalAlignment: 'baseline' | 'top' | 'middle' | 'bottom';

    // ===== Button active states =====
    hAlignLeftActive: boolean;
    hAlignCenterActive: boolean;
    hAlignRightActive: boolean;
    vAlignBaseActive: boolean;
    vAlignTopActive: boolean;
    vAlignMidActive: boolean;
    vAlignBotActive: boolean;
    fsBoldActive: boolean;
    fsItalicActive: boolean;
    fsUnderlineActive: boolean;

    // ===== Font style =====
    fontWeight: string;
    fontStyle: string;
    fontDecoration: string;
    isBold: boolean;
    isItalic: boolean;
    isUnderline: boolean;

    // ===== Halo properties =====
    fontHaloEnabled: boolean;
    fontHaloColor: string;
    fontHaloSize: number;
    fontHaloOpacity: number;

    // ===== TextSymbol object for editor =====
    currentTextSymbol: TextSymbol;

    // ===== Restore prompt =====
    showLoadPrompt: boolean;
    hasExistingDrawings: boolean;
    hasNewUnsavedDrawings: boolean;

    // ===== Drag and drop state =====
    draggedIndex: number | null;
    dragOverIndex: number | null;
    hasManualOrder: boolean;
    listRenderKey: number;
    toolbarCollapsed: boolean;

    // ===== Export dropdown state =====
    openDropdownIndex: number | string | null;
    dropdownOpenUpward: Set<number | string>; // Track which dropdowns should open upward

    // ===== Label popper state (deprecated - using openDropdownIndex instead) =====
    labelPopperOpen?: boolean;
    labelPopperAnchor?: HTMLElement | null;

    // ===== Search/Filter =====
    searchFilter: string;
    filterByMapExtent: boolean;
    thumbCache?: Map<string, string>;
    thumbGens?: Set<string>;

    // ===== Notes dialog =====
    notesDialogOpen: boolean;
    notesEditingIndex: number | null;
    notesEditingText: string;

    // Timer for debounced auto-save (typed safely for browser/Node)
    notesSaveTimeout: ReturnType<typeof setTimeout> | null;

    // Resizable Notes dialog dimensions (remember while open)
    notesDialogWidth?: number;   // default used if undefined
    notesDialogHeight?: number;  // default used if undefined

    // ===== Drawing label option =====
    drawingLabelOption: 'off' | 'name' | 'notes' | 'both';

    // ===== Import progress =====
    importInProgress: boolean;
    importProgress: number;  // 0-100
    importProgressMessage: string;

    // ===== Lock state =====
    lockedDrawings: Set<string>;  // Set of uniqueIds of locked drawings
    allDrawingsLocked: boolean;
}
export interface MyDrawingsPanel {
    props: MyDrawingsPanelProps;
    state: MyDrawingsPanelState;
    setState: (state: any, callback?: () => void) => void;
    forceUpdate: (callback?: () => void) => void;
}

export class MyDrawingsPanel extends React.PureComponent<MyDrawingsPanelProps, MyDrawingsPanelState> {

    // ========================================================================
    // Feature flag helper — all default to true when not specified
    // ========================================================================
    private ff = (key: string): boolean => {
        const flags = this.props.featureFlags;
        if (!flags) return true; // No flags = everything enabled
        return flags[key] !== false;
    }

    // ========================================================================
    // ⚡ PERFORMANCE OPTIMIZATION: Debounced and Cached Properties
    // ========================================================================

    private debouncedSave: ReturnType<typeof debounce>;
    private debouncedGraphicsUpdate: ReturnType<typeof debounce>;
    private throttledResize: ReturnType<typeof throttle>;

    private graphicsUpdatePending = false;
    private animationFrameId: number | null = null;

    private notesDragState = {
        isDragging: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0
    };

    private textStyleDragState = {
        isDragging: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0
    };

    private notesDialogRef = React.createRef<HTMLDivElement>();
    private textStyleDialogRef = React.createRef<HTMLDivElement>();

    private thumbnailCache = new Map<string, string>();
    private readonly MAX_CACHE_SIZE = 100;

    private cachedMeasurements = new WeakMap<HTMLElement, DOMRect>();


    sketchViewModel: SketchViewModel | null = null;
    private localStorageKey: string;
    private lockStorageKey: string;
    private isDeletingGraphics = false;
    private ignoreNextGraphicsUpdate = false;
    private _isImporting = false; // 🔧 FIX: Track when import is in progress to ignore ALL graphics changes
    private _isLoadingFromStorage = false; // FIX: Track when loading from localStorage to prevent premature refresh
    private internalSketchVM = true; // Track if we're using our own SketchVM or parent's
    private measurementStylesInitialized = false;
    private _mapClickSyncEnabled = true;
    private _drawingMap: Map<string, number> = new Map();
    private _refreshDrawingsOriginal: () => void;
    private _cleanMeasurementLabelsHandler: any | null = null;
    private _measurementStyleWatcher: any | null = null;
    private _positionWatchers: { [key: string]: any } = {};
    private _savePositionTimeout: any = null;
    private _loadChoiceMadeThisSession = false;
    private static _drawingsLoadChoiceTimestamp: number = 0;
    private _pendingLoadMode: 'normal' | 'skip' = 'normal';
    private _afterRefreshDrawings: () => void = null;
    private _graphicsWatchHandles: any[] = [];
    // 🔧 MEMORY FIX: accumulators for previously-untracked event handles.
    // Each entry holds an Esri handle ({ remove(): void }) created by view.on /
    // sketchViewModel.on / graphicsLayer.graphics.on. componentWillUnmount tears
    // them all down so closing+reopening or switching map views doesn't pile up
    // duplicate listeners on the same view/SVM/layer instances.
    private _interactionHandles: any[] = [];   // setupInteractionManager view.on(...)
    private _mapQualityHandles: any[] = [];    // setupMapQualityManager view.on(...)
    private _svmListenerHandles: any[] = [];   // sketchViewModel.watch + on listeners
    private _goToController: AbortController | null = null;
    private _measurementWasEnabled: boolean = false;
    private _originalQuality: string = 'high';
    private _isInteracting: boolean = false;
    private _isTogglingVisibility: boolean = false;
    private _isSelectingGraphic: boolean = false;
    private processedMeasurementGraphics = new Set<string>()
    // Capture current graphics order and restore it after an operation
    private preserveGraphicsOrder = (operation: () => void | Promise<void>) => {
        if (!this.props.graphicsLayer) {
            operation();
            return;
        }

        //console.log('🔒 preserveGraphicsOrder: Capturing order before operation');

        // Capture the current order of ALL graphics by their uniqueIds
        const orderMap: { uniqueId: string; graphic: any }[] = [];
        this.props.graphicsLayer.graphics.forEach(g => {
            const uniqueId = g.attributes?.uniqueId;
            if (uniqueId) {
                orderMap.push({ uniqueId, graphic: g });
            }
        });

        //console.log(`🔒 Captured order of ${orderMap.length} graphics`);

        // Perform the operation
        const result = operation();

        // Restore order after a delay to let the operation complete
        const restore = () => {
            //console.log('🔓 preserveGraphicsOrder: Restoring order after operation');
            if (!this.props.graphicsLayer) return;

            // Build a map of current graphics by uniqueId
            const currentGraphics = new Map<string, any>();
            this.props.graphicsLayer.graphics.forEach(g => {
                const uniqueId = g.attributes?.uniqueId;
                if (uniqueId) {
                    currentGraphics.set(uniqueId, g);
                }
            });

            // Reorder graphics to match the original order
            // The orderMap contains the captured order, restore it exactly as it was
            let reorderedCount = 0;
            orderMap.forEach((item, capturedIndex) => {
                const graphic = currentGraphics.get(item.uniqueId);
                if (graphic) {
                    const currentIndex = this.props.graphicsLayer.graphics.indexOf(graphic);
                    if (currentIndex !== capturedIndex && currentIndex !== -1) {
                        this.props.graphicsLayer.graphics.reorder(graphic, capturedIndex);
                        reorderedCount++;
                    }
                }
            });
            //console.log(`✅ preserveGraphicsOrder: Reordered ${reorderedCount} graphics back to original positions`);
        };

        if (result instanceof Promise) {
            result.then(() => {
                setTimeout(restore, 150);
            }).catch(() => {
                setTimeout(restore, 150);
            });
        } else {
            setTimeout(restore, 150);
        }
    };

    private projectGeometryToWGS84 = async (geometry: any): Promise<any | null> => {
        try {
            const wgs84SR = new SpatialReference({ wkid: 4326 });
            if (geometry.spatialReference && geometry.spatialReference.wkid === 4326) {
                return geometry;
            }
            // Delegate to the full conversion method which has webMercatorUtils + proj4 fallbacks
            return this.convertGeometryToWGS84(geometry);
        } catch (error) {
            console.error('Error projecting geometry to WGS84:', error);
            return null;
        }
    };
    private convertGeometryToWGS84 = (geometry: any): any | null => {
        geometry = _mdpDensifyIfCurve(geometry);
        const mapSR = geometry.spatialReference;

        if (!mapSR) {
            console.warn('No spatial reference found, assuming WGS84');
            return geometry;
        }

        // If already WGS84, return as-is
        if (mapSR.wkid === 4326) {
            return geometry;
        }

        try {
            switch (geometry.type) {
                case 'point':
                    const point = geometry as any;
                    const convertedCoords = this.convertCoordinateManually(point.x, point.y, mapSR.wkid);

                    return {
                        type: 'point',
                        x: convertedCoords.lon,
                        y: convertedCoords.lat,
                        longitude: convertedCoords.lon,
                        latitude: convertedCoords.lat,
                        spatialReference: { wkid: 4326 }
                    } as any;

                case 'polyline':
                    const polyline = geometry as any;
                    const convertedPaths = polyline.paths.map(path =>
                        path.map(coord => {
                            const converted = this.convertCoordinateManually(coord[0], coord[1], mapSR.wkid);
                            return [converted.lon, converted.lat];
                        })
                    );

                    return {
                        type: 'polyline',
                        paths: convertedPaths,
                        spatialReference: { wkid: 4326 }
                    } as any;

                case 'polygon':
                    const polygon = geometry as any;
                    const convertedRings = polygon.rings.map(ring =>
                        ring.map(coord => {
                            const converted = this.convertCoordinateManually(coord[0], coord[1], mapSR.wkid);
                            return [converted.lon, converted.lat];
                        })
                    );

                    return {
                        type: 'polygon',
                        rings: convertedRings,
                        spatialReference: { wkid: 4326 }
                    } as any;

                case 'extent':
                    const extent = geometry as any;
                    const sw = this.convertCoordinateManually(extent.xmin, extent.ymin, mapSR.wkid);
                    const ne = this.convertCoordinateManually(extent.xmax, extent.ymax, mapSR.wkid);

                    return {
                        type: 'extent',
                        xmin: sw.lon,
                        ymin: sw.lat,
                        xmax: ne.lon,
                        ymax: ne.lat,
                        spatialReference: { wkid: 4326 }
                    } as any;

                default:
                    console.warn(`Cannot convert geometry type: ${geometry.type}`);
                    return null;
            }
        } catch (error) {
            console.error('Error in geometry conversion:', error);
            return null;
        }
    };
    private convertCoordinateManually = (x: number, y: number, wkid: number): { lon: number; lat: number } => {
        //console.log(`Converting coordinates: ${x}, ${y} from WKID: ${wkid}`);

        // Web Mercator
        if (wkid === 3857 || wkid === 102100) {
            const lon = (x / 20037508.34) * 180;
            const lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
            return { lon, lat };
        }

        // UTM zones
        if (wkid >= 32601 && wkid <= 32660) {
            // UTM North
            const zone = wkid - 32600;
            const centralMeridian = (zone - 1) * 6 - 180 + 3;
            const roughLon = centralMeridian + (x - 500000) / 111320;
            const roughLat = y / 110540;
            return {
                lon: Math.max(-180, Math.min(180, roughLon)),
                lat: Math.max(-90, Math.min(90, roughLat))
            };
        }

        if (wkid >= 32701 && wkid <= 32760) {
            // UTM South
            const zone = wkid - 32700;
            const centralMeridian = (zone - 1) * 6 - 180 + 3;
            const roughLon = centralMeridian + (x - 500000) / 111320;
            const roughLat = (y - 10000000) / 110540;
            return {
                lon: Math.max(-180, Math.min(180, roughLon)),
                lat: Math.max(-90, Math.min(90, roughLat))
            };
        }

        // State Plane Coordinate Systems (rough approximations based on WKID ranges)
        // These are approximate conversions - for production use, proper projection libraries would be better

        // State Plane zones typically have large coordinate values
        if (wkid >= 2001 && wkid <= 5000) {
            // Most State Plane coordinate systems
            let scale = 1;
            let offsetX = 0;
            let offsetY = 0;

            // Determine if coordinates are in feet or meters based on magnitude
            const isFeet = Math.abs(x) > 1000000 || Math.abs(y) > 1000000;

            if (isFeet) {
                // Convert feet to meters first
                scale = 0.3048;
            }

            // Very rough conversion - this is not geodetically accurate
            // but provides a starting point for State Plane coordinates
            const meterX = x * scale;
            const meterY = y * scale;

            // Rough approximation: assume coordinates are relative to a central point
            // This is highly approximate and location-dependent
            let roughLon = meterX / 111320; // meters per degree longitude at equator
            let roughLat = meterY / 110540; // meters per degree latitude

            // Try to determine approximate region based on WKID
            if (wkid >= 2001 && wkid <= 2099) {
                // NAD83 State Plane zones - generally US
                roughLon += -98; // Rough center longitude of US
                roughLat += 39;  // Rough center latitude of US
            } else if (wkid >= 3001 && wkid <= 3999) {
                // Other State Plane systems
                roughLon += -100;
                roughLat += 40;
            }

            return {
                lon: Math.max(-180, Math.min(180, roughLon)),
                lat: Math.max(-90, Math.min(90, roughLat))
            };
        }

        // If coordinates look like they might already be geographic
        if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
            return { lon: x, lat: y };
        }

        // Last resort: scale down large coordinates
        const scaleFactor = Math.max(Math.abs(x), Math.abs(y)) > 1000000 ? 0.000001 : 0.001;
        return {
            lon: Math.max(-180, Math.min(180, x * scaleFactor)),
            lat: Math.max(-90, Math.min(90, y * scaleFactor))
        };
    };
    private projectGeometryToWGS84Alternative = async (geometry: any): Promise<any | null> => {
        try {
            const wgs84SR = new SpatialReference({ wkid: 4326 });
            const geomWkid = geometry.spatialReference?.wkid;
            const geomLatestWkid = (geometry.spatialReference as any)?.latestWkid;
            const effectiveWkid = geomWkid || geomLatestWkid;

            // Already in WGS84 — return as-is
            if (effectiveWkid === 4326) return geometry;

            // Web Mercator → WGS84: synchronous, no WASM needed
            if (effectiveWkid === 3857 || effectiveWkid === 102100) {
                const result = webMercatorUtils.webMercatorToGeographic(geometry);
                if (result) return result;
            }

            // proj4 fallback (statically imported — always available)
            if (effectiveWkid && effectiveWkid !== 4326) {
                try {
                    const targetEpsg = `EPSG:${effectiveWkid}`;
                    const transform = proj4(targetEpsg, 'EPSG:4326');

                    if (geometry.type === 'point') {
                        const [lon, lat] = transform.forward([geometry.x, geometry.y]);
                        return new Point({ x: lon, y: lat, spatialReference: wgs84SR });
                    } else if (geometry.type === 'polyline') {
                        const newPaths = geometry.paths.map((path: number[][]) =>
                            path.map((pt: number[]) => transform.forward(pt))
                        );
                        return new Polyline({ paths: newPaths, spatialReference: wgs84SR });
                    } else if (geometry.type === 'polygon') {
                        const newRings = geometry.rings.map((ring: number[][]) =>
                            ring.map((pt: number[]) => transform.forward(pt))
                        );
                        return new Polygon({ rings: newRings, spatialReference: wgs84SR });
                    } else if (geometry.type === 'extent') {
                        const [xmin, ymin] = transform.forward([geometry.xmin, geometry.ymin]);
                        const [xmax, ymax] = transform.forward([geometry.xmax, geometry.ymax]);
                        return { type: 'extent', xmin, ymin, xmax, ymax, spatialReference: wgs84SR };
                    }
                } catch (proj4Error) {
                    console.warn('proj4 WGS84 export failed:', proj4Error);
                }
            }

            // Last resort: return the geometry; convertToStandardGeoJSON will null-check
            console.warn('All WGS84 projection attempts failed for WKID', effectiveWkid);
            return this.manualProjectionFallback(geometry);

        } catch (error) {
            console.error('Error projecting geometry to WGS84:', error);
            return this.manualProjectionFallback(geometry);
        }
    };
    // inside your class component (fields)


    private manualProjectionFallback = (geometry: any): any | null => {
        geometry = _mdpDensifyIfCurve(geometry);
        const mapSR = geometry.spatialReference;

        if (!mapSR) {
            console.warn('No spatial reference found, assuming WGS84');
            return geometry;
        }

        try {
            switch (geometry.type) {
                case 'point':
                    const point = geometry as any;
                    const convertedCoords = this.convertCoordinateManually(point.x, point.y, mapSR.wkid);

                    return new Point({
                        longitude: convertedCoords.lon,
                        latitude: convertedCoords.lat,
                        spatialReference: { wkid: 4326 }
                    });

                case 'polyline':
                    const polyline = geometry as any;
                    const convertedPaths = polyline.paths.map(path =>
                        path.map(coord => {
                            const converted = this.convertCoordinateManually(coord[0], coord[1], mapSR.wkid);
                            return [converted.lon, converted.lat];
                        })
                    );

                    return {
                        type: 'polyline',
                        paths: convertedPaths,
                        spatialReference: { wkid: 4326 }
                    } as any;

                case 'polygon':
                    const polygon = geometry as any;
                    const convertedRings = polygon.rings.map(ring =>
                        ring.map(coord => {
                            const converted = this.convertCoordinateManually(coord[0], coord[1], mapSR.wkid);
                            return [converted.lon, converted.lat];
                        })
                    );

                    return {
                        type: 'polygon',
                        rings: convertedRings,
                        spatialReference: { wkid: 4326 }
                    } as any;

                case 'extent':
                    const extent = geometry as any;
                    const sw = this.convertCoordinateManually(extent.xmin, extent.ymin, mapSR.wkid);
                    const ne = this.convertCoordinateManually(extent.xmax, extent.ymax, mapSR.wkid);

                    return {
                        type: 'extent',
                        xmin: sw.lon,
                        ymin: sw.lat,
                        xmax: ne.lon,
                        ymax: ne.lat,
                        spatialReference: { wkid: 4326 }
                    } as any;

                default:
                    console.warn(`Cannot manually convert geometry type: ${geometry.type}`);
                    return null;
            }
        } catch (error) {
            console.error('Error in manual projection fallback:', error);
            return null;
        }
    };
    private convertToStandardGeoJSON = async (geometry: any): Promise<any> => {
        if (!geometry) {
            console.warn('No geometry provided');
            return null;
        }

        // console.log('Converting geometry:', {
        //   type: geometry.type,
        //   spatialReference: geometry.spatialReference?.wkid
        // });

        try {
            // Use the existing projection method
            const wgs84Geometry = await this.projectGeometryToWGS84Alternative(geometry);

            if (!wgs84Geometry) {
                console.warn('Failed to convert geometry to WGS84');
                return null;
            }

            // Now convert to GeoJSON
            switch (wgs84Geometry.type) {
                case 'point':
                    const point = wgs84Geometry as any;
                    const lon = point.longitude || point.x;
                    const lat = point.latitude || point.y;

                    //console.log(`Point converted to: ${lon}, ${lat}`);

                    if (!this.isValidCoordinate(lon, lat)) {
                        console.warn(`Invalid point coordinates: ${lon}, ${lat}`);
                        return null;
                    }

                    return {
                        type: 'Point',
                        coordinates: [Number(lon.toFixed(8)), Number(lat.toFixed(8))]
                    };

                case 'polyline':
                    const polyline = wgs84Geometry as any;
                    const paths = [];

                    for (const path of polyline.paths) {
                        const convertedPath = [];
                        for (const coord of path) {
                            const lon = coord[0];
                            const lat = coord[1];
                            if (this.isValidCoordinate(lon, lat)) {
                                convertedPath.push([Number(lon.toFixed(8)), Number(lat.toFixed(8))]);
                            }
                        }
                        if (convertedPath.length > 1) {
                            paths.push(convertedPath);
                        }
                    }

                    if (paths.length === 0) return null;

                    return {
                        type: paths.length === 1 ? 'LineString' : 'MultiLineString',
                        coordinates: paths.length === 1 ? paths[0] : paths
                    };

                case 'polygon':
                    const polygon = wgs84Geometry as any;
                    const rings = [];

                    for (const ring of polygon.rings) {
                        const convertedRing = [];
                        for (const coord of ring) {
                            const lon = coord[0];
                            const lat = coord[1];
                            if (this.isValidCoordinate(lon, lat)) {
                                convertedRing.push([Number(lon.toFixed(8)), Number(lat.toFixed(8))]);
                            }
                        }
                        if (convertedRing.length > 3) {
                            const first = convertedRing[0];
                            const last = convertedRing[convertedRing.length - 1];
                            if (first[0] !== last[0] || first[1] !== last[1]) {
                                convertedRing.push([first[0], first[1]]);
                            }
                            rings.push(convertedRing);
                        }
                    }

                    //console.log(`Polygon converted with ${rings.length} rings`);

                    if (rings.length === 0) return null;

                    return {
                        type: 'Polygon',
                        coordinates: rings
                    };

                case 'extent':
                    const extent = wgs84Geometry as any;

                    return {
                        type: 'Polygon',
                        coordinates: [[
                            [Number(extent.xmin.toFixed(8)), Number(extent.ymin.toFixed(8))],
                            [Number(extent.xmax.toFixed(8)), Number(extent.ymin.toFixed(8))],
                            [Number(extent.xmax.toFixed(8)), Number(extent.ymax.toFixed(8))],
                            [Number(extent.xmin.toFixed(8)), Number(extent.ymax.toFixed(8))],
                            [Number(extent.xmin.toFixed(8)), Number(extent.ymin.toFixed(8))]
                        ]]
                    };

                default:
                    console.warn(`Unsupported geometry type: ${wgs84Geometry.type}`);
                    return null;
            }
        } catch (error) {
            console.error('Error converting geometry:', error);
            return null;
        }
    };
    private manualProjectionFallbackEnhanced = (geometry: any): any | null => {
        geometry = _mdpDensifyIfCurve(geometry);
        const mapSR = geometry.spatialReference;

        if (!mapSR) {
            console.warn('No spatial reference found, assuming WGS84');
            return geometry;
        }

        //console.log(`Enhanced manual conversion from WKID: ${mapSR.wkid}`);

        try {
            switch (geometry.type) {
                case 'point':
                    const point = geometry as any;
                    const convertedCoords = this.convertCoordinateManuallyEnhanced(point.x, point.y, mapSR.wkid);

                    return new Point({
                        longitude: convertedCoords.lon,
                        latitude: convertedCoords.lat,
                        spatialReference: { wkid: 4326 }
                    });

                case 'polyline':
                    const polyline = geometry as any;
                    const convertedPaths = polyline.paths.map(path =>
                        path.map(coord => {
                            const converted = this.convertCoordinateManuallyEnhanced(coord[0], coord[1], mapSR.wkid);
                            return [converted.lon, converted.lat];
                        })
                    );

                    return {
                        type: 'polyline',
                        paths: convertedPaths,
                        spatialReference: { wkid: 4326 }
                    } as any;

                case 'polygon':
                    const polygon = geometry as any;
                    const convertedRings = polygon.rings.map(ring =>
                        ring.map(coord => {
                            const converted = this.convertCoordinateManuallyEnhanced(coord[0], coord[1], mapSR.wkid);
                            return [converted.lon, converted.lat];
                        })
                    );

                    return {
                        type: 'polygon',
                        rings: convertedRings,
                        spatialReference: { wkid: 4326 }
                    } as any;

                case 'extent':
                    const extent = geometry as any;
                    const sw = this.convertCoordinateManuallyEnhanced(extent.xmin, extent.ymin, mapSR.wkid);
                    const ne = this.convertCoordinateManuallyEnhanced(extent.xmax, extent.ymax, mapSR.wkid);

                    return {
                        type: 'extent',
                        xmin: sw.lon,
                        ymin: sw.lat,
                        xmax: ne.lon,
                        ymax: ne.lat,
                        spatialReference: { wkid: 4326 }
                    } as any;

                default:
                    console.warn(`Cannot manually convert geometry type: ${geometry.type}`);
                    return null;
            }
        } catch (error) {
            console.error('Error in enhanced manual projection fallback:', error);
            return null;
        }
    };
    private convertCoordinateManuallyEnhanced = (x: number, y: number, wkid: number): { lon: number; lat: number } => {
        //console.log(`Converting coordinates: ${x}, ${y} from WKID: ${wkid}`);

        // Web Mercator (most common)
        if (wkid === 3857 || wkid === 102100) {
            const lon = (x / 20037508.34) * 180;
            const lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
            return {
                lon: Math.max(-180, Math.min(180, lon)),
                lat: Math.max(-90, Math.min(90, lat))
            };
        }

        // UTM zones (Northern Hemisphere)
        if (wkid >= 32601 && wkid <= 32660) {
            const zone = wkid - 32600;
            const centralMeridian = (zone - 1) * 6 - 180 + 3;

            // More accurate UTM to Geographic conversion
            const k0 = 0.9996; // UTM scale factor
            const e = 0.00669438; // Earth's eccentricity squared
            const e1sq = e / (1 - e);
            const a = 6378137; // Earth's radius in meters

            const x1 = x - 500000; // Remove false easting
            const y1 = y; // Keep northing as-is for northern hemisphere

            // Rough conversion (simplified)
            const roughLat = y1 / 110540; // meters per degree latitude
            const roughLon = centralMeridian + (x1 / (111320 * Math.cos(roughLat * Math.PI / 180)));

            return {
                lon: Math.max(-180, Math.min(180, roughLon)),
                lat: Math.max(-90, Math.min(90, roughLat))
            };
        }

        // UTM zones (Southern Hemisphere)
        if (wkid >= 32701 && wkid <= 32760) {
            const zone = wkid - 32700;
            const centralMeridian = (zone - 1) * 6 - 180 + 3;

            const x1 = x - 500000; // Remove false easting
            const y1 = y - 10000000; // Remove false northing for southern hemisphere

            const roughLat = y1 / 110540; // meters per degree latitude
            const roughLon = centralMeridian + (x1 / (111320 * Math.cos(Math.abs(roughLat) * Math.PI / 180)));

            return {
                lon: Math.max(-180, Math.min(180, roughLon)),
                lat: Math.max(-90, Math.min(90, roughLat))
            };
        }

        // State Plane Coordinate Systems - Enhanced with more specific conversions
        if (wkid >= 2001 && wkid <= 5000) {
            let scale = 1;
            let centerLon = -98; // Default US center longitude
            let centerLat = 39;  // Default US center latitude

            // Better detection of units (feet vs meters)
            const isFeet = Math.abs(x) > 1000000 || Math.abs(y) > 1000000;
            if (isFeet) {
                scale = 0.3048; // Convert feet to meters
            }

            // Regional adjustments based on WKID ranges
            if (wkid >= 2001 && wkid <= 2099) {
                // NAD83 State Plane zones
                if (wkid >= 2001 && wkid <= 2020) {
                    // Eastern US states
                    centerLon = -77;
                    centerLat = 40;
                } else if (wkid >= 2021 && wkid <= 2050) {
                    // Central US states
                    centerLon = -95;
                    centerLat = 35;
                } else if (wkid >= 2051 && wkid <= 2099) {
                    // Western US states
                    centerLon = -115;
                    centerLat = 37;
                }
            }

            // More accurate State Plane conversion
            const meterX = x * scale;
            const meterY = y * scale;

            // Improved conversion accounting for Earth's curvature
            const latRadians = centerLat * Math.PI / 180;
            const metersPerDegreeLon = 111320 * Math.cos(latRadians);

            const deltaLon = meterX / metersPerDegreeLon;
            const deltaLat = meterY / 110540;

            const finalLon = centerLon + deltaLon;
            const finalLat = centerLat + deltaLat;

            return {
                lon: Math.max(-180, Math.min(180, finalLon)),
                lat: Math.max(-90, Math.min(90, finalLat))
            };
        }

        // Additional common coordinate systems

        // British National Grid (EPSG:27700)
        if (wkid === 27700) {
            // Rough conversion for British National Grid
            // This is a very approximate conversion - for production use a proper transformation library
            const centerLon = -2; // Approximate center of UK
            const centerLat = 54;

            const deltaLon = (x - 400000) / 70000; // Very rough approximation
            const deltaLat = (y - 100000) / 110000;

            return {
                lon: Math.max(-180, Math.min(180, centerLon + deltaLon)),
                lat: Math.max(-90, Math.min(90, centerLat + deltaLat))
            };
        }

        // If coordinates already look like geographic coordinates
        if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
            return { lon: x, lat: y };
        }

        // Last resort: intelligent scaling based on coordinate magnitude
        let scaleFactor = 1;
        const maxCoord = Math.max(Math.abs(x), Math.abs(y));

        if (maxCoord > 10000000) {
            scaleFactor = 0.0000001; // Very large coordinates
        } else if (maxCoord > 1000000) {
            scaleFactor = 0.000001;  // Large coordinates (likely state plane feet)
        } else if (maxCoord > 100000) {
            scaleFactor = 0.00001;   // Medium coordinates
        } else if (maxCoord > 10000) {
            scaleFactor = 0.001;     // Smaller coordinates
        }

        const scaledLon = x * scaleFactor;
        const scaledLat = y * scaleFactor;

        // Apply regional offset if coordinates are too far from expected geographic ranges
        let finalLon = scaledLon;
        let finalLat = scaledLat;

        // If scaled coordinates are still way off, try to guess the region
        if (Math.abs(finalLon) > 180 || Math.abs(finalLat) > 90) {
            // Very rough regional guessing based on original coordinate magnitude and sign
            if (x > 0 && y > 0 && maxCoord > 100000) {
                // Likely Eastern hemisphere, northern region
                finalLon = -100 + (scaledLon % 60);
                finalLat = 40 + (scaledLat % 30);
            } else if (x < 0 && y > 0 && maxCoord > 100000) {
                // Likely Western hemisphere, northern region
                finalLon = -120 + (Math.abs(scaledLon) % 60);
                finalLat = 35 + (scaledLat % 30);
            } else {
                // Default to center of continental US
                finalLon = -98;
                finalLat = 39;
            }
        }

        //console.log(`Applied scaling factor ${scaleFactor} to coordinates, result: ${finalLon}, ${finalLat}`);

        return {
            lon: Math.max(-180, Math.min(180, finalLon)),
            lat: Math.max(-90, Math.min(90, finalLat))
        };
    };
    private projectGeometryFromWGS84 = async (wgs84Geometry: any, targetSR: any): Promise<any | null> => {
        try {
            const targetWkid = targetSR?.wkid || (targetSR as any)?.latestWkid;

            // Fast path: WGS84 → Web Mercator (synchronous, no WASM needed)
            if (targetWkid === 3857 || targetWkid === 102100) {
                const result = webMercatorUtils.geographicToWebMercator(wgs84Geometry);
                if (result) return result;
            }

            // proj4 fallback — accurate for any EPSG code, no WASM needed
            if (targetWkid && targetWkid !== 4326) {
                try {
                    const transform = proj4('EPSG:4326', `EPSG:${targetWkid}`);
                    const projectCoord = (lon: number, lat: number) => {
                        const [x, y] = transform.forward([lon, lat]);
                        return { x, y };
                    };

                    switch (wgs84Geometry.type) {
                        case 'point': {
                            const lon = wgs84Geometry.longitude ?? wgs84Geometry.x;
                            const lat = wgs84Geometry.latitude ?? wgs84Geometry.y;
                            const { x, y } = projectCoord(lon, lat);
                            return new Point({ x, y, spatialReference: targetSR });
                        }
                        case 'polyline': {
                            const paths = wgs84Geometry.paths.map((path: number[][]) =>
                                path.map((coord: number[]) => {
                                    const { x, y } = projectCoord(coord[0], coord[1]);
                                    return [x, y];
                                })
                            );
                            return { type: 'polyline', paths, spatialReference: targetSR } as any;
                        }
                        case 'polygon': {
                            const rings = wgs84Geometry.rings.map((ring: number[][]) =>
                                ring.map((coord: number[]) => {
                                    const { x, y } = projectCoord(coord[0], coord[1]);
                                    return [x, y];
                                })
                            );
                            return { type: 'polygon', rings, spatialReference: targetSR } as any;
                        }
                    }
                } catch (proj4Error) {
                    console.warn('proj4 fallback failed, using mathematical approximation:', proj4Error);
                }
            }

            // Last resort: mathematical approximation (handles UTM, Web Mercator, State Plane)
            return this.manualProjectionFromWGS84(wgs84Geometry, targetSR);

        } catch (error) {
            console.error('Error projecting from WGS84:', error);
            return this.manualProjectionFromWGS84(wgs84Geometry, targetSR);
        }
    };
    private manualProjectionFromWGS84 = (wgs84Geometry: any, targetSR: any): any | null => {
        if (!targetSR || targetSR.wkid === 4326) {
            return wgs84Geometry; // Already in WGS84
        }

        try {
            switch (wgs84Geometry.type) {
                case 'point':
                    const point = wgs84Geometry as any;
                    const lon = point.longitude || point.x;
                    const lat = point.latitude || point.y;
                    const converted = this.convertFromWGS84Enhanced(lon, lat, targetSR.wkid);

                    return new Point({
                        x: converted.x,
                        y: converted.y,
                        spatialReference: targetSR
                    });

                case 'polyline':
                    const polyline = wgs84Geometry as any;
                    const convertedPaths = polyline.paths.map(path =>
                        path.map(coord => {
                            const converted = this.convertFromWGS84Enhanced(coord[0], coord[1], targetSR.wkid);
                            return [converted.x, converted.y];
                        })
                    );

                    return {
                        type: 'polyline',
                        paths: convertedPaths,
                        spatialReference: targetSR
                    } as any;

                case 'polygon':
                    const polygon = wgs84Geometry as any;
                    const convertedRings = polygon.rings.map(ring =>
                        ring.map(coord => {
                            const converted = this.convertFromWGS84Enhanced(coord[0], coord[1], targetSR.wkid);
                            return [converted.x, converted.y];
                        })
                    );

                    return {
                        type: 'polygon',
                        rings: convertedRings,
                        spatialReference: targetSR
                    } as any;

                default:
                    console.warn(`Cannot project geometry type: ${wgs84Geometry.type}`);
                    return null;
            }
        } catch (error) {
            console.error('Error in manual projection from WGS84:', error);
            return null;
        }
    };
    private convertFromWGS84Enhanced = (lon: number, lat: number, wkid: number): { x: number; y: number } => {
        // If target is WGS84, return as-is
        if (wkid === 4326) {
            return { x: lon, y: lat };
        }

        //console.log(`Converting WGS84 coordinates ${lon}, ${lat} to WKID: ${wkid}`);

        // Web Mercator
        if (wkid === 3857 || wkid === 102100) {
            const x = lon * 20037508.34 / 180;
            const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
            return { x, y };
        }

        // UTM zones (Northern Hemisphere)
        if (wkid >= 32601 && wkid <= 32660) {
            const zone = wkid - 32600;
            const centralMeridian = (zone - 1) * 6 - 180 + 3;

            // More accurate WGS84 to UTM conversion
            const latRad = lat * Math.PI / 180;
            const lonRad = lon * Math.PI / 180;
            const centralMeridianRad = centralMeridian * Math.PI / 180;

            // Simplified UTM projection (not geodetically perfect but much better than linear)
            const k0 = 0.9996; // UTM scale factor
            const a = 6378137; // Earth's radius in meters
            const e = 0.00669438; // Earth's eccentricity squared

            const N = a / Math.sqrt(1 - e * Math.sin(latRad) * Math.sin(latRad));
            const T = Math.tan(latRad) * Math.tan(latRad);
            const C = e * Math.cos(latRad) * Math.cos(latRad) / (1 - e);
            const A = Math.cos(latRad) * (lonRad - centralMeridianRad);

            const x = 500000 + k0 * N * (A + (1 - T + C) * A * A * A / 6);
            const y = k0 * (a * (lat * Math.PI / 180) + N * Math.tan(latRad) * (A * A / 2));

            return { x, y };
        }

        // UTM zones (Southern Hemisphere)
        if (wkid >= 32701 && wkid <= 32760) {
            const zone = wkid - 32700;
            const centralMeridian = (zone - 1) * 6 - 180 + 3;

            // Similar to northern hemisphere but with false northing
            const latRad = lat * Math.PI / 180;
            const lonRad = lon * Math.PI / 180;
            const centralMeridianRad = centralMeridian * Math.PI / 180;

            const k0 = 0.9996;
            const a = 6378137;
            const e = 0.00669438;

            const N = a / Math.sqrt(1 - e * Math.sin(latRad) * Math.sin(latRad));
            const T = Math.tan(latRad) * Math.tan(latRad);
            const C = e * Math.cos(latRad) * Math.cos(latRad) / (1 - e);
            const A = Math.cos(latRad) * (lonRad - centralMeridianRad);

            const x = 500000 + k0 * N * (A + (1 - T + C) * A * A * A / 6);
            const y = 10000000 + k0 * (a * (lat * Math.PI / 180) + N * Math.tan(latRad) * (A * A / 2));

            return { x, y };
        }

        // State Plane Coordinate Systems - Enhanced reverse conversion
        if (wkid >= 2001 && wkid <= 5000) {
            let centerLon = -98; // Default US center longitude
            let centerLat = 39;  // Default US center latitude
            let usesFeet = false;

            // Regional adjustments based on WKID ranges (approximate)
            if (wkid >= 2001 && wkid <= 2020) {
                // Eastern US states
                centerLon = -77;
                centerLat = 40;
                usesFeet = true; // Many eastern state plane systems use feet
            } else if (wkid >= 2021 && wkid <= 2050) {
                // Central US states
                centerLon = -95;
                centerLat = 35;
                usesFeet = true;
            } else if (wkid >= 2051 && wkid <= 2099) {
                // Western US states
                centerLon = -115;
                centerLat = 37;
                usesFeet = false; // Many western systems use meters
            }

            // Calculate deltas from regional center
            const deltaLon = lon - centerLon;
            const deltaLat = lat - centerLat;

            // Convert to approximate projected coordinates
            const latRadians = centerLat * Math.PI / 180;
            const metersPerDegreeLon = 111320 * Math.cos(latRadians);

            let x = deltaLon * metersPerDegreeLon;
            let y = deltaLat * 110540;

            // Convert to feet if the system uses feet
            if (usesFeet) {
                x = x / 0.3048;
                y = y / 0.3048;
            }

            // Add typical state plane false easting/northing
            x += usesFeet ? 2000000 : 500000; // Typical false easting
            y += usesFeet ? 0 : 0; // Most don't have false northing

            return { x, y };
        }

        // British National Grid (EPSG:27700) - reverse conversion
        if (wkid === 27700) {
            const centerLon = -2;
            const centerLat = 54;

            const deltaLon = lon - centerLon;
            const deltaLat = lat - centerLat;

            const x = 400000 + deltaLon * 70000; // Very rough approximation
            const y = 100000 + deltaLat * 110000;

            return { x, y };
        }

        // Default fallback - assume a local coordinate system
        // Try to scale appropriately based on the WKID
        let scaleFactor = 111320; // Approximate meters per degree at equator
        let falseEasting = 0;
        let falseNorthing = 0;

        // For high WKID numbers, assume they might be in feet
        if (wkid > 10000) {
            scaleFactor = scaleFactor / 0.3048; // Convert to feet
            falseEasting = 2000000; // Common false easting in feet
        }

        const x = falseEasting + (lon + 180) * scaleFactor / 360; // Normalize longitude
        const y = falseNorthing + lat * scaleFactor / 90; // Normalize latitude

        //console.log(`Applied fallback conversion with scale factor ${scaleFactor}`);

        return { x, y };
    };
    private backdropClickPrimed = false;
    private saveNotesDialogSize = () => {
        const el = this.notesDialogRef.current;
        if (!el) return;
        this.setState({
            notesDialogWidth: el.offsetWidth,
            notesDialogHeight: el.offsetHeight
        });
    };
    private processNewMeasurementLabel = (graphic: any): boolean => {
        // Check if this is a measurement label that needs processing
        if (!graphic ||
            !graphic.attributes ||
            !graphic.attributes.isMeasurementLabel ||
            !graphic.symbol ||
            graphic.symbol.type !== 'text') {
            return false;
        }

        const graphicId = this.getGraphicId(graphic);

        // Skip if already processed
        if (this.processedMeasurementGraphics.has(graphicId)) {
            return false;
        }

        try {
            // Store the text content
            const labelText = graphic.symbol.text;

            // FIXED: Instead of creating a completely new symbol, preserve the existing symbol
            // and only update it if it's missing essential properties
            const existingSymbol = graphic.symbol as any;

            // Check if the symbol already has proper styling - if so, don't modify it
            if (existingSymbol.color &&
                existingSymbol.font &&
                existingSymbol.haloColor !== undefined &&
                existingSymbol.haloSize !== undefined) {

                // Symbol is already properly styled, just mark as processed
                this.processedMeasurementGraphics.add(graphicId);
                if (!graphic.attributes) graphic.attributes = {};
                graphic.attributes._styleFixed = true;

                //console.log(`Measurement label already properly styled, skipping: ${graphicId}`);
                return true;
            }

            // Only apply clean symbol if the existing symbol is missing essential properties
            // This preserves styling from the measure.tsx component
            const cleanSymbol = existingSymbol.clone();

            // Only set defaults for missing properties
            if (!cleanSymbol.color) {
                cleanSymbol.color = new Color([0, 0, 0, 1]);
            }

            if (!cleanSymbol.font || !cleanSymbol.font.family) {
                cleanSymbol.font = new Font({
                    family: cleanSymbol.font?.family || "Arial",
                    size: cleanSymbol.font?.size || 12,
                    weight: cleanSymbol.font?.weight || "normal",
                    style: cleanSymbol.font?.style || "normal",
                    decoration: cleanSymbol.font?.decoration || "none"
                });
            }

            // Preserve existing halo settings or set defaults only if they don't exist
            if (cleanSymbol.haloColor === null && cleanSymbol.haloSize === null) {
                // Only set default halo if none exists
                cleanSymbol.haloColor = new Color([255, 255, 255, 1]);
                cleanSymbol.haloSize = 2;
            }

            if (!cleanSymbol.horizontalAlignment) {
                cleanSymbol.horizontalAlignment = "center";
            }

            if (!cleanSymbol.verticalAlignment) {
                cleanSymbol.verticalAlignment = "middle";
            }

            // Ensure text content is preserved
            cleanSymbol.text = labelText;

            // Replace the symbol only if we made changes
            graphic.symbol = cleanSymbol;

            // Mark this graphic as processed
            this.processedMeasurementGraphics.add(graphicId);

            // Also set the flag on the graphic itself as a backup
            if (!graphic.attributes) graphic.attributes = {};
            graphic.attributes._styleFixed = true;

            //console.log(`Applied minimal clean symbol to measurement label with ID: ${graphicId}`);
            return true;
        } catch (error) {
            console.error('Error processing measurement label:', error);
            return false;
        }
    };
    private verifyLayerState = () => {
        if (!this.props.graphicsLayer) return;

        // Count actual drawings (exclude measurement labels)
        const layerGraphics = this.props.graphicsLayer.graphics.toArray();
        const actualDrawings = layerGraphics.filter(g =>
            !g.attributes?.isMeasurementLabel &&
            !g.attributes?.hideFromList
        );

        const measurementLabels = layerGraphics.filter(g =>
            g.attributes?.isMeasurementLabel
        );

        //console.log(`📈 Layer verification:`);
        //console.log(`   - Drawings in state: ${this.state.drawings.length}`);
        //console.log(`   - Actual drawings in layer: ${actualDrawings.length}`);
        //console.log(`   - Measurement labels in layer: ${measurementLabels.length}`);
        //console.log(`   - Total graphics in layer: ${layerGraphics.length}`);

        // If there's a mismatch, force a refresh
        if (actualDrawings.length !== this.state.drawings.length) {
            console.warn(`⚠️ State mismatch detected! Forcing refresh...`);
            this.refreshDrawingsFromLayer();
        } else {
            //console.log(`✅ Layer state verified - everything matches`);
        }
    }
    private removeMeasurementLabels = (graphic: ExtendedGraphic) => {
        if (!graphic || !this.props.graphicsLayer) return;

        //console.log(`🧹 Starting measurement cleanup for:`, graphic.attributes?.name);

        try {
            const graphicUniqueId = graphic.attributes?.uniqueId;
            let removedCount = 0;

            // 🔧 NEW: Remove attached buffer FIRST
            if (graphic.bufferGraphic) {
                //console.log(`🗑️ Removing attached buffer for graphic ${graphicUniqueId}`);
                this.props.graphicsLayer.remove(graphic.bufferGraphic);
                graphic.bufferGraphic = null;
                removedCount++;
            }

            // Clear buffer settings
            if (graphic.bufferSettings) {
                graphic.bufferSettings = null;
            }

            // Remove the buffer geometry watcher associated with this parent
            // (set up in recreateAttachedBuffer). Without this the watcher leaks
            // across unmount and accumulates over long sessions.
            if (graphicUniqueId) {
                const bw = (this as any)._bufferWatchers;
                if (bw && bw[graphicUniqueId]) {
                    try { bw[graphicUniqueId].remove(); } catch { /* no-op */ }
                    delete bw[graphicUniqueId];
                }
            }

            // Get all graphics from the layer
            const allGraphics = this.props.graphicsLayer.graphics.toArray();

            // Find measurement labels that belong to this specific graphic
            const labelsToRemove = allGraphics.filter(g => {
                const gAsExtended = g as ExtendedGraphic;

                // Check if this is a measurement label
                if (!gAsExtended.attributes?.isMeasurementLabel) return false;

                // Check various ways this label might be linked to our graphic
                return (
                    // Direct reference to the graphic object
                    gAsExtended.measureParent === graphic ||
                    // Parent ID matches
                    (graphicUniqueId && gAsExtended.attributes?.parentGraphicId === graphicUniqueId) ||
                    // Measure graphic reference
                    gAsExtended.measure?.graphic === graphic
                );
            });

            //console.log(`🔍 Found ${labelsToRemove.length} measurement labels to remove`);

            // Remove each identified label
            labelsToRemove.forEach(label => {
                try {
                    this.props.graphicsLayer.remove(label);
                    removedCount++;
                    //console.log(`🗑️ Removed measurement label`);
                } catch (err) {
                    console.error(`❌ Error removing measurement label:`, err);
                }
            });

            // Also clean up direct references stored in the graphic
            if (graphic.measure?.graphic) {
                try {
                    this.props.graphicsLayer.remove(graphic.measure.graphic);
                    removedCount++;
                    //console.log(`🗑️ Removed direct measure graphic`);
                } catch (err) {
                    console.error(`❌ Error removing direct measure graphic:`, err);
                }
            }

            // Clean up segment labels from attributes
            if (graphic.attributes?.relatedSegmentLabels && Array.isArray(graphic.attributes.relatedSegmentLabels)) {
                graphic.attributes.relatedSegmentLabels.forEach(segmentLabel => {
                    if (segmentLabel) {
                        try {
                            this.props.graphicsLayer.remove(segmentLabel);
                            removedCount++;
                            //console.log(`🗑️ Removed segment label`);
                        } catch (err) {
                            console.error(`❌ Error removing segment label:`, err);
                        }
                    }
                });
            }

            // 🔧 FIX: Clear all measurement-related references and flags from the graphic
            // This prevents the system from thinking the graphic still has measurements
            if (graphic.measure) {
                graphic.measure = null;
            }
            if (graphic.attributes) {
                // Clear the arrays (don't just empty them, set to empty array to avoid null checks)
                if (graphic.attributes.relatedSegmentLabels) {
                    graphic.attributes.relatedSegmentLabels = [];
                }
                if (graphic.attributes.relatedMeasurementLabels) {
                    graphic.attributes.relatedMeasurementLabels = [];
                }
                // Clear the flags that indicate this graphic had measurements
                // This prevents the system from trying to recreate them
                delete graphic.attributes.hadMeasurements;
                delete graphic.attributes.measurementsPermanent;
            }

            //console.log(`✅ Measurement and buffer cleanup completed. Removed ${removedCount} graphics for:`, graphic.attributes?.name);

        } catch (error) {
            console.error('❌ Error in measurement cleanup:', error);
        }
    };
    private associateMeasurementLabel = (parentGraphic: ExtendedGraphic, measurementLabel: ExtendedGraphic) => {
        if (!parentGraphic || !measurementLabel) return;

        // Ensure the measurement label has proper references to its parent
        if (!measurementLabel.attributes) {
            measurementLabel.attributes = {};
        }

        // Store multiple references to ensure we can find this label later
        measurementLabel.attributes.isMeasurementLabel = true;
        measurementLabel.attributes.parentGraphicId = parentGraphic.attributes?.uniqueId;
        measurementLabel.measureParent = parentGraphic;

        // Also store the reference in the parent graphic for easier cleanup
        if (!parentGraphic.attributes) {
            parentGraphic.attributes = {};
        }
        if (!parentGraphic.attributes.relatedMeasurementLabels) {
            parentGraphic.attributes.relatedMeasurementLabels = [];
        }
        parentGraphic.attributes.relatedMeasurementLabels.push(measurementLabel);

        // 🔧 CRITICAL FIX: Mark that this graphic was created with measurements
        // This flag persists through cancel() operations and localStorage save/restore
        parentGraphic.attributes.hadMeasurements = true;

        //console.log(`🔗 Associated measurement label with parent graphic:`, parentGraphic.attributes?.name);
    };

    /**
     * Updates the positions of all measurement labels associated with a graphic
     * This ensures labels move seamlessly with their parent graphics
     */
    private updateMeasurementLabelPositions = async (graphic: ExtendedGraphic) => {
        if (!graphic || !this.props.graphicsLayer) return;

        try {
            const graphicUniqueId = graphic.attributes?.uniqueId;
            //console.log('🔧 updateMeasurementLabelPositions called for:', graphicUniqueId, 'geometry type:', graphic.geometry?.type);

            // Find all measurement labels associated with this graphic
            const allGraphics = this.props.graphicsLayer.graphics.toArray();

            // 🔧 ENHANCED: More comprehensive search for measurement labels
            const measurementLabels = allGraphics.filter(g => {
                const gAsExtended = g as ExtendedGraphic;

                // Check if this is a measurement label
                if (!gAsExtended.attributes?.isMeasurementLabel) return false;

                // Check if it belongs to our graphic using multiple methods
                const belongsToGraphic = (
                    gAsExtended.measureParent === graphic ||
                    (graphicUniqueId && gAsExtended.attributes?.parentGraphicId === graphicUniqueId) ||
                    gAsExtended.measure?.graphic === graphic ||
                    // 🔧 NEW: Also check if the graphic's measure points to this label
                    (graphic as ExtendedGraphic).measure?.graphic === gAsExtended
                );

                return belongsToGraphic;
            });

            //console.log('🔧 Found', measurementLabels.length, 'measurement labels to update');

            // 🔧 NEW: If no labels found but graphic HAS measurements, try to rebuild associations
            if (measurementLabels.length === 0 && (graphic as ExtendedGraphic).measure?.graphic) {
                //console.log('🔧 Attempting to rebuild measurement label associations');
                const mainLabel = (graphic as ExtendedGraphic).measure.graphic;
                if (mainLabel && this.props.graphicsLayer.graphics.includes(mainLabel)) {
                    // Rebuild the association
                    (mainLabel as ExtendedGraphic).measureParent = graphic;
                    if (!mainLabel.attributes) mainLabel.attributes = {};
                    mainLabel.attributes.parentGraphicId = graphicUniqueId;
                    mainLabel.attributes.isMeasurementLabel = true;
                    mainLabel.attributes.hideFromList = true;

                    measurementLabels.push(mainLabel);
                    //console.log('✅ Rebuilt association for main measurement label');
                }
            }

            // 🔧 NEW: Also check for segment labels in graphic.attributes.relatedSegmentLabels
            if (graphic.attributes?.relatedSegmentLabels?.length > 0) {
                for (const segLabel of graphic.attributes.relatedSegmentLabels) {
                    if (segLabel && this.props.graphicsLayer.graphics.includes(segLabel)) {
                        // Ensure associations are set
                        (segLabel as ExtendedGraphic).measureParent = graphic;
                        if (!segLabel.attributes) segLabel.attributes = {};
                        segLabel.attributes.parentGraphicId = graphicUniqueId;
                        segLabel.attributes.isMeasurementLabel = true;
                        segLabel.attributes.hideFromList = true;

                        if (!measurementLabels.includes(segLabel)) {
                            measurementLabels.push(segLabel);
                            //console.log('✅ Added segment label from relatedSegmentLabels');
                        }
                    }
                }
            }

            //console.log('🔧 Final count:', measurementLabels.length, 'measurement labels to update');

            // 🔧 SEGMENT FIX: a segment label belongs at ITS segment's midpoint, NOT the
            // parent centroid. Precompute the current segment midpoints from the live
            // geometry in the SAME nested order they were created (outer rings/paths,
            // inner vertices) so we can zip them to the ordered relatedSegmentLabels.
            // Without this, every segment label got slammed onto the centroid during a
            // live resize — the "all labels jumbled in the center" bug.
            const _gtype = graphic.geometry?.type;
            const _segMidpoints: any[] = [];
            if (_gtype === 'polyline' || _gtype === 'polygon') {
                const _arrs = _gtype === 'polyline'
                    ? (graphic.geometry as any).paths
                    : (graphic.geometry as any).rings;
                if (Array.isArray(_arrs)) {
                    for (const _path of _arrs) {
                        if (!Array.isArray(_path)) continue;
                        for (let j = 1; j < _path.length; j++) {
                            const a = _path[j - 1], b = _path[j];
                            if (!a || !b) continue;
                            _segMidpoints.push(new Point({
                                x: (a[0] + b[0]) / 2,
                                y: (a[1] + b[1]) / 2,
                                spatialReference: (graphic.geometry as any).spatialReference
                            }));
                        }
                    }
                }
            }
            const _orderedSegLabels = Array.isArray(graphic.attributes?.relatedSegmentLabels)
                ? graphic.attributes.relatedSegmentLabels.filter(Boolean)
                : [];
            const _segMidByLabel = new Map<any, any>();
            _orderedSegLabels.forEach((lab: any, idx: number) => {
                if (_segMidpoints[idx]) _segMidByLabel.set(lab, _segMidpoints[idx]);
            });

            // Update each label's position based on the parent graphic's current geometry
            for (const label of measurementLabels) {
                const labelAsExtended = label as ExtendedGraphic;

                // Skip if label has been customized/manually positioned by user
                if (labelAsExtended.attributes?.customized) {
                    //console.log('⏭️ Skipping customized label');
                    continue;
                }

                try {
                    let newPosition: any | null = null;
                    const isSegment = labelAsExtended.attributes?.isSegmentLabel === true ||
                        labelAsExtended.attributes?.measurementType === 'segment';

                    if (isSegment) {
                        // Segment label → its own segment midpoint (zip by creation order,
                        // fall back to segmentIndex against the flat midpoint list).
                        newPosition = _segMidByLabel.get(labelAsExtended) || null;
                        if (!newPosition && typeof labelAsExtended.attributes?.segmentIndex === 'number') {
                            newPosition = _segMidpoints[labelAsExtended.attributes.segmentIndex] || null;
                        }
                    } else if (graphic.geometry.type === 'polyline' || graphic.geometry.type === 'polygon') {
                        // Main/area label → centroid (or extent center)
                        if ('centroid' in graphic.geometry) {
                            newPosition = (graphic.geometry as any).centroid;
                        } else if ((graphic.geometry as any).extent?.center) {
                            newPosition = (graphic.geometry as any).extent.center;
                        }
                    } else if (graphic.geometry.type === 'point') {
                        // For points, use the point itself
                        newPosition = graphic.geometry as any;
                    }

                    // Update the label's position if we found a valid one
                    if (newPosition) {
                        labelAsExtended.geometry = newPosition.clone ? newPosition.clone() : newPosition;
                        //console.log('✅ Updated label position for:', labelAsExtended.attributes?.text || 'measurement label');
                    }
                } catch (labelErr) {
                    console.warn('Error updating individual label position:', labelErr);
                }
            }

            //console.log('✅ Finished updating all measurement label positions');
        } catch (error) {
            console.error('Error in updateMeasurementLabelPositions:', error);
        }
    };
    /**
     * Restores measurement label associations that may have been lost during tab switches
     * or other operations. This ensures measurements remain visible and functional.
     */
    private restoreMeasurementAssociations = () => {
        if (!this.props.graphicsLayer) return;

        //console.log('🔧 Restoring measurement associations...');

        const allGraphics = this.props.graphicsLayer.graphics.toArray();
        const measurementLabels = allGraphics.filter(g => g.attributes?.isMeasurementLabel);
        const drawings = allGraphics.filter(g =>
            !g.attributes?.isMeasurementLabel &&
            !g.attributes?.isBuffer &&
            !g.attributes?.hideFromList
        );

        let restored = 0;

        // For each measurement label, find its parent
        measurementLabels.forEach(label => {
            const labelExtended = label as ExtendedGraphic;
            const parentId = label.attributes?.parentGraphicId;

            if (parentId) {
                const parent = drawings.find(d => d.attributes?.uniqueId === parentId);
                if (parent) {
                    // Restore all associations
                    labelExtended.measureParent = parent;

                    const parentExtended = parent as ExtendedGraphic;
                    const isSegmentTypeLabel =
                        label.attributes?.isSegmentLabel === true ||
                        label.attributes?.measurementType === 'segment';

                    // Only the main length/area label populates `measure`. Segment
                    // labels do not — previously they could overwrite `measure` and
                    // strand `lengthUnit`/`areaUnit` from segment attributes.
                    if (!isSegmentTypeLabel) {
                        parentExtended.measure = {
                            graphic: labelExtended,
                            areaUnit: label.attributes?.areaUnit,
                            lengthUnit: label.attributes?.lengthUnit
                        };
                    }

                    // Route labels to the correct collection. Previously every label
                    // (main or segment) was pushed into relatedSegmentLabels, which
                    // (a) left relatedMeasurementLabels empty so logic gated on it
                    // never fired, and (b) caused the segment-aware visibility/refresh
                    // code to operate on main labels too.
                    if (!parentExtended.attributes) parentExtended.attributes = {};
                    const bucketKey = isSegmentTypeLabel
                        ? 'relatedSegmentLabels'
                        : 'relatedMeasurementLabels';
                    if (!parentExtended.attributes[bucketKey]) {
                        parentExtended.attributes[bucketKey] = [];
                    }
                    if (!parentExtended.attributes[bucketKey].includes(label)) {
                        parentExtended.attributes[bucketKey].push(label);
                    }

                    restored++;
                }
            }
        });

        //console.log(`✅ Restored ${restored} measurement label associations`);
    };

    private cleanupMeasurementLabelsForGraphic = (graphic: ExtendedGraphic) => {
        if (!graphic || !this.props.graphicsLayer) return;

        try {
            //console.log(`Starting aggressive cleanup for graphic: ${graphic.attributes?.name || 'unnamed'}`);
            //console.log(`Graphic uniqueId: ${graphic.attributes?.uniqueId}`);

            // CRITICAL: Cancel SketchViewModel FIRST and clear all selections
            if (this.sketchViewModel) {
                this.sketchViewModel.cancel();
                // Also clear any updateGraphics collection
                if (this.sketchViewModel.updateGraphics) {
                    this.sketchViewModel.updateGraphics.removeAll();
                }
            }

            // Clear any UI selection state
            this.setState({
                selectedGraphicIndex: null,
                symbolEditingIndex: null
            });

            // Add delay to ensure SketchViewModel operations complete
            setTimeout(() => {
                this.performAggressiveCleanup(graphic);
            }, 100);

        } catch (error) {
            console.error('Error in cleanup initiation:', error);
        }
    };
    // Generate ExB Draw Widget JSON export (OOTB Experience Builder Draw widget format)
    // Matches the format introduced in ExB 1.20 / ArcGIS Online — geometry stays in the
    // map's native spatial reference, no projection applied.
    private generateExBDrawExport = async (drawingsToExport: ExtendedGraphic[]): Promise<string> => {
        try {
            const graphicsJson: any[] = [];

            for (const graphic of drawingsToExport) {
                if (!graphic?.geometry) continue;

                const geomJson = graphic.geometry.toJSON();
                const symbolJson = graphic.symbol ? graphic.symbol.toJSON() : null;

                const jimuDrawId = graphic.attributes?.jimuDrawId ||
                    graphic.attributes?.uniqueId ||
                    `draw-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                graphicsJson.push({
                    aggregateGeometries: null,
                    geometry: geomJson,
                    symbol: symbolJson,
                    attributes: {
                        jimuDrawId: jimuDrawId
                    },
                    popupTemplate: null
                });

                // Include the attached buffer polygon as its own graphic.
                const bufferGraphic = this.getAttachedBufferGraphic(graphic);
                if (bufferGraphic?.geometry) {
                    graphicsJson.push({
                        aggregateGeometries: null,
                        geometry: bufferGraphic.geometry.toJSON(),
                        symbol: bufferGraphic.symbol ? bufferGraphic.symbol.toJSON() : null,
                        attributes: {
                            jimuDrawId: `${jimuDrawId}-buffer`
                        },
                        popupTemplate: null
                    });
                }
            }

            return JSON.stringify(graphicsJson, null, 2);
        } catch (error) {
            console.error('Error generating ExB Draw JSON export:', error);
            throw error;
        }
    };

    // Generate Shapefile export (as ZIP containing .shp, .shx, .dbf, .prj files)
    private generateShapefileExport = async (drawingsToExport: ExtendedGraphic[]): Promise<Blob> => {
        try {
            //console.log('Starting Shapefile export with', drawingsToExport.length, 'drawings');

            const exportData = await this.generateCompatibleExportData(drawingsToExport);
            const geoJSON = exportData.geoJSONFormat as FeatureCollection<Geometry, GeoJsonProperties>;

            const zipOut = await shpwrite.zip(geoJSON, {
                folder: 'myDrawings',
                filename: 'my_drawings',         // optional, but nice to include
                types: { point: 'points', polygon: 'polygons', line: 'lines' },
                outputType: 'blob',
                compression: 'DEFLATE'           // <-- required by ZipOptions
                // prj: 'PROJCS["..."]'           // optional .prj WKT if you want
            }) as unknown;

            let blob: Blob;
            if (zipOut instanceof Blob) {
                blob = zipOut;
            } else if (zipOut instanceof ArrayBuffer) {
                blob = new Blob([zipOut], { type: 'application/zip' });
            } else if (zipOut instanceof Uint8Array) {
                blob = new Blob([zipOut.buffer as ArrayBuffer], { type: 'application/zip' });
            } else if (Array.isArray(zipOut)) {
                blob = new Blob([new Uint8Array(zipOut)], { type: 'application/zip' });
            } else if (typeof zipOut === 'string') {
                blob = new Blob([zipOut], { type: 'application/zip' });
            } else {
                throw new Error('Unexpected shp-write zip() output type');
            }

            //console.log('Shapefile ZIP generated successfully');
            return blob;
        } catch (error) {
            console.error('Error generating Shapefile:', error);
            throw error;
        }
    };

    private performActualCleanup = (graphic: ExtendedGraphic) => {
        if (!graphic || !this.props.graphicsLayer) return;

        try {
            //console.log(`Performing actual cleanup for: ${graphic.attributes?.name || 'unnamed'}`);

            // Method 1: Remove the main measurement label if it exists
            if (graphic.measure?.graphic) {
                //console.log('Removing main measurement graphic');
                this.props.graphicsLayer.remove(graphic.measure.graphic);

                // Clear the reference
                graphic.measure = null;
            }

            // Method 2: Remove segment labels if they exist
            if (graphic.attributes?.relatedSegmentLabels && Array.isArray(graphic.attributes.relatedSegmentLabels)) {
                //console.log(`Removing ${graphic.attributes.relatedSegmentLabels.length} segment labels`);
                graphic.attributes.relatedSegmentLabels.forEach(segmentLabel => {
                    if (segmentLabel) {
                        this.props.graphicsLayer.remove(segmentLabel);
                    }
                });

                // Clear the array
                graphic.attributes.relatedSegmentLabels = [];
            }

            // Method 3: Search for orphaned measurement labels that might reference this graphic
            const allGraphics = this.props.graphicsLayer.graphics.toArray();
            const orphanedMeasurements = allGraphics.filter(g => {
                const extendedG = g as ExtendedGraphic;
                return (
                    extendedG.attributes?.isMeasurementLabel &&
                    (extendedG.measureParent === graphic ||
                        extendedG.attributes?.parentId === graphic.attributes?.uniqueId)
                );
            });

            if (orphanedMeasurements.length > 0) {
                //console.log(`Removing ${orphanedMeasurements.length} orphaned measurement labels`);
                orphanedMeasurements.forEach(orphan => {
                    this.props.graphicsLayer.remove(orphan);
                });
            }

            //console.log('Actual cleanup completed');

            // Force a map refresh after cleanup
            setTimeout(() => {
                this.forceMapRefresh();
            }, 100);

        } catch (error) {
            console.error('Error in actual cleanup:', error);
        }
    };
    // Fixed version with proper TypeScript types:

    private convertToGeographic = (point: any): any => {
        try {
            // If already in geographic coordinates, return as-is
            if (point.spatialReference && (
                point.spatialReference.wkid === 4326 ||
                (point.spatialReference as any).latestWkid === 4326
            )) {
                return point;
            }

            // Create a new point in WGS84 (Geographic)
            const geographicSR = {
                wkid: 4326
            };

            // Web Mercator → WGS84: use statically imported webMercatorUtils
            if (typeof webMercatorUtils !== 'undefined') {
                // Use webMercatorUtils for coordinate conversion instead
                try {
                    if (webMercatorUtils && webMercatorUtils.webMercatorToGeographic) {
                        return webMercatorUtils.webMercatorToGeographic(point) as any;
                    }
                } catch (e) {
                    // Fall through to manual conversion
                }
            }

            // Fallback: if point has longitude/latitude properties, use those
            if (point.longitude !== undefined && point.latitude !== undefined) {
                return point;
            }

            // Last resort: assume Web Mercator and convert manually
            if (point.spatialReference && (
                point.spatialReference.wkid === 3857 ||
                (point.spatialReference as any).latestWkid === 3857
            )) {
                const lon = (point.x / 20037508.34) * 180;
                const lat = (Math.atan(Math.exp((point.y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;

                return {
                    x: lon,
                    y: lat,
                    longitude: lon,
                    latitude: lat,
                    spatialReference: geographicSR
                } as any;
            }

            // If we can't convert, return the original point but log a warning
            console.warn('Could not convert point to geographic coordinates:', point);
            return point;

        } catch (error) {
            console.error('Error converting point to geographic:', error);
            return point;
        }
    };

    private convertCoordinateToGeographic = (x: number, y: number): { longitude: number; latitude: number } => {
        try {
            // Get the spatial reference from the map view
            const mapSR = this.props.jimuMapView?.view?.spatialReference;

            // If already in geographic coordinates
            if (mapSR && (mapSR.wkid === 4326 || (mapSR as any).latestWkid === 4326)) {
                return { longitude: x, latitude: y };
            }

            // If Web Mercator, convert manually
            if (mapSR && (mapSR.wkid === 3857 || (mapSR as any).latestWkid === 3857)) {
                const lon = (x / 20037508.34) * 180;
                const lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
                return { longitude: lon, latitude: lat };
            }

            // For other coordinate systems, assume they're already in the correct format
            // This is a fallback that may need adjustment based on your specific use case
            return { longitude: x, latitude: y };

        } catch (error) {
            console.error('Error converting coordinate to geographic:', error);
            return { longitude: x, latitude: y };
        }
    };

    // Alternative approach using a simpler coordinate conversion method:
    private simpleCoordinateConversion = (geometry: any): any => {
        if (!geometry) return null;

        try {
            switch (geometry.type) {
                case 'point':
                    const point = geometry as any;

                    // Check if we have longitude/latitude directly
                    if (point.longitude !== undefined && point.latitude !== undefined) {
                        return {
                            type: 'Point',
                            coordinates: [point.longitude, point.latitude]
                        };
                    }

                    // Convert Web Mercator to Geographic if needed
                    let lon = point.x;
                    let lat = point.y;

                    if (point.spatialReference && point.spatialReference.wkid === 3857) {
                        lon = (point.x / 20037508.34) * 180;
                        lat = (Math.atan(Math.exp((point.y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
                    }

                    return {
                        type: 'Point',
                        coordinates: [lon, lat]
                    };

                case 'polyline':
                    const polyline = geometry as any;
                    const paths = polyline.paths.map(path =>
                        path.map(coord => {
                            let lon = coord[0];
                            let lat = coord[1];

                            // Convert if Web Mercator
                            if (polyline.spatialReference && polyline.spatialReference.wkid === 3857) {
                                lon = (coord[0] / 20037508.34) * 180;
                                lat = (Math.atan(Math.exp((coord[1] / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
                            }

                            return [lon, lat];
                        })
                    );
                    return {
                        type: paths.length > 1 ? 'MultiLineString' : 'LineString',
                        coordinates: paths.length > 1 ? paths : paths[0]
                    };

                case 'polygon':
                    const polygon = geometry as any;
                    const rings = polygon.rings.map(ring =>
                        ring.map(coord => {
                            let lon = coord[0];
                            let lat = coord[1];

                            // Convert if Web Mercator
                            if (polygon.spatialReference && polygon.spatialReference.wkid === 3857) {
                                lon = (coord[0] / 20037508.34) * 180;
                                lat = (Math.atan(Math.exp((coord[1] / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
                            }

                            return [lon, lat];
                        })
                    );
                    return {
                        type: 'Polygon',
                        coordinates: rings
                    };

                case 'extent':
                    const extent = geometry as any;
                    let xmin = extent.xmin;
                    let ymin = extent.ymin;
                    let xmax = extent.xmax;
                    let ymax = extent.ymax;

                    // Convert if Web Mercator
                    if (extent.spatialReference && extent.spatialReference.wkid === 3857) {
                        xmin = (extent.xmin / 20037508.34) * 180;
                        ymin = (Math.atan(Math.exp((extent.ymin / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
                        xmax = (extent.xmax / 20037508.34) * 180;
                        ymax = (Math.atan(Math.exp((extent.ymax / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
                    }

                    const coords = [[
                        [xmin, ymin],
                        [xmax, ymin],
                        [xmax, ymax],
                        [xmin, ymax],
                        [xmin, ymin] // Close the ring
                    ]];

                    return {
                        type: 'Polygon',
                        coordinates: coords
                    };

                default:
                    console.warn(`Unsupported geometry type: ${geometry.type}`);
                    return null;
            }
        } catch (error) {
            console.error('Error converting geometry to GeoJSON:', error);
            return null;
        }
    };

    // Replace the convertToGeoJSONGeometry method with this simpler version:
    private convertToGeoJSONGeometry = (geometry: any): any => {
        return this.simpleCoordinateConversion(geometry);
    };


    private convertSymbolToStandardProperties = (symbol: any): any => {
        if (!symbol) return {};

        const properties: any = {};

        try {
            switch (symbol.type) {
                case 'simple-marker':
                    const marker = symbol as any;
                    properties.marker_color = marker.color?.toHex() || '#000000';
                    properties.marker_size = marker.size || 12;
                    properties.marker_symbol = marker.style || 'circle';
                    if (marker.outline) {
                        properties.stroke = marker.outline.color?.toHex() || '#000000';
                        properties.stroke_width = marker.outline.width || 1;
                    }
                    break;

                case 'picture-marker':
                    const pic = symbol as any;

                    // Symbol type for import
                    properties.symbolType = 'picture-marker';

                    // Image URL
                    properties.imageUrl = pic.url;

                    // Helper to normalize width/height to number
                    const toNumber = (v: any, fallback: number) => {
                        if (typeof v === 'number') return v;
                        if (typeof v === 'string') {
                            const n = parseFloat(v);
                            return isNaN(n) ? fallback : n;
                        }
                        return fallback;
                    };
                    properties.imageWidth = toNumber((pic as any).width, 24);
                    properties.imageHeight = toNumber((pic as any).height, 24);

                    // Rotation (degrees)
                    properties.imageRotation = (pic as any).angle ?? 0;

                    // Offsets
                    if (typeof (pic as any).xoffset === 'number') {
                        properties.imageOffsetX = (pic as any).xoffset;
                    }
                    if (typeof (pic as any).yoffset === 'number') {
                        properties.imageOffsetY = (pic as any).yoffset;
                    }

                    // Opacity
                    if (typeof (pic as any).opacity === 'number') {
                        properties.image_opacity = (pic as any).opacity;
                    }

                    // Tint color if used
                    if ((pic as any).color) {
                        const c = (pic as any).color;
                        properties.image_tint = c.toHex?.() ?? '#000000';
                        if (typeof c.a === 'number') {
                            properties.image_tint_opacity = c.a;
                        }
                    }
                    break;

                case 'simple-line':
                    const line = symbol as any;
                    properties.stroke = line.color?.toHex() || '#000000';
                    properties.stroke_width = line.width || 1;
                    properties.stroke_opacity = line.color?.a ?? 1;
                    break;

                case 'simple-fill':
                    const fill = symbol as any;
                    properties.fill = fill.color?.toHex() || '#000000';
                    properties.fill_opacity = fill.color?.a ?? 1;
                    if (fill.outline) {
                        properties.stroke = fill.outline.color?.toHex() || '#000000';
                        properties.stroke_width = fill.outline.width || 1;
                    }
                    break;

                case 'text':
                    const text = symbol as any;
                    properties.text = text.text || '';
                    properties.text_color = text.color?.toHex() || '#000000';
                    properties.text_size = text.font?.size || 12;
                    properties.text_font = text.font?.family || 'Arial';
                    // Preserve font style customizations
                    if (text.font?.weight && text.font.weight !== 'normal') {
                        properties.text_weight = text.font.weight;
                    }
                    if (text.font?.style && text.font.style !== 'normal') {
                        properties.text_style = text.font.style;
                    }
                    if (text.font?.decoration && text.font.decoration !== 'none') {
                        properties.text_decoration = text.font.decoration;
                    }
                    // Preserve text alignment
                    properties.text_align = text.horizontalAlignment || 'center';
                    properties.text_baseline = text.verticalAlignment || 'middle';
                    // Preserve rotation
                    if (text.angle) {
                        properties.text_rotation = text.angle;
                    }
                    // Preserve text opacity (alpha)
                    properties.text_opacity = text.color?.a ?? 1;
                    // Preserve halo settings if any
                    const haloSize = text.haloSize;
                    if (haloSize !== null && haloSize !== undefined) {
                        properties.text_halo_size = haloSize;
                        if (haloSize > 0 && text.haloColor) {
                            properties.text_halo_color = text.haloColor.toHex?.() || '#FFFFFF';
                            properties.text_halo_opacity = text.haloColor.a ?? 1;
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error converting symbol properties:', error);
        }

        return properties;
    };
    // Add debugging to see what's happening in the conversion process

    // Add this method to convert ArcGIS geometry to GeoJSON format
    arcgisGeometryToGeoJSON = (geometry: any): any => {
        if (!geometry) {
            return null;
        }

        const type = geometry.type;

        switch (type) {
            case 'point': {
                const point = geometry as any;
                return {
                    type: 'Point',
                    coordinates: [point.x, point.y]
                };
            }
            case 'polyline': {
                const polyline = geometry as any;
                if (polyline.paths.length === 1) {
                    return {
                        type: 'LineString',
                        coordinates: polyline.paths[0]
                    };
                } else {
                    return {
                        type: 'MultiLineString',
                        coordinates: polyline.paths
                    };
                }
            }
            case 'polygon': {
                const polygon = geometry as any;
                return {
                    type: 'Polygon',
                    coordinates: polygon.rings
                };
            }
            case 'multipoint': {
                const multipoint = geometry as any;
                return {
                    type: 'MultiPoint',
                    coordinates: multipoint.points
                };
            }
            case 'extent': {
                const extent = geometry as any;
                // Convert extent to polygon
                return {
                    type: 'Polygon',
                    coordinates: [[
                        [extent.xmin, extent.ymin],
                        [extent.xmax, extent.ymin],
                        [extent.xmax, extent.ymax],
                        [extent.xmin, extent.ymax],
                        [extent.xmin, extent.ymin]
                    ]]
                };
            }
            default:
                console.warn('Unsupported geometry type for GeoJSON export:', type);
                return null;
        }
    };

    // Resolve the buffer graphic attached to a parent drawing for export.
    // Prefers the live bufferGraphic link; falls back to scanning the draw layer
    // by parentId so buffers survive a reload where the live link is gone.
    private getAttachedBufferGraphic = (parent: ExtendedGraphic): ExtendedGraphic | null => {
        if (parent?.bufferGraphic?.geometry) return parent.bufferGraphic;
        const layer = this.props.graphicsLayer as any;
        const pid = parent?.attributes?.uniqueId;
        if (!layer || !pid) return null;
        try {
            const found = layer.graphics.toArray().find((g: any) =>
                (g.attributes?.isBuffer || g.attributes?.isBufferDrawing) &&
                (g.attributes?.parentId === pid || g.sourceGraphicId === pid));
            return (found && found.geometry) ? found as ExtendedGraphic : null;
        } catch {
            return null;
        }
    };

    // Build the export properties for a buffer feature derived from its parent.
    private buildBufferExportProps = (parent: ExtendedGraphic, parentId: string, parentName: string, created: string, bufferGraphic: ExtendedGraphic): any => {
        const bufProps: any = {
            id: `${parentId}_buffer`,
            name: `${parentName} Buffer`,
            description: 'Buffer',
            type: 'Buffer',
            isBuffer: true,
            parentId,
            created,
            notes: ''
        };
        const settings = parent.bufferSettings;
        const ba = bufferGraphic.attributes || {};
        const distance = settings?.distance ?? ba.bufferDistance;
        const unit = settings?.unit ?? ba.bufferUnit;
        if (distance != null) bufProps.bufferDistance = distance;
        if (unit != null) bufProps.bufferUnit = unit;
        if (typeof settings?.opacity === 'number') bufProps.bufferOpacity = settings.opacity;
        if (typeof settings?.outlineOnly === 'boolean') bufProps.bufferOutlineOnly = settings.outlineOnly;
        Object.assign(bufProps, this.convertSymbolToStandardProperties(bufferGraphic.symbol));
        return bufProps;
    };

    generateCompatibleExportData = async (
        drawingsToExport: ExtendedGraphic[]
    ): Promise<{ geoJSONFormat: any }> => {
        const geoJSONFeatures: any[] = [];

        // Helper to generate a stable ID
        const getId = (g: any, index: number) =>
            g.attributes?.uniqueId ||
            g.attributes?.id ||
            `drawing_${Date.now()}_${index}`;

        // Helper to fully extract TextSymbol styling
        const extractTextSymbolProps = (sym: any | any) => {
            if (!sym || sym.type !== 'text') return {};
            const ts = sym as any;
            const font = ts.font || {} as any;
            const out: any = {
                text: ts.text ?? '',
                text_color: ts.color?.toHex?.() || '#000000',
                text_opacity: typeof (ts.color as any)?.a === 'number' ? (ts.color as any).a : 1,
                text_size: typeof font.size === 'number' ? font.size : 12,
                text_font: font.family || 'Arial',
                text_weight: font.weight || 'normal',
                text_style: font.style || 'normal',
                text_decoration: font.decoration || 'none',
                text_align: ts.horizontalAlignment || 'center',
                text_baseline: ts.verticalAlignment || 'middle',
                text_rotation: typeof ts.angle === 'number' ? ts.angle : 0,
                // Preserve the editor's forced lineWidth (default 9999 = no auto-wrap)
                // so explicit \n line breaks survive a round-trip via GeoJSON.
                text_lineWidth: typeof ts.lineWidth === 'number' ? ts.lineWidth : 9999
            };
            // Halo (if any)
            if (typeof ts.haloSize === 'number') {
                out.text_halo_size = ts.haloSize;
                if (ts.haloSize > 0 && ts.haloColor) {
                    out.text_halo_color = (ts.haloColor as any)?.toHex?.() || '#FFFFFF';
                    out.text_halo_opacity = typeof (ts.haloColor as any)?.a === 'number'
                        ? (ts.haloColor as any).a
                        : 1;
                }
            }
            return out;
        };

        // Loop through each drawing and build GeoJSON Feature with symbology
        for (let i = 0; i < drawingsToExport.length; i++) {
            const graphic = drawingsToExport[i];
            if (!graphic?.geometry) {
                console.warn(`Skipping graphic ${i}: no geometry`);
                continue;
            }
            // 1. Convert geometry to standard WGS84 GeoJSON coords
            const geoJSONGeom = await this.convertToStandardGeoJSON(graphic.geometry);
            if (!geoJSONGeom) {
                console.warn(`Failed to convert geometry for drawing ${i}`);
                continue;
            }
            // 2. Base properties (ID, name, type label, created timestamp)
            const typeLabel = this.getDrawingTypeLabel(graphic);
            const props: any = {
                id: getId(graphic, i),
                name: graphic.attributes?.name || `Drawing ${i + 1}`,
                description: `${typeLabel} drawing`,
                type: typeLabel,
                created: (() => {
                    const raw = graphic.attributes?.createdDate;
                    if (!raw) return new Date().toISOString();
                    const d = typeof raw === 'number' ? new Date(raw) : new Date(raw);
                    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
                })(),
                notes: graphic.attributes?.notes || ''
            };
            // 3. Attach core symbol properties (color, size, etc.)
            Object.assign(props, this.convertSymbolToStandardProperties(graphic.symbol));
            // If text, add full text style details
            if (graphic.symbol?.type === 'text') {
                Object.assign(props, extractTextSymbolProps(graphic.symbol));
            }
            // 4. Include buffer info if this graphic has an active buffer
            if (graphic.bufferSettings?.enabled) {
                props.bufferDistance = graphic.bufferSettings.distance;
                props.bufferUnit = graphic.bufferSettings.unit;
                if (typeof graphic.bufferSettings.opacity === 'number') {
                    props.bufferOpacity = graphic.bufferSettings.opacity; // preserve buffer opacity
                }
            }
            // 5. FIX #9/#16: Include measurement metadata for round-trip export/import
            const hasMeasurements = !!(
                graphic.measure?.graphic ||
                graphic.attributes?.hadMeasurements ||
                graphic.attributes?.measurementsPermanent ||
                (graphic.attributes?.relatedMeasurementLabels?.length > 0) ||
                (graphic.attributes?.relatedSegmentLabels?.length > 0)
            );
            if (hasMeasurements) {
                props.hasMeasurements = true;
                props.measurementsHidden = graphic.attributes?.measurementsHidden ?? false;
                // Store the units that were used for this graphic's measurements
                if (graphic.attributes?.measurementUnits) {
                    props.measurementLengthUnit = graphic.attributes.measurementUnits.lengthUnit;
                    props.measurementAreaUnit = graphic.attributes.measurementUnits.areaUnit;
                } else if (graphic.measure?.graphic?.attributes) {
                    props.measurementLengthUnit = graphic.measure.graphic.attributes.lengthUnit;
                    props.measurementAreaUnit = graphic.measure.graphic.attributes.areaUnit;
                }
                // Include the measurement text itself for reference
                if (graphic.measure?.graphic?.symbol?.type === 'text') {
                    props.measurementText = graphic.measure.graphic.symbol.text;
                }
            }
            // 6. Push the feature
            geoJSONFeatures.push({
                type: 'Feature',
                geometry: geoJSONGeom,
                properties: props
            });

            // 7. Also export the attached buffer polygon as its own feature so the
            // buffer geometry is present in GeoJSON/shapefile (not just metadata).
            const bufferGraphic = this.getAttachedBufferGraphic(graphic);
            if (bufferGraphic?.geometry) {
                const bufferGeoJSON = await this.convertToStandardGeoJSON(bufferGraphic.geometry);
                if (bufferGeoJSON) {
                    const bufferProps = this.buildBufferExportProps(graphic, getId(graphic, i), props.name, props.created, bufferGraphic);
                    geoJSONFeatures.push({
                        type: 'Feature',
                        geometry: bufferGeoJSON,
                        properties: bufferProps
                    });
                }
            }
        }

        return {
            geoJSONFormat: {
                type: 'FeatureCollection',
                features: geoJSONFeatures
            }
        };
    };

    // Convert coordinates to WGS84 (longitude/latitude)
    private getWGS84Coordinates = (x: number, y: number): { lon: number; lat: number } => {
        const mapSR = this.props.jimuMapView?.view?.spatialReference;

        // console.log('🔍 Converting coordinates:', {
        //   originalX: x,
        //   originalY: y,
        //   mapSR: mapSR?.wkid
        // });

        // If already in WGS84 (geographic coordinates)
        if (!mapSR || mapSR.wkid === 4326) {
            const result = {
                lon: Number(x.toFixed(8)),
                lat: Number(y.toFixed(8))
            };
            //console.log('🔍 Already WGS84:', result);
            return result;
        }

        // Convert from Web Mercator (most common)
        if (mapSR.wkid === 3857 || mapSR.wkid === 102100) {
            const lon = (x / 20037508.34) * 180;
            const lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
            const result = {
                lon: Number(lon.toFixed(8)),
                lat: Number(lat.toFixed(8))
            };
            //console.log('🔍 Converted from Web Mercator:', result);
            return result;
        }

        // For other coordinate systems, assume they need no conversion
        const result = {
            lon: Number(x.toFixed(8)),
            lat: Number(y.toFixed(8))
        };
        //console.log('🔍 Using original coordinates (unknown SR):', result);
        return result;
    };


    // Validate that coordinates are within valid WGS84 bounds
    private isValidCoordinate = (lon: number, lat: number): boolean => {
        return !isNaN(lon) && !isNaN(lat) &&
            lon >= -180 && lon <= 180 &&
            lat >= -90 && lat <= 90;
    };

    // Convert symbol properties to standard GeoJSON-friendly properties

    private determineEsriGeometryType = (graphics: ExtendedGraphic[]): string => {
        // Determine the predominant geometry type for Esri format
        const typeCounts = graphics.reduce((acc, graphic) => {
            const type = graphic.geometry?.type;
            if (type) {
                acc[type] = (acc[type] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);

        const dominantType = Object.keys(typeCounts).reduce((a, b) =>
            typeCounts[a] > typeCounts[b] ? a : b
        );

        switch (dominantType) {
            case 'point': return 'esriGeometryPoint';
            case 'polyline': return 'esriGeometryPolyline';
            case 'polygon':
            case 'extent': return 'esriGeometryPolygon';
            default: return 'esriGeometryPoint';
        }
    };

    private getGraphicId = (graphic: any): string => {
        // Try to use existing unique identifiers first
        if (graphic.attributes?.uniqueId) {
            return graphic.attributes.uniqueId;
        }

        if (graphic.attributes?.objectId) {
            return `obj_${graphic.attributes.objectId}`;
        }

        // Fall back to generating an ID based on graphic properties
        const geometryType = graphic.geometry?.type || 'unknown';
        const symbolType = graphic.symbol?.type || 'unknown';
        const text = (graphic.symbol as any)?.text || '';
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);

        return `${geometryType}_${symbolType}_${text.substring(0, 10)}_${timestamp}_${random}`;
    };
    private performFinalMeasurementCleanup = (deletedGraphic: ExtendedGraphic) => {
        if (!this.props.graphicsLayer) return;

        try {
            const allGraphics = this.props.graphicsLayer.graphics.toArray();
            const measurementLabels = allGraphics.filter(g => {
                const extG = g as ExtendedGraphic;
                return extG.attributes?.isMeasurementLabel;
            });

            //console.log(`Final cleanup check: Found ${measurementLabels.length} measurement labels`);

            // ONLY remove measurement labels that are specifically orphaned by this deletion
            const orphanedLabels = measurementLabels.filter(label => {
                const extLabel = label as ExtendedGraphic;
                const parent = extLabel.measureParent;
                const parentId = extLabel.attributes?.parentId;
                const deletedGraphicId = deletedGraphic.attributes?.uniqueId;

                // Only consider it orphaned if it was specifically linked to the deleted graphic
                if (parent === deletedGraphic) {
                    return true; // Direct parent reference to deleted graphic
                }

                if (parentId && deletedGraphicId && parentId === deletedGraphicId) {
                    return true; // Parent ID matches deleted graphic's ID
                }

                // DO NOT remove labels that don't have a clear connection to the deleted graphic
                return false;
            });

            if (orphanedLabels.length > 0) {
                //console.log(`Removing ${orphanedLabels.length} labels that were specifically orphaned by this deletion`);
                orphanedLabels.forEach(label => {
                    //console.log(`  - Removing orphaned label: "${label.attributes?.name || 'unnamed'}"`);
                    this.props.graphicsLayer.remove(label);
                });
            } else {
                //console.log('No specifically orphaned labels found');
            }

        } catch (error) {
            console.error('Error in final measurement cleanup:', error);
        }
    };
    private createBufferSymbolFromParent = (parentGraphic: ExtendedGraphic): SimpleFillSymbol => {
        const geomType = parentGraphic.geometry?.type;
        const parentSymbol = parentGraphic.symbol;

        // 🔧 CRITICAL: Use saved opacity from buffer settings, fallback to 50%
        const savedOpacity = parentGraphic.bufferSettings?.opacity;
        const opacityToUse = savedOpacity !== undefined ? savedOpacity : 50;
        const opacityMultiplier = opacityToUse / 100;

        let fillColor = new Color([0, 0, 0, 0.15 * opacityMultiplier]);
        let outlineColor = new Color([0, 0, 0, 0.6 * opacityMultiplier]);

        // Custom color override: drive fill and outline from the chosen colors
        // instead of inheriting from the parent symbol. Outline color falls back
        // to the fill color for buffers saved before outline color was separate.
        const customColor = parentGraphic.bufferSettings?.customColor || null;
        const customOutlineColor = parentGraphic.bufferSettings?.customOutlineColor || customColor || null;
        if (customColor || customOutlineColor) {
            try {
                const fc = new Color(customColor || customOutlineColor);
                const oc = new Color(customOutlineColor || customColor);
                fillColor = new Color([fc.r, fc.g, fc.b, 0.3 * opacityMultiplier]);
                outlineColor = new Color([oc.r, oc.g, oc.b, 1.0 * opacityMultiplier]);
                if (parentGraphic.bufferSettings?.outlineOnly) {
                    return new SimpleFillSymbol({
                        color: new Color([0, 0, 0, 0]),
                        outline: new SimpleLineSymbol({ color: outlineColor, width: 2.5, style: 'solid' })
                    });
                }
                return new SimpleFillSymbol({
                    color: fillColor,
                    outline: new SimpleLineSymbol({ color: outlineColor, width: 2.5, style: 'dash' })
                });
            } catch { /* fall through to inherited color */ }
        }

        try {
            if (geomType === 'polygon' && parentSymbol) {
                const fillSym = parentSymbol as any;
                if (fillSym?.color) {
                    const rgba = fillSym.color.toRgba ? fillSym.color.toRgba() : [0, 0, 0, 1];
                    fillColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * opacityMultiplier, 1.0)]);
                    outlineColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * opacityMultiplier, 1.0)]);
                }
                if (fillSym?.outline?.color) {
                    const rgba = fillSym.outline.color.toRgba ? fillSym.outline.color.toRgba() : [0, 0, 0, 1];
                    outlineColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * opacityMultiplier, 1.0)]);
                }
            } else if (geomType === 'polyline' && parentSymbol) {
                const lineSym = parentSymbol as any;
                if (lineSym?.color) {
                    const rgba = lineSym.color.toRgba ? lineSym.color.toRgba() : [0, 0, 0, 1];
                    fillColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * 0.6 * opacityMultiplier, 1.0)]);
                    outlineColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * opacityMultiplier, 1.0)]);
                }
            } else if (geomType === 'point' && parentSymbol) {
                const markerSym = parentSymbol as any;
                if (markerSym?.color) {
                    const rgba = markerSym.color.toRgba ? markerSym.color.toRgba() : [0, 0, 0, 1];
                    fillColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * 0.6 * opacityMultiplier, 1.0)]);
                    outlineColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * opacityMultiplier, 1.0)]);
                }
            }
        } catch (error) {
            console.warn('Error processing parent colors:', error);
        }

        //console.log(`🎨 MyDrawingsPanel: Creating buffer symbol with ${opacityToUse}% opacity`);

        if (parentGraphic.bufferSettings?.outlineOnly) {
            return new SimpleFillSymbol({
                color: new Color([0, 0, 0, 0]),
                outline: new SimpleLineSymbol({
                    color: outlineColor,
                    width: 2.5,
                    style: 'solid'
                })
            });
        }

        return new SimpleFillSymbol({
            color: fillColor,
            outline: new SimpleLineSymbol({
                color: outlineColor,
                width: 1.5,
                style: 'dash'
            })
        });
    };
    private processKMLImport = async (content: string, replace: boolean) => {
        try {
            // 🚨 COMPLEXITY CHECK DISABLED FOR IMPROVED UX
            // Previously showed a warning dialog for files with >5000 vertices
            // This has been removed to streamline the import process
            /*
            const geojson = await this.parseKMLToGeoJSON(content);
            const totalVertices = this.countGeoJSONVertices(geojson);
            const COMPLEXITY_THRESHOLD = 5000;
            
            if (totalVertices > COMPLEXITY_THRESHOLD) {
                const warningMessage = `⚠️ This KML file is very complex (${totalVertices.toLocaleString()} coordinate points).\n\n` +
                    `Files exported from Google Earth or ArcGIS often contain excessive detail that can cause:\n` +
                    `• Browser freezing or crashes\n` +
                    `• Missing features on the map\n` +
                    `• Poor performance\n\n` +
                    `RECOMMENDED: Simplify this file before importing using:\n` +
                    `• QGIS (Vector > Geometry Tools > Simplify)\n` +
                    `• Google Earth Pro (Save Place as... with reduced detail)\n` +
                    `• mapshaper.org (convert KML to GeoJSON, simplify, export)\n\n` +
                    `Do you want to try importing anyway? (Not recommended)`;

                const userConfirmed = confirm(warningMessage);

                if (!userConfirmed) {
                    this.showLocalAlert('Import cancelled - KML file is too complex for web display', 'info');
                    this.closeImportDialog();
                    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
                    if (fileInput) fileInput.value = '';
                    return;
                }

                console.warn('⚠️ User chose to proceed with complex KML file import');
            }
            */

            // Optionally clear existing graphics
            this.ignoreNextGraphicsUpdate = true;
            if (replace) {
                //console.log('🗑️ Clearing existing drawings (replace mode)');
                this.props.graphicsLayer.removeAll();
            }

            // 🔧 FIX: Set importing flag to ignore ALL graphics change events during import
            this._isImporting = true;

            // Call existing importKML logic
            await this.importKML(content);

            // Refresh drawings list to show imported items immediately
            await this.refreshDrawingsFromLayer();

            // Close dialog and reset
            this.closeImportDialog();
            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            if (fileInput) {
                fileInput.value = '';
            }
        } catch (error) {
            console.error('KML import error:', error);
            this.showLocalAlert('Failed to import KML file', 'error');
            this.closeImportDialog();

            // Reset file input even on error
            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            if (fileInput) {
                fileInput.value = '';
            }
        } finally {
            // 🔧 FIX: Always reset importing flag
            this._isImporting = false;
            this.ignoreNextGraphicsUpdate = false;
        }
    };

    private completeDeletion = () => {
        try {
            // ... deletion completed ...
            // **MODIFIED:** Re-enable measurement system if it was enabled before
            if (this.props.onMeasurementSystemControl && this._measurementWasEnabled) {
                this.props.onMeasurementSystemControl(true);
            }
            this._isDeletingGraphic = false;
            this.forceMapRefresh();
            // ... logging ...
        } catch (error) {
            console.error('❌ Error completing deletion:', error);
            this._isDeletingGraphic = false;
            // **MODIFIED:** Only re-enable measurements on error if originally on
            if (this.props.onMeasurementSystemControl && this._measurementWasEnabled) {
                this.props.onMeasurementSystemControl(true);
            }
        }
    }
    private finishDeletion = (graphicToDelete: ExtendedGraphic, index: number) => {
        try {
            //console.log(`Finishing deletion of: ${graphicToDelete.attributes?.name || 'unnamed'}`);

            // Mark that we're about to update the graphics layer
            this.ignoreNextGraphicsUpdate = true;

            // Remove the main graphic from the layer
            this.props.graphicsLayer.remove(graphicToDelete);

            // AGGRESSIVE: Remove any measurement labels created during the deletion process
            setTimeout(() => {
                this.performFinalMeasurementCleanup(graphicToDelete);
            }, 50);

            // Update state
            const updatedDrawings = [...this.state.drawings];
            updatedDrawings.splice(index, 1);

            const newSelected = new Set<number>();
            this.state.selectedGraphics.forEach(selectedIndex => {
                if (selectedIndex < index) {
                    newSelected.add(selectedIndex);
                } else if (selectedIndex > index) {
                    newSelected.add(selectedIndex - 1);
                }
            });

            this.setState({
                drawings: updatedDrawings,
                selectedGraphicIndex: null,
                selectedGraphics: newSelected,
                symbolEditingIndex: null
            }, () => {
                // Save to localStorage
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }

                // Notify parent
                if (this.props.onDrawingsUpdate) {
                    this.props.onDrawingsUpdate(updatedDrawings);
                }

                // Final cleanup and re-enable measurements
                setTimeout(() => {
                    this.completeDeletion();
                }, 300);
            });

            //console.log('Deletion process completed');
        } catch (error) {
            console.error('Error finishing deletion:', error);
            this.isDeletingGraphics = false; // Reset flag on error
            this.showLocalAlert('Error completing deletion', 'error');
            this.refreshDrawingsFromLayer();
        }
    };
    private performAggressiveCleanup = (graphic: ExtendedGraphic) => {
        if (!graphic || !this.props.graphicsLayer) return;

        try {
            //console.log(`🗑️ PRIORITY: Removing attached buffer FIRST for: ${graphic.attributes?.name || 'unnamed'}`);

            // 🔧 CRITICAL: Remove attached buffer FIRST, before anything else
            if (graphic.bufferGraphic) {
                //console.log(`🗑️ Removing attached buffer for graphic ${graphic.attributes?.uniqueId}`);
                this.props.graphicsLayer.remove(graphic.bufferGraphic);
                graphic.bufferGraphic = null;
            }

            // Clear buffer settings immediately
            if (graphic.bufferSettings) {
                graphic.bufferSettings = null;
            }

            // Remove geometry watchers for this graphic to prevent further buffer updates
            const parentId = graphic.attributes?.uniqueId;
            if (parentId && this._positionWatchers) {
                Object.keys(this._positionWatchers).forEach(key => {
                    if (key.includes(parentId)) {
                        try {
                            this._positionWatchers[key].remove();
                            delete this._positionWatchers[key];
                            //console.log(`✅ Removed geometry watcher: ${key}`);
                        } catch (error) {
                            console.warn('Error removing geometry watcher:', error);
                        }
                    }
                });
            }

            // Also clean the buffer watcher map (separate from _positionWatchers)
            if (parentId) {
                const bw = (this as any)._bufferWatchers;
                if (bw && bw[parentId]) {
                    try { bw[parentId].remove(); } catch { /* no-op */ }
                    delete bw[parentId];
                }
            }

            const graphicUniqueId = graphic.attributes?.uniqueId;
            const allGraphics = this.props.graphicsLayer.graphics.toArray();

            // Remove by direct reference (measurement labels)
            if (graphic.measure?.graphic) {
                //console.log('🗑️ Removing main measurement graphic by direct reference');
                this.props.graphicsLayer.remove(graphic.measure.graphic);
                graphic.measure = null;
            }

            // Remove segment labels by direct reference
            if (graphic.attributes?.relatedSegmentLabels && Array.isArray(graphic.attributes.relatedSegmentLabels)) {
                //console.log(`🗑️ Removing ${graphic.attributes.relatedSegmentLabels.length} segment labels by direct reference`);
                graphic.attributes.relatedSegmentLabels.forEach(segmentLabel => {
                    if (segmentLabel) {
                        this.props.graphicsLayer.remove(segmentLabel);
                    }
                });
                graphic.attributes.relatedSegmentLabels = [];
            }

            // Find and remove measurement labels related to this graphic
            const measurementLabelsToRemove = [];
            allGraphics.forEach(g => {
                const extendedG = g as ExtendedGraphic;
                if (extendedG.attributes?.isMeasurementLabel) {
                    if (extendedG.measureParent === graphic ||
                        (graphicUniqueId && extendedG.attributes?.parentId === graphicUniqueId) ||
                        graphic.measure?.graphic === extendedG ||
                        graphic.attributes?.relatedSegmentLabels?.includes(extendedG) ||
                        (graphicUniqueId && extendedG.measureParent?.attributes?.uniqueId === graphicUniqueId)) {
                        measurementLabelsToRemove.push(extendedG);
                    }
                }
            });

            if (measurementLabelsToRemove.length > 0) {
                //console.log(`🗑️ Removing ${measurementLabelsToRemove.length} measurement labels SPECIFICALLY related to this graphic`);
                measurementLabelsToRemove.forEach(label => {
                    this.props.graphicsLayer.remove(label);
                });
            }

            // 🔧 NEW: Also clean up any orphaned buffers that might reference this graphic
            const orphanedBuffers = allGraphics.filter(g => {
                const extG = g as ExtendedGraphic;
                return (extG.attributes?.isBuffer || extG.attributes?.isPreviewBuffer) &&
                    (extG.attributes?.parentId === graphicUniqueId ||
                        extG.attributes?.sourceGraphicId === graphicUniqueId);
            });

            if (orphanedBuffers.length > 0) {
                //console.log(`🗑️ Removing ${orphanedBuffers.length} orphaned buffers that reference this graphic`);
                orphanedBuffers.forEach(buffer => {
                    this.props.graphicsLayer.remove(buffer);
                });
            }

            this.forceMapRefresh();
            //console.log('✅ Selective cleanup completed with comprehensive buffer removal');

        } catch (error) {
            console.error('❌ Error in selective cleanup:', error);
        }
    };
    private isSuspiciousMeasurementLabel = (label: ExtendedGraphic, targetGraphic: ExtendedGraphic): boolean => {
        if (!label.symbol || label.symbol.type !== 'text') return false;

        try {
            const labelText = (label.symbol as any).text || '';
            const labelGeometry = label.geometry;
            const targetGeometry = targetGraphic.geometry;

            // Check if text looks like a measurement
            const measurementKeywords = ['area:', 'length:', 'perimeter:', 'radius:', 'total:', 'm²', 'ft²', 'km²', 'mi²', 'km', 'mi', 'ft', 'm'];
            const hasMetricContent = measurementKeywords.some(keyword =>
                labelText.toLowerCase().includes(keyword.toLowerCase())
            );

            if (!hasMetricContent) return false;

            // Check proximity - if label is very close to the graphic, it's probably related
            if (labelGeometry && targetGeometry && labelGeometry.extent && targetGeometry.extent) {
                const labelCenter = labelGeometry.extent.center;
                const targetCenter = targetGeometry.extent.center;

                if (labelCenter && targetCenter) {
                    const distance = Math.sqrt(
                        Math.pow(labelCenter.x - targetCenter.x, 2) +
                        Math.pow(labelCenter.y - targetCenter.y, 2)
                    );

                    // If within reasonable distance and has measurement content, consider it suspicious
                    const maxDistance = Math.max(targetGeometry.extent.width, targetGeometry.extent.height) * 2;
                    if (distance < maxDistance) {
                        //console.log(`Suspicious label found within ${distance} units of target (max: ${maxDistance})`);
                        return true;
                    }
                }
            }

            return false;
        } catch (error) {
            console.error('Error checking suspicious label:', error);
            return false;
        }
    };
    private _isDeletingGraphic = false;
    // Detect import format based on file extension and content

    // Ensure a halo exists for a point/text graphic
    private ensurePointTextOverlay = (g: ExtendedGraphic) => {
        if (!g || !this.props.graphicsLayer) {
            //console.log('ensurePointTextOverlay: missing graphic or layer');
            return;
        }
        if (!g.geometry || g.geometry.type !== "point") {
            //console.log('ensurePointTextOverlay: not a point geometry');
            return;
        }

        const layer = this.props.graphicsLayer;

        // If halo exists: sync geometry & bring to front
        if (g._selectionOverlay) {
            //console.log('ensurePointTextOverlay: updating existing overlay');
            try {
                g._selectionOverlay.geometry = g.geometry;
            } catch (e) {
                console.warn('Error updating overlay geometry:', e);
            }
            this.bringOverlayToFront(g._selectionOverlay);
            return;
        }

        //console.log('ensurePointTextOverlay: creating new overlay for', g.attributes?.name);

        // Build halo symbol (square for text, circle for markers)
        const isText = (g.symbol as any)?.type === "text";
        const overlaySymbol = new SimpleMarkerSymbol({
            style: isText ? "square" : "circle",
            size: isText ? 26 : 22,
            color: [0, 0, 0, 0], // transparent fill
            outline: { color: [255, 128, 0, 1], width: 2 } // orange outline
        });

        const overlay = new Graphic({
            geometry: g.geometry,
            symbol: overlaySymbol,
            attributes: {
                hideFromList: true,
                isMeasurementLabel: false,
                isSelectionOverlay: true
            }
        });

        try {
            layer.add(overlay);
            g._selectionOverlay = overlay;
            //console.log('ensurePointTextOverlay: successfully created and added overlay');
        } catch (error) {
            console.error('ensurePointTextOverlay: error creating overlay:', error);
        }
    };
    // Convert graphics to KML format
    private generateKMLExport = async (drawingsToExport: ExtendedGraphic[]): Promise<string> => {
        const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>My Drawings Export</name>
    <description>Exported from My Drawings Panel</description>
`;

        const kmlFooter = `  </Document>
</kml>`;

        let placemarks = '';

        for (let i = 0; i < drawingsToExport.length; i++) {
            const graphic = drawingsToExport[i];
            const placemark = await this.convertGraphicToKMLPlacemark(graphic, i);
            if (placemark) {
                placemarks += placemark;
            }
            // Export the attached buffer polygon as its own placemark.
            const bufferGraphic = this.getAttachedBufferGraphic(graphic);
            if (bufferGraphic?.geometry) {
                const bufferPlacemark = await this.convertGraphicToKMLPlacemark(bufferGraphic, drawingsToExport.length + i);
                if (bufferPlacemark) {
                    placemarks += bufferPlacemark;
                }
            }
        }

        return kmlHeader + placemarks + kmlFooter;
    };

    // Convert a single graphic to KML Placemark
    private convertGraphicToKMLPlacemark = async (graphic: ExtendedGraphic, index: number): Promise<string | null> => {
        try {
            const name = graphic.attributes?.name || `Drawing ${index + 1}`;
            const notes = graphic.attributes?.notes || '';
            const description = notes
                ? `${this.getDrawingTypeLabel(graphic)} drawing\n\nNotes: ${notes}`
                : `${this.getDrawingTypeLabel(graphic)} drawing`;
            // Project geometry to WGS84
            const wgs84Geometry = await this.projectGeometryToWGS84Alternative(graphic.geometry);
            if (!wgs84Geometry) return null;
            const kmlGeometry = this.convertGeometryToKML(wgs84Geometry);
            if (!kmlGeometry) return null;

            // Generate KML Style block (with unique styleId)
            const styleId = `style_${index}`;
            let kmlStyle = `    <Style id="${styleId}">\n`;
            // Build IconStyle/LineStyle/PolyStyle similar to current generateKMLStyle:
            const sym = graphic.symbol;
            if (sym?.type === 'simple-marker') {
                const marker = sym as any;
                const markerColor = this.colorToKML(marker.color);
                kmlStyle += `      <IconStyle>\n        <color>${markerColor}</color>\n        <scale>${(marker.size || 12) / 12}</scale>\n      </IconStyle>\n`;
            } else if (sym?.type === 'simple-line') {
                const line = sym as any;
                const lineColor = this.colorToKML(line.color);
                kmlStyle += `      <LineStyle>\n        <color>${lineColor}</color>\n        <width>${line.width || 2}</width>\n      </LineStyle>\n`;
            } else if (sym?.type === 'simple-fill') {
                const fill = sym as any;
                const fillColor = this.colorToKML(fill.color);
                const outlineColor = fill.outline ? this.colorToKML(fill.outline.color) : 'ff000000';
                kmlStyle +=
                    `      <PolyStyle>\n        <color>${fillColor}</color>\n        <fill>1</fill>\n        <outline>1</outline>\n      </PolyStyle>\n` +
                    `      <LineStyle>\n        <color>${outlineColor}</color>\n        <width>${fill.outline?.width || 1}</width>\n      </LineStyle>\n`;
            } else if (sym?.type === 'text') {
                const textSym = sym as any;
                const textColor = this.colorToKML(textSym.color);
                // Scale label relative to 12pt default
                const scale = textSym.font?.size ? (textSym.font.size / 12) : 1;
                kmlStyle += `      <LabelStyle>\n        <color>${textColor}</color>\n        <scale>${scale.toFixed(2)}</scale>\n      </LabelStyle>\n`;
            }
            kmlStyle += `    </Style>\n`;

            // Build ExtendedData for unsupported symbology
            let extendedData = '';
            if (sym?.type === 'simple-marker') {
                const markerSym = sym as any;
                extendedData += `<Data name="marker_symbol"><value>${markerSym.style}</value></Data>`;
                // If marker color has partial transparency, store opacity (0-1)
                const markerAlpha = (markerSym.color as any)?.a;
                if (typeof markerAlpha === 'number' && markerAlpha < 1) {
                    extendedData += `<Data name="marker_opacity"><value>${markerAlpha}</value></Data>`;
                }
            }
            if (sym?.type === 'simple-line') {
                const lineSym = sym as any;
                if (lineSym.style && lineSym.style !== 'solid') {
                    extendedData += `<Data name="stroke_style"><value>${lineSym.style}</value></Data>`;
                }
                const lineAlpha = (lineSym.color as any)?.a;
                if (typeof lineAlpha === 'number' && lineAlpha < 1) {
                    extendedData += `<Data name="stroke_opacity"><value>${lineAlpha}</value></Data>`;
                }
            }
            if (sym?.type === 'simple-fill') {
                const fillSym = sym as any;
                const fillAlpha = (fillSym.color as any)?.a;
                if (typeof fillAlpha === 'number' && fillAlpha < 1) {
                    extendedData += `<Data name="fill_opacity"><value>${fillAlpha}</value></Data>`;
                }
                // Outline transparency and style if non-solid
                if (fillSym.outline) {
                    const olColor = fillSym.outline.color as any;
                    if (typeof olColor.a === 'number' && olColor.a < 1) {
                        extendedData += `<Data name="stroke_opacity"><value>${olColor.a}</value></Data>`;
                    }
                    const olStyle = (fillSym.outline as any).style;
                    if (olStyle && olStyle !== 'solid') {
                        extendedData += `<Data name="stroke_style"><value>${olStyle}</value></Data>`;
                    }
                }
            }
            if (sym?.type === 'text') {
                const textSym = sym as any;
                // Store text font properties that KML can't represent
                if (textSym.font?.weight) {
                    extendedData += `<Data name="text_weight"><value>${textSym.font.weight}</value></Data>`;
                }
                if (textSym.font?.style) {
                    extendedData += `<Data name="text_style"><value>${textSym.font.style}</value></Data>`;
                }
                if (textSym.font?.decoration) {
                    extendedData += `<Data name="text_decoration"><value>${textSym.font.decoration}</value></Data>`;
                }
                // Note: text size is already reflected in LabelStyle scale above
            }
            // Add notes to ExtendedData
            if (graphic.attributes?.notes) {
                extendedData += `<Data name="notes"><value>${this.escapeXML(graphic.attributes.notes)}</value></Data>`;
            }
            if (extendedData) {
                extendedData = `<ExtendedData>${extendedData}</ExtendedData>`;
            }

            // Assemble Placemark with name, description, styleUrl, ExtendedData, and geometry
            return `    <Placemark>
      <name>${this.escapeXML(name)}</name>
      <description>${this.escapeXML(description)}</description>
      <styleUrl>#${styleId}</styleUrl>
      ${extendedData}
        ${kmlGeometry}
            </Placemark>
        ${kmlStyle}`;
        } catch (error) {
            console.error('Error converting graphic to KML:', error);
            return null;
        }
    };

    // Convert geometry to KML format
    private convertGeometryToKML = (geometry: any): string | null => {
        try {
            switch (geometry.type) {
                case 'point':
                    const point = geometry as any;
                    const lon = point.longitude || point.x;
                    const lat = point.latitude || point.y;
                    return `      <Point>
        <coordinates>${lon.toFixed(8)},${lat.toFixed(8)},0</coordinates>
      </Point>`;

                case 'polyline':
                    const polyline = geometry as any;
                    const coords = polyline.paths[0].map(coord =>
                        `${coord[0].toFixed(8)},${coord[1].toFixed(8)},0`
                    ).join(' ');
                    return `      <LineString>
        <coordinates>${coords}</coordinates>
      </LineString>`;

                case 'polygon':
                    const polygon = geometry as any;
                    const ringCoords = polygon.rings[0].map(coord =>
                        `${coord[0].toFixed(8)},${coord[1].toFixed(8)},0`
                    ).join(' ');
                    return `      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${ringCoords}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>`;

                default:
                    console.warn(`Unsupported geometry type for KML: ${geometry.type}`);
                    return null;
            }
        } catch (error) {
            console.error('Error converting geometry to KML:', error);
            return null;
        }
    };

    // Generate KML style from ArcGIS symbol
    private generateKMLStyle = (symbol: any, styleId: string): string => {
        if (!symbol) return '';

        let kmlStyle = `    <Style id="${styleId}">
`;

        try {
            switch (symbol.type) {
                case 'simple-marker':
                    const marker = symbol as any;
                    const markerColor = this.colorToKML(marker.color);
                    kmlStyle += `      <IconStyle>
        <color>${markerColor}</color>
        <scale>${(marker.size || 12) / 12}</scale>
      </IconStyle>
`;
                    break;

                case 'simple-line':
                    const line = symbol as any;
                    const lineColor = this.colorToKML(line.color);
                    kmlStyle += `      <LineStyle>
        <color>${lineColor}</color>
        <width>${line.width || 2}</width>
      </LineStyle>
`;
                    break;

                case 'simple-fill':
                    const fill = symbol as any;
                    const fillColor = this.colorToKML(fill.color);
                    const outlineColor = fill.outline ? this.colorToKML(fill.outline.color) : 'ff000000';
                    kmlStyle += `      <PolyStyle>
        <color>${fillColor}</color>
        <fill>1</fill>
        <outline>1</outline>
      </PolyStyle>
      <LineStyle>
        <color>${outlineColor}</color>
        <width>${fill.outline?.width || 1}</width>
      </LineStyle>
`;
                    break;

                case 'text':
                    const text = symbol as any;
                    const textColor = this.colorToKML(text.color);
                    kmlStyle += `      <LabelStyle>
        <color>${textColor}</color>
        <scale>1</scale>
      </LabelStyle>
`;
                    break;
            }
        } catch (error) {
            console.warn('Error generating KML style:', error);
        }

        kmlStyle += `    </Style>
`;
        return kmlStyle;
    };

    // Convert ArcGIS Color to KML color format (aabbggrr)
    private colorToKML = (color: any): string => {
        if (!color) return 'ff000000';

        try {
            const rgba = color.toRgba ? color.toRgba() : [0, 0, 0, 1];
            const r = rgba[0].toString(16).padStart(2, '0');
            const g = rgba[1].toString(16).padStart(2, '0');
            const b = rgba[2].toString(16).padStart(2, '0');
            const a = Math.round(rgba[3] * 255).toString(16).padStart(2, '0');

            // KML format is aabbggrr (alpha, blue, green, red)
            return `${a}${b}${g}${r}`;
        } catch (error) {
            return 'ff000000';
        }
    };

    // Escape XML special characters
    private escapeXML = (str: string): string => {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };
    private continueDeleteGraphic = (index: number, graphicToDelete: ExtendedGraphic) => {
        try {
            //console.log(`➡️ Continuing deletion after SketchViewModel cancel`);

            // 🔧 STEP 1: Remove attached buffer IMMEDIATELY (before anything else)
            if (graphicToDelete.bufferGraphic) {
                //console.log(`🗑️ PRIORITY: Removing attached buffer first`);
                this.props.graphicsLayer.remove(graphicToDelete.bufferGraphic);
                graphicToDelete.bufferGraphic = null;
            }

            // Clear buffer settings
            if (graphicToDelete.bufferSettings) {
                graphicToDelete.bufferSettings = null;
            }

            // 🔧 STEP 1.5: Remove drawing label if it exists
            if (graphicToDelete.drawingLabel) {
                //console.log(`🗑️ Removing drawing label`);
                try {
                    this.props.graphicsLayer.remove(graphicToDelete.drawingLabel);
                } catch (e) {
                    console.warn('Could not remove drawing label:', e);
                }
                graphicToDelete.drawingLabel = null;
            }

            // 🔧 STEP 2: Remove geometry watchers to prevent buffer recreation
            const parentId = graphicToDelete.attributes?.uniqueId;
            if (parentId && this._positionWatchers) {
                Object.keys(this._positionWatchers).forEach(key => {
                    if (key.includes(parentId)) {
                        try {
                            this._positionWatchers[key].remove();
                            delete this._positionWatchers[key];
                            //console.log(`✅ Removed geometry watcher: ${key}`);
                        } catch (error) {
                            console.warn('Error removing geometry watcher:', error);
                        }
                    }
                });
            }

            // 🔧 STEP 2b: Remove buffer watcher (separate map from _positionWatchers).
            // Without this, the watcher closure keeps the deleted parent and the
            // panel alive until unmount.
            if (parentId) {
                const bw = (this as any)._bufferWatchers;
                if (bw && bw[parentId]) {
                    try { bw[parentId].remove(); } catch { /* no-op */ }
                    delete bw[parentId];
                }
            }

            // STEP 3: Clean up measurement labels
            //console.log(`🧹 Cleaning up measurement labels for graphic`);
            this.removeMeasurementLabels(graphicToDelete);

            // STEP 4: Find and remove ONLY the specific graphic from the layer
            const uniqueId = graphicToDelete.attributes?.uniqueId;

            if (uniqueId) {
                //console.log(`🔍 Looking for graphic with uniqueId: ${uniqueId}`);

                // Find the exact graphic in the layer by uniqueId
                const layerGraphics = this.props.graphicsLayer.graphics.toArray();
                const targetGraphic = layerGraphics.find(g =>
                    g.attributes?.uniqueId === uniqueId &&
                    !g.attributes?.isMeasurementLabel &&
                    !g.attributes?.hideFromList &&
                    !g.attributes?.isBuffer && // Make sure we don't accidentally target a buffer
                    !g.attributes?.isPreviewBuffer
                );

                if (targetGraphic) {
                    //console.log(`✅ Found target graphic in layer, removing it`);

                    // Mark that we're about to update the graphics layer
                    this.ignoreNextGraphicsUpdate = true;

                    // Remove ONLY the target graphic
                    this.props.graphicsLayer.remove(targetGraphic);

                    //console.log(`🗑️ Removed graphic from layer`);
                } else {
                    console.warn(`⚠️ Could not find graphic with uniqueId ${uniqueId} in layer`);
                }
            } else {
                console.warn(`⚠️ Graphic has no uniqueId, using fallback removal`);

                // Fallback: remove by reference (less reliable)
                this.ignoreNextGraphicsUpdate = true;
                this.props.graphicsLayer.remove(graphicToDelete);
            }

            // STEP 5: Perform aggressive cleanup for any remaining related graphics
            if (uniqueId) {
                setTimeout(() => {
                    this.performAggressiveMeasurementCleanup(uniqueId);
                }, 200);
            }

            // STEP 6: Update state manually for immediate feedback
            const updatedDrawings = [...this.state.drawings];
            updatedDrawings.splice(index, 1);

            // STEP 7: Update selected graphics
            const newSelected = new Set<number>();
            this.state.selectedGraphics.forEach(selectedIndex => {
                if (selectedIndex < index) {
                    newSelected.add(selectedIndex);
                } else if (selectedIndex > index) {
                    newSelected.add(selectedIndex - 1);
                }
            });

            // STEP 8: Update state and clear selections
            this.setState({
                drawings: updatedDrawings,
                selectedGraphicIndex: null,
                selectedGraphics: newSelected,
                symbolEditingIndex: null // Also clear any symbol editing
            }, () => {
                //console.log(`📊 Updated state - ${updatedDrawings.length} drawings remaining`);

                // Save to localStorage if consent granted
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }

                // Notify parent if needed
                if (this.props.onDrawingsUpdate) {
                    this.props.onDrawingsUpdate(updatedDrawings);
                }

                // Clear deletion flag
                this._isDeletingGraphic = false;

                // Verify the layer state after a longer delay to allow cleanup to complete
                setTimeout(() => {
                    this.verifyLayerState();
                }, 500);
            });

            //console.log(`✅ Deletion completed successfully with buffer-first approach`);

        } catch (error) {
            console.error('❌ Error during deletion continuation:', error);
            this._isDeletingGraphic = false;
            this.showLocalAlert(this.props.nls('errorDeletingDrawing'), 'error');
            this.refreshDrawingsFromLayer();
        }
    }
    private restoreSketchViewModelSelection = (graphic: ExtendedGraphic) => {
        if (!this.sketchViewModel || !graphic) return;

        try {
            // Small delay to ensure layer operations complete
            setTimeout(() => {
                if (this.sketchViewModel && !this._isDeletingGraphic) {
                    // Preserve graphics order during restore
                    this.preserveGraphicsOrder(() => {
                        this._isSelectingGraphic = true;
                        this.sketchViewModel.update([graphic]);
                        setTimeout(() => {
                            this._isSelectingGraphic = false;
                        }, 300);
                    });
                }
            }, 100);
        } catch (error) {
            console.warn('Could not restore SketchViewModel selection:', error);
        }
    };

    // Remove halo for a single graphic by index
    private removePointTextOverlayByIndex = (index?: number | null) => {
        if (index == null) return;
        const g = this.state.drawings?.[index] as ExtendedGraphic | undefined;
        this.removePointTextOverlay(g);
    };


    // Remove halos for all currently selected items (multi + single)
    private removeAllSelectionOverlays = () => {
        const set = this.state.selectedGraphics as Set<number> | undefined;
        if (set?.size) set.forEach(idx => this.removePointTextOverlayByIndex(idx));
        this.removePointTextOverlayByIndex(this.state.selectedGraphicIndex);
    };


    private bringOverlayToFront = (overlay?: any | null) => {
        if (!overlay || !this.props.graphicsLayer) return;
        try {
            this.props.graphicsLayer.remove(overlay);
            this.props.graphicsLayer.add(overlay); // last-in draws on top
        } catch { }
    };


    // Helper: remove halo overlay if present
    private removePointTextOverlay = (g?: ExtendedGraphic | null) => {
        if (!g || !this.props.graphicsLayer) return;
        if (g._selectionOverlay) {
            try { this.props.graphicsLayer.remove(g._selectionOverlay); } catch { }
            g._selectionOverlay = null;
        }
    };


    private performAggressiveMeasurementCleanup = (deletedGraphicId: string) => {
        if (!this.props.graphicsLayer) return;

        try {
            //console.log(`🧹 Performing aggressive measurement cleanup for graphic: ${deletedGraphicId}`);

            const allGraphics = this.props.graphicsLayer.graphics.toArray();
            let removedCount = 0;

            // Find all measurement labels that might be orphaned
            const potentialOrphans = allGraphics.filter(g => {
                const extG = g as ExtendedGraphic;
                return extG.attributes?.isMeasurementLabel;
            });

            //console.log(`🔍 Found ${potentialOrphans.length} total measurement labels in layer`);

            // For each measurement label, check if its parent still exists
            potentialOrphans.forEach(label => {
                const extLabel = label as ExtendedGraphic;
                const parentId = extLabel.attributes?.parentId;
                let shouldRemove = false;

                // Check if this label belongs to the deleted graphic
                if (parentId === deletedGraphicId) {
                    //console.log(`🎯 Found orphaned label with parentId: ${parentId}`);
                    shouldRemove = true;
                } else if (parentId) {
                    // Check if the parent still exists in the layer
                    const parentExists = allGraphics.some(g =>
                        g.attributes?.uniqueId === parentId &&
                        !g.attributes?.isMeasurementLabel
                    );

                    if (!parentExists) {
                        //console.log(`🎯 Found orphaned label - parent ${parentId} no longer exists`);
                        shouldRemove = true;
                    }
                } else {
                    // Label has no parentId - check if it has a measureParent reference
                    if (extLabel.measureParent) {
                        const parentUniqueId = extLabel.measureParent.attributes?.uniqueId;
                        if (parentUniqueId === deletedGraphicId) {
                            //console.log(`🎯 Found orphaned label via measureParent reference`);
                            shouldRemove = true;
                        } else {
                            // Check if measureParent still exists in layer
                            const parentExists = allGraphics.some(g =>
                                g.attributes?.uniqueId === parentUniqueId &&
                                !g.attributes?.isMeasurementLabel
                            );

                            if (!parentExists) {
                                //console.log(`🎯 Found orphaned label - measureParent no longer exists`);
                                shouldRemove = true;
                            }
                        }
                    } else {
                        // Label has no parent reference at all - it's likely orphaned
                        //console.log(`🎯 Found label with no parent reference - likely orphaned`);
                        shouldRemove = true;
                    }
                }

                if (shouldRemove) {
                    try {
                        this.props.graphicsLayer.remove(label);
                        removedCount++;
                        //console.log(`🗑️ Removed orphaned measurement label`);
                    } catch (err) {
                        console.warn('❌ Failed to remove orphaned label:', err);
                    }
                }
            });

            if (removedCount > 0) {
                //console.log(`✅ Aggressive cleanup completed - removed ${removedCount} orphaned measurement labels`);
            } else {
                //console.log(`✅ Aggressive cleanup completed - no orphaned labels found`);
            }

            // Force a final map refresh to ensure everything is clean
            setTimeout(() => {
                this.forceMapRefresh();
            }, 100);

        } catch (error) {
            console.error('❌ Error in aggressive measurement cleanup:', error);
        }
    };
    private measureRef: React.RefObject<any> | null = null; // Reference to measurement component
    private _measurementUpdateTimeout: any = null; // Timeout for debouncing measurement updates
    private _saveToStorageTimeout: any = null; // Debounce storage saves
    private _isUpdatingMeasurements: boolean = false; // Prevent concurrent updates
    private _measurementUpdateQueue: Set<string> = new Set(); // Queue graphics for updates
    private _processingMeasurements: boolean = false; // Prevent recursive processing
    private updateAttachedBuffer = async (parentGraphic: ExtendedGraphic) => {
        if (!parentGraphic.bufferGraphic || !parentGraphic.bufferSettings || !this.props.graphicsLayer) {
            return;
        }

        try {
            const { distance, unit } = parentGraphic.bufferSettings;

            //console.log(`🔄 Creating new buffer geometry for ${parentGraphic.attributes?.uniqueId}`);

            // Create new buffer geometry
            const newBufferGeometry = await this.createBufferGeometry(
                parentGraphic.geometry,
                distance,
                unit
            );

            if (newBufferGeometry) {
                // Update the buffer graphic's geometry immediately
                parentGraphic.bufferGraphic.geometry = newBufferGeometry;

                // Force layer refresh to ensure visual update
                this.props.graphicsLayer.remove(parentGraphic.bufferGraphic);
                this.props.graphicsLayer.add(parentGraphic.bufferGraphic);

                //console.log(`✅ Buffer geometry updated and refreshed for graphic ${parentGraphic.attributes?.uniqueId}`);
            }
        } catch (error) {
            console.error('❌ Error updating attached buffer:', error);
        }
    };
    private ensureBufferWatchersForSelectedGraphic = (graphic: ExtendedGraphic) => {
        // If the graphic has buffer settings, ensure geometry watcher is active
        if (graphic.bufferSettings && graphic.bufferSettings.enabled && graphic.bufferGraphic) {
            const parentId = graphic.attributes?.uniqueId;

            if (parentId) {
                //console.log(`🔧 MyDrawingsPanel: Ensuring buffer watcher for selected graphic: ${parentId}`);

                // Set up geometry watcher for real-time buffer updates
                const existingWatcher = this._positionWatchers[parentId + '_buffer'];
                if (existingWatcher) {
                    existingWatcher.remove();
                }

                // Create a geometry watcher specifically for buffer updates
                this._positionWatchers[parentId + '_buffer'] = graphic.watch('geometry', async (newGeometry) => {
                    //console.log(`🔄 MyDrawingsPanel: Geometry changed, updating buffer for ${parentId}`);

                    if (graphic.bufferGraphic && graphic.bufferSettings) {
                        try {
                            // Update buffer immediately
                            await this.updateAttachedBuffer(graphic);
                        } catch (error) {
                            console.error('❌ Error updating buffer from MyDrawingsPanel:', error);
                        }
                    }
                });
            }
        }
    };
    private createBufferGeometry = async (geometry: any, distance: number, unit: string): Promise<any | null> => {
        try {
            const view = this.props.jimuMapView?.view;
            if (!view) return null;
            const sr = view.spatialReference;
            geometry = _mdpDensifyIfCurve(geometry);

            // PRIMARY: geometryEngine — produces a TRUE buffer. Self-intersections
            // from a crossing/weird source shape are dissolved automatically, so the
            // reloaded buffer matches the one drawn initially (no even/odd fill
            // "lighter triangle" artifact). This is the path BufferControls uses on
            // first draw; without it the reload path looked different.
            try {
                const ge: any = (geometryEngine as any).default || geometryEngine;
                if (ge?.buffer) {
                    const useGeodesic = sr?.isGeographic || sr?.wkid === 4326;
                    const linearUnit = (unit || 'meters').toLowerCase().replace(/-/g, '');
                    const result = useGeodesic
                        ? (ge.geodesicBuffer ? ge.geodesicBuffer(geometry, distance, linearUnit) : ge.buffer(geometry, distance, linearUnit, true))
                        : ge.buffer(geometry, distance, linearUnit);
                    if (result) return Array.isArray(result) ? result[0] : result;
                }
            } catch (engineErr) {
                console.warn('createBufferGeometry: geometryEngine failed, using manual fallback', engineErr);
            }

            // FALLBACK: manual offset buffer, then simplify to dissolve self-intersections.
            const manual = _mdpManualBuffer(geometry, _mdpToMeters(distance, unit), sr);
            if (!manual) console.warn('Manual buffer returned null for:', geometry?.type);
            return _mdpSimplifyPolygonSafe(manual);
        } catch (error) {
            console.error('Error creating buffer geometry:', error);
            return null;
        }
    };

    private _geometryWatchTimeouts: { [key: string]: any } = {}; // Debounce geometry changes
    private performActualSave = (immediate = false) => {
        if (this.props.allowLocalStorage === false || this.state.consentGranted !== true) return;

        try {
            // Get ALL graphics from the layer (including measurement labels and buffers)
            const currentGraphics = this.props.graphicsLayer.graphics.toArray();

            // Separate main drawings from buffers and measurement labels
            const mainDrawings = currentGraphics.filter(g =>
                !g.attributes?.isMeasurementLabel &&
                !g.attributes?.hideFromList &&
                !g.attributes?.isPreviewBuffer &&
                !g.attributes?.isBuffer && // Exclude buffer graphics from main drawings
                !g.attributes?.isBufferDrawing
            );

            const measurementLabels = currentGraphics.filter(g =>
                g.attributes?.isMeasurementLabel &&
                !g.attributes?.isPreviewBuffer
            );

            // Don't save standalone buffer graphics since they'll be recreated from parent settings
            // Instead, save buffer settings with parent graphics

            // Prepare main drawings for storage with buffer settings
            // IMPORTANT: If hasManualOrder is true, save in current state order, not layer order
            let drawingsToSave;

            if (this.state.hasManualOrder) {
                // Save in the order specified by state.drawings (user's manual order)
                //console.log('💾 Saving drawings in manual order');
                drawingsToSave = this.state.drawings.map((drawing) => {
                    const extendedGraphic = asExtendedGraphic(drawing);
                    const json = drawing.toJSON();

                    // Ensure each graphic has a uniqueId
                    if (!json.attributes) {
                        json.attributes = {};
                    }
                    if (!json.attributes.uniqueId) {
                        const uniqueId = `restored_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
                        json.attributes.uniqueId = uniqueId;
                    }
                    if (!json.attributes.createdDate) {
                        json.attributes.createdDate = Date.now();
                    }

                    // 🔧 CRITICAL: Save buffer settings INCLUDING OPACITY AND LABEL STATE if this graphic has an attached buffer
                    if (extendedGraphic.bufferSettings) {
                        json.attributes.bufferSettings = {
                            distance: extendedGraphic.bufferSettings.distance,
                            unit: extendedGraphic.bufferSettings.unit,
                            enabled: extendedGraphic.bufferSettings.enabled,
                            opacity: extendedGraphic.bufferSettings.opacity,  // 🚨 CRITICAL: Include opacity in save
                            outlineOnly: extendedGraphic.bufferSettings.outlineOnly ?? false,
                            customColor: extendedGraphic.bufferSettings.customColor ?? null,
                            customOutlineColor: extendedGraphic.bufferSettings.customOutlineColor ?? null,
                            hasLabel: extendedGraphic.bufferLabel ? true : false  // 🔧 NEW: Track if label exists
                        };
                    }

                    // 🔧 NEW: Explicitly save visibility state
                    if (extendedGraphic.visible === false) {
                        json.attributes.isHidden = true;
                    }
                    // Save notes if present
                    if (extendedGraphic.attributes?.notes) {
                        json.attributes.notes = extendedGraphic.attributes.notes;
                    }

                    // 🔧 NEW: Save individual label option setting
                    if (extendedGraphic.attributes?.individualLabelOption) {
                        json.attributes.individualLabelOption = extendedGraphic.attributes.individualLabelOption;
                    }

                    // 🔧 NEW: Save measurement visibility state
                    if (extendedGraphic.attributes?.measurementsHidden) {
                        json.attributes.measurementsHidden = true;
                    }

                    // FIX #11: Save measurement unit metadata on parent drawing
                    if (extendedGraphic.attributes?.measurementUnits) {
                        json.attributes.measurementUnits = extendedGraphic.attributes.measurementUnits;
                    }

                    return json;
                });
            } else {
                // Save in layer order (default behavior)
                //console.log('💾 Saving drawings in layer order');
                drawingsToSave = mainDrawings.map((graphic) => {
                    const extendedGraphic = asExtendedGraphic(graphic);
                    const json = graphic.toJSON();

                    // Ensure each graphic has a uniqueId
                    if (!json.attributes) {
                        json.attributes = {};
                    }
                    if (!json.attributes.uniqueId) {
                        const uniqueId = `restored_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
                        json.attributes.uniqueId = uniqueId;
                    }
                    if (!json.attributes.createdDate) {
                        json.attributes.createdDate = Date.now();
                    }

                    // 🔧 CRITICAL: Save buffer settings INCLUDING OPACITY AND LABEL STATE if this graphic has an attached buffer
                    if (extendedGraphic.bufferSettings) {
                        json.attributes.bufferSettings = {
                            distance: extendedGraphic.bufferSettings.distance,
                            unit: extendedGraphic.bufferSettings.unit,
                            enabled: extendedGraphic.bufferSettings.enabled,
                            opacity: extendedGraphic.bufferSettings.opacity,  // 🚨 CRITICAL: Include opacity in save
                            outlineOnly: extendedGraphic.bufferSettings.outlineOnly ?? false,
                            customColor: extendedGraphic.bufferSettings.customColor ?? null,
                            customOutlineColor: extendedGraphic.bufferSettings.customOutlineColor ?? null,
                            hasLabel: extendedGraphic.bufferLabel ? true : false  // 🔧 NEW: Track if label exists
                        };
                    }

                    // 🔧 NEW: Explicitly save visibility state
                    if (extendedGraphic.visible === false) {
                        json.attributes.isHidden = true;
                    }
                    // Save notes if present
                    if (extendedGraphic.attributes?.notes) {
                        json.attributes.notes = extendedGraphic.attributes.notes;
                    }

                    // 🔧 NEW: Save individual label option setting
                    if (extendedGraphic.attributes?.individualLabelOption) {
                        json.attributes.individualLabelOption = extendedGraphic.attributes.individualLabelOption;
                    }

                    // 🔧 NEW: Save measurement visibility state
                    if (extendedGraphic.attributes?.measurementsHidden) {
                        json.attributes.measurementsHidden = true;
                    }

                    // FIX #11: Save measurement unit metadata on parent drawing
                    if (extendedGraphic.attributes?.measurementUnits) {
                        json.attributes.measurementUnits = extendedGraphic.attributes.measurementUnits;
                    }

                    return json;
                });
            }

            // Prepare measurement labels for storage WITH customization data
            const measurementLabelsToSave = measurementLabels.map((label) => {
                const extendedLabel = asExtendedGraphic(label);
                const json = label.toJSON();

                if (!json.attributes) {
                    json.attributes = {};
                }

                // Store the parent graphic's uniqueId for restoration
                if (extendedLabel.measureParent?.attributes?.uniqueId) {
                    json.attributes.parentGraphicId = extendedLabel.measureParent.attributes.uniqueId;
                }

                // Ensure measurement label flags are preserved
                json.attributes.isMeasurementLabel = true;
                json.attributes.hideFromList = true;

                // CRITICAL: Save customization flags and custom position data
                if (extendedLabel.attributes?.customized) {
                    json.attributes.customized = true;
                    json.attributes.lastModified = extendedLabel.attributes.lastModified;
                }

                if (extendedLabel.attributes?.hasCustomPosition && extendedLabel.attributes?.customPosition) {
                    json.attributes.hasCustomPosition = true;
                    json.attributes.customPosition = extendedLabel.attributes.customPosition;
                }

                // Save measurement type
                if (extendedLabel.attributes?.measurementType) {
                    json.attributes.measurementType = extendedLabel.attributes.measurementType;
                }

                // Save measurement units
                if (extendedLabel.attributes?.lengthUnit) {
                    json.attributes.lengthUnit = extendedLabel.attributes.lengthUnit;
                }
                if (extendedLabel.attributes?.areaUnit) {
                    json.attributes.areaUnit = extendedLabel.attributes.areaUnit;
                }

                // Explicitly persist segment-specific fields. label.toJSON() copies
                // the attributes object, but being explicit guards against future
                // changes to ExtendedGraphic and makes the saved shape unambiguous —
                // without these, a reload could lose segment identity and labels
                // would appear as generic measurement labels (or be skipped).
                if (extendedLabel.attributes?.isSegmentLabel) {
                    json.attributes.isSegmentLabel = true;
                }
                if (typeof extendedLabel.attributes?.segmentIndex === 'number') {
                    json.attributes.segmentIndex = extendedLabel.attributes.segmentIndex;
                }
                if (extendedLabel.attributes?.segmentInfo) {
                    json.attributes.segmentInfo = extendedLabel.attributes.segmentInfo;
                }

                return json;
            });

            // Update version to 1.5 and include manual order flag
            const allGraphicsToSave = {
                drawings: drawingsToSave,
                measurementLabels: measurementLabelsToSave,
                version: "1.5", // Updated version to support manual ordering
                hasManualOrder: this.state.hasManualOrder, // NEW: Save manual order preference
                sortOption: this.state.sortOption, // NEW: Save current sort option
                collapsedDrawings: Array.from(this.state.collapsedDrawings), // NEW: Save collapsed state
                drawingLabelOption: this.state.drawingLabelOption, // 🔧 NEW: Save global label setting
                lockedDrawings: Array.from(this.state.lockedDrawings), // Save locked drawings
                allDrawingsLocked: this.state.allDrawingsLocked // Save lock-all state
            };

            const storageKey = this.localStorageKey;

            // Save asynchronously when the browser is idle
            const saveFn = () => {
                try {
                    const stringified = JSON.stringify(allGraphicsToSave);
                    try {
                        localStorage.setItem(storageKey, stringified);
                    } catch (storageError) {
                        // FIX #12: Handle localStorage quota exceeded
                        if (storageError instanceof DOMException &&
                            (storageError.name === 'QuotaExceededError' || storageError.code === 22)) {
                            console.error('❌ localStorage quota exceeded. Attempting fallback save without measurement labels...');
                            // Fallback: save without measurement labels to at least preserve drawings
                            const fallbackData = {
                                ...allGraphicsToSave,
                                measurementLabels: []
                            };
                            try {
                                localStorage.setItem(storageKey, JSON.stringify(fallbackData));
                                this.showLocalAlert('Storage full - drawings saved but measurement labels were dropped. Consider clearing old drawings.', 'info');
                            } catch (fallbackError) {
                                console.error('❌ Cannot save drawings - localStorage quota exceeded even without labels:', fallbackError);
                                this.showLocalAlert('Storage full - unable to save drawings. Please delete some drawings to free space.', 'error');
                            }
                        } else {
                            throw storageError;
                        }
                    }
                } catch (stringifyError) {
                    console.error(`❌ Failed to stringify graphics for localStorage`, stringifyError);
                    this.showLocalAlert('Error saving drawings (stringify failed)', 'error');
                }
            };

            // Save immediately when requested (e.g., on unmount), otherwise defer
            if (immediate) {
                saveFn();
            } else if ('requestIdleCallback' in window) {
                (window as any).requestIdleCallback(saveFn, { timeout: 5000 });
            } else {
                setTimeout(saveFn, 0);
            }

        } catch (err) {
            console.error(`❌ Error preparing drawings for localStorage`, err);
            this.showLocalAlert('Error saving drawings', 'error');
        }
    };
    private debouncedMeasurementUpdate = (graphic: ExtendedGraphic, delay: number = 500) => {
        if (!graphic || !graphic.attributes?.uniqueId) return;

        // CRITICAL: Prevent loops by checking if we're already updating measurements
        if (this._isUpdatingMeasurements) {
            //console.log(`⏭️ Skipping measurement update - already in progress`);
            return;
        }

        const graphicId = graphic.attributes.uniqueId;

        // Clear any existing timeout for this graphic
        if (this._geometryWatchTimeouts[graphicId]) {
            clearTimeout(this._geometryWatchTimeouts[graphicId]);
        }

        // Set a new timeout
        this._geometryWatchTimeouts[graphicId] = setTimeout(() => {
            this.performSingleMeasurementUpdate(graphic);
            delete this._geometryWatchTimeouts[graphicId];
        }, delay);
    };
    /**
     * Safely update measurements with retry logic for measureRef availability
     */
    private safeUpdateMeasurements = (graphic: ExtendedGraphic, retryCount = 0, maxRetries = 10) => {
        if (!graphic) return;

        // 🔧 NEW: Skip if measurements are individually hidden for this drawing
        if (graphic.attributes?.measurementsHidden) return;

        const attemptUpdate = () => {
            if (this.measureRef?.current?.updateMeasurementsForGraphic) {
                try {
                    //console.log('🔧 [Safe Update] Updating measurements for:', graphic.attributes?.uniqueId);
                    this.measureRef.current.updateMeasurementsForGraphic(graphic);
                    return true;
                } catch (err) {
                    console.warn('❌ [Safe Update] Error updating measurements:', err);
                    return false;
                }
            }
            return false;
        };

        // Try to update immediately
        if (attemptUpdate()) {
            return;
        }

        // If failed and retries remaining, try again after a delay
        if (retryCount < maxRetries) {
            const delay = 100 * (retryCount + 1); // Exponential backoff: 100ms, 200ms, 300ms...
            setTimeout(() => {
                if (!attemptUpdate()) {
                    // Still not available, retry
                    this.safeUpdateMeasurements(graphic, retryCount + 1, maxRetries);
                }
            }, delay);
        } else {
            console.warn('⚠️ [Safe Update] measureRef.current.updateMeasurementsForGraphic not available after', maxRetries, 'retries');
        }
    };

    private performSingleMeasurementUpdate = (graphic: ExtendedGraphic) => {
        if (!graphic || !this.measureRef?.current || this._isUpdatingMeasurements) {
            return;
        }

        // 🔧 NEW: Skip if measurements are individually hidden for this drawing
        if (graphic.attributes?.measurementsHidden) return;

        // CRITICAL: Set flag to prevent re-entry
        this._isUpdatingMeasurements = true;

        const graphicId = graphic.attributes?.uniqueId || 'unknown';

        try {
            //console.log(`📐 Updating measurements for: ${graphic.attributes?.name || graphicId}`);

            // Call the measurement update but wrap it to handle any errors
            this.measureRef.current.updateMeasurementsForGraphic(graphic);

        } catch (error) {
            console.warn(`❌ Could not update measurements for ${graphicId}:`, error);
        } finally {
            // CRITICAL: Always clear the flag, even on error
            setTimeout(() => {
                this._isUpdatingMeasurements = false;
            }, 100); // Small delay to ensure measurement system has time to complete
        }
    };

    private cleanupOrphanedMeasurementLabels = () => {
        if (!this.props.graphicsLayer) return;

        //console.log('🧹 Starting automatic cleanup of orphaned measurement labels and buffers');

        try {
            const allGraphics = this.props.graphicsLayer.graphics.toArray();

            // Separate different types of graphics
            const actualDrawings = allGraphics.filter(g => {
                const extG = g as ExtendedGraphic;
                return !extG.attributes?.isMeasurementLabel &&
                    !extG.attributes?.hideFromList &&
                    !extG.attributes?.isBuffer &&
                    !extG.attributes?.isPreviewBuffer; // Also exclude preview buffers
            }) as ExtendedGraphic[];

            const measurementLabels = allGraphics.filter(g => {
                const extG = g as ExtendedGraphic;
                return extG.attributes?.isMeasurementLabel && !extG.attributes?.isBuffer;
            }) as ExtendedGraphic[];

            // 🔧 ENHANCED: Include ALL buffer types in cleanup
            const bufferGraphics = allGraphics.filter(g => {
                const extG = g as ExtendedGraphic;
                return extG.attributes?.isBuffer ||
                    extG.attributes?.isPreviewBuffer ||
                    extG.isBufferDrawing; // Legacy buffer drawings
            }) as ExtendedGraphic[];

            //console.log(`Found ${actualDrawings.length} drawings, ${measurementLabels.length} measurement labels, ${bufferGraphics.length} buffers`);

            // Create a set of valid parent IDs from actual drawings
            const validParentIds = new Set(
                actualDrawings
                    .map(drawing => drawing.attributes?.uniqueId)
                    .filter(id => id)
            );

            // Find orphaned measurement labels
            const orphanedLabels = measurementLabels.filter(label => {
                const parentId = label.attributes?.parentGraphicId ||
                    (label as any).measureParent?.attributes?.uniqueId;
                return !parentId || !validParentIds.has(parentId);
            });

            // 🔧 ENHANCED: Find orphaned buffers using multiple checks
            const orphanedBuffers = bufferGraphics.filter(buffer => {
                // Check parentId (for attached buffers)
                const parentId = buffer.attributes?.parentId;
                if (parentId && !validParentIds.has(parentId)) {
                    return true;
                }

                // Check sourceGraphicId (for legacy buffer drawings)
                const sourceId = (buffer as any).sourceGraphicId || buffer.attributes?.sourceGraphicId;
                if (sourceId && !validParentIds.has(sourceId)) {
                    return true;
                }

                // If no parent reference at all, it's likely orphaned
                if (!parentId && !sourceId) {
                    return true;
                }

                return false;
            });

            // Clean up orphaned items
            if (orphanedLabels.length > 0) {
                //console.log(`🗑️ Auto-removing ${orphanedLabels.length} orphaned measurement labels`);
                orphanedLabels.forEach(label => {
                    this.props.graphicsLayer.remove(label);
                });
            }

            if (orphanedBuffers.length > 0) {
                //console.log(`🗑️ Auto-removing ${orphanedBuffers.length} orphaned buffer graphics`);
                orphanedBuffers.forEach(buffer => {
                    this.props.graphicsLayer.remove(buffer);
                });
            }

            if (orphanedLabels.length === 0 && orphanedBuffers.length === 0) {
                //console.log('✅ No orphaned graphics found');
            } else {
                // Force a map refresh after cleanup
                this.forceMapRefresh();
                //console.log(`✅ Auto-cleanup completed - removed ${orphanedLabels.length} labels and ${orphanedBuffers.length} buffers`);
            }

        } catch (error) {
            console.error('❌ Error during automatic orphaned graphics cleanup:', error);
        }
    };
    private sessionPromptKey: string;
    private cleanupLocalStorageMeasurements = () => {
        if (this.props.allowLocalStorage === false || this.state.consentGranted !== true) return;

        try {
            const storageKey = this.localStorageKey;
            const savedData = localStorage.getItem(storageKey);

            if (!savedData) return;

            const parsedData = JSON.parse(savedData);

            // Handle all versioned formats that include drawings and measurementLabels
            const hasVersionedFormat = parsedData.version && parsedData.drawings && parsedData.measurementLabels;
            if (hasVersionedFormat) {
                const drawings = parsedData.drawings || [];
                const measurementLabels = parsedData.measurementLabels || [];

                // Create set of valid parent IDs from drawings
                const validParentIds = new Set(
                    drawings
                        .map(drawing => drawing.attributes?.uniqueId)
                        .filter(id => id)
                );

                // Filter out orphaned measurement labels
                const cleanedMeasurementLabels = measurementLabels.filter(label => {
                    const parentId = label.attributes?.parentGraphicId;
                    return parentId && validParentIds.has(parentId);
                });

                if (cleanedMeasurementLabels.length !== measurementLabels.length) {
                    //console.log(`🧹 Auto-cleaning localStorage: ${measurementLabels.length} -> ${cleanedMeasurementLabels.length} measurement labels`);

                    // Update localStorage with cleaned data
                    const cleanedData = {
                        ...parsedData,
                        measurementLabels: cleanedMeasurementLabels
                    };

                    localStorage.setItem(storageKey, JSON.stringify(cleanedData));
                    //console.log('✅ localStorage auto-cleaned successfully');
                }
            }

        } catch (error) {
            console.error('❌ Error auto-cleaning localStorage measurements:', error);
        }
    };

    constructor(props: MyDrawingsPanelProps) {
        super(props);

        // Initialize measureRef from props if provided
        if (props.measureRef) {
            this.measureRef = props.measureRef;
            //console.log('✅ measureRef initialized from props');
        } else {
            console.warn('⚠️ No measureRef provided in props');
        }

        // Build a unique, stable storage key for this app (origin + pathname)
        const fullUrl = `${window.location.origin}${window.location.pathname}`;
        const baseKey = btoa(fullUrl).replace(/[^a-zA-Z0-9]/g, '_');

        // If a key is provided via props, sanitize it; otherwise use the derived one
        const providedKey = this.props.localStorageKey
            ? String(this.props.localStorageKey).replace(/[^a-zA-Z0-9_-]/g, '_')
            : null;

        this.localStorageKey = providedKey ?? `drawings_${baseKey}`;
        this.lockStorageKey = `${this.localStorageKey}_locks`;

        // Per-session flag so the restore prompt shows only once per page load
        // Use the same scope as the storage key (global or app-specific)
        const sessionKeyBase = providedKey ? providedKey : baseKey;
        this.sessionPromptKey = `drawings_prompt_shown_${sessionKeyBase}`;

        // Read consent flag (guard against storage errors)
        let consentGranted: boolean | null = null;
        try {
            const consentValue = localStorage.getItem('drawingConsentGranted');
            consentGranted = consentValue === 'true' ? true
                : consentValue === 'false' ? false
                    : null;
        } catch {
            consentGranted = null;
        }

        // Detect if we have saved drawings for this key (for restore prompt)
        let hasExistingDrawings = false;
        try {
            hasExistingDrawings = !!localStorage.getItem(this.localStorageKey);
        } catch {
            hasExistingDrawings = false;
        }

        // Has the prompt been shown already in THIS browser session?
        let promptAlreadyShown = false;
        try {
            promptAlreadyShown = sessionStorage.getItem(this.sessionPromptKey) === '1';
        } catch {
            promptAlreadyShown = false;
        }

        // Show the prompt only once per session (and only if there are drawings and consent isn't explicitly denied)
        const showLoadPrompt = !promptAlreadyShown && hasExistingDrawings && consentGranted !== false;

        // Check if the graphics layer already has new (unsaved) drawings from this session
        const hasNewUnsavedDrawings = showLoadPrompt && !!(this.props.graphicsLayer && this.props.graphicsLayer.graphics.length > 0);

        // Mark as shown immediately so remounts (tab switches) won't re-trigger it
        if (showLoadPrompt) {
            try { sessionStorage.setItem(this.sessionPromptKey, '1'); } catch { }
        }

        this.state = {
            drawings: [],
            selectedGraphicIndex: null,
            sortOption: 'name',
            editingGraphicIndex: null,
            alertMessage: '',
            alertType: 'info',
            showAlert: false,
            consentGranted,
            graphicsWatchHandle: null,

            // Confirmation dialog
            confirmDialogOpen: false,
            confirmDialogAction: null,
            confirmDialogMessage: '',
            confirmDialogType: 'delete',
            confirmDialogItemIndex: null,

            // Import dialog
            importDialogOpen: false,
            importFile: null,
            importFileContent: null,

            // Selection
            selectedGraphics: new Set<number>(),
            symbolEditingIndex: null,
            showStorageDisclaimer: false,
            collapsedDrawings: new Set<number>(),

            // Text input
            textValue: '',

            // Text symbol style properties
            fontColor: 'rgba(0,0,0,1)',
            fontSize: 12,
            fontFamily: 'Arial',
            fontOpacity: 1,
            fontRotation: 0,

            // Text alignment
            horizontalAlignment: 'center',
            verticalAlignment: 'middle',

            // Alignment button states
            hAlignLeftActive: false,
            hAlignCenterActive: true,
            hAlignRightActive: false,
            vAlignBaseActive: false,
            vAlignTopActive: false,
            vAlignMidActive: true,
            vAlignBotActive: false,

            // Font style button states
            fsBoldActive: false,
            fsItalicActive: false,
            fsUnderlineActive: false,

            // Font style values
            fontWeight: 'normal',
            fontStyle: 'normal',
            fontDecoration: 'none',
            isBold: false,
            isItalic: false,
            isUnderline: false,

            // Halo properties
            fontHaloEnabled: false,
            fontHaloColor: 'rgba(255,255,255,1)',
            fontHaloSize: 1,
            fontHaloOpacity: 1,

            // TextSymbol object (used by the editor)
            currentTextSymbol: new TextSymbol({
                verticalAlignment: 'middle',
                font: { family: 'Arial', size: 12, style: 'normal', weight: 'normal', decoration: 'none' },
                text: 'Text',
                color: new Color('rgba(0,0,0,1)'),
                haloColor: null,
                haloSize: 0,
                angle: 0
            }),

            // Restore prompt
            showLoadPrompt,
            hasExistingDrawings,
            hasNewUnsavedDrawings,

            // Drag and drop initial state
            draggedIndex: null,
            dragOverIndex: null,
            hasManualOrder: true,
            listRenderKey: 0,
            toolbarCollapsed: false,

            // Export dropdown state - ADD THIS
            openDropdownIndex: null,
            dropdownOpenUpward: new Set(),

            // Search filter
            searchFilter: '',
            filterByMapExtent: false,
            thumbCache: new Map(),
            thumbGens: new Set(),

            // Notes dialog
            notesDialogOpen: false,
            notesEditingIndex: null,
            notesEditingText: '',

            // Drawing label option
            drawingLabelOption: 'off',
            notesSaveTimeout: null,

            // Import progress
            importInProgress: false,
            importProgress: 0,
            importProgressMessage: '',

            // Lock state - load from dedicated localStorage key immediately
            lockedDrawings: (() => {
                try {
                    const saved = localStorage.getItem(`${providedKey ?? `drawings_${baseKey}`}_locks`);
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        return new Set<string>(parsed.lockedDrawings || []);
                    }
                } catch { }
                return new Set<string>();
            })(),
            allDrawingsLocked: (() => {
                try {
                    const saved = localStorage.getItem(`${providedKey ?? `drawings_${baseKey}`}_locks`);
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        return parsed.allDrawingsLocked || false;
                    }
                } catch { }
                return false;
            })()
        };

        // Holder for goTo navigation cancels
        this._goToController = null;


        // ========================================================================
        // ⚡ PERFORMANCE: Initialize Debounced Functions
        // ========================================================================

        this.debouncedSave = debounce(() => {
            this.saveToLocalStorage();
        }, 300);

        this.debouncedGraphicsUpdate = debounce(() => {
            this.updateGraphicsLayerBatched();
        }, 100);

        this.throttledResize = throttle(() => {
            this.handleResize();
        }, 150);

    }

    toggleDropdown = (index: number | string): void => {
        const currentOpen = this.state.openDropdownIndex;
        const newOpenIndex = currentOpen === index ? null : index;

        // Determine if dropdown should open upward based on available space
        const newDropdownOpenUpward = new Set(this.state.dropdownOpenUpward);

        if (newOpenIndex !== null) {
            // Determine button ID based on dropdown type
            let triggerBtn: HTMLElement | null = null;

            // Handle both export and label dropdowns
            if (typeof index === 'string' && index.startsWith('label-')) {
                // Extract numeric index from string like "label-5"
                const numericIndex = index.replace('label-', '');
                triggerBtn = document.getElementById(`label-btn-${numericIndex}`);
            } else if (typeof index === 'number' || typeof index === 'string') {
                // Export dropdown
                triggerBtn = document.getElementById(`export-btn-${index}`);
            }

            const drawingList = document.querySelector('.drawing-list');

            if (triggerBtn && drawingList) {
                const btnRect = triggerBtn.getBoundingClientRect();
                const containerRect = drawingList.getBoundingClientRect();

                // Estimated dropdown height (based on menu items)
                // Label dropdown has 4 items: Default, Off, Name, Notes, Both = ~200px
                // Export dropdown has 3 items = ~180px
                const dropdownHeight = typeof index === 'string' && index.startsWith('label-') ? 220 : 180;

                // Calculate space below and above
                const spaceBelow = containerRect.bottom - btnRect.bottom;
                const spaceAbove = btnRect.top - containerRect.top;

                // Open upward if there's not enough space below AND there's more space above
                if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
                    newDropdownOpenUpward.add(index);
                } else {
                    newDropdownOpenUpward.delete(index);
                }
            }
        } else {
            // Clear the upward state when closing
            newDropdownOpenUpward.delete(index);
        }

        this.setState({
            openDropdownIndex: newOpenIndex,
            dropdownOpenUpward: newDropdownOpenUpward
        }, () => {
            // Add data attribute to parent drawing item for CSS targeting
            if (typeof index === 'number') {
                const drawingItem = document.getElementById(`drawing-item-${index}`);
                if (drawingItem) {
                    if (newOpenIndex !== null) {
                        drawingItem.setAttribute('data-dropdown-open', 'true');
                    } else {
                        drawingItem.removeAttribute('data-dropdown-open');
                    }
                }
            }

            // Clean up data attributes from all other drawing items when closing
            if (newOpenIndex === null) {
                document.querySelectorAll('.drawing-item[data-dropdown-open]').forEach(item => {
                    item.removeAttribute('data-dropdown-open');
                });
            }
        });
    };

    handleSearchFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ searchFilter: event.target.value });
    };

    clearSearchFilter = () => {
        this.setState({ searchFilter: '' });
    };

    toggleMapExtentFilter = () => {
        this.setState({ filterByMapExtent: !this.state.filterByMapExtent });
    };

    getFilteredDrawings = (): ExtendedGraphic[] => {
        const { drawings, searchFilter, filterByMapExtent } = this.state;

        let filteredDrawings = drawings;

        // First apply map extent filter if enabled
        if (filterByMapExtent && this.props.jimuMapView?.view) {
            const mapExtent = this.props.jimuMapView.view.extent;
            if (mapExtent) {
                filteredDrawings = filteredDrawings.filter((graphic) => {
                    if (!graphic.geometry) return false;

                    // Check if graphic intersects with map extent
                    const graphicExtent = graphic.geometry.extent;
                    if (!graphicExtent) {
                        // For point geometries without extent
                        if (graphic.geometry.type === 'point') {
                            const point = graphic.geometry as any;
                            return mapExtent.contains(point);
                        }
                        return false;
                    }

                    return mapExtent.intersects(graphicExtent);
                });
            }
        }

        // Then apply search filter
        if (!searchFilter.trim()) {
            return filteredDrawings;
        }

        const lowerFilter = searchFilter.toLowerCase().trim();

        return filteredDrawings.filter((graphic, index) => {
            // Search in name
            const name = graphic.attributes?.name || `Drawing ${index + 1}`;
            if (name.toLowerCase().includes(lowerFilter)) {
                return true;
            }

            // Search in type
            const type = graphic.geometry?.type || '';
            if (type.toLowerCase().includes(lowerFilter)) {
                return true;
            }

            // Search in description
            const description = graphic.attributes?.description || '';
            if (description.toLowerCase().includes(lowerFilter)) {
                return true;
            }

            // Search in import source
            const importSource = graphic.attributes?.importSource || '';
            if (importSource.toLowerCase().includes(lowerFilter)) {
                return true;
            }

            return false;
        });
    };

    handleClickOutsideDropdown = (event: MouseEvent) => {
        const target = event.target as HTMLElement;

        // Only close if we have an open dropdown
        if (this.state.openDropdownIndex === null) {
            return;
        }

        // Check if the click is inside the dropdown content
        const clickedInsideDropdownContent = target.closest('.export-dropdown-content');

        // Check if the click is on the export trigger button itself
        const clickedOnTriggerButton = target.closest('.export-trigger-btn');

        // If clicked inside dropdown menu or on trigger button, do nothing (let other handlers handle it)
        if (clickedInsideDropdownContent || clickedOnTriggerButton) {
            return;
        }

        // Close the dropdown for any other click
        this.setState({ openDropdownIndex: null }, () => {
            // Clean up data attributes on drawing items
            document.querySelectorAll('.drawing-item[data-dropdown-open]').forEach(item => {
                item.removeAttribute('data-dropdown-open');
            });
        });
    };

    componentDidMount() {
        // Initialize components if consent is already granted (true)
        if (this.state.consentGranted === true && this.props.jimuMapView && this.props.graphicsLayer) {
            // Check for existing drawings first, but only if choice wasn't already made
            if (MyDrawingsPanel._drawingsLoadChoiceTimestamp > 0 || !this.checkExistingDrawings()) {
                // If choice was already made or no existing drawings, initialize normally
                this.initializeComponents();
            }
        }

        // Add click-outside handler for export dropdowns
        document.addEventListener('click', this.handleClickOutsideDropdown);



        // ========================================================================
        // ⚡ PERFORMANCE: Add Passive Event Listeners
        // ========================================================================

        window.addEventListener('resize', this.throttledResize, { passive: true } as any);
        window.addEventListener('resize', this.clearCachedMeasurements, { passive: true } as any);

        // Flush pending saves on page unload to prevent order/data loss
        window.addEventListener('beforeunload', this._handleBeforeUnload);

    }

    /** Flush pending save synchronously on page unload */
    private _handleBeforeUnload = () => {
        if (this.props.allowLocalStorage !== false &&
            this.state.consentGranted === true &&
            this.state.drawings.length > 0) {
            this.performActualSave(true);
        }
    };

    handleDocumentClick = (e: MouseEvent) => {
        // Close label popper if clicking outside
        if (this.state.labelPopperOpen && this.state.labelPopperAnchor) {
            const target = e.target as HTMLElement;
            const anchor = this.state.labelPopperAnchor;

            // Check if click is outside both the anchor and the popper
            if (!anchor.contains(target)) {
                // Check if click is inside the popper menu
                const popperElements = document.querySelectorAll('[data-label-popper]');
                let isInsidePopper = false;
                popperElements.forEach(el => {
                    if (el.contains(target)) {
                        isInsidePopper = true;
                    }
                });

                if (!isInsidePopper) {
                    this.setState({ labelPopperOpen: false, labelPopperAnchor: null });
                }
            }
        }
    };


    private safeSketchViewModelUpdate = (graphics: any[]) => {
        if (!this.sketchViewModel || !graphics || graphics.length === 0) {
            return Promise.resolve();
        }

        try {
            // Validate graphics before updating
            const validGraphics = graphics.filter(graphic => {
                return graphic &&
                    graphic.geometry &&
                    graphic.symbol &&
                    !graphic.destroyed &&
                    graphic.layer === this.props.graphicsLayer;
            });

            if (validGraphics.length === 0) {
                return Promise.resolve();
            }

            // Create the update operation with error handling
            const updatePromise = this.sketchViewModel.update(validGraphics);

            // Handle the promise to prevent uncaught errors
            if (updatePromise && typeof updatePromise.catch === 'function') {
                return updatePromise.catch(error => {
                    console.warn('SketchViewModel update error (handled):', error);
                    // Don't re-throw, just handle silently
                    return Promise.resolve();
                });
            }

            return Promise.resolve();
        } catch (error) {
            console.warn('SketchViewModel update error (caught):', error);
            return Promise.resolve();
        }
    };

    toggleToolbar = () => {
        this.setState({ toolbarCollapsed: !this.state.toolbarCollapsed });
    };

    componentDidUpdate(prevProps: MyDrawingsPanelProps, prevState: MyDrawingsPanelState) {
        // If consent changed from null to true, check for existing drawings first
        if (prevState.consentGranted !== true && this.state.consentGranted === true) {
            if (this.props.jimuMapView && this.props.graphicsLayer) {
                // Check if choice was already made in this page session
                if (MyDrawingsPanel._drawingsLoadChoiceTimestamp > 0 || !this.checkExistingDrawings()) {
                    // If choice was already made or no existing drawings, initialize normally
                    this.initializeComponents();
                }
            }
        }

        // Check if the graphics layer or map view changed (only if consent is granted)
        if (this.state.consentGranted === true && !this.state.showLoadPrompt) {
            if (prevProps.graphicsLayer !== this.props.graphicsLayer && this.props.graphicsLayer) {
                // Remove previous watch handle if it exists
                if (this.state.graphicsWatchHandle) {
                    this.state.graphicsWatchHandle.remove();
                }

                this.setupGraphicsWatcher();
                this.refreshDrawingsFromLayer();
            }

            if (prevProps.jimuMapView !== this.props.jimuMapView && this.props.jimuMapView) {
                this.initializeComponents();
            }
        }

        // Reposition SymbolSelector popper when it opens
        if (this.state.selectedGraphicIndex !== null && prevState.selectedGraphicIndex !== this.state.selectedGraphicIndex) {
            // Wait for the popper to render
            setTimeout(() => {
                this.repositionSymbolPopper();
            }, 100);
            setTimeout(() => {
                this.repositionSymbolPopper();
            }, 300);
        }

        // 🔧 NEW: Restore measurement associations when tab becomes active
        if (this.props.isActiveTab && !prevProps.isActiveTab) {
            //console.log('📊 My Drawings tab became active - restoring measurement associations');
            setTimeout(() => {
                this.restoreMeasurementAssociations();
            }, 100);
        }
        // ✅ Enable or disable map popups based on tab activity
        //if (prevProps.isActiveTab !== this.props.isActiveTab && this.props.jimuMapView?.view) {
        //this.props.jimuMapView.view.popupEnabled = !this.props.isActiveTab;
        //}
    }

    repositionSymbolPopper = () => {
        const drawingList = document.querySelector('.drawing-list');
        if (!drawingList) return;

        const poppers = document.querySelectorAll('.jimu-popper') as NodeListOf<HTMLElement>;
        poppers.forEach(popper => {
            if (popper.offsetParent === null) return; // Skip hidden poppers

            // Only ever touch the SymbolSelector's own dropdown popper. On mobile,
            // Experience Builder renders WIDGET PANELS inside .jimu-popper
            // containers too — this widget's own bottom sheet and other widgets'
            // panels. Repositioning one of those yanks the entire panel to the
            // center of the screen (reported on iOS when opening My Drawings).
            if (popper.contains(drawingList)) return; // this widget's own panel
            if (popper.querySelector('.drawing-list, .jimu-widget, [data-widgetid], .widget-content')) return; // any widget panel
            // A popper as tall as the viewport is a sheet or panel, not a dropdown.
            const popperRect = popper.getBoundingClientRect();
            if (popperRect.height >= window.innerHeight * 0.8) return;

            const containerRect = drawingList.getBoundingClientRect();

            // Check if popper extends below the container
            if (popperRect.bottom > containerRect.bottom) {
                // Get the trigger element (try to find the symbol selector button)
                const symbolButtons = document.querySelectorAll('.symbol-selector button, [class*="symbol-selector"] button');
                let triggerButton: Element | null = null;

                symbolButtons.forEach(btn => {
                    const btnRect = btn.getBoundingClientRect();
                    // Check if this button is near the popper (within 50px)
                    if (Math.abs(btnRect.top - popperRect.top) < 200) {
                        triggerButton = btn;
                    }
                });

                if (triggerButton) {
                    const triggerRect = triggerButton.getBoundingClientRect();
                    const spaceBelow = containerRect.bottom - triggerRect.bottom;
                    const popperHeight = popperRect.height;

                    // If not enough space below, position it above or in viewport
                    if (spaceBelow < popperHeight + 20) {
                        // Calculate position above the button
                        const newTop = triggerRect.top - popperHeight - 10;
                        if (newTop > containerRect.top) {
                            popper.style.top = `${newTop}px`;
                        } else {
                            // Center in viewport if no room above or below
                            const viewportHeight = window.innerHeight;
                            const centeredTop = Math.max(20, (viewportHeight - popperHeight) / 2);
                            popper.style.top = `${centeredTop}px`;
                            popper.style.left = '50%';
                            popper.style.transform = 'translateX(-50%)';
                        }
                    }
                }
            }
        });
    };

    componentWillUnmount() {

        // ========================================================================
        // ⚡ PERFORMANCE: Flush Pending Save, Then Cancel Operations and Clean Up
        // ========================================================================

        // CRITICAL: Flush any pending save BEFORE unmounting so manual order changes
        // aren't lost when switching tabs (MyDrawingsPanel unmounts on tab switch)
        if ((this.debouncedSave as any).cancel) {
            (this.debouncedSave as any).cancel();
        }
        // Perform an immediate synchronous save if there are drawings to persist
        if (this.props.allowLocalStorage !== false &&
            this.state.consentGranted === true &&
            this.state.drawings.length > 0) {
            this.performActualSave(true);
        }

        if ((this.debouncedGraphicsUpdate as any).cancel) {
            (this.debouncedGraphicsUpdate as any).cancel();
        }

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
        }

        window.removeEventListener('resize', this.throttledResize);
        window.removeEventListener('resize', this.clearCachedMeasurements);
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        document.removeEventListener('mousemove', this.handleNotesDialogMouseMove);
        document.removeEventListener('mouseup', this.handleNotesDialogMouseUp);
        document.removeEventListener('mousemove', this.handleTextStyleDialogMouseMove);
        document.removeEventListener('mouseup', this.handleTextStyleDialogMouseUp);

        this.thumbnailCache.clear();
        this.cachedMeasurements = new WeakMap();



        // Clear measurement update flag
        this._isUpdatingMeasurements = false;

        // Clean up save timeout
        if (this._saveToStorageTimeout) {
            clearTimeout(this._saveToStorageTimeout);
            this._saveToStorageTimeout = null;
        }

        // Clean up measurement update timeout
        if (this._measurementUpdateTimeout) {
            clearTimeout(this._measurementUpdateTimeout);
            this._measurementUpdateTimeout = null;
        }

        // Clear geometry watch timeouts
        if (this._geometryWatchTimeouts) {
            Object.values(this._geometryWatchTimeouts).forEach(timeout => {
                if (timeout) clearTimeout(timeout);
            });
            this._geometryWatchTimeouts = {};
        }

        // Stop the map click sync process
        this._mapClickSyncEnabled = false;

        // Clean up measurement style watcher
        if (this._measurementStyleWatcher) {
            this._measurementStyleWatcher.remove();
            this._measurementStyleWatcher = null;
        }

        // Reset the measurement styles initialization flag
        this.measurementStylesInitialized = false;

        // Clean up watch handle
        if (this.state.graphicsWatchHandle) {
            this.state.graphicsWatchHandle.remove();
        }

        // Clean up position watchers
        if (this._positionWatchers) {
            Object.values(this._positionWatchers).forEach(watcher => {
                if (watcher) watcher.remove();
            });
            this._positionWatchers = {};
        }

        // Clean up graphics watch handles
        if (this._graphicsWatchHandles) {
            this._graphicsWatchHandles.forEach(handle => {
                if (handle) handle.remove();
            });
            this._graphicsWatchHandles = [];
        }

        // 🔧 MEMORY FIX: tear down listeners registered in setupInteractionManager,
        // setupMapQualityManager, and the SVM watch/on calls in this component.
        // Each of these previously leaked on every widget remount or map view switch.
        if (this._interactionHandles) {
            this._interactionHandles.forEach(h => { try { h?.remove(); } catch { /* no-op */ } });
            this._interactionHandles = [];
        }
        if (this._mapQualityHandles) {
            this._mapQualityHandles.forEach(h => { try { h?.remove(); } catch { /* no-op */ } });
            this._mapQualityHandles = [];
        }
        if (this._svmListenerHandles) {
            this._svmListenerHandles.forEach(h => { try { h?.remove(); } catch { /* no-op */ } });
            this._svmListenerHandles = [];
        }

        // Clean up buffer geometry watchers (one per attached buffer). Without this
        // they survive unmount and the closures keep the panel, layer, and graphic
        // alive across long sessions — a steady leak with every restore cycle.
        const bufferWatchers = (this as any)._bufferWatchers;
        if (bufferWatchers) {
            Object.keys(bufferWatchers).forEach(key => {
                try { bufferWatchers[key]?.remove(); } catch { /* no-op */ }
                delete bufferWatchers[key];
            });
            (this as any)._bufferWatchers = {};
        }

        // Clear any pending timeouts
        if (this._savePositionTimeout) {
            clearTimeout(this._savePositionTimeout);
            this._savePositionTimeout = null;
        }

        // Clean up AbortController for goTo operations
        if (this._goToController) {
            this._goToController.abort();
            this._goToController = null;
        }

        // Clean up SketchViewModel ONLY if we created it internally
        if (this.sketchViewModel && this.internalSketchVM) {
            this.sketchViewModel.destroy();
        }

        // 🔑 Cancel any active sketch session
        try { this.sketchViewModel?.cancel(); } catch { }

        // 🔑 Remove all selection halos from point/text graphics
        if (typeof this.removeAllSelectionOverlays === 'function') {
            this.removeAllSelectionOverlays();
        }

        // Remove click-outside handler for export dropdowns
        document.removeEventListener('click', this.handleClickOutsideDropdown);
    }


    recreateAttachedBuffer = async (parentGraphic: ExtendedGraphic, restored: boolean = true) => {
        if (!parentGraphic.bufferSettings || !this.props.graphicsLayer) {
            //console.log(`❌ Cannot recreate buffer - missing settings or layer`);
            return;
        }

        const { distance, unit, enabled, opacity, outlineOnly, customColor, customOutlineColor } = parentGraphic.bufferSettings;

        if (!enabled) {
            //console.log(`⏭️ Buffer disabled for graphic ${parentGraphic.attributes?.uniqueId}`);
            return;
        }

        // 🔧 CRITICAL: Use the saved opacity from buffer settings, fallback to 50% only if undefined
        const savedOpacity = opacity !== undefined ? opacity : 50;

        try {
            //console.log(`🔄 Recreating buffer for graphic ${parentGraphic.attributes?.uniqueId} with ${savedOpacity}% opacity (restored: ${restored})`);

            const bufferGeometry = await this.createBufferGeometry(parentGraphic.geometry, distance, unit);
            if (!bufferGeometry) {
                console.warn(`❌ Failed to recreate buffer geometry for graphic ${parentGraphic.attributes?.uniqueId}`);
                return;
            }

            // 🔧 CRITICAL: Update buffer settings to include the saved opacity BEFORE creating the symbol
            parentGraphic.bufferSettings = {
                distance: distance,
                unit: unit,
                enabled: enabled,
                opacity: savedOpacity,  // Ensure this is set before creating the symbol
                outlineOnly: outlineOnly ?? false,
                customColor: customColor ?? null,
                customOutlineColor: customOutlineColor ?? null
            };

            // Create buffer symbol using parent graphic's colors AND saved opacity
            const bufferSymbol = this.createBufferSymbolFromParent(parentGraphic);

            const bufferGraphic = new Graphic({
                geometry: bufferGeometry,
                symbol: bufferSymbol,
                attributes: {
                    uniqueId: `buffer_${parentGraphic.attributes?.uniqueId}_${Date.now()}`,
                    name: `${parentGraphic.attributes?.name || 'Drawing'} Buffer`,
                    parentId: parentGraphic.attributes?.uniqueId,
                    isBuffer: true,
                    hideFromList: true,
                    isMeasurementLabel: false,
                    bufferDistance: distance,
                    bufferUnit: unit
                }
            });

            const extendedBufferGraphic = asExtendedGraphic(bufferGraphic);
            extendedBufferGraphic.isBufferDrawing = true;
            extendedBufferGraphic.sourceGraphicId = parentGraphic.attributes?.uniqueId;

            // 🔧 NEW: Inherit visibility from parent graphic
            extendedBufferGraphic.visible = parentGraphic.visible !== false;

            parentGraphic.bufferGraphic = extendedBufferGraphic;

            const parentIndex = this.props.graphicsLayer.graphics.indexOf(parentGraphic);
            if (parentIndex >= 0) {
                this.props.graphicsLayer.graphics.add(extendedBufferGraphic, parentIndex);
            } else {
                this.props.graphicsLayer.add(extendedBufferGraphic);
            }

            // Set up geometry watcher so buffer tracks parent when moved.
            // Without this, restored drawings have no watcher and buffers
            // stay at their original position when the parent is moved.
            const watchId = parentGraphic.attributes?.uniqueId;
            if (watchId) {
                // Remove any stale watcher first
                if ((this as any)._bufferWatchers?.[watchId]) {
                    try { (this as any)._bufferWatchers[watchId].remove(); } catch { }
                }
                if (!(this as any)._bufferWatchers) (this as any)._bufferWatchers = {};
                (this as any)._bufferWatchers[watchId] = parentGraphic.watch('geometry', async () => {
                    if (!parentGraphic.bufferGraphic || !parentGraphic.bufferSettings) return;
                    const layer = this.props.graphicsLayer;
                    if (!layer) return;
                    try {
                        const { distance, unit } = parentGraphic.bufferSettings;
                        const geom = await this.createBufferGeometry(parentGraphic.geometry, distance, unit);
                        if (!geom) return;
                        const buf = parentGraphic.bufferGraphic as any;
                        layer.remove(buf);
                        buf.geometry = geom;
                        const pi = layer.graphics.indexOf(parentGraphic);
                        if (pi >= 0) layer.graphics.add(buf, pi); else layer.add(buf);
                    } catch (e) { console.warn('Buffer watcher update failed:', e); }
                });
            }

        } catch (error) {
            console.error('❌ Error recreating attached buffer:', error);
        }
    };

    recreateBufferLabel = (parentGraphic: ExtendedGraphic) => {
        if (!parentGraphic.bufferGraphic || !parentGraphic.bufferSettings || !this.props.graphicsLayer) {
            return;
        }

        try {
            const layer = this.props.graphicsLayer;
            const distance = parentGraphic.bufferSettings.distance;
            const unit = parentGraphic.bufferSettings.unit;

            // Remove existing label if present
            if (parentGraphic.bufferLabel) {
                try {
                    layer.remove(parentGraphic.bufferLabel);
                    parentGraphic.bufferLabel = null;
                } catch { }
            }

            // Get label position
            const labelPoint = this.getLabelPointForBuffer(parentGraphic.geometry, parentGraphic.bufferGraphic.geometry);
            if (!labelPoint) return;

            // Format unit display
            const unitDisplay = this.formatBufferUnit(distance, unit);
            const labelText = `${distance} ${unitDisplay}`;

            // Create text symbol
            const textSymbol = new TextSymbol({
                text: labelText,
                color: new Color([0, 0, 0, 1]),
                haloColor: new Color([255, 255, 255, 1]),
                haloSize: 2,
                font: {
                    size: 14,
                    family: 'Arial'
                }
            });

            const labelGraphic = new Graphic({
                geometry: labelPoint,
                symbol: textSymbol,
                attributes: {
                    uniqueId: `buffer_label_${parentGraphic.attributes?.uniqueId}_${Date.now()}`,
                    name: `Buffer Label: ${labelText}`,
                    parentId: parentGraphic.attributes?.uniqueId,
                    isBufferLabel: true,
                    hideFromList: true,
                    isMeasurementLabel: false
                }
            });

            // 🔧 CRITICAL: Inherit visibility from parent
            labelGraphic.visible = parentGraphic.visible !== false;

            layer.add(labelGraphic);
            parentGraphic.bufferLabel = labelGraphic;

            //console.log(`✅ Recreated buffer label for graphic ${parentGraphic.attributes?.uniqueId}`);
        } catch (error) {
            console.error('❌ Error recreating buffer label:', error);
        }
    };

    getLabelPointForBuffer = (originalGeometry: any, bufferGeometry: any): any | null => {
        if (!originalGeometry || !bufferGeometry) return null;

        try {
            let bufferCenter: any | null = null;

            if ('centroid' in bufferGeometry) {
                bufferCenter = (bufferGeometry as any).centroid;
            } else if ((bufferGeometry as any).extent?.center) {
                bufferCenter = (bufferGeometry as any).extent.center;
            }

            if (!bufferCenter) return null;

            const bufferExtent = (bufferGeometry as any).extent;
            if (bufferExtent) {
                const offsetY = (bufferExtent.ymax - bufferCenter.y) * 0.7;
                return new Point({
                    x: bufferCenter.x,
                    y: bufferCenter.y + offsetY,
                    spatialReference: bufferGeometry.spatialReference
                });
            }

            return bufferCenter;
        } catch (e) {
            console.error('Error calculating label point', e);
            return null;
        }
    };

    formatBufferUnit = (distance: number, unit: string): string => {
        const singularForms: { [key: string]: string } = {
            'feet': 'Foot',
            'meters': 'Meter',
            'miles': 'Mile',
            'kilometers': 'Kilometer'
        };

        const pluralForms: { [key: string]: string } = {
            'feet': 'Feet',
            'meters': 'Meters',
            'miles': 'Miles',
            'kilometers': 'Kilometers'
        };

        if (distance === 1) {
            return singularForms[unit] || unit.charAt(0).toUpperCase() + unit.slice(1);
        } else {
            return pluralForms[unit] || unit.charAt(0).toUpperCase() + unit.slice(1);
        }
    };

    // ===== DRAWING LABEL METHODS =====

    /**
     * Get the label point for a drawing based on its geometry type
     */
    getLabelPointForDrawing = (geometry: any): any | null => {
        if (!geometry) return null;

        try {
            if (geometry.type === 'point') {
                return geometry as any;
            } else if ('centroid' in geometry) {
                return (geometry as any).centroid;
            } else if ((geometry as any).extent?.center) {
                return (geometry as any).extent.center;
            }
            return null;
        } catch (error) {
            console.error('Error getting label point for drawing:', error);
            return null;
        }
    };

    /**
     * Create or update a label for a drawing
     */
    createDrawingLabel = (graphic: ExtendedGraphic) => {
        const { drawingLabelOption } = this.state;
        const { graphicsLayer } = this.props;

        if (!graphicsLayer) {
            return;
        }

        // Determine which label option to use
        // Individual setting takes precedence, 'default' means use global setting
        const individualOption = graphic.attributes?.individualLabelOption;
        let effectiveLabelOption: 'off' | 'name' | 'notes' | 'both';

        if (individualOption && individualOption !== 'default') {
            // Use individual setting
            effectiveLabelOption = individualOption as 'off' | 'name' | 'notes' | 'both';
        } else {
            // Use global setting
            effectiveLabelOption = drawingLabelOption;
        }

        //console.log(`🏷️ createDrawingLabel for ${graphic.attributes?.name || 'unnamed'} - individual: ${individualOption}, global: ${drawingLabelOption}, effective: ${effectiveLabelOption}`);

        // If effective option is off, remove any existing label and return
        if (effectiveLabelOption === 'off') {
            if (graphic.drawingLabel) {
                try {
                    graphicsLayer.remove(graphic.drawingLabel);
                } catch (e) {
                    console.warn('Could not remove existing drawing label:', e);
                }
                graphic.drawingLabel = null;
            }
            return;
        }

        // Don't label buffer drawings, measurement labels, or items marked to hide from list
        if (graphic.attributes?.isBufferLabel ||
            graphic.attributes?.isMeasurementLabel ||
            graphic.attributes?.hideFromList ||
            graphic.isBufferDrawing) {
            return;
        }

        // Remove existing label if it exists
        if (graphic.drawingLabel) {
            try {
                graphicsLayer.remove(graphic.drawingLabel);
            } catch (e) {
                console.warn('Could not remove existing drawing label:', e);
            }
            graphic.drawingLabel = null;
        }

        // Get label text based on option
        let labelText = '';
        const name = graphic.attributes?.name || 'Unnamed';
        const notes = graphic.attributes?.notes || '';

        switch (effectiveLabelOption) {
            case 'name':
                labelText = name;
                break;
            case 'notes':
                labelText = notes || '(No notes)';
                break;
            case 'both':
                labelText = notes ? `${name}\n${notes}` : name;
                break;
            default:
                return;
        }

        // Get label position
        const labelPoint = this.getLabelPointForDrawing(graphic.geometry);
        if (!labelPoint) return;

        // Create text symbol with proper styling
        const textSymbol = new TextSymbol({
            text: labelText,
            color: new Color([0, 0, 0, 1]),
            haloColor: new Color([255, 255, 255, 1]),
            haloSize: 2,
            font: {
                size: 12,
                family: 'Arial',
                weight: 'bold'
            },
            verticalAlignment: 'bottom',
            yoffset: 8
        });

        // Create the label graphic
        const labelGraphic = new Graphic({
            geometry: labelPoint,
            symbol: textSymbol,
            attributes: {
                uniqueId: `drawing_label_${graphic.attributes?.uniqueId}_${Date.now()}`,
                name: `Label: ${name}`,
                parentId: graphic.attributes?.uniqueId,
                isDrawingLabel: true,
                hideFromList: true,
                isMeasurementLabel: false
            }
        });

        // Inherit visibility from parent
        labelGraphic.visible = graphic.visible !== false;

        // Add to layer and store reference
        try {
            graphicsLayer.add(labelGraphic);
            graphic.drawingLabel = labelGraphic;
            //console.log(`✅ Created label for ${graphic.attributes?.name || 'unnamed'} with text: "${labelText}"`);
        } catch (error) {
            console.error('Error adding drawing label:', error);
        }
    };

    /**
     * Update the position of a drawing's label when the drawing is moved
     */
    updateDrawingLabelPosition = (graphic: ExtendedGraphic) => {
        if (!graphic.drawingLabel || !graphic.geometry) {
            return;
        }

        try {
            // Calculate new label position based on updated geometry
            const labelPoint = this.getLabelPointForDrawing(graphic.geometry);
            if (labelPoint) {
                // Update the label's geometry to follow the drawing
                graphic.drawingLabel.geometry = labelPoint;
            }
        } catch (error) {
            console.warn('Error updating drawing label position:', error);
        }
    };

    /**
     * Update all drawing labels based on current option
     */
    updateAllDrawingLabels = () => {
        const { drawings, drawingLabelOption } = this.state;
        const { graphicsLayer } = this.props;

        //console.log(`🏷️ updateAllDrawingLabels called - option: ${drawingLabelOption}, drawings: ${drawings.length}`);

        if (!graphicsLayer) {
            console.warn('🏷️ No graphics layer available');
            return;
        }

        // If option is 'off', remove all drawing labels
        if (drawingLabelOption === 'off') {
            //console.log('🏷️ Label option is OFF - removing all labels');
            drawings.forEach(graphic => {
                if (graphic.drawingLabel) {
                    try {
                        graphicsLayer.remove(graphic.drawingLabel);
                    } catch (e) {
                        console.warn('Could not remove drawing label:', e);
                    }
                    graphic.drawingLabel = null;
                }
            });
            return;
        }

        // Otherwise, create/update labels for all drawings
        //console.log(`🏷️ Creating labels for ${drawings.length} drawings`);
        drawings.forEach((graphic, index) => {
            const individualOption = graphic.attributes?.individualLabelOption || 'default';
            //console.log(`🏷️ Drawing ${index}: individual option = ${individualOption}, name = ${graphic.attributes?.name || 'unnamed'}`);
            this.createDrawingLabel(graphic);
        });
        //console.log('🏷️ updateAllDrawingLabels completed');
    };

    /**
     * Handle change in drawing label option
     */
    handleDrawingLabelOptionChange = (value: string) => {
        const { drawings } = this.state;
        const { graphicsLayer } = this.props;

        // Reset all individual label options to 'default' when global setting changes
        drawings.forEach(graphic => {
            if (graphic.attributes) {
                graphic.attributes.individualLabelOption = 'default';
            }
        });

        // Update the graphics layer if it exists
        if (graphicsLayer) {
            drawings.forEach(graphic => {
                graphicsLayer.remove(graphic);
                graphicsLayer.add(graphic);
            });
        }

        this.setState({
            drawingLabelOption: value as 'off' | 'name' | 'notes' | 'both',
            drawings: [...drawings]
        }, () => {
            this.updateAllDrawingLabels();

            // Save to local storage
            if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                this.debouncedSave();
            }
        });
    };

    /**
     * Handle change in individual drawing label option
     */
    handleIndividualLabelOptionChange = (index: number, value: string) => {
        const { drawings } = this.state;
        const graphic = drawings[index];

        if (!graphic) return;

        // Update the graphic's individual label option
        if (!graphic.attributes) {
            graphic.attributes = {};
        }
        graphic.attributes.individualLabelOption = value;

        // Update the drawing in the layer
        this.props.graphicsLayer.remove(graphic);
        this.props.graphicsLayer.add(graphic);

        // Update state
        this.setState({ drawings: [...drawings] }, () => {
            // Update the label for this specific graphic
            this.createDrawingLabel(graphic);

            // Save to local storage
            if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                this.debouncedSave();
            }
        });
    };




    // Drag and drop handlers
    handleDragStart = (e: React.DragEvent, index: number) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
        this.setState({ draggedIndex: index });
    };

    handleDragEnd = (e: React.DragEvent) => {
        // Remove visual feedback
        if (e.currentTarget instanceof HTMLElement) {
            e.currentTarget.style.opacity = '1';
        }

        this.setState({ draggedIndex: null, dragOverIndex: null });
    };

    handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (this.state.draggedIndex !== index) {
            this.setState({ dragOverIndex: index });
        }
    };

    handleDragLeave = (e: React.DragEvent) => {
        // Only clear if we're leaving the entire item
        if (e.currentTarget === e.target) {
            this.setState({ dragOverIndex: null });
        }
    };

    // Zoom to drawing without selecting it
    zoomToDrawing = async (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const graphic = this.state.drawings[index];
        if (!graphic?.geometry || !this.props.jimuMapView?.view) return;

        try {
            await this.props.jimuMapView.view.when();

            let target: any | any = graphic.geometry as any;
            let scale: number;

            if (graphic.geometry.type !== 'point') {
                if ('centroid' in graphic.geometry) {
                    target = (graphic.geometry as any).centroid;
                } else if (graphic.geometry.extent?.center) {
                    target = graphic.geometry.extent.center;
                }
            }

            if (graphic.geometry.extent) {
                const extentWidth = graphic.geometry.extent.width;
                scale = extentWidth * 5;
                scale = Math.max(500, Math.min(50000, scale));
            } else {
                scale = 2000;
            }

            await this.props.jimuMapView.view.goTo(
                { target, scale },
                { animate: true, duration: 300 }
            );
        } catch (err) {
            if (err?.name !== 'AbortError' && err?.name !== 'view:goto-interrupted') {
                console.warn('Zoom to drawing failed:', err);
            }
        }
    };

    // Move drawing up in the list (swap with previous)
    moveDrawingUp = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (index <= 0) return; // Already at top

        const drawings = [...this.state.drawings];
        const movedItem = drawings[index];
        const targetIndex = index - 1;

        // Swap items
        drawings[index] = drawings[targetIndex];
        drawings[targetIndex] = movedItem;

        // Save uniqueId for selection restoration
        this.pendingSelectedId = movedItem.attributes?.uniqueId || null;

        // Update selected indices
        const newSelectedGraphics = new Set<number>();
        this.state.selectedGraphics.forEach(idx => {
            if (idx === index) newSelectedGraphics.add(targetIndex);
            else if (idx === targetIndex) newSelectedGraphics.add(index);
            else newSelectedGraphics.add(idx);
        });

        const newSelectedIndex = this.state.selectedGraphicIndex === index
            ? targetIndex
            : this.state.selectedGraphicIndex === targetIndex
                ? index
                : this.state.selectedGraphicIndex;

        this.ignoreNextGraphicsUpdate = true;
        this.setState({
            drawings,
            selectedGraphicIndex: newSelectedIndex,
            selectedGraphics: newSelectedGraphics,
            hasManualOrder: true
        }, () => {
            this.syncGraphicsLayerOrder();
            setTimeout(() => this.restoreSelectionAfterRefresh(), 400);
        });
    };

    // Move drawing down in the list (swap with next)
    moveDrawingDown = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (index >= this.state.drawings.length - 1) return; // Already at bottom

        const drawings = [...this.state.drawings];
        const movedItem = drawings[index];
        const targetIndex = index + 1;

        // Swap items
        drawings[index] = drawings[targetIndex];
        drawings[targetIndex] = movedItem;

        // Save uniqueId for selection restoration
        this.pendingSelectedId = movedItem.attributes?.uniqueId || null;

        // Update selected indices
        const newSelectedGraphics = new Set<number>();
        this.state.selectedGraphics.forEach(idx => {
            if (idx === index) newSelectedGraphics.add(targetIndex);
            else if (idx === targetIndex) newSelectedGraphics.add(index);
            else newSelectedGraphics.add(idx);
        });

        const newSelectedIndex = this.state.selectedGraphicIndex === index
            ? targetIndex
            : this.state.selectedGraphicIndex === targetIndex
                ? index
                : this.state.selectedGraphicIndex;

        this.ignoreNextGraphicsUpdate = true;
        this.setState({
            drawings,
            selectedGraphicIndex: newSelectedIndex,
            selectedGraphics: newSelectedGraphics,
            hasManualOrder: true
        }, () => {
            this.syncGraphicsLayerOrder();
            setTimeout(() => this.restoreSelectionAfterRefresh(), 400);
        });
    };

    // --- Add near top of class ---
    private pendingSelectedId: string | null = null;

    // --- Replace handleDrop ---
    handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        e.stopPropagation();

        const { draggedIndex } = this.state;
        if (draggedIndex === null || draggedIndex === dropIndex) {
            this.setState({ draggedIndex: null, dragOverIndex: null });
            return;
        }

        const drawings = [...this.state.drawings];
        const draggedItem = drawings[draggedIndex];
        drawings.splice(draggedIndex, 1);
        drawings.splice(dropIndex, 0, draggedItem);

        // Save uniqueId of item being moved so we can reselect it after refresh
        this.pendingSelectedId = draggedItem.attributes?.uniqueId || null;

        const movedIndex = drawings.indexOf(draggedItem);

        // Selection preservation logic
        const newSelectedGraphics = new Set<number>();
        if (this.state.selectedGraphics.has(draggedIndex)) newSelectedGraphics.add(movedIndex);
        this.state.selectedGraphics.forEach(idx => {
            if (idx !== draggedIndex) {
                let newIdx = idx;
                if (draggedIndex < dropIndex && idx > draggedIndex && idx <= dropIndex) newIdx--;
                else if (draggedIndex > dropIndex && idx >= dropIndex && idx < draggedIndex) newIdx++;
                newSelectedGraphics.add(newIdx);
            }
        });

        this.ignoreNextGraphicsUpdate = true;
        this.setState({
            drawings,
            selectedGraphicIndex: movedIndex,
            selectedGraphics: newSelectedGraphics,
            draggedIndex: null,
            dragOverIndex: null,
            hasManualOrder: true
        }, () => {
            this.syncGraphicsLayerOrder();
            // Wait for any refresh events to settle, then re-select graphic by ID
            setTimeout(() => this.restoreSelectionAfterRefresh(), 400);
        });
    };

    // --- Add this helper method below ---
    private restoreSelectionAfterRefresh() {
        if (!this.pendingSelectedId) return;

        const drawings = this.state.drawings;
        const idx = drawings.findIndex(
            g => g.attributes?.uniqueId === this.pendingSelectedId
        );
        if (idx >= 0) {
            this.setState({
                selectedGraphicIndex: idx,
                selectedGraphics: new Set([idx])
            });
        }
        this.pendingSelectedId = null;
    }


    // Debug method to verify layer order matches state order
    verifyLayerOrder = () => {
        if (!this.props.graphicsLayer) return;

        const layerGraphics = this.props.graphicsLayer.graphics.toArray();
        const mainLayerGraphics = layerGraphics.filter(g =>
            !g.attributes?.isMeasurementLabel &&
            !g.attributes?.hideFromList &&
            !g.attributes?.isBuffer &&
            !g.attributes?.isPreviewBuffer
        );

        //console.log('🔍 Layer Order Verification:');
        //console.log('State Order:');
        this.state.drawings.forEach((d, i) => {
            //console.log(`  ${i + 1}. ${d.attributes?.name || 'Unnamed'} (${d.attributes?.uniqueId})`);
        });

        //console.log('Layer Order (as added - reversed for rendering):');
        mainLayerGraphics.forEach((g, i) => {
            //console.log(`  ${i + 1}. ${g.attributes?.name || 'Unnamed'} (${g.attributes?.uniqueId})`);
        });

        // FIXED: Since we add graphics in reverse order, we need to reverse the layer array to compare
        const reversedLayerGraphics = [...mainLayerGraphics].reverse();

        //console.log('Layer Order (as rendered - top to bottom):');
        reversedLayerGraphics.forEach((g, i) => {
            //console.log(`  ${i + 1}. ${g.attributes?.name || 'Unnamed'} (${g.attributes?.uniqueId})`);
        });

        // Check if orders match (comparing state order with REVERSED layer order)
        const orderMatches = reversedLayerGraphics.every((g, i) => {
            return g.attributes?.uniqueId === this.state.drawings[i]?.attributes?.uniqueId;
        });

        if (orderMatches) {
            //console.log('✅ Layer order matches state order');
        } else {
            //console.log('❌ Layer order does NOT match state order');
            //console.log('⚠️ This may indicate a sync issue - the visual order on map should still be correct');
        }
    };

    // Sync graphics layer order to match drawings array order
    syncGraphicsLayerOrder = () => {
        if (!this.props.graphicsLayer) return;

        try {
            //console.log('🔄 Syncing graphics layer order...');

            this.ignoreNextGraphicsUpdate = true;

            // Get all graphics from layer
            const allGraphics = this.props.graphicsLayer.graphics.toArray();

            // Create maps for quick lookup
            const measurementLabelsMap = new Map<string, ExtendedGraphic[]>();
            const buffersMap = new Map<string, ExtendedGraphic>();

            // Categorize all graphics
            allGraphics.forEach(g => {
                const extG = g as ExtendedGraphic;

                if (extG.attributes?.isMeasurementLabel) {
                    const parentId = extG.attributes?.parentGraphicId;
                    if (parentId) {
                        if (!measurementLabelsMap.has(parentId)) {
                            measurementLabelsMap.set(parentId, []);
                        }
                        measurementLabelsMap.get(parentId).push(extG);
                    }
                } else if (extG.attributes?.isBuffer || extG.attributes?.isPreviewBuffer) {
                    const parentId = extG.attributes?.parentId;
                    if (parentId) {
                        buffersMap.set(parentId, extG);
                    }
                }
            });

            // Clear the layer completely
            this.props.graphicsLayer.removeAll();

            //console.log(`📊 Reordering ${this.state.drawings.length} drawings...`);

            // 🔧 FIX: Add graphics in REVERSE order so first item in list appears on top
            // ArcGIS renders graphics in the order they're added, with later graphics on top
            for (let i = this.state.drawings.length - 1; i >= 0; i--) {
                const drawing = this.state.drawings[i];
                const drawingId = drawing.attributes?.uniqueId;
                const displayIndex = i + 1; // 1-based index for user-facing display

                // 1. Add the main drawing
                this.props.graphicsLayer.add(drawing);
                //console.log(`  ${displayIndex}. Added: ${drawing.attributes?.name || 'Unnamed'} (${drawingId})`);

                // 2. Add associated measurement labels immediately after
                if (drawingId && measurementLabelsMap.has(drawingId)) {
                    const labels = measurementLabelsMap.get(drawingId);
                    labels.forEach(label => {
                        this.props.graphicsLayer.add(label);
                    });
                    //console.log(`     ↳ Added ${labels.length} measurement label(s)`);
                }

                // 3. Add associated buffer immediately after
                if (drawingId && buffersMap.has(drawingId)) {
                    const buffer = buffersMap.get(drawingId);
                    this.props.graphicsLayer.add(buffer);
                    //console.log(`     ↳ Added buffer`);
                } else if (drawing.bufferGraphic) {
                    // Use the direct reference if available
                    this.props.graphicsLayer.add(drawing.bufferGraphic);
                    //console.log(`     ↳ Added buffer (direct ref)`);
                }
            }

            //console.log('✅ Graphics layer order sync complete');
            //console.log('   (First item in list now appears on top graphically)');

            // Force visual update with a small delay
            setTimeout(() => {
                this.forceMapRefresh();
            }, 150);

            // Persist the new order to localStorage
            this.debouncedSave();

        } catch (error) {
            console.error('❌ Error syncing graphics layer order:', error);
        }
    };

    setupInteractionManager = () => {
        if (!this.props.jimuMapView?.view) return;

        try {
            // Store original quality setting
            const view = this.props.jimuMapView.view as any;
            if (view.qualityProfile !== undefined) {
                this._originalQuality = view.qualityProfile;
            }

            // More efficient interaction handling
            const startInteraction = () => {
                if (!this._isInteracting) {
                    this._isInteracting = true;

                    // Lower quality during interaction
                    if (view.qualityProfile !== undefined) {
                        view.qualityProfile = "low";
                    }

                    // FIXED: Don't hide measurement labels during interaction - keep them visible
                    if (this.props.graphicsLayer) {
                        this.props.graphicsLayer.graphics.forEach((g: any) => {
                            // Only hide graphics marked for hiding during interaction, NOT measurement labels
                            if (g.attributes?.hideDuringInteraction && !g.attributes?.isMeasurementLabel) {
                                g.visible = false;
                            }
                        });
                    }
                }
            };

            // Debounced end interaction with longer delay
            const endInteraction = this.debounce(() => {
                if (this._isInteracting) {
                    this._isInteracting = false;

                    // Restore original quality
                    if (view.qualityProfile !== undefined) {
                        view.qualityProfile = this._originalQuality;
                    }

                    // FIXED: Ensure measurement labels are always visible after interaction
                    if (this.props.graphicsLayer) {
                        this.props.graphicsLayer.graphics.forEach((g: any) => {
                            // Show graphics that were hidden during interaction
                            if (g.attributes?.hideDuringInteraction) {
                                g.visible = true;
                            }
                            // ALWAYS ensure measurement labels are visible
                            if (g.attributes?.isMeasurementLabel) {
                                g.visible = true;
                            }
                        });
                    }

                    // Force a refresh after a short delay
                    setTimeout(() => this.forceMapRefresh(), 250);
                }
            }, 300); // Longer debounce for smoother transitions

            // Register all interaction events
            // 🔧 MEMORY FIX: store each handle so componentWillUnmount can remove them.
            // Previously these 6 listeners leaked on every widget remount / map view switch.
            this._interactionHandles.push(this.props.jimuMapView.view.on("drag", startInteraction));
            this._interactionHandles.push(this.props.jimuMapView.view.on("drag", ["end"], endInteraction));
            this._interactionHandles.push(this.props.jimuMapView.view.on("mouse-wheel", startInteraction));
            this._interactionHandles.push(this.props.jimuMapView.view.on("mouse-wheel", endInteraction));
            this._interactionHandles.push(this.props.jimuMapView.view.on("key-down", (event) => {
                const navKeys = ["+", "-", "_", "=", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
                if (navKeys.includes(event.key)) {
                    startInteraction();
                }
            }));
            this._interactionHandles.push(this.props.jimuMapView.view.on("key-up", endInteraction));

        } catch (err) {
            console.warn("Could not setup interaction manager:", err);
        }
    };

    // Track when user starts interacting
    handleInteractionStart = () => {
        this._isInteracting = true;

        try {
            const view = this.props.jimuMapView?.view as any;

            // Lower rendering quality for smoother interaction
            if (view?.qualityProfile !== undefined) {
                view.qualityProfile = "low";
            }

            // FIXED: Keep measurement labels visible during interaction
            if (this.props.graphicsLayer) {
                this.props.graphicsLayer.graphics.forEach((g: any) => {
                    // Only hide graphics marked for hiding during interaction, NOT measurement labels
                    if (g.attributes?.hideDuringInteraction && !g.attributes?.isMeasurementLabel) {
                        g.visible = false;
                    }
                });
            }
        } catch (err) {
            console.warn("Error in interaction start handler:", err);
        }
    };

    ensureUniqueName = (name: string): string => {
        if (!name) return `Drawing_${Date.now()}`;

        // Check if this name already exists in our drawings
        const lowerCaseName = name.toLowerCase();
        const existingNames = this.state.drawings.map(d =>
            (d.attributes?.name || '').toLowerCase()
        );

        // If name doesn't exist, return as is
        if (!existingNames.includes(lowerCaseName)) {
            return name;
        }

        // Add a counter to make name unique
        let counter = 1;
        let newName = `${name} (${counter})`;
        let lowerCaseNewName = newName.toLowerCase();

        // Keep incrementing counter until we find a unique name
        while (existingNames.includes(lowerCaseNewName)) {
            counter++;
            newName = `${name} (${counter})`;
            lowerCaseNewName = newName.toLowerCase();
        }

        return newName;
    };

    // Track when user stops interacting
    handleInteractionEnd = () => {
        this._isInteracting = false;

        try {
            const view = this.props.jimuMapView?.view as any;

            // Restore rendering quality
            if (view?.qualityProfile !== undefined && this._originalQuality) {
                view.qualityProfile = this._originalQuality;
            }

            // FIXED: Ensure measurement labels are always visible after interaction
            if (this.props.graphicsLayer) {
                this.props.graphicsLayer.graphics.forEach((g: any) => {
                    // Show graphics that were hidden during interaction
                    if (g.attributes?.hideDuringInteraction) {
                        g.visible = true;
                    }
                    // ALWAYS ensure measurement labels are visible
                    if (g.attributes?.isMeasurementLabel) {
                        g.visible = true;
                    }
                });
            }

            const refresh = () => this.forceMapRefresh();

            // Defer refresh until idle or next frame
            if ('requestIdleCallback' in window) {
                (window as any).requestIdleCallback(refresh);
            } else {
                requestAnimationFrame(refresh);
            }

        } catch (err) {
            console.warn("Error in interaction end handler:", err);
        }
    };




    refreshGraphicDisplay = (graphic: ExtendedGraphic) => {
        if (!graphic) return;

        try {
            // First try direct visibility toggle for this specific graphic
            this.ensureGraphicVisibility(graphic);

            // If we have a valid graphic index, update our internal state
            const uniqueId = graphic.attributes?.uniqueId;
            if (uniqueId && this._drawingMap.has(uniqueId)) {
                const index = this._drawingMap.get(uniqueId);
                if (index !== undefined) {
                    // Update state for this specific graphic
                    const updatedDrawings = [...this.state.drawings];
                    updatedDrawings[index] = graphic;

                    this.setState({ drawings: updatedDrawings });
                }
            }
        } catch (err) {
            console.error("Error refreshing graphic display:", err);

            // Fall back to the traditional refresh as a last resort
            // But don't do it if we're interacting to avoid excessive refreshes
            if (!this._isInteracting) {
                this.forceMapRefresh();
            }
        }
    };

    forceMapRefresh = () => {
        if (!this.props.jimuMapView?.view) return;

        try {
            // Abort any ongoing navigation
            if (this._goToController) {
                this._goToController.abort();
                this._goToController = null;
            }

            // Create a new controller
            const controller = new AbortController();
            this._goToController = controller;

            // Get current center and scale
            const view = this.props.jimuMapView.view;
            const currentCenter = view.center.clone();
            const currentScale = view.scale;

            // Option 1: Stationary refresh (no motion)
            view.goTo({
                target: currentCenter,
                scale: currentScale
            }, {
                animate: false,
                duration: 0,
                signal: controller.signal
            }).catch(err => {
                if (err.name !== 'AbortError' && err.name !== 'view:goto-interrupted') {
                    console.error('Map refresh error:', err);
                }
            });

            // Option 2: Alternative approach - use updateExtent
            // view.extent = view.extent.clone();

        } catch (err) {
            console.error("Error refreshing map:", err);
        }
    };


    ensureGraphicVisibility = (graphic: ExtendedGraphic) => {
        if (!graphic || !this.props.graphicsLayer) return;

        try {
            // Store original visibility
            const wasVisible = graphic.visible !== false;

            // Toggle visibility to force a redraw of just this graphic
            // This is much lighter than refreshing the whole map
            graphic.visible = false;

            // Use setTimeout instead of requestAnimationFrame for broader compatibility
            setTimeout(() => {
                if (graphic && !graphic.destroyed) {
                    // Restore original visibility
                    graphic.visible = wasVisible;
                }
            }, 0);
        } catch (err) {
            console.error("Error ensuring graphic visibility:", err);
        }
    };

    handleLoadExistingDrawings = () => {
        // Set a timestamp to mark that we've shown the prompt in this page session
        MyDrawingsPanel._drawingsLoadChoiceTimestamp = new Date().getTime();

        // If there are new unsaved drawings on the map, clear them first so saved drawings load cleanly
        if (this.state.hasNewUnsavedDrawings && this.props.graphicsLayer) {
            this.props.graphicsLayer.removeAll();
        }

        // Let initializeComponents handle the load (it calls loadFromLocalStorage internally)
        this._pendingLoadMode = 'normal';

        this.setState({ showLoadPrompt: false, hasNewUnsavedDrawings: false }, () => {
            this.initializeComponents();
        });
    };

    /**
     * Merge: Keep new drawings AND load saved drawings from localStorage.
     * The new drawings on the map are almost never in localStorage yet (the
     * panel's save is debounced and only starts running once it has mounted),
     * so we must serialize and merge them into storage ourselves before
     * clearing the layer — otherwise clearing here deletes them for good and
     * loadFromLocalStorage only brings back the old saved set.
     */
    handleMergeDrawings = () => {
        MyDrawingsPanel._drawingsLoadChoiceTimestamp = new Date().getTime();

        if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
            try {
                const storageKey = this.localStorageKey;
                const savedRaw = localStorage.getItem(storageKey);
                const savedParsed = savedRaw ? JSON.parse(savedRaw) : null;

                const savedDrawings = Array.isArray(savedParsed)
                    ? savedParsed
                    : (savedParsed?.drawings || []);
                const savedLabels = Array.isArray(savedParsed)
                    ? []
                    : (savedParsed?.measurementLabels || []);

                const currentGraphics = this.props.graphicsLayer
                    ? this.props.graphicsLayer.graphics.toArray()
                    : [];

                const newDrawingsJson = currentGraphics
                    .filter(g => !g.attributes?.isMeasurementLabel &&
                        !g.attributes?.hideFromList &&
                        !g.attributes?.isPreviewBuffer &&
                        !g.attributes?.isBuffer &&
                        !g.attributes?.isBufferDrawing)
                    .map(g => g.toJSON());

                const newLabelsJson = currentGraphics
                    .filter(g => g.attributes?.isMeasurementLabel && !g.attributes?.isPreviewBuffer)
                    .map(g => g.toJSON());

                // Don't duplicate a drawing that (unusually) is already saved
                const savedIds = new Set(savedDrawings.map((d: any) => d.attributes?.uniqueId).filter(Boolean));
                const mergedDrawings = [
                    ...newDrawingsJson.filter((d: any) => !d.attributes?.uniqueId || !savedIds.has(d.attributes.uniqueId)),
                    ...savedDrawings
                ];
                const mergedLabels = [...newLabelsJson, ...savedLabels];

                const mergedData = {
                    ...(!Array.isArray(savedParsed) ? savedParsed : {}),
                    drawings: mergedDrawings,
                    measurementLabels: mergedLabels,
                    version: "1.5"
                };

                localStorage.setItem(storageKey, JSON.stringify(mergedData));
            } catch (err) {
                console.error('Error merging new drawings into localStorage:', err);
            }
        }

        // Clear layer so loadFromLocalStorage's graphics.length === 0 check passes
        if (this.props.graphicsLayer) {
            this.props.graphicsLayer.removeAll();
        }

        // Normal mode: initializeComponents → loadFromLocalStorage loads everything
        // now that localStorage contains both the new and previously saved drawings
        this._pendingLoadMode = 'normal';

        this.setState({ showLoadPrompt: false, hasNewUnsavedDrawings: false }, () => {
            this.initializeComponents();
        });
    };

    /**
     * Keep New Only: Discard saved drawings from localStorage, keep only what's on the map now.
     */
    handleKeepNewOnly = () => {
        MyDrawingsPanel._drawingsLoadChoiceTimestamp = new Date().getTime();

        // Remove saved drawings from localStorage
        if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
            try {
                localStorage.removeItem(this.localStorageKey);
            } catch (err) {
                console.error(`Error clearing drawings from localStorage:`, err);
            }
        }

        // Skip the loadFromLocalStorage call in initializeComponents
        this._pendingLoadMode = 'skip';

        this.setState({
            showLoadPrompt: false,
            hasNewUnsavedDrawings: false,
            hasExistingDrawings: false
        }, () => {
            this.initializeComponents();
            // Trigger a save so the new drawings are persisted to localStorage
            setTimeout(() => {
                if (this.state.drawings.length > 0) {
                    this.handleDrawingsUpdate(this.state.drawings);
                }
            }, 500);
        });
    };

    handleStartFresh = () => {
        // Set a timestamp to mark that we've shown the prompt in this page session
        MyDrawingsPanel._drawingsLoadChoiceTimestamp = new Date().getTime();

        //console.log('User chose to delete all and start new - choice recorded for this page session');

        // Remove existing drawings from localStorage
        if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
            try {
                localStorage.removeItem(this.localStorageKey);
                //console.log(`Cleared existing drawings from localStorage key: ${this.localStorageKey}`);
            } catch (err) {
                console.error(`Error clearing drawings from localStorage:`, err);
            }
        }

        // Also clear any new drawings on the map
        if (this.props.graphicsLayer) {
            this.props.graphicsLayer.removeAll();
        }

        // Initialize with empty drawing layer
        this.setState({
            showLoadPrompt: false,
            hasExistingDrawings: false,
            hasNewUnsavedDrawings: false
        }, this.initializeComponents);
    };

    // Call this in your initializeComponents method
    setupMapQualityManager = () => {
        if (!this.props.jimuMapView?.view) return;
        try {
            // Use type assertion or conditional check
            const view = this.props.jimuMapView.view as any; // Type assertion

            // Store original quality setting
            if (view.qualityProfile !== undefined) {
                this._originalQuality = view.qualityProfile;
            }

            // Rest of your code remains the same
            // 🔧 MEMORY FIX: track these handles for cleanup in componentWillUnmount.
            this._mapQualityHandles.push(view.on("drag", ["start"], () => this.lowerMapQuality()));
            this._mapQualityHandles.push(view.on("drag", ["end"], () => this.restoreMapQuality()));
            // etc...
        } catch (err) {
            console.warn("Could not setup map quality manager:", err);
        }
    };

    // Lower map quality during interactions to reduce texture warnings
    lowerMapQuality = () => {
        if (!this.props.jimuMapView?.view) return;
        try {
            // Type assertion approach
            const view = this.props.jimuMapView.view as any;

            // Lower quality during interaction
            if (view.qualityProfile !== undefined) {
                view.qualityProfile = "low";
            }
        } catch (err) {
            console.warn("Could not lower map quality:", err);
        }
    };

    restoreMapQuality = () => {
        if (!this.props.jimuMapView?.view) return;
        try {
            // Type assertion approach
            const view = this.props.jimuMapView.view as any;

            // Restore original quality
            if (view.qualityProfile !== undefined) {
                view.qualityProfile = this._originalQuality;
            }
        } catch (err) {
            console.warn("Could not restore map quality:", err);
        }
    };

    // Utility debounce function
    debounce = (func: Function, wait: number) => {
        let timeout: any;

        return (...args: any[]) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    };

    resetSessionChoice = () => {
        sessionStorage.removeItem('drawingsLoadChoiceMade');
        //console.log('Load choice session flag has been reset');
    };

    checkExistingDrawings = () => {
        const currentTime = new Date().getTime();

        // Check if we've shown this prompt recently in this specific page load
        if (MyDrawingsPanel._drawingsLoadChoiceTimestamp > 0) {
            //console.log('Load choice was already made in this page session - skipping prompt');
            return false;
        }

        if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
            try {
                // Get saved data without immediately loading it
                const savedData = localStorage.getItem(this.localStorageKey);

                if (savedData) {
                    const parsedData = JSON.parse(savedData);

                    // Handle both old format (array) and new format (object with drawings)
                    let drawingsData = [];

                    if (Array.isArray(parsedData)) {
                        // Old format - just drawings
                        drawingsData = parsedData;
                    } else if (parsedData.drawings) {
                        // New format - includes measurement labels
                        drawingsData = parsedData.drawings || [];
                    }

                    // Check if we have valid data with drawings
                    if (Array.isArray(drawingsData) && drawingsData.length > 0) {
                        // Check if the graphics layer already has new (unsaved) drawings
                        const layerHasGraphics = this.props.graphicsLayer &&
                            this.props.graphicsLayer.graphics.length > 0;

                        // We have existing drawings, so we should show the load prompt
                        this.setState({
                            hasExistingDrawings: true,
                            hasNewUnsavedDrawings: !!layerHasGraphics,
                            showLoadPrompt: true
                        });
                        //console.log(`Found ${drawingsData.length} existing drawing(s) in localStorage - showing prompt`);
                        return true;
                    }
                }
            } catch (err) {
                console.error(`Error checking for existing drawings in localStorage:`, err);
            }
        }

        return false;
    };


    handleDrawingSelectAndScroll = (graphic: any, index: number) => {
        try {
            // stop any nav/edit
            if (this._goToController) { this._goToController.abort(); this._goToController = null; }
            try { this.sketchViewModel?.cancel(); } catch { }

            // 🔑 capture previous selection BEFORE changing state
            const prevIndex = this.state.selectedGraphicIndex;

            // remove halo from the previously selected point/text (if any)
            this.removePointTextOverlayByIndex(prevIndex);

            // now set the new selection + auto-expand
            this.setState((prevState) => {
                const newCollapsed = new Set(prevState.collapsedDrawings);
                newCollapsed.delete(index);
                return { selectedGraphicIndex: index, collapsedDrawings: newCollapsed };
            });

            // scroll into view
            const item = document.getElementById(`drawing-item-${index}`);
            if (item) item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // defer highlight a touch for UI smoothness
            setTimeout(() => {
                if (!this._isInteracting) {
                    this.highlightGraphic(graphic, index);
                    // Only enter edit mode if not locked
                    if (!this.isDrawingLocked(graphic)) {
                        this.props.onDrawingSelect?.(graphic, index);
                    }
                }
            }, 100);
        } catch (err) {
            console.error('Error in handleDrawingSelectAndScroll:', err);
            this.showLocalAlert(this.props.nls('errorSelectingDrawingFromMap'), 'error');
        }
    };




    initializeComponents = () => {
        //console.log('🚀 initializeComponents called');
        // console.log('📊 Props check:', {
        //   hasJimuMapView: !!this.props.jimuMapView,
        //   hasGraphicsLayer: !!this.props.graphicsLayer,
        //   consentGranted: this.state.consentGranted
        // });

        if (!this.props.jimuMapView || !this.props.graphicsLayer) {
            //console.log('❌ Missing required props, exiting');
            return;
        }

        // 🔧 CRITICAL FIX: Use SketchViewModel from props if provided
        // This ensures measure.tsx's listeners work when MyDrawings tab is active
        if (this.props.sketchViewModel) {
            //console.log('✅ Using SketchViewModel from props (shared with measure.tsx)');
            this.sketchViewModel = this.props.sketchViewModel;
            this.internalSketchVM = false; // Not our SketchViewModel, don't destroy it
        } else {
            // Fallback: Create our own SketchViewModel (old behavior)
            console.warn('⚠️ No SketchViewModel provided in props, creating internal one');
            try {
                this.sketchViewModel = new SketchViewModel({
                    view: this.props.jimuMapView.view,
                    useLegacyCreateTools: false, // match main draw SVM: next-gen create with true curve tools
                    layer: this.props.graphicsLayer
                });
                this.internalSketchVM = true;
                //console.log('✅ SketchViewModel created successfully');
            } catch (error) {
                console.error('Error creating SketchViewModel:', error);
                return;
            }
        }

        //console.log('🔧 Starting initialization managers...');

        // Initialize managers/watchers you already had
        this.setupInteractionManager();
        //console.log('✅ setupInteractionManager completed');

        this.fixMeasurementLabelStyles();
        //console.log('✅ fixMeasurementLabelStyles completed');

        this.setupGraphicsWatcher();
        //console.log('✅ setupGraphicsWatcher completed');

        this.refreshDrawingsFromLayer();
        //console.log('✅ refreshDrawingsFromLayer completed');

        if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
            // Use pending load mode flag if set by a handler, then reset it
            const loadMode = this._pendingLoadMode;
            this._pendingLoadMode = 'normal'; // Reset flag

            if (loadMode === 'skip') {
                // handleKeepNewOnly: skip loading from localStorage entirely
                //console.log('⏭️ Skipping loadFromLocalStorage (keep new only mode)');
            } else {
                // Normal load (also used after merge writes combined data to localStorage)
                this.loadFromLocalStorage();
                //console.log('✅ loadFromLocalStorage completed');
            }
        }

        //console.log('🗺️ Building drawing map...');

        // Fast lookup map
        const rebuildDrawingMap = () => {
            this._drawingMap.clear();
            this.state.drawings.forEach((drawing, idx) => {
                const id = drawing.attributes?.uniqueId;
                if (id) this._drawingMap.set(id, idx);
            });
        };

        rebuildDrawingMap();
        //console.log('✅ Drawing map built');

        this._afterRefreshDrawings = () => {
            rebuildDrawingMap();
            this.forceMapRefresh();
        };

        this.scheduleDrawingsSyncCheck();
        //console.log('✅ Sync check scheduled');

        // 🔧 CRITICAL FIX: Watch for updateGraphics changes to restore measurements
        // When widget calls update([graphic]), this fires BEFORE updateMeasurementsForGraphic
        if (this.sketchViewModel) {
            // 🔧 MEMORY FIX: track this watch handle for cleanup.
            this._svmListenerHandles.push(this.sketchViewModel.watch('updateGraphics', (newGraphics: any) => {
                if (newGraphics && newGraphics.length > 0) {
                    newGraphics.forEach((graphic: any) => {
                        // If this graphic was created with measurements, restore the measure property
                        if (graphic.attributes?.hadMeasurements && !graphic.measure) {
                            graphic.measure = {
                                graphic: null,
                                lengthUnit: graphic.attributes?.lengthUnit,
                                areaUnit: graphic.attributes?.areaUnit
                            };
                            console.log('🔄 Auto-restored measure property during update for:', graphic.attributes?.name);
                        }
                    });
                }
            }));
        }

        // 🔧 CRITICAL FIX: Set up appropriate event listeners based on SketchViewModel source
        if (this.internalSketchVM) {
            // Using our own internal SketchViewModel - set up full event handlers
            //console.log('🎯 Setting up full SketchViewModel event handler (internal VM)...');

            // --- SketchViewModel update handler ---
            // 🔧 MEMORY FIX: track for cleanup
            this._svmListenerHandles.push(this.sketchViewModel.on("update", (event) => {
                //('🔧 SketchViewModel update event:', event.state, 'graphics:', event.graphics.length);
                try {
                    // Block editing of locked drawings on the map
                    if ((event.state === "start" || event.state === "active") && event.graphics.length > 0) {
                        const hasLockedGraphic = event.graphics.some((gra: any) =>
                            this.isDrawingLocked(gra)
                        );
                        if (hasLockedGraphic) {
                            this.sketchViewModel.cancel();
                            return;
                        }
                    }

                    if (event.state === "active" && event.graphics.length > 0) {
                        //console.log('🔧 Processing active state with', event.graphics.length, 'graphics');
                        // Filter selectable graphics
                        const selectable = event.graphics.filter((gra: any) =>
                            !gra.attributes?.isBuffer &&
                            !gra.attributes?.isBufferDrawing &&
                            !gra.attributes?.isPreviewBuffer &&
                            !gra.attributes?.isMeasurementLabel &&
                            !gra.attributes?.hideFromList &&
                            !gra.attributes?.uniqueId?.startsWith('buffer_') &&
                            !(gra.geometry?.type === 'point' &&
                                gra.symbol?.type === 'text' &&
                                gra.attributes?.isMeasurementLabel)
                        );

                        //console.log('🔧 Selectable graphics:', selectable.length);
                        if (!selectable.length) {
                            //console.log('⚠️ No selectable graphics, returning');
                            return;
                        }

                        const selectedGraphic = selectable[0] as ExtendedGraphic;
                        //console.log('🔧 Selected graphic:', selectedGraphic.attributes?.uniqueId, 'type:', selectedGraphic.geometry?.type);

                        // 🔧 Update measurement labels - both position AND values
                        // This keeps labels moving with the graphic AND updates measurement text
                        //console.log('🔧 Updating measurements for graphic...');

                        // First update positions immediately for smooth visual feedback
                        this.updateMeasurementLabelPositions(selectedGraphic);

                        // Update drawing label position (name/notes label)
                        this.updateDrawingLabelPosition(selectedGraphic);

                        // Then update the actual measurement values (using safe method with retry)
                        this.safeUpdateMeasurements(selectedGraphic);

                        // Ensure halo during active edit for point/text and keep it in sync
                        if (selectedGraphic.geometry?.type === 'point') {
                            this.ensurePointTextOverlay(selectedGraphic);
                            if (selectedGraphic._selectionOverlay) {
                                try { selectedGraphic._selectionOverlay.geometry = selectedGraphic.geometry; } catch { }
                            }
                        }

                        // Reflect selection in the list/state
                        const uid = selectedGraphic.attributes?.uniqueId;
                        if (uid && this._drawingMap.has(uid)) {
                            const index = this._drawingMap.get(uid)!;

                            document.querySelectorAll('.drawing-item').forEach(el => el.classList.remove('selected-drawing'));
                            const item = document.getElementById(`drawing-item-${index}`);
                            if (item) {
                                item.classList.add('selected-drawing');
                                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }

                            this.setState({
                                selectedGraphicIndex: index,
                                selectedGraphics: new Set([index])
                            });

                            this.props.onDrawingSelect?.(selectedGraphic, index);
                        }
                    }

                    if (event.state === "complete" && event.graphics.length > 0) {
                        setTimeout(() => {
                            this.ignoreNextGraphicsUpdate = true;
                            this.refreshDrawingsFromLayer();

                            if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                                this.debouncedSave();
                            }

                            // 🔧 CRITICAL FIX: MyDrawingsPanel uses its own SketchViewModel, so we must
                            // explicitly refresh measurements after graphics are moved/reshaped
                            const measureEnabled = this.measureRef?.current?.isMeasurementEnabled?.();

                            // 🆕 FIX: Check if any graphics have existing measurements
                            const graphicsWithMeasurements = event.graphics.filter((g: any) => {
                                // 🔧 NEW: Skip graphics with measurements hidden
                                if (g.attributes?.measurementsHidden) return false;
                                return g.measure?.graphic ||
                                    g.attributes?.hadMeasurements ||
                                    g.attributes?.measurementsPermanent ||
                                    (g.attributes?.relatedMeasurementLabels?.length > 0) ||
                                    (g.attributes?.relatedSegmentLabels?.length > 0);
                            });

                            //console.log('🔧 Update complete - measureEnabled:', measureEnabled, 'graphics:', event.graphics.length, 'withMeasurements:', graphicsWithMeasurements.length);

                            // Update measurements if enabled OR if graphics have existing measurements
                            if (measureEnabled || graphicsWithMeasurements.length > 0) {
                                // Small delay to let geometry settle
                                setTimeout(() => {
                                    try {
                                        //console.log('🔧 Calling refreshAllMeasurements...');
                                        this.measureRef.current.refreshAllMeasurements();
                                        //console.log('✅ refreshAllMeasurements completed');
                                    } catch (err) {
                                        console.warn('❌ Error refreshing measurements after update:', err);
                                    }
                                }, 200);
                            } else {
                                //console.log('⚠️ Measurements not enabled and no graphics have measurements');
                            }
                        }, 50);
                    }

                    if (event.state === "complete") {
                        if (this._goToController) {
                            this._goToController.abort();
                            this._goToController = null;
                        }
                    }
                } catch (error) {
                    console.warn('SketchViewModel event handler error:', error);
                }
            }));
            //console.log('✅ SketchViewModel event handler registered');
        } else {
            // Using shared SketchViewModel from widget.tsx
            // Set up minimal listener ONLY for real-time label positioning during active edits
            // Let widget.tsx and measure.tsx handle everything else
            //console.log('ℹ️ Using shared SketchViewModel - setting up minimal label positioning listener');

            // 🔧 MEMORY FIX: track this shared-VM listener too.
            this._svmListenerHandles.push(this.sketchViewModel.on("update", (event) => {
                try {
                    // Block editing of locked drawings on the map
                    if ((event.state === "start" || event.state === "active") && event.graphics.length > 0) {
                        const hasLockedGraphic = event.graphics.some((gra: any) =>
                            this.isDrawingLocked(gra)
                        );
                        if (hasLockedGraphic) {
                            this.sketchViewModel.cancel();
                            return;
                        }
                    }

                    // ONLY handle active state for real-time label positioning
                    if (event.state === "active" && event.graphics.length > 0) {
                        const selectable = event.graphics.filter((gra: any) =>
                            !gra.attributes?.isBuffer &&
                            !gra.attributes?.isBufferDrawing &&
                            !gra.attributes?.isPreviewBuffer &&
                            !gra.attributes?.isMeasurementLabel &&
                            !gra.attributes?.hideFromList &&
                            !gra.attributes?.uniqueId?.startsWith('buffer_')
                        );

                        if (selectable.length > 0) {
                            const selectedGraphic = selectable[0] as ExtendedGraphic;

                            // Update measurement label positions immediately for smooth visual feedback
                            this.updateMeasurementLabelPositions(selectedGraphic);

                            // Update drawing label position (name/notes label)
                            this.updateDrawingLabelPosition(selectedGraphic);
                        }
                    }

                    // 🔧 CRITICAL FIX: Handle 'complete' state to update measurement VALUES
                    // Even with shared SketchViewModel, we need to ensure measurements are recalculated
                    if (event.state === "complete" && event.graphics.length > 0) {
                        const selectable = event.graphics.filter((gra: any) =>
                            !gra.attributes?.isBuffer &&
                            !gra.attributes?.isBufferDrawing &&
                            !gra.attributes?.isPreviewBuffer &&
                            !gra.attributes?.isMeasurementLabel &&
                            !gra.attributes?.hideFromList &&
                            !gra.attributes?.uniqueId?.startsWith('buffer_')
                        );

                        if (selectable.length > 0) {
                            // Save to localStorage if enabled
                            setTimeout(() => {
                                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                                    this.debouncedSave();
                                }
                            }, 50);

                            // 🆕 FIX: Only update measurements for graphics that have measurements
                            // Update measurement values after reshape is complete
                            // Use safe update method with retry logic
                            setTimeout(() => {
                                const measureEnabled = this.measureRef?.current?.isMeasurementEnabled?.();

                                for (const graphic of selectable) {
                                    const hasExistingMeasurements =
                                        (graphic as any).measure?.graphic ||
                                        graphic.attributes?.hadMeasurements ||
                                        graphic.attributes?.measurementsPermanent ||
                                        (graphic.attributes?.relatedMeasurementLabels?.length > 0) ||
                                        (graphic.attributes?.relatedSegmentLabels?.length > 0);

                                    // Update if measurements are enabled OR graphic has existing measurements
                                    if (measureEnabled || hasExistingMeasurements) {
                                        this.safeUpdateMeasurements(graphic);
                                    }
                                }
                            }, 200);
                        }
                    }
                } catch (error) {
                    console.warn('MyDrawingsPanel update listener error:', error);
                }
            }));
        }

        //console.log('🎯 Setting up graphics watchers...');

        // Graphics collection watchers
        const graphicsWatchHandle = this.props.graphicsLayer.graphics.watch("length", (n, o) => {
            if (n > o) setTimeout(() => this.forceMapRefresh(), 100);
        });
        this._graphicsWatchHandles.push(graphicsWatchHandle);

        // 🔧 MEMORY FIX: previously this on('change') wasn't stored. Push it into
        // the same accumulator the watch above uses so componentWillUnmount can
        // remove it cleanly.
        this._graphicsWatchHandles.push(this.props.graphicsLayer.graphics.on("change", (evt) => {
            if (evt.added && evt.added.length > 0) {
                setTimeout(() => this.forceMapRefresh(), 100);
            }
        }));
        //console.log('✅ Graphics watchers set up');

        // REMOVED: Duplicate map click handler that was interfering with the Widget's click handler
        // The Widget's activeViewChangeHandler already has the map click handler that integrates with this panel

        //console.log('🔄 Rebuilding final drawing map...');

        // Rebuild drawing map after initial load and after refreshes
        this._drawingMap.clear();
        this.state.drawings.forEach((drawing, idx) => {
            const id = drawing.attributes?.uniqueId;
            if (id) this._drawingMap.set(id, idx);
        });

        this._afterRefreshDrawings = () => {
            this._drawingMap.clear();
            this.state.drawings.forEach((drawing, idx) => {
                const id = drawing.attributes?.uniqueId;
                if (id) this._drawingMap.set(id, idx);
            });

            if (this.state.drawings.length > 0 && !this._isInteracting) {
                setTimeout(() => this.forceMapRefresh(), 100);
            }
        };
        //console.log('✅ Final drawing map built');

        //console.log('⏰ Starting map click sync...');
        // Start map click sync
        this.mapClickSync();
        //console.log('✅ Map click sync started');

        //console.log('🏁 initializeComponents completed successfully');
    };



    mapClickSync = () => {
        // Only run if enabled
        if (!this._mapClickSyncEnabled || !this.props.jimuMapView || !this.props.graphicsLayer) return;

        // Get currently selected graphics from the SketchViewModel
        const selectedGraphics = this.sketchViewModel?.updateGraphics?.toArray() || [];

        if (selectedGraphics.length > 0) {
            // Get the first selected graphic
            const selectedGraphic = selectedGraphics[0];

            if (selectedGraphic.attributes?.uniqueId) {
                const uniqueId = selectedGraphic.attributes.uniqueId;

                // Look up the index in our map
                if (this._drawingMap.has(uniqueId)) {
                    const index = this._drawingMap.get(uniqueId);

                    // Only update if selection has changed and index is defined
                    if (index !== undefined && this.state.selectedGraphicIndex !== index) {
                        //console.log(`Map sync found different selection: ${index}`);

                        // Update UI immediately
                        document.querySelectorAll('.drawing-item').forEach(item => {
                            item.classList.remove('selected-drawing');
                        });

                        const item = document.getElementById(`drawing-item-${index}`);
                        if (item) {
                            item.classList.add('selected-drawing');
                            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }

                        // Update state + auto-expand the selected drawing
                        this.setState((prevState) => {
                            const newCollapsed = new Set(prevState.collapsedDrawings);
                            newCollapsed.delete(index); // Expand the selected drawing
                            return {
                                selectedGraphicIndex: index,
                                collapsedDrawings: newCollapsed
                            };
                        });

                        // 🔧 CRITICAL FIX: For graphics created with measurements, restore measure property
                        // BEFORE calling parent, because parent immediately calls updateMeasurementsForGraphic
                        const hadMeasurements = selectedGraphic.attributes?.hadMeasurements;
                        const extGraphic = selectedGraphic as ExtendedGraphic;
                        const savedMeasure = extGraphic.measure ? { ...extGraphic.measure } : null;

                        // Notify parent
                        if (this.props.onDrawingSelect) {
                            this.props.onDrawingSelect(selectedGraphic, index);
                        }

                        // Parent's handleDrawingSelect calls cancel() which clears graphic.measure
                        // Immediately restore it if this graphic had measurements
                        if (hadMeasurements) {
                            // Restore measure property synchronously
                            if (!extGraphic.measure) {
                                extGraphic.measure = savedMeasure || {
                                    graphic: null,
                                    lengthUnit: selectedGraphic.attributes?.lengthUnit,
                                    areaUnit: selectedGraphic.attributes?.areaUnit
                                };
                            }
                            //console.log('🔄 Restored measure property for:', selectedGraphic.attributes?.name);

                            // Force measurement update if needed
                            setTimeout(() => {
                                if (this.measureRef?.current && selectedGraphic.attributes?.hadMeasurements &&
                                    !selectedGraphic.attributes?.measurementsHidden) {
                                    this.measureRef.current.updateMeasurementsForGraphic(selectedGraphic);
                                }
                            }, 200);
                        }
                    }
                }
            }
        }

        // Schedule next sync
        setTimeout(this.mapClickSync, 500);
    };


    setupGraphicsWatcher = () => {
        if (!this.props.graphicsLayer) return;

        // Watch for changes to the graphics collection
        const watchHandle = this.props.graphicsLayer.graphics.on("change", (event) => {
            // 🔧 FIX: Skip ALL graphics updates during import (not just the next one)
            if (this._isImporting) {
                return;
            }

            // FIX: Skip ALL graphics updates during localStorage restoration
            if (this._isLoadingFromStorage) {
                return;
            }

            // Skip if we triggered this change ourselves
            if (this.ignoreNextGraphicsUpdate) {
                this.ignoreNextGraphicsUpdate = false;
                return;
            }

            // Skip if we're toggling visibility to prevent order disruption
            if (this._isTogglingVisibility) {
                return;
            }

            // Skip if we're selecting a graphic to prevent order disruption
            if (this._isSelectingGraphic) {
                return;
            }

            // Refresh drawings from the layer
            this.refreshDrawingsFromLayer();
        });

        this.setState({ graphicsWatchHandle: watchHandle });
    }

    refreshDrawingsFromLayer = () => {
        if (!this.props.graphicsLayer) return;

        //console.log(`🔄 refreshDrawingsFromLayer called (hasManualOrder: ${this.state.hasManualOrder})`);

        // Get all graphics from the layer
        const allGraphics = this.props.graphicsLayer.graphics.toArray();

        // Filter to include main drawings ONLY
        const filteredGraphics = allGraphics.filter(g => {
            if (g.attributes?.isMeasurementLabel) return false;
            if (g.attributes?.isPreviewBuffer) return false;
            if (g.attributes?.hideFromList) return false;
            if (g.attributes?.isBuffer) return false;
            if (g.geometry?.type === 'point' &&
                g.symbol?.type === 'text' &&
                g.attributes?.isMeasurementLabel) return false;
            return true;
        }) as ExtendedGraphic[];


        // Determine which order to use
        let finalDrawings: ExtendedGraphic[];

        if (this.state.hasManualOrder && this.state.drawings.length > 0) {
            // User has manually ordered - preserve that order
            //console.log('📌 Preserving manual order');

            const existingOrder = this.state.drawings;

            // Create a map of uniqueId to graphic for quick lookup
            const graphicMap = new Map<string, ExtendedGraphic>();
            filteredGraphics.forEach(g => {
                if (g.attributes?.uniqueId) {
                    graphicMap.set(g.attributes.uniqueId, g);
                }
            });

            // Build array in existing order, using updated graphics from layer
            const orderedGraphics: ExtendedGraphic[] = [];
            existingOrder.forEach(existingGraphic => {
                const id = existingGraphic.attributes?.uniqueId;
                if (id && graphicMap.has(id)) {
                    // Use the updated graphic from the layer, not the old state one
                    orderedGraphics.push(graphicMap.get(id));
                    graphicMap.delete(id); // Remove so we can track new ones
                }
            });

            // Add any new graphics that weren't in the existing order
            graphicMap.forEach(newGraphic => {
                orderedGraphics.push(newGraphic);
            });

            finalDrawings = orderedGraphics;
            //console.log(`📌 Preserved order for ${finalDrawings.length} drawings`);

            // CRITICAL: Reorder graphics in layer in REVERSE of state order
            // In ArcGIS, first in collection = drawn first = at bottom
            // For visual stacking to match list: item #1 in list should be ON TOP
            // So layer order must be REVERSED from state order
            for (let i = 0; i < finalDrawings.length; i++) {
                const graphic = finalDrawings[i];
                // Reverse: item at state index i should be at layer index (length - 1 - i)
                const targetLayerIndex = finalDrawings.length - 1 - i;
                const currentIndex = this.props.graphicsLayer.graphics.indexOf(graphic);
                if (currentIndex !== -1 && currentIndex !== targetLayerIndex) {
                    this.props.graphicsLayer.graphics.reorder(graphic, targetLayerIndex);
                }
            }
            //console.log(`✅ Reordered graphics in layer (reversed for visual stacking)`);

            // 🔧 FIX: Reposition measurement labels after their parent drawings
            // Measurement labels need to be on top of their parent drawings to be visible
            try {
                finalDrawings.forEach((graphic, index) => {
                    const ext = graphic as ExtendedGraphic;
                    // Find measurement labels for this drawing
                    const measurementLabel = ext.measure?.graphic;
                    if (measurementLabel && this.props.graphicsLayer.graphics.includes(measurementLabel)) {
                        // Position label right after (on top of) its parent drawing
                        const parentIndex = this.props.graphicsLayer.graphics.indexOf(graphic);
                        const labelIndex = this.props.graphicsLayer.graphics.indexOf(measurementLabel);
                        if (parentIndex !== -1 && labelIndex !== -1 && labelIndex !== parentIndex + 1) {
                            this.props.graphicsLayer.graphics.reorder(measurementLabel, parentIndex + 1);
                        }
                    }

                    // Also handle segment labels if they exist
                    const segmentLabels = ext.attributes?.relatedSegmentLabels;
                    if (segmentLabels && Array.isArray(segmentLabels)) {
                        const parentIndex = this.props.graphicsLayer.graphics.indexOf(graphic);
                        segmentLabels.forEach((segLabel) => {
                            if (this.props.graphicsLayer.graphics.includes(segLabel)) {
                                const labelIndex = this.props.graphicsLayer.graphics.indexOf(segLabel);
                                if (parentIndex !== -1 && labelIndex !== -1 && labelIndex < parentIndex) {
                                    this.props.graphicsLayer.graphics.reorder(segLabel, parentIndex + 1);
                                }
                            }
                        });
                    }
                });
                //console.log(`✅ Repositioned measurement labels after reordering`);
            } catch (error) {
                console.warn('Error repositioning measurement labels:', error);
            }
        } else {
            // No manual order - apply sort option
            //console.log(`📊 Applying sort: ${this.state.sortOption}`);
            finalDrawings = this.sortGraphicsArray(filteredGraphics);

            // 🔧 FIX: Reposition measurement labels after sorting too
            try {
                finalDrawings.forEach((graphic) => {
                    const ext = graphic as ExtendedGraphic;
                    const measurementLabel = ext.measure?.graphic;
                    if (measurementLabel && this.props.graphicsLayer.graphics.includes(measurementLabel)) {
                        const parentIndex = this.props.graphicsLayer.graphics.indexOf(graphic);
                        const labelIndex = this.props.graphicsLayer.graphics.indexOf(measurementLabel);
                        if (parentIndex !== -1 && labelIndex !== -1 && labelIndex !== parentIndex + 1) {
                            this.props.graphicsLayer.graphics.reorder(measurementLabel, parentIndex + 1);
                        }
                    }

                    const segmentLabels = ext.attributes?.relatedSegmentLabels;
                    if (segmentLabels && Array.isArray(segmentLabels)) {
                        const parentIndex = this.props.graphicsLayer.graphics.indexOf(graphic);
                        segmentLabels.forEach((segLabel) => {
                            if (this.props.graphicsLayer.graphics.includes(segLabel)) {
                                const labelIndex = this.props.graphicsLayer.graphics.indexOf(segLabel);
                                if (parentIndex !== -1 && labelIndex !== -1 && labelIndex < parentIndex) {
                                    this.props.graphicsLayer.graphics.reorder(segLabel, parentIndex + 1);
                                }
                            }
                        });
                    }
                });
                //console.log(`✅ Repositioned measurement labels after sorting`);
            } catch (error) {
                console.warn('Error repositioning measurement labels after sort:', error);
            }
        }

        this.setState((prevState) => {
            // Auto-collapse newly added drawings
            const prevCount = prevState.drawings.length;
            const newCollapsed = new Set(prevState.collapsedDrawings);
            if (finalDrawings.length > prevCount) {
                // New drawings were added — collapse them by default
                for (let i = prevCount; i < finalDrawings.length; i++) {
                    newCollapsed.add(i);
                }
            }

            return {
                drawings: finalDrawings,
                collapsedDrawings: newCollapsed,
                selectedGraphics: new Set<number>(),
                symbolEditingIndex: null
            };
        }, () => {
            if (this.props.onDrawingsUpdate) {
                this.props.onDrawingsUpdate(finalDrawings);
            }
            if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                this.debouncedSave();
            }
            if (typeof this._afterRefreshDrawings === 'function') {
                this._afterRefreshDrawings();
            }
        });
    };

    verifyDrawingsSync = () => {
        if (!this.props.graphicsLayer) return;

        // Count actual visible graphics (excluding measurement labels)
        const visibleGraphics = this.props.graphicsLayer.graphics.filter(g =>
            !g.attributes?.isMeasurementLabel &&
            !g.attributes?.hideFromList
        ).length;

        // Compare with drawings array
        if (visibleGraphics !== this.state.drawings.length) {
            //console.warn(`Drawing sync issue detected: ${visibleGraphics} visible graphics vs ${this.state.drawings.length} drawings in state`);

            // Force refresh if mismatch detected
            this.forceMapRefresh();
        } else {
            //console.log(`Drawings sync verified: ${visibleGraphics} visible graphics match ${this.state.drawings.length} drawings in state`);
        }
    };

    scheduleDrawingsSyncCheck = () => {
        // Check sync 1 second after initialization
        setTimeout(() => {
            this.verifyDrawingsSync();

            // Additional check after 3 seconds to catch any lagging issues
            setTimeout(() => {
                this.verifyDrawingsSync();
            }, 3000);
        }, 1000);
    };

    sortGraphicsArray = (graphics: ExtendedGraphic[]) => {
        const { sortOption } = this.state;

        return [...graphics].sort((a, b) => {
            if (sortOption === 'name') {
                const nameA = (a.attributes?.name || '').toLowerCase();
                const nameB = (b.attributes?.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            } else if (sortOption === 'type') {
                const typeA = (a.attributes?.geometryType || a.geometry?.type || '').toLowerCase();
                const typeB = (b.attributes?.geometryType || b.geometry?.type || '').toLowerCase();
                return typeA.localeCompare(typeB);
            } else if (sortOption === 'created') {
                const createdA = a.attributes?.createdDate ? Number(a.attributes.createdDate) : 0;
                const createdB = b.attributes?.createdDate ? Number(b.attributes.createdDate) : 0;
                return createdB - createdA; // Newest first
            }
            return 0;
        });
    }

    handleConsentYes = () => {
        localStorage.setItem('drawingConsentGranted', 'true');
        this.setState({ consentGranted: true, showStorageDisclaimer: true });
    }

    handleDrawingSelect = (inGraphic: any) => {
        if (!inGraphic || !inGraphic.geometry || !this.sketchViewModel) return;

        // Block vertex/shape editing for locked drawings
        if (this.isDrawingLocked(inGraphic)) return;

        const graphic = inGraphic as ExtendedGraphic;
        //console.log('handleDrawingSelect called for:', graphic.geometry?.type, graphic.attributes?.name);

        // Are we in multi-select? (selectedGraphics holds all selected indices)
        const multiSet = this.state.selectedGraphics as Set<number> | undefined;
        // Treat multi as 2+ items, not 1+
        const isMulti = !!multiSet && multiSet.size > 1;

        // 1) Clear previous overlay more reliably
        if (!isMulti) {
            // Find and remove any existing overlays from other graphics
            this.state.drawings.forEach((drawing) => {
                const extDrawing = drawing as ExtendedGraphic;
                if (extDrawing._selectionOverlay && extDrawing !== graphic) {
                    this.removePointTextOverlay(extDrawing);
                }
            });
        }

        // 2) Cancel any active sketch interaction
        try { this.sketchViewModel.cancel(); } catch { }

        // 3) Normalize unsupported polyline symbols
        if (graphic.geometry.type === 'polyline' && graphic.symbol?.type !== 'simple-line') {
            const symbolColor = (graphic.symbol as any)?.color || [0, 0, 0, 1];
            const symbolWidth = (graphic.symbol as any)?.width || 2;
            const symbolStyle = (graphic.symbol as any)?.style || 'solid';
            graphic.symbol = new SimpleLineSymbol({ color: symbolColor, width: symbolWidth, style: symbolStyle });
        }

        const isPoint = graphic.geometry.type === 'point';
        const symbolType = (graphic.symbol as any)?.type;
        const isText = isPoint && symbolType === 'text';
        const isPictureMarker = isPoint && symbolType === 'picture-marker';

        //console.log('Graphic details - isPoint:', isPoint, 'symbolType:', symbolType, 'isText:', isText);

        const commonOptions: any = {
            enableRotation: true,
            enableScaling: true,
            enableZ: false,
            multipleSelectionEnabled: false
        };

        const pointOptions: any = {
            tool: 'transform',
            toggleToolOnClick: false,
            enableRotation: true,
            enableScaling: isText || isPictureMarker,
            enableZ: false,
            multipleSelectionEnabled: false
        };

        // 4) Apply selection/update to the clicked graphic
        // Use preserveGraphicsOrder to ensure draw order is maintained
        this.preserveGraphicsOrder(() => {
            this._isSelectingGraphic = true;

            try {
                //console.log('Applying SketchViewModel selection...');
                this.sketchViewModel.update([graphic], isPoint ? pointOptions : commonOptions);
            } catch (error) {
                console.warn('Error updating SketchViewModel for selection:', error);
                try { this.sketchViewModel.update([graphic]); } catch (fallbackError) {
                    console.warn('Fallback SketchViewModel update also failed:', fallbackError);
                }
            }

            // Clear flag after a delay
            setTimeout(() => {
                this._isSelectingGraphic = false;
            }, 300);
        });

        // 5) Ensure halos for all selected items in multi-select, plus this one
        try {
            if (isPoint) {
                //console.log('Setting timeout to create overlay for point graphic...');
                // Use setTimeout to ensure SketchViewModel operations complete first
                setTimeout(() => {
                    //console.log('Timeout executing - creating overlay now');
                    this.ensurePointTextOverlay(graphic);

                    // ADDITIONAL: Force a check after even more time
                    setTimeout(() => {
                        //console.log('Double-check: Does graphic have overlay?', !!graphic._selectionOverlay);
                        if (!graphic._selectionOverlay) {
                            //console.log('No overlay found - trying again');
                            this.ensurePointTextOverlay(graphic);
                        }
                    }, 200);
                }, 150); // Increased delay
            }

            if (isMulti) {
                // Ensure halo exists for each currently selected point/text
                multiSet!.forEach(idx => {
                    const g = this.state.drawings?.[idx] as ExtendedGraphic | undefined;
                    if (g && g.geometry?.type === 'point') {
                        setTimeout(() => {
                            this.ensurePointTextOverlay(g);
                        }, 150);
                    }
                });
            } else {
                // Single-select mode → only the current graphic should have a halo
                // (we already removed previous above)
            }
        } catch (e) {
            console.warn('Selection overlay management failed:', e);
        }

        // 6) Persist position changes & keep halo in sync while moving
        const graphicKey = graphic.attributes?.uniqueId || `temp_${Date.now()}`;

        if (this._positionWatchers && this._positionWatchers[graphicKey]) {
            this._positionWatchers[graphicKey].remove();
            delete this._positionWatchers[graphicKey];
        }
        if (!this._positionWatchers) this._positionWatchers = {};

        this._positionWatchers[graphicKey] = graphic.watch('geometry', (newGeometry) => {
            // Update selection overlay for point graphics
            if (isPoint && graphic._selectionOverlay) {
                try { graphic._selectionOverlay.geometry = newGeometry; } catch { }
            }

            // 🔧 REMOVED: Update measurement labels when geometry changes
            // The measure.tsx component has its own geometry change handling through SketchViewModel events
            // Calling updateMeasurementLabelPositions here creates race conditions
            // this.updateMeasurementLabelPositions(graphic).catch(err => {
            //     console.warn('Error updating measurement labels during geometry change:', err);
            // });

            // Debounced save
            clearTimeout(this._savePositionTimeout as any);
            this._savePositionTimeout = setTimeout(() => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            }, 500);
        });
    };

    handleListItemClick = (graphic: ExtendedGraphic, index: number) => {
        // Check consent
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        // Ensure attributes / uniqueId
        try {
            if (!graphic.attributes) (graphic as any).attributes = {};
            if (!(graphic as any).attributes.uniqueId) {
                (graphic as any).attributes.uniqueId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            }
        } catch (e) {
            console.warn('Panel: could not ensure uniqueId on graphic:', e);
        }

        // If already selected, just re-apply selection
        if (this.state.selectedGraphicIndex === index) {
            this.props.onClearSelectionOverlays?.();

            // Wrap in try-catch for safety
            Promise.resolve(
                typeof this.props.onDrawingSelect === 'function'
                    ? this.props.onDrawingSelect(graphic, index)
                    : (this as any).handleDrawingSelect?.(graphic, index)
            ).catch(error => {
                // Silently handle SketchViewModel errors
                if (error?.name !== 'AbortError') {
                    console.warn('Re-selection encountered an issue (non-critical):', error);
                }
            });
            return;
        }

        // Abort any ongoing navigation
        if (this._goToController) {
            this._goToController.abort();
            this._goToController = null;
        }

        // Update React state + auto-expand the selected drawing
        this.setState((prevState) => {
            const newCollapsed = new Set(prevState.collapsedDrawings);
            newCollapsed.delete(index); // Expand the selected drawing
            return { selectedGraphicIndex: index, collapsedDrawings: newCollapsed };
        });

        // If drawing is locked, zoom/highlight but skip edit mode
        if (this.isDrawingLocked(graphic)) {
            this.highlightGraphic(graphic, index).catch(error => {
                if (error?.name !== 'AbortError') {
                    console.warn('Highlight graphic failed (non-critical):', error);
                }
            });
            return;
        }

        // Initialize symbol editor state
        this.openSymbolEditor(index);

        // Apply selection + navigate (with error handling)
        this.highlightGraphic(graphic, index).catch(error => {
            console.warn('Highlight graphic failed (non-critical):', error);
        });
    };

    highlightGraphic = async (graphic: ExtendedGraphic, index: number) => {
        if (!graphic || !this.props.jimuMapView || this.state.consentGranted !== true) return;

        try {
            // 1) Abort any ongoing navigation
            if (this._goToController) {
                this._goToController.abort();
                this._goToController = null;
            }

            // 2) Ensure uniqueId
            try {
                if (!graphic.attributes) (graphic as any).attributes = {};
                if (!(graphic as any).attributes.uniqueId) {
                    (graphic as any).attributes.uniqueId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                }
            } catch (e) {
                console.warn('Panel: ensure uniqueId in highlightGraphic failed:', e);
            }

            // 3) Clear existing halos first
            this.props.onClearSelectionOverlays?.();

            // 4) Delegate selection to widget with error handling wrapper
            if (typeof this.props.onDrawingSelect === 'function') {
                try {
                    await this.props.onDrawingSelect(graphic, index);

                    // 🔧 CRITICAL FIX: After parent calls cancel() which removes measurements,
                    // restore measurements for graphics that were created with them
                    setTimeout(() => {
                        if (graphic.attributes?.hadMeasurements && this.measureRef?.current &&
                            !graphic.attributes?.measurementsHidden) {
                            //console.log('🔄 Restoring measurements after cancel for:', graphic.attributes?.name);
                            this.measureRef.current.updateMeasurementsForGraphic(graphic);
                        }
                    }, 150);
                } catch (error) {
                    // Catch SketchViewModel errors without blocking the rest of the function
                    if (error?.name !== 'AbortError' && error?.name !== 'view:goto-interrupted') {
                        console.warn('Selection update encountered an issue (non-critical):', error);
                    }
                    // Continue with navigation even if selection failed
                }
            }

            // 5) Always notify parent (if different callback)
            this.props.onDrawingSelect?.(graphic, index);

            // 6) Skip navigation if no geometry
            if (!graphic.geometry) return;

            // 7) Wait for view to be ready
            await this.props.jimuMapView.view.when();

            // 8) Build navigation target
            const controller = new AbortController();
            this._goToController = controller;

            let target: any | any = graphic.geometry as any;
            let scale: number;

            if (graphic.geometry.type !== 'point') {
                if ('centroid' in graphic.geometry) {
                    target = (graphic.geometry as any).centroid;
                } else if (graphic.geometry.extent?.center) {
                    target = graphic.geometry.extent.center;
                }
            }

            if (graphic.geometry.extent) {
                const extentWidth = graphic.geometry.extent.width;
                scale = extentWidth * 5;
                scale = Math.max(500, Math.min(50000, scale));
            } else {
                scale = 2000;
            }

            // 9) Execute navigation (catches internally)
            this.props.jimuMapView.view.goTo(
                { target, scale },
                { animate: false, duration: 0, signal: controller.signal }
            ).catch(err => {
                if (err?.name !== 'AbortError' && err?.name !== 'view:goto-interrupted') {
                    console.error('Navigation error:', err);
                }
            });

        } catch (error) {
            // Catch any other unexpected errors
            console.error('Error highlighting graphic (panel):', error);
        }
    };

    handleConsentNo = () => {
        // Set localStorage value to 'false' to remember user's choice
        localStorage.setItem('drawingConsentGranted', 'false');

        // Delete any existing stored drawings
        localStorage.removeItem(this.localStorageKey);

        // Set state to false but don't close the panel, just show the permission denied UI
        this.setState({ consentGranted: false });
    }

    handleDrawingsUpdate = (drawings: ExtendedGraphic[]) => {
        try {
            //console.log(`📊 handleDrawingsUpdate called with ${drawings.length} drawings`);

            // Notify parent component about the drawings update
            if (this.props.onDrawingsUpdate) {
                this.props.onDrawingsUpdate(drawings);
            }

            // Batch measurement updates with longer delays to prevent loops
            if (this.measureRef?.current && !this._processingMeasurements) {
                this._processingMeasurements = true;

                //console.log('🔄 Scheduling batched measurement refresh for updated drawings');

                // Process drawings in smaller batches with delays
                const batchSize = 2; // Process 2 drawings at a time
                const processBatch = (startIndex: number) => {
                    const endIndex = Math.min(startIndex + batchSize, drawings.length);
                    const batch = drawings.slice(startIndex, endIndex);

                    batch.forEach((drawing, localIndex) => {
                        const globalIndex = startIndex + localIndex;
                        if (drawing && drawing.geometry) {
                            // Stagger each measurement update with increasing delays
                            setTimeout(() => {
                                this.performSingleMeasurementUpdate(drawing);
                            }, globalIndex * 300); // 300ms delay between each drawing
                        }
                    });

                    // Process next batch if there are more drawings
                    if (endIndex < drawings.length) {
                        setTimeout(() => {
                            processBatch(endIndex);
                        }, batchSize * 300 + 200); // Extra delay between batches
                    } else {
                        // All batches processed
                        setTimeout(() => {
                            this._processingMeasurements = false;
                            //console.log('✅ Completed batched measurement processing');
                        }, batchSize * 300 + 500);
                    }
                };

                // Start processing the first batch
                setTimeout(() => {
                    processBatch(0);
                }, 1000); // Initial delay before starting
            } else {
                //console.log('📏 Measurement updates skipped - system busy or no measurement system available');
            }

            // Debounced save to localStorage
            this.debouncedSave();

        } catch (error) {
            console.error('❌ Error in handleDrawingsUpdate:', error);
            this._processingMeasurements = false; // Reset flag on error
            this.showLocalAlert(this.props.nls('errorUpdatingDrawings'), 'error');
        }
    };


    loadFromLocalStorage = () => {
        if (this.props.allowLocalStorage === false || this.state.consentGranted !== true) return;

        // Clean up localStorage first
        this.cleanupLocalStorageMeasurements();

        const storageKey = this.localStorageKey;
        //console.log(`📂 Loading drawings from localStorage key: ${storageKey}`);

        const savedData = localStorage.getItem(storageKey);
        if (!savedData) {
            //console.log(`📂 No saved drawings found for key: ${storageKey}`);
            return;
        }

        const runRestore = () => {
            try {
                const parsedData = JSON.parse(savedData);

                // Handle old format (array), v1.1, v1.2, v1.3, v1.4, and new v1.5 format
                let drawingsData = [];
                let measurementLabelsData = [];
                let hasManualOrder = true; // ← CHANGED: Default to true instead of false
                let sortOption: 'name' | 'type' | 'created' = 'name';
                let collapsedDrawings: number[] = []; // NEW: Load collapsed state
                let drawingLabelOption: 'off' | 'name' | 'notes' | 'both' = 'off'; // 🔧 NEW: Load label option
                let lockedDrawings: string[] = [];
                let allDrawingsLocked = false;

                if (Array.isArray(parsedData)) {
                    drawingsData = parsedData;
                    hasManualOrder = true; // ← NEW: Ensure legacy data gets manual order
                    //console.log('📂 Loading data in old format (drawings only) - defaulting to manual order');
                } else if (parsedData.version === "1.5" && parsedData.drawings) {
                    drawingsData = parsedData.drawings || [];
                    measurementLabelsData = parsedData.measurementLabels || [];
                    // ← CHANGED: Default to true if not explicitly set
                    hasManualOrder = parsedData.hasManualOrder !== undefined ? parsedData.hasManualOrder : true;
                    sortOption = parsedData.sortOption || 'name';
                    collapsedDrawings = parsedData.collapsedDrawings || []; // NEW: Load collapsed state

                    // 🔧 NEW: Restore global label option setting
                    if (parsedData.drawingLabelOption && ['off', 'name', 'notes', 'both'].includes(parsedData.drawingLabelOption)) {
                        drawingLabelOption = parsedData.drawingLabelOption;
                    }

                    // Restore lock state
                    lockedDrawings = parsedData.lockedDrawings || [];
                    allDrawingsLocked = parsedData.allDrawingsLocked || false;

                    //console.log(`📂 Loading data in v1.5 format (manual order: ${hasManualOrder}, sort: ${sortOption}, labels: ${drawingLabelOption})`);
                } else if (parsedData.version === "1.4" && parsedData.drawings) {
                    drawingsData = parsedData.drawings || [];
                    measurementLabelsData = parsedData.measurementLabels || [];
                    hasManualOrder = true; // ← NEW: Legacy versions get manual order
                    //console.log('📂 Loading data in v1.4 format - defaulting to manual order');
                } else if (parsedData.version === "1.3" && parsedData.drawings) {
                    drawingsData = parsedData.drawings || [];
                    measurementLabelsData = parsedData.measurementLabels || [];
                    hasManualOrder = true; // ← NEW: Legacy versions get manual order
                    //console.log('📂 Loading data in v1.3 format - defaulting to manual order');
                } else if (parsedData.version === "1.2" && parsedData.drawings) {
                    drawingsData = parsedData.drawings || [];
                    measurementLabelsData = parsedData.measurementLabels || [];
                    hasManualOrder = true; // ← NEW: Legacy versions get manual order
                    //console.log('📂 Loading data in v1.2 format - defaulting to manual order');
                } else if (parsedData.version === "1.1" && parsedData.drawings) {
                    drawingsData = parsedData.drawings || [];
                    measurementLabelsData = parsedData.measurementLabels || [];
                    hasManualOrder = true; // ← NEW: Legacy versions get manual order
                    //console.log('📂 Loading data in v1.1 format - defaulting to manual order');
                } else {
                    console.warn(`⚠️ Invalid data format in localStorage for key: ${storageKey}`);
                    return;
                }

                // **FIX: Set hasManualOrder and sortOption in state BEFORE restoring graphics**
                // FIX: Always collapse ALL drawings on application load
                // Users expect drawings to load collapsed; saved collapsed state is ignored
                const resolvedCollapsed = new Set(drawingsData.map((_: any, i: number) => i));

                this.setState({
                    hasManualOrder,
                    sortOption,
                    collapsedDrawings: resolvedCollapsed,
                    drawingLabelOption // 🔧 NEW: Restore label option in same setState
                }, () => {
                    // Now restore graphics with the correct state already set
                    if (this.props.graphicsLayer && this.props.graphicsLayer.graphics.length === 0) {
                        this.props.graphicsLayer.removeAll();
                        this.ignoreNextGraphicsUpdate = true;
                        this._isLoadingFromStorage = true; // FIX: Block watcher-triggered refreshes during load

                        let loadedDrawingsCount = 0;
                        let loadedBufferDrawingsCount = 0;
                        let loadedLabelsCount = 0;
                        let loadedBuffersCount = 0;
                        let loadedCustomizedLabelsCount = 0;
                        let restoredSegmentLabelCount = 0;
                        const restoredGraphics = new Map<string, ExtendedGraphic>();

                        //console.log(`📊 Restoring ${drawingsData.length} drawings in reverse order for correct visual stacking`);

                        for (let index = drawingsData.length - 1; index >= 0; index--) {
                            const item = drawingsData[index];
                            try {
                                const graphic = asExtendedGraphic(GraphicCompat.fromJSON(item));

                                if (!graphic.attributes) {
                                    graphic.attributes = {};
                                }

                                if (!graphic.attributes.uniqueId) {
                                    graphic.attributes.uniqueId = `restored_${Date.now()}_${index}`;
                                }

                                // Handle v1.2 format: Restore buffer drawing attributes if present (legacy permanent buffers)
                                if (item.attributes?.isBufferDrawing) {
                                    graphic.isBufferDrawing = true;
                                    graphic.sourceGraphicId = item.attributes.sourceGraphicId;
                                    graphic.attributes.isBufferDrawing = true;
                                    graphic.attributes.sourceGraphicId = item.attributes.sourceGraphicId;
                                    graphic.attributes.bufferDistance = item.attributes.bufferDistance;
                                    graphic.attributes.bufferUnit = item.attributes.bufferUnit;
                                    loadedBufferDrawingsCount++;
                                }
                                // CRITICAL: Restore buffer settings WITH opacity (v1.3+ format)
                                else if (item.attributes?.bufferSettings) {
                                    graphic.bufferSettings = {
                                        distance: item.attributes.bufferSettings.distance,
                                        unit: item.attributes.bufferSettings.unit,
                                        enabled: item.attributes.bufferSettings.enabled,
                                        opacity: item.attributes.bufferSettings.opacity,
                                        outlineOnly: item.attributes.bufferSettings.outlineOnly ?? false,
                                        customColor: item.attributes.bufferSettings.customColor ?? null,
                                        customOutlineColor: item.attributes.bufferSettings.customOutlineColor ?? null
                                    };

                                    if (graphic.bufferSettings.enabled) {
                                        loadedBuffersCount++;
                                    } else {
                                        loadedDrawingsCount++;
                                    }
                                } else {
                                    loadedDrawingsCount++;
                                }

                                // 🔧 NEW: Restore visibility state
                                if (item.attributes?.isHidden === true) {
                                    graphic.visible = false;
                                } else {
                                    graphic.visible = true; // Default to visible
                                }
                                // Restore notes if present
                                if (item.attributes?.notes) {
                                    if (!graphic.attributes) {
                                        graphic.attributes = {};
                                    }
                                    graphic.attributes.notes = item.attributes.notes;
                                }

                                // 🔧 NEW: Restore individual label option setting
                                if (item.attributes?.individualLabelOption) {
                                    if (!graphic.attributes) {
                                        graphic.attributes = {};
                                    }
                                    graphic.attributes.individualLabelOption = item.attributes.individualLabelOption;
                                }

                                // 🔧 NEW: Restore measurement visibility state
                                if (item.attributes?.measurementsHidden) {
                                    if (!graphic.attributes) {
                                        graphic.attributes = {};
                                    }
                                    graphic.attributes.measurementsHidden = true;
                                }

                                // FIX #11: Restore measurement unit metadata
                                if (item.attributes?.measurementUnits) {
                                    if (!graphic.attributes) {
                                        graphic.attributes = {};
                                    }
                                    graphic.attributes.measurementUnits = item.attributes.measurementUnits;
                                }


                                this.props.graphicsLayer.add(graphic);
                                restoredGraphics.set(graphic.attributes.uniqueId, graphic);
                            } catch (err) {
                                console.warn(`⚠️ Error restoring graphic at index ${index} from localStorage:`, err);
                            }
                        }

                        // Then, restore measurement labels and re-establish relationships WITH customization support
                        measurementLabelsData.forEach((item, index) => {
                            try {
                                const labelGraphic = asExtendedGraphic(GraphicCompat.fromJSON(item));

                                if (!labelGraphic.attributes) {
                                    labelGraphic.attributes = {};
                                }

                                // Ensure measurement label flags are set
                                labelGraphic.attributes.isMeasurementLabel = true;
                                labelGraphic.attributes.hideFromList = true;

                                // CRITICAL: Restore customization flags and custom position (v1.4+ format)
                                if (item.attributes?.customized) {
                                    labelGraphic.attributes.customized = true;
                                    labelGraphic.attributes.lastModified = item.attributes.lastModified;
                                    loadedCustomizedLabelsCount++;
                                }

                                if (item.attributes?.hasCustomPosition && item.attributes?.customPosition) {
                                    labelGraphic.attributes.hasCustomPosition = true;
                                    labelGraphic.attributes.customPosition = item.attributes.customPosition;
                                }

                                // Restore measurement type if present
                                if (item.attributes?.measurementType) {
                                    labelGraphic.attributes.measurementType = item.attributes.measurementType;
                                }

                                // Restore segment-specific attributes (the matching
                                // save block explicitly persists these — see
                                // measurementLabelsToSave above).
                                if (item.attributes?.isSegmentLabel) {
                                    labelGraphic.attributes.isSegmentLabel = true;
                                }
                                if (typeof item.attributes?.segmentIndex === 'number') {
                                    labelGraphic.attributes.segmentIndex = item.attributes.segmentIndex;
                                }
                                if (item.attributes?.segmentInfo) {
                                    labelGraphic.attributes.segmentInfo = item.attributes.segmentInfo;
                                }

                                // Restore any other measurement-specific attributes
                                if (item.attributes?.lengthUnit) {
                                    labelGraphic.attributes.lengthUnit = item.attributes.lengthUnit;
                                }
                                if (item.attributes?.areaUnit) {
                                    labelGraphic.attributes.areaUnit = item.attributes.areaUnit;
                                }

                                // Find the parent graphic and re-establish the relationship
                                const parentGraphicId = labelGraphic.attributes.parentGraphicId;

                                if (parentGraphicId && restoredGraphics.has(parentGraphicId)) {
                                    const parentGraphic = restoredGraphics.get(parentGraphicId);

                                    // 🔧 NEW: Skip loading labels for graphics with measurementsHidden
                                    // Labels were destroyed when hidden; they'll be recreated when user enables
                                    if (parentGraphic.attributes?.measurementsHidden) {
                                        //console.log(`⏭️ Skipping measurement label for hidden-measurement graphic: ${parentGraphicId}`);
                                        return; // Skip this label entirely
                                    }

                                    // Re-establish the parent-child relationship
                                    labelGraphic.measureParent = parentGraphic;

                                    // Set up the measure property on the parent — but ONLY
                                    // for the main/coordinate label, never for a segment
                                    // label. Previously this branch fired for whichever
                                    // label was processed first; if a segment label arrived
                                    // first, `parentGraphic.measure.graphic` would end up
                                    // pointing at a segment (which has lengthUnit but no
                                    // areaUnit), throwing off downstream logic that treats
                                    // `measure.graphic` as the main length/area label.
                                    const isSegmentTypeLabel =
                                        labelGraphic.attributes.measurementType === 'segment' ||
                                        labelGraphic.attributes.isSegmentLabel === true;
                                    if (!parentGraphic.measure && !isSegmentTypeLabel) {
                                        parentGraphic.measure = {
                                            graphic: labelGraphic,
                                            lengthUnit: labelGraphic.attributes.lengthUnit,
                                            areaUnit: labelGraphic.attributes.areaUnit
                                        };
                                    }

                                    // 🔧 CRITICAL: Mark that this graphic has measurements
                                    if (!parentGraphic.attributes) {
                                        parentGraphic.attributes = {};
                                    }
                                    parentGraphic.attributes.hadMeasurements = true;

                                    // Add to related measurement labels if needed
                                    if (!parentGraphic.attributes.relatedMeasurementLabels) {
                                        parentGraphic.attributes.relatedMeasurementLabels = [];
                                    }
                                    parentGraphic.attributes.relatedMeasurementLabels.push(labelGraphic);

                                    // Add to related segment labels if this is a segment measurement
                                    if (isSegmentTypeLabel) {
                                        if (!parentGraphic.attributes.relatedSegmentLabels) {
                                            parentGraphic.attributes.relatedSegmentLabels = [];
                                        }
                                        parentGraphic.attributes.relatedSegmentLabels.push(labelGraphic);
                                        restoredSegmentLabelCount++;
                                    }

                                    // Force visibility: Graphic.toJSON() does not serialize
                                    // the runtime `visible` property, so on rehydration
                                    // Graphic.fromJSON gives us visible=true by default.
                                    // Be explicit so any subsequent toggle logic has the
                                    // right initial state and segment labels render on reload.
                                    if (!(parentGraphic.attributes?.measurementsHidden)) {
                                        labelGraphic.visible = true;
                                    }

                                    this.props.graphicsLayer.add(labelGraphic);
                                    loadedLabelsCount++;
                                } else {
                                    console.warn(`⚠️ Auto-skipping orphaned measurement label at index ${index} - no valid parent found`);
                                }
                            } catch (err) {
                                console.warn(`⚠️ Error restoring measurement label at index ${index} from localStorage:`, err);
                            }
                        });

                        // If any segment labels were restored, the global segment toggle
                        // was on when these drawings were saved. Restore it now — BEFORE the
                        // post-restore measurement rebuild (handleDrawingsUpdate, ~500ms below)
                        // runs. Otherwise that rebuild calls cleanExistingMeasurements and then
                        // shouldCreateSegments() returns false (segmentsOn defaults to false on
                        // a fresh load), stripping the restored segment labels for good.
                        if (restoredSegmentLabelCount > 0) {
                            try {
                                this.measureRef?.current?.setSegmentsEnabled?.(true);
                            } catch (e) {
                                console.warn('Could not restore segment toggle state:', e);
                            }
                        }

                        // Finally, recreate attached buffers for graphics that had them (v1.3+ format)
                        setTimeout(() => {
                            restoredGraphics.forEach((graphic, uniqueId) => {
                                if (graphic.bufferSettings && graphic.bufferSettings.enabled) {
                                    this.recreateAttachedBuffer(graphic, true);

                                    // 🔧 NEW: Recreate buffer label if it existed
                                    if (graphic.bufferSettings.hasLabel && graphic.bufferGraphic) {
                                        setTimeout(() => {
                                            this.recreateBufferLabel(graphic);
                                        }, 100);
                                    }
                                }
                            });

                            const totalLoaded = loadedDrawingsCount + loadedBufferDrawingsCount;
                            if (totalLoaded > 0) {
                                // 🔧 CRITICAL FIX: Build drawings array in SAVED ORDER before calling refresh
                                // This ensures the manual order is preserved when refreshDrawingsFromLayer runs
                                const orderedDrawings: ExtendedGraphic[] = [];

                                // Iterate through drawingsData in ORIGINAL ORDER (not reversed)
                                for (let i = 0; i < drawingsData.length; i++) {
                                    const item = drawingsData[i];
                                    const uniqueId = item.attributes?.uniqueId;
                                    if (uniqueId && restoredGraphics.has(uniqueId)) {
                                        orderedDrawings.push(restoredGraphics.get(uniqueId));
                                    }
                                }

                                // Set drawings in state BEFORE calling refresh
                                // FIX: Explicitly set all-collapsed to prevent any race with measurement label restore
                                const allCollapsedIndices = new Set(orderedDrawings.map((_: any, i: number) => i));
                                this.setState({ drawings: orderedDrawings, collapsedDrawings: allCollapsedIndices }, () => {
                                    // FIX: Clear loading flag now that state is committed
                                    this._isLoadingFromStorage = false;

                                    // Now refreshDrawingsFromLayer will see drawings.length > 0 and preserve order
                                    this.refreshDrawingsFromLayer();

                                    // 🔧 NEW: Recreate drawing labels after restoration
                                    //console.log(`🏷️ Scheduling label recreation in 300ms - current drawingLabelOption: ${this.state.drawingLabelOption}`);
                                    setTimeout(() => {
                                        //console.log(`🏷️ Calling updateAllDrawingLabels() - drawingLabelOption: ${this.state.drawingLabelOption}, drawings: ${this.state.drawings.length}`);
                                        this.updateAllDrawingLabels();
                                    }, 300);
                                });

                                let successMessage = `✅ Successfully loaded ${loadedDrawingsCount} drawing(s)`;
                                if (loadedBufferDrawingsCount > 0) {
                                    successMessage += `, ${loadedBufferDrawingsCount} buffer drawing(s)`;
                                }
                                if (loadedLabelsCount > 0) {
                                    successMessage += `, ${loadedLabelsCount} measurement label(s)`;
                                }
                                if (loadedCustomizedLabelsCount > 0) {
                                    successMessage += ` (${loadedCustomizedLabelsCount} customized)`;
                                }
                                if (loadedBuffersCount > 0) {
                                    successMessage += `, and recreated ${loadedBuffersCount} attached buffer(s)`;
                                }
                                successMessage += ` from key: ${storageKey}`;
                                //console.log(successMessage);
                                //console.log(`   Manual order: ${this.state.hasManualOrder}, Sort: ${this.state.sortOption}`);
                                //console.log(`   ✅ Graphics added in reverse order for correct visual stacking`);

                                // Trigger measurement refresh after loading
                                setTimeout(() => {
                                    this.handleDrawingsUpdate(this.state.drawings);
                                }, 500);

                                // Additional cleanup after loading
                                setTimeout(() => {
                                    this.cleanupOrphanedMeasurementLabels();
                                }, 1000);
                            } else {
                                //console.log(`📂 No valid drawings loaded from key: ${storageKey}`);
                                this._isLoadingFromStorage = false; // Safety net
                            }
                        }, 200);
                    } else {
                        //console.log(`📂 Graphics layer is not empty; skipping load from key: ${storageKey}`);
                        this._isLoadingFromStorage = false; // Safety net
                    }
                });
            } catch (err) {
                this._isLoadingFromStorage = false; // Safety net
                console.error(`❌ Error parsing drawings from localStorage key: ${storageKey}`, err);
                this.showLocalAlert('Error loading saved drawings', 'error');
            }
        };

        // Defer restore until idle if possible
        if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(runRestore);
        } else {
            setTimeout(runRestore, 0);
        }
    };

    saveToLocalStorage = () => {
        if (this.props.allowLocalStorage === false || this.state.consentGranted !== true) return;

        // Clear any existing timeout to debounce rapid calls
        if (this._saveToStorageTimeout) {
            clearTimeout(this._saveToStorageTimeout);
        }

        // Debounce the save operation - only save after 2 seconds of inactivity
        this._saveToStorageTimeout = setTimeout(() => {
            this.performActualSave();
        }, 300);
    };


    showLocalAlert = (message: string, type: 'success' | 'error' | 'info' | 'warning') => {
        // If parent provided a showAlert function, use it
        if (this.props.showAlert) {
            this.props.showAlert(message, type as 'success' | 'error' | 'info');
            return;
        }

        // Otherwise, use internal state
        this.setState({ alertMessage: message, alertType: type, showAlert: true });
        setTimeout(() => this.setState({ showAlert: false }), 3000);
    }

    // Open notes dialog for a specific drawing
    openNotesDialog = (index: number, event: React.MouseEvent) => {
        event.stopPropagation();
        const graphic = this.state.drawings[index];
        const currentNotes = graphic?.attributes?.notes || '';

        this.setState({
            notesDialogOpen: true,
            notesEditingIndex: index,
            notesEditingText: currentNotes
        });
    };

    // Close notes dialog - auto-save before closing
    closeNotesDialog = () => {
        // Clear any pending save timeout
        if (this.state.notesSaveTimeout) {
            clearTimeout(this.state.notesSaveTimeout);
        }

        // Save notes before closing
        const { notesEditingIndex, notesEditingText, drawings } = this.state;

        if (notesEditingIndex !== null) {
            const updatedDrawings = [...drawings];
            const graphic = updatedDrawings[notesEditingIndex];

            if (graphic) {
                if (!graphic.attributes) {
                    graphic.attributes = {};
                }

                // Save notes to graphic attributes
                graphic.attributes.notes = notesEditingText;

                // Update the graphic in the graphics layer
                this.props.graphicsLayer.remove(graphic);
                this.props.graphicsLayer.add(graphic);

                // Save to local storage silently
                this.debouncedSave();
            }
        }

        this.setState({
            notesDialogOpen: false,
            notesEditingIndex: null,
            notesEditingText: '',
            notesSaveTimeout: null
        });

        // Update drawing labels if notes display is enabled
        this.updateAllDrawingLabels();
    };

    // Save notes for the current drawing (silent, no alert)
    saveNotes = () => {
        const { notesEditingIndex, notesEditingText, drawings } = this.state;

        if (notesEditingIndex === null) return;

        const updatedDrawings = [...drawings];
        const graphic = updatedDrawings[notesEditingIndex];

        if (!graphic.attributes) {
            graphic.attributes = {};
        }

        // Save notes to graphic attributes
        graphic.attributes.notes = notesEditingText;

        // Update the graphic in the graphics layer
        this.props.graphicsLayer.remove(graphic);
        this.props.graphicsLayer.add(graphic);

        this.setState({
            drawings: updatedDrawings
        }, () => {
            this.debouncedSave();
            // No alert - silent auto-save

            // Update drawing labels if notes display is enabled
            this.updateAllDrawingLabels();
        });
    };

    updateNotesText = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        let newText = event.target.value;

        // Enforce 2000-character limit
        if (newText.length > 2000) {
            newText = newText.slice(0, 2000);
        }

        // Clear existing timeout
        if (this.state.notesSaveTimeout) {
            clearTimeout(this.state.notesSaveTimeout as ReturnType<typeof setTimeout>);
        }

        // Set up new debounced save (2 seconds after typing stops)
        const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
            this.saveNotes();
        }, 2000);

        this.setState({
            notesEditingText: newText,
            notesSaveTimeout: timeout
        });
    };

    // Deletes the note from the current drawing, keeps the drawing itself, and closes the dialog
    deleteCurrentNote = () => {
        const { notesEditingIndex, drawings } = this.state;
        if (notesEditingIndex === null) return;

        const updatedDrawings = [...drawings];
        const graphic = updatedDrawings[notesEditingIndex];
        if (!graphic) return;

        // Remove the note attribute
        if (graphic.attributes) {
            delete (graphic as any).attributes?.notes;
        }

        // Refresh the graphic so the UI updates
        try {
            this.props.graphicsLayer?.remove(graphic);
            this.props.graphicsLayer?.add(graphic);
        } catch (e) {
            console.warn('Failed to refresh graphic after deleting note:', e);
        }

        // Clear editor text, persist, and close the dialog
        this.setState(
            {
                drawings: updatedDrawings,
                notesEditingText: '',
                notesDialogOpen: false
            },
            () => (this.saveToLocalStorage ? this.debouncedSave() : null)
        );
    };

    updateSymbolWithoutClosing = (symbol: any, index: number) => {
        const drawings = [...this.state.drawings];

        if (!drawings[index]) {
            console.warn(`Drawing not found at index ${index}`);
            return;
        }

        const g = drawings[index];

        try {
            const view: any | any = (this.props as any).view || (this.props as any).mapView;
            const layer: any = this.props.graphicsLayer;

            if (view && layer) {
                if (!this.sketchViewModel) {
                    this.sketchViewModel = new SketchViewModel({
                        view,
                        useLegacyCreateTools: false, // next-gen create/update: allows curve segments + shift-drag-to-curve on edit
                        layer,
                        defaultUpdateOptions: { enableScaling: true, enableRotation: true }
                    });
                } else if (this.sketchViewModel.layer !== layer) {
                    this.sketchViewModel.layer = layer;
                }
                this.sketchViewModel.cancel();
            }

            let preservedArrowMarker: any = null;
            let needsArrowColorUpdate = false;

            if (g.geometry?.type === 'polyline' && g.symbol?.type === 'simple-line') {
                const orig = g.symbol as any;
                preservedArrowMarker = (orig as any).marker || null;
                if (preservedArrowMarker) needsArrowColorUpdate = true;
            }

            if (g.geometry?.type === 'polyline') {
                if (!symbol || symbol.type !== 'simple-line') {
                    symbol = new SimpleLineSymbol({
                        color: symbol?.color || [0, 0, 0, 1],
                        width: symbol?.width || 2,
                        style: symbol?.style || 'solid'
                    });
                } else {
                    symbol = symbol.clone();
                }

                if (preservedArrowMarker) {
                    try {
                        const updatedMarker = JSON.parse(JSON.stringify(preservedArrowMarker));
                        if (needsArrowColorUpdate) (updatedMarker as any).color = (symbol as any)?.color;
                        (symbol as any).marker = updatedMarker;
                    } catch {
                        (symbol as any).marker = {
                            type: (preservedArrowMarker as any).type,
                            style: (preservedArrowMarker as any).style,
                            placement: (preservedArrowMarker as any).placement,
                            color: needsArrowColorUpdate ? (symbol as any)?.color : (preservedArrowMarker as any).color
                        };
                    }
                }
            } else {
                if (symbol) {
                    symbol = symbol.clone();
                }
            }

            // 🔧 CRITICAL FIX: Handle TextSymbol text preservation
            if (symbol?.type === 'text') {
                const textSymbol = symbol as TextSymbol;

                // console.log('📝 MyDrawingsPanel - Received text symbol update:', {
                //     text: JSON.stringify(textSymbol.text),
                //     length: textSymbol.text?.length,
                //     hasSpaces: textSymbol.text?.includes(' '),
                //     charCodes: textSymbol.text ? Array.from(textSymbol.text).map(c => c.charCodeAt(0)) : []
                // });

                // CRITICAL: Ensure text is preserved exactly as provided
                if (textSymbol.text !== undefined) {
                    // Don't trim, don't modify - use the text exactly as provided
                    const preservedText = textSymbol.text;

                    // Ensure the symbol uses the exact text
                    symbol.text = preservedText;

                    // Also update the graphic's name attribute to match (without trimming)
                    if (!g.attributes) {
                        g.attributes = {};
                    }
                    g.attributes.name = preservedText;

                    // console.log('📝 MyDrawingsPanel - After preservation:', {
                    //     symbolText: JSON.stringify(symbol.text),
                    //     attributeName: JSON.stringify(g.attributes.name),
                    //     hasSpaces: symbol.text?.includes(' ')
                    // });
                }

                // Ensure font is properly initialized
                if (!textSymbol.font) {
                    textSymbol.font = new Font({ size: 12 });
                } else {
                    textSymbol.font = new Font({
                        family: textSymbol.font.family || 'Arial',
                        size: textSymbol.font.size || 12,
                        style: textSymbol.font.style || 'normal',
                        weight: textSymbol.font.weight || 'normal',
                        decoration: textSymbol.font.decoration || 'none'
                    });
                }

                // Ensure color exists
                if (!textSymbol.color) {
                    textSymbol.color = new Color([0, 0, 0, 1]);
                }

                symbol = textSymbol;
            }

            this.ignoreNextGraphicsUpdate = true;
            g.symbol = symbol;
            drawings[index] = g;

            if (layer) {
                // Preserve the graphic's position in the layer to maintain draw order
                const graphicIndex = layer.graphics.indexOf(g);
                layer.remove(g);
                layer.add(g);
                // Reorder back to original position
                layer.graphics.reorder(g, graphicIndex);
            }

            const reselect = () => {
                if (this.sketchViewModel) {
                    // Preserve graphics order during reselection
                    this.preserveGraphicsOrder(() => {
                        this._isSelectingGraphic = true;
                        try {
                            this.sketchViewModel.update([g], {
                                tool: 'transform',
                                enableRotation: true,
                                enableScaling: true
                            });
                        } catch (e) {
                            console.warn('SketchViewModel.update failed to reselect graphic:', e);
                        }
                        // Clear flag after a delay
                        setTimeout(() => {
                            this._isSelectingGraphic = false;
                        }, 300);
                    });
                }
            };
            reselect();
            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(reselect);
            } else {
                setTimeout(reselect, 0);
            }

            this.setState({ drawings }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
                if (this.props.onDrawingsUpdate) {
                    this.props.onDrawingsUpdate(drawings);
                }
            });
        } catch (err) {
            console.error('Error updating symbol:', err);
            this.showLocalAlert(this.props.nls('errorUpdatingSymbol'), 'error');
        }
    };

    isSupportedSymbol = (symbol: any, geometryType?: string): boolean => {
        if (!symbol) return false;

        // Always consider polylines as supported, regardless of symbol type
        if (geometryType === 'polyline') {
            return true; // Allow all polyline symbols
        }

        if (geometryType === 'point') {
            return symbol.type && ['simple-marker', 'picture-marker', 'text'].includes(symbol.type);
        }
        if (geometryType === 'polygon') {
            return symbol.type === 'simple-fill';
        }
        return false;
    };

    ensureMapViewReady = async () => {
        if (!this.props.jimuMapView?.view) return false;

        try {
            // Ensure view is ready
            await this.props.jimuMapView.view.when();

            // Also ensure layer view for graphics layer is ready
            if (this.props.graphicsLayer) {
                await this.props.jimuMapView.view.whenLayerView(this.props.graphicsLayer);
            }

            return true;
        } catch (err) {
            console.warn("Error ensuring map view ready:", err);
            return false;
        }
    };

    // Methods for confirmation dialog handling
    openConfirmDialog = (message: string, type: 'delete' | 'clearAll', action: () => void, itemIndex: number = -1) => {
        this.setState({
            confirmDialogOpen: true,
            confirmDialogMessage: message,
            confirmDialogAction: action,
            confirmDialogType: type,
            confirmDialogItemIndex: itemIndex >= 0 ? itemIndex : null
        });
    }

    closeConfirmDialog = () => {
        this.setState({
            confirmDialogOpen: false,
            confirmDialogAction: null,
            confirmDialogItemIndex: null
        });
    }

    executeConfirmAction = () => {
        // Execute the stored action
        if (this.state.confirmDialogAction) {
            this.state.confirmDialogAction();
        }

        // Close the dialog
        this.closeConfirmDialog();
    }

    handleCopyDrawing = (index: number, event?: React.MouseEvent) => {
        // Check consent
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        // Stop event propagation if provided
        if (event) {
            event.stopPropagation();
        }

        try {
            // Get the graphic to copy
            const graphicToCopy = this.state.drawings[index];
            if (!graphicToCopy) return;

            // Clone the graphic
            const graphicJson = graphicToCopy.toJSON();
            const newGraphic = GraphicCompat.fromJSON(graphicJson) as ExtendedGraphic;

            // Modify attributes for the new copy
            if (!newGraphic.attributes) {
                newGraphic.attributes = {};
            }

            // Generate new uniqueId
            newGraphic.attributes.uniqueId = `copy_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

            // Update the name to indicate it's a copy
            const originalName = graphicToCopy.attributes?.name || `Drawing ${index + 1}`;
            newGraphic.attributes.name = `Copy of ${originalName}`;

            // Update creation date to now
            newGraphic.attributes.createdDate = Date.now();

            // Mark that we're about to update the graphics layer
            this.ignoreNextGraphicsUpdate = true;

            // Add to the graphics layer
            // Ensure visibility defaults to true
            newGraphic.visible = true;
            this.props.graphicsLayer.add(newGraphic);

            // Refresh drawings from layer to update the UI
            this.refreshDrawingsFromLayer();

            // FIXED: Use the new handleDrawingsUpdate method with proper state access
            setTimeout(() => {
                //console.log('📋 Graphic copied, triggering measurement refresh');

                // Get the updated drawings from state after refresh
                // Note: We need to access the updated state, so we'll use a callback approach
                this.setState((prevState) => {
                    // Trigger the measurement update with the current drawings
                    this.handleDrawingsUpdate(prevState.drawings);
                    return prevState; // Don't actually change state, just use the callback to access current state
                });
            }, 200);

        } catch (error) {
            console.error('❌ Error copying graphic:', error);
            this.showLocalAlert(this.props.nls('errorCopyingDrawing'), 'error');
        }
    };

    toggleGraphicVisibility = (index: number, event?: React.MouseEvent) => {
        // Stop event propagation if provided
        if (event) {
            event.stopPropagation();
        }

        const graphic = this.state.drawings[index];
        if (!graphic) return;

        const extGraphic = asExtendedGraphic(graphic);

        // Toggle visibility state (default to true if not set)
        const newVisibility = extGraphic.visible === false ? true : false;

        // Set a flag to prevent the graphics watcher from calling refreshDrawingsFromLayer
        // This prevents the order from being disrupted during visibility toggle
        this._isTogglingVisibility = true;

        extGraphic.visible = newVisibility;

        // Also hide/show buffer if it exists
        if (extGraphic.bufferGraphic) {
            const bufferExt = asExtendedGraphic(extGraphic.bufferGraphic);
            bufferExt.visible = newVisibility;
        }

        // 🔧 NEW: Also hide/show buffer label if it exists
        if (extGraphic.bufferLabel) {
            extGraphic.bufferLabel.visible = newVisibility;
        }

        // 🔧 NEW: Also hide/show drawing label if it exists
        if (extGraphic.drawingLabel) {
            extGraphic.drawingLabel.visible = newVisibility;
        }

        // Find the graphic in the layer
        const layerGraphic = this.props.graphicsLayer.graphics.find(g => g === graphic);
        if (layerGraphic) {
            // Just set visibility directly - no need to remove and re-add
            layerGraphic.visible = newVisibility;

            // Also set buffer visibility if it exists
            if (extGraphic.bufferGraphic) {
                const layerBuffer = this.props.graphicsLayer.graphics.find(g => g === extGraphic.bufferGraphic);
                if (layerBuffer) {
                    layerBuffer.visible = newVisibility;
                }
            }

            // 🔧 NEW: Also set buffer label visibility if it exists
            if (extGraphic.bufferLabel) {
                const layerLabel = this.props.graphicsLayer.graphics.find(g => g === extGraphic.bufferLabel);
                if (layerLabel) {
                    layerLabel.visible = newVisibility;
                }
            }

            // 🔧 NEW: Also set drawing label visibility if it exists
            if (extGraphic.drawingLabel) {
                const layerLabel = this.props.graphicsLayer.graphics.find(g => g === extGraphic.drawingLabel);
                if (layerLabel) {
                    layerLabel.visible = newVisibility;
                }
            }
        }

        // FIXED: Measurement labels should remain visible unless parent is explicitly hidden
        // Labels should stay visible when graphic is deselected, only hide when parent is explicitly hidden
        const graphicUniqueId = extGraphic.attributes?.uniqueId;
        if (graphicUniqueId) {
            // 🔧 NEW: Check if measurements are individually hidden for this drawing
            const measurementsHidden = extGraphic.attributes?.measurementsHidden === true;

            // Find all measurement labels that belong to this graphic
            this.props.graphicsLayer.graphics.forEach(g => {
                const extG = asExtendedGraphic(g);
                // Check if this is a measurement label for our graphic
                if (extG.attributes?.isMeasurementLabel &&
                    extG.attributes?.parentGraphicId === graphicUniqueId) {
                    // Only hide labels when parent is being explicitly hidden (not deselected)
                    // Labels should remain visible when graphic is just deselected
                    if (newVisibility === false) {
                        // Hide measurement labels when parent is explicitly hidden
                        g.visible = false;
                        extG.visible = false;
                    } else {
                        // 🔧 NEW: When showing parent, respect measurementsHidden setting
                        const shouldShow = !measurementsHidden;
                        g.visible = shouldShow;
                        extG.visible = shouldShow;
                    }
                }
            });

            // 🔧 NEW: Also toggle visibility of buffer labels associated with this graphic
            this.props.graphicsLayer.graphics.forEach(g => {
                const extG = asExtendedGraphic(g);
                // Check if this is a buffer label for our graphic
                if (extG.attributes?.isBufferLabel &&
                    extG.attributes?.parentId === graphicUniqueId) {
                    g.visible = newVisibility;
                    extG.visible = newVisibility;
                }
                // 🔧 NEW: Also check for drawing labels
                if (extG.attributes?.isDrawingLabel &&
                    extG.attributes?.parentId === graphicUniqueId) {
                    g.visible = newVisibility;
                    extG.visible = newVisibility;
                }
            });
        }

        // Clear the flag after a short delay
        setTimeout(() => {
            this._isTogglingVisibility = false;
        }, 100);

        // Update state to trigger re-render so the eye icon updates
        this.setState({
            drawings: [...this.state.drawings]
        }, () => {
            this.debouncedSave();
        });
    };

    toggleAllGraphicsVisibility = () => {
        const { drawings } = this.state;
        if (drawings.length === 0) return;

        // Check if all drawings are currently visible
        const allVisible = drawings.every(graphic => {
            const extGraphic = asExtendedGraphic(graphic);
            return extGraphic.visible !== false;
        });

        // Toggle to opposite state: if all visible, hide all; if any hidden, show all
        const newVisibility = !allVisible;

        // Set flag to prevent graphics watcher disruption
        this._isTogglingVisibility = true;

        // Toggle visibility for all drawings
        drawings.forEach(graphic => {
            const extGraphic = asExtendedGraphic(graphic);
            extGraphic.visible = newVisibility;

            // Also toggle buffer if it exists
            if (extGraphic.bufferGraphic) {
                const bufferExt = asExtendedGraphic(extGraphic.bufferGraphic);
                bufferExt.visible = newVisibility;
            }

            // Also toggle buffer label if it exists
            if (extGraphic.bufferLabel) {
                extGraphic.bufferLabel.visible = newVisibility;
            }

            // Also toggle drawing label if it exists
            if (extGraphic.drawingLabel) {
                extGraphic.drawingLabel.visible = newVisibility;
            }

            // Find the graphic in the layer and update
            const layerGraphic = this.props.graphicsLayer.graphics.find(g => g === graphic);
            if (layerGraphic) {
                layerGraphic.visible = newVisibility;

                // Also set buffer visibility if it exists
                if (extGraphic.bufferGraphic) {
                    const layerBuffer = this.props.graphicsLayer.graphics.find(g => g === extGraphic.bufferGraphic);
                    if (layerBuffer) {
                        layerBuffer.visible = newVisibility;
                    }
                }

                // Also set buffer label visibility if it exists
                if (extGraphic.bufferLabel) {
                    const layerLabel = this.props.graphicsLayer.graphics.find(g => g === extGraphic.bufferLabel);
                    if (layerLabel) {
                        layerLabel.visible = newVisibility;
                    }
                }

                // Also set drawing label visibility if it exists
                if (extGraphic.drawingLabel) {
                    const layerLabel = this.props.graphicsLayer.graphics.find(g => g === extGraphic.drawingLabel);
                    if (layerLabel) {
                        layerLabel.visible = newVisibility;
                    }
                }
            }

            // Handle measurement labels
            const graphicUniqueId = extGraphic.attributes?.uniqueId;
            if (graphicUniqueId) {
                // 🔧 NEW: Check if measurements are individually hidden for this drawing
                const measurementsHidden = extGraphic.attributes?.measurementsHidden === true;

                this.props.graphicsLayer.graphics.forEach(g => {
                    const extG = asExtendedGraphic(g);
                    // Toggle measurement labels - respect measurementsHidden when showing
                    if (extG.attributes?.isMeasurementLabel &&
                        extG.attributes?.parentGraphicId === graphicUniqueId) {
                        const shouldShow = newVisibility && !measurementsHidden;
                        g.visible = shouldShow;
                        extG.visible = shouldShow;
                    }
                    // Toggle buffer labels
                    if (extG.attributes?.isBufferLabel &&
                        extG.attributes?.parentId === graphicUniqueId) {
                        g.visible = newVisibility;
                        extG.visible = newVisibility;
                    }
                    // Toggle drawing labels
                    if (extG.attributes?.isDrawingLabel &&
                        extG.attributes?.parentId === graphicUniqueId) {
                        g.visible = newVisibility;
                        extG.visible = newVisibility;
                    }
                });
            }
        });

        // Handle segment labels for all drawings
        drawings.forEach(graphic => {
            const extGraphic = asExtendedGraphic(graphic);
            if (extGraphic.attributes?.relatedSegmentLabels &&
                Array.isArray(extGraphic.attributes.relatedSegmentLabels)) {
                extGraphic.attributes.relatedSegmentLabels.forEach(segmentLabel => {
                    if (segmentLabel && !segmentLabel.destroyed) {
                        segmentLabel.visible = newVisibility;
                    }
                });
            }
        });

        // Clear the flag after a short delay
        setTimeout(() => {
            this._isTogglingVisibility = false;
        }, 100);

        // Update state to trigger re-render
        this.setState({
            drawings: [...this.state.drawings]
        }, () => {
            this.debouncedSave();
        });
    };

    // ===== Measurement Visibility Toggle =====

    /**
     * FIX #6/#18: Wait for the measurement system to finish processing before executing callback.
     * Polls measureRef.isBusy() instead of using a hard-coded timeout.
     * Falls back to maxWait ms if isBusy never returns false.
     */
    private waitForMeasurementComplete = (callback: () => void, maxWait: number = 3000) => {
        const startTime = Date.now();
        const pollInterval = 80;

        const poll = () => {
            const isBusy = this.measureRef?.current?.isBusy?.() ?? false;
            const elapsed = Date.now() - startTime;

            if (!isBusy || elapsed >= maxWait) {
                callback();
            } else {
                setTimeout(poll, pollInterval);
            }
        };

        // Give the system a moment to start processing before polling
        setTimeout(poll, 100);
    };

    /**
     * Physically remove all measurement label graphics for a drawing from the graphics layer
     * and clear all measurement references. measure.tsx cannot show labels that don't exist.
     * Used specifically by the measurement visibility toggle (not general deletion).
     */
    private destroyMeasurementLabelsForToggle = (graphic: ExtendedGraphic) => {
        const uid = graphic?.attributes?.uniqueId;
        if (!uid) return;

        // Collect all measurement labels belonging to this graphic
        const toRemove: any[] = [];
        this.props.graphicsLayer.graphics.forEach(g => {
            const extG = asExtendedGraphic(g);
            if (extG.attributes?.isMeasurementLabel &&
                extG.attributes?.parentGraphicId === uid) {
                toRemove.push(g);
            }
        });

        // Also collect from direct references (may overlap, that's fine)
        if (graphic.measure?.graphic) {
            const mg = graphic.measure.graphic;
            if (!toRemove.includes(mg)) toRemove.push(mg);
        }
        if (graphic.attributes?.relatedSegmentLabels) {
            graphic.attributes.relatedSegmentLabels.forEach(s => {
                if (s && !s.destroyed && !toRemove.includes(s)) toRemove.push(s);
            });
        }
        if (graphic.attributes?.relatedMeasurementLabels) {
            graphic.attributes.relatedMeasurementLabels.forEach(m => {
                if (m && !m.destroyed && !toRemove.includes(m)) toRemove.push(m);
            });
        }

        // Remove them all from the layer
        this.ignoreNextGraphicsUpdate = true;
        toRemove.forEach(g => {
            try { this.props.graphicsLayer.remove(g); } catch { }
        });

        // Clear all measurement references from the graphic
        graphic.measure = null;
        if (graphic.attributes) {
            graphic.attributes.relatedMeasurementLabels = [];
            graphic.attributes.relatedSegmentLabels = [];
            // FIX #7: KEEP hadMeasurements = true so hide→reload→show cycle
            // can still recreate labels. Only clear the live reference flags.
            // hadMeasurements is intentionally preserved.
            graphic.attributes.measurementsPermanent = false;
        }
    };

    /**
     * Toggle measurement label visibility for an individual drawing.
     * When hidden, all measurement labels (total and segment) associated with
     * this drawing are hidden on the map but remain persisted in localStorage.
     */
    toggleMeasurementVisibility = (index: number, event?: React.MouseEvent) => {
        if (event) {
            event.stopPropagation();
        }

        const graphic = this.state.drawings[index];
        if (!graphic) return;

        const extGraphic = asExtendedGraphic(graphic);
        if (!extGraphic.attributes) {
            extGraphic.attributes = {};
        }

        const isCurrentlyHidden = extGraphic.attributes.measurementsHidden === true;

        // Check if live measurement labels exist on the layer right now
        const hasMeasurements =
            (extGraphic as any).measure?.graphic ||
            extGraphic.attributes?.hadMeasurements ||
            extGraphic.attributes?.measurementsPermanent ||
            (extGraphic.attributes?.relatedMeasurementLabels?.length > 0) ||
            (extGraphic.attributes?.relatedSegmentLabels?.length > 0);

        // Helper to create measurements from scratch
        const createMeasurements = () => {
            extGraphic.attributes.measurementsHidden = false;

            if (!this.measureRef?.current) {
                console.warn('⚠️ measureRef not available');
                return;
            }

            const wasEnabled = this.measureRef.current.isMeasurementEnabled?.() ?? false;

            if (!wasEnabled) {
                this.measureRef.current.enableMeasurements?.();
            }

            this.measureRef.current.updateMeasurementsForGraphic(extGraphic);

            if (!wasEnabled) {
                // FIX #6/#18: Poll isBusy instead of hard-coded 600ms timeout
                this.waitForMeasurementComplete(() => {
                    try {
                        extGraphic.attributes.hadMeasurements = true;
                        extGraphic.attributes.measurementsPermanent = true;
                        this.measureRef?.current?.disableMeasurements?.(true);
                        this.setState({ drawings: [...this.state.drawings] }, () => {
                            // FIX #15: Single save after all work is done
                            this.debouncedSave();
                        });
                    } catch (err) {
                        console.warn('⚠️ Error restoring measurement state:', err);
                    }
                });
            } else {
                // FIX #15: Single save, no triple-save
                this.setState({ drawings: [...this.state.drawings] }, () => {
                    this.debouncedSave();
                });
            }
        };

        if (isCurrentlyHidden) {
            // Currently hidden → recreate measurements from scratch
            createMeasurements();
        } else if (hasMeasurements) {
            // Has visible measurements → destroy labels entirely
            this._isTogglingVisibility = true;
            extGraphic.attributes.measurementsHidden = true;
            this.destroyMeasurementLabelsForToggle(extGraphic);

            setTimeout(() => {
                this._isTogglingVisibility = false;
            }, 100);

            this.setState({ drawings: [...this.state.drawings] }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } else {
            // No measurements at all → create them for the first time
            createMeasurements();
        }
    };

    /**
     * Toggle measurements on/off for ALL non-text drawings at once.
     * If any drawing has visible measurements, hide all. Otherwise, show/create all.
     */
    toggleAllMeasurements = () => {
        const { drawings } = this.state;
        if (drawings.length === 0) return;

        // Determine current state: are any non-text drawings showing measurements?
        const nonTextDrawings = drawings.filter(d => {
            const ext = asExtendedGraphic(d);
            return ext.symbol?.type !== 'text';
        });

        if (nonTextDrawings.length === 0) return;

        const anyVisible = nonTextDrawings.some(d => {
            const ext = asExtendedGraphic(d);
            const hasMeasurements =
                (ext as any).measure?.graphic ||
                ext.attributes?.hadMeasurements ||
                ext.attributes?.measurementsPermanent ||
                (ext.attributes?.relatedMeasurementLabels?.length > 0) ||
                (ext.attributes?.relatedSegmentLabels?.length > 0);
            return hasMeasurements && !ext.attributes?.measurementsHidden;
        });

        this._isTogglingVisibility = true;

        if (anyVisible) {
            // Hide all: destroy measurement labels for every non-text drawing
            nonTextDrawings.forEach(d => {
                const ext = asExtendedGraphic(d);
                const hasMeasurements =
                    (ext as any).measure?.graphic ||
                    ext.attributes?.hadMeasurements ||
                    ext.attributes?.measurementsPermanent ||
                    (ext.attributes?.relatedMeasurementLabels?.length > 0) ||
                    (ext.attributes?.relatedSegmentLabels?.length > 0);

                if (hasMeasurements && !ext.attributes?.measurementsHidden) {
                    if (!ext.attributes) ext.attributes = {};
                    ext.attributes.measurementsHidden = true;
                    this.destroyMeasurementLabelsForToggle(ext);
                }
            });

            setTimeout(() => { this._isTogglingVisibility = false; }, 100);

            this.setState({ drawings: [...this.state.drawings] }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } else {
            // Show all: recreate measurements for every non-text drawing
            // Temporarily enable measurement system once for the whole batch
            const wasEnabled = this.measureRef?.current?.isMeasurementEnabled?.() ?? false;

            if (!wasEnabled && this.measureRef?.current) {
                this.measureRef.current.enableMeasurements?.();
            }

            nonTextDrawings.forEach(d => {
                const ext = asExtendedGraphic(d);
                if (!ext.attributes) ext.attributes = {};
                ext.attributes.measurementsHidden = false;

                if (this.measureRef?.current?.updateMeasurementsForGraphic) {
                    try {
                        this.measureRef.current.updateMeasurementsForGraphic(ext);
                    } catch (err) {
                        console.warn('⚠️ Error creating measurements for:', ext.attributes?.name, err);
                    }
                }
            });

            // FIX #6/#18: Poll isBusy instead of hard-coded 600ms timeout
            if (!wasEnabled) {
                this.waitForMeasurementComplete(() => {
                    try {
                        nonTextDrawings.forEach(d => {
                            const ext = asExtendedGraphic(d);
                            if (!ext.attributes) ext.attributes = {};
                            ext.attributes.hadMeasurements = true;
                            ext.attributes.measurementsPermanent = true;
                        });
                        this.measureRef?.current?.disableMeasurements?.(true);
                        this.setState({ drawings: [...this.state.drawings] }, () => {
                            // FIX #15: Single save after all work is done
                            this.debouncedSave();
                        });
                    } catch (err) {
                        console.warn('⚠️ Error restoring measurement state:', err);
                    }
                });
            }

            setTimeout(() => { this._isTogglingVisibility = false; }, 100);

            // FIX #15: Single save, no triple-save
            this.setState({ drawings: [...this.state.drawings] }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        }
    };

    // ===== Lock/Unlock Drawing Methods =====

    /**
     * Check if a drawing is locked.
     * Only checks the lockedDrawings Set — allDrawingsLocked is a UI flag
     * that drives the Set contents via toggleLockAll. This ensures newly
     * created drawings are never locked unless explicitly added to the Set.
     */
    isDrawingLocked = (graphic: any): boolean => {
        const uid = graphic?.attributes?.uniqueId;
        return uid ? this.state.lockedDrawings.has(String(uid)) : false;
    };

    /**
     * Save lock state to dedicated localStorage key (immediate, no debounce).
     */
    saveLockState = () => {
        try {
            const data = {
                lockedDrawings: Array.from(this.state.lockedDrawings),
                allDrawingsLocked: this.state.allDrawingsLocked
            };
            localStorage.setItem(this.lockStorageKey, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save lock state:', e);
        }
    };

    /**
     * Toggle lock state for an individual drawing.
     */
    toggleDrawingLock = (index: number, event?: React.MouseEvent) => {
        if (event) event.stopPropagation();
        const graphic = this.state.drawings[index];
        if (!graphic) return;

        const uid = String(graphic.attributes?.uniqueId);
        if (!uid) return;

        const newLocked = new Set(this.state.lockedDrawings);
        let newAllLocked = this.state.allDrawingsLocked;

        // If allDrawingsLocked is on, populate the set with all UIDs first
        // so individual toggling works correctly
        if (newAllLocked) {
            this.state.drawings.forEach(d => {
                const id = d.attributes?.uniqueId;
                if (id) newLocked.add(String(id));
            });
            newAllLocked = false; // Switch from global flag to individual tracking
        }

        if (newLocked.has(uid)) {
            newLocked.delete(uid);
        } else {
            newLocked.add(uid);
            // If this drawing is currently being edited, cancel the edit
            if (this.sketchViewModel?.state === 'active') {
                const isBeingEdited = this.sketchViewModel.updateGraphics?.some(
                    (g: any) => g === graphic || g.attributes?.uniqueId === uid
                );
                if (isBeingEdited) {
                    this.sketchViewModel.cancel();
                }
            }
        }

        this.setState({
            lockedDrawings: newLocked,
            allDrawingsLocked: newAllLocked,
            drawings: [...this.state.drawings]
        }, () => {
            this.saveLockState();
        });
    };

    /**
     * Toggle Lock All / Unlock All for the entire drawing list.
     */
    toggleLockAll = () => {
        const newAllLocked = !this.state.allDrawingsLocked;

        // If locking all and something is being edited, cancel
        if (newAllLocked && this.sketchViewModel?.state === 'active') {
            this.sketchViewModel.cancel();
        }

        // Sync the individual set: lock all adds all UIDs, unlock all clears
        const newLocked = new Set<string>();
        if (newAllLocked) {
            this.state.drawings.forEach(d => {
                const id = d.attributes?.uniqueId;
                if (id) newLocked.add(String(id));
            });
        }

        // Force drawings array re-render so all lock icons update
        this.setState({
            allDrawingsLocked: newAllLocked,
            lockedDrawings: newLocked,
            drawings: [...this.state.drawings]
        }, () => {
            this.saveLockState();
        });
    };

    toggleDrawingCollapse = (index: number, event?: React.MouseEvent) => {
        // Stop event propagation if provided
        if (event) {
            event.stopPropagation();
        }

        const { collapsedDrawings } = this.state;
        const newCollapsed = new Set(collapsedDrawings);

        if (newCollapsed.has(index)) {
            newCollapsed.delete(index);
        } else {
            newCollapsed.add(index);
        }

        this.setState({ collapsedDrawings: newCollapsed }, () => {
            // Save to localStorage to persist collapsed state
            this.debouncedSave();
        });
    };

    toggleAllDrawingsCollapse = () => {
        const { drawings, collapsedDrawings } = this.state;

        // If all are collapsed, expand all. Otherwise, collapse all.
        const allCollapsed = drawings.length > 0 && collapsedDrawings.size === drawings.length;

        if (allCollapsed) {
            // Expand all
            this.setState({ collapsedDrawings: new Set<number>() }, () => {
                // Save to localStorage to persist collapsed state
                this.debouncedSave();
            });
        } else {
            // Collapse all
            const allIndices = drawings.map((_, index) => index);
            this.setState({ collapsedDrawings: new Set(allIndices) }, () => {
                // Save to localStorage to persist collapsed state
                this.debouncedSave();
            });
        }
    };

    handleZoomAll = async () => {
        const { drawings } = this.state;
        const { jimuMapView } = this.props;

        if (!drawings || drawings.length === 0 || !jimuMapView?.view) return;

        // Get all valid geometries
        const geometries = drawings
            .map(g => g.geometry)
            .filter(geom => !!geom);

        if (geometries.length === 0) return;

        // Calculate total extent (union of all extents)
        let fullExtent: any | null = null;
        geometries.forEach(geom => {
            let extent: any | null = null;
            if (geom.extent) {
                // If geometry already has an extent (polygon, line)
                extent = geom.extent.clone();
            } else if (geom.type === "point") {
                // If it's a point, create a minimal extent around it
                const point = geom as any;
                extent = new Extent({
                    xmin: point.x,
                    ymin: point.y,
                    xmax: point.x,
                    ymax: point.y,
                    spatialReference: point.spatialReference
                });
            }

            if (!extent) return;
            if (!fullExtent) {
                fullExtent = extent.clone ? extent.clone() : extent;
            } else {
                fullExtent = fullExtent.union
                    ? fullExtent.union(extent)
                    : fullExtent;
            }
        });

        if (!fullExtent) return;

        // Zoom to the extent
        try {
            await jimuMapView.view.goTo(fullExtent.expand(1.1), { animate: true, duration: 800 });
        } catch (err) {
            // Ignore if user interrupts the zoom
            console.log(err);
        }
    };


    handleDeleteGraphic = (index: number, event?: React.MouseEvent) => {
        // Check consent
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        // Block deleting locked drawings
        const graphic = this.state.drawings[index];
        if (graphic && this.isDrawingLocked(graphic)) {
            this.showLocalAlert('This drawing is locked. Unlock it to delete.', 'warning');
            return;
        }

        // Stop event propagation if provided
        if (event) {
            event.stopPropagation();
        }

        // CRITICAL: Cancel any active SketchViewModel operations IMMEDIATELY
        if (this.sketchViewModel) {
            //console.log(`🛑 Canceling SketchViewModel before deletion`);
            this.sketchViewModel.cancel();
        }

        // Set deletion flag to prevent interference
        this._isDeletingGraphic = true;

        // If confirmation is required, show the custom confirmation dialog
        if (this.props.confirmOnDelete !== false) {
            const deleteAction = () => {
                this.performDeleteGraphic(index);
            };

            this.openConfirmDialog(
                this.props.nls('areYouSureYouWantToDeleteThisDrawing'),
                'delete',
                deleteAction,
                index
            );
        } else {
            // If no confirmation needed, delete directly
            this.performDeleteGraphic(index);
        }
    }

    fixMeasurementLabelStyles = () => {
        if (!this.props.graphicsLayer) return;

        // COMPLETELY DISABLE if already run once
        if (this.measurementStylesInitialized) {
            //console.log("Measurement styling disabled - already initialized");
            return;
        }

        //console.log("Running measurement label styling ONCE ONLY");

        // Process existing measurement labels ONCE and ONLY ONCE
        const existingGraphics = this.props.graphicsLayer.graphics.toArray();
        let processedCount = 0;

        existingGraphics.forEach(graphic => {
            // Only process measurement labels that haven't been fixed yet AND need fixing
            if (graphic &&
                graphic.attributes &&
                graphic.attributes.isMeasurementLabel &&
                graphic.symbol &&
                graphic.symbol.type === 'text' &&
                !graphic.attributes._styleFixed) {

                const existingSymbol = graphic.symbol as any;

                // Check if symbol already has proper styling - if so, don't modify it
                if (existingSymbol.color &&
                    existingSymbol.font &&
                    existingSymbol.haloColor !== undefined &&
                    existingSymbol.haloSize !== undefined) {

                    // Mark as processed but don't change the symbol
                    if (!graphic.attributes) graphic.attributes = {};
                    graphic.attributes._styleFixed = true;
                    processedCount++;
                    return;
                }

                // Only apply clean symbol if it's missing essential properties
                const labelText = graphic.symbol.text;

                // Create a minimal clean symbol preserving existing properties
                const cleanSymbol = existingSymbol.clone();

                // Only set missing properties
                if (!cleanSymbol.text) cleanSymbol.text = labelText;
                if (!cleanSymbol.color) cleanSymbol.color = new Color([0, 0, 0, 1]);

                if (!cleanSymbol.font) {
                    cleanSymbol.font = new Font({
                        family: "Arial",
                        size: 12,
                        weight: "normal",
                        style: "normal",
                        decoration: "none"
                    });
                }

                // Only set halo if it doesn't exist
                if (cleanSymbol.haloColor === null && cleanSymbol.haloSize === null) {
                    cleanSymbol.haloColor = new Color([255, 255, 255, 1]);
                    cleanSymbol.haloSize = 2;
                }

                if (!cleanSymbol.horizontalAlignment) cleanSymbol.horizontalAlignment = "center";
                if (!cleanSymbol.verticalAlignment) cleanSymbol.verticalAlignment = "middle";

                // Replace the symbol
                graphic.symbol = cleanSymbol;

                // Mark this graphic as fixed so we NEVER process it again
                if (!graphic.attributes) graphic.attributes = {};
                graphic.attributes._styleFixed = true;

                processedCount++;
            }
        });

        //console.log(`Processed ${processedCount} measurement labels - WILL NEVER RUN AGAIN`);

        // Mark as initialized so we NEVER run this again
        this.measurementStylesInitialized = true;

        //console.log("Measurement label auto-styling permanently disabled");
    };

    disableMeasurementLabelStyles = () => {
        //console.log("Measurement label styling completely disabled");
        // Do nothing - let measurement labels keep their original styles
    };

    // Modified handleClearAllClick method
    handleClearAllClick = () => {
        // Check consent
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        // If confirmation is required, show the custom confirmation dialog
        if (this.props.confirmOnDelete !== false) {
            const clearAllAction = () => {
                this.performClearAll();
            };

            this.openConfirmDialog(
                this.props.nls('areYouSureYouWantToDeleteAllDrawings'),
                'clearAll',
                clearAllAction
            );
        } else {
            // If no confirmation needed, clear all directly
            this.performClearAll();
        }
    }

    performClearAll = () => {
        //console.log(`🗑️ Starting clear all operation for ${this.state.drawings.length} drawings`);

        // ✅ Capture original measurement state (proxy = any measurement labels present)
        this._measurementWasEnabled = false;
        try {
            if (this.props.graphicsLayer) {
                const graphics = this.props.graphicsLayer.graphics.toArray();
                this._measurementWasEnabled = graphics.some(g => g?.attributes?.isMeasurementLabel === true);
            }
        } catch (e) {
            console.warn('Could not infer measurement state from layer; defaulting to off.', e);
            this._measurementWasEnabled = false;
        }

        // 🔄 Temporarily disable measurements during bulk deletion
        if (this.props.onMeasurementSystemControl) {
            //console.log('🛑 Temporarily disabling measurements for bulk deletion');
            this.props.onMeasurementSystemControl(false);
        }

        // Set deletion flag to prevent interference
        this._isDeletingGraphic = true;

        try {
            // STEP 1: Force cancel any SketchViewModel operations
            if (this.sketchViewModel) {
                //console.log(`🛑 Canceling SketchViewModel before clearing all`);
                this.sketchViewModel.cancel();
            }

            // STEP 2: Clean up measurement labels for all drawings BEFORE clearing
            //console.log(`🧹 Cleaning up measurement labels for all drawings`);
            this.state.drawings.forEach(graphic => {
                //console.log(`🧹 Cleaning measurements for: ${graphic.attributes?.name || 'unnamed'}`);
                this.removeMeasurementLabels(graphic);
            });

            // STEP 3: Mark that we're about to update the graphics layer
            this.ignoreNextGraphicsUpdate = true;

            // STEP 4: Remove all graphics from the layer
            //console.log(`🗑️ Removing all graphics from layer`);
            this.props.graphicsLayer.removeAll();

            // STEP 5: AUTOMATIC CLEANUP after clearing all
            setTimeout(() => {
                //console.log(`🧹 Running automatic orphan cleanup after clear all`);
                this.cleanupOrphanedMeasurementLabels();
            }, 200);

            // STEP 6: Update state
            this.setState({
                drawings: [],
                selectedGraphicIndex: null,
                selectedGraphics: new Set<number>(),
                symbolEditingIndex: null,
                lockedDrawings: new Set<string>(),
                allDrawingsLocked: false
            }, () => {
                //console.log(`✅ State cleared - all drawings removed`);

                // Clear lock state
                this.saveLockState();

                // Save to localStorage if consent granted
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }

                // Notify parent if needed
                if (this.props.onDrawingsUpdate) {
                    this.props.onDrawingsUpdate([]);
                }

                // ✅ Re-enable measurements ONLY if they were originally enabled
                if (this.props.onMeasurementSystemControl && this._measurementWasEnabled) {
                    //console.log('🟢 Restoring measurement system (was originally ON)');
                    this.props.onMeasurementSystemControl(true);
                }

                // Clear deletion flag
                this._isDeletingGraphic = false;

                // STEP 7: Final verification
                setTimeout(() => {
                    this.verifyLayerState();
                    // Final cleanup to ensure everything is clean
                    this.cleanupOrphanedMeasurementLabels();
                }, 500);
            });

            //console.log(`✅ Clear all operation completed successfully`);

        } catch (error) {
            console.error('❌ Error clearing graphics:', error);
            this._isDeletingGraphic = false; // Always clear the flag

            // ✅ Restore measurement system ONLY if it was originally enabled
            if (this.props.onMeasurementSystemControl && this._measurementWasEnabled) {
                this.props.onMeasurementSystemControl(true);
            }

            this.showLocalAlert(this.props.nls('errorClearingDrawings'), 'error');

            // Refresh from layer to ensure state is consistent
            //console.log(`🔄 Refreshing from layer due to error`);
            this.refreshDrawingsFromLayer();
        }
    };

    // Detect import format based on file extension and content
    private detectImportFormatEnhanced = (content: string | ArrayBuffer, fileName: string): 'geojson' | 'kml' | 'shapefile' | 'legacy' | 'unknown' => {
        const lowerFileName = fileName.toLowerCase();

        // Check file extension first
        if (lowerFileName.endsWith('.kml')) {
            return 'kml';
        }

        if (lowerFileName.endsWith('.zip')) {
            return 'shapefile';
        }

        // For text-based formats, check content
        if (typeof content === 'string') {
            try {
                // Check if it's XML (KML)
                if (content.trim().startsWith('<?xml') || content.trim().startsWith('<kml')) {
                    return 'kml';
                }

                // Try to parse as JSON
                const parsed = JSON.parse(content);

                // Check if it's GeoJSON
                if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
                    return 'geojson';
                }

                // Check if it's legacy format
                if (parsed.drawings || Array.isArray(parsed) || parsed.version) {
                    return 'legacy';
                }
            } catch (error) {
                // Not valid JSON or XML
            }
        }

        return 'unknown';
    };

    // Parse KML and convert to GeoJSON
    private parseKMLToGeoJSON = async (kmlContent: string): Promise<any> => {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(kmlContent, 'text/xml');
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) throw new Error('Failed to parse KML file');

            const features: any[] = [];
            const placemarks = xmlDoc.querySelectorAll('Placemark');

            for (let index = 0; index < placemarks.length; index++) {
                const placemark = placemarks[index];
                try {
                    const name = placemark.querySelector('name')?.textContent?.trim() || `Imported Feature ${index + 1}`;
                    const description = placemark.querySelector('description')?.textContent?.trim() || '';
                    const geometry = await this.parseKMLGeometry(placemark);
                    if (geometry) {
                        const styleProps = this.extractKMLStyle(placemark, xmlDoc);
                        features.push({
                            type: 'Feature',
                            geometry,
                            properties: {
                                name,
                                description,
                                type: geometry.type,
                                ...styleProps
                            }
                        });
                    }
                } catch (error) {
                    console.warn(`Error parsing placemark ${index}:`, error);
                }
            }

            return { type: 'FeatureCollection', features };
        } catch (error) {
            console.error('Error parsing KML:', error);
            throw error;
        }
    };

    // Extract KML style information
    private extractKMLStyle = (placemark: Element, xmlDoc: Document): any => {
        const styleProps: any = {};
        try {
            let style = placemark.querySelector('Style');
            if (!style) {
                const styleUrl = placemark.querySelector('styleUrl');
                const styleId = styleUrl?.textContent?.trim().replace('#', '');
                if (styleId) style = xmlDoc.querySelector(`Style[id="${styleId}"]`);
            }

            if (style) {
                const parseAlpha = (kmlColor: string) => {
                    const hex = kmlColor.trim();
                    if (hex.length === 8) {
                        const alpha = parseInt(hex.substring(0, 2), 16) / 255;
                        return isNaN(alpha) ? 1 : parseFloat(alpha.toFixed(2));
                    }
                    return 1;
                };

                // LineStyle
                const lineStyle = style.querySelector('LineStyle');
                if (lineStyle) {
                    const color = lineStyle.querySelector('color')?.textContent || '';
                    const width = lineStyle.querySelector('width')?.textContent || '1';
                    styleProps.stroke = this.parseKMLColor(color);
                    const strokeOpacity = parseAlpha(color);
                    if (strokeOpacity < 1) styleProps.stroke_opacity = strokeOpacity;
                    styleProps.stroke_width = parseFloat(width);
                }

                // PolyStyle
                const polyStyle = style.querySelector('PolyStyle');
                if (polyStyle) {
                    const color = polyStyle.querySelector('color')?.textContent || '';
                    styleProps.fill = this.parseKMLColor(color);
                    const fillOpacity = parseAlpha(color);
                    if (fillOpacity < 1) styleProps.fill_opacity = fillOpacity;
                }

                // IconStyle
                const iconStyle = style.querySelector('IconStyle');
                if (iconStyle) {
                    const color = iconStyle.querySelector('color')?.textContent || '';
                    styleProps.marker_color = this.parseKMLColor(color);
                    const markerOpacity = parseAlpha(color);
                    if (markerOpacity < 1) styleProps.marker_opacity = markerOpacity;

                    const scale = iconStyle.querySelector('scale')?.textContent || '1';
                    styleProps.marker_size = Math.round(12 * parseFloat(scale));
                }

                // LabelStyle (for text features)
                const labelStyle = style.querySelector('LabelStyle');
                if (labelStyle) {
                    const color = labelStyle.querySelector('color')?.textContent || '';
                    styleProps.text_color = this.parseKMLColor(color);
                    const textOpacity = parseAlpha(color);
                    if (textOpacity < 1) styleProps.text_opacity = textOpacity;

                    const scale = labelStyle.querySelector('scale')?.textContent || '1';
                    styleProps.text_size = Math.round(12 * parseFloat(scale));
                }

                // Infer Text feature if LabelStyle exists without IconStyle
                if (!iconStyle && labelStyle) {
                    styleProps.type = 'Text';
                }
            }

            // Extract custom symbology from ExtendedData
            const dataNodes = placemark.querySelectorAll('ExtendedData Data');
            dataNodes.forEach(data => {
                const name = data.getAttribute('name');
                const value = data.querySelector('value')?.textContent;
                if (!name || value == null) return;

                switch (name) {
                    case 'marker_symbol':
                        styleProps.marker_symbol = value;
                        break;
                    case 'stroke_style':
                        styleProps.stroke_style = value;
                        break;
                    case 'marker_opacity':
                    case 'stroke_opacity':
                    case 'fill_opacity':
                    case 'text_opacity':
                        styleProps[name] = parseFloat(value);
                        break;
                    case 'text_weight':
                    case 'text_style':
                    case 'text_decoration':
                        styleProps[name] = value;
                        break;
                }
            });
        } catch (error) {
            console.warn('Error extracting KML style:', error);
        }

        return styleProps;
    };

    // Helper method to parse KML geometry
    /**
     * Parse KML color format (aabbggrr) to ArcGIS color format
     * KML uses: AA BB GG RR (alpha, blue, green, red)
     * We need: [R, G, B, A]
     */
    private parseKMLColor = (kmlColor: string | null): string => {
        if (!kmlColor || kmlColor.length !== 8) {
            return 'rgba(0,0,0,1)'; // Default black
        }

        try {
            // KML format: AABBGGRR
            const alpha = parseInt(kmlColor.substring(0, 2), 16) / 255;
            const blue = parseInt(kmlColor.substring(2, 4), 16);
            const green = parseInt(kmlColor.substring(4, 6), 16);
            const red = parseInt(kmlColor.substring(6, 8), 16);

            return `rgba(${red},${green},${blue},${alpha.toFixed(2)})`;
        } catch (error) {
            console.warn('Failed to parse KML color:', kmlColor, error);
            return 'rgba(0,0,0,1)';
        }
    };

    /**
     * Extract timestamp from KML Placemark
     * Supports multiple KML date formats from different sources
     * Returns ISO string or null if no valid date found
     */
    private extractKMLTimestamp = (placemark: Element): string | null => {
        try {
            // Priority 1: Check for <TimeStamp><when> (most common)
            const timeStamp = placemark.querySelector('TimeStamp when');
            if (timeStamp?.textContent) {
                const dateStr = timeStamp.textContent.trim();
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }

            // Priority 2: Check for <TimeSpan><begin> (start of range)
            const timeSpanBegin = placemark.querySelector('TimeSpan begin');
            if (timeSpanBegin?.textContent) {
                const dateStr = timeSpanBegin.textContent.trim();
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }

            // Priority 3: Check ExtendedData for common date field names
            const extendedData = placemark.querySelector('ExtendedData');
            if (extendedData) {
                // Common field names to check (case-insensitive)
                const dateFieldNames = [
                    'created', 'Created', 'CREATED',
                    'date', 'Date', 'DATE',
                    'timestamp', 'TimeStamp', 'TIMESTAMP',
                    'time', 'Time', 'TIME',
                    'created_date', 'CreatedDate', 'CREATED_DATE',
                    'creation_date', 'CreationDate', 'CREATION_DATE',
                    'datetime', 'DateTime', 'DATETIME',
                    'modified', 'Modified', 'MODIFIED',
                    'updated', 'Updated', 'UPDATED'
                ];

                // Try each field name
                for (const fieldName of dateFieldNames) {
                    const dataElement = extendedData.querySelector(`Data[name="${fieldName}"] value, SimpleData[name="${fieldName}"]`);
                    if (dataElement?.textContent) {
                        const dateStr = dataElement.textContent.trim();

                        // Try parsing as ISO date
                        let date = new Date(dateStr);

                        // If that fails, try parsing as Unix timestamp (in milliseconds or seconds)
                        if (isNaN(date.getTime())) {
                            const numValue = parseFloat(dateStr);
                            if (!isNaN(numValue)) {
                                // If number is less than year 3000 in seconds, assume it's Unix seconds
                                if (numValue < 32503680000) {
                                    date = new Date(numValue * 1000);
                                } else {
                                    // Otherwise assume milliseconds
                                    date = new Date(numValue);
                                }
                            }
                        }

                        if (!isNaN(date.getTime())) {
                            return date.toISOString();
                        }
                    }
                }
            }

            // Priority 4: Check for atom:updated (Google Earth sometimes uses this)
            const atomUpdated = placemark.querySelector('updated');
            if (atomUpdated?.textContent) {
                const dateStr = atomUpdated.textContent.trim();
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }

        } catch (error) {
            console.warn('Error extracting KML timestamp:', error);
        }

        // No valid date found
        return null;
    };

    /**
     * Extract description from KML Placemark
     * Cleans HTML if present
     */
    private extractKMLDescription = (placemark: Element): string => {
        const description = placemark.querySelector('description')?.textContent || '';

        // If description contains HTML, strip it
        if (description.includes('<') && description.includes('>')) {
            const parsed = new DOMParser().parseFromString(description, 'text/html');
            return parsed.body.textContent || '';
        }

        return description;
    };

    /**
     * Extract style information from a KML Placemark
     * Supports both inline styles and styleUrl references
     */
    private parseKMLStyle = (placemark: Element, kmlDoc: Document): any => {
        // First, check for styleUrl (reference to shared style)
        const styleUrl = placemark.querySelector('styleUrl')?.textContent;
        let styleElement: Element | null = null;

        if (styleUrl) {
            // Remove the # from styleUrl and find the style
            const styleId = styleUrl.replace('#', '');
            styleElement = kmlDoc.querySelector(`Style[id="${styleId}"]`);
        }

        // If no styleUrl or style not found, check for inline Style
        if (!styleElement) {
            styleElement = placemark.querySelector('Style');
        }

        // If still no style found, return null (will use defaults)
        if (!styleElement) {
            return null;
        }

        // Extract different style types
        const iconStyle = styleElement.querySelector('IconStyle');
        const lineStyle = styleElement.querySelector('LineStyle');
        const polyStyle = styleElement.querySelector('PolyStyle');

        const style: any = {};

        // Parse IconStyle (for points)
        if (iconStyle) {
            const color = iconStyle.querySelector('color')?.textContent;
            const scale = iconStyle.querySelector('scale')?.textContent;
            const iconHref = iconStyle.querySelector('Icon href')?.textContent;

            style.icon = {
                color: color ? this.parseKMLColor(color) : 'rgba(255,0,0,1)',
                scale: scale ? parseFloat(scale) : 1.0,
                href: iconHref || null
            };
        }

        // Parse LineStyle (for lines and polygon outlines)
        if (lineStyle) {
            const color = lineStyle.querySelector('color')?.textContent;
            const width = lineStyle.querySelector('width')?.textContent;

            style.line = {
                color: color ? this.parseKMLColor(color) : 'rgba(0,0,255,1)',
                width: width ? parseFloat(width) : 2
            };
        }

        // Parse PolyStyle (for polygon fills)
        if (polyStyle) {
            const color = polyStyle.querySelector('color')?.textContent;
            const fill = polyStyle.querySelector('fill')?.textContent;
            const outline = polyStyle.querySelector('outline')?.textContent;

            style.poly = {
                color: color ? this.parseKMLColor(color) : 'rgba(0,0,255,0.5)',
                fill: fill === '0' ? false : true,
                outline: outline === '0' ? false : true
            };
        }

        return Object.keys(style).length > 0 ? style : null;
    };

    /**
     * Create ArcGIS symbol from KML style
     */
    private createSymbolFromKMLStyle = async (kmlStyle: any, geometryType: string): Promise<any> => {
        switch (geometryType) {
            case 'point':
                if (kmlStyle?.icon) {
                    // Use the KML icon style
                    const size = 12 * (kmlStyle.icon.scale || 1.0);
                    return new SimpleMarkerSymbol({
                        style: 'circle',
                        color: kmlStyle.icon.color,
                        size: size,
                        outline: {
                            color: 'rgba(255,255,255,0.5)',
                            width: 1
                        }
                    });
                }
                break;

            case 'polyline':
                if (kmlStyle?.line) {
                    return new SimpleLineSymbol({
                        color: kmlStyle.line.color,
                        width: kmlStyle.line.width,
                        style: 'solid'
                    });
                }
                break;

            case 'polygon':
            case 'extent':
                if (kmlStyle?.poly || kmlStyle?.line) {
                    const fillColor = kmlStyle.poly?.fill !== false
                        ? (kmlStyle.poly?.color || 'rgba(0,0,255,0.5)')
                        : 'rgba(0,0,0,0)';

                    const outlineColor = kmlStyle.poly?.outline !== false
                        ? (kmlStyle.line?.color || 'rgba(0,0,0,1)')
                        : 'rgba(0,0,0,0)';

                    const outlineWidth = kmlStyle.line?.width || 1.5;

                    return new SimpleFillSymbol({
                        color: fillColor,
                        style: 'solid',
                        outline: {
                            color: outlineColor,
                            width: outlineWidth
                        }
                    });
                }
                break;
        }

        // Fallback to default symbol
        return this.createDefaultSymbol(geometryType);
    };

    parseKMLGeometry = async (placemark: Element): Promise<any> => {
        // Point, Polyline, Polygon are statically imported at top of file

        // Try Point
        const pointElement = placemark.querySelector('Point coordinates');
        if (pointElement) {
            const coords = pointElement.textContent?.trim().split(',');
            if (coords && coords.length >= 2) {
                return new Point({
                    x: parseFloat(coords[0]),
                    y: parseFloat(coords[1]),
                    spatialReference: { wkid: 4326 }
                });
            }
        }

        // Try LineString
        const lineElement = placemark.querySelector('LineString coordinates');
        if (lineElement) {
            const coordsText = lineElement.textContent?.trim();
            if (coordsText) {
                const points = coordsText.split(/\s+/).map(coord => {
                    const [x, y] = coord.split(',').map(parseFloat);
                    return [x, y];
                });
                return new Polyline({
                    paths: [points],
                    spatialReference: { wkid: 4326 }
                });
            }
        }

        // Try Polygon
        const polygonElement = placemark.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
        if (polygonElement) {
            const coordsText = polygonElement.textContent?.trim();
            if (coordsText) {
                const points = coordsText.split(/\s+/).map(coord => {
                    const [x, y] = coord.split(',').map(parseFloat);
                    return [x, y];
                });
                return new Polygon({
                    rings: [points],
                    spatialReference: { wkid: 4326 }
                });
            }
        }

        return null;
    };

    // Parse KML coordinate string
    private parseKMLCoordinates = (coordString: string): number[][] => {
        const coords: number[][] = [];

        try {
            // KML coordinates are in format: lon,lat,alt lon,lat,alt ...
            const cleanString = coordString.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
            const pairs = cleanString.split(' ');

            pairs.forEach(pair => {
                if (!pair.trim()) return;

                const values = pair.split(',').map(v => parseFloat(v.trim()));
                if (values.length >= 2 && !isNaN(values[0]) && !isNaN(values[1])) {
                    // Validate coordinates are within valid range
                    if (values[0] >= -180 && values[0] <= 180 &&
                        values[1] >= -90 && values[1] <= 90) {
                        coords.push([values[0], values[1]]);
                    }
                }
            });
        } catch (error) {
            console.error('Error parsing KML coordinates:', error);
        }

        return coords;
    };

    // Parse Shapefile and convert to GeoJSON
    private parseShapefileToGeoJSON = async (zipFile: ArrayBuffer): Promise<any> => {
        try {
            //console.log('📦 Starting Shapefile parsing...');
            const zip = await JSZip.loadAsync(zipFile);

            // Find the shapefile components
            let shpFile: ArrayBuffer | null = null;
            let dbfFile: ArrayBuffer | null = null;
            let prjFile: string | null = null;
            let shpFileName = '';

            // Extract files
            for (const [filename, file] of Object.entries(zip.files) as Array<[string, any]>) {
                const lowerName = filename.toLowerCase();

                if (lowerName.endsWith('.shp') && !lowerName.includes('__macosx')) {
                    shpFile = await file.async('arraybuffer');
                    shpFileName = filename;
                    //console.log(`📄 Found .shp file: ${filename}`);
                } else if (lowerName.endsWith('.dbf') && !lowerName.includes('__macosx')) {
                    dbfFile = await file.async('arraybuffer');
                    //console.log(`📄 Found .dbf file: ${filename}`);
                } else if (lowerName.endsWith('.prj') && !lowerName.includes('__macosx')) {
                    prjFile = await file.async('text');
                    //console.log(`📄 Found .prj file: ${filename}`);
                    //console.log(`🗺️ Coordinate system: ${prjFile.substring(0, 100)}...`);
                }
            }

            if (!shpFile) {
                throw new Error('No .shp file found in the ZIP archive');
            }

            //console.log('🔄 Parsing shapefile to GeoJSON...');

            // Dynamic import of shpjs to avoid bundling issues
            const shpModule: any = await import('shpjs');
            const shp: any = shpModule.default || shpModule;

            // Parse the shapefile
            let geoJSON: any;

            if (dbfFile) {
                // If we have a DBF file, combine it with the SHP
                const combined = await shp.combine([
                    shp.parseShp(shpFile, prjFile || undefined),
                    shp.parseDbf(dbfFile)
                ]);
                geoJSON = combined;
            } else {
                // Just parse the SHP file
                geoJSON = await shp.parseShp(shpFile, prjFile || undefined);
            }

            // Ensure it's a FeatureCollection
            if (!geoJSON.type) {
                geoJSON = {
                    type: 'FeatureCollection',
                    features: Array.isArray(geoJSON) ? geoJSON : [geoJSON]
                };
            }

            //console.log(`✅ Successfully parsed ${geoJSON.features?.length || 0} features from shapefile`);

            // Add coordinate system info to each feature if available
            if (prjFile && geoJSON.features) {
                geoJSON.features.forEach((feature: any) => {
                    if (!feature.properties) {
                        feature.properties = {};
                    }
                    // Store the projection info (optional, for reference)
                    feature.properties._coordinateSystem = prjFile.substring(0, 200); // Store first 200 chars
                });
            }

            return geoJSON;
        } catch (error) {
            console.error('❌ Error parsing Shapefile:', error);
            throw new Error(`Failed to parse Shapefile: ${error.message}`);
        }
    };

    handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();

        const isValidFile = fileName.endsWith('.json') ||
            fileName.endsWith('.geojson') ||
            fileName.endsWith('.kml') ||
            fileName.endsWith('.zip');

        if (!isValidFile) {
            this.showLocalAlert(this.props.nls('pleaseSelectAJsonGeojsonKmlOrZipFile'), 'error');
            event.target.value = '';
            return;
        }

        try {
            // 🔧 FIX: Reset import state before starting
            this.setState({
                importInProgress: false,
                importProgress: 0,
                importProgressMessage: ''
            });

            // Read file content (for text files only)
            const content = fileName.endsWith('.zip')
                ? null  // Store the file object for shapefiles, not content
                : await file.text();

            // Validate JSON/GeoJSON before showing dialog
            if ((fileName.endsWith('.json') || fileName.endsWith('.geojson')) && content) {
                JSON.parse(content);
            }

            // Store file and open dialog for ALL formats (including shapefiles)
            this.setState({
                importFile: file,
                importFileContent: content,
                importDialogOpen: true
            });

        } catch (err) {
            console.error('Error reading file:', err);
            if (fileName.endsWith('.geojson')) {
                this.showLocalAlert('Invalid GeoJSON file format', 'error');
            } else if (fileName.endsWith('.kml')) {
                this.showLocalAlert('Invalid KML file format', 'error');
            } else {
                this.showLocalAlert(this.props.nls('invalidJsonFileFormat'), 'error');
            }
            event.target.value = '';

            // 🔧 FIX: Ensure state is reset on error
            this.setState({
                importInProgress: false,
                importProgress: 0,
                importProgressMessage: ''
            });
        }
    };

    // 🔧 FIX: Add import button handler with guard to prevent multiple simultaneous imports
    handleImportButtonClick = () => {
        // Don't allow import if one is already in progress
        if (this.state.importInProgress) {
            console.warn('Import already in progress, please wait...');
            this.showLocalAlert('Import already in progress, please wait...', 'warning');
            return;
        }

        // Reset state before opening file picker
        this.setState({
            importInProgress: false,
            importProgress: 0,
            importProgressMessage: ''
        });

        const fileInput = document.getElementById('import-file') as HTMLInputElement;
        if (fileInput) {
            fileInput.click();
        }
    };

    // 🔧 FIX: Add utility method to manually reset import state if needed
    resetImportState = () => {
        //console.log('🔧 Resetting import state...');
        this.setState({
            importDialogOpen: false,
            importFile: null,
            importFileContent: null,
            importInProgress: false,
            importProgress: 0,
            importProgressMessage: ''
        });

        // Clear file input
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        if (fileInput) {
            fileInput.value = '';
        }

        // Reset the flags
        this.ignoreNextGraphicsUpdate = false;
        this._isImporting = false;
    };


    // Add the importKML method with symbology support
    importKML = async (kmlText: string) => {
        try {
            // Parse KML using browser's DOMParser
            const parser = new DOMParser();
            const kmlDoc = parser.parseFromString(kmlText, 'text/xml');

            // Check for parser errors
            const parserError = kmlDoc.querySelector('parsererror');
            if (parserError) {
                throw new Error(this.props.nls('invalidKmlFormat'));
            }

            // Extract placemarks
            const placemarks = kmlDoc.querySelectorAll('Placemark');
            let importedCount = 0;

            for (const placemark of Array.from(placemarks)) {
                const name = placemark.querySelector('name')?.textContent || `Imported Feature ${importedCount + 1}`;
                const description = this.extractKMLDescription(placemark);

                // Parse geometry
                const geometry = await this.parseKMLGeometry(placemark);

                if (geometry) {
                    // Parse style from KML
                    const kmlStyle = this.parseKMLStyle(placemark, kmlDoc);

                    // Create symbol from KML style or use default
                    const symbol = kmlStyle
                        ? await this.createSymbolFromKMLStyle(kmlStyle, geometry.type)
                        : this.createDefaultSymbol(geometry.type);

                    // Extract timestamp from KML (or use current time as fallback)
                    const kmlTimestamp = this.extractKMLTimestamp(placemark);
                    const createdDate = kmlTimestamp || new Date().toISOString();

                    // Extract notes from ExtendedData if present
                    let notes = '';
                    try {
                        const dataNodes = placemark.querySelectorAll('ExtendedData Data');
                        dataNodes.forEach(data => {
                            const name = data.getAttribute('name');
                            const value = data.querySelector('value')?.textContent;
                            if (name === 'notes' && value) {
                                notes = value;
                            }
                        });
                    } catch (error) {
                        console.warn('Error extracting notes from KML:', error);
                    }

                    const attributes: any = {
                        name: name,
                        description: description,
                        uniqueId: Date.now() + Math.random(),
                        createdDate: createdDate,
                        importSource: 'kml',
                        // Store the original KML style for potential re-export
                        _kmlStyle: kmlStyle ? JSON.stringify(kmlStyle) : null,
                        // Store whether date came from KML or was generated
                        _hasKMLTimestamp: kmlTimestamp !== null
                    };

                    // Add notes if present
                    if (notes) {
                        attributes.notes = notes;
                    }

                    const graphic = new Graphic({
                        geometry: geometry,
                        attributes: attributes,
                        symbol: symbol as any
                    });

                    (this.sketchViewModel.layer as any).add(graphic);
                    importedCount++;
                }
            }

            //console.log(`✅ Successfully imported ${importedCount} features with symbology from KML`);
        } catch (error) {
            console.error('KML import error:', error);
            throw new Error('Failed to import KML file.');
        }
    };

    importGeoJSON = async (geojson: any, replace: boolean = false) => {
        if (!this.sketchViewModel?.layer) {
            throw new Error('Sketch view model not initialized');
        }

        // Declare counters at function scope
        let importedCount = 0;
        let skippedCount = 0;

        try {
            //console.log('🌍 Starting GeoJSON import...');
            //console.log('📊 Input GeoJSON:', geojson);
            //console.log(`🔄 Replace mode: ${replace}`);

            // Optionally clear existing graphics FIRST
            if (replace) {
                //console.log('🗑️ Clearing existing drawings (replace mode)');
                this.ignoreNextGraphicsUpdate = true;
                this.props.graphicsLayer.removeAll();
            }

            if (!geojson || !geojson.type) {
                throw new Error(this.props.nls('invalidGeojsonFormatMissingType'));
            }

            const features = geojson.type === 'FeatureCollection'
                ? geojson.features
                : [geojson];

            //console.log(`📦 Processing ${features.length} features...`);

            if (!features || features.length === 0) {
                throw new Error(this.props.nls('noFeaturesFoundInGeojson'));
            }

            // 🚨 COMPLEXITY CHECK DISABLED FOR IMPROVED UX
            // Previously showed a warning dialog for files with >5000 vertices
            // This has been removed to streamline the import process
            /*
            const totalVertices = this.countGeoJSONVertices(geojson);
            const COMPLEXITY_THRESHOLD = 5000;
            
            if (totalVertices > COMPLEXITY_THRESHOLD) {
                const warningMessage = `⚠️ This GeoJSON file is very complex (${totalVertices.toLocaleString()} coordinate points).\n\n` +
                    `Files exported from ArcGIS Hub often contain excessive detail that can cause:\n` +
                    `• Browser freezing or crashes\n` +
                    `• Missing features on the map\n` +
                    `• Poor performance\n\n` +
                    `RECOMMENDED: Simplify this file before importing using:\n` +
                    `• QGIS (Vector > Geometry Tools > Simplify)\n` +
                    `• ArcGIS Pro (Simplify Polygon tool)\n` +
                    `• mapshaper.org (online tool)\n\n` +
                    `Do you want to try importing anyway? (Not recommended)`;

                const userConfirmed = confirm(warningMessage);

                if (!userConfirmed) {
                    this.showLocalAlert('Import cancelled - file is too complex for web display', 'info');
                    return;
                }

                console.warn('⚠️ User chose to proceed with complex file import');
            }
            */

            // Detect spatial reference from CRS
            const sourceSR = await this.detectSpatialReference(geojson.crs);

            // 🆕 BATCH PROCESSING TO PREVENT FREEZING
            const BATCH_SIZE = 10; // Process 10 features at a time
            const totalFeatures = features.length;
            let processedFeatures = 0;

            // Show progress indicator
            this.setState({
                importInProgress: true,
                importProgress: 0,
                importProgressMessage: `Importing features: 0 / ${totalFeatures}`
            });

            // Process features in batches
            for (let batchStart = 0; batchStart < totalFeatures; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, totalFeatures);
                const batch = features.slice(batchStart, batchEnd);

                // Process batch
                for (let i = 0; i < batch.length; i++) {
                    const feature = batch[i];
                    const featureIndex = batchStart + i;

                    if (!feature.geometry) {
                        console.warn(`⚠️ Skipping feature ${featureIndex + 1} - no geometry`);
                        skippedCount++;
                        continue;
                    }

                    try {
                        // Convert GeoJSON geometry to ArcGIS geometry with projection
                        const geometry = await this.convertGeoJSONGeometry(feature.geometry, sourceSR);

                        if (geometry) {
                            // Clean attributes to ensure all values are proper types
                            const cleanedAttributes: any = {};
                            let savedSymbol = null;

                            // Copy properties and ensure they're valid
                            if (feature.properties) {
                                for (const [key, value] of Object.entries(feature.properties)) {
                                    // Check if this is the saved symbol
                                    if (key === '_symbol' && value) {
                                        try {
                                            savedSymbol = typeof value === 'string' ? JSON.parse(value) : value;
                                            //console.log('🎨 Found saved symbol:', savedSymbol);
                                            continue; // Don't add to cleanedAttributes
                                        } catch (e) {
                                            console.warn('Failed to parse saved symbol:', e);
                                        }
                                    }

                                    // Convert null/undefined to empty string, ensure numbers stay numbers
                                    if (value === null || value === undefined) {
                                        cleanedAttributes[key] = '';
                                    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                                        cleanedAttributes[key] = value;
                                    } else {
                                        // Convert objects/arrays to string
                                        cleanedAttributes[key] = String(value);
                                    }
                                }
                            }

                            // Add required attributes
                            const name = feature.properties?.name || feature.properties?.NAME || `Imported Feature ${importedCount + 1}`;

                            // Restore or create symbol
                            let symbol: any;
                            if (savedSymbol) {
                                //console.log('🎨 Restoring symbol from _symbol property');
                                symbol = await this.restoreSymbolFromJSON(savedSymbol, geometry.type);
                            } else if (this.hasStandardSymbologyProperties(cleanedAttributes)) {
                                //console.log('🎨 Creating symbol from standard properties');
                                symbol = await this.createSymbolFromStandardProperties(cleanedAttributes, geometry.type);
                            } else {
                                //console.log('🎨 Using default symbol');
                                symbol = this.createDefaultSymbol(geometry.type);
                            }

                            const graphic = new Graphic({
                                geometry: geometry,
                                attributes: {
                                    ...cleanedAttributes,
                                    name: String(name),
                                    uniqueId: String(Date.now() + Math.random()),
                                    createdDate: new Date().toISOString(),
                                    importSource: 'geojson',
                                    type: String(geometry.type)
                                },
                                symbol: symbol
                            });

                            (this.sketchViewModel.layer as any).add(graphic);
                            importedCount++;

                            // FIX #10: Restore measurement metadata from exported GeoJSON
                            if (feature.properties?.hasMeasurements) {
                                graphic.attributes.hadMeasurements = true;
                                graphic.attributes.measurementsPermanent = true;
                                graphic.attributes.measurementsHidden = feature.properties.measurementsHidden ?? false;
                                // Restore measurement units if present
                                if (feature.properties.measurementLengthUnit || feature.properties.measurementAreaUnit) {
                                    graphic.attributes.measurementUnits = {
                                        lengthUnit: feature.properties.measurementLengthUnit,
                                        areaUnit: feature.properties.measurementAreaUnit
                                    };
                                }
                            }
                        } else {
                            console.warn(`⚠️ Skipping feature ${featureIndex + 1} - geometry conversion returned null`);
                            skippedCount++;
                        }
                    } catch (featureError) {
                        console.error(`❌ Error processing feature ${featureIndex + 1}:`, featureError);
                        skippedCount++;
                    }
                }

                processedFeatures = batchEnd;

                // Update progress
                const progress = Math.round((processedFeatures / totalFeatures) * 100);
                this.setState({
                    importProgress: progress,
                    importProgressMessage: this.props.nls('importingFeaturesProcessed', { processed: (processedFeatures), total: (totalFeatures), percent: (progress) })
                });

                // 🆕 YIELD TO BROWSER - This prevents freezing!
                // Let the browser update the UI and process other events
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // Hide progress indicator
            this.setState({
                importInProgress: false,
                importProgress: 0,
                importProgressMessage: ''
            });

            //console.log(`✅ Import complete: ${importedCount} imported, ${skippedCount} skipped`);

            if (importedCount > 0) {
                // Refresh the drawings list to show imported items
                await this.refreshDrawingsFromLayer();

                // Zoom to imported features
                this.zoomToImportedFeatures(importedCount);

                // FIX #10: Auto-regenerate measurements for imported features that had them
                const importedWithMeasurements = this.state.drawings.filter(d => {
                    const ext = asExtendedGraphic(d);
                    return ext.attributes?.hadMeasurements &&
                        ext.attributes?.importSource === 'geojson' &&
                        !ext.attributes?.measurementsHidden;
                });

                if (importedWithMeasurements.length > 0 && this.measureRef?.current) {
                    const wasEnabled = this.measureRef.current.isMeasurementEnabled?.() ?? false;
                    if (!wasEnabled) {
                        this.measureRef.current.enableMeasurements?.();
                    }

                    importedWithMeasurements.forEach(d => {
                        const ext = asExtendedGraphic(d);
                        try {
                            this.measureRef.current.updateMeasurementsForGraphic(ext);
                        } catch (err) {
                            console.warn('⚠️ Error regenerating measurements for imported feature:', ext.attributes?.name, err);
                        }
                    });

                    if (!wasEnabled) {
                        this.waitForMeasurementComplete(() => {
                            try {
                                importedWithMeasurements.forEach(d => {
                                    const ext = asExtendedGraphic(d);
                                    if (!ext.attributes) ext.attributes = {};
                                    ext.attributes.measurementsPermanent = true;
                                });
                                this.measureRef?.current?.disableMeasurements?.(true);
                                this.debouncedSave();
                            } catch (err) {
                                console.warn('⚠️ Error finalizing imported measurements:', err);
                            }
                        });
                    }
                }

                // Notify user if features were skipped
                if (skippedCount > 0) {
                    this.showLocalAlert(
                        `⚠️ Import partially completed: ${importedCount} of ${importedCount + skippedCount} features imported. ${skippedCount} features failed. Check browser console for details.`,
                        'warning'
                    );
                } else {
                    // this.showLocalAlert(`✅ Successfully imported ${importedCount} feature${importedCount !== 1 ? 's' : ''}`, 'success');
                }
            } else {
                throw new Error('No features could be imported');
            }

        } catch (error) {
            console.error('❌ Error importing GeoJSON:', error);

            // Hide progress indicator on error
            this.setState({
                importInProgress: false,
                importProgress: 0,
                importProgressMessage: ''
            });

            this.showLocalAlert(this.props.nls('importFailedMessage', { message: (error.message || 'Unknown error') }), 'error');
            throw error;
        }
    };

    // Add this new method to restore symbols from JSON
    restoreSymbolFromJSON = async (symbolJSON: any, geometryType: string): Promise<any> => {
        try {
            // Import the appropriate symbol class based on type
            if (symbolJSON.type === 'simple-marker' || symbolJSON.type === 'picture-marker') {
                if (symbolJSON.type === 'simple-marker') {
                    return new SimpleMarkerSymbol(symbolJSON);
                } else {
                    return new PictureMarkerSymbol(symbolJSON);
                }
            } else if (symbolJSON.type === 'simple-line') {
                return new SimpleLineSymbol(symbolJSON);
            } else if (symbolJSON.type === 'simple-fill') {
                return new SimpleFillSymbol(symbolJSON);
            } else if (symbolJSON.type === 'text') {
                return new TextSymbol(symbolJSON);
            } else {
                console.warn('Unknown symbol type:', symbolJSON.type, '- using default');
                return this.createDefaultSymbol(geometryType);
            }
        } catch (error) {
            console.error('Error restoring symbol:', error);
            return this.createDefaultSymbol(geometryType);
        }
    };

    hasStandardSymbologyProperties = (properties: any): boolean => {
        if (!properties) return false;

        // Check for any standard symbology properties that would be exported
        return !!(
            properties.fill ||
            properties.stroke ||
            properties.marker_color ||
            properties.text_color ||
            properties.fill_opacity !== undefined ||
            properties.stroke_width !== undefined ||
            properties.marker_size !== undefined
        );
    };

    createSymbolFromStandardProperties = async (properties: any, geometryType: string): Promise<any> => {
        try {
            switch (geometryType) {
                case 'point':
                    // Point/Marker symbol
                    const markerColor = properties.marker_color || properties.fill || '#FF0000';
                    const markerSize = properties.marker_size || 12;
                    const markerStyle = properties.marker_symbol || 'circle';

                    const markerSymbol: any = {
                        type: 'simple-marker',
                        style: markerStyle,
                        color: markerColor,
                        size: markerSize
                    };

                    // Add outline if stroke properties exist
                    if (properties.stroke) {
                        markerSymbol.outline = {
                            color: properties.stroke,
                            width: properties.stroke_width || 1
                        };
                    }

                    return new SimpleMarkerSymbol(markerSymbol);

                case 'polyline':
                    // Line symbol
                    const lineColor = properties.stroke || '#0000FF';
                    const lineWidth = properties.stroke_width || 2;
                    const lineOpacity = properties.stroke_opacity !== undefined ? properties.stroke_opacity : 1;

                    // Parse color and add alpha
                    const lineColorWithAlpha = this.addAlphaToColor(lineColor, lineOpacity);

                    return new SimpleLineSymbol({
                        color: lineColorWithAlpha,
                        width: lineWidth,
                        style: 'solid'
                    });

                case 'polygon':
                case 'extent':
                    // Polygon/Fill symbol
                    const fillColor = properties.fill || '#0000FF';
                    const fillOpacity = properties.fill_opacity !== undefined ? properties.fill_opacity : 0.5;
                    const outlineColor = properties.stroke || '#000000';
                    const outlineWidth = properties.stroke_width || 1.5;

                    // Parse colors and add alpha
                    const fillColorWithAlpha = this.addAlphaToColor(fillColor, fillOpacity);
                    const outlineColorWithAlpha = this.addAlphaToColor(outlineColor, 1);

                    return new SimpleFillSymbol({
                        color: fillColorWithAlpha,
                        style: 'solid',
                        outline: {
                            color: outlineColorWithAlpha,
                            width: outlineWidth
                        }
                    });

                default:
                    console.warn('Unknown geometry type for symbology:', geometryType);
                    return this.createDefaultSymbol(geometryType);
            }
        } catch (error) {
            console.error('Error creating symbol from standard properties:', error);
            return this.createDefaultSymbol(geometryType);
        }
    };

    addAlphaToColor = (hexColor: string, alpha: number): number[] => {
        // Remove # if present
        const hex = hexColor.replace('#', '');

        // Parse RGB values from hex
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        // Return as [r, g, b, a] array (ArcGIS format)
        return [r, g, b, alpha];
    };

    // New method to detect spatial reference from CRS or PRJ
    detectSpatialReference = async (crs: any): Promise<any> => {
        // Default to WGS84 if no CRS provided
        if (!crs || !crs.properties) {
            //console.log('📍 No CRS found, defaulting to WGS84 (4326)');
            return { wkid: 4326 };
        }

        const crsName = crs.properties.name;
        //console.log('🔍 Parsing CRS:', crsName);

        if (!crsName || typeof crsName !== 'string') {
            //console.log('📍 Invalid CRS format, defaulting to WGS84 (4326)');
            return { wkid: 4326 };
        }

        // Try multiple patterns to extract WKID/EPSG code

        // Pattern 1: Direct EPSG code (e.g., "EPSG:4326", "EPSG 4326")
        const epsgMatch = crsName.match(/EPSG[:\s]+(\d+)/i);
        if (epsgMatch && epsgMatch[1]) {
            const wkid = parseInt(epsgMatch[1]);
            //console.log('✅ Found EPSG code:', wkid);
            return { wkid: wkid };
        }

        // Pattern 2: URN format (e.g., "urn:ogc:def:crs:EPSG::4326")
        const urnMatch = crsName.match(/urn:ogc:def:crs:EPSG:.*:(\d+)/i);
        if (urnMatch && urnMatch[1]) {
            const wkid = parseInt(urnMatch[1]);
            //console.log('✅ Found EPSG from URN:', wkid);
            return { wkid: wkid };
        }

        // Pattern 3: UTM Zones (WGS84)
        // Format: "WGS_1984_UTM_Zone_12N" or similar
        const utmMatch = crsName.match(/UTM[_\s]+Zone[_\s]+(\d+)([NS])/i);
        if (utmMatch) {
            const zone = parseInt(utmMatch[1]);
            const hemisphere = utmMatch[2].toUpperCase();

            // WGS84 UTM: 326XX for North, 327XX for South
            const wkid = hemisphere === 'N' ? 32600 + zone : 32700 + zone;
            //console.log(`✅ Detected UTM Zone ${zone}${hemisphere}, WKID:`, wkid);
            return { wkid: wkid };
        }

        // Pattern 4: NAD83 UTM Zones
        const nad83UtmMatch = crsName.match(/NAD.*83.*UTM[_\s]+Zone[_\s]+(\d+)([NS])/i);
        if (nad83UtmMatch) {
            const zone = parseInt(nad83UtmMatch[1]);
            const hemisphere = nad83UtmMatch[2].toUpperCase();

            // NAD83 UTM: 269XX for North
            const wkid = hemisphere === 'N' ? 26900 + zone : 26900 + zone;
            //console.log(`✅ Detected NAD83 UTM Zone ${zone}${hemisphere}, WKID:`, wkid);
            return { wkid: wkid };
        }

        // Pattern 5: State Plane systems
        const statePlaneMatch = crsName.match(/State[_\s]+Plane/i);
        if (statePlaneMatch) {
            // Try to extract zone number
            const spZoneMatch = crsName.match(/(\d{4,5})/);
            if (spZoneMatch) {
                const wkid = parseInt(spZoneMatch[1]);
                //console.log('✅ Detected State Plane, WKID:', wkid);
                return { wkid: wkid };
            }
        }

        // Pattern 6: Web Mercator variations
        if (crsName.match(/Web[_\s]+Mercator|WGS[_\s]*84[_\s]+Pseudo.*Mercator|Popular.*Visualization.*CRS/i)) {
            //console.log('✅ Detected Web Mercator (3857)');
            return { wkid: 3857 };
        }

        // Pattern 7: WGS84 variations
        if (crsName.match(/WGS[_\s]*84|World[_\s]+Geodetic[_\s]+System/i) && !crsName.match(/UTM|Mercator/i)) {
            //console.log('✅ Detected WGS84 (4326)');
            return { wkid: 4326 };
        }

        // Pattern 8: Try to use WKT parser for complex definitions
        if (crsName.includes('PROJCS') || crsName.includes('GEOGCS')) {
            //console.log('🔍 Attempting to parse WKT definition...');

            // When the input is a full WKT string, ALWAYS return { wkt: theWkt }
            // so that the geometry is created with the exact projection parameters.
            // This is critical for ESRI-specific CRS variants (e.g., ESRI Krovak
            // with X_Scale/Y_Scale/XY_Plane_Rotation) that differ from the standard
            // EPSG definition despite sharing the same WKID.
            //
            // If we resolved to just { wkid: 5514 }, the ArcGIS PE would use its
            // default EPSG:5514 definition which may not match the exact parameters
            // used when the data was created.

            // Try to extract a WKID for the needsProjection check, but always
            // include the WKT so the PE gets the exact parameters.
            let extractedWkid: number | null = null;

            const authorityMatches = [...crsName.matchAll(/AUTHORITY\["EPSG","(\d+)"\]/gi)];
            if (authorityMatches.length > 0) {
                extractedWkid = parseInt(authorityMatches[authorityMatches.length - 1][1]);
            }

            if (!extractedWkid) {
                try {
                    const sr = new SpatialReference({ wkt: crsName });
                    if (sr?.wkid) {
                        extractedWkid = sr.wkid;
                    }
                } catch (wktError) {
                    // Couldn't parse, that's OK
                }
            }

            // Return WKT (with optional wkid for the skip-projection optimization)
            if (extractedWkid) {
                return { wkid: extractedWkid, wkt: crsName };
            }
            return { wkt: crsName };
        }

        // If all parsing attempts fail, default to WGS84
        console.warn('⚠️ Could not parse CRS, defaulting to WGS84 (4326)');
        return { wkid: 4326 };
    };

    /**
     * Count total vertices in a GeoJSON before import
     * Used to detect files that are too complex for web rendering
     */
    private countGeoJSONVertices = (geojson: any): number => {
        try {
            const features = geojson.type === 'FeatureCollection'
                ? geojson.features
                : [geojson];

            let totalVertices = 0;

            for (const feature of features) {
                if (!feature.geometry || !feature.geometry.coordinates) continue;

                const coords = feature.geometry.coordinates;
                const type = feature.geometry.type;

                switch (type) {
                    case 'Point':
                        totalVertices += 1;
                        break;
                    case 'LineString':
                        totalVertices += coords.length;
                        break;
                    case 'Polygon':
                        totalVertices += coords.reduce((sum: number, ring: any[]) => sum + ring.length, 0);
                        break;
                    case 'MultiPoint':
                        totalVertices += coords.length;
                        break;
                    case 'MultiLineString':
                        totalVertices += coords.reduce((sum: number, line: any[]) => sum + line.length, 0);
                        break;
                    case 'MultiPolygon':
                        totalVertices += coords.reduce((sum: number, polygon: any[]) =>
                            sum + polygon.reduce((pSum: number, ring: any[]) => pSum + ring.length, 0), 0);
                        break;
                }
            }

            return totalVertices;
        } catch (error) {
            console.error('Error counting GeoJSON vertices:', error);
            return 0;
        }
    };

    // Update convertGeoJSONGeometry to handle projection more robustly
    convertGeoJSONGeometry = async (geojsonGeom: any, sourceSR?: any): Promise<any> => {
        try {
            //console.log('🔄 Converting geometry type:', geojsonGeom.type);

            // Point, Polyline, Polygon are statically imported at top of file
            let geometry = null;

            // Create a proper SpatialReference instance.
            // When WKT is available (e.g., from a .prj file), use it to preserve
            // exact projection parameters. This is critical for ESRI-specific CRS
            // variants like Krovak that differ from the standard EPSG definition.
            let spatialReference: any;
            if (sourceSR?.wkt) {
                try {
                    spatialReference = new SpatialReference({ wkt: sourceSR.wkt });
                } catch (e) {
                    spatialReference = sourceSR;
                }
            } else if (sourceSR?.wkid) {
                spatialReference = new SpatialReference({ wkid: sourceSR.wkid });
            } else {
                spatialReference = new SpatialReference({ wkid: 4326 });
            }

            switch (geojsonGeom.type) {
                case 'Point':
                    if (!geojsonGeom.coordinates || geojsonGeom.coordinates.length < 2) {
                        throw new Error(this.props.nls('invalidPointCoordinates'));
                    }
                    geometry = new Point({
                        x: geojsonGeom.coordinates[0],
                        y: geojsonGeom.coordinates[1],
                        spatialReference: spatialReference
                    });
                    break;

                case 'LineString':
                    if (!geojsonGeom.coordinates || geojsonGeom.coordinates.length < 2) {
                        throw new Error('Invalid LineString coordinates');
                    }
                    geometry = new Polyline({
                        paths: [geojsonGeom.coordinates],
                        spatialReference: spatialReference
                    });
                    break;

                case 'Polygon':
                    if (!geojsonGeom.coordinates || geojsonGeom.coordinates.length === 0) {
                        throw new Error('Invalid Polygon coordinates');
                    }
                    geometry = new Polygon({
                        rings: geojsonGeom.coordinates,
                        spatialReference: spatialReference
                    });
                    break;

                case 'MultiPoint':
                    if (geojsonGeom.coordinates && geojsonGeom.coordinates.length > 0) {
                        geometry = new Point({
                            x: geojsonGeom.coordinates[0][0],
                            y: geojsonGeom.coordinates[0][1],
                            spatialReference: spatialReference
                        });
                    }
                    break;

                case 'MultiLineString':
                    if (geojsonGeom.coordinates && geojsonGeom.coordinates.length > 0) {
                        geometry = new Polyline({
                            paths: geojsonGeom.coordinates,
                            spatialReference: spatialReference
                        });
                    }
                    break;

                case 'MultiPolygon':
                    if (geojsonGeom.coordinates && geojsonGeom.coordinates.length > 0) {
                        const rings = geojsonGeom.coordinates.flat(1);
                        geometry = new Polygon({
                            rings: rings,
                            spatialReference: spatialReference
                        });
                    }
                    break;

                default:
                    console.warn('❌ Unsupported geometry type:', geojsonGeom.type);
                    return null;
            }

            if (!geometry) {
                return null;
            }

            // Project to map's spatial reference if needed
            if (this.props.jimuMapView?.view?.spatialReference) {
                const targetSR = this.props.jimuMapView.view.spatialReference;
                const sourceWkid = geometry.spatialReference?.wkid;
                const sourceWkt = geometry.spatialReference?.wkt;
                const targetWkid = targetSR?.wkid || (targetSR as any)?.latestWkid;

                const needsProjection = (sourceWkid && targetWkid && sourceWkid !== targetWkid)
                    || (sourceWkt && !sourceWkid)
                    || (sourceWkt && sourceWkid && targetWkid && sourceWkid !== targetWkid);

                if (needsProjection) {

                    // Fast path: WGS84 → Web Mercator (synchronous, no WASM)
                    if (sourceWkid === 4326 && (targetWkid === 3857 || targetWkid === 102100)) {
                        const result = webMercatorUtils.geographicToWebMercator(geometry);
                        if (result) return result;
                    }

                    // Fast path: Web Mercator → WGS84 (synchronous, no WASM)
                    if ((sourceWkid === 3857 || sourceWkid === 102100) && targetWkid === 4326) {
                        const result = webMercatorUtils.webMercatorToGeographic(geometry);
                        if (result) return result;
                    }

                    // proj4 fallback (statically imported — always available, CSP-safe)
                    if (sourceWkid && !sourceWkt) {
                        try {
                            const targetEpsg = (targetSR as any)?.latestWkid || targetWkid;
                            const transform = proj4(`EPSG:${sourceWkid}`, `EPSG:${targetEpsg}`);
                            const mapSRObj = new SpatialReference({ wkid: targetWkid });

                            if (geometry.type === 'point') {
                                const p = transform.forward([geometry.x, geometry.y]);
                                return new Point({ x: p[0], y: p[1], spatialReference: mapSRObj });
                            } else if (geometry.type === 'polyline') {
                                const newPaths = (geometry as any).paths.map((path: number[][]) =>
                                    path.map((pt: number[]) => {
                                        const p = transform.forward(pt);
                                        return pt.length > 2 ? [p[0], p[1], pt[2]] : p;
                                    })
                                );
                                return new Polyline({ paths: newPaths, spatialReference: mapSRObj });
                            } else if (geometry.type === 'polygon') {
                                const newRings = (geometry as any).rings.map((ring: number[][]) =>
                                    ring.map((pt: number[]) => {
                                        const p = transform.forward(pt);
                                        return pt.length > 2 ? [p[0], p[1], pt[2]] : p;
                                    })
                                );
                                return new Polygon({ rings: newRings, spatialReference: mapSRObj });
                            }
                        } catch (proj4Error) {
                            console.warn('⚠️ proj4 fallback also failed:', proj4Error);
                        }
                    }

                    console.warn('⚠️ All projection attempts failed, returning original geometry');
                    return geometry;
                } else {
                    //console.log('✅ No projection needed - same spatial reference');
                }
            }

            //console.log('✅ Geometry converted:', geometry);
            return geometry;

        } catch (error) {
            console.error('❌ Error converting geometry:', error);
            throw error;
        }
    };

    private detectImportFormat = (content: string): 'geojson' | 'legacy' | 'unknown' => {
        try {
            const parsed = JSON.parse(content);

            // Check if it's GeoJSON
            if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
                return 'geojson';
            }

            // Check if it's legacy format (array of graphics or object with drawings property)
            if (Array.isArray(parsed) || parsed.drawings || parsed.version) {
                return 'legacy';
            }

            return 'unknown';
        } catch (error) {
            return 'unknown';
        }
    };

    // Helper method to zoom to imported features
    zoomToImportedFeatures = async (importedCount: number) => {
        if (!this.props.jimuMapView?.view) {
            return;
        }

        setTimeout(async () => {
            try {
                const allGraphics = (this.sketchViewModel.layer as any).graphics.toArray();
                const importedGraphics = allGraphics.slice(-importedCount);

                if (importedGraphics.length > 0) {
                    const geometries = importedGraphics.map(g => g.geometry).filter(g => g != null);

                    if (geometries.length > 0) {
                        let extent: any = null;
                        for (const geom of geometries) {
                            const ext = geom?.extent;
                            if (ext) extent = extent ? extent.union(ext) : ext.clone();
                        }
                        if (extent) {
                            await this.props.jimuMapView.view.goTo(extent.expand(1.2), {
                                duration: 1000
                            });
                        }
                    }
                }
            } catch (zoomError) {
                console.warn('⚠️ Could not zoom to imported features:', zoomError);
            }
        }, 500);
    };

    handleShapefileImport = async (file: File) => {
        try {
            const arrayBuffer = await file.arrayBuffer();

            // Step 1: Extract the PRJ WKT and create a PRJ-stripped ZIP.
            // shpjs uses proj4 internally which MISPROJECTS ESRI-specific CRS
            // (e.g., Krovak with X_Scale/Y_Scale/XY_Plane_Rotation produces
            // valid-looking but WRONG WGS84 coordinates). By removing the .prj
            // file before giving the ZIP to shpjs, we get raw un-reprojected
            // coordinates that we can project correctly ourselves.
            let prjWkt: string | null = null;
            let parseBuffer = arrayBuffer; // Default: use original ZIP

            try {
                const zip = await JSZip.loadAsync(arrayBuffer);

                // Find and extract the PRJ file
                let prjFilename: string | null = null;
                for (const [filename, zipEntry] of Object.entries(zip.files) as Array<[string, any]>) {
                    if (filename.toLowerCase().endsWith('.prj') && !zipEntry.dir
                        && !filename.toLowerCase().includes('__macosx')) {
                        prjWkt = await zipEntry.async('text');
                        prjFilename = filename;
                        break;
                    }
                }

                // If we found a PRJ, create a new ZIP without it
                if (prjFilename && prjWkt) {
                    zip.remove(prjFilename);
                    parseBuffer = await zip.generateAsync({ type: 'arraybuffer' });
                }
            } catch (zipErr) {
                console.warn('⚠️ Could not process ZIP for PRJ extraction:', zipErr);
            }

            // Step 2: Parse the shapefile with shpjs using the PRJ-stripped ZIP.
            // Without a .prj file, shpjs returns raw coordinates as-is.
            const shpModule: any = await import('shpjs');
            const shp: any = shpModule.default || shpModule;
            let geoJSON = await shp(parseBuffer);

            // Normalize to single FeatureCollection
            if (Array.isArray(geoJSON)) {
                const allFeatures = geoJSON.flatMap((fc: any) => fc.features || []);
                geoJSON = { type: 'FeatureCollection', features: allFeatures };
            }
            if (!geoJSON.type || geoJSON.type !== 'FeatureCollection') {
                geoJSON = {
                    type: 'FeatureCollection',
                    features: Array.isArray(geoJSON) ? geoJSON : [geoJSON]
                };
            }
            if (!geoJSON.features || geoJSON.features.length === 0) {
                throw new Error(this.props.nls('noFeaturesFoundInShapefile'));
            }

            // Step 3: Determine coordinate state and set CRS accordingly.
            const isWGS84 = this.coordinatesLookLikeWGS84(geoJSON);
            const testCoord = this.getFirstCoordinate(geoJSON);

            if (isWGS84 && !prjWkt) {
                // No PRJ and coords look WGS84 — assume WGS84
                delete geoJSON.crs;
            } else if (isWGS84 && prjWkt) {
                // Coords are WGS84 even though we stripped the PRJ.
                // This means the source CRS IS WGS84 (or very close).
                delete geoJSON.crs;
            } else if (!isWGS84 && prjWkt) {
                // Raw source coordinates (shpjs didn't reproject because we stripped PRJ).
                // Since the ArcGIS client-side PE doesn't work in ExB, use the ArcGIS
                // Geometry Service (server-side REST) to project all coordinates at once.
                const mapSR = this.props.jimuMapView?.view?.spatialReference;
                const mapWkid = mapSR?.wkid;
                let projectedViaService = false;

                if (mapWkid) {
                    try {
                        const projected = await this.projectGeoJSONViaGeometryService(geoJSON, prjWkt, mapWkid);
                        if (projected) {
                            geoJSON = projected;
                            geoJSON.crs = { type: 'name', properties: { name: `EPSG:${mapWkid}` } };
                            projectedViaService = true;
                        }
                    } catch (gsError) {
                        console.warn('⚠️ Geometry Service projection failed:', gsError);
                    }
                }

                if (!projectedViaService) {
                    // Fallback: pass WKT to convertGeoJSONGeometry to try ArcGIS PE
                    geoJSON.crs = { type: 'name', properties: { name: prjWkt } };
                }
            } else {
                // Not WGS84, no PRJ — can't determine CRS
                console.warn('⚠️ No .prj file and coordinates are not WGS84.');
                delete geoJSON.crs;
            }

            await this.importGeoJSON(geoJSON);

        } catch (error) {
            console.error('❌ Shapefile import error:', error);
            alert(`Failed to import shapefile: ${error.message}`);
            throw error;
        }
    };

    /**
     * Project GeoJSON features using the ArcGIS Geometry Service REST API.
     * This is a server-side projection that correctly handles ALL CRS including
     * ESRI-specific variants that proj4 and the client-side PE can't handle.
     */
    private projectGeoJSONViaGeometryService = async (
        geoJSON: any, inSRWkt: string, outWkid: number
    ): Promise<any | null> => {
        // Discover Geometry Service URL
        let gsUrl: string | null = null;
        try {
            const portal = (this.props.jimuMapView?.view?.map as any)?.portalItem?.portal;
            gsUrl = portal?.helperServices?.geometry?.url;
        } catch (e) { /* ignore */ }

        if (!gsUrl) {
            gsUrl = 'https://utility.arcgisonline.com/ArcGIS/rest/services/Geometry/GeometryServer';
        }

        // Determine ESRI geometry type from GeoJSON
        const firstGeomType = geoJSON.features[0]?.geometry?.type;
        let esriGeomType: string;
        if (firstGeomType === 'Polygon' || firstGeomType === 'MultiPolygon') {
            esriGeomType = 'esriGeometryPolygon';
        } else if (firstGeomType === 'LineString' || firstGeomType === 'MultiLineString') {
            esriGeomType = 'esriGeometryPolyline';
        } else if (firstGeomType === 'Point' || firstGeomType === 'MultiPoint') {
            esriGeomType = 'esriGeometryPoint';
        } else {
            throw new Error(`Unsupported geometry type: ${firstGeomType}`);
        }

        // Convert GeoJSON geometries to ESRI REST JSON format
        const esriGeometries = geoJSON.features.map((f: any) => {
            const geom = f.geometry;
            switch (geom.type) {
                case 'Point':
                    return { x: geom.coordinates[0], y: geom.coordinates[1] };
                case 'MultiPoint':
                    return { points: geom.coordinates };
                case 'LineString':
                    return { paths: [geom.coordinates] };
                case 'MultiLineString':
                    return { paths: geom.coordinates };
                case 'Polygon':
                    return { rings: geom.coordinates };
                case 'MultiPolygon':
                    return { rings: geom.coordinates.flat(1) };
                default:
                    return null;
            }
        }).filter((g: any) => g !== null);

        // Call the Geometry Service project endpoint in batches
        const BATCH_SIZE = 50;
        const allProjected: any[] = [];

        for (let i = 0; i < esriGeometries.length; i += BATCH_SIZE) {
            const batch = esriGeometries.slice(i, i + BATCH_SIZE);

            const params = new URLSearchParams();
            params.append('f', 'json');
            params.append('inSR', JSON.stringify({ wkt: inSRWkt }));
            params.append('outSR', String(outWkid));
            params.append('geometries', JSON.stringify({
                geometryType: esriGeomType,
                geometries: batch
            }));

            const response = await fetch(`${gsUrl}/project`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(`Geometry Service error: ${result.error.message || JSON.stringify(result.error)}`);
            }

            if (!result.geometries || result.geometries.length === 0) {
                throw new Error('Geometry Service returned no projected geometries');
            }

            allProjected.push(...result.geometries);
        }

        // Apply projected coordinates back to GeoJSON
        for (let i = 0; i < allProjected.length && i < geoJSON.features.length; i++) {
            const projected = allProjected[i];
            const feature = geoJSON.features[i];

            if (feature.geometry.type === 'Point') {
                feature.geometry.coordinates = [projected.x, projected.y];
            } else if (feature.geometry.type === 'MultiPoint') {
                feature.geometry.coordinates = projected.points;
            } else if (feature.geometry.type === 'LineString') {
                feature.geometry.coordinates = projected.paths[0];
            } else if (feature.geometry.type === 'MultiLineString') {
                feature.geometry.coordinates = projected.paths;
            } else if (feature.geometry.type === 'Polygon') {
                feature.geometry.coordinates = projected.rings;
            } else if (feature.geometry.type === 'MultiPolygon') {
                feature.geometry.coordinates = [projected.rings];
            }
        }

        return geoJSON;
    };

    /**
     * Get the first [x, y] coordinate from a GeoJSON FeatureCollection.
     */
    private getFirstCoordinate = (geoJSON: any): number[] | null => {
        for (const feature of (geoJSON.features || [])) {
            const coords = feature?.geometry?.coordinates;
            if (!coords) continue;
            const type = feature.geometry.type;
            if (type === 'Point') return coords.slice(0, 2);
            if (type === 'LineString' || type === 'MultiPoint') return coords[0]?.slice(0, 2);
            if (type === 'Polygon' || type === 'MultiLineString') return coords[0]?.[0]?.slice(0, 2);
            if (type === 'MultiPolygon') return coords[0]?.[0]?.[0]?.slice(0, 2);
        }
        return null;
    };

    /**
     * Reproject all coordinates in a GeoJSON FeatureCollection using a proj4 transform.
     */
    private reprojectGeoJSONCoordinates = (geoJSON: any, transform: any): any => {
        // Deep-clone to avoid mutating the original
        const result = JSON.parse(JSON.stringify(geoJSON));
        for (const feature of (result.features || [])) {
            if (!feature.geometry || !feature.geometry.coordinates) continue;
            feature.geometry.coordinates = this.reprojectCoordinates(
                feature.geometry.coordinates,
                feature.geometry.type,
                transform
            );
        }
        return result;
    };

    /**
     * Recursively reproject coordinates based on GeoJSON geometry type.
     */
    private reprojectCoordinates = (coords: any, geomType: string, transform: any): any => {
        switch (geomType) {
            case 'Point':
                return this.transformPoint(coords, transform);
            case 'LineString':
            case 'MultiPoint':
                return coords.map((pt: any) => this.transformPoint(pt, transform));
            case 'Polygon':
            case 'MultiLineString':
                return coords.map((ring: any) =>
                    ring.map((pt: any) => this.transformPoint(pt, transform))
                );
            case 'MultiPolygon':
                return coords.map((polygon: any) =>
                    polygon.map((ring: any) =>
                        ring.map((pt: any) => this.transformPoint(pt, transform))
                    )
                );
            default:
                return coords;
        }
    };

    /**
     * Transform a single [x, y] or [x, y, z] coordinate using a proj4 transform.
     */
    private transformPoint = (coord: number[], transform: any): number[] => {
        try {
            const [x, y] = transform.forward(coord);
            return coord.length > 2 ? [x, y, coord[2]] : [x, y];
        } catch (e) {
            return coord;
        }
    };

    /**
     * Check if coordinates in a GeoJSON FeatureCollection look like WGS84
     * (longitude within [-180, 180], latitude within [-90, 90]).
     */
    private coordinatesLookLikeWGS84 = (geoJSON: any): boolean => {
        try {
            for (const feature of (geoJSON.features || [])) {
                const coords = feature?.geometry?.coordinates;
                if (!coords) continue;

                let x: number, y: number;
                const type = feature.geometry.type;

                if (type === 'Point') {
                    [x, y] = coords;
                } else if (type === 'LineString' || type === 'MultiPoint') {
                    [x, y] = coords[0];
                } else if (type === 'Polygon' || type === 'MultiLineString') {
                    [x, y] = coords[0][0];
                } else if (type === 'MultiPolygon') {
                    [x, y] = coords[0][0][0];
                } else {
                    continue;
                }

                if (typeof x !== 'number' || typeof y !== 'number') continue;

                return Math.abs(x) <= 180 && Math.abs(y) <= 90;
            }
        } catch (e) {
            // If anything goes wrong, assume not WGS84 to be safe
        }
        return false;
    };

    // Update createDefaultSymbol method with proper typing
    createDefaultSymbol = (geometryType: string): any => {
        // SimpleMarkerSymbol, SimpleLineSymbol, SimpleFillSymbol are statically imported at top of file

        switch (geometryType) {
            case 'point':
            case 'multipoint':
                return new SimpleMarkerSymbol({
                    style: 'circle',
                    color: [51, 51, 204, 0.9],
                    size: 8,
                    outline: {
                        color: [255, 255, 255],
                        width: 1
                    }
                });
            case 'polyline':
                return new SimpleLineSymbol({
                    color: [51, 51, 204, 0.9],
                    width: 2
                });
            case 'polygon':
                return new SimpleFillSymbol({
                    color: [51, 51, 204, 0.3],
                    outline: {
                        color: [51, 51, 204, 0.9],
                        width: 2
                    }
                });
            default:
                return new SimpleMarkerSymbol({
                    style: 'circle',
                    color: [51, 51, 204, 0.9],
                    size: 8
                });
        }
    };

    closeImportDialog = () => {
        this.setState({
            importDialogOpen: false,
            importFile: null,
            importFileContent: null,
            // 🔧 FIX: Also reset progress state when closing dialog
            importInProgress: false,
            importProgress: 0,
            importProgressMessage: ''
        });
    }

    // Handle replacing all existing drawings
    handleImportReplace = () => {
        this.processImport(true);
    }

    // Handle adding to existing drawings
    handleImportAdd = () => {
        this.processImport(false);
    }

    private processGeoJSONImport = async (content: string, replace: boolean) => {
        try {
            const geoJSON = JSON.parse(content);

            if (!geoJSON.features || !Array.isArray(geoJSON.features)) {
                console.warn('Not a valid GeoJSON FeatureCollection');
                const format = this.detectImportFormat(content);
                if (format === 'legacy') {
                    return this.processLegacyImport(content, replace);
                }
                this.showLocalAlert(this.props.nls('invalidFileFormat'), 'error');
                this.closeImportDialog();
                return;
            }

            // 🔧 FIX: Set importing flag to ignore ALL graphics change events during import
            this._isImporting = true;

            this.ignoreNextGraphicsUpdate = true;
            if (replace) {
                this.props.graphicsLayer.removeAll();
            }

            let successCount = 0;
            let errorCount = 0;

            const allFeatures: any[] = geoJSON.features;
            const mainFeatures = allFeatures.filter(f => !f?.properties?.isMeasurementLabel);
            const labelFeatures = allFeatures.filter(f => f?.properties?.isMeasurementLabel);
            const parentById: Map<string, ExtendedGraphic> = new Map();
            const totalFeatures = mainFeatures.length + labelFeatures.length;

            // Show progress
            this.setState({
                importInProgress: true,
                importProgress: 0,
                importProgressMessage: `Starting import...`
            });

            // FORCE 500ms delay to ensure modal renders
            await new Promise<void>(resolve => setTimeout(() => resolve(), 500));

            // ========================================
            // PROCESS WITH SHORTER DELAY (since we pre-loaded projection)
            // ========================================
            for (let i = 0; i < mainFeatures.length; i++) {
                //console.log(`Processing feature ${i + 1} of ${mainFeatures.length}`);

                try {
                    const g = await this.convertGeoJSONFeatureToGraphic(mainFeatures[i], i);

                    if (g) {
                        this.props.graphicsLayer.add(g);
                        successCount++;
                        const pid = g.attributes?.uniqueId;
                        if (pid) parentById.set(pid, g);
                    } else {
                        errorCount++;
                    }
                } catch (err) {
                    console.warn(`Error importing feature ${i}:`, err);
                    errorCount++;
                }

                // Update progress
                const progress = Math.round(((i + 1) / totalFeatures) * 100);
                this.setState({
                    importProgress: progress,
                    importProgressMessage: `Importing: ${i + 1} / ${mainFeatures.length}`
                });

                // 🔧 REDUCED: 50ms delay instead of 100ms (since projection is pre-loaded)
                await new Promise<void>(resolve => setTimeout(() => resolve(), 50));
            }

            // Process labels
            for (let j = 0; j < labelFeatures.length; j++) {
                //console.log(`Processing label ${j + 1} of ${labelFeatures.length}`);

                try {
                    const f = labelFeatures[j];
                    const labelGraphic = await this.convertGeoJSONFeatureToGraphic(f, j + mainFeatures.length);

                    if (labelGraphic) {
                        const parentId = labelGraphic.attributes?.parentGraphicId;
                        const parentGraphic = parentId ? parentById.get(parentId) : undefined;

                        if (parentGraphic) {
                            (labelGraphic as any).measureParent = parentGraphic;

                            if (!parentGraphic.measure && labelGraphic.attributes?.measurementType !== 'segment') {
                                parentGraphic.measure = {
                                    graphic: labelGraphic,
                                    lengthUnit: labelGraphic.attributes?.lengthUnit,
                                    areaUnit: labelGraphic.attributes?.areaUnit
                                };
                            }

                            if (!parentGraphic.attributes) parentGraphic.attributes = {};
                            parentGraphic.attributes.hadMeasurements = true;
                            if (!parentGraphic.attributes.relatedMeasurementLabels) {
                                parentGraphic.attributes.relatedMeasurementLabels = [];
                            }
                            parentGraphic.attributes.relatedMeasurementLabels.push(labelGraphic);

                            if (labelGraphic.attributes?.measurementType === 'segment') {
                                if (!parentGraphic.attributes.relatedSegmentLabels) {
                                    parentGraphic.attributes.relatedSegmentLabels = [];
                                }
                                parentGraphic.attributes.relatedSegmentLabels.push(labelGraphic);
                            }

                            this.props.graphicsLayer.add(labelGraphic);
                            successCount++;
                        }
                    }
                } catch (err) {
                    console.warn(`Error importing label ${j}:`, err);
                    errorCount++;
                }

                const processedTotal = mainFeatures.length + j + 1;
                const progress = Math.round((processedTotal / totalFeatures) * 100);
                this.setState({
                    importProgress: progress,
                    importProgressMessage: `Importing labels: ${j + 1} / ${labelFeatures.length}`
                });

                // 🔧 REDUCED: 50ms delay
                await new Promise<void>(resolve => setTimeout(() => resolve(), 50));
            }

            // Finish
            await this.refreshDrawingsFromLayer();

            this.setState({
                importInProgress: false,
                importProgress: 0,
                importProgressMessage: ''
            });

            if (successCount > 0) {
                //console.log(`Successfully imported ${successCount} items`);
            }

        } catch (error) {
            console.error('Error processing GeoJSON import:', error);
            this.showLocalAlert('Error importing GeoJSON file', 'error');

            this.setState({
                importInProgress: false,
                importProgress: 0,
                importProgressMessage: ''
            });
        } finally {
            // 🔧 FIX: Always reset importing flag and cleanup, even on errors
            this._isImporting = false;
            this.ignoreNextGraphicsUpdate = false;

            this.closeImportDialog();
            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            if (fileInput) {
                fileInput.value = '';
            }
        }
    };

    private convertGeoJSONFeatureToGraphic = async (feature: any, index: number): Promise<ExtendedGraphic | null> => {
        try {
            if (!feature?.geometry || !feature?.properties) {
                console.warn(`Feature ${index} missing geometry or properties`);
                return null;
            }

            const arcgisGeometry = await this.convertGeoJSONGeometryToArcGIS(feature.geometry);
            if (!arcgisGeometry) {
                console.warn(`Failed to convert geometry for feature ${index}`);
                return null;
            }

            let symbol: any | undefined;
            let textString: string | null = null;

            const isTextLike =
                feature.geometry?.type === 'Point' &&
                (!!feature.properties.text || !!feature.properties.textContent || feature.properties.type === 'Text');

            // Build symbol
            if (isTextLike) {
                textString =
                    feature.properties.text ??
                    feature.properties.textContent ??
                    'Text';

                const textColor = new Color(feature.properties.text_color || '#000000');
                if (typeof feature.properties.text_opacity === 'number') {
                    (textColor as any).a = Math.max(0, Math.min(1, feature.properties.text_opacity));
                }

                const font = new Font({
                    size: feature.properties.text_size || 12,
                    family: feature.properties.text_font || 'Arial',
                    weight: feature.properties.text_weight || 'normal',
                    style: feature.properties.text_style || 'normal',
                    decoration: feature.properties.text_decoration || 'none'
                });

                const horizontalAlignment = feature.properties.text_align || 'center';
                const verticalAlignment = feature.properties.text_baseline || 'middle';
                const angle = typeof feature.properties.text_rotation === 'number' ? feature.properties.text_rotation : 0;

                let haloColor: Color | undefined;
                let haloSize: number | undefined;
                if (typeof feature.properties.text_halo_size === 'number') {
                    const hs = feature.properties.text_halo_size;
                    if (hs > 0) {
                        haloSize = hs;
                        const hc = new Color(feature.properties.text_halo_color || '#FFFFFF');
                        if (typeof feature.properties.text_halo_opacity === 'number') {
                            (hc as any).a = Math.max(0, Math.min(1, feature.properties.text_halo_opacity));
                        }
                        haloColor = hc;
                    }
                }

                symbol = new TextSymbol({
                    text: textString,
                    color: textColor,
                    font,
                    horizontalAlignment,
                    verticalAlignment,
                    angle,
                    haloColor,
                    haloSize
                });

                // Apply lineWidth via toJSON → set → fromJSON to bypass ArcGIS's
                // accessor capping. Without this, the default lineWidth (~192)
                // overrides explicit \n characters in `text`, so multi-line
                // labels render as a single line on import.
                // Mirrors widget.tsx::applyLineWidth.
                try {
                    const lw = typeof feature.properties.text_lineWidth === 'number'
                        ? feature.properties.text_lineWidth
                        : 9999;
                    const tsJson = (symbol as TextSymbol).toJSON();
                    tsJson.lineWidth = lw;
                    symbol = TextSymbol.fromJSON(tsJson);
                } catch { /* keep symbol as-is if fromJSON fails */ }
            } else {
                // 🔧 Fallback to full symbol support
                symbol = this.createSymbolFromGeoJSONProperties(feature.properties, feature.geometry.type);
            }

            const defaultName =
                isTextLike && textString
                    ? textString
                    : (feature.properties.name || `Imported Drawing ${index + 1}`);

            let createdDate = Date.now();
            if (feature.properties.created) {
                if (typeof feature.properties.created === 'number') {
                    createdDate = feature.properties.created;
                } else if (typeof feature.properties.created === 'string') {
                    const parsed = Date.parse(feature.properties.created);
                    if (!isNaN(parsed)) {
                        createdDate = parsed;
                    }
                }
            }

            const attributes: any = {
                uniqueId: feature.properties.id || `imported_geojson_${Date.now()}_${index}`,
                name: this.ensureUniqueName(defaultName),
                createdDate,
                geometryType: feature.geometry.type
            };

            if (feature.properties.isMeasurementLabel) {
                attributes.isMeasurementLabel = true;
                attributes.hideFromList = true;
                attributes.parentGraphicId = feature.properties.parentGraphicId;
                attributes.measurementType = feature.properties.measurementType;
                attributes.lengthUnit = feature.properties.lengthUnit;
                attributes.areaUnit = feature.properties.areaUnit;
                attributes.drawMode = 'text';
            }

            if (feature.properties.bufferDistance && feature.properties.bufferUnit) {
                attributes.bufferSettings = {
                    distance: feature.properties.bufferDistance,
                    unit: feature.properties.bufferUnit,
                    enabled: true,
                    opacity: typeof feature.properties.bufferOpacity === 'number'
                        ? feature.properties.bufferOpacity
                        : 50
                };
            }

            // Import notes if present
            if (feature.properties.notes) {
                attributes.notes = feature.properties.notes;
            }

            const graphic = new Graphic({
                geometry: arcgisGeometry,
                symbol: symbol as any, // Type assertion to bypass strict typing
                attributes
            }) as ExtendedGraphic;

            if (attributes.bufferSettings) {
                graphic.bufferSettings = attributes.bufferSettings;
            }

            return graphic;
        } catch (error) {
            console.error(`Error converting GeoJSON feature ${index}:`, error);
            return null;
        }
    };

    // Convert GeoJSON geometry to ArcGIS geometry
    private convertGeoJSONGeometryToArcGIS = async (geoJsonGeometry: any): Promise<any | null> => {
        try {
            const currentSR = this.props.jimuMapView?.view?.spatialReference || new SpatialReference({ wkid: 4326 });

            // First convert the GeoJSON coordinates to a temporary WGS84 geometry
            let wgs84Geometry: any;
            const wgs84SR = new SpatialReference({ wkid: 4326 });

            switch (geoJsonGeometry.type) {
                case 'Point':
                    const coords = geoJsonGeometry.coordinates;
                    wgs84Geometry = new Point({
                        longitude: coords[0],
                        latitude: coords[1],
                        spatialReference: wgs84SR
                    });
                    break;

                case 'LineString':
                    wgs84Geometry = {
                        type: 'polyline',
                        paths: [geoJsonGeometry.coordinates],
                        spatialReference: wgs84SR
                    } as any;
                    break;

                case 'MultiLineString':
                    wgs84Geometry = {
                        type: 'polyline',
                        paths: geoJsonGeometry.coordinates,
                        spatialReference: wgs84SR
                    } as any;
                    break;

                case 'Polygon':
                    wgs84Geometry = {
                        type: 'polygon',
                        rings: geoJsonGeometry.coordinates,
                        spatialReference: wgs84SR
                    } as any;
                    break;

                default:
                    console.warn(`Unsupported GeoJSON geometry type: ${geoJsonGeometry.type}`);
                    return null;
            }

            // If the map is in WGS84, return the geometry as-is
            const currentWkid = currentSR.wkid || (currentSR as any).latestWkid;
            if (currentWkid === 4326) {
                return wgs84Geometry;
            }

            // Fast path: WGS84 → Web Mercator (synchronous, no WASM needed)
            if (currentWkid === 3857 || currentWkid === 102100) {
                const result = webMercatorUtils.geographicToWebMercator(wgs84Geometry);
                if (result) return result;
            }

            // Project from WGS84 to the current map spatial reference
            return await this.projectGeometryFromWGS84(wgs84Geometry, currentSR);

        } catch (error) {
            console.error('Error converting GeoJSON geometry:', error);
            return null;
        }
    };

    // Helper method to convert from WGS84 back to map projection
    private convertFromWGS84ToMapProjection = (lon: number, lat: number): { x: number; y: number } => {
        const mapSR = this.props.jimuMapView?.view?.spatialReference;

        if (!mapSR || mapSR.wkid === 4326) {
            return { x: lon, y: lat };
        }

        // Convert from WGS84 to Web Mercator
        if (mapSR.wkid === 3857 || mapSR.wkid === 102100) {
            const x = lon * 20037508.34 / 180;
            const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
            return { x, y };
        }

        // For other coordinate systems, this is a rough approximation
        // In a production environment, you'd want to use proper projection libraries
        if (mapSR.wkid >= 32601 && mapSR.wkid <= 32660) {
            // UTM North - very rough approximation
            const zone = mapSR.wkid - 32600;
            const centralMeridian = (zone - 1) * 6 - 180 + 3;
            const x = 500000 + (lon - centralMeridian) * 111320;
            const y = lat * 110540;
            return { x, y };
        }

        // For State Plane and other systems, assume direct conversion
        // This is not accurate but prevents import failures
        return { x: lon, y: lat };
    };

    // Create ArcGIS symbol from GeoJSON properties
    private createSymbolFromGeoJSONProperties = (properties: any, geometryType: string): any => {
        try {
            switch (geometryType) {
                case 'Point': {
                    // Check if this is a picture marker
                    const isPictureMarker = properties.symbolType === 'picture-marker' ||
                        properties.imageUrl ||
                        properties.iconUrl;

                    if (isPictureMarker) {
                        // Get the image URL
                        const imageUrl = properties.imageUrl || properties.iconUrl;

                        // Size (optional, default 24)
                        const width = properties.imageWidth || 24;
                        const height = properties.imageHeight || 24;

                        // Rotation (optional)
                        const angle = typeof properties.imageRotation === 'number' ? properties.imageRotation : 0;

                        return new PictureMarkerSymbol({
                            url: imageUrl,
                            width: width,
                            height: height,
                            angle: angle,
                            xoffset: properties.imageOffsetX || 0,
                            yoffset: properties.imageOffsetY || 0,
                            color: properties.image_tint ? new Color(properties.image_tint) : undefined
                        });
                    } else {
                        // Simple marker symbol
                        const requestedStyle = properties.marker_symbol;

                        // Directly map to one of the allowed literal types
                        const getMarkerStyle = (requested: any): 'circle' | 'square' | 'cross' | 'x' | 'diamond' | 'triangle' | 'path' => {
                            switch (requested) {
                                case 'circle': return 'circle';
                                case 'square': return 'square';
                                case 'cross': return 'cross';
                                case 'x': return 'x';
                                case 'diamond': return 'diamond';
                                case 'triangle': return 'triangle';
                                case 'path': return 'path';
                                default: return 'circle';
                            }
                        };

                        return new SimpleMarkerSymbol({
                            style: getMarkerStyle(requestedStyle),
                            size: properties.marker_size || 12,
                            color: new Color(properties.marker_color || '#000000'),
                            outline: properties.stroke ? new SimpleLineSymbol({
                                color: new Color(properties.stroke || '#000000'),
                                width: properties.stroke_width || 1
                            }) : undefined
                        });
                    }
                }

                case 'LineString':
                case 'MultiLineString':
                    return new SimpleLineSymbol({
                        style: 'solid',
                        color: new Color(properties.stroke || '#000000'),
                        width: properties.stroke_width || 2
                    });

                case 'Polygon': {
                    const fillColor = new Color(properties.fill || '#000000');
                    if (typeof properties.fill_opacity === 'number') {
                        fillColor.a = Math.max(0, Math.min(1, properties.fill_opacity));
                    }

                    const outlineColor = new Color(properties.stroke || '#000000');
                    if (typeof properties.stroke_opacity === 'number') {
                        outlineColor.a = Math.max(0, Math.min(1, properties.stroke_opacity));
                    }

                    return new SimpleFillSymbol({
                        style: 'solid',
                        color: fillColor,
                        outline: new SimpleLineSymbol({
                            color: outlineColor,
                            width: properties.stroke_width || 1
                        })
                    });
                }

                default:
                    return new SimpleMarkerSymbol({
                        style: 'circle',
                        size: 8,
                        color: new Color('#FF0000')
                    });
            }
        } catch (err) {
            console.error('Error creating symbol from GeoJSON properties:', err);
            return new SimpleMarkerSymbol({
                style: 'circle',
                size: 8,
                color: new Color('#FF0000')
            });
        }
    };
    private processShapefileImport = async (file: File, replace: boolean) => {
        try {
            // Optionally clear existing graphics
            if (replace) {
                //console.log('🗑️ Clearing existing drawings (replace mode)');
                this.ignoreNextGraphicsUpdate = true;
                this.props.graphicsLayer.removeAll();
            }

            // 🔧 FIX: Set importing flag to ignore ALL graphics change events during import
            this._isImporting = true;

            // Call existing shapefile import logic
            await this.handleShapefileImport(file);

            // Refresh drawings list to show imported items immediately
            await this.refreshDrawingsFromLayer();

            // Close dialog and reset file input
            this.closeImportDialog();
            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            if (fileInput) {
                fileInput.value = '';
            }
        } catch (error) {
            console.error('Shapefile import error:', error);
            this.showLocalAlert('Failed to import shapefile', 'error');
            this.closeImportDialog();

            // Reset file input even on error
            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            if (fileInput) {
                fileInput.value = '';
            }
        } finally {
            // 🔧 FIX: Always reset importing flag
            this._isImporting = false;
            this.ignoreNextGraphicsUpdate = false;
        }
    };
    // Process legacy JSON imports (existing functionality)
    private processLegacyImport = async (content: string, replace: boolean) => {
        try {
            const parsedData = JSON.parse(content);
            //console.log('📜 Processing legacy import:', parsedData);

            // Handle old format (array) or newer format (object with drawings)
            let drawingsData = [];
            let measurementLabelsData = [];

            if (Array.isArray(parsedData)) {
                // Old format: just an array of graphics
                drawingsData = parsedData;
            } else if (parsedData.drawings) {
                // Newer format: object with drawings and measurementLabels
                drawingsData = parsedData.drawings || [];
                measurementLabelsData = parsedData.measurementLabels || [];
            }

            // Optionally clear existing graphics
            if (replace) {
                //console.log('🗑️ Clearing existing drawings (replace mode)');
                this.ignoreNextGraphicsUpdate = true;
                this.props.graphicsLayer.removeAll();
            }

            // 🔧 FIX: Set importing flag to ignore ALL graphics change events during import
            this._isImporting = true;

            this.ignoreNextGraphicsUpdate = true;
            let loadedDrawingsCount = 0;
            let loadedLabelsCount = 0;
            let loadedBuffersCount = 0;
            const restoredGraphics = new Map<string, ExtendedGraphic>();

            // Restore main drawings
            drawingsData.forEach((item, index) => {
                try {
                    // Convert JSON to Graphic using ArcGIS API
                    const graphic = GraphicCompat.fromJSON(item) as ExtendedGraphic;

                    if (!graphic.attributes) {
                        graphic.attributes = {};
                    }

                    // Promote jimuDrawId to uniqueId for ExB Draw widget JSON compatibility
                    if (!graphic.attributes.uniqueId && graphic.attributes.jimuDrawId) {
                        graphic.attributes.uniqueId = String(graphic.attributes.jimuDrawId);
                    }

                    if (!graphic.attributes.uniqueId) {
                        graphic.attributes.uniqueId = `imported_${Date.now()}_${index}`;
                    }

                    // Ensure name exists
                    if (!graphic.attributes.name) {
                        graphic.attributes.name = `Drawing ${index + 1}`;
                    }

                    // Ensure name is unique if adding
                    if (!replace) {
                        graphic.attributes.name = this.ensureUniqueName(graphic.attributes.name);
                    }

                    // Restore buffer settings if present
                    if (item.attributes?.bufferSettings) {
                        graphic.bufferSettings = {
                            distance: item.attributes.bufferSettings.distance,
                            unit: item.attributes.bufferSettings.unit,
                            enabled: item.attributes.bufferSettings.enabled,
                            opacity: item.attributes.bufferSettings.opacity,
                            outlineOnly: item.attributes.bufferSettings.outlineOnly ?? false,
                            customColor: item.attributes.bufferSettings.customColor ?? null,
                            customOutlineColor: item.attributes.bufferSettings.customOutlineColor ?? null
                        };

                        if (graphic.bufferSettings.enabled) {
                            loadedBuffersCount++;
                        } else {
                            loadedDrawingsCount++;
                        }
                    } else {
                        loadedDrawingsCount++;
                    }

                    this.props.graphicsLayer.add(graphic);
                    restoredGraphics.set(graphic.attributes.uniqueId, graphic);
                } catch (err) {
                    console.warn(`⚠️ Error restoring graphic at index ${index}:`, err);
                }
            });

            // Restore measurement labels (if any)
            measurementLabelsData.forEach((item, index) => {
                try {
                    const labelGraphic = GraphicCompat.fromJSON(item) as ExtendedGraphic;

                    if (!labelGraphic.attributes) {
                        labelGraphic.attributes = {};
                    }

                    labelGraphic.attributes.isMeasurementLabel = true;
                    labelGraphic.attributes.hideFromList = true;

                    const parentGraphicId = labelGraphic.attributes.parentGraphicId;
                    if (parentGraphicId && restoredGraphics.has(parentGraphicId)) {
                        const parentGraphic = restoredGraphics.get(parentGraphicId);
                        labelGraphic.measureParent = parentGraphic;

                        if (!parentGraphic.measure) {
                            parentGraphic.measure = {
                                graphic: labelGraphic,
                                lengthUnit: labelGraphic.attributes.lengthUnit,
                                areaUnit: labelGraphic.attributes.areaUnit
                            };
                        }

                        // 🔧 CRITICAL: Mark that this graphic has measurements
                        if (!parentGraphic.attributes) {
                            parentGraphic.attributes = {};
                        }
                        parentGraphic.attributes.hadMeasurements = true;

                        this.props.graphicsLayer.add(labelGraphic);
                        loadedLabelsCount++;
                    }
                } catch (err) {
                    console.warn(`⚠️ Error restoring measurement label at index ${index}:`, err);
                }
            });

            //console.log(`✅ Legacy import complete: ${loadedDrawingsCount} drawings, ${loadedBuffersCount} buffers, ${loadedLabelsCount} labels`);

            // Refresh and close
            await this.refreshDrawingsFromLayer();
            this.closeImportDialog();

            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            if (fileInput) {
                fileInput.value = '';
            }

        } catch (error) {
            console.error('❌ Legacy import error:', error);
            this.showLocalAlert('Failed to import legacy file', 'error');
            this.closeImportDialog();
        } finally {
            // 🔧 FIX: Always reset importing flag
            this._isImporting = false;
            this.ignoreNextGraphicsUpdate = false;
        }
    };
    // Process the import with or without replacement
    processImport = (replace: boolean) => {
        const { importFileContent, importFile } = this.state;

        if (!importFile) {
            this.closeImportDialog();
            return;
        }

        try {
            const fileName = importFile.name.toLowerCase();

            if (fileName.endsWith('.json') || fileName.endsWith('.geojson')) {
                // Detect if it's GeoJSON or legacy format
                const format = this.detectImportFormat(importFileContent);
                //console.log(`📋 Detected format: ${format}`);

                if (format === 'geojson') {
                    this.processGeoJSONImport(importFileContent, replace);
                } else if (format === 'legacy') {
                    this.processLegacyImport(importFileContent, replace);
                } else {
                    this.showLocalAlert('Unknown JSON format', 'error');
                    this.closeImportDialog();
                }
            } else if (fileName.endsWith('.kml')) {
                this.processKMLImport(importFileContent, replace);
            } else if (fileName.endsWith('.zip')) {
                this.processShapefileImport(importFile, replace);
            } else {
                console.error('Unknown file format');
                this.showLocalAlert(this.props.nls('unsupportedFileFormat'), 'error');
                this.closeImportDialog();
            }
        } catch (error) {
            console.error('Error processing import:', error);
            this.showLocalAlert(this.props.nls('errorProcessingImport'), 'error');
            this.closeImportDialog();
        }
    };

    handleExport = async () => {
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        if (this.state.drawings.length === 0) {
            this.showLocalAlert(this.props.nls('noDrawingsToExport'), 'warning');
            return;
        }

        try {
            //console.log('Starting export process');

            const exportData = await this.generateCompatibleExportData(this.state.drawings);
            //console.log('Export data generated:', exportData);

            const jsonString = JSON.stringify(exportData.geoJSONFormat, null, 2);

            const blob = new Blob([jsonString], { type: 'application/geo+json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'myDrawings.geojson';
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            //console.log(`Successfully exported ${this.state.drawings.length} drawings as GeoJSON`);

        } catch (error) {
            console.error('Error exporting drawings:', error);
            this.showLocalAlert(this.props.nls('errorExportingDrawings'), 'error');
        }
    };

    handleExportWithFormat = async (format: 'geojson' | 'kml' | 'shapefile' | 'exb-draw') => {
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }
        if (this.state.drawings.length === 0) {
            this.showLocalAlert(this.props.nls('noDrawingsToExport'), 'warning');
            return;
        }
        try {
            let content: string | Blob;
            let mimeType: string;
            let extension: string;
            if (format === 'kml') {
                content = await this.generateKMLExport(this.state.drawings);
                mimeType = 'application/vnd.google-earth.kml+xml';
                extension = 'kml';
            } else if (format === 'shapefile') {
                content = await this.generateShapefileExport(this.state.drawings);
                mimeType = 'application/zip';
                extension = 'zip';
            } else if (format === 'exb-draw') {
                content = await this.generateExBDrawExport(this.state.drawings);
                mimeType = 'application/json';
                extension = 'json';
            } else {
                // GeoJSON format - include symbol information
                const exportData = await this.generateCompatibleExportData(this.state.drawings);
                content = JSON.stringify(exportData.geoJSONFormat, null, 2);
                mimeType = 'application/geo+json';
                extension = 'geojson';
            }
            // Create blob from content
            const blob = typeof content === 'string'
                ? new Blob([content], { type: mimeType })
                : content;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `myDrawings.${extension}`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
        } catch (error) {
            console.error('Error exporting drawings:', error);
            this.showLocalAlert(this.props.nls('errorExportingDrawingsAsFormat', { format: (format.toUpperCase()) }), 'error');
        }
    };

    handleExportSelectedWithFormat = async (format: 'geojson' | 'kml' | 'shapefile' | 'exb-draw') => {
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }
        if (this.state.selectedGraphics.size === 0) {
            this.showLocalAlert(this.props.nls('noDrawingsSelectedToExport'), 'warning');
            return;
        }
        try {
            const selectedDrawings = Array.from(this.state.selectedGraphics)
                .map(index => this.state.drawings[index])
                .filter(g => g != null);

            if (selectedDrawings.length === 0) {
                this.showLocalAlert(this.props.nls('noValidDrawingsSelected'), 'warning');
                return;
            }

            let content: string | Blob;
            let mimeType: string;
            let extension: string;

            if (format === 'kml') {
                content = await this.generateKMLExport(selectedDrawings);
                mimeType = 'application/vnd.google-earth.kml+xml';
                extension = 'kml';
            } else if (format === 'shapefile') {
                content = await this.generateShapefileExport(selectedDrawings);
                mimeType = 'application/zip';
                extension = 'zip';
            } else if (format === 'exb-draw') {
                content = await this.generateExBDrawExport(selectedDrawings);
                mimeType = 'application/json';
                extension = 'json';
            } else {
                // GeoJSON format - include symbol information
                const exportData = await this.generateCompatibleExportData(selectedDrawings);
                content = JSON.stringify(exportData.geoJSONFormat, null, 2);
                mimeType = 'application/geo+json';
                extension = 'geojson';
            }

            const blob = typeof content === 'string'
                ? new Blob([content], { type: mimeType })
                : content;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `selectedDrawings.${extension}`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
        } catch (error) {
            console.error('Error exporting selected drawings:', error);
            this.showLocalAlert(this.props.nls('errorExportingSelectedDrawingsAsFormat', { format: (format.toUpperCase()) }), 'error');
        }
    };

    handleExportSingleWithFormat = async (index: number, format: 'geojson' | 'kml' | 'shapefile' | 'exb-draw', event?: React.MouseEvent) => {
        if (event) {
            event.stopPropagation();
        }
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }
        try {
            const graphic = this.state.drawings[index];
            if (!graphic) {
                this.showLocalAlert('Drawing not found', 'error');
                return;
            }

            let content: string | Blob;
            let mimeType: string;
            let extension: string;
            const filename = graphic.attributes?.name || `drawing_${index + 1}`;

            if (format === 'kml') {
                content = await this.generateKMLExport([graphic]);
                mimeType = 'application/vnd.google-earth.kml+xml';
                extension = 'kml';
            } else if (format === 'shapefile') {
                content = await this.generateShapefileExport([graphic]);
                mimeType = 'application/zip';
                extension = 'zip';
            } else if (format === 'exb-draw') {
                content = await this.generateExBDrawExport([graphic]);
                mimeType = 'application/json';
                extension = 'json';
            } else {
                // GeoJSON format - include symbol information
                const exportData = await this.generateCompatibleExportData([graphic]);
                content = JSON.stringify(exportData.geoJSONFormat, null, 2);
                mimeType = 'application/geo+json';
                extension = 'geojson';
            }

            const blob = typeof content === 'string'
                ? new Blob([content], { type: mimeType })
                : content;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.${extension}`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
        } catch (error) {
            console.error('Error exporting drawing:', error);
            this.showLocalAlert(`Error exporting drawing as ${format.toUpperCase()}`, 'error');
        }
    };

    // Toggle selection for a specific drawing
    handleToggleSelect = (index: number, event: React.MouseEvent) => {
        // Stop propagation to prevent triggering the list item click
        event.stopPropagation();

        // Cancel any active SketchViewModel operation
        if (this.sketchViewModel) {
            this.sketchViewModel.cancel();
        }

        const { selectedGraphics } = this.state;
        const newSelected = new Set(selectedGraphics);

        if (newSelected.has(index)) {
            // Deselecting: remove from selection and also clear any overlay
            newSelected.delete(index);
            this.removePointTextOverlayByIndex(index); // ✅ Remove the orange selection halo
        } else {
            // Selecting: add to selection
            newSelected.add(index);
        }

        // Update the checkbox selection state
        this.setState({ selectedGraphics: newSelected });

        // If this is the only selected item, also set it as the selectedGraphicIndex for editing
        if (newSelected.size === 1 && newSelected.has(index)) {
            this.setState((prevState) => {
                const newCollapsed = new Set(prevState.collapsedDrawings);
                newCollapsed.delete(index);
                return { selectedGraphicIndex: index, collapsedDrawings: newCollapsed };
            });
        } else if (newSelected.size !== 1) {
            // Clear selectedGraphicIndex if it's not a single selection anymore
            this.setState({ selectedGraphicIndex: null });
        }
    };


    // Select/deselect all drawings
    handleToggleSelectAll = () => {
        const { drawings, selectedGraphics } = this.state;

        // If all are selected, clear the selection
        if (selectedGraphics.size === drawings.length) {
            this.setState({
                selectedGraphics: new Set<number>(),
                symbolEditingIndex: null
            });
        } else {
            // Otherwise, select all
            const allIndices = new Set<number>(drawings.map((_, index) => index));
            this.setState({ selectedGraphics: allIndices });
        }
    }

    // Export a single drawing
    handleExportSingle = async (index: number, event: React.MouseEvent) => {
        event.stopPropagation();

        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        const graphic = this.state.drawings[index] as ExtendedGraphic;
        if (!graphic) return;

        try {
            const exportData = await this.generateCompatibleExportData([graphic]);

            const jsonString = JSON.stringify(exportData.geoJSONFormat, null, 2);

            const fileName = graphic.attributes?.name
                ? `${graphic.attributes.name.replace(/\s+/g, '_')}.geojson`
                : `drawing_${index + 1}.geojson`;

            const blob = new Blob([jsonString], { type: 'application/geo+json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            //console.log(`Successfully exported single drawing "${fileName}" as GeoJSON`);

        } catch (error) {
            console.error('Error exporting single drawing:', error);
            this.showLocalAlert(this.props.nls('errorExportingSingleDrawing'), 'error');
        }
    };


    // 🔧 ENHANCED: Export selected drawings with buffer settings support
    handleExportSelected = async () => {
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        const { drawings, selectedGraphics } = this.state;

        if (selectedGraphics.size === 0) {
            this.showLocalAlert(this.props.nls('noDrawingsSelected'), 'warning');
            return;
        }

        try {
            const selectedDrawings = Array.from(selectedGraphics).map(index => drawings[index]);
            const exportData = await this.generateCompatibleExportData(selectedDrawings);

            const jsonString = JSON.stringify(exportData.geoJSONFormat, null, 2);

            const blob = new Blob([jsonString], { type: 'application/geo+json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `selected_drawings_${new Date().toISOString().split('T')[0]}.geojson`;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            //console.log(`Successfully exported ${selectedGraphics.size} selected drawings as GeoJSON`);

        } catch (error) {
            console.error('Error exporting selected drawings:', error);
            this.showLocalAlert(this.props.nls('errorExportingSelectedDrawings'), 'error');
        }
    };

    // Clear selected drawings (uncheck them AND clear map selections)
    handleClearSelected = async () => {
        // CRITICAL: More thorough SketchViewModel clearing for polygons and lines
        if (this.sketchViewModel) {
            try {
                // Step 1: Cancel any active operations
                this.sketchViewModel.cancel();

                // Step 2: Wait a moment for cancel to complete
                await new Promise(resolve => setTimeout(resolve, 50));

                // Step 3: IMPORTANT - Explicitly clear the updateGraphics collection
                // This is what keeps polygons/lines visually selected on the map
                if (this.sketchViewModel.updateGraphics) {
                    this.sketchViewModel.updateGraphics.removeAll();
                }

                // Step 4: Wait another moment for the collection to clear
                await new Promise(resolve => setTimeout(resolve, 50));

                // Step 5: Final cancel to ensure everything is cleared
                this.sketchViewModel.cancel();

            } catch (error) {
                console.warn('Error clearing SketchViewModel:', error);
            }
        }

        // Remove selection overlays from point/text graphics
        this.removeAllSelectionOverlays();

        // Extra cleanup: forcibly remove any lingering selection overlays from the graphicsLayer
        if (this.props.graphicsLayer?.graphics) {
            this.props.graphicsLayer.graphics.forEach(g => {
                if (g.attributes?.isSelectionOverlay) {
                    try {
                        this.props.graphicsLayer.remove(g);
                    } catch { }
                }
            });
        }

        // Clear parent component's selection overlays if callback exists
        if (this.props.onClearSelectionOverlays) {
            try {
                this.props.onClearSelectionOverlays();
            } catch (e) {
                console.warn('onClearSelectionOverlays callback failed:', e);
            }
        }

        // Clear all selection state
        this.setState({
            selectedGraphics: new Set<number>(),
            selectedGraphicIndex: null,
            symbolEditingIndex: null,
            editingGraphicIndex: null
        }, () => {
            // After state update, force a map refresh to ensure visual update
            setTimeout(() => {
                if (this.props.jimuMapView?.view) {
                    try {
                        // Force the view to refresh by triggering a minimal goTo
                        const currentCenter = this.props.jimuMapView.view.center?.clone();
                        const currentScale = this.props.jimuMapView.view.scale;

                        if (currentCenter) {
                            this.props.jimuMapView.view.goTo({
                                center: currentCenter,
                                scale: currentScale
                            }, {
                                animate: false,
                                duration: 0
                            }).catch(() => {
                                // Ignore goTo errors - this is just for visual refresh
                            });
                        }
                    } catch (error) {
                        console.warn('Error refreshing view after clear:', error);
                    }
                }
            }, 150); // Increased timeout to allow SketchViewModel to fully clear
        });

        // Remove visual selection styling from all list items
        document.querySelectorAll('.drawing-item').forEach(item => {
            item.classList.remove('selected-drawing');
        });
    };


    // Delete selected drawings
    handleDeleteSelected = () => {
        // Check consent
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        const { selectedGraphics, drawings } = this.state;

        if (selectedGraphics.size === 0) {
            this.showLocalAlert(this.props.nls('noDrawingsSelected'), 'warning');
            return;
        }

        // Check if any selected drawings are locked
        const lockedCount = Array.from(selectedGraphics).filter(idx => {
            const g = drawings[idx];
            return g && this.isDrawingLocked(g);
        }).length;
        if (lockedCount > 0) {
            this.showLocalAlert(`${lockedCount} selected drawing(s) are locked. Unlock them first.`, 'warning');
            return;
        }

        // If confirmation is required, show custom dialog
        if (this.props.confirmOnDelete !== false) {
            const deleteAction = () => {
                this.performDeleteSelected();
            };

            this.openConfirmDialog(
                `Are you sure you want to delete ${selectedGraphics.size} selected drawing(s)?`,
                'delete',
                deleteAction
            );
        } else {
            // If no confirmation needed, delete directly
            this.performDeleteSelected();
        }
    }

    public ingestDrawings = (incoming: any[]) => {
        // You can normalize if needed; here we just replace the list
        this.setState({
            drawings: Array.isArray(incoming) ? [...incoming] : [],
            selectedGraphicIndex: null,
            selectedGraphics: new Set<number>(),
            symbolEditingIndex: null
        });
    };

    // MyDrawingsPanel.tsx — REPLACE the whole method with this version
    performDeleteGraphic = (index: number) => {
        //console.log(`🗑️ Starting deletion of graphic at index ${index}`);

        // ✅ Capture original measurement state (proxy = any measurement labels present)
        this._measurementWasEnabled = false;
        try {
            if (this.props.graphicsLayer) {
                const graphics = this.props.graphicsLayer.graphics.toArray();
                this._measurementWasEnabled = graphics.some(g => g?.attributes?.isMeasurementLabel === true);
            }
        } catch (e) {
            console.warn('Could not infer measurement state from layer; defaulting to off.', e);
            this._measurementWasEnabled = false;
        }

        // 🔒 Temporarily disable measurements during deletion to prevent interference
        if (this.props.onMeasurementSystemControl) {
            //console.log('🛑 Temporarily disabling measurements for deletion');
            this.props.onMeasurementSystemControl(false);
        }

        // 🚩 Flag: deletion in progress (prevents listeners from reacting to our own changes)
        this._isDeletingGraphic = true;
        this.ignoreNextGraphicsUpdate = true;

        // 🎯 Target graphic
        const graphicToDelete = this.state.drawings[index];
        if (!graphicToDelete) {
            console.error(`❌ No graphic found at index ${index}`);
            this._isDeletingGraphic = false;
            this.ignoreNextGraphicsUpdate = false;

            // 🔁 Restore measurements ONLY if they were originally enabled
            if (this.props.onMeasurementSystemControl && this._measurementWasEnabled) {
                this.props.onMeasurementSystemControl(true);
            }
            return;
        }

        //console.log(`🎯 Target graphic:`, graphicToDelete.attributes?.name || `Drawing ${index + 1}`);

        try {
            // STEP 0: Proactively clear measurement artifacts on the target
            // (removes total/area/radius/segment labels & internal refs to avoid ghosts/races)
            try {
                this.removeMeasurementLabels(graphicToDelete);
            } catch (cleanErr) {
                console.warn('⚠️ Failed pre-clean of measurement labels before delete:', cleanErr);
            }

            // STEP 1: Ensure SketchViewModel isn't touching this graphic
            if (this.sketchViewModel) {
                //console.log(`🛑 Force canceling SketchViewModel operations`);

                const isBeingEdited = this.sketchViewModel.updateGraphics?.some(
                    g => g.attributes?.uniqueId === graphicToDelete.attributes?.uniqueId
                );

                // Always cancel to flush any latent edit handles
                this.sketchViewModel.cancel();

                // Clear any selection/editing state in our UI to prevent re-selection
                this.setState({ selectedGraphicIndex: null, symbolEditingIndex: null });

                // Wait a beat to allow SVM to fully release references
                setTimeout(() => {
                    // Continue with actual deletion once SVM is settled
                    this.continueDeleteGraphic(index, graphicToDelete);
                }, isBeingEdited ? 300 : 100);

                return; // exit; we'll resume in continueDeleteGraphic
            }

            // No SVM active → proceed immediately
            this.continueDeleteGraphic(index, graphicToDelete);

        } catch (error) {
            console.error('❌ Error starting deletion:', error);

            // Always clear flags on failure paths
            this._isDeletingGraphic = false;
            this.ignoreNextGraphicsUpdate = false;

            // 🔁 Restore measurement system ONLY if it was originally enabled
            if (this.props.onMeasurementSystemControl && this._measurementWasEnabled) {
                this.props.onMeasurementSystemControl(true);
            }

            this.showLocalAlert(this.props.nls('errorDeletingDrawing'), 'error');
        }
    };

    performDeleteSelected = () => {
        const { drawings, selectedGraphics } = this.state;

        if (selectedGraphics.size === 0) return;

        //console.log(`🗑️ Starting deletion of ${selectedGraphics.size} selected graphics`);

        // Set deletion flag to prevent interference
        this._isDeletingGraphic = true;

        try {
            // STEP 1: Force cancel any SketchViewModel operations
            if (this.sketchViewModel) {
                //console.log(`🛑 Canceling SketchViewModel before bulk deletion`);
                this.sketchViewModel.cancel();
            }

            // STEP 2: Clean up measurement labels for all selected drawings FIRST
            const selectedIndices = Array.from(selectedGraphics as Set<number>);
            //console.log(`🧹 Cleaning up measurement labels for ${selectedIndices.length} graphics`);

            selectedIndices.forEach(index => {
                const graphic = drawings[index];
                if (graphic) {
                    //console.log(`🧹 Cleaning measurements for: ${graphic.attributes?.name || `Drawing ${index + 1}`}`);
                    this.removeMeasurementLabels(graphic);

                    // Also remove drawing labels
                    if (graphic.drawingLabel) {
                        try {
                            this.props.graphicsLayer.remove(graphic.drawingLabel);
                        } catch (e) {
                            console.warn('Could not remove drawing label:', e);
                        }
                        graphic.drawingLabel = null;
                    }
                }
            });

            // STEP 3: Remove the actual drawing graphics from the layer
            // Sort indices in descending order to avoid index shifting issues
            const sortedIndices = selectedIndices.sort((a, b) => b - a);

            //console.log(`🗑️ Removing ${sortedIndices.length} graphics from layer`);

            // Mark that we're about to update the graphics layer
            this.ignoreNextGraphicsUpdate = true;

            for (const index of sortedIndices) {
                const graphic = drawings[index];
                if (!graphic) continue;

                const uniqueId = graphic.attributes?.uniqueId;
                //console.log(`🗑️ Removing graphic: ${graphic.attributes?.name || `Drawing ${index + 1}`} (${uniqueId})`);

                if (uniqueId) {
                    // Find the exact graphic in the layer by uniqueId (more reliable)
                    const layerGraphics = this.props.graphicsLayer.graphics.toArray();
                    const targetGraphic = layerGraphics.find(g =>
                        g.attributes?.uniqueId === uniqueId &&
                        !g.attributes?.isMeasurementLabel &&
                        !g.attributes?.hideFromList
                    );

                    if (targetGraphic) {
                        this.props.graphicsLayer.remove(targetGraphic);
                        //console.log(`✅ Removed graphic with uniqueId: ${uniqueId}`);
                    } else {
                        console.warn(`⚠️ Could not find graphic with uniqueId ${uniqueId} in layer`);
                        // Fallback: try to remove by reference
                        if (this.props.graphicsLayer.graphics.includes(graphic)) {
                            this.props.graphicsLayer.remove(graphic);
                            //console.log(`✅ Removed graphic by reference fallback`);
                        }
                    }
                } else {
                    // No uniqueId, use direct reference removal
                    if (this.props.graphicsLayer.graphics.includes(graphic)) {
                        this.props.graphicsLayer.remove(graphic);
                        //console.log(`✅ Removed graphic by direct reference`);
                    }
                }
            }

            // STEP 4: AUTOMATIC CLEANUP after bulk deletion
            setTimeout(() => {
                //console.log(`🧹 Running automatic orphan cleanup after bulk deletion`);
                this.cleanupOrphanedMeasurementLabels();
            }, 300);

            // STEP 5: Update state
            const updatedDrawings = drawings.filter((_, index) => !selectedGraphics.has(index));

            //console.log(`📊 Updating state: ${drawings.length} -> ${updatedDrawings.length} drawings`);

            this.setState({
                drawings: updatedDrawings,
                selectedGraphics: new Set<number>(),
                symbolEditingIndex: null,
                selectedGraphicIndex: null
            }, () => {
                //console.log(`✅ State updated - ${updatedDrawings.length} drawings remaining`);

                // Save to localStorage if consent granted
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }

                // Notify parent if needed
                if (this.props.onDrawingsUpdate) {
                    this.props.onDrawingsUpdate(updatedDrawings);
                }

                // Clear deletion flag
                this._isDeletingGraphic = false;

                // STEP 6: Final verification and cleanup
                setTimeout(() => {
                    this.verifyLayerState();
                    // Run final cleanup to ensure everything is clean
                    this.cleanupOrphanedMeasurementLabels();
                }, 500);
            });

            //console.log(`✅ Bulk deletion completed successfully`);

        } catch (error) {
            console.error('❌ Error deleting selected graphics:', error);
            this._isDeletingGraphic = false; // Always clear the flag
            this.showLocalAlert(this.props.nls('errorDeletingSelectedDrawings'), 'error');

            // Refresh from layer to ensure state is consistent
            //console.log(`🔄 Refreshing from layer due to error`);
            this.refreshDrawingsFromLayer();
        }
    };

    // ============================================================================
    // MERGE SELECTED DRAWINGS
    // ============================================================================

    handleMergeSelected = () => {
        const { selectedGraphics, drawings } = this.state;

        if (selectedGraphics.size < 2) {
            this.showLocalAlert(this.props.nls('selectAtLeast2DrawingsToMerge'), 'warning');
            return;
        }

        // Check locked
        const lockedCount = Array.from(selectedGraphics).filter(idx => {
            const g = drawings[idx];
            return g && this.isDrawingLocked(g);
        }).length;
        if (lockedCount > 0) {
            this.showLocalAlert(`${lockedCount} selected drawing(s) are locked. Unlock them first.`, 'warning');
            return;
        }

        // Gather selected graphics
        const selectedIndices = Array.from(selectedGraphics as Set<number>).sort((a, b) => a - b);
        const selectedDrawings = selectedIndices.map(i => drawings[i]).filter(Boolean);

        // Classify geometry types
        const geomCategories = new Map<string, ExtendedGraphic[]>();
        for (const d of selectedDrawings) {
            if (!d.geometry) continue;
            let cat = d.geometry.type; // point, polyline, polygon, extent, multipoint
            if (cat === 'extent') cat = 'polygon';
            if (!geomCategories.has(cat)) geomCategories.set(cat, []);
            geomCategories.get(cat)!.push(d);
        }

        if (geomCategories.size === 0) {
            this.showLocalAlert('Selected drawings have no geometry to merge.', 'warning');
            return;
        }

        if (geomCategories.size > 1) {
            const types = Array.from(geomCategories.keys()).join(', ');
            this.showLocalAlert(`Cannot merge mixed geometry types (${types}). Select drawings of the same type.`, 'warning');
            return;
        }

        // Show confirmation
        const mergeAction = () => this.performMergeSelected(selectedIndices, selectedDrawings);
        this.openConfirmDialog(
            this.props.nls('mergeCountSelectedDrawingsIntoOne', { count: (selectedDrawings.length) }),
            'delete', // reuse 'delete' type since there's no 'merge' type
            mergeAction
        );
    };

    private performMergeSelected = async (selectedIndices: number[], selectedDrawings: ExtendedGraphic[]) => {
        const { drawings } = this.state;
        const geomType = selectedDrawings[0].geometry.type === 'extent' ? 'polygon' : selectedDrawings[0].geometry.type;

        try {
            // Cancel sketch ops
            if (this.sketchViewModel) {
                try { this.sketchViewModel.cancel(); } catch { /* no-op */ }
            }

            this._isDeletingGraphic = true;
            this.ignoreNextGraphicsUpdate = true;

            let mergedGeometry: any | null = null;
            const geometries = selectedDrawings.map(d => d.geometry).filter(Boolean);

            if (geomType === 'polygon') {
                // Union polygons (handles extent→polygon too)
                const polygons = geometries.map(g => {
                    if (g.type === 'extent') {
                        return PolygonCompat.fromExtent(g as any);
                    }
                    return g as any;
                });
                const geometryEngine = null /* dynamic import removed */;
                // Combine rings from all polygons into a single multi-ring polygon
                const allRings: number[][][] = [];
                for (const poly of polygons) {
                    if (poly.rings) for (const ring of poly.rings) allRings.push(ring);
                }
                mergedGeometry = new Polygon({ rings: allRings, spatialReference: polygons[0].spatialReference });
            } else if (geomType === 'polyline') {
                // Combine all paths into a single polyline
                const allPaths: number[][][] = [];
                for (const g of geometries) {
                    const pl = g as any;
                    if (pl.paths) {
                        for (const path of pl.paths) {
                            allPaths.push(path);
                        }
                    }
                }
                mergedGeometry = new Polyline({
                    paths: allPaths,
                    spatialReference: geometries[0].spatialReference
                });
            } else if (geomType === 'point' || geomType === 'multipoint') {
                // Combine all points into a multipoint
                const allPoints: number[][] = [];
                for (const g of geometries) {
                    if (g.type === 'point') {
                        const pt = g as any;
                        allPoints.push([pt.x, pt.y]);
                    } else if (g.type === 'multipoint') {
                        const mp = g as any;
                        if (mp.points) {
                            for (const p of mp.points) {
                                allPoints.push(p);
                            }
                        }
                    }
                }
                mergedGeometry = new Multipoint({
                    points: allPoints,
                    spatialReference: geometries[0].spatialReference
                });
            }

            if (!mergedGeometry) {
                this.showLocalAlert(this.props.nls('mergeGeometryFailed'), 'error');
                this._isDeletingGraphic = false;
                this.ignoreNextGraphicsUpdate = false;
                return;
            }

            // Use the first drawing's symbol
            const firstDrawing = selectedDrawings[0];
            const mergedSymbol = firstDrawing.symbol ? (firstDrawing.symbol as any).clone() : null;

            // Determine draw mode for merged graphic
            const mergedDrawMode = geomType === 'polygon' ? 'polygon'
                : geomType === 'polyline' ? 'polyline'
                    : geomType === 'multipoint' ? 'multipoint'
                        : 'point';

            // Build merged name
            const names = selectedDrawings
                .map(d => d.attributes?.name)
                .filter(Boolean)
                .slice(0, 3);
            const mergedName = names.length > 0
                ? `Merged (${names.join(', ')}${selectedDrawings.length > 3 ? ', ...' : ''})`
                : `Merged ${mergedDrawMode}`;

            // STEP 1: Remove measurement labels for all selected
            for (const graphic of selectedDrawings) {
                this.removeMeasurementLabels(graphic);
                if (graphic.drawingLabel) {
                    try { this.props.graphicsLayer.remove(graphic.drawingLabel); } catch { /* no-op */ }
                    graphic.drawingLabel = null;
                }
            }

            // STEP 2: Remove originals from the graphics layer
            for (const graphic of selectedDrawings) {
                const uniqueId = graphic.attributes?.uniqueId;
                if (uniqueId) {
                    const layerGraphics = this.props.graphicsLayer.graphics.toArray();
                    const target = layerGraphics.find(g =>
                        g.attributes?.uniqueId === uniqueId &&
                        !g.attributes?.isMeasurementLabel &&
                        !g.attributes?.hideFromList
                    );
                    if (target) {
                        this.props.graphicsLayer.remove(target);
                    } else if (this.props.graphicsLayer.graphics.includes(graphic)) {
                        this.props.graphicsLayer.remove(graphic);
                    }
                } else if (this.props.graphicsLayer.graphics.includes(graphic)) {
                    this.props.graphicsLayer.remove(graphic);
                }
            }

            // STEP 3: Create the merged graphic
            const mergedGraphic = new Graphic({
                geometry: mergedGeometry,
                symbol: mergedSymbol,
                attributes: {
                    uniqueId: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    isDrawing: true,
                    hideFromList: false,
                    drawMode: mergedDrawMode,
                    createdDate: Date.now(),
                    name: mergedName,
                    mergedFrom: selectedDrawings.map(d => d.attributes?.uniqueId).filter(Boolean)
                }
            }) as ExtendedGraphic;

            // STEP 4: Add merged to layer
            this.props.graphicsLayer.add(mergedGraphic);

            // STEP 5: Update state — remove originals, add merged
            const selectedIndicesSet = new Set(selectedIndices);
            const updatedDrawings = drawings.filter((_, idx) => !selectedIndicesSet.has(idx));
            updatedDrawings.push(mergedGraphic);

            this.setState({
                drawings: updatedDrawings,
                selectedGraphics: new Set<number>([updatedDrawings.length - 1]),
                symbolEditingIndex: null,
                selectedGraphicIndex: updatedDrawings.length - 1
            }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
                if (this.props.onDrawingsUpdate) {
                    this.props.onDrawingsUpdate(updatedDrawings);
                }
                this._isDeletingGraphic = false;

                setTimeout(() => {
                    this.cleanupOrphanedMeasurementLabels();
                    this.verifyLayerState();
                }, 500);
            });

            this.showLocalAlert(`Merged ${selectedDrawings.length} drawings into "${mergedName}"`, 'success');

        } catch (error) {
            console.error('Error merging drawings:', error);
            this._isDeletingGraphic = false;
            this.ignoreNextGraphicsUpdate = false;
            this.showLocalAlert('Error merging drawings. Please try again.', 'error');
            this.refreshDrawingsFromLayer();
        }
    };

    handleSortOptionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        // Check consent
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        const value = e.target.value;

        // If user selects manual, just ensure flag is set
        if (value === 'manual') {
            //console.log('📌 User selected manual order');
            this.setState({ hasManualOrder: true });
            return;
        }

        const sortOption = value as 'name' | 'type' | 'created';

        //console.log(`📊 Switching to sort mode: ${sortOption}`);

        this.setState({ sortOption, hasManualOrder: false }, () => {
            // Sort the current drawings
            const sortedDrawings = this.sortGraphicsArray(this.state.drawings);
            this.setState({ drawings: sortedDrawings }, () => {
                // Sync graphics layer to match new sort order
                this.syncGraphicsLayerOrder();
            });
        });
    }

    startEditing = (index: number, event?: React.MouseEvent) => {
        // Check consent
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        // Block editing locked drawings
        const graphic = this.state.drawings[index];
        if (graphic && this.isDrawingLocked(graphic)) {
            this.showLocalAlert('This drawing is locked. Unlock it to rename.', 'warning');
            return;
        }

        // Stop event propagation if provided
        if (event) {
            event.stopPropagation();
        }

        this.setState({ editingGraphicIndex: index });
    }

    handleNameChange = (index: number, newName: string) => {
        // Debugging: Log input value to see if spaces are present
        //console.log('handleNameChange received:', newName, 'contains spaces:', newName.includes(' '));

        // Check consent
        if (this.state.consentGranted !== true) return;

        const updatedDrawings = [...this.state.drawings];
        const graphic = updatedDrawings[index];

        if (!graphic) return;

        // Ensure attributes object
        if (!graphic.attributes) {
            graphic.attributes = {};
        }

        // Update name attribute - add more debugging
        graphic.attributes.name = newName;
        //console.log('Set attributes.name to:', graphic.attributes.name);

        // REMOVED: Do not automatically update text symbol content when renaming
        // This allows users to have meaningful reference names that differ from displayed text
        // if (graphic.symbol?.type === 'text') {
        //     const textSymbol = graphic.symbol as TextSymbol;
        //     textSymbol.text = newName;
        //     //console.log('Updated text symbol to:', textSymbol.text);
        // }

        // Optional: reapply the graphic to the layer to reflect name change
        this.ignoreNextGraphicsUpdate = true;
        this.props.graphicsLayer.remove(graphic);
        this.props.graphicsLayer.add(graphic);

        // Update state and persist
        this.setState({ drawings: updatedDrawings }, () => {
            // Confirm value in the updated state
            const confirmedValue = this.state.drawings[index]?.attributes?.name;
            //console.log('Name in state after update:', confirmedValue);

            if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                this.debouncedSave();
            }

            // Update drawing labels if display is enabled
            this.updateAllDrawingLabels();
        });
    };


    saveNameEdit = () => {
        // Check consent
        if (this.state.consentGranted !== true || this.state.editingGraphicIndex === null) {
            if (this.state.consentGranted !== true) {
                this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            }
            return;
        }

        try {
            // Get the updated graphic
            const graphic = this.state.drawings[this.state.editingGraphicIndex];
            if (!graphic) return;

            // Mark that we're about to update the graphics layer
            this.ignoreNextGraphicsUpdate = true;

            // Update the graphic in the layer (remove and re-add to ensure update)
            this.props.graphicsLayer.remove(graphic);
            this.props.graphicsLayer.add(graphic);

            // Exit editing mode
            this.setState({ editingGraphicIndex: null }, () => {
                // Save to localStorage if consent granted
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });

            // Don't show alert - silently update
            // this.showLocalAlert('Name updated', 'success');
        } catch (error) {
            console.error('Error saving name edit:', error);

            // We'll still show an error if something goes wrong
            this.showLocalAlert(this.props.nls('errorUpdatingName'), 'error');

            // Exit editing mode
            this.setState({ editingGraphicIndex: null });
        }
    }

    cancelNameEdit = () => {
        this.setState({ editingGraphicIndex: null });
    }

    getDrawingTypeLabel = (graphic: ExtendedGraphic): string => {
        // Try to get the draw mode from attributes
        let drawMode = graphic.attributes?.drawMode;

        // If not found, try to get geometry type
        if (!drawMode) {
            const geomTypeAttr = graphic.attributes?.geometryType;

            if (['circle', 'rectangle', 'text'].includes(geomTypeAttr)) {
                drawMode = geomTypeAttr;
            }
            // Check if it's a text symbol
            else if (
                graphic.geometry?.type === 'point' &&
                graphic.symbol?.type === 'text'
            ) {
                drawMode = 'text';
            }
            // Otherwise, determine from geometry
            else {
                drawMode = graphic.geometry?.type;
            }
        }

        // Convert technical names to user-friendly labels
        switch (drawMode) {
            case 'point':
                return this.props.nls('SelectionToolPoint');
            case 'polyline':
                return this.props.nls('line');
            case 'polygon':
                return this.props.nls('drawModePolygon');
            case 'rectangle':
            case 'extent':
                return this.props.nls('rectangle');
            case 'circle':
                return this.props.nls('circle');
            case 'text':
                return this.props.nls('text');
            default:
                return drawMode?.charAt(0).toUpperCase() + drawMode?.slice(1) || 'Unknown';
        }
    }

    formatCreatedDate = (dateValue: number | string): string => {
        if (!dateValue) return '';

        // Handle both numeric timestamps and ISO date strings
        let date: Date;
        if (typeof dateValue === 'number') {
            date = new Date(dateValue);
        } else if (typeof dateValue === 'string') {
            // Try parsing as-is first (handles ISO strings, date strings, etc.)
            date = new Date(dateValue);
            // If that produced Invalid Date, try parsing as a number string
            if (isNaN(date.getTime())) {
                const num = Number(dateValue);
                date = !isNaN(num) ? new Date(num) : new Date(); // fallback to now
            }
        } else {
            date = new Date(); // fallback to now
        }

        // Final guard: if still invalid, use current date
        if (isNaN(date.getTime())) {
            date = new Date();
        }

        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    openSymbolEditor = (index: number, event?: React.MouseEvent | React.KeyboardEvent) => {
        if (this.state.consentGranted !== true) {
            this.showLocalAlert(this.props.nls('myDrawingsFeatureRequiresLocalStoragePermission'), 'warning');
            return;
        }

        if (event) event.stopPropagation();

        const graphic = this.state.drawings[index];

        // Block style editing for locked drawings
        if (graphic && this.isDrawingLocked(graphic)) {
            return;
        }
        if (!graphic) {
            console.warn(`No drawing found at index ${index}`);
            return;
        }

        // Only cancel if there's an active update operation
        // Don't cancel if we're just viewing/selecting - this prevents measurement loss
        if (this.sketchViewModel && this.sketchViewModel.state === 'active') {
            this.sketchViewModel.cancel();
        }

        // Specifically for text symbols, initialize additional text editing state
        if (graphic.symbol?.type === 'text') {
            const textSymbol = graphic.symbol as any;

            // 🔧 FIX: Get actual text content from the best available source
            let actualText = '';

            // Priority 1: Check if graphic.attributes.name contains real text (not an auto-generated ID)
            const attributeName = graphic.attributes?.name || '';
            const isAutoGeneratedName = attributeName.startsWith('g_') ||
                attributeName.startsWith('auto_') ||
                attributeName.startsWith('imported_') ||
                attributeName.startsWith('restored_') ||
                attributeName.startsWith('copy_') ||
                attributeName.match(/^[a-z]_\d+_[a-z0-9]+$/i); // Matches patterns like g_1234_abc123

            if (attributeName && !isAutoGeneratedName) {
                actualText = attributeName;
            }

            // Priority 2: Check symbol.text (if it's not an auto-generated ID)
            if (!actualText) {
                const symbolText = textSymbol.text || '';
                const isAutoGeneratedSymbolText = symbolText.startsWith('g_') ||
                    symbolText.startsWith('auto_') ||
                    symbolText.match(/^[a-z]_\d+_[a-z0-9]+$/i);

                if (symbolText && !isAutoGeneratedSymbolText) {
                    actualText = symbolText;
                }
            }

            // Priority 3: If still empty or is the default "Text", keep it as-is
            // (allow user to see "Text" so they know to change it)
            if (!actualText) {
                actualText = textSymbol.text || '';
            }

            // console.log('📝 Text Editor - Detected text content:', {
            //     attributeName,
            //     symbolText: textSymbol.text,
            //     actualText,
            //     isAutoGenerated: isAutoGeneratedName
            // });

            // Get symbol color as rgba string for the color picker
            const symbolColor = textSymbol.color ?
                this.convertColorToRgba(textSymbol.color) : 'rgba(0,0,0,1)';

            // Get halo color and settings
            const haloEnabled = textSymbol.haloSize !== null && textSymbol.haloSize > 0;
            const haloColor = textSymbol.haloColor ?
                this.convertColorToRgba(textSymbol.haloColor) : 'rgba(255,255,255,1)';
            const haloSize = textSymbol.haloSize || 1;

            // Get text alignment states
            const horizontalAlignment = textSymbol.horizontalAlignment || 'center';
            const verticalAlignment = textSymbol.verticalAlignment || 'middle';

            // Get font style settings - ensure we're getting the correct values
            const fontWeight = textSymbol.font?.weight || 'normal';
            const fontStyle = textSymbol.font?.style || 'normal';
            const fontDecoration = textSymbol.font?.decoration || 'none';
            const fontSize = textSymbol.font?.size || 12;
            const fontRotation = textSymbol.angle || 0;

            // Check if styling is active - be very explicit to ensure we set correct states
            const isBold = fontWeight === 'bold';
            const isItalic = fontStyle === 'italic';
            const isUnderline = fontDecoration === 'underline';

            // Update state with all text properties
            this.setState({
                symbolEditingIndex: index,
                textValue: actualText,  // 🔧 Use actualText instead of textSymbol.text directly
                // Text properties
                fontColor: symbolColor,
                fontSize: fontSize,
                fontFamily: textSymbol.font?.family || 'Arial',
                fontRotation: fontRotation,
                // Opacity values (from alpha channel)
                fontOpacity: textSymbol.color?.a || 1,
                // Halo settings
                fontHaloEnabled: haloEnabled,
                fontHaloColor: haloColor,
                fontHaloSize: haloSize,
                fontHaloOpacity: textSymbol.haloColor?.a || 1,
                // Alignment settings
                horizontalAlignment: horizontalAlignment,
                verticalAlignment: verticalAlignment,
                // Font style settings
                fontWeight: fontWeight,
                fontStyle: fontStyle,
                fontDecoration: fontDecoration,
                // Button active states - be very explicit
                hAlignLeftActive: horizontalAlignment === 'left',
                hAlignCenterActive: horizontalAlignment === 'center',
                hAlignRightActive: horizontalAlignment === 'right',
                vAlignBaseActive: verticalAlignment === 'baseline',
                vAlignTopActive: verticalAlignment === 'top',
                vAlignMidActive: verticalAlignment === 'middle',
                vAlignBotActive: verticalAlignment === 'bottom',
                fsBoldActive: isBold,
                fsItalicActive: isItalic,
                fsUnderlineActive: isUnderline,
                // Also add these boolean state values for the actual styling
                isBold: isBold,
                isItalic: isItalic,
                isUnderline: isUnderline
            });
        } else {
            // For non-text symbols, just open the standard symbol editor
            this.setState({
                symbolEditingIndex: index,
                textValue: ''
            });
        }
    };

    applyTextChangesExplicitly = (index: number) => {
        const graphic = this.state.drawings[index];
        if (!graphic || !graphic.symbol || graphic.symbol.type !== 'text') return;

        try {
            // Clone the original symbol
            const originalSymbol = graphic.symbol as any;
            const textSymbol = originalSymbol.clone();

            // Clone and apply font settings
            const currentFont = textSymbol.font?.clone() || new Font();
            currentFont.family = this.state.fontFamily || 'Arial';
            currentFont.size = this.state.fontSize || 12;
            currentFont.weight = this.state.isBold ? 'bold' : 'normal';
            currentFont.style = this.state.isItalic ? 'italic' : 'normal';
            currentFont.decoration = this.state.isUnderline ? 'underline' : 'none';
            textSymbol.font = currentFont;

            // Update other text properties
            textSymbol.text = this.state.textValue;
            textSymbol.color = this.hexToRgba(
                this.rgbaToHex(this.state.fontColor),
                this.state.fontOpacity
            );
            textSymbol.horizontalAlignment = this.state.horizontalAlignment || 'center';
            textSymbol.verticalAlignment = this.state.verticalAlignment || 'middle';
            textSymbol.angle = this.state.fontRotation ?? 0;

            // Halo settings
            if (this.state.fontHaloEnabled) {
                textSymbol.haloSize = this.state.fontHaloSize;
                textSymbol.haloColor = this.hexToRgba(
                    this.rgbaToHex(this.state.fontHaloColor),
                    this.state.fontHaloOpacity
                );
            } else {
                textSymbol.haloSize = 0;
                textSymbol.haloColor = null;
            }

            // Clone and update the graphic
            const updatedGraphic = graphic.clone();
            updatedGraphic.symbol = textSymbol;

            // Replace graphic in layer while preserving draw order
            this.ignoreNextGraphicsUpdate = true;
            const graphicIndex = this.props.graphicsLayer.graphics.indexOf(graphic);
            this.props.graphicsLayer.remove(graphic);

            setTimeout(() => {
                // Add back and reorder to original position to preserve draw order
                this.props.graphicsLayer.add(updatedGraphic);
                this.props.graphicsLayer.graphics.reorder(updatedGraphic, graphicIndex);

                // Nudge the view to force refresh
                if (this.props.jimuMapView?.view) {
                    const currentCenter = this.props.jimuMapView.view.center.clone();
                    this.props.jimuMapView.view.goTo(currentCenter, { duration: 0 });
                }

                // Re-enable editing
                if (this.sketchViewModel?.updateGraphics) {
                    this.sketchViewModel.cancel();
                    setTimeout(() => {
                        // Preserve graphics order during re-selection
                        this.preserveGraphicsOrder(() => {
                            this._isSelectingGraphic = true;
                            this.sketchViewModel.update([updatedGraphic]);
                            // Clear flag after a delay
                            setTimeout(() => {
                                this._isSelectingGraphic = false;
                            }, 300);
                        });
                    }, 50);
                }

                // Persist to local storage
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }

                // Clear editor state and close style editor
                this.setState({
                    symbolEditingIndex: null,
                    selectedGraphicIndex: null,
                    selectedGraphics: new Set()
                });

                //console.log('Changes applied successfully, map updated, and editor closed');
            }, 50);
        } catch (error) {
            console.error('Error applying text changes:', error);
            this.showLocalAlert(this.props.nls('errorApplyingChanges'), 'error');
            this.setState({
                symbolEditingIndex: null,
                selectedGraphicIndex: null,
                selectedGraphics: new Set()
            });
        }
    };


    // Helper method to convert ArcGIS Color to RGBA string
    convertColorToRgba = (color: any): string => {
        if (!color) return 'rgba(0,0,0,1)';

        // Use toRgba() if available
        if (typeof color.toRgba === 'function') {
            const rgba = color.toRgba();
            return `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3]})`;
        }

        // Fallback in case toRgba is not available
        return `rgba(${color.r || 0},${color.g || 0},${color.b || 0},${color.a || 1})`;
    };

    // Convert rgba string to hex color
    rgbaToHex = (rgba) => {
        // Handle potential errors with rgba format
        if (!rgba || typeof rgba !== 'string') {
            return 'var(--calcite-color-text-1, #000000)'; // Default to black
        }

        // Extract RGBA values
        const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) {
            return 'var(--calcite-color-text-1, #000000)'; // Default to black if format doesn't match
        }

        // Convert to hex
        const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
        const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
        const b = parseInt(match[3], 10).toString(16).padStart(2, '0');

        return `#${r}${g}${b}`;
    };

    // Convert hex color to rgba
    hexToRgba = (hex, alpha = 1) => {
        // Remove # if present
        hex = hex.replace('#', '');

        // Parse the hex values
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        // Create RGBA color object
        return new Color([r, g, b, alpha]);
    };


    applyTextChanges = (originalGraphic: ExtendedGraphic) => {
        if (!originalGraphic || !this.props.graphicsLayer) return;

        try {
            // Create a clone of the graphic to avoid modifying shared references
            const graphic = originalGraphic.clone();

            // Apply the changes immediately to the map while preserving draw order
            this.ignoreNextGraphicsUpdate = true;

            // First remove and then re-add the graphic and reorder to preserve draw order
            const graphicIndex = this.props.graphicsLayer.graphics.indexOf(originalGraphic);
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);
            this.props.graphicsLayer.graphics.reorder(graphic, graphicIndex);

            // If we're in edit mode with SketchViewModel, update it too
            if (this.sketchViewModel && this.sketchViewModel.updateGraphics) {
                const isBeingEdited = this.sketchViewModel.updateGraphics.some(g =>
                    g.attributes?.uniqueId === graphic.attributes?.uniqueId
                );

                if (isBeingEdited) {
                    // Cancel current edit operation and restart with updated graphic
                    this.sketchViewModel.cancel();
                    // Preserve graphics order during re-selection
                    this.preserveGraphicsOrder(() => {
                        this._isSelectingGraphic = true;
                        this.sketchViewModel.update([graphic]);
                        // Clear flag after a delay
                        setTimeout(() => {
                            this._isSelectingGraphic = false;
                        }, 300);
                    });
                }
            }

            return graphic; // Return the new graphic for potential further use
        } catch (error) {
            console.error('Error applying text changes:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingText'), 'error');
            return null;
        }
    };

    // Update each method to call applyTextChanges after modifying the text symbol

    updateTextValue = (value: string, index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];

        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Update the text symbol and attributes
            textSymbol.text = value;

            if (!graphic.attributes) {
                graphic.attributes = {};
            }
            graphic.attributes.name = value;

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Update component state and persist
            this.setState({ drawings, textValue: value }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }

                // 🔄 FIXED: Call parent's onDrawingsUpdate prop
                //console.log('📝 MyDrawingsPanel: Text updated, triggering measurement refresh');
                if (this.props.onDrawingsUpdate) {
                    this.props.onDrawingsUpdate(drawings);
                }

                // Update drawing labels if display is enabled
                this.updateAllDrawingLabels();
            });
        } catch (error) {
            console.error('Error updating text value:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingText'), 'error');
        }
    };

    updateFontSize = (size: number, index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];
        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Create a new Font object with updated size
            const font = textSymbol.font ? textSymbol.font.clone() : new Font({});
            font.size = size;

            // Assign the new font to the symbol
            textSymbol.font = font;

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Update state and persist
            this.setState({
                drawings,
                fontSize: size
            }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }

                // 🔄 FIXED: Call parent's onDrawingsUpdate prop to trigger measurement refresh
                //console.log('📏 MyDrawingsPanel: Font size updated, triggering measurement refresh');
                if (this.props.onDrawingsUpdate) {
                    this.props.onDrawingsUpdate(drawings);
                }
            });
        } catch (error) {
            console.error('Error updating font size:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingTextSize'), 'error');
        }
    };



    updateFontFamily = (family: string, index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];

        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Create a new Font object with updated family
            const font = textSymbol.font ? textSymbol.font.clone() : new Font({});
            font.family = family;

            // Assign the new font to the symbol
            textSymbol.font = font;

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Update state and persist
            this.setState({
                drawings,
                fontFamily: family
            }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error updating font family:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingTextFont'), 'error');
        }
    };

    updateFontColor = (color: any, index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];

        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Create a new Color object to ensure no shared references
            textSymbol.color = color.clone ? color.clone() : new Color(color.toRgba ? color.toRgba() : color);

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Convert the color to rgba string for state
            const rgba = `rgba(${color.r},${color.g},${color.b},${color.a})`;

            // Update state and persist
            this.setState({
                drawings,
                fontColor: rgba,
                fontOpacity: color.a || 1
            }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error updating font color:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingTextColor'), 'error');
        }
    };

    updateFontOpacity = (opacity: number, index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];

        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Update opacity while preserving color
            if (textSymbol.color) {
                // Create a new Color object with the updated opacity
                const rgbaValues = textSymbol.color.toRgba ? textSymbol.color.toRgba() : [0, 0, 0, opacity];
                rgbaValues[3] = opacity; // Set alpha value
                textSymbol.color = new Color(rgbaValues);
            }

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Convert color for state
            const rgba = textSymbol.color ?
                `rgba(${textSymbol.color.r},${textSymbol.color.g},${textSymbol.color.b},${opacity})` :
                `rgba(0,0,0,${opacity})`;

            // Update state and persist
            this.setState({
                drawings,
                fontOpacity: opacity,
                fontColor: rgba
            }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error updating font opacity:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingTextOpacity'), 'error');
        }
    };

    updateFontRotation = (rotation: number, index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];

        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Update rotation
            textSymbol.angle = rotation;

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Update state and persist
            this.setState({
                drawings,
                fontRotation: rotation
            }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error updating font rotation:', error);
            this.showLocalAlert('Error updating text rotation', 'error');
        }
    };

    // Font style methods (bold, italic, underline)
    toggleFontStyle = (styleType: 'bold' | 'italic' | 'underline', index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];

        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Create a new Font object to avoid modifying shared references
            const font = textSymbol.font ? textSymbol.font.clone() : new Font({});

            // Update the font style based on the styleType
            switch (styleType) {
                case 'bold':
                    const isBold = font.weight !== 'bold';
                    font.weight = isBold ? 'bold' : 'normal';
                    this.setState({
                        fsBoldActive: isBold,
                        isBold: isBold
                    });
                    break;
                case 'italic':
                    const isItalic = font.style !== 'italic';
                    font.style = isItalic ? 'italic' : 'normal';
                    this.setState({
                        fsItalicActive: isItalic,
                        isItalic: isItalic
                    });
                    break;
                case 'underline':
                    const isUnderline = font.decoration !== 'underline';
                    font.decoration = isUnderline ? 'underline' : 'none';
                    this.setState({
                        fsUnderlineActive: isUnderline,
                        isUnderline: isUnderline
                    });
                    break;
            }

            // Assign the new font to the symbol
            textSymbol.font = font;

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Update state and persist
            this.setState({ drawings }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error updating font style:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingTextStyle'), 'error');
        }
    };

    // Horizontal alignment method
    updateHorizontalAlignment = (alignment: 'left' | 'center' | 'right', index: number) => {
        //console.log(`Updating horizontal alignment to ${alignment} for drawing at index ${index}`);

        // Validate inputs
        if (index === undefined || index === null) {
            console.error('Invalid index provided to updateHorizontalAlignment');
            return;
        }

        // Get a copy of the drawings array
        const drawings = [...this.state.drawings];

        // Check if the graphic exists at the given index
        if (!drawings[index]) {
            console.error(`No drawing found at index ${index}`);
            return;
        }

        const originalGraphic = drawings[index];

        // Validate the graphic has a text symbol
        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') {
            console.error('Cannot update horizontal alignment: graphic has no text symbol');
            return;
        }

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Log current state before changes
            //console.log('Current symbol state:', {
            //     horizontalAlignment: textSymbol.horizontalAlignment,
            //     text: textSymbol.text,
            //     hasSymbol: !!textSymbol
            // });


            // Update horizontal alignment
            textSymbol.horizontalAlignment = alignment;

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Update state with new alignment and button states
            this.setState({
                drawings,
                horizontalAlignment: alignment,
                hAlignLeftActive: alignment === 'left',
                hAlignCenterActive: alignment === 'center',
                hAlignRightActive: alignment === 'right'
            }, () => {
                // Log updated state
                //console.log('Horizontal alignment updated successfully:', {
                //     alignment,
                //     buttonStates: {
                //         left: this.state.hAlignLeftActive,
                //         center: this.state.hAlignCenterActive,
                //         right: this.state.hAlignRightActive
                //     }
                // });


                // Save to localStorage if enabled and consent granted
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error updating horizontal alignment:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingTextAlignment'), 'error');
        }
    };

    // Vertical alignment method
    updateVerticalAlignment = (alignment: 'baseline' | 'top' | 'middle' | 'bottom', index: number) => {
        //console.log(`Updating vertical alignment to ${alignment} for drawing at index ${index}`);

        // Validate inputs
        if (index === undefined || index === null) {
            console.error('Invalid index provided to updateVerticalAlignment');
            return;
        }

        // Get a copy of the drawings array
        const drawings = [...this.state.drawings];

        // Check if the graphic exists at the given index
        if (!drawings[index]) {
            console.error(`No drawing found at index ${index}`);
            return;
        }

        const originalGraphic = drawings[index];

        // Validate the graphic has a text symbol
        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') {
            console.error('Cannot update vertical alignment: graphic has no text symbol');
            return;
        }

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Log current state before changes
            //console.log('Current symbol state:', {
            //     verticalAlignment: textSymbol.verticalAlignment,
            //     text: textSymbol.text,
            //     hasSymbol: !!textSymbol
            // });


            // Update vertical alignment
            textSymbol.verticalAlignment = alignment;

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Update state with new alignment and button states
            this.setState({
                drawings,
                verticalAlignment: alignment,
                vAlignBaseActive: alignment === 'baseline',
                vAlignTopActive: alignment === 'top',
                vAlignMidActive: alignment === 'middle',
                vAlignBotActive: alignment === 'bottom'
            }, () => {
                /*
                    // Log updated state
                    //console.log('Vertical alignment updated successfully:', {
                        alignment,
                        buttonStates: {
                            baseline: this.state.vAlignBaseActive,
                            top: this.state.vAlignTopActive,
                            middle: this.state.vAlignMidActive,
                            bottom: this.state.vAlignBotActive
                        }
                    });
                */


                // Save to localStorage if enabled and consent granted
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error updating vertical alignment:', error);
            this.showLocalAlert(this.props.nls('errorUpdatingTextAlignment'), 'error');
        }
    };

    // Halo methods
    toggleHaloEnabled = (enabled: boolean, index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];
        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            if (enabled) {
                // Enable halo with default values if not set
                textSymbol.haloSize = this.state.fontHaloSize || 1;

                // Create a new Color object for halo
                const haloColor = this.state.fontHaloColor || 'rgba(255,255,255,1)';
                const colorMatch = haloColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);

                if (colorMatch) {
                    const r = parseInt(colorMatch[1], 10);
                    const g = parseInt(colorMatch[2], 10);
                    const b = parseInt(colorMatch[3], 10);
                    const a = colorMatch[4] ? parseFloat(colorMatch[4]) : 1;
                    textSymbol.haloColor = new Color([r, g, b, a]);
                } else {
                    textSymbol.haloColor = new Color([255, 255, 255, 1]);
                }
            } else {
                // Disable halo
                textSymbol.haloSize = 0;
                textSymbol.haloColor = null;
            }

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Update state and persist - remove fontHalo since it's not in your state interface
            this.setState({
                drawings,
                fontHaloEnabled: enabled
                // Remove fontHalo property since it's not in your state type
            }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error toggling halo:', error);
            this.showLocalAlert('Error updating text halo', 'error');
        }
    };

    updateHaloSize = (size: number, index: number) => {
        const drawings = [...this.state.drawings];
        const graphic = drawings[index];

        if (!graphic || !graphic.symbol || graphic.symbol.type !== 'text') return;

        const textSymbol = graphic.symbol as any;

        // Update halo size
        textSymbol.haloSize = size;

        // Ensure halo color is set if size is set
        if (size > 0 && !textSymbol.haloColor) {
            textSymbol.haloColor = new Color([255, 255, 255, 1]);
        }

        // Apply changes immediately
        this.applyTextChanges(graphic);

        // Update state
        this.setState({
            drawings,
            fontHaloSize: size,
            fontHaloEnabled: size > 0
        }, () => {
            if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                this.debouncedSave();
            }
        });
    };

    updateHaloColor = (color: any, index: number) => {
        const drawings = [...this.state.drawings];
        const graphic = drawings[index];

        if (!graphic || !graphic.symbol || graphic.symbol.type !== 'text') return;

        const textSymbol = graphic.symbol as any;

        // Update halo color
        textSymbol.haloColor = color;

        // Ensure halo size is set if color is set
        if (!textSymbol.haloSize || textSymbol.haloSize <= 0) {
            textSymbol.haloSize = 1;
        }

        // Apply changes immediately
        this.applyTextChanges(graphic);

        // Convert color for state
        const rgba = `rgba(${color.r},${color.g},${color.b},${color.a})`;

        // Update state
        this.setState({
            drawings,
            fontHaloColor: rgba,
            fontHaloOpacity: color.a || 1,
            fontHaloEnabled: true
        }, () => {
            if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                this.debouncedSave();
            }
        });
    };

    updateHaloOpacity = (opacity: number, index: number) => {
        const drawings = [...this.state.drawings];
        const originalGraphic = drawings[index];
        if (!originalGraphic || !originalGraphic.symbol || originalGraphic.symbol.type !== 'text') return;

        try {
            // Clone the graphic and symbol
            const graphic = originalGraphic.clone();
            const textSymbol = graphic.symbol.clone() as any;

            // Update opacity while preserving halo color
            if (textSymbol.haloColor) {
                // Create a new Color object with the updated opacity
                const rgbaValues = textSymbol.haloColor.toRgba ? textSymbol.haloColor.toRgba() : [255, 255, 255, opacity];
                rgbaValues[3] = opacity; // Set alpha value
                textSymbol.haloColor = new Color(rgbaValues);
            } else if (this.state.fontHaloEnabled) {
                // Create a new halo color if not present but enabled
                textSymbol.haloColor = new Color([255, 255, 255, opacity]);
            }

            // Apply the updated symbol to the graphic
            graphic.symbol = textSymbol;

            // Update in the layer
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update in state
            drawings[index] = graphic;

            // Convert color for state
            const rgba = textSymbol.haloColor ?
                `rgba(${textSymbol.haloColor.r},${textSymbol.haloColor.g},${textSymbol.haloColor.b},${opacity})` :
                `rgba(255,255,255,${opacity})`;

            // Update state and persist - removed fontHalo property to fix TypeScript error
            this.setState({
                drawings,
                fontHaloOpacity: opacity,
                fontHaloColor: rgba
                // Removed fontHalo property which is causing TS error
            }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (error) {
            console.error('Error updating halo opacity:', error);
            this.showLocalAlert('Error updating text halo opacity', 'error');
        }
    };

    closeSymbolEditor = () => {
        this.setState({ symbolEditingIndex: null });
    };

    updateSymbol = (symbol: any, index: number) => {
        // Cancel any active SketchViewModel operation
        if (this.sketchViewModel) {
            this.sketchViewModel.cancel();
        }

        const drawings = [...this.state.drawings];

        // Validate drawing index
        if (!drawings[index]) {
            console.warn(`No drawing found at index ${index} in updateSymbol`);
            return;
        }

        const originalGraphic = drawings[index];

        try {
            // Create a clone of the graphic to avoid modifying shared references
            const graphic = originalGraphic.clone();

            // Clone the incoming symbol if it exists
            let finalSymbol = symbol ? symbol.clone() : null;

            // Handle polyline: enforce SimpleLineSymbol
            if (graphic.geometry?.type === 'polyline') {
                if (!finalSymbol || finalSymbol.type !== 'simple-line') {
                    finalSymbol = new SimpleLineSymbol({
                        color: finalSymbol?.color || [0, 0, 0, 1],
                        width: finalSymbol?.width || 2,
                        style: finalSymbol?.style || 'solid'
                    });
                }
            }

            // Handle text: ensure TextSymbol has required props
            if (finalSymbol?.type === 'text') {
                const textSymbol = finalSymbol as TextSymbol;

                if (!textSymbol.color) {
                    textSymbol.color = new Color([0, 0, 0, 1]);
                }

                if (!textSymbol.font) {
                    textSymbol.font = new Font({ size: 12 });
                } else {
                    // Ensure required font fields exist with a new Font object
                    textSymbol.font = new Font({
                        family: textSymbol.font.family || 'Arial',
                        size: textSymbol.font.size || 12,
                        style: textSymbol.font.style || 'normal',
                        weight: textSymbol.font.weight || 'normal',
                        decoration: textSymbol.font.decoration || 'none'
                    });
                }

                if (!textSymbol.text) {
                    textSymbol.text = graphic.attributes?.name || 'Label';
                }

                // Keep the drawing list name in sync with the text on the map.
                if (textSymbol.text && textSymbol.text.trim()) {
                    if (!graphic.attributes) graphic.attributes = {};
                    graphic.attributes.name = textSymbol.text.trim();
                }

                finalSymbol = textSymbol;
            }

            // Assign the final symbol to the graphic clone
            graphic.symbol = finalSymbol;

            // Update the array in state
            drawings[index] = graphic;

            // Update the graphics layer without triggering a watch event
            this.ignoreNextGraphicsUpdate = true;
            this.props.graphicsLayer.remove(originalGraphic);
            this.props.graphicsLayer.add(graphic);

            // Update state and persist to localStorage
            this.setState({ drawings }, () => {
                if ((this.props.allowLocalStorage !== false) && this.state.consentGranted === true) {
                    this.debouncedSave();
                }
            });
        } catch (err) {
            console.error('Failed to update symbol:', err);
            this.showLocalAlert(this.props.nls('errorUpdatingSymbol'), 'error');
        }
    };

    // Generate thumbnail
    private genThumb = async (g: any): Promise<void> => {
        if (!g?.attributes) return;
        if (!g.attributes._tid) g.attributes._tid = `t${Date.now()}${Math.random().toString(36).substr(2, 6)}`;
        const id = g.attributes._tid;
        if (this.state.thumbGens?.has(id)) return;
        this.setState(p => ({ thumbGens: new Set(p.thumbGens).add(id) }));
        try {
            const u = await genThumb(g, this.props.jimuMapView);
            if (u) {
                g.attributes.thumb = u;
                this.setState(p => {
                    const c = new Map(p.thumbCache); c.set(id, u);
                    const gs = new Set(p.thumbGens); gs.delete(id);
                    return { thumbCache: c, thumbGens: gs };
                });
            } else {
                this.setState(p => { const gs = new Set(p.thumbGens); gs.delete(id); return { thumbGens: gs }; });
            }
        } catch { this.setState(p => { const gs = new Set(p.thumbGens); gs.delete(id); return { thumbGens: gs }; }); }
    };

    // Get thumbnail
    private getThumb = (g: any): string => {
        if (!g?.attributes) return '';
        const id = g.attributes._tid;
        if (id && this.state.thumbCache?.has(id)) return this.state.thumbCache.get(id) || '';
        return g.attributes.thumb || '';
    };

    // ========================================================================
    // ⚡ PERFORMANCE: Helper Methods
    // ========================================================================

    private clearCachedMeasurements = () => {
        this.cachedMeasurements = new WeakMap();
    };

    private handleResize = () => {
        this.clearCachedMeasurements();
    };

    private getCachedThumbnail = async (
        graphic: ExtendedGraphic
    ): Promise<string | null> => {
        const cacheKey = graphic.attributes?.uniqueId || (graphic as any).uid;

        if (!cacheKey) {
            return genThumb(graphic, this.props.jimuMapView);
        }

        if (this.thumbnailCache.has(cacheKey)) {
            return this.thumbnailCache.get(cacheKey)!;
        }

        const thumbnail = await genThumb(graphic, this.props.jimuMapView);

        if (thumbnail) {
            this.thumbnailCache.set(cacheKey, thumbnail);

            if (this.thumbnailCache.size > this.MAX_CACHE_SIZE) {
                const firstKey = this.thumbnailCache.keys().next().value;
                this.thumbnailCache.delete(firstKey);
            }
        }

        return thumbnail;
    };

    private updateGraphicThumbnail = (index: number, thumbnail: string) => {
        this.setState(prevState => {
            const updatedDrawings = [...prevState.drawings];
            if (updatedDrawings[index]) {
                (updatedDrawings[index] as any).thumbnail = thumbnail;
            }
            return { drawings: updatedDrawings };
        });
    };

    private updateGraphicsLayerBatched = () => {
        if (!this.props.graphicsLayer) return;

        if (!this.graphicsUpdatePending) {
            this.graphicsUpdatePending = true;

            this.animationFrameId = requestAnimationFrame(() => {
                try {
                    const visibleGraphics = this.state.drawings.filter((d: any) => !d.hidden);
                    this.props.graphicsLayer.removeAll();
                    this.props.graphicsLayer.addMany(visibleGraphics);
                } catch (error) {
                    console.error('Error updating graphics layer:', error);
                } finally {
                    this.graphicsUpdatePending = false;
                    this.animationFrameId = null;
                }
            });
        }
    };

    private scheduleGraphicsUpdate = () => {
        this.debouncedGraphicsUpdate();
    };

    // ========================================================================
    // ⚡ PERFORMANCE: Optimized Dialog Drag Handlers
    // ========================================================================

    handleNotesDialogMouseDown = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, textarea, input, select')) {
            return;
        }

        this.notesDragState.isDragging = true;
        this.notesDragState.startX = e.clientX;
        this.notesDragState.startY = e.clientY;
        this.notesDragState.initialX = (this.state as any).notesDialogLeft || 0;
        this.notesDragState.initialY = (this.state as any).notesDialogTop || 0;

        document.addEventListener('mousemove', this.handleNotesDialogMouseMove);
        document.addEventListener('mouseup', this.handleNotesDialogMouseUp, { passive: true } as any);

        e.preventDefault();
    };

    handleNotesDialogMouseMove = (e: MouseEvent) => {
        if (!this.notesDragState.isDragging) return;

        requestAnimationFrame(() => {
            const deltaX = e.clientX - this.notesDragState.startX;
            const deltaY = e.clientY - this.notesDragState.startY;

            this.setState({
                notesDialogLeft: this.notesDragState.initialX + deltaX,
                notesDialogTop: this.notesDragState.initialY + deltaY
            } as any);
        });
    };

    handleNotesDialogMouseUp = () => {
        this.notesDragState.isDragging = false;
        document.removeEventListener('mousemove', this.handleNotesDialogMouseMove);
        document.removeEventListener('mouseup', this.handleNotesDialogMouseUp);
    };

    handleTextStyleDialogMouseDown = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, textarea, input, select')) {
            return;
        }

        this.textStyleDragState.isDragging = true;
        this.textStyleDragState.startX = e.clientX;
        this.textStyleDragState.startY = e.clientY;
        this.textStyleDragState.initialX = (this.state as any).textStyleDialogLeft || 0;
        this.textStyleDragState.initialY = (this.state as any).textStyleDialogTop || 0;

        document.addEventListener('mousemove', this.handleTextStyleDialogMouseMove);
        document.addEventListener('mouseup', this.handleTextStyleDialogMouseUp, { passive: true } as any);

        e.preventDefault();
    };

    handleTextStyleDialogMouseMove = (e: MouseEvent) => {
        if (!this.textStyleDragState.isDragging) return;

        requestAnimationFrame(() => {
            const deltaX = e.clientX - this.textStyleDragState.startX;
            const deltaY = e.clientY - this.textStyleDragState.startY;

            this.setState({
                textStyleDialogLeft: this.textStyleDragState.initialX + deltaX,
                textStyleDialogTop: this.textStyleDragState.initialY + deltaY
            } as any);
        });
    };

    handleTextStyleDialogMouseUp = () => {
        this.textStyleDragState.isDragging = false;
        document.removeEventListener('mousemove', this.handleTextStyleDialogMouseMove);
        document.removeEventListener('mouseup', this.handleTextStyleDialogMouseUp);
    };



    render() {
        const {
            drawings, selectedGraphicIndex, sortOption, editingGraphicIndex,
            alertMessage, alertType, showAlert, consentGranted,
            confirmDialogOpen, confirmDialogMessage, confirmDialogType,
            importDialogOpen, importFile, selectedGraphics
        } = this.state;

        const verticalMap: Record<VerticalAlign, { label: string; stateKey: keyof MyDrawingsPanelState }> = {
            top: { label: 'Top', stateKey: 'vAlignTopActive' },
            middle: { label: 'Middle', stateKey: 'vAlignMidActive' },
            bottom: { label: 'Bottom', stateKey: 'vAlignBotActive' },
            baseline: { label: 'Base', stateKey: 'vAlignBaseActive' }
        };

        // Custom styles to override any gray backgrounds
        const whiteBackgroundStyle = {
            backgroundColor: 'var(--calcite-color-foreground-1, #fff)',
            boxShadow: 'none'
        };

        const storageDisclaimerContent = (
            <div
                className="p-4 text-center"
                role="dialog"
                aria-modal="true"
                aria-labelledby="storageDisclaimerTitle"
                aria-describedby="storageDisclaimerDescription"
                style={{ backgroundColor: 'var(--calcite-color-foreground-1, #fff)' }}
            >
                <h5 id="storageDisclaimerTitle" className="mb-3" tabIndex={-1}>{this.props.nls('importantNotice')}</h5>
                <div id="storageDisclaimerDescription">
                    <p>{this.props.nls('yourDrawingsAreSavedInYourWebBrowserUsingLocalStorageThisMea')}</p>
                    <p>{this.props.nls('ifYouClearYourBrowserDataSwitchToADifferentBrowserOrComputer')}</p>
                    <p>
                        To keep your work safe, please use the <strong>{this.props.nls('import')}</strong> and <strong>{this.props.nls('export')}</strong> buttons to back up and restore your drawings.
                    </p>
                </div>
                <Button
                    type="primary"
                    title={this.props.nls('acknowledgeThisNoticeAndContinue')}
                    aria-label={this.props.nls('acknowledgeDisclaimerAndContinueToMyDrawingsPanel')}
                    onClick={() =>
                        this.setState({ showStorageDisclaimer: false }, () => {
                            this.initializeComponents();
                            setTimeout(() => {
                                document.getElementById('drawingPanelHeader')?.focus();
                            }, 100);
                        })
                    }
                >
                    Continue
                </Button>
            </div>
        );

        // Header style with !important to override any external styles
        const headerStyle = {
            backgroundColor: 'var(--calcite-color-foreground-1, #fff) !important',
            boxShadow: 'none'
        };

        // Add button styling to make them equal width

        const customCss = `
  /* ======= MINIMUM WIDTH PREFERENCE ======= */
  /* My Drawings panel prefers 400px but adapts to narrower containers */
  .my-drawings-panel {
      min-width: 0 !important;
  }

  /* ======= NATIVE SELECT DROPDOWN FIX ======= */
  /* Help native select dropdowns render outside overflow containers */
  .drawing-list select {
      position: relative !important;
      z-index: 9999 !important;
  }
  
  /* Ensure the container doesn't clip select dropdowns */
  .drawing-list {
      /* Allow select dropdowns to escape overflow when focused */
      contain: layout style !important; /* Modern way to control containment */
  }

  /* Force white background on potentially gray elements */
  .my-drawings-panel,
  .my-drawings-panel h5,
  .my-drawings-panel .border-bottom,
  .my-drawings-panel > div,
  .my-drawings-panel > div > div {
      background-color: var(--calcite-color-foreground-1, #fff) !important;
  }

  .my-drawings-panel .drawing-list-container {
      overflow-y: auto !important;
  }

  /* Target panel headers that might be getting styled by the framework */
  .panel-title, 
  .panel-heading,
  .widget-title,
  .widget-heading,
  .widget-header {
      background-color: var(--calcite-color-foreground-1, #fff) !important;
  }

  /* Style the main panel header specifically */
  .my-drawings {
      background-color: var(--calcite-color-foreground-1, #fff) !important;
  }

  /* ======= EXPORT DROPDOWN STYLING - CLICK-ONLY VERSION ======= */

  /* Dropdown container */
  .export-dropdown {
      position: relative !important;
      display: inline-block !important;
      z-index: 1 !important;
  }

  /* CRITICAL: When dropdown is active/open, significantly increase z-index */
  .export-dropdown.active {
      z-index: 999999 !important;
      position: relative !important;
  }

  /* CRITICAL FIX: Ensure drawing items with active dropdowns stay on top */
    .drawing-item {
        position: relative;
        z-index: 1; /* Base z-index */
        }

    /* When a drawing item has an active dropdown, significantly boost its z-index */
    .drawing-item:has(.export-dropdown.active),
    .drawing-item:has(.label-dropdown.active) {
        z-index: 999998 !important;
        position: relative !important;
    }

    /* Ensure the dropdown content itself is at maximum z-index */
    .export-dropdown.active .export-dropdown-content,
    .label-dropdown.active .label-dropdown-menu {
        z-index: 999999 !important;
        position: absolute !important;
    }

    /* BACKUP: If :has() doesn't work, use data attribute approach */
    .drawing-item[data-dropdown-open="true"] {
        z-index: 999998 !important;
        position: relative !important;
    }

  /* Dropdown content - hidden by default */
  .export-dropdown-content {
      display: none !important;
      position: absolute !important;
      background-color: var(--calcite-color-foreground-1, #ffffff) !important;
      min-width: 200px !important;
      box-shadow: 0 8px 16px rgba(0,0,0,0.3) !important;
      z-index: 999999 !important;
      border-radius: 8px !important;
      overflow: visible !important;
      border: 2px solid var(--calcite-color-border-3, #dee2e6) !important;
      top: 100% !important;
      left: 0 !important;
      margin-top: 4px !important;
  }

  /* When dropdown opens upward */
  .export-dropdown-content.open-upward {
      top: auto !important;
      bottom: 100% !important;
      margin-top: 0 !important;
      margin-bottom: 4px !important;
  }

  /* REMOVED: Hover-based opening - dropdowns now only open on click */
  /* .export-dropdown:hover .export-dropdown-content { display: block !important; } */

  /* REMOVED: Focus-based opening */
  /* .export-dropdown:focus-within .export-dropdown-content { display: block !important; } */

  /* Show dropdown ONLY when active class is present (click-based only) */
  .export-dropdown.active .export-dropdown-content {
      display: block !important;
      z-index: 999999 !important;
  }

  /* Dropdown menu buttons */
  .export-dropdown-content button {
      display: block !important;
      width: 100% !important;
      padding: 10px 16px !important;
      text-align: left !important;
      border: none !important;
      background: transparent !important;
      cursor: pointer !important;
      font-size: 13px !important;
      transition: background-color 0.2s !important;
      color: var(--calcite-color-text-1, #212529) !important;
      white-space: nowrap !important;
      position: relative !important;
      z-index: 999999 !important;
  }

  /* Hover state for dropdown items */
  .export-dropdown-content button:hover {
      background-color: var(--calcite-color-foreground-2, #f8f9fa) !important;
      transform: none !important;
      box-shadow: none !important;
  }

  /* Disabled state for dropdown items */
  .export-dropdown-content button:disabled {
      opacity: 0.5 !important;
      cursor: not-allowed !important;
      background-color: transparent !important;
  }

  /* Icons inside dropdown items */
  .export-dropdown-content button i {
      margin-right: 8px !important;
      color: var(--calcite-color-text-2, #6c757d) !important;
      width: 16px !important;
      display: inline-block !important;
  }

    /* Visual indicator that button has dropdown */
    .export-dropdown > .btn::after,
    .export-dropdown > .action-btn::after,
    .export-dropdown > .btn-light::after,
    .export-dropdown > .export-trigger-btn::after {
        content: ' ▼' !important;
        font-size: 9px !important;
        opacity: 0.7 !important;
        margin-left: 4px !important;
    }

    /* When dropdown is active, change arrow to up to indicate it can be closed */
    .export-dropdown.active > .btn::after,
    .export-dropdown.active > .action-btn::after,
    .export-dropdown.active > .btn-light::after,
    .export-dropdown.active > .export-trigger-btn::after {
        content: ' ▲' !important;
    }

  /* Label dropdown specific styles - hide dropdown arrows since it's an icon button */
  .label-dropdown {
      position: relative !important;
      display: inline-block !important;
      z-index: 1 !important;
  }

  /* CRITICAL: When label dropdown is active/open, significantly increase z-index */
  .label-dropdown.active {
      z-index: 999999 !important;
      position: relative !important;
  }

  .label-dropdown > .label-btn::after {
      content: none !important;
  }

  .label-dropdown.active > .label-btn::after {
      content: none !important;
  }

  /* CRITICAL FIX: Drawing items base state */
  .drawing-item {
      position: relative !important;
      border: 1px solid var(--calcite-color-border-3, #e5e7eb);
      border-radius: 8px;
      overflow: visible !important;
      box-sizing: border-box;
      width: 100%;
      min-width: 0 !important;
      margin-bottom: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      transition: all 0.2s ease;
      background: var(--calcite-color-foreground-1, #fff);
      cursor: move;
      padding: 10px 12px;
      z-index: 1 !important;
  }
  
  .drawing-item:hover {
      border-color: var(--calcite-color-border-2, #d1d5db);
      box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  }

  /* Responsive layout for drawing item header */
  .drawing-item-header {
      display: flex !important;
      flex-wrap: nowrap !important;
      align-items: center !important;
      gap: 6px !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      position: relative !important;
      overflow: visible !important;
      z-index: 1 !important;
  }

  /* Type/date info row below the header */
  .drawing-item-type-row {
      margin-top: 2px !important;
  }

  .drawing-item-type-row .text-muted {
      font-size: 11px !important;
      line-height: 1.3 !important;
      color: var(--calcite-color-text-2, #6b7280) !important;
  }

  /* Inline name in header row */
  .drawing-item-info-inline {
      flex: 1 1 0 !important;
      min-width: 0 !important;
      max-width: 100% !important;
      overflow: hidden !important;
  }

  .drawing-item-info-inline > div {
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      max-width: 100% !important;
  }

  .drawing-item-info-inline .font-weight-bold {
      font-size: 13px !important;
      line-height: 1.3 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      width: 100% !important;
      max-width: 100% !important;
      display: block !important;
  }

  /* CRITICAL: Elevate drawing-item-header when it contains active label dropdown */
  .drawing-item-header:has(.label-dropdown.active) {
      z-index: 999998 !important;
  }

  .drawing-item-info,
  .drawing-item-info-inline {
      flex: 1 1 0 !important;
      min-width: 0 !important;
      max-width: 100% !important;
      overflow: hidden !important;
  }

  /* Ensure text inside drawing-item-info is truncated */
  .drawing-item-info > div,
  .drawing-item-info-inline > div {
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      max-width: 100% !important;
  }

  /* Bootstrap text-truncate class override */
  .drawing-item .text-truncate,
  .drawing-item-info .text-truncate,
  .drawing-item-info-inline .text-truncate {
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      max-width: 100% !important;
      display: block !important;
  }

  .drawing-item-info .font-weight-bold,
  .drawing-item-info .text-muted,
  .drawing-item-info-inline .font-weight-bold,
  .drawing-item-info-inline .text-muted {
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      width: 100% !important;
      max-width: 100% !important;
      display: block !important;
  }
  
  /* Compact font sizes for drawing item */
  .drawing-item-info .font-weight-bold,
  .drawing-item-info-inline .font-weight-bold {
      font-size: 13px !important;
      line-height: 1.3 !important;
  }
  
  .drawing-item-info .text-muted,
  .drawing-item-info-inline .text-muted {
      font-size: 11px !important;
      line-height: 1.3 !important;
      margin-top: 1px !important;
  }

  /* Specific rule for text-muted small combination */
  .drawing-item-info .text-muted.small,
  .drawing-item-info .small.text-muted,
  .drawing-item-info-inline .text-muted.small,
  .drawing-item-info-inline .small.text-muted,
  .drawing-item-type-row .text-muted.small,
  .drawing-item-type-row .small.text-muted {
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      width: 100% !important;
      max-width: 100% !important;
      display: block !important;
      font-size: 11px !important;
      box-sizing: border-box !important;
  }

  .drawing-icons-container {
      display: flex !important;
      gap: 1px !important;
      align-items: center !important;
      flex-shrink: 0 !important;
      position: relative !important;
      overflow: visible !important;
      z-index: 1 !important;
  }

  /* Row 2 (type + icons) wraps at narrow widths */
  .drawing-icons-type-row {
      max-width: 100% !important;
      box-sizing: border-box !important;
  }

  /* CRITICAL: Elevate drawing-icons-container when label dropdown is active */
  .drawing-icons-container:has(.label-dropdown.active) {
      z-index: 999998 !important;
  }

  /* Icon buttons can shrink slightly at narrow widths */
  .drawing-icons-container button {
      flex-shrink: 0 !important;
  }

  /* CRITICAL: When a drawing item contains an active dropdown, boost its z-index */
  .drawing-item:has(.export-dropdown.active),
  .drawing-item:has(.label-dropdown.active) {
      z-index: 999998 !important;
      position: relative !important;
      overflow: visible !important;
  }

  /* Alternative method if :has() doesn't work - using attribute selector */
  .drawing-item[data-dropdown-open="true"] {
      z-index: 999998 !important;
      position: relative !important;
      overflow: visible !important;
  }

  /* Ensure button container doesn't interfere */
  .drawing-item .button-container {
      position: relative !important;
      overflow: visible !important;
      z-index: 1 !important;
  }

  /* When the export dropdown inside the button row is open, lift the entire
     button-container above sibling content (e.g. the Apply & Close wrapper in
     the text style editor, which has its own stacking context at z-index 5).
     Without this boost, .button-container's z-index: 1 caps the dropdown's
     local z-index: 999999, so any sibling with z-index > 1 paints over it. */
  .drawing-item .button-container:has(.export-dropdown.active) {
      z-index: 999998 !important;
  }

  /* Ensure drawing-item-content doesn't create stacking context */
  .drawing-item .drawing-item-content {
      position: relative !important;
      overflow: visible !important;
      z-index: inherit !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
  }

  /* CRITICAL: Dropdown inside drawing items gets max z-index */
  .drawing-item .export-dropdown {
      position: relative !important;
      z-index: 1 !important;
  }

  .drawing-item .export-dropdown.active {
      z-index: 999999 !important;
      position: relative !important;
  }

  .drawing-item .export-dropdown.active .export-dropdown-content {
      z-index: 999999 !important;
      position: absolute !important;
  }

  /* CRITICAL: Label dropdown inside drawing items gets max z-index */
  .drawing-item .label-dropdown {
      position: relative !important;
      z-index: 1 !important;
  }

  .drawing-item .label-dropdown.active {
      z-index: 999999 !important;
      position: relative !important;
  }

  .drawing-item .label-dropdown.active .label-dropdown-menu {
      z-index: 999999 !important;
      position: absolute !important;
  }

  /* Ensure the dropdown content and buttons are above the backdrop */
  .export-dropdown.active .export-dropdown-content {
      pointer-events: all !important;
      position: absolute !important;
      z-index: 999999 !important;
  }

  .export-dropdown.active .export-dropdown-content button {
      pointer-events: all !important;
      z-index: 999999 !important;
  }

  /* CRITICAL: Label dropdown z-index rules (same as export dropdown) */
  .label-dropdown-menu {
      z-index: 999999 !important;
      position: absolute !important;
  }

  /* When label dropdown opens upward */
  .label-dropdown-menu.open-upward {
      top: auto !important;
      bottom: 100% !important;
      margin-top: 0 !important;
      margin-bottom: 4px !important;
  }

  /* Ensure buttons inside label dropdown menu are interactive */
  .label-dropdown.active .label-dropdown-menu button {
      pointer-events: all !important;
      z-index: 999999 !important;
  }

  /* CRITICAL: Allow overflow when export dropdown is open - prevents clipping */
  .px-3.drawing-list:has(.export-dropdown.active),
  .px-3.drawing-list:has(.label-dropdown.active) {
      overflow: visible !important;
  }

  /* Ensure all parent containers allow overflow */
  .px-3.drawing-list {
      flex: 1 !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      position: relative !important;
      min-height: 0 !important;
  }

  /* SCROLLING IMPROVEMENTS */
  .my-drawings-panel {
      display: flex !important;
      flex-direction: column !important;
      height: 100% !important;
      overflow: hidden !important;
      max-width: 100% !important;
      overflow-x: hidden !important;
  }

  /* Allow overflow when export or label dropdown is open */
  .my-drawings-panel:has(.export-dropdown.active),
  .my-drawings-panel:has(.label-dropdown.active) {
      overflow: visible !important;
  }

  .accessible-tooltip-wrapper {
    position: relative !important;
    display: inline-block !important;
  }

  .accessible-tooltip-wrapper:hover .accessible-tooltip,
  .accessible-tooltip-wrapper:focus-within .accessible-tooltip {
      visibility: visible !important;
      opacity: 1 !important;
  }

  .accessible-tooltip-wrapper .accessible-tooltip {
      visibility: hidden !important;
      opacity: 0 !important;
      position: absolute !important;
      z-index: 10000 !important;
      background: var(--calcite-color-inverse, #1f2937) !important;
      color: var(--calcite-color-text-inverse, #fff) !important;
      text-align: center !important;
      padding: 6px 10px !important;
      border-radius: 6px !important;
      font-size: 11px !important;
      font-weight: 500 !important;
      white-space: nowrap !important;
      pointer-events: none !important;
      transition: opacity 0.15s, visibility 0.15s !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
      max-width: 250px !important;
  }

  /* Position the tooltip */
  .accessible-tooltip-wrapper .accessible-tooltip[data-placement="top"] {
      bottom: calc(100% + 8px) !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
  }

  .accessible-tooltip-wrapper .accessible-tooltip[data-placement="bottom"] {
      top: calc(100% + 8px) !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
  }

  .accessible-tooltip-wrapper .accessible-tooltip[data-placement="left"] {
      right: calc(100% + 8px) !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
  }

  .accessible-tooltip-wrapper .accessible-tooltip[data-placement="right"] {
      left: calc(100% + 8px) !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
  }

  /* Add arrows */
  .accessible-tooltip-wrapper .accessible-tooltip::after {
      content: "" !important;
      position: absolute !important;
      border: 6px solid transparent !important;
  }

  .accessible-tooltip-wrapper .accessible-tooltip[data-placement="top"]::after {
      top: 100% !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      border-top-color: var(--calcite-color-inverse, #1f2937) !important;
  }

  .accessible-tooltip-wrapper .accessible-tooltip[data-placement="bottom"]::after {
      bottom: 100% !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      border-bottom-color: var(--calcite-color-inverse, #1f2937) !important;
  }

  .accessible-tooltip-wrapper .accessible-tooltip[data-placement="left"]::after {
      top: 50% !important;
      left: 100% !important;
      transform: translateY(-50%) !important;
      border-left-color: var(--calcite-color-inverse, #1f2937) !important;
  }

  .accessible-tooltip-wrapper .accessible-tooltip[data-placement="right"]::after {
      top: 50% !important;
      right: 100% !important;
      transform: translateY(-50%) !important;
      border-right-color: var(--calcite-color-inverse, #1f2937) !important;
  }

  /* Main scrollable container */
  .my-drawings-panel .flex-grow-1,
  .my-drawings-panel .drawing-list-container {
      overflow-y: auto !important;
      flex: 1 1 auto !important;
      height: auto !important;
      max-height: 100% !important;
  }

  /* Allow overflow when dropdowns are active */
  .my-drawings-panel .flex-grow-1:has(.export-dropdown.active),
  .my-drawings-panel .flex-grow-1:has(.label-dropdown.active),
  .my-drawings-panel .drawing-list-container:has(.export-dropdown.active),
  .my-drawings-panel .drawing-list-container:has(.label-dropdown.active) {
      overflow: visible !important;
  }

  /* Ensure the top controls don't shrink */
  .my-drawings-panel .border-bottom {
      flex-shrink: 0 !important;
  }

  /* ======= SCROLLING LIST CONTAINER ======= */
  
  /* Ensure the drawing list container doesn't force horizontal scroll */
  .my-drawings-panel .drawing-list {
      flex: 1 !important;
      width: 100% !important;
      max-width: 100% !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      box-sizing: border-box !important;
      min-height: 0 !important;
  }

  /* Allow overflow when dropdowns are active in drawing list */
  .my-drawings-panel .drawing-list:has(.export-dropdown.active),
  .my-drawings-panel .drawing-list:has(.label-dropdown.active) {
      overflow: visible !important;
  }

  /* Ensure parent containers respect width */
  .my-drawings-panel .px-3 {
      padding-left: 8px !important;
      padding-right: 8px !important;
  }

  /* ======= IMPROVED TILE-STYLE DRAWING ITEM STYLING ======= */

  /* Drawing item container - TILE STYLE with proper overflow handling */
  .drawing-item {
      position: relative;
      border: 2px solid var(--calcite-color-border-3, #e8e8e8);
      border-radius: 12px;
      overflow: visible !important;
      box-sizing: border-box;
      width: 100%;
      min-width: 0 !important;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      background: linear-gradient(135deg, var(--calcite-color-foreground-1, #ffffff) 0%, var(--calcite-color-foreground-2, #f8f9fa) 100%);
      cursor: move;
      padding: 16px;
  }

  /* Drag handle indicator - left edge of card */
  .drawing-item::before {
      content: '⋮⋮';
      position: absolute;
      left: 4px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 14px;
      color: var(--calcite-color-text-3, #999);
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
      letter-spacing: -2px;
      line-height: 1;
  }

  .drawing-item:hover::before {
      opacity: 0.5;
  }

  /* Hover effect for drawing items */
  .drawing-item:hover {
      border-color: var(--calcite-color-border-2, #b8b8b8);
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      transform: translateY(-2px);
  }

  /* Dragging state */
  .drawing-item.dragging {
      opacity: 0.5;
      transform: scale(0.98);
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  }

  /* Drag over indicator */
  .drawing-item.drag-over {
      border-color: var(--calcite-color-brand, #3b82f6);
      border-style: dashed;
      background: linear-gradient(135deg, var(--calcite-color-foreground-current, #e6f2ff) 0%, var(--calcite-color-foreground-current, #f0f7ff) 100%);
      transform: scale(1.02);
  }

  /* Selected item styling - ENHANCED TILE */
  .drawing-item.selected-drawing {
      background: var(--calcite-color-foreground-current, #f0f7ff) !important;
      border-color: var(--calcite-color-brand, #3b82f6) !important;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2) !important;
      position: relative;
      z-index: 1;
  }

  /* Drawing item content wrapper - prevent overflow */
  .drawing-item-content {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      overflow: visible;
      box-sizing: border-box;
  }

  /* Header row with checkbox and name */
  .drawing-item-header {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
  }

  /* Checkbox wrapper */
  .drawing-item-checkbox {
      flex-shrink: 0;
      margin: 0;
      display: flex;
      align-items: center;
      position: relative;
      top: 1px;
  }

  .drawing-item-checkbox .form-check-input {
      margin: 0 !important;
      vertical-align: middle;
  }

  /* Name and metadata container */
  .drawing-item-info,
  .drawing-item-info-inline {
      flex: 1;
      min-width: 0;
      overflow: hidden;
  }

  /* Visibility toggle button */
  .visibility-toggle-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
  }

  /* Truncate text labels to prevent overflow */
  .drawing-item .font-weight-bold,
  .drawing-item .text-muted {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      display: block;
  }

  .drawing-item .font-weight-bold {
      font-size: 13px;
      color: var(--calcite-color-text-1, #1f2937);
      line-height: 1.4;
  }

  .drawing-item .text-muted {
      font-size: 12px;
      margin-top: 4px;
  }

  /* ======= IMPROVED BUTTON STYLING FOR TILES ======= */

  /* Button container with proper wrapping and no overflow */
  .drawing-item .button-container {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 4px !important;
      width: 100% !important;
      margin-top: 8px !important;
      margin-left: 0;
      margin-right: 0 !important;
      padding-right: 0 !important;
      box-sizing: border-box !important;
      overflow: visible !important;
  }

  /* Individual button styling - BASE (very narrow screens) */
  .drawing-item .btn {
      flex: 0 0 auto !important;
      min-width: 0 !important;
      max-width: 100% !important;
      padding: 5px 10px !important;
      font-size: 12px !important;
      white-space: nowrap !important;
      text-align: center !important;
      justify-content: center !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      transition: all 0.15s ease !important;
      box-shadow: none !important;
      margin: 0 !important;
      border-radius: 6px !important;
      font-weight: 500 !important;
      box-sizing: border-box !important;
      border: 1px solid var(--calcite-color-border-2, #d1d5db) !important;
      background: var(--calcite-color-foreground-1, #fff) !important;
  }

  /* Ensure icons have consistent spacing */
  .drawing-item .btn i {
      margin-right: 0 !important;
      font-size: 11px !important;
      flex-shrink: 0 !important;
  }

  /* Button hover effect */
  .drawing-item .btn:hover {
      background: var(--calcite-color-foreground-2, #f3f4f6) !important;
      border-color: var(--calcite-color-text-3, #9ca3af) !important;
  }

  /* Button active state */
  .drawing-item .btn:active {
      background: var(--calcite-color-foreground-3, #e5e7eb) !important;
  }

  /* Button colors - Clean flat style */
  .drawing-item .btn-danger {
      background: #fef2f2 !important;
      border-color: #fecaca !important;
      color: var(--calcite-color-status-danger, #dc2626) !important;
  }

  .drawing-item .btn-danger:hover {
      background: #fee2e2 !important;
      border-color: #fca5a5 !important;
  }

  .drawing-item .btn-light {
      background: var(--calcite-color-foreground-1, #fff) !important;
      border-color: var(--calcite-color-border-2, #d1d5db) !important;
      color: var(--calcite-color-text-2, #374151) !important;
  }

  .drawing-item .btn-light:hover {
      background: var(--calcite-color-foreground-2, #f3f4f6) !important;
      border-color: var(--calcite-color-text-3, #9ca3af) !important;
  }

  /* Responsive button layouts */

  /* Drawing card button sizing - adapts to container */

  /* Drawing card responsive sizing - adapts to available width */

  /* Edit name input styling */
  .drawing-item .drawing-name-input {
      border-radius: 6px;
      border: 2px solid var(--calcite-color-border-3, #dee2e6);
      padding: 6px 10px;
      font-size: 13px;
      transition: all 0.2s;
      width: 100%;
  }

  .drawing-item .drawing-name-input:focus {
      border-color: var(--calcite-color-brand, #3b82f6);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      outline: none;
  }

  /* ======= COMPACT TOOLBAR REDESIGN - WCAG 2.1 AA COMPLIANT ======= */

/* Screen reader only utility */
.my-drawings-panel .sr-only {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
}

.my-drawings-panel .compact-toolbar {
    background: var(--calcite-color-foreground-1, #fff);
    border-bottom: 1px solid var(--calcite-color-border-3, #e5e7eb);
    padding: 8px 12px;
    overflow: visible;
    box-sizing: border-box;
    width: 100%;
}

/* Header */
.my-drawings-panel .compact-toolbar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0;
}

.my-drawings-panel .compact-toolbar-header:has(+ .compact-toolbar-content) {
    margin-bottom: 10px;
}

.my-drawings-panel .compact-toolbar-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--calcite-color-text-1, #1f2937); /* WCAG AA contrast */
}

.my-drawings-panel .compact-toolbar-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.my-drawings-panel .drawing-count {
    font-size: 11px;
    color: var(--calcite-color-text-2, #4b5563); /* WCAG AA contrast 4.68:1 */
    background: var(--calcite-color-foreground-2, #f3f4f6);
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 500;
}

.my-drawings-panel .compact-collapse-btn {
    width: 28px !important;
    height: 28px !important;
    min-width: 28px !important;
    padding: 0 !important;
    border: 1px solid transparent !important;
    background: transparent !important;
    color: var(--calcite-color-text-2, #4b5563) !important;
    border-radius: 4px !important;
    cursor: pointer;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    transition: all 0.15s;
    font-size: 10px;
}

.my-drawings-panel .compact-collapse-btn:hover {
    background: var(--calcite-color-foreground-2, #f3f4f6) !important;
    color: var(--calcite-color-text-1, #1f2937) !important;
}

.my-drawings-panel .compact-collapse-btn:focus {
    outline: none !important;
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--calcite-color-brand, #2563eb) !important;
}

/* Content area */
.my-drawings-panel .compact-toolbar-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: compactFadeIn 0.2s ease;
    overflow: visible;
    box-sizing: border-box;
    width: 100%;
}

@keyframes compactFadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Row 1: Sort + Filter */
.my-drawings-panel .compact-controls-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    row-gap: 6px;
}

.my-drawings-panel .compact-sort-wrapper {
    flex-shrink: 0;
    display: flex;
    align-items: center;
}

.my-drawings-panel .compact-sort-select {
    width: 85px;
    height: 32px;
    padding: 0 8px;
    font-size: 12px;
    border: 1px solid var(--calcite-color-border-2, #d1d5db);
    border-radius: 6px;
    background: var(--calcite-color-foreground-1, #fff);
    color: var(--calcite-color-text-1, #1f2937);
    cursor: pointer;
    outline: none;
    transition: all 0.15s;
}

.my-drawings-panel .compact-sort-select:hover {
    border-color: var(--calcite-color-text-3, #9ca3af);
}

.my-drawings-panel .compact-sort-select:focus {
    border-color: var(--calcite-color-brand, #2563eb);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
}

.my-drawings-panel .compact-filter-wrapper {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
}

.my-drawings-panel .compact-filter-icon {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
}

.my-drawings-panel .compact-filter-input {
    width: 100%;
    height: 32px;
    padding: 0 32px 0 30px;
    font-size: 12px;
    border: 1px solid var(--calcite-color-border-2, #d1d5db);
    border-radius: 6px;
    background: var(--calcite-color-foreground-2, #f9fafb);
    color: var(--calcite-color-text-1, #1f2937);
    outline: none;
    transition: all 0.15s;
    position: relative;
    z-index: 1;
}

.my-drawings-panel .compact-filter-input::placeholder {
    color: var(--calcite-color-text-2, #6b7280); /* WCAG AA placeholder contrast */
}

.my-drawings-panel .compact-filter-input:hover {
    border-color: var(--calcite-color-text-3, #9ca3af);
    background: var(--calcite-color-foreground-1, #fff);
}

.my-drawings-panel .compact-filter-input:focus {
    border-color: var(--calcite-color-brand, #2563eb);
    background: var(--calcite-color-foreground-1, #fff);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
}

.my-drawings-panel .compact-filter-clear {
    position: absolute !important;
    right: 4px !important;
    width: 24px !important;
    height: 24px !important;
    min-width: 24px !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    border-radius: 4px !important;
    cursor: pointer;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    color: var(--calcite-color-text-2, #6b7280) !important;
    font-size: 12px;
    z-index: 2 !important;
}

.my-drawings-panel .compact-filter-clear:hover {
    background: var(--calcite-color-foreground-3, #e5e7eb) !important;
    color: var(--calcite-color-text-1, #1f2937) !important;
}

.my-drawings-panel .compact-filter-clear:focus {
    outline: none !important;
    box-shadow: 0 0 0 2px var(--calcite-color-brand, #2563eb) !important;
}

/* Row 2: Action buttons - grouped for controlled wrapping */
.my-drawings-panel .compact-actions-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    row-gap: 6px;
    overflow: visible;
}

/* File operations row (Import/Export) - own line */
.my-drawings-panel .compact-file-ops-row {
    padding-bottom: 6px;
    border-bottom: 1px solid var(--calcite-color-foreground-2, #f0f0f0);
    margin-bottom: 2px;
}

/* Button groups wrap together, not individually */
.my-drawings-panel .compact-btn-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 1;
    flex-wrap: wrap;
    row-gap: 4px;
}

/* Visual separator between groups */
.my-drawings-panel .compact-btn-separator {
    width: 1px;
    height: 18px;
    background: var(--calcite-color-border-2, #d1d5db);
    flex-shrink: 0;
    margin: 0 2px;
}

/* Button with tooltip wrapper */
.my-drawings-panel .compact-btn-with-tooltip {
    position: relative;
    display: inline-flex;
}

.my-drawings-panel .compact-action-btn {
    padding: 5px 7px !important;
    font-size: 11px !important;
    min-width: auto !important;
    height: 28px !important;
    border-radius: 5px !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 3px !important;
    white-space: nowrap !important;
}

.my-drawings-panel .compact-action-btn .compact-btn-text {
    font-weight: 500;
}

.my-drawings-panel .compact-action-btn .dropdown-arrow {
    font-size: 9px;
    margin-left: 1px;
    opacity: 0.8;
}

.my-drawings-panel .compact-action-btn:disabled {
    opacity: 0.5 !important;
    cursor: not-allowed !important;
}

/* Focus indicator - WCAG 2.4.7 */
.my-drawings-panel .compact-action-btn:focus {
    outline: none !important;
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--calcite-color-brand, #2563eb) !important;
    position: relative;
    z-index: 1;
}

/* Accessible Tooltips - appear on hover AND focus */
.my-drawings-panel .compact-tooltip {
    position: absolute !important;
    bottom: calc(100% + 8px) !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    background: var(--calcite-color-inverse, #1f2937) !important;
    color: var(--calcite-color-text-inverse, #fff) !important;
    font-size: 11px !important;
    font-weight: 500 !important;
    padding: 6px 10px !important;
    border-radius: 6px !important;
    white-space: nowrap !important;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s, visibility 0.15s !important;
    z-index: 99999 !important;
    pointer-events: none !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
}

/* Tooltip arrow */
.my-drawings-panel .compact-tooltip::after {
    content: '' !important;
    position: absolute !important;
    top: 100% !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    border: 6px solid transparent !important;
    border-top-color: var(--calcite-color-inverse, #1f2937) !important;
}

/* Show tooltip on hover */
.my-drawings-panel .compact-btn-with-tooltip:hover .compact-tooltip {
    opacity: 1 !important;
    visibility: visible !important;
}

/* Show tooltip on focus - WCAG keyboard accessibility */
.my-drawings-panel .compact-btn-with-tooltip:focus-within .compact-tooltip {
    opacity: 1 !important;
    visibility: visible !important;
}

/* Dropdown */
.my-drawings-panel .compact-dropdown {
    position: relative;
    display: inline-flex;
}

.my-drawings-panel .compact-dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 160px;
    background: var(--calcite-color-foreground-1, #fff);
    border: 1px solid var(--calcite-color-border-3, #e5e7eb);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    padding: 4px;
    z-index: 1000;
    display: none;
}

.my-drawings-panel .compact-dropdown.open .compact-dropdown-menu {
    display: block;
    animation: dropdownFadeIn 0.15s ease;
}

@keyframes dropdownFadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
}

.my-drawings-panel .compact-dropdown-header {
    font-size: 10px;
    font-weight: 600;
    color: var(--calcite-color-text-2, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 8px 10px 4px;
}

.my-drawings-panel .compact-dropdown-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    font-size: 12px;
    color: var(--calcite-color-text-1, #1f2937);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.1s;
}

.my-drawings-panel .compact-dropdown-menu button:hover:not(:disabled) {
    background: var(--calcite-color-foreground-2, #f3f4f6);
}

/* Focus indicator for dropdown items */
.my-drawings-panel .compact-dropdown-menu button:focus {
    outline: none;
    background: var(--calcite-color-foreground-3, #e5e7eb);
    box-shadow: inset 0 0 0 2px var(--calcite-color-brand, #2563eb);
}

.my-drawings-panel .compact-dropdown-menu button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.my-drawings-panel .compact-dropdown-menu button.danger-item {
    color: var(--calcite-color-status-danger, #dc2626);
}

.my-drawings-panel .compact-dropdown-menu button.danger-item:hover:not(:disabled) {
    background: #fef2f2;
}

.my-drawings-panel .compact-dropdown-divider {
    height: 1px;
    background: var(--calcite-color-foreground-3, #e5e7eb);
    margin: 4px 0;
}

/* Responsive - narrow panels (always active, no breakpoint needed) */
/* Button groups and actions rows handle any width gracefully */

/* High contrast mode support */
@media (prefers-contrast: more) {
    .my-drawings-panel .compact-action-btn {
        border-width: 2px !important;
    }
    
    .my-drawings-panel .compact-action-btn:focus {
        box-shadow: 0 0 0 3px #000 !important;
    }
    
    .my-drawings-panel .compact-tooltip {
        border: 2px solid var(--calcite-color-foreground-1, #fff);
    }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
    .my-drawings-panel .compact-toolbar-content,
    .my-drawings-panel .compact-dropdown-menu,
    .my-drawings-panel .compact-tooltip {
        animation: none !important;
        transition: none !important;
    }
}

/* ======= UNIVERSAL WCAG 2.1 AA ACCESSIBILITY STYLES ======= */

/* Universal focus indicator for all interactive elements */
.my-drawings-panel button:focus-visible,
.my-drawings-panel [role="button"]:focus-visible,
.my-drawings-panel a:focus-visible,
.my-drawings-panel input:focus-visible,
.my-drawings-panel select:focus-visible,
.my-drawings-panel textarea:focus-visible,
.my-drawings-panel [tabindex="0"]:focus-visible {
    outline: none !important;
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--calcite-color-brand, #2563eb) !important;
    position: relative;
    z-index: 1;
}

/* Fallback for browsers without focus-visible */
.my-drawings-panel button:focus,
.my-drawings-panel [role="button"]:focus,
.my-drawings-panel input:focus,
.my-drawings-panel select:focus,
.my-drawings-panel textarea:focus {
    outline: 2px solid var(--calcite-color-brand, #2563eb) !important;
    outline-offset: 2px !important;
}

/* Remove outline on mouse click, keep for keyboard */
.my-drawings-panel button:focus:not(:focus-visible),
.my-drawings-panel [role="button"]:focus:not(:focus-visible) {
    outline: none !important;
    box-shadow: none !important;
}

/* Accessible tooltip wrapper */
.my-drawings-panel .a11y-tooltip-wrapper {
    position: relative;
    display: inline-flex;
}

/* Accessible tooltip */
.my-drawings-panel .a11y-tooltip {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--calcite-color-inverse, #1f2937);
    color: var(--calcite-color-text-inverse, #fff);
    font-size: 11px;
    font-weight: 500;
    padding: 6px 10px;
    border-radius: 6px;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s, visibility 0.15s;
    z-index: 10000;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    max-width: 250px;
}

.my-drawings-panel .a11y-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: var(--calcite-color-inverse, #1f2937);
}

/* Show tooltip on hover */
.my-drawings-panel .a11y-tooltip-wrapper:hover .a11y-tooltip {
    opacity: 1;
    visibility: visible;
}

/* Show tooltip on focus - keyboard accessible */
.my-drawings-panel .a11y-tooltip-wrapper:focus-within .a11y-tooltip {
    opacity: 1;
    visibility: visible;
}

/* Tooltip position variants */
.my-drawings-panel .a11y-tooltip.tooltip-right {
    bottom: auto;
    left: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
}

.my-drawings-panel .a11y-tooltip.tooltip-right::after {
    top: 50%;
    left: auto;
    right: 100%;
    transform: translateY(-50%);
    border: 6px solid transparent;
    border-right-color: var(--calcite-color-inverse, #1f2937);
    border-top-color: transparent;
}

.my-drawings-panel .a11y-tooltip.tooltip-bottom {
    bottom: auto;
    top: calc(100% + 8px);
}

.my-drawings-panel .a11y-tooltip.tooltip-bottom::after {
    top: auto;
    bottom: 100%;
    border: 6px solid transparent;
    border-bottom-color: var(--calcite-color-inverse, #1f2937);
    border-top-color: transparent;
}

/* Focus styles for custom inline buttons (collapse, zoom, etc.) */
.my-drawings-panel .collapse-toggle-btn:focus,
.my-drawings-panel .label-btn:focus,
.my-drawings-panel .notes-btn:focus,
.my-drawings-panel .visibility-btn:focus {
    outline: none !important;
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--calcite-color-brand, #2563eb) !important;
    border-radius: 4px;
}

/* Focus styles for drawing list items */
.my-drawings-panel .drawing-item:focus {
    outline: none !important;
    box-shadow: inset 0 0 0 2px var(--calcite-color-brand, #2563eb) !important;
}

/* Focus styles for dropdown menu items */
.my-drawings-panel .export-dropdown-content button:focus,
.my-drawings-panel .label-dropdown-menu button:focus,
.my-drawings-panel [role="menu"] button:focus,
.my-drawings-panel [role="menuitem"]:focus {
    outline: none !important;
    background: var(--calcite-color-foreground-3, #e5e7eb) !important;
    box-shadow: inset 0 0 0 2px var(--calcite-color-brand, #2563eb) !important;
}

/* High contrast mode support */
@media (prefers-contrast: more) {
    .my-drawings-panel button:focus-visible,
    .my-drawings-panel [tabindex="0"]:focus-visible {
        box-shadow: 0 0 0 3px #000 !important;
        outline: 3px solid #fff !important;
    }
    
    .my-drawings-panel .a11y-tooltip,
    .accessible-tooltip-wrapper .accessible-tooltip {
        border: 2px solid var(--calcite-color-foreground-1, #fff);
    }
    
    .my-drawings-panel .drawing-item:focus {
        box-shadow: inset 0 0 0 3px #000 !important;
    }
}

/* Reduced motion for tooltips */
@media (prefers-reduced-motion: reduce) {
    .my-drawings-panel .a11y-tooltip,
    .accessible-tooltip-wrapper .accessible-tooltip {
        transition: none !important;
    }
}

/* Ensure disabled buttons have sufficient contrast */
.my-drawings-panel button:disabled,
.my-drawings-panel [role="button"]:disabled {
    opacity: 0.6 !important; /* Increased from 0.4/0.5 for better contrast */
}

  /* ======= SYMBOL SELECTOR / POPPER IMPROVEMENTS ======= */

  /* Style editor container - improved positioning and centering */
  .drawing-item .mt-3.border,
  .drawing-item .symbol-editor-wrapper {
      border-radius: 12px !important;
      border: 2px solid var(--calcite-color-border-3, #e8e8e8) !important;
      padding: 16px !important;
      background: linear-gradient(135deg, var(--calcite-color-foreground-2, #f8f9fa) 0%, var(--calcite-color-foreground-3, #e9ecef) 100%) !important;
      margin-top: 12px !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      overflow: visible !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
      position: relative !important;
  }

  /* Symbol selector wrapper - ensure it centers properly */
  .drawing-item .symbol-selector-container {
      width: 100% !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      gap: 12px !important;
  }

  /* Target the SymbolSelector component specifically */
  .drawing-item [class*="symbol-selector"],
  .drawing-item [class*="jimu-symbol-selector"] {
      width: 100% !important;
      max-width: 100% !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
  }

  /* Style the symbol preview button */
  .drawing-item [class*="symbol-selector"] button,
  .drawing-item [class*="jimu-symbol-selector"] button {
      margin: 0 auto !important;
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      min-height: 48px !important;
      min-width: 120px !important;
      padding: 12px 20px !important;
      border-radius: 8px !important;
      background: white !important;
      border: 2px solid var(--calcite-color-border-3, #dee2e6) !important;
      box-shadow: 0 2px 6px rgba(0,0,0,0.08) !important;
      transition: all 0.2s !important;
      cursor: pointer !important;
  }

  .drawing-item [class*="symbol-selector"] button:hover,
  .drawing-item [class*="jimu-symbol-selector"] button:hover {
      border-color: var(--calcite-color-brand, #3b82f6) !important;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2) !important;
      transform: translateY(-2px) !important;
  }

  /* Center the popper when it opens */
  .jimu-popper-wrapper,
  .esri-symbol-selector__popper {
      z-index: 99999 !important;
  }

  /* Style the popper content */
  [class*="symbol-selector__popper"],
  [class*="jimu-popper"] [class*="symbol-selector"] {
      background: white !important;
      border-radius: 12px !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15) !important;
      border: 2px solid var(--calcite-color-border-3, #e8e8e8) !important;
      padding: 16px !important;
      max-width: 90vw !important;
      max-height: 400px !important;
      overflow-y: auto !important;
      position: fixed !important;
  }

  /* Position popper to avoid clipping at bottom */
  .drawing-list .jimu-popper,
  .drawing-list [class*="jimu-popper-wrapper"] {
      position: fixed !important;
      max-height: 400px !important;
      overflow-y: auto !important;
      z-index: 99999 !important;
  }

  /* Ensure the symbol-selector popper centers relative to the viewport on
     small screens. CRITICAL: this must NEVER match a bare .jimu-popper —
     Experience Builder renders WIDGET PANELS inside .jimu-popper containers
     on mobile, so an unscoped rule here fixed-centers the entire Draw panel
     (and other widgets' panels) in the middle of the screen on iOS. The two
     rules are intentionally separate: a selector list containing :has() is
     dropped wholesale by browsers without :has() support, which would kill
     the fallback rule too. */
  @media (max-width: 600px) {
      [class*="symbol-selector__popper"] {
          position: fixed !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
          margin: 0 !important;
          width: 90vw !important;
          max-width: 400px !important;
      }
      .jimu-popper:has([class*="symbol-selector"]) {
          position: fixed !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
          margin: 0 !important;
          width: 90vw !important;
          max-width: 400px !important;
      }
  }

  /* Style the color picker inside symbol selector */
  .drawing-item [class*="color-picker"],
  .drawing-item input[type="color"] {
      width: 60px !important;
      height: 48px !important;
      border-radius: 8px !important;
      border: 2px solid var(--calcite-color-border-3, #dee2e6) !important;
      cursor: pointer !important;
      padding: 4px !important;
  }

  .drawing-item [class*="color-picker"]:hover,
  .drawing-item input[type="color"]:hover {
      border-color: var(--calcite-color-brand, #3b82f6) !important;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
  }

  /* Style size/width controls */
  .drawing-item input[type="number"],
  .drawing-item input[type="range"] {
      border-radius: 8px !important;
      border: 2px solid var(--calcite-color-border-3, #dee2e6) !important;
      padding: 8px 12px !important;
      font-size: 14px !important;
      transition: all 0.2s !important;
  }

  .drawing-item input[type="number"]:focus,
  .drawing-item input[type="range"]:focus {
      border-color: var(--calcite-color-brand, #3b82f6) !important;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
      outline: none !important;
  }

  /* Range slider styling */
  .drawing-item input[type="range"] {
      height: 8px !important;
      background: linear-gradient(90deg, var(--calcite-color-foreground-3, #e9ecef) 0%, var(--calcite-color-border-3, #dee2e6) 100%) !important;
      border-radius: 4px !important;
      width: 100% !important;
  }

  .drawing-item input[type="range"]::-webkit-slider-thumb {
      width: 20px !important;
      height: 20px !important;
      border-radius: 50% !important;
      background: var(--calcite-color-brand, #3b82f6) !important;
      cursor: pointer !important;
      border: 2px solid white !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
  }

  .drawing-item input[type="range"]::-moz-range-thumb {
      width: 20px !important;
      height: 20px !important;
      border-radius: 50% !important;
      background: var(--calcite-color-brand, #3b82f6) !important;
      cursor: pointer !important;
      border: 2px solid white !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
  }

  /* Style dropdowns inside symbol selector */
  .drawing-item select,
  .drawing-item .form-control {
      border-radius: 8px !important;
      border: 2px solid var(--calcite-color-border-3, #dee2e6) !important;
      padding: 8px 12px !important;
      font-size: 14px !important;
      transition: all 0.2s !important;
      background: white !important;
  }

  .drawing-item select:focus,
  .drawing-item .form-control:focus {
      border-color: var(--calcite-color-brand, #3b82f6) !important;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
      outline: none !important;
  }

  /* Labels inside symbol selector */
  .drawing-item label {
      font-size: 13px !important;
      font-weight: 600 !important;
      color: var(--calcite-color-text-2, #495057) !important;
      margin-bottom: 6px !important;
      display: block !important;
  }

  /* Form groups inside symbol selector */
  .drawing-item .form-group {
      margin-bottom: 16px !important;
      width: 100% !important;
  }

  /* Ensure symbol preview images center properly */
  .drawing-item [class*="symbol-preview"],
  .drawing-item canvas {
      display: block !important;
      margin: 0 auto !important;
  }

  /* Close button for symbol selector (if present) */
  .drawing-item [class*="close-button"],
  .drawing-item button[aria-label*="close"],
  .drawing-item button[aria-label*="Close"] {
      position: absolute !important;
      top: 12px !important;
      right: 12px !important;
      padding: 8px !important;
      background: var(--calcite-color-foreground-2, #f8f9fa) !important;
      border-radius: 6px !important;
      border: 1px solid var(--calcite-color-border-3, #dee2e6) !important;
      cursor: pointer !important;
      transition: all 0.2s !important;
  }

  .drawing-item [class*="close-button"]:hover,
  .drawing-item button[aria-label*="close"]:hover,
  .drawing-item button[aria-label*="Close"]:hover {
      background: var(--calcite-color-foreground-3, #e9ecef) !important;
      border-color: var(--calcite-color-border-3, #ced4da) !important;
  }

  /* ======= TEXT STYLE EDITOR IMPROVEMENTS ======= */

  /* Text editor container - TILE STYLE */
  .text-editor {
      padding: 16px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--calcite-color-foreground-2, #f8f9fa) 0%, var(--calcite-color-foreground-3, #e9ecef) 100%) !important;
      border: 2px solid var(--calcite-color-border-3, #dee2e6);
      margin-top: 12px;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.06);
      width: 100%;
      overflow: hidden;
  }

  /* Form groups within text editor */
  .text-editor .form-group {
      margin-bottom: 14px;
      padding-bottom: 14px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
  }

  .text-editor .form-group:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
  }

  /* Form controls */
  .text-editor input,
  .text-editor select,
  .text-editor .form-control {
      max-width: 100%;
      width: 100%;
      border-radius: 8px;
      border: 2px solid var(--calcite-color-border-3, #dee2e6);
      transition: all 0.2s;
  }

  .text-editor input:focus,
  .text-editor select:focus {
      border-color: var(--calcite-color-brand, #3b82f6);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .text-editor input[type="text"],
  .text-editor input[type="number"] {
      text-overflow: ellipsis;
  }

  /* Form labels */
  .text-editor label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--calcite-color-text-2, #495057);
  }

  /* Color picker and number inputs */
  .text-editor input[type="color"] {
      height: 40px;
      width: 40px;
      padding: 0;
      min-width: 40px;
      border-radius: 8px;
      cursor: pointer;
  }

  .text-editor input[type="number"] {
      max-width: 100px;
  }

  /* Range sliders */
  .text-editor input[type="range"] {
      height: 8px;
      background: linear-gradient(90deg, var(--calcite-color-foreground-3, #e9ecef) 0%, var(--calcite-color-border-3, #dee2e6) 100%);
      border-radius: 4px;
      width: 100%;
  }

  /* Text style button controls */
  .text-editor .text-style-btn {
      min-width: 44px !important;
      height: 44px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: relative !important;
      margin: 0 3px;
      border-radius: 8px !important;
      transition: all 0.2s !important;
  }

  .text-editor .text-style-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
  }

  /* Active buttons style */
  .text-editor .btn-primary.text-style-btn::after {
      content: '';
      position: absolute;
      bottom: 4px;
      left: 30%;
      width: 40%;
      height: 3px;
      background-color: white;
      border-radius: 2px;
  }

  /* ALIGNMENT BUTTON IMPROVEMENTS */
  .text-alignment-btn {
      min-width: 0 !important;
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      padding: 8px 6px !important;
      margin: 0 3px !important;
      overflow: hidden !important;
      border-radius: 8px !important;
      transition: all 0.2s !important;
  }

  .text-alignment-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
  }

  .text-alignment-btn .alignment-label {
      font-size: 12px !important;
      font-weight: normal !important;
      margin-bottom: 2px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      width: 100% !important;
      text-align: center !important;
  }

  .text-alignment-btn .alignment-icon {
      font-size: 10px !important;
      opacity: 0.8 !important;
  }

  .text-alignment-btn.active .alignment-label {
      font-weight: bold !important;
  }

  /* Horizontal alignment specific styles */
  .horizontal-alignment-controls {
      display: flex !important;
      justify-content: space-between !important;
      margin-bottom: 14px !important;
      width: 100% !important;
  }

  .horizontal-alignment-controls .btn-group {
      width: 100% !important;
      display: flex !important;
      gap: 2% !important;
  }

  /* Vertical alignment specific styles */
  .vertical-alignment-controls {
      display: flex !important;
      justify-content: space-between !important;
      margin-bottom: 14px !important;
      width: 100% !important;
  }

  .vertical-alignment-controls .btn-group {
      width: 100% !important;
      display: flex !important;
      gap: 2% !important;
  }

  /* Alignment buttons */
  .btn-sm.alignment-button {
      flex: 1 !important;
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      font-size: 12px !important;
      padding: 6px 4px !important;
      border-radius: 8px !important;
  }

  /* Improved visual indicators for alignment states */
  .alignment-label-container {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
  }

  /* Button group improvements */
  .alignment-btn-group {
      display: flex !important;
      width: 100% !important;
      justify-content: space-between !important;
      gap: 2% !important;
  }

  /* Apply button styling */
  .text-editor .btn-primary {
      width: 100%;
      margin-top: 14px;
      font-weight: 600;
      border-radius: 8px;
      padding: 10px;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
  }

  .text-editor .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  }

  /* ======= IMPROVED RESPONSIVE TOOLBAR STYLING ======= */

/* Enhanced responsive toolbar styling */
.my-drawings-panel .top-controls {
    display: flex !important;
    flex-direction: column !important;
    flex-shrink: 0 !important;
    padding: 12px !important;
    padding-bottom: 14px !important;
    border-bottom: 2px solid var(--calcite-color-border-3, #e8e8e8) !important;
    background: linear-gradient(135deg, var(--calcite-color-foreground-1, #ffffff) 0%, var(--calcite-color-foreground-2, #f8f9fa) 100%) !important;
    gap: 0px !important;
    margin-bottom: 12px !important;
    border-radius: 12px !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
    overflow: visible !important;
    transition: padding 0.3s ease !important;
    width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
}

  /* ======= SCROLLBAR STYLING ======= */

  /* Firefox scrollbar */
  .px-3 {
      scrollbar-width: thin;
      scrollbar-color: rgba(0,0,0,0.2) transparent;
  }

  /* Chrome/Safari scrollbar */
  .px-3::-webkit-scrollbar {
      width: 8px;
  }

  .px-3::-webkit-scrollbar-track {
      background: transparent;
  }

  .px-3::-webkit-scrollbar-thumb {
      background-color: rgba(0,0,0,0.2);
      border-radius: 4px;
  }

  .px-3::-webkit-scrollbar-thumb:hover {
      background-color: rgba(0,0,0,0.3);
  }

  /* Prevent text overflow in all text elements */
  .text-truncate {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
  }

  /* Notes button styling */
  .notes-btn {
      transition: all 0.2s ease;
  }

  .notes-btn:hover {
      background-color: rgba(0, 102, 204, 0.1) !important;
  }

  .notes-btn:active {
      transform: scale(0.95);
  }

  /* Label button styling */
  .label-btn {
      transition: all 0.2s ease;
  }

  .label-btn:hover {
      background-color: rgba(0, 102, 204, 0.1) !important;
  }

  .label-btn:active {
      transform: scale(0.95);
  }

  /* Symbol editor container - scrollable and constrained */
  .symbol-editor-container {
      max-height: none !important;
      overflow: visible !important;
      border-radius: 8px !important;
      background: var(--calcite-color-foreground-1, #fff) !important;
      padding: 8px !important;
  }

  /* Smooth scrolling for symbol editor */
  .symbol-editor-container::-webkit-scrollbar {
      width: 8px;
  }

  .symbol-editor-container::-webkit-scrollbar-track {
      background: var(--calcite-color-foreground-2, #f1f1f1);
      border-radius: 4px;
  }

  .symbol-editor-container::-webkit-scrollbar-thumb {
      background: var(--calcite-color-text-3, #888);
      border-radius: 4px;
  }

  .symbol-editor-container::-webkit-scrollbar-thumb:hover {
      background: var(--calcite-color-text-2, #555);
  }
`;

        // Custom confirmation dialog for delete/clear
        const confirmationDialog = confirmDialogOpen && (
            <div
                className="confirmation-dialog-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirmationDialogTitle"
                aria-describedby="confirmationDialogMessage"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                <div
                    className="confirmation-dialog"
                    style={{
                        backgroundColor: 'white',
                        padding: '20px',
                        borderRadius: '4px',
                        width: '80%',
                        maxWidth: '300px',
                        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)'
                    }}
                >
                    <div className="confirmation-dialog-header mb-3">
                        <h5 id="confirmationDialogTitle" tabIndex={-1} className="m-0">
                            Confirm {confirmDialogType === 'delete' ? this.props.nls('delete') : 'Clear All'}
                        </h5>
                    </div>
                    <div className="confirmation-dialog-body mb-3">
                        <p id="confirmationDialogMessage" className="m-0">
                            {confirmDialogMessage}
                        </p>
                    </div>
                    <div className="confirmation-dialog-footer d-flex justify-content-end" role="group" aria-label="Confirmation options">
                        <Button
                            size="sm"
                            className="mr-2"
                            onClick={this.closeConfirmDialog}
                            title={this.props.nls('cancelAndCloseTheDialog')}
                            aria-label={this.props.nls('cancel')}
                        >
                            {this.props.nls('cancel')}
                        </Button>
                        <Button
                            size="sm"
                            type="danger"
                            onClick={this.executeConfirmAction}
                            title="Confirm and proceed"
                            aria-label="Confirm and proceed"
                        >
                            {this.props.nls('ok')}
                        </Button>
                    </div>
                </div>
            </div>
        );

        // Import confirmation dialog
        const importDialog = importDialogOpen && (
            <div
                className="confirmation-dialog-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="importDialogTitle"
                aria-describedby="importDialogDescription"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                <div
                    className="confirmation-dialog"
                    style={{
                        backgroundColor: 'white',
                        padding: '20px',
                        borderRadius: '4px',
                        width: '80%',
                        maxWidth: '300px',
                        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)'
                    }}
                >
                    <div className="confirmation-dialog-header mb-3">
                        <h5 id="importDialogTitle" tabIndex={-1} className="m-0">{this.props.nls('importDrawings')}</h5>
                    </div>
                    <div id="importDialogDescription" className="confirmation-dialog-body mb-3">
                        <p className="m-0">{importFile && this.props.nls('fileFilename', { filename: (importFile.name) })}</p>
                        <p className="mt-2 mb-0">{this.props.nls('wouldYouLikeToReplaceExistingDrawingsOrAddToThem')}</p>
                    </div>
                    <div className="confirmation-dialog-footer d-flex justify-content-between" role="group" aria-label="Import action options">
                        <Button
                            size="sm"
                            onClick={this.closeImportDialog}
                            title={this.props.nls('cancelImportAndCloseDialog')}
                            aria-label={this.props.nls('cancelImport')}
                        >
                            Cancel
                        </Button>
                        <div>
                            <Button
                                size="sm"
                                className="mr-2"
                                onClick={this.handleImportAdd}
                                title="Add imported drawings to existing ones"
                                aria-label={this.props.nls('addDrawings')}
                            >
                                Add
                            </Button>
                            <Button
                                size="sm"
                                type="danger"
                                onClick={this.handleImportReplace}
                                title="Replace existing drawings with imported file"
                                aria-label={this.props.nls('replaceDrawings')}
                            >{this.props.nls('replace')}</Button>
                        </div>
                    </div>
                </div>
            </div>
        );

        // Content for when local storage permission is denied
        const permissionDeniedContent = (
            <div
                className="my-drawings-panel p-3"
                role="dialog"
                aria-modal="true"
                aria-labelledby="permissionDeniedTitle"
                aria-describedby="permissionDeniedDescription"
                style={{ backgroundColor: 'var(--calcite-color-foreground-1, #fff)', height: '100%', boxShadow: 'none' }}
            >
                <div className="text-center mb-4">
                    <h5 id="permissionDeniedTitle" tabIndex={-1}>{this.props.nls('myDrawingsFeatureUnavailable')}</h5>
                    <div id="permissionDeniedDescription">
                        <p>{this.props.nls('thisFeatureRequiresLocalStoragePermissionToSaveYourDrawings')}</p>
                    </div>
                    <div className="mt-4">
                        <Button
                            type="primary"
                            onClick={this.handleConsentYes}
                            title={this.props.nls('enableLocalStorageToUseTheMyDrawingsFeature')}
                            aria-label="Allow local storage permission to enable My Drawings feature"
                        >{this.props.nls('allowLocalStoragePermission')}</Button>
                    </div>
                </div>

                {showAlert && (
                    <div role="alert" aria-live="assertive">
                        <Alert
                            className={`edraw-alert edraw-alert-${alertType}`}
                            withIcon
                            open
                            type={alertType}
                            text={alertMessage}
                        />
                    </div>
                )}
            </div>
        );

        // Only show consent prompt if consent status is undecided (null)
        const showConsentPrompt = consentGranted === null;

        // Consent prompt content
        const consentPromptContent = (
            <div
                className="consent-banner border p-3 mb-2 text-center"
                role="dialog"
                aria-modal="true"
                aria-labelledby="consentPromptTitle"
                aria-describedby="consentPromptDescription"
                style={{ backgroundColor: 'var(--calcite-color-foreground-1, #fff)', height: '100%', boxShadow: 'none' }}
            >
                <h5 id="consentPromptTitle" className="mb-3" tabIndex={-1}>{this.props.nls('storagePermissionRequired')}</h5>
                <div id="consentPromptDescription">
                    <p className="mb-3">{this.props.nls('toUseTheMyDrawingsPanelYouMustAllowSavingDrawingsInYourBrows')}</p>
                    <p className="mb-3">{this.props.nls('thisAllowsYourDrawingsToBeRememberedWhenYouReturnToThisPageL')}</p>
                </div>
                <div className="d-flex justify-content-center mt-3" role="group" aria-label="Consent choices">
                    <Button
                        type="primary"
                        size="sm"
                        className="mr-3"
                        onClick={this.handleConsentYes}
                        title={this.props.nls('allowSavingDrawingsToYourBrowser')}
                        aria-label={this.props.nls('allowSavingDrawingsToYourBrowser')}
                    >{this.props.nls('allowLocalStorage')}</Button>
                    <Button
                        type="danger"
                        size="sm"
                        onClick={this.handleConsentNo}
                        title={this.props.nls('doNotAllowSavingDrawingsToYourBrowser')}
                        aria-label={this.props.nls('doNotAllowSavingDrawingsToYourBrowser')}
                    >{this.props.nls('donTAllow')}</Button>
                </div>
            </div>
        );

        const loadPromptContent = (
            <div
                className="p-4 text-center"
                role="dialog"
                aria-modal="true"
                aria-labelledby="loadPromptTitle"
                aria-describedby="loadPromptDescription"
                style={{ backgroundColor: 'var(--calcite-color-foreground-1, #fff)', height: '100%' }}
            >
                <h5 id="loadPromptTitle" className="mb-3" tabIndex={-1}>{this.props.nls('existingDrawingsFound')}</h5>
                <div id="loadPromptDescription">
                    <p>{this.props.nls('youHaveDrawingsSavedFromAPreviousSession')}</p>
                    {this.state.hasNewUnsavedDrawings ? (
                        <div>
                            <p>You also have <strong>new drawings</strong> from this session that haven't been saved yet.</p>
                            <p>{this.props.nls('whatWouldYouLikeToDo')}</p>
                        </div>
                    ) : (
                        <p>{this.props.nls('wouldYouLikeToLoadYourExistingDrawingsOrDeleteAllAndStartNew')}</p>
                    )}
                </div>

                {this.state.hasNewUnsavedDrawings ? (
                    /* Options when both new and saved drawings exist */
                    <div
                        className="d-flex flex-column align-items-center mt-4"
                        style={{ gap: '10px' }}
                        role="group"
                        aria-label="Drawing merge options"
                    >
                        <Button
                            type="primary"
                            onClick={this.handleMergeDrawings}
                            style={{ width: '260px' }}
                            title="Keep your new drawings and load saved drawings together"
                            aria-label={this.props.nls('keepAllDrawingsByMergingNewAndSaved')}
                        >{this.props.nls('keepAllMerge')}</Button>
                        <Button
                            type="default"
                            onClick={this.handleKeepNewOnly}
                            style={{ width: '260px' }}
                            title="Keep only your new drawings and discard saved drawings from storage"
                            aria-label={this.props.nls('keepOnlyNewDrawingsAndDiscardSaved')}
                        >{this.props.nls('keepNewOnly')}</Button>
                        <Button
                            type="danger"
                            onClick={this.handleStartFresh}
                            style={{ width: '260px' }}
                            title="Delete all drawings (both new and saved) and start fresh"
                            aria-label={this.props.nls('deleteAllDrawingsAndStartFresh')}
                        >{this.props.nls('deleteAllAndStartNew')}</Button>
                    </div>
                ) : (
                    /* Original two-option layout when only saved drawings exist */
                    <div className="d-flex justify-content-center mt-4 gap-3" role="group" aria-label={this.props.nls('loadOptions')}>
                        <Button
                            type="primary"
                            onClick={this.handleLoadExistingDrawings}
                            className="mr-3"
                            title={this.props.nls('loadYourPreviouslySavedDrawings')}
                            aria-label={this.props.nls('loadPreviouslySavedDrawings')}
                        >{this.props.nls('loadExistingDrawings')}</Button>
                        <Button
                            type="danger"
                            onClick={this.handleStartFresh}
                            title={this.props.nls('deleteAllSavedDrawingsAndStartFresh')}
                            aria-label={this.props.nls('deleteAllSavedDrawingsAndStartFresh')}
                        >{this.props.nls('deleteAllAndStartNew')}</Button>
                    </div>
                )}
            </div>
        );

        const mainPanelContent = (
            <div
                className="my-drawings-panel p-2"
                style={{
                    backgroundColor: 'var(--calcite-color-foreground-1, #fff)',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    overflow: 'hidden'
                }}
            >
                {/* Compact toolbar - WCAG 2.1 AA Compliant */}
                <div
                    className="compact-toolbar"
                    role="toolbar"
                    aria-label={this.props.nls('drawingManagementTools')}
                >
                    {/* Header row */}
                    <div className="compact-toolbar-header">
                        <span className="compact-toolbar-title" id="toolbar-title">{this.props.nls('myDrawings')}</span>
                        <div className="compact-toolbar-header-actions">
                            <span
                                className="drawing-count"
                                aria-live="polite"
                                aria-atomic="true"
                            >
                                {drawings.length} item{drawings.length !== 1 ? 's' : ''}
                            </span>
                            <Button
                                size="sm"
                                type="tertiary"
                                onClick={() => this.toggleToolbar()}
                                className="compact-collapse-btn"
                                aria-expanded={!this.state.toolbarCollapsed}
                                aria-controls="compact-toolbar-content"
                                title={this.state.toolbarCollapsed ? "Expand toolbar" : "Collapse toolbar"}
                            >
                                <span aria-hidden="true">{this.state.toolbarCollapsed ? '▼' : '▲'}</span>
                                <span className="sr-only">{this.state.toolbarCollapsed ? "Expand toolbar" : "Collapse toolbar"}</span>
                            </Button>
                        </div>
                    </div>

                    {/* Collapsible content */}
                    {!this.state.toolbarCollapsed && (
                        <div
                            className="compact-toolbar-content"
                            id="compact-toolbar-content"
                        >
                            {/* Row 1: Sort + Filter inline */}
                            {this.ff('enableSort') && (
                                <div className="compact-controls-row">
                                    <div className="compact-sort-wrapper">
                                        <label
                                            htmlFor="compact-sort-select"
                                            style={{
                                                fontSize: '11px',
                                                color: 'var(--calcite-color-text-2, #4b5563)',
                                                fontWeight: 500,
                                                whiteSpace: 'nowrap',
                                                marginRight: '4px'
                                            }}
                                        >{this.props.nls('sort')}</label>
                                        <select
                                            id="compact-sort-select"
                                            value={this.state.hasManualOrder ? 'manual' : sortOption}
                                            onChange={this.handleSortOptionChange}
                                            className="compact-sort-select"
                                            title="Sort drawings"
                                        >
                                            <option value="manual">{this.props.nls('manual')}</option>
                                            <option value="name">{this.props.nls('name')}</option>
                                            <option value="type">{this.props.nls('type')}</option>
                                            <option value="created">{this.props.nls('newest')}</option>
                                        </select>
                                    </div>

                                    <div className="compact-filter-wrapper">
                                        <label
                                            htmlFor="compact-filter-input"
                                            className="sr-only"
                                        >{this.props.nls('filterDrawings')}</label>
                                        <span className="compact-filter-icon" aria-hidden="true">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--calcite-color-text-2, #6b7280)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                                            </svg>
                                        </span>
                                        <input
                                            id="compact-filter-input"
                                            type="text"
                                            value={this.state.searchFilter}
                                            onChange={this.handleSearchFilterChange}
                                            placeholder={this.props.nls('filter') + '...'}
                                            className="compact-filter-input"
                                            aria-describedby="filter-description"
                                        />
                                        <span id="filter-description" className="sr-only">
                                            Type to filter drawings by name or type
                                        </span>
                                        {this.state.searchFilter && (
                                            <Button
                                                size="sm"
                                                type="tertiary"
                                                className="compact-filter-clear"
                                                onClick={this.clearSearchFilter}
                                                title={this.props.nls('clearFilter')}
                                            >
                                                <span aria-hidden="true">✕</span>
                                                <span className="sr-only">{this.props.nls('clearFilter')}</span>
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Row 2: Import/Export on own line */}
                            {(this.ff('enableImport') || this.ff('enableExport')) && (
                                <div
                                    className="compact-actions-row compact-file-ops-row"
                                    role="toolbar"
                                    aria-label={this.props.nls('fileOperations')}
                                >
                                    <div className="compact-btn-group" role="group" aria-label={this.props.nls('fileOperations')}>
                                        {/* Import */}
                                        {this.ff('enableImport') && (
                                            <Button
                                                size="sm"
                                                type="default"
                                                onClick={this.handleImportButtonClick}
                                                className="compact-action-btn"
                                                title="Import drawings (GeoJSON, KML, Shapefile)"
                                            >
                                                <span className="compact-btn-text">{this.props.nls('import')}</span>
                                            </Button>
                                        )}

                                        {/* Export dropdown */}
                                        {this.ff('enableExport') && (
                                            <div
                                                className={`compact-dropdown ${this.state.openDropdownIndex === 'export' ? 'open' : ''}`}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Escape') {
                                                        this.setState({ openDropdownIndex: null });
                                                        (e.currentTarget.querySelector('button') as HTMLButtonElement)?.focus();
                                                    }
                                                }}
                                            >
                                                <Button
                                                    size="sm"
                                                    type="default"
                                                    onClick={(e) => { e.stopPropagation(); this.toggleDropdown('export'); }}
                                                    disabled={drawings.length === 0}
                                                    className="compact-action-btn"
                                                    aria-haspopup="menu"
                                                    aria-expanded={this.state.openDropdownIndex === 'export'}
                                                    aria-controls="export-menu"
                                                    title="Export drawings to file"
                                                >
                                                    <span className="compact-btn-text">{this.props.nls('export')}</span>
                                                    <span aria-hidden="true" className="dropdown-arrow">▾</span>
                                                </Button>
                                                <div
                                                    id="export-menu"
                                                    className="compact-dropdown-menu"
                                                    role="menu"
                                                    aria-label="Export options"
                                                >
                                                    <div className="compact-dropdown-header" role="presentation">Export All ({drawings.length})</div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); this.handleExportWithFormat('geojson'); this.setState({ openDropdownIndex: null }); }}
                                                        disabled={drawings.length === 0}
                                                        role="menuitem"
                                                        tabIndex={this.state.openDropdownIndex === 'export' ? 0 : -1}
                                                    >
                                                        {this.props.nls('geojson')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); this.handleExportWithFormat('kml'); this.setState({ openDropdownIndex: null }); }}
                                                        disabled={drawings.length === 0}
                                                        role="menuitem"
                                                        tabIndex={this.state.openDropdownIndex === 'export' ? 0 : -1}
                                                    >
                                                        {this.props.nls('kml')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); this.handleExportWithFormat('shapefile'); this.setState({ openDropdownIndex: null }); }}
                                                        disabled={drawings.length === 0}
                                                        role="menuitem"
                                                        tabIndex={this.state.openDropdownIndex === 'export' ? 0 : -1}
                                                    >
                                                        Shapefile
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); this.handleExportWithFormat('exb-draw'); this.setState({ openDropdownIndex: null }); }}
                                                        disabled={drawings.length === 0}
                                                        role="menuitem"
                                                        tabIndex={this.state.openDropdownIndex === 'export' ? 0 : -1}
                                                        title={this.props.nls('exportAsArcgisJsonComp')}
                                                    >
                                                        {this.props.nls('json')}
                                                    </button>
                                                    {selectedGraphics.size > 0 && (
                                                        <>
                                                            <div className="compact-dropdown-divider" role="separator" />
                                                            <div className="compact-dropdown-header" role="presentation">{this.props.nls('exportSelectedCount', { count: (selectedGraphics.size) })}</div>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); this.handleExportSelectedWithFormat('geojson'); this.setState({ openDropdownIndex: null }); }}
                                                                role="menuitem"
                                                                tabIndex={this.state.openDropdownIndex === 'export' ? 0 : -1}
                                                            >
                                                                GeoJSON
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); this.handleExportSelectedWithFormat('kml'); this.setState({ openDropdownIndex: null }); }}
                                                                role="menuitem"
                                                                tabIndex={this.state.openDropdownIndex === 'export' ? 0 : -1}
                                                            >
                                                                KML
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); this.handleExportSelectedWithFormat('shapefile'); this.setState({ openDropdownIndex: null }); }}
                                                                role="menuitem"
                                                                tabIndex={this.state.openDropdownIndex === 'export' ? 0 : -1}
                                                            >
                                                                Shapefile
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); this.handleExportSelectedWithFormat('exb-draw'); this.setState({ openDropdownIndex: null }); }}
                                                                role="menuitem"
                                                                tabIndex={this.state.openDropdownIndex === 'export' ? 0 : -1}
                                                                title={this.props.nls('exportAsArcgisJsonComp')}
                                                            >
                                                                JSON
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Row 3: Selection/View/Delete action buttons */}
                            <div
                                className="compact-actions-row"
                                role="toolbar"
                                aria-label={this.props.nls('drawingActions')}
                            >
                                {/* Group 2: Selection/Delete Operations */}
                                <div className="compact-btn-group" role="group" aria-label={this.props.nls('selectionOperations')}>
                                    {/* Select All */}
                                    <Button
                                        size="sm"
                                        type={selectedGraphics.size === drawings.length && drawings.length > 0 ? "primary" : "default"}
                                        onClick={this.handleToggleSelectAll}
                                        disabled={drawings.length === 0}
                                        className="compact-action-btn"
                                        aria-pressed={selectedGraphics.size === drawings.length && drawings.length > 0}
                                        title={selectedGraphics.size === drawings.length && drawings.length > 0 ? 'Deselect all drawings' : this.props.nls('selectAllDrawings')}
                                    >
                                        <span className="compact-btn-text">
                                            {selectedGraphics.size === drawings.length && drawings.length > 0 ? this.props.nls('deselect') : this.props.nls('selectAll')}
                                        </span>
                                    </Button>

                                    {/* Delete dropdown */}
                                    <div
                                        className={`compact-dropdown ${this.state.openDropdownIndex === 'delete' ? 'open' : ''}`}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') {
                                                this.setState({ openDropdownIndex: null });
                                                (e.currentTarget.querySelector('button') as HTMLButtonElement)?.focus();
                                            }
                                        }}
                                    >
                                        <Button
                                            size="sm"
                                            type="danger"
                                            onClick={(e) => { e.stopPropagation(); this.toggleDropdown('delete'); }}
                                            disabled={drawings.length === 0}
                                            className="compact-action-btn"
                                            aria-haspopup="menu"
                                            aria-expanded={this.state.openDropdownIndex === 'delete'}
                                            aria-controls="delete-menu"
                                            title="Delete drawings"
                                        >
                                            <span className="compact-btn-text">{this.props.nls('delete')}</span>
                                            <span aria-hidden="true" className="dropdown-arrow">▾</span>
                                        </Button>
                                        <div
                                            id="delete-menu"
                                            className="compact-dropdown-menu"
                                            role="menu"
                                            aria-label="Delete options"
                                        >
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); this.handleDeleteSelected(); this.setState({ openDropdownIndex: null }); }}
                                                disabled={selectedGraphics.size === 0}
                                                role="menuitem"
                                                tabIndex={this.state.openDropdownIndex === 'delete' ? 0 : -1}
                                            >
                                                {this.props.nls('deleteSelectedCount', { count: (selectedGraphics.size) })}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); this.handleClearAllClick(); this.setState({ openDropdownIndex: null }); }}
                                                className="danger-item"
                                                role="menuitem"
                                                tabIndex={this.state.openDropdownIndex === 'delete' ? 0 : -1}
                                            >
                                                {this.props.nls('deleteAllCount', { count: (drawings.length) })}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Merge Selected */}
                                {this.ff('enableMerge') && selectedGraphics.size >= 2 && (
                                    <div className="compact-btn-group" role="group" aria-label="Merge options">
                                        <Button
                                            size="sm"
                                            type="default"
                                            onClick={this.handleMergeSelected}
                                            className="compact-action-btn"
                                            title={`Merge ${selectedGraphics.size} selected drawings into one`}
                                            aria-label={this.props.nls('mergeCountSelectedDrawings', { count: (selectedGraphics.size) })}
                                        >
                                            <span className="compact-btn-text" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <circle cx="9" cy="12" r="7" />
                                                    <circle cx="15" cy="12" r="7" />
                                                </svg>
                                                {this.props.nls('mergeCount', { count: (selectedGraphics.size) })}
                                            </span>
                                        </Button>
                                    </div>
                                )}

                                {/* Group 3: View/Clear Operations */}
                                <div className="compact-btn-group" role="group" aria-label={this.props.nls('viewOptions')}>
                                    {/* Filter by Extent */}
                                    <Button
                                        size="sm"
                                        type={this.state.filterByMapExtent ? "primary" : "default"}
                                        onClick={this.toggleMapExtentFilter}
                                        className="compact-action-btn"
                                        aria-pressed={this.state.filterByMapExtent}
                                        title={this.state.filterByMapExtent ? this.props.nls('showAllDrawings') : 'Show only drawings in current map view'}
                                    >
                                        <span className="compact-btn-text">
                                            {this.state.filterByMapExtent ? this.props.nls('showAll') : 'In View'}
                                        </span>
                                    </Button>

                                    {/* Clear Selection */}
                                    <Button
                                        size="sm"
                                        type="default"
                                        onClick={this.handleClearSelected}
                                        disabled={selectedGraphics.size === 0 && selectedGraphicIndex === null}
                                        className="compact-action-btn"
                                        title={this.props.nls('clearSelection')}
                                    >
                                        <span className="compact-btn-text">{this.props.nls('clear')}</span>
                                    </Button>
                                </div>

                                {/* Labels dropdown - right aligned */}
                                {drawings.length > 0 && (
                                    <div
                                        className={`compact-dropdown ${this.state.openDropdownIndex === 'labels' ? 'open' : ''}`}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            flexShrink: 0,
                                            whiteSpace: 'nowrap',
                                            marginLeft: 'auto'
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') {
                                                this.setState({ openDropdownIndex: null });
                                                (e.currentTarget.querySelector('button') as HTMLButtonElement)?.focus();
                                            }
                                        }}
                                    >
                                        <span style={{
                                            fontSize: '11px',
                                            color: 'var(--calcite-color-text-2, #4b5563)',
                                            fontWeight: 500,
                                            whiteSpace: 'nowrap'
                                        }}>
                                            Labels:
                                        </span>
                                        <button
                                            type="button"
                                            id="labels-dropdown-trigger"
                                            onClick={(e) => { e.stopPropagation(); this.toggleDropdown('labels'); }}
                                            aria-haspopup="menu"
                                            aria-expanded={this.state.openDropdownIndex === 'labels'}
                                            aria-controls="labels-menu"
                                            aria-label={this.props.nls('labelDisplayOptions')}
                                            title="Choose what to display as labels on the map"
                                            style={{
                                                fontSize: '11px',
                                                height: '22px',
                                                padding: '0 18px 0 6px',
                                                border: '1px solid var(--calcite-color-border-2, #d1d5db)',
                                                borderRadius: '4px',
                                                backgroundColor: 'transparent',
                                                cursor: 'pointer',
                                                color: 'var(--calcite-color-text-2, #4b5563)',
                                                fontWeight: 500,
                                                outline: 'none',
                                                backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'5\' viewBox=\'0 0 8 5\'%3e%3cpath fill=\'%234b5563\' d=\'M0 0l4 5 4-5z\'/%3e%3c/svg%3e")',
                                                backgroundRepeat: 'no-repeat',
                                                backgroundPosition: 'right 4px center',
                                                backgroundSize: '8px 5px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                minWidth: '50px'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--calcite-color-text-3, #9ca3af)'}
                                            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--calcite-color-border-2, #d1d5db)'}
                                        >
                                            {this.state.drawingLabelOption === 'off' ? this.props.nls('off') :
                                                this.state.drawingLabelOption === 'name' ? this.props.nls('name') :
                                                    this.state.drawingLabelOption === 'notes' ? 'Notes' : this.props.nls('both')}
                                        </button>
                                        {/* Portal the dropdown menu to body to avoid overflow clipping */}
                                        {this.state.openDropdownIndex === 'labels' && ReactDOM.createPortal(
                                            <div
                                                id="labels-menu"
                                                role="menu"
                                                aria-label={this.props.nls('labelDisplayOptions')}
                                                style={{
                                                    position: 'fixed',
                                                    top: (() => {
                                                        const btn = document.getElementById('labels-dropdown-trigger');
                                                        if (btn) {
                                                            const rect = btn.getBoundingClientRect();
                                                            return rect.bottom + 4;
                                                        }
                                                        return 0;
                                                    })(),
                                                    left: (() => {
                                                        const btn = document.getElementById('labels-dropdown-trigger');
                                                        if (btn) {
                                                            const rect = btn.getBoundingClientRect();
                                                            return rect.left;
                                                        }
                                                        return 0;
                                                    })(),
                                                    minWidth: '80px',
                                                    background: 'var(--calcite-color-foreground-1, #fff)',
                                                    border: '1px solid var(--calcite-color-border-3, #e5e7eb)',
                                                    borderRadius: '8px',
                                                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
                                                    padding: '4px',
                                                    zIndex: 999999,
                                                    animation: 'dropdownFadeIn 0.15s ease'
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); this.handleDrawingLabelOptionChange('off'); this.setState({ openDropdownIndex: null }); }}
                                                    role="menuitem"
                                                    tabIndex={0}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '8px 10px',
                                                        fontSize: '12px',
                                                        color: 'var(--calcite-color-text-1, #1f2937)',
                                                        background: 'transparent',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        textAlign: 'left',
                                                        fontWeight: this.state.drawingLabelOption === 'off' ? 600 : 400
                                                    }}
                                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f3f4f6)'}
                                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                >{this.props.nls('off')}</button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); this.handleDrawingLabelOptionChange('name'); this.setState({ openDropdownIndex: null }); }}
                                                    role="menuitem"
                                                    tabIndex={0}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '8px 10px',
                                                        fontSize: '12px',
                                                        color: 'var(--calcite-color-text-1, #1f2937)',
                                                        background: 'transparent',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        textAlign: 'left',
                                                        fontWeight: this.state.drawingLabelOption === 'name' ? 600 : 400
                                                    }}
                                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f3f4f6)'}
                                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                >
                                                    Name
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); this.handleDrawingLabelOptionChange('notes'); this.setState({ openDropdownIndex: null }); }}
                                                    role="menuitem"
                                                    tabIndex={0}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '8px 10px',
                                                        fontSize: '12px',
                                                        color: 'var(--calcite-color-text-1, #1f2937)',
                                                        background: 'transparent',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        textAlign: 'left',
                                                        fontWeight: this.state.drawingLabelOption === 'notes' ? 600 : 400
                                                    }}
                                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f3f4f6)'}
                                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                >
                                                    Notes
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); this.handleDrawingLabelOptionChange('both'); this.setState({ openDropdownIndex: null }); }}
                                                    role="menuitem"
                                                    tabIndex={0}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        width: '100%',
                                                        padding: '8px 10px',
                                                        fontSize: '12px',
                                                        color: 'var(--calcite-color-text-1, #1f2937)',
                                                        background: 'transparent',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        textAlign: 'left',
                                                        fontWeight: this.state.drawingLabelOption === 'both' ? 600 : 400
                                                    }}
                                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f3f4f6)'}
                                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                >
                                                    Both
                                                </button>
                                            </div>,
                                            document.body
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Drawing list - fills remaining height dynamically */}
                <div
                    key={`drawing-list-${this.state.listRenderKey}`}
                    className="px-3 drawing-list"
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        backgroundColor: 'var(--calcite-color-foreground-1, #fff)',
                        minHeight: 0
                    }}
                    role="list"
                    aria-label={this.props.nls('drawingsList')}
                >
                    {(() => {
                        const filteredDrawings = this.getFilteredDrawings();
                        const { searchFilter } = this.state;


                        // Collapse/Expand All Button - shown when there are drawings
                        const collapseAllButton = drawings.length > 0 && (
                            <div style={{
                                padding: '4px 0 8px 0',
                                marginBottom: '4px',
                                backgroundColor: 'var(--calcite-color-foreground-1, #fff)',
                                display: 'flex',
                                flexWrap: 'wrap',
                                justifyContent: 'space-evenly',
                                alignItems: 'center',
                                rowGap: '2px'
                            }}>
                                {/* Collapse/Expand All Button */}
                                <button
                                    onClick={this.toggleAllDrawingsCollapse}
                                    title={this.state.collapsedDrawings.size === drawings.length ? this.props.nls('expandAllDrawingDetails') : this.props.nls('collapseAllDrawingDetails')}
                                    aria-pressed={this.state.collapsedDrawings.size === drawings.length}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '4px 6px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: 'var(--calcite-color-text-2, #4b5563)',
                                        fontSize: '11px',
                                        fontWeight: 500,
                                        borderRadius: '4px',
                                        transition: 'background 0.15s',
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <svg
                                        width="10"
                                        height="10"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                        style={{
                                            pointerEvents: 'none',
                                            transform: this.state.collapsedDrawings.size === drawings.length ? 'rotate(0deg)' : 'rotate(90deg)',
                                            transition: 'transform 0.2s'
                                        }}
                                    >
                                        <polyline points="9 18 15 12 9 6"></polyline>
                                    </svg>
                                    <span>
                                        {this.state.collapsedDrawings.size === drawings.length ? this.props.nls('expandAll') : this.props.nls('collapseAll')}
                                    </span>
                                </button>

                                {/* Zoom All Button */}
                                <button
                                    onClick={this.handleZoomAll}
                                    title={this.props.nls('zoomMapToShowAllDrawings')}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '4px 6px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: 'var(--calcite-color-text-2, #4b5563)',
                                        fontSize: '11px',
                                        fontWeight: 500,
                                        borderRadius: '4px',
                                        transition: 'background 0.15s',
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                        <polyline points="15 3 21 3 21 9"></polyline>
                                        <polyline points="9 21 3 21 3 15"></polyline>
                                        <line x1="21" y1="3" x2="14" y2="10"></line>
                                        <line x1="3" y1="21" x2="10" y2="14"></line>
                                    </svg>
                                    <span>{this.props.nls('zoomAll')}</span>
                                </button>

                                {/* Show All/Hide All Button */}
                                <button
                                    onClick={() => this.toggleAllGraphicsVisibility()}
                                    aria-label={(() => {
                                        const allVisible = this.state.drawings.every(graphic => {
                                            const extGraphic = asExtendedGraphic(graphic);
                                            return extGraphic.visible !== false;
                                        });
                                        return allVisible ? this.props.nls('hideAllDrawings') : this.props.nls('showAllDrawings');
                                    })()}
                                    title={(() => {
                                        const allVisible = this.state.drawings.every(graphic => {
                                            const extGraphic = asExtendedGraphic(graphic);
                                            return extGraphic.visible !== false;
                                        });
                                        return allVisible ? this.props.nls('hideAllDrawings') : this.props.nls('showAllDrawings');
                                    })()}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '4px 6px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: 'var(--calcite-color-text-2, #4b5563)',
                                        fontSize: '11px',
                                        fontWeight: 500,
                                        borderRadius: '4px',
                                        transition: 'background 0.15s',
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    {(() => {
                                        const allVisible = this.state.drawings.every(graphic => {
                                            const extGraphic = asExtendedGraphic(graphic);
                                            return extGraphic.visible !== false;
                                        });
                                        return allVisible ? (
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                <circle cx="12" cy="12" r="3"></circle>
                                            </svg>
                                        ) : (
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                                <line x1="1" y1="1" x2="23" y2="23"></line>
                                            </svg>
                                        );
                                    })()}
                                    <span style={{ fontSize: '11px' }}>
                                        {(() => {
                                            const allVisible = this.state.drawings.every(graphic => {
                                                const extGraphic = asExtendedGraphic(graphic);
                                                return extGraphic.visible !== false;
                                            });
                                            return allVisible ? this.props.nls('hideAll') : this.props.nls('showAll');
                                        })()}
                                    </span>
                                </button>

                                {/* Lock All/Unlock All Button */}
                                {this.ff('enableLock') && (
                                    <button
                                        onClick={this.toggleLockAll}
                                        title={this.state.allDrawingsLocked ? 'Unlock all drawings for editing' : 'Lock all drawings from editing'}
                                        aria-pressed={this.state.allDrawingsLocked}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px 6px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            color: this.state.allDrawingsLocked ? 'var(--calcite-color-status-danger, #dc3545)' : 'var(--calcite-color-text-2, #4b5563)',
                                            fontSize: '11px',
                                            fontWeight: 500,
                                            borderRadius: '4px',
                                            transition: 'background 0.15s',
                                            whiteSpace: 'nowrap',
                                            flexShrink: 0
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                    >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill={this.state.allDrawingsLocked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                            {this.state.allDrawingsLocked ? (
                                                <>
                                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor"></path>
                                                </>
                                            ) : (
                                                <>
                                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                                    <path d="M7 11V7a5 5 0 0 1 9.9-1" fill="none"></path>
                                                </>
                                            )}
                                        </svg>
                                        <span>{this.state.allDrawingsLocked ? this.props.nls('unlockAll') : this.props.nls('lockAll')}</span>
                                    </button>
                                )}

                                {/* Measure All / Hide All Measurements Button */}
                                {(() => {
                                    const nonTextDrawings = drawings.filter(d => asExtendedGraphic(d).symbol?.type !== 'text');
                                    if (nonTextDrawings.length === 0) return null;

                                    const anyMeasurementsVisible = nonTextDrawings.some(d => {
                                        const ext = asExtendedGraphic(d);
                                        const has =
                                            (ext as any).measure?.graphic ||
                                            ext.attributes?.hadMeasurements ||
                                            ext.attributes?.measurementsPermanent ||
                                            (ext.attributes?.relatedMeasurementLabels?.length > 0) ||
                                            (ext.attributes?.relatedSegmentLabels?.length > 0);
                                        return has && !ext.attributes?.measurementsHidden;
                                    });

                                    return (
                                        <button
                                            onClick={this.toggleAllMeasurements}
                                            title={anyMeasurementsVisible ? this.props.nls('hideAllMeasurements') : this.props.nls('showMeasurementsOnAllDrawings')}
                                            aria-label={anyMeasurementsVisible ? this.props.nls('hideAllMeasurements') : this.props.nls('showMeasurementsOnAllDrawings')}
                                            aria-pressed={anyMeasurementsVisible}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '4px 6px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                color: anyMeasurementsVisible ? 'var(--calcite-color-brand, #0066cc)' : 'var(--calcite-color-text-2, #4b5563)',
                                                fontSize: '11px',
                                                fontWeight: 500,
                                                borderRadius: '4px',
                                                transition: 'background 0.15s',
                                                outline: 'none',
                                                whiteSpace: 'nowrap',
                                                flexShrink: 0
                                            }}
                                            onFocus={(e) => {
                                                e.currentTarget.style.boxShadow = '0 0 0 2px var(--calcite-color-brand, #0066cc)';
                                            }}
                                            onBlur={(e) => {
                                                e.currentTarget.style.boxShadow = 'none';
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                <rect x="1" y="6" width="22" height="12" rx="1" ry="1" transform="rotate(-45 12 12)"></rect>
                                                <line x1="7" y1="7" x2="7" y2="10"></line>
                                                <line x1="10" y1="7" x2="10" y2="9"></line>
                                                <line x1="13" y1="7" x2="13" y2="10"></line>
                                                <line x1="16" y1="7" x2="16" y2="9"></line>
                                                {!anyMeasurementsVisible && (
                                                    <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2.5"></line>
                                                )}
                                            </svg>
                                            <span>{anyMeasurementsVisible ? this.props.nls('hideMeasurements') : this.props.nls('showMeasurements')}</span>
                                        </button>
                                    );
                                })()}
                            </div>
                        );

                        if (drawings.length === 0) {
                            return (
                                <div className="text-center p-3 border rounded" style={{ backgroundColor: 'var(--calcite-color-foreground-1, #fff)' }}>
                                    <p className="mb-0">{this.props.nls('noDrawingsAvailableCreateADrawingInTheDrawTab')}</p>
                                </div>
                            );
                        }

                        if (searchFilter && filteredDrawings.length === 0) {
                            return (
                                <>
                                    {collapseAllButton}
                                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--calcite-color-text-3, #999)' }}>
                                        <i className="fas fa-search" style={{ fontSize: '24px', marginBottom: '10px' }}></i>
                                        <div>No drawings match "{searchFilter}"</div>
                                        <button
                                            onClick={this.clearSearchFilter}
                                            style={{
                                                marginTop: '10px',
                                                padding: '8px 16px',
                                                background: 'var(--calcite-color-brand, #007bff)',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer'
                                            }}
                                        >{this.props.nls('clearFilter')}</button>
                                    </div>
                                </>
                            );
                        }

                        return (
                            <>
                                {collapseAllButton}
                                {(() => {
                                    // PERFORMANCE FIX: Pre-calculate index map to avoid O(n²) lookup
                                    // This creates a Map for O(1) lookup instead of using findIndex (O(n)) inside the map loop
                                    const indexMap = new Map<ExtendedGraphic, number>();
                                    drawings.forEach((graphic, idx) => {
                                        indexMap.set(graphic, idx);
                                    });

                                    return filteredDrawings.map((graphic, originalIndex) => {
                                        // FAST: O(1) lookup using Map.get() instead of O(n) findIndex
                                        const index = indexMap.get(graphic)!;
                                        return (
                                            <div
                                                id={`drawing-item-${index}`}
                                                key={`${graphic.attributes?.uniqueId || index}-${this.state.listRenderKey}`}
                                                className={`drawing-item ${selectedGraphicIndex === index ? 'selected-drawing' : ''} ${this.state.draggedIndex === index ? 'dragging' : ''} ${this.state.dragOverIndex === index ? 'drag-over' : ''}`}
                                                onClick={() => this.handleListItemClick(graphic, index)}
                                                draggable={true}
                                                onDragStart={(e) => this.handleDragStart(e, index)}
                                                onDragEnd={this.handleDragEnd}
                                                onDragOver={(e) => this.handleDragOver(e, index)}
                                                onDragLeave={this.handleDragLeave}
                                                onDrop={(e) => this.handleDrop(e, index)}
                                                role="listitem"
                                                aria-selected={selectedGraphicIndex === index}
                                                aria-grabbed={this.state.draggedIndex === index}
                                                tabIndex={0}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        this.handleListItemClick(graphic, index);
                                                    }
                                                }}
                                                title={this.props.nls('dragToReorder')}
                                            >
                                                <div className="drawing-item-content">
                                                    {/* Row 1: Collapse caret, checkbox, and name */}
                                                    <div className="drawing-item-header" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {/* Collapse/Expand Caret Button - First */}
                                                        <button
                                                            className="collapse-toggle-btn"
                                                            onClick={(e) => this.toggleDrawingCollapse(index, e)}
                                                            aria-label={`${this.state.collapsedDrawings.has(index) ? 'Expand' : 'Collapse'} ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                            title={`${this.state.collapsedDrawings.has(index) ? 'Expand' : 'Collapse'} drawing`}
                                                            style={{
                                                                background: 'transparent',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                padding: '2px 4px',
                                                                opacity: 0.5,
                                                                transition: 'all 0.2s',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                marginRight: '0',
                                                                color: 'var(--calcite-color-text-2, #6c757d)',
                                                                flexShrink: 0
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                e.currentTarget.style.opacity = '1';
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.currentTarget.style.opacity = '0.5';
                                                            }}
                                                        >
                                                            <svg
                                                                width="10"
                                                                height="10"
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                strokeWidth="2.5"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                aria-hidden="true"
                                                                style={{
                                                                    pointerEvents: 'none',
                                                                    transform: this.state.collapsedDrawings.has(index) ? 'rotate(0deg)' : 'rotate(90deg)',
                                                                    transition: 'transform 0.2s'
                                                                }}
                                                            >
                                                                <polyline points="9 18 15 12 9 6"></polyline>
                                                            </svg>
                                                        </button>

                                                        {/* Checkbox - Second */}
                                                        <div className="drawing-item-checkbox" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                                            <label className="cursor-pointer" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', margin: 0, padding: 0, lineHeight: 1 }}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="form-check-input"
                                                                    checked={selectedGraphics.has(index)}
                                                                    onClick={(e) => this.handleToggleSelect(index, e)}
                                                                    aria-label={`Select drawing: ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                    title={`Select ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                    id={`checkbox-drawing-${index}`}
                                                                    style={{ margin: 0, verticalAlign: 'middle' }}
                                                                />
                                                                <span className="sr-only">
                                                                    Select {graphic.attributes?.name || `Drawing ${index + 1}`}
                                                                </span>
                                                            </label>
                                                        </div>

                                                        {/* Drawing name + type/date inline */}
                                                        <div className="drawing-item-info-inline" style={{ flex: '1 1 0', minWidth: '0', overflow: 'hidden' }}>
                                                            {editingGraphicIndex === index ? (
                                                                <div className="form-group mb-0" onClick={(e) => e.stopPropagation()}>
                                                                    <label htmlFor={`edit-name-input-${index}`} className="sr-only">{this.props.nls('editDrawingName')}</label>
                                                                    <input
                                                                        id={`edit-name-input-${index}`}
                                                                        type="text"
                                                                        className="form-control drawing-name-input"
                                                                        value={graphic.attributes?.name || ''}
                                                                        onChange={(e) => {
                                                                            const inputValue = e.target.value;
                                                                            this.handleNameChange(index, inputValue);
                                                                        }}
                                                                        onBlur={this.saveNameEdit}
                                                                        onKeyDown={(e) => {
                                                                            e.stopPropagation();
                                                                            if (e.key === 'Enter') {
                                                                                this.saveNameEdit();
                                                                            }
                                                                        }}
                                                                        autoFocus
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        spellCheck="false"
                                                                        autoComplete="off"
                                                                        autoCorrect="off"
                                                                        aria-label={this.props.nls('editDrawingName')}
                                                                        title={this.props.nls('editDrawingName')}
                                                                        style={{
                                                                            whiteSpace: 'pre-wrap',
                                                                            wordBreak: 'normal',
                                                                            wordSpacing: 'normal',
                                                                            textTransform: 'none',
                                                                            marginBottom: '8px'
                                                                        }}
                                                                    />
                                                                    <div className="d-flex gap-2">
                                                                        <Button
                                                                            size="sm"
                                                                            className="mr-2"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                this.saveNameEdit();
                                                                            }}
                                                                            title={this.props.nls('saveName')}
                                                                            aria-label="Save drawing name"
                                                                        >
                                                                            Save
                                                                        </Button>
                                                                        <Button
                                                                            size="sm"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                this.cancelNameEdit();
                                                                            }}
                                                                            title={this.props.nls('cancelEditing')}
                                                                            aria-label="Cancel name editing"
                                                                        >
                                                                            Cancel
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.4' }}>
                                                                    <span style={{ fontWeight: 'bold', display: 'inline' }}>
                                                                        {this.isDrawingLocked(graphic) && <span title="Locked" style={{ display: 'inline-flex', alignItems: 'center', marginRight: '4px', verticalAlign: 'middle' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="var(--calcite-color-text-3, #999)" stroke="var(--calcite-color-text-3, #999)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"></path></svg></span>}
                                                                        {(graphic.symbol?.type === 'text' && graphic.symbol?.text) ||
                                                                            graphic.attributes?.name ||
                                                                            `Drawing ${index + 1}`}
                                                                    </span>
                                                                    <span style={{ fontSize: '11px', color: 'var(--calcite-color-text-2, #6c757d)', marginLeft: '8px', display: 'inline' }}>
                                                                        {this.getDrawingTypeLabel(graphic)}
                                                                        {graphic.attributes?.createdDate && ` · ${this.formatCreatedDate(graphic.attributes.createdDate)}`}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Row 2: Tool icons - wraps at narrow widths */}
                                                    {!this.state.collapsedDrawings.has(index) && (
                                                        <div className="drawing-icons-type-row" style={{ display: 'flex', alignItems: 'center', paddingLeft: '24px', gap: '4px', boxSizing: 'border-box', maxWidth: '100%', flexWrap: 'wrap', rowGap: '2px' }}>
                                                            <div className="drawing-icons-container" style={{ display: 'flex', gap: '1px', alignItems: 'center', flexShrink: 0 }}>
                                                                {/* Label Button dropdown */}
                                                                {(() => {
                                                                    // Determine if this drawing has labels active
                                                                    const individualOption = graphic.attributes?.individualLabelOption || 'default';
                                                                    const effectiveLabelOption = individualOption === 'default' ? this.state.drawingLabelOption : individualOption;
                                                                    const hasLabels = effectiveLabelOption !== 'off';
                                                                    const dropdownId = `label-${index}`;
                                                                    const isOpen = this.state.openDropdownIndex === dropdownId;

                                                                    return (
                                                                        <div
                                                                            className={`label-dropdown ${isOpen ? 'active' : ''}`}
                                                                            style={{
                                                                                position: 'relative',
                                                                                display: 'inline-block'
                                                                            }}
                                                                        >
                                                                            <button
                                                                                id={`label-btn-${index}`}
                                                                                className="label-btn"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    this.toggleDropdown(dropdownId);
                                                                                }}
                                                                                aria-label={`Label options for ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                                title={`Labels: ${individualOption === 'default' ? `Default (${this.state.drawingLabelOption})` : individualOption}`}
                                                                                aria-haspopup="true"
                                                                                aria-expanded={isOpen}
                                                                                style={{
                                                                                    position: 'relative',
                                                                                    background: 'transparent',
                                                                                    border: '1px solid transparent',
                                                                                    cursor: 'pointer',
                                                                                    padding: '3px',
                                                                                    opacity: hasLabels ? 0.8 : 0.6,
                                                                                    transition: 'opacity 0.2s',
                                                                                    width: '24px',
                                                                                    height: '24px',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    justifyContent: 'center',
                                                                                    color: hasLabels ? 'var(--calcite-color-brand, #0066cc)' : 'var(--calcite-color-text-2, #6c757d)',
                                                                                    marginLeft: '0'
                                                                                }}
                                                                                onMouseEnter={(e) => {
                                                                                    e.currentTarget.style.opacity = '1';
                                                                                    e.currentTarget.style.borderColor = 'var(--calcite-color-border-3, #ddd)';
                                                                                }}
                                                                                onMouseLeave={(e) => {
                                                                                    e.currentTarget.style.opacity = hasLabels ? '0.8' : '0.6';
                                                                                    e.currentTarget.style.borderColor = 'transparent';
                                                                                }}
                                                                            >
                                                                                {/* Price tag/label icon */}
                                                                                <svg
                                                                                    width="14"
                                                                                    height="14"
                                                                                    viewBox="0 0 24 24"
                                                                                    fill="none"
                                                                                    stroke={hasLabels ? 'var(--calcite-color-brand, #0066cc)' : 'var(--calcite-color-text-2, #6c757d)'}
                                                                                    strokeWidth="2"
                                                                                    strokeLinecap="round"
                                                                                    strokeLinejoin="round"
                                                                                    aria-hidden="true"
                                                                                    style={{ pointerEvents: 'none' }}
                                                                                >
                                                                                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                                                                                    <circle
                                                                                        cx="7"
                                                                                        cy="7"
                                                                                        r="1.5"
                                                                                        fill={hasLabels ? 'var(--calcite-color-brand, #0066cc)' : 'none'}
                                                                                        stroke={hasLabels ? 'var(--calcite-color-brand, #0066cc)' : 'var(--calcite-color-text-2, #6c757d)'}
                                                                                        strokeWidth="1.5"
                                                                                    />
                                                                                </svg>
                                                                            </button>

                                                                            {/* Dropdown menu - portaled to body */}
                                                                            {isOpen && ReactDOM.createPortal(
                                                                                <div
                                                                                    className="label-dropdown-menu"
                                                                                    role="menu"
                                                                                    aria-label={`Label options for ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                                    style={{
                                                                                        position: 'fixed',
                                                                                        top: (() => {
                                                                                            const btn = document.getElementById(`label-btn-${index}`);
                                                                                            if (btn) {
                                                                                                const rect = btn.getBoundingClientRect();
                                                                                                const spaceBelow = window.innerHeight - rect.bottom;
                                                                                                const menuHeight = 200;
                                                                                                if (spaceBelow < menuHeight && rect.top > menuHeight) {
                                                                                                    return rect.top - menuHeight - 4;
                                                                                                }
                                                                                                return rect.bottom + 4;
                                                                                            }
                                                                                            return 0;
                                                                                        })(),
                                                                                        left: (() => {
                                                                                            const btn = document.getElementById(`label-btn-${index}`);
                                                                                            if (btn) {
                                                                                                const rect = btn.getBoundingClientRect();
                                                                                                return Math.max(8, rect.right - 160);
                                                                                            }
                                                                                            return 0;
                                                                                        })(),
                                                                                        backgroundColor: 'var(--calcite-color-foreground-1, #ffffff)',
                                                                                        minWidth: '160px',
                                                                                        boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
                                                                                        zIndex: 999999,
                                                                                        borderRadius: '8px',
                                                                                        border: '2px solid var(--calcite-color-border-3, #dee2e6)'
                                                                                    }}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                >
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            this.handleIndividualLabelOptionChange(index, 'default');
                                                                                            this.setState({ openDropdownIndex: null });
                                                                                        }}
                                                                                        role="menuitem"
                                                                                        title={`Use default setting (${this.state.drawingLabelOption})`}
                                                                                        style={{
                                                                                            display: 'block',
                                                                                            width: '100%',
                                                                                            padding: '10px 16px',
                                                                                            textAlign: 'left',
                                                                                            border: 'none',
                                                                                            background: 'transparent',
                                                                                            cursor: 'pointer',
                                                                                            fontSize: '13px',
                                                                                            color: 'var(--calcite-color-text-1, #212529)',
                                                                                            fontWeight: individualOption === 'default' ? 'bold' : 'normal'
                                                                                        }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                                    >
                                                                                        Default
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            this.handleIndividualLabelOptionChange(index, 'off');
                                                                                            this.setState({ openDropdownIndex: null });
                                                                                        }}
                                                                                        role="menuitem"
                                                                                        title="Hide labels for this drawing"
                                                                                        style={{
                                                                                            display: 'block',
                                                                                            width: '100%',
                                                                                            padding: '10px 16px',
                                                                                            textAlign: 'left',
                                                                                            border: 'none',
                                                                                            background: 'transparent',
                                                                                            cursor: 'pointer',
                                                                                            fontSize: '13px',
                                                                                            color: 'var(--calcite-color-text-1, #212529)',
                                                                                            fontWeight: individualOption === 'off' ? 'bold' : 'normal'
                                                                                        }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                                    >{this.props.nls('off')}</button>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            this.handleIndividualLabelOptionChange(index, 'name');
                                                                                            this.setState({ openDropdownIndex: null });
                                                                                        }}
                                                                                        role="menuitem"
                                                                                        title="Show only drawing name"
                                                                                        style={{
                                                                                            display: 'block',
                                                                                            width: '100%',
                                                                                            padding: '10px 16px',
                                                                                            textAlign: 'left',
                                                                                            border: 'none',
                                                                                            background: 'transparent',
                                                                                            cursor: 'pointer',
                                                                                            fontSize: '13px',
                                                                                            color: 'var(--calcite-color-text-1, #212529)',
                                                                                            fontWeight: individualOption === 'name' ? 'bold' : 'normal'
                                                                                        }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                                    >
                                                                                        Name
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            this.handleIndividualLabelOptionChange(index, 'notes');
                                                                                            this.setState({ openDropdownIndex: null });
                                                                                        }}
                                                                                        role="menuitem"
                                                                                        title="Show only notes"
                                                                                        style={{
                                                                                            display: 'block',
                                                                                            width: '100%',
                                                                                            padding: '10px 16px',
                                                                                            textAlign: 'left',
                                                                                            border: 'none',
                                                                                            background: 'transparent',
                                                                                            cursor: 'pointer',
                                                                                            fontSize: '13px',
                                                                                            color: 'var(--calcite-color-text-1, #212529)',
                                                                                            fontWeight: individualOption === 'notes' ? 'bold' : 'normal'
                                                                                        }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                                    >
                                                                                        Notes
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            this.handleIndividualLabelOptionChange(index, 'both');
                                                                                            this.setState({ openDropdownIndex: null });
                                                                                        }}
                                                                                        role="menuitem"
                                                                                        title="Show both name and notes"
                                                                                        style={{
                                                                                            display: 'block',
                                                                                            width: '100%',
                                                                                            padding: '10px 16px',
                                                                                            textAlign: 'left',
                                                                                            border: 'none',
                                                                                            background: 'transparent',
                                                                                            cursor: 'pointer',
                                                                                            fontSize: '13px',
                                                                                            color: 'var(--calcite-color-text-1, #212529)',
                                                                                            fontWeight: individualOption === 'both' ? 'bold' : 'normal'
                                                                                        }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                                    >
                                                                                        Both
                                                                                    </button>
                                                                                </div>,
                                                                                document.body
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })()}
                                                                {/* Notes Button - positioned to left of eye icon */}
                                                                <button
                                                                    className="notes-btn"
                                                                    onClick={(e) => this.openNotesDialog(index, e)}
                                                                    aria-label={`Notes for ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                    title={graphic.attributes?.notes ? 'View/Edit notes (has notes)' : this.props.nls('addNotes')}
                                                                    style={{
                                                                        background: 'transparent',
                                                                        border: '1px solid transparent',
                                                                        cursor: 'pointer',
                                                                        padding: '3px',
                                                                        opacity: graphic.attributes?.notes ? 0.8 : 0.6,
                                                                        transition: 'opacity 0.2s',
                                                                        width: '24px',
                                                                        height: '24px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        zIndex: 10,
                                                                        color: graphic.attributes?.notes ? 'var(--calcite-color-brand, #0066cc)' : 'var(--calcite-color-text-2, #6c757d)'
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        e.currentTarget.style.opacity = '1';
                                                                        e.currentTarget.style.borderColor = 'var(--calcite-color-border-3, #ddd)';
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.opacity = graphic.attributes?.notes ? '0.8' : '0.6';
                                                                        e.currentTarget.style.borderColor = 'transparent';
                                                                    }}
                                                                >
                                                                    {/* Notepad/document icon */}
                                                                    <svg
                                                                        width="14"
                                                                        height="14"
                                                                        viewBox="0 0 24 24"
                                                                        fill={graphic.attributes?.notes ? 'currentColor' : 'none'}
                                                                        stroke="currentColor"
                                                                        strokeWidth="2"
                                                                        strokeLinecap="round"
                                                                        strokeLinejoin="round"
                                                                        aria-hidden="true"
                                                                        style={{ pointerEvents: 'none' }}
                                                                    >
                                                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                                                        <polyline points="14 2 14 8 20 8"></polyline>
                                                                        <line x1="16" y1="13" x2="8" y2="13"></line>
                                                                        <line x1="16" y1="17" x2="8" y2="17"></line>
                                                                        <polyline points="10 9 9 9 8 9"></polyline>
                                                                    </svg>
                                                                </button>
                                                                {/* Measurement Toggle - Ruler Icon */}
                                                                {(() => {
                                                                    // Show for any non-text drawing (any geometry that can be measured)
                                                                    const isTextSymbol = graphic.symbol?.type === 'text';
                                                                    if (isTextSymbol) return null;

                                                                    const measurementsHidden = graphic.attributes?.measurementsHidden === true;
                                                                    const graphicUid = graphic.attributes?.uniqueId;
                                                                    const hasMeasurements =
                                                                        (graphic as any).measure?.graphic ||
                                                                        graphic.attributes?.hadMeasurements ||
                                                                        graphic.attributes?.measurementsPermanent ||
                                                                        (graphic.attributes?.relatedMeasurementLabels?.length > 0) ||
                                                                        (graphic.attributes?.relatedSegmentLabels?.length > 0);
                                                                    // Show blue when has measurements and not hidden, or gray-with-slash when hidden
                                                                    const isActive = hasMeasurements && !measurementsHidden;
                                                                    // Icon should look "has something" even when hidden (so user knows they can toggle back)
                                                                    const hasOrHadMeasurements = hasMeasurements || measurementsHidden;
                                                                    return (
                                                                        <button
                                                                            className="measurement-toggle-btn"
                                                                            onClick={(e) => this.toggleMeasurementVisibility(index, e)}
                                                                            aria-label={`${!hasOrHadMeasurements ? this.props.nls('add') : measurementsHidden ? 'Show' : 'Hide'} measurements for ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                            aria-pressed={isActive}
                                                                            title={!hasOrHadMeasurements ? 'Add measurements' : measurementsHidden ? 'Show measurements' : 'Hide measurements'}
                                                                            style={{
                                                                                background: 'transparent',
                                                                                border: '1px solid transparent',
                                                                                cursor: 'pointer',
                                                                                padding: '3px',
                                                                                opacity: isActive ? 0.8 : 0.5,
                                                                                transition: 'opacity 0.2s',
                                                                                width: '24px',
                                                                                height: '24px',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'center',
                                                                                zIndex: 10,
                                                                                color: isActive ? 'var(--calcite-color-brand, #0066cc)' : 'var(--calcite-color-text-2, #6c757d)',
                                                                                outline: 'none'
                                                                            }}
                                                                            onFocus={(e) => {
                                                                                e.currentTarget.style.boxShadow = '0 0 0 2px var(--calcite-color-brand, #0066cc)';
                                                                                e.currentTarget.style.borderRadius = '4px';
                                                                            }}
                                                                            onBlur={(e) => {
                                                                                e.currentTarget.style.boxShadow = 'none';
                                                                            }}
                                                                            onMouseEnter={(e) => {
                                                                                e.currentTarget.style.opacity = '1';
                                                                                e.currentTarget.style.borderColor = 'var(--calcite-color-border-3, #ddd)';
                                                                            }}
                                                                            onMouseLeave={(e) => {
                                                                                e.currentTarget.style.opacity = isActive ? '0.8' : '0.5';
                                                                                e.currentTarget.style.borderColor = 'transparent';
                                                                            }}
                                                                        >
                                                                            {/* Ruler icon */}
                                                                            <svg
                                                                                width="14"
                                                                                height="14"
                                                                                viewBox="0 0 24 24"
                                                                                fill="none"
                                                                                stroke="currentColor"
                                                                                strokeWidth="2"
                                                                                strokeLinecap="round"
                                                                                strokeLinejoin="round"
                                                                                aria-hidden="true"
                                                                                style={{ pointerEvents: 'none' }}
                                                                            >
                                                                                {/* Ruler body */}
                                                                                <rect x="1" y="6" width="22" height="12" rx="1" ry="1" transform="rotate(-45 12 12)"></rect>
                                                                                {/* Ruler tick marks */}
                                                                                <line x1="7" y1="7" x2="7" y2="10"></line>
                                                                                <line x1="10" y1="7" x2="10" y2="9"></line>
                                                                                <line x1="13" y1="7" x2="13" y2="10"></line>
                                                                                <line x1="16" y1="7" x2="16" y2="9"></line>
                                                                                {measurementsHidden && (
                                                                                    <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2.5" stroke="currentColor"></line>
                                                                                )}
                                                                            </svg>
                                                                        </button>
                                                                    );
                                                                })()}
                                                                {/* Visibility Toggle - Eye Icon */}
                                                                <button
                                                                    className="visibility-toggle-btn"
                                                                    onClick={(e) => this.toggleGraphicVisibility(index, e)}
                                                                    aria-label={`${graphic.visible !== false ? 'Hide' : 'Show'} ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                    title={`${graphic.visible !== false ? 'Hide' : 'Show'} drawing`}
                                                                    style={{
                                                                        background: 'transparent',
                                                                        border: '1px solid transparent',
                                                                        cursor: 'pointer',
                                                                        padding: '3px',
                                                                        opacity: 0.6,
                                                                        transition: 'opacity 0.2s',
                                                                        width: '24px',
                                                                        height: '24px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        zIndex: 10,
                                                                        color: 'var(--calcite-color-text-2, #6c757d)'
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        e.currentTarget.style.opacity = '1';
                                                                        e.currentTarget.style.borderColor = 'var(--calcite-color-border-3, #ddd)';
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.opacity = '0.6';
                                                                        e.currentTarget.style.borderColor = 'transparent';
                                                                    }}
                                                                >
                                                                    {graphic.visible !== false ? (
                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                                            <circle cx="12" cy="12" r="3"></circle>
                                                                        </svg>
                                                                    ) : (
                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                                            <circle cx="12" cy="12" r="3"></circle>
                                                                            <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2.5"></line>
                                                                        </svg>
                                                                    )}
                                                                </button>
                                                                {/* Lock Toggle */}
                                                                {this.ff('enableLock') && (() => {
                                                                    const isLocked = this.isDrawingLocked(graphic);
                                                                    return (
                                                                        <button
                                                                            className="lock-toggle-btn"
                                                                            onClick={(e) => this.toggleDrawingLock(index, e)}
                                                                            aria-label={`${isLocked ? 'Unlock' : 'Lock'} ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                            title={isLocked ? this.props.nls('unlockDrawingForEditing') : 'Lock drawing from editing'}
                                                                            style={{
                                                                                background: 'transparent',
                                                                                border: '1px solid transparent',
                                                                                cursor: 'pointer',
                                                                                padding: '3px',
                                                                                opacity: isLocked ? 0.9 : 0.5,
                                                                                transition: 'opacity 0.2s',
                                                                                width: '24px',
                                                                                height: '24px',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'center',
                                                                                color: isLocked ? 'var(--calcite-color-status-danger, #dc3545)' : 'var(--calcite-color-text-2, #6c757d)'
                                                                            }}
                                                                            onMouseEnter={(e) => {
                                                                                e.currentTarget.style.opacity = '1';
                                                                                e.currentTarget.style.borderColor = 'var(--calcite-color-border-3, #ddd)';
                                                                            }}
                                                                            onMouseLeave={(e) => {
                                                                                e.currentTarget.style.opacity = isLocked ? '0.9' : '0.5';
                                                                                e.currentTarget.style.borderColor = 'transparent';
                                                                            }}
                                                                        >
                                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill={isLocked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                                                {isLocked ? (
                                                                                    <>
                                                                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                                                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor"></path>
                                                                                    </>
                                                                                ) : (
                                                                                    <>
                                                                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                                                                        <path d="M7 11V7a5 5 0 0 1 9.9-1" fill="none"></path>
                                                                                    </>
                                                                                )}
                                                                            </svg>
                                                                        </button>
                                                                    );
                                                                })()}
                                                                {/* Separator */}
                                                                <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--calcite-color-border-3, #dee2e6)', margin: '0 2px' }} aria-hidden="true" />
                                                                {/* Zoom to Drawing */}
                                                                <button
                                                                    className="zoom-to-btn"
                                                                    onClick={(e) => this.zoomToDrawing(index, e)}
                                                                    aria-label={`Zoom to ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                    title={this.props.nls('SelectionZoomTo')}
                                                                    style={{
                                                                        background: 'transparent',
                                                                        border: '1px solid transparent',
                                                                        cursor: 'pointer',
                                                                        padding: '3px',
                                                                        opacity: 0.6,
                                                                        transition: 'opacity 0.2s',
                                                                        width: '24px',
                                                                        height: '24px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        color: 'var(--calcite-color-text-2, #6c757d)'
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        e.currentTarget.style.opacity = '1';
                                                                        e.currentTarget.style.borderColor = 'var(--calcite-color-border-3, #ddd)';
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.opacity = '0.6';
                                                                        e.currentTarget.style.borderColor = 'transparent';
                                                                    }}
                                                                >
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                                        <circle cx="11" cy="11" r="8"></circle>
                                                                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                                                        <line x1="11" y1="8" x2="11" y2="14"></line>
                                                                        <line x1="8" y1="11" x2="14" y2="11"></line>
                                                                    </svg>
                                                                </button>
                                                                {/* Move Up */}
                                                                <button
                                                                    className="move-up-btn"
                                                                    onClick={(e) => this.moveDrawingUp(index, e)}
                                                                    disabled={index === 0}
                                                                    aria-label={`Move ${graphic.attributes?.name || `Drawing ${index + 1}`} up`}
                                                                    title={index === 0 ? this.props.nls('alreadyAtTop') : this.props.nls('moveUp')}
                                                                    style={{
                                                                        background: 'transparent',
                                                                        border: '1px solid transparent',
                                                                        cursor: index === 0 ? 'not-allowed' : 'pointer',
                                                                        padding: '3px',
                                                                        opacity: index === 0 ? 0.3 : 0.6,
                                                                        transition: 'opacity 0.2s',
                                                                        width: '24px',
                                                                        height: '24px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        color: 'var(--calcite-color-text-2, #6c757d)'
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        if (index !== 0) {
                                                                            e.currentTarget.style.opacity = '1';
                                                                            e.currentTarget.style.borderColor = 'var(--calcite-color-border-3, #ddd)';
                                                                        }
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.opacity = index === 0 ? '0.3' : '0.6';
                                                                        e.currentTarget.style.borderColor = 'transparent';
                                                                    }}
                                                                >
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                                        <polyline points="18 15 12 9 6 15"></polyline>
                                                                    </svg>
                                                                </button>
                                                                {/* Move Down */}
                                                                <button
                                                                    className="move-down-btn"
                                                                    onClick={(e) => this.moveDrawingDown(index, e)}
                                                                    disabled={index === this.state.drawings.length - 1}
                                                                    aria-label={`Move ${graphic.attributes?.name || `Drawing ${index + 1}`} down`}
                                                                    title={index === this.state.drawings.length - 1 ? this.props.nls('alreadyAtBottom') : this.props.nls('moveDown')}
                                                                    style={{
                                                                        background: 'transparent',
                                                                        border: '1px solid transparent',
                                                                        cursor: index === this.state.drawings.length - 1 ? 'not-allowed' : 'pointer',
                                                                        padding: '3px',
                                                                        opacity: index === this.state.drawings.length - 1 ? 0.3 : 0.6,
                                                                        transition: 'opacity 0.2s',
                                                                        width: '24px',
                                                                        height: '24px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        color: 'var(--calcite-color-text-2, #6c757d)'
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        if (index !== this.state.drawings.length - 1) {
                                                                            e.currentTarget.style.opacity = '1';
                                                                            e.currentTarget.style.borderColor = 'var(--calcite-color-border-3, #ddd)';
                                                                        }
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.opacity = index === this.state.drawings.length - 1 ? '0.3' : '0.6';
                                                                        e.currentTarget.style.borderColor = 'transparent';
                                                                    }}
                                                                >
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                                                                        <polyline points="6 9 12 15 18 9"></polyline>
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Action Buttons - Hidden when collapsed */}
                                                    {!this.state.collapsedDrawings.has(index) && (
                                                        <div className="button-container">
                                                            <Button
                                                                size="sm"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    this.handleCopyDrawing(index, e);
                                                                }}
                                                                className="btn-light"
                                                                aria-label={`Copy ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                title={this.props.nls('copy')}
                                                            >
                                                                {this.props.nls('copy')}
                                                            </Button>

                                                            <Button
                                                                size="sm"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    this.startEditing(index, e);
                                                                }}
                                                                className="btn-light"
                                                                disabled={this.isDrawingLocked(graphic)}
                                                                aria-label={`Rename ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                title={this.isDrawingLocked(graphic) ? this.props.nls('unlockToRename') : this.props.nls('rename')}
                                                            >
                                                                {this.props.nls('rename')}
                                                            </Button>

                                                            {/* Export with Dropdown - Click Version */}
                                                            {this.ff('enableExport') && (
                                                                <div
                                                                    className={`export-dropdown ${this.state.openDropdownIndex === index ? 'active' : ''}`}
                                                                    style={{ position: 'relative', display: 'inline-block' }}
                                                                >
                                                                    <Button
                                                                        size="sm"
                                                                        className="btn-light export-trigger-btn"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            e.preventDefault();
                                                                            this.toggleDropdown(index);
                                                                        }}
                                                                        aria-label={`Export ${graphic.attributes?.name || `Drawing ${index + 1}`} - choose format`}
                                                                        title="Export - click to toggle menu"
                                                                        aria-haspopup="true"
                                                                        aria-expanded={this.state.openDropdownIndex === index}
                                                                        id={`export-btn-${index}`}
                                                                    >
                                                                        Export
                                                                    </Button>
                                                                    {/* Dropdown content - non-portaled version for reliability */}
                                                                    {this.state.openDropdownIndex === index && (
                                                                        <div
                                                                            className={`export-dropdown-content ${this.state.dropdownOpenUpward.has(index) ? 'open-upward' : ''}`}
                                                                            role="menu"
                                                                            aria-label={`Export formats for ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                            style={{
                                                                                display: 'block',
                                                                                position: 'absolute',
                                                                                top: this.state.dropdownOpenUpward.has(index) ? 'auto' : '100%',
                                                                                bottom: this.state.dropdownOpenUpward.has(index) ? '100%' : 'auto',
                                                                                left: '0',
                                                                                marginTop: this.state.dropdownOpenUpward.has(index) ? '0' : '4px',
                                                                                marginBottom: this.state.dropdownOpenUpward.has(index) ? '4px' : '0',
                                                                                backgroundColor: 'var(--calcite-color-foreground-1, #ffffff)',
                                                                                minWidth: '200px',
                                                                                boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
                                                                                zIndex: 999999,
                                                                                borderRadius: '8px',
                                                                                border: '2px solid var(--calcite-color-border-3, #dee2e6)'
                                                                            }}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                        >
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    this.handleExportSingleWithFormat(index, 'geojson', e);
                                                                                    this.setState({ openDropdownIndex: null });
                                                                                }}
                                                                                role="menuitem"
                                                                                title={this.props.nls('exportAsGeojsonFormat')}
                                                                                style={{
                                                                                    display: 'block',
                                                                                    width: '100%',
                                                                                    padding: '10px 16px',
                                                                                    textAlign: 'left',
                                                                                    border: 'none',
                                                                                    background: 'transparent',
                                                                                    cursor: 'pointer',
                                                                                    fontSize: '13px',
                                                                                    color: 'var(--calcite-color-text-1, #212529)',
                                                                                    whiteSpace: 'nowrap'
                                                                                }}
                                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                            >
                                                                                <i className="fas fa-map-marked-alt" aria-hidden="true"></i>
                                                                                {' '}Export as GeoJSON
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    this.handleExportSingleWithFormat(index, 'kml', e);
                                                                                    this.setState({ openDropdownIndex: null });
                                                                                }}
                                                                                role="menuitem"
                                                                                title={this.props.nls('exportAsKmlFormat')}
                                                                                style={{
                                                                                    display: 'block',
                                                                                    width: '100%',
                                                                                    padding: '10px 16px',
                                                                                    textAlign: 'left',
                                                                                    border: 'none',
                                                                                    background: 'transparent',
                                                                                    cursor: 'pointer',
                                                                                    fontSize: '13px',
                                                                                    color: 'var(--calcite-color-text-1, #212529)',
                                                                                    whiteSpace: 'nowrap'
                                                                                }}
                                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                            >
                                                                                <i className="fas fa-globe" aria-hidden="true"></i>
                                                                                {' '}Export as KML
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    this.handleExportSingleWithFormat(index, 'shapefile', e);
                                                                                    this.setState({ openDropdownIndex: null });
                                                                                }}
                                                                                role="menuitem"
                                                                                title={this.props.nls('exportAsShapefileFormatZip')}
                                                                                style={{
                                                                                    display: 'block',
                                                                                    width: '100%',
                                                                                    padding: '10px 16px',
                                                                                    textAlign: 'left',
                                                                                    border: 'none',
                                                                                    background: 'transparent',
                                                                                    cursor: 'pointer',
                                                                                    fontSize: '13px',
                                                                                    color: 'var(--calcite-color-text-1, #212529)',
                                                                                    whiteSpace: 'nowrap'
                                                                                }}
                                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                            >
                                                                                <i className="fas fa-layer-group" aria-hidden="true"></i>
                                                                                {' '}Export as Shapefile
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    this.handleExportSingleWithFormat(index, 'exb-draw', e);
                                                                                    this.setState({ openDropdownIndex: null });
                                                                                }}
                                                                                role="menuitem"
                                                                                title="Export as ArcGIS JSON (compatible with ExB Draw widget and ArcGIS Online)"
                                                                                style={{
                                                                                    display: 'block',
                                                                                    width: '100%',
                                                                                    padding: '10px 16px',
                                                                                    textAlign: 'left',
                                                                                    border: 'none',
                                                                                    background: 'transparent',
                                                                                    cursor: 'pointer',
                                                                                    fontSize: '13px',
                                                                                    color: 'var(--calcite-color-text-1, #212529)',
                                                                                    whiteSpace: 'nowrap'
                                                                                }}
                                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--calcite-color-foreground-2, #f8f9fa)'}
                                                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                            >
                                                                                <i className="fas fa-file-code" aria-hidden="true"></i>
                                                                                {' '}Export as JSON
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            <Button
                                                                size="sm"
                                                                type="danger"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    this.handleDeleteGraphic(index, e);
                                                                }}
                                                                disabled={this.isDrawingLocked(graphic)}
                                                                aria-label={`Delete ${graphic.attributes?.name || `Drawing ${index + 1}`}`}
                                                                title={this.isDrawingLocked(graphic) ? this.props.nls('unlockToDelete') : this.props.nls('delete')}
                                                            >
                                                                {this.props.nls('delete')}
                                                            </Button>
                                                        </div>
                                                    )}

                                                    {/* Style Editor - Hidden when collapsed or locked */}
                                                    {!this.state.collapsedDrawings.has(index) && selectedGraphicIndex === index && !this.isDrawingLocked(graphic) && (
                                                        <div
                                                            className="mt-3 border symbol-editor-container"
                                                            onClick={(e) => e.stopPropagation()}
                                                            role="region"
                                                            aria-label="Style editor"
                                                        >
                                                            {this.isSupportedSymbol(graphic.symbol, graphic.geometry?.type) ? (
                                                                (graphic.symbol as any)?.type === 'text' ? (
                                                                    <TextStyleEditor
                                                                        currentTextSymbol={this.state.currentTextSymbol}
                                                                        graphic={graphic}
                                                                        updateSymbol={(sym) => this.updateSymbolWithoutClosing(sym, index)}
                                                                        show={this.state.selectedGraphicIndex === index}
                                                                        nls={this.props.nls}
                                                                        onClose={() => {
                                                                            this.sketchViewModel?.cancel();
                                                                            this.setState({ selectedGraphicIndex: null, selectedGraphics: new Set() });
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <SymbolSelector
                                                                        symbol={graphic.symbol as any}
                                                                        jimuSymbolType={
                                                                            graphic.geometry?.type === 'point'
                                                                                ? JimuSymbolType.Point
                                                                                : graphic.geometry?.type === 'polyline'
                                                                                    ? JimuSymbolType.Polyline
                                                                                    : JimuSymbolType.Polygon
                                                                        }
                                                                        onPointSymbolChanged={(sym) => this.updateSymbolWithoutClosing(sym, index)}
                                                                        onPolylineSymbolChanged={(sym) => this.updateSymbolWithoutClosing(sym, index)}
                                                                        onPolygonSymbolChanged={(sym) => this.updateSymbolWithoutClosing(sym, index)}
                                                                    />
                                                                )
                                                            ) : (
                                                                <div className="text-muted p-2">{this.props.nls('thisSymbolTypeIsNotSupportedForStyleEditing')}</div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                            </>
                        );
                    })()}
                </div>
                {/* Hidden file input for import */}
                <input
                    type="file"
                    id="import-file"
                    accept=".json,.geojson,.kml,.zip,application/json,application/geo+json,application/vnd.google-earth.kml+xml,application/zip"
                    onChange={this.handleImport}
                    style={{ display: 'none' }}
                />
            </div>
        );

        return (
            <div
                className="my-drawings-panel p-2"
                style={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    ...whiteBackgroundStyle
                }}
            >
                {/* Screen reader alert area */}
                {showAlert && (
                    <div role="alert" aria-live="assertive">
                        <Alert
                            className={`edraw-alert edraw-alert-${alertType}`}
                            withIcon
                            open
                            type={alertType}
                            text={alertMessage}
                        />
                    </div>
                )}

                {/* Import Progress Indicator */}
                {this.state.importInProgress && (
                    <div
                        style={{
                            position: 'fixed',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            backgroundColor: 'white',
                            padding: '24px',
                            borderRadius: '8px',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                            zIndex: 100000,
                            minWidth: '320px',
                            maxWidth: '90vw',
                            textAlign: 'center'
                        }}
                        role="dialog"
                        aria-labelledby="importProgressTitle"
                        aria-live="polite"
                        aria-busy="true"
                    >
                        <h3
                            id="importProgressTitle"
                            style={{
                                marginTop: 0,
                                marginBottom: 16,
                                fontSize: 18,
                                fontWeight: 600,
                                color: 'var(--calcite-color-text-1, #1a1a1a)'
                            }}
                        >{this.props.nls('importingGeojson')}</h3>

                        {/* Progress Bar */}
                        <div
                            style={{
                                width: '100%',
                                height: '28px',
                                backgroundColor: 'var(--calcite-color-foreground-3, #e0e0e0)',
                                borderRadius: '14px',
                                overflow: 'hidden',
                                marginBottom: 12,
                                position: 'relative'
                            }}
                        >
                            <div
                                style={{
                                    width: `${this.state.importProgress}%`,
                                    height: '100%',
                                    backgroundColor: 'var(--calcite-color-brand, #0078d4)',
                                    transition: 'width 0.3s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'white',
                                    fontSize: '13px',
                                    fontWeight: 'bold',
                                    position: 'relative'
                                }}
                            >
                                {this.state.importProgress > 10 && `${this.state.importProgress}%`}
                            </div>
                            {this.state.importProgress <= 10 && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: '50%',
                                        left: '50%',
                                        transform: 'translate(-50%, -50%)',
                                        fontSize: '13px',
                                        fontWeight: 'bold',
                                        color: 'var(--calcite-color-text-2, #666)'
                                    }}
                                >
                                    {this.state.importProgress}%
                                </div>
                            )}
                        </div>

                        {/* Progress Message */}
                        <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--calcite-color-text-2, #666)' }}>
                            {this.state.importProgressMessage}
                        </p>

                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--calcite-color-text-3, #999)', fontStyle: 'italic' }}>{this.props.nls('pleaseWaitDoNotCloseThisWindow')}</p>
                    </div>
                )}

                {/* Accessible dialogs */}
                {confirmationDialog && (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="confirmationDialogTitle"
                        aria-describedby="confirmationDialogDescription"
                    >
                        {confirmationDialog}
                    </div>
                )}

                {importDialog && (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="importDialogTitle"
                        aria-describedby="importDialogDescription"
                    >
                        {importDialog}
                    </div>
                )}

                {/* Notes Dialog */}
                {this.state.notesDialogOpen &&
                    ReactDOM.createPortal(
                        <div
                            style={{
                                position: 'fixed',
                                inset: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                backdropFilter: 'blur(2px)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 99999,
                            }}
                            // Close only when press STARTS and ENDS on the backdrop
                            onMouseDown={(e) => {
                                this.backdropClickPrimed = e.target === e.currentTarget;
                            }}
                            onMouseUp={(e) => {
                                if (this.backdropClickPrimed && e.target === e.currentTarget) {
                                    this.closeNotesDialog();
                                }
                                this.backdropClickPrimed = false;
                            }}
                            onMouseLeave={() => { this.backdropClickPrimed = false; }}
                            // Touch support
                            onTouchStart={(e) => { this.backdropClickPrimed = e.target === e.currentTarget; }}
                            onTouchEnd={(e) => {
                                if (this.backdropClickPrimed && e.target === e.currentTarget) {
                                    this.closeNotesDialog();
                                }
                                this.backdropClickPrimed = false;
                            }}
                            role="presentation"
                        >
                            <div
                                ref={this.notesDialogRef}
                                style={{
                                    backgroundColor: 'white',
                                    borderRadius: 8,
                                    padding: 24,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',

                                    // Make the whole card resizable
                                    resize: 'both',
                                    overflow: 'auto',

                                    // Size (remember while open)
                                    width: this.state.notesDialogWidth ?? 540,
                                    height: this.state.notesDialogHeight ?? 360,

                                    // Constraints
                                    minWidth: 360,
                                    minHeight: 240,
                                    maxWidth: '90vw',
                                    maxHeight: '80vh',
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseUp={this.saveNotesDialogSize}
                                onTouchEnd={this.saveNotesDialogSize}
                                role="dialog"
                                aria-labelledby="notesDialogTitle"
                                aria-modal="true"
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 16,
                                        paddingBottom: 12,
                                        borderBottom: '1px solid var(--calcite-color-border-3, #e0e0e0)',
                                    }}
                                >
                                    <h3
                                        id="notesDialogTitle"
                                        style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--calcite-color-text-1, #1a1a1a)' }}
                                    >
                                        {this.state.notesEditingIndex !== null &&
                                            (this.state.drawings[this.state.notesEditingIndex]?.attributes?.name ||
                                                `extent ${this.state.notesEditingIndex + 1}`)}{' '}
                                        - Notes
                                    </h3>
                                </div>

                                <textarea
                                    maxLength={2000}
                                    value={this.state.notesEditingText}
                                    onChange={this.updateNotesText}
                                    placeholder={this.props.nls('addNotesAboutThisDrawing')}
                                    style={{
                                        flex: 1,
                                        minHeight: 150,
                                        padding: 12,
                                        border: '2px solid var(--calcite-color-border-3, #e0e0e0)',
                                        borderRadius: 4,
                                        fontSize: 14,
                                        fontFamily: 'inherit',
                                        resize: 'vertical',
                                        marginBottom: 8,
                                        outline: 'none',
                                        transition: 'border-color 0.2s',
                                        backgroundColor: 'transparent',
                                        color: 'var(--calcite-color-text-1, #1a1a1a)',
                                        boxSizing: 'border-box',
                                    }}
                                    aria-label="Drawing notes"
                                    autoFocus
                                    onFocus={(e) => (e.target.style.borderColor = 'var(--calcite-color-brand, #0078d4)')}
                                    onBlur={(e) => (e.target.style.borderColor = 'var(--calcite-color-border-3, #e0e0e0)')}
                                />

                                {/* character counter */}
                                <div
                                    style={{ textAlign: 'right', fontSize: 12, color: 'var(--calcite-color-text-2, #666)', marginBottom: 20 }}
                                    aria-live="polite"
                                >
                                    {this.props.nls('count', { count: (this.state.notesEditingText.length) })}
                                </div>

                                {/* Footer with Delete + Close */}
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: 8
                                    }}
                                >
                                    {(this.state.notesEditingText?.trim() ||
                                        (this.state.notesEditingIndex !== null &&
                                            this.state.drawings[this.state.notesEditingIndex]?.attributes?.notes)) ? (
                                        <Button
                                            onClick={this.deleteCurrentNote}
                                            aria-label={this.props.nls('deleteNote')}
                                            title="Delete this note from the drawing"
                                            style={{ background: 'var(--calcite-color-status-danger, #b3261e)', color: 'var(--calcite-color-foreground-1, #fff)', border: 'none' }}
                                        >{this.props.nls('deleteNote')}</Button>
                                    ) : <div />}

                                    <div>
                                        <Button
                                            onClick={this.closeNotesDialog}
                                            title="Close notes (saves automatically)"
                                            aria-label={this.props.nls('close')}
                                            type="primary"
                                        >
                                            {this.props.nls('close')}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>,
                        (window?.document?.body ?? document.body)
                    )
                }


                {/* FIXED: Conditional rendering with proper order and focus management */}
                {/* 1. First check if consent is needed */}
                {showConsentPrompt ? (
                    <div>{consentPromptContent}</div>
                ) : consentGranted === false ? (
                    <div>{permissionDeniedContent}</div>
                ) : this.state.showLoadPrompt ? (
                    /* 3. Then load prompt - THIS IS NOW IN THE CORRECT ORDER */
                    <div>{loadPromptContent}</div>
                ) : this.state.showStorageDisclaimer ? (
                    /* 2. Then storage disclaimer */
                    <div
                        className="p-4 text-center"
                        style={{ backgroundColor: 'var(--calcite-color-foreground-1, #fff)' }}
                        role="region"
                        aria-labelledby="storageDisclaimerTitle"
                    >
                        <h5 id="storageDisclaimerTitle" className="mb-3" tabIndex={-1}>{this.props.nls('importantNotice')}</h5>
                        <p id="storageDisclaimerDescription">{this.props.nls('yourDrawingsAreSavedInYourWebBrowserUsingLocalStorageThisMea')}</p>
                        <p>{this.props.nls('ifYouClearYourBrowserDataSwitchToADifferentBrowserOrComputer')}</p>
                        <p>
                            To keep your work safe, please use the <strong>{this.props.nls('import')}</strong> and <strong>{this.props.nls('export')}</strong> buttons to back up and restore your drawings.
                        </p>
                        <Button
                            type="primary"
                            title={this.props.nls('acknowledgeThisNoticeAndContinue')}
                            aria-label={this.props.nls('continueToDrawingPanel')}
                            onClick={() =>
                                this.setState({ showStorageDisclaimer: false }, () => {
                                    this.initializeComponents();
                                    setTimeout(() => {
                                        const el = document.getElementById('drawingPanelHeader');
                                        el?.focus();
                                    }, 100); // Ensure DOM is ready
                                })
                            }
                        >
                            Continue
                        </Button>
                    </div>
                ) : (
                    /* 4. Finally the main panel */
                    <div role="region" aria-labelledby="drawingPanelHeader">
                        <h2 id="drawingPanelHeader" tabIndex={-1} className="sr-only">
                            Drawing Panel
                        </h2>
                        {mainPanelContent}
                    </div>
                )}

                {/* Add a style tag with our CSS overrides */}
                <style dangerouslySetInnerHTML={{ __html: customCss }} />
            </div>
        );
    }
}

export default MyDrawingsPanel;