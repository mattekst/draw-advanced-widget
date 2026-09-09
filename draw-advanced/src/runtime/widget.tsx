import { React, AllWidgetProps, jsx, WidgetState, getAppStore, appActions, MutableStoreManager, defaultMessages as jimuCoreMessages } from 'jimu-core';
import { IMConfig, DrawMode, StorageScope } from '../config';
import {
	Icon, Button, TextInput, NumericInput, Switch, TextAlignValue, Popper, Checkbox,
	Slider, Label, AdvancedButtonGroup, Select, Option, CollapsablePanel, defaultMessages as jimuUIMessages
} from 'jimu-ui';
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash';
import { ArrowRedoOutlined } from 'jimu-icons/outlined/directional/arrow-redo';
import { ArrowUndoOutlined } from 'jimu-icons/outlined/directional/arrow-undo';
import { WrongOutlined } from 'jimu-icons/outlined/suggested/wrong';
import { CloseOutlined } from 'jimu-icons/outlined/editor/close';
import { CopyOutlined } from 'jimu-icons/outlined/editor/copy';
// PasteIcon removed - copy+paste is now a single action (no separate Paste button state)
const SettingOutlined = require('jimu-icons/svg/outlined/application/setting.svg');
import { JimuMapView, JimuMapViewComponent } from 'jimu-arcgis';
import { getStyle } from './lib/style';
import defaultMessages from './translations/default';
import SketchViewModel from 'esri/widgets/Sketch/SketchViewModel';
import { SymbolSelector, JimuSymbolType } from 'jimu-ui/advanced/map';
import { InputUnit } from 'jimu-ui/advanced/style-setting-components';
import { ColorPicker } from 'jimu-ui/basic/color-picker';
import Color from 'esri/Color';
import GraphicsLayer from 'esri/layers/GraphicsLayer';
import Graphic from 'esri/Graphic';
import TextSymbol from 'esri/symbols/TextSymbol';
const hAlignLeft = require('jimu-icons/svg/outlined/editor/text-left.svg');
const hAlignCenter = require('jimu-icons/svg/outlined/editor/text-center.svg');
const hAlignRight = require('jimu-icons/svg/outlined/editor/text-right.svg');
import esriColor from 'esri/Color';
import './widget.css';
import Measure from './components/measure';
import { MyDrawingsPanel } from './components/MyDrawingsPanel';
import { SnappingControls } from './components/SnappingControls';
import { BufferControls } from './components/BufferControls';
import { Tabs, Tab } from 'jimu-ui';
import SimpleLineSymbol from 'esri/symbols/SimpleLineSymbol';
import SimpleFillSymbol from 'esri/symbols/SimpleFillSymbol';
import SimpleMarkerSymbol from 'esri/symbols/SimpleMarkerSymbol';
import Extent from 'esri/geometry/Extent';
import Polygon from 'esri/geometry/Polygon';
import Polyline from 'esri/geometry/Polyline';
import Multipoint from 'esri/geometry/Multipoint';
import Point from 'esri/geometry/Point';
import Circle from 'esri/geometry/Circle';
import * as geometryEngine from 'esri/geometry/geometryEngine';
import * as densifyOperator from 'esri/geometry/operators/densifyOperator';
import * as lengthOperator from 'esri/geometry/operators/lengthOperator';
import * as geodeticLengthOperator from 'esri/geometry/operators/geodeticLengthOperator';
import * as areaOperator from 'esri/geometry/operators/areaOperator';
import * as geodeticAreaOperator from 'esri/geometry/operators/geodeticAreaOperator';

//Combine defaultMessages from Jimu-UI and Jimu-Core with the widgets defaultMessages
const defMessages = Object.assign({}, jimuCoreMessages, jimuUIMessages, defaultMessages);

// EB 1.21's editor occasionally loses ArcGIS static factory members even though
// they exist at runtime. These casts restore editor typing without changing JS.
const PolygonCompat = Polygon as typeof Polygon & {
	fromJSON: (json: any) => Polygon;
	fromExtent: (extent: any) => Polygon;
};
const PolylineCompat = Polyline as typeof Polyline & { fromJSON: (json: any) => Polyline };


// geometryEngine is sync, pure-JS in JSAPI 4.x — no WASM required.
// Buffer operations still use manualBufferGeometry as a fallback.

/**
 * Robust polygon union that produces a TRUE geometric union (not a ring concat).
 * Uses esri/geometry/geometryEngine.union() which is pure-JS in JSAPI 4.x.
 * Falls back to ring-concat only if the engine call fails.
 */
const unionPolygonsRobust = (polygons: any[]): any | null => {
	if (!polygons || polygons.length === 0) return null;
	if (polygons.length === 1) return polygons[0];
	try {
		const ge: any = (geometryEngine as any).default || geometryEngine;
		if (ge?.union) {
			const result = ge.union(polygons as any);
			if (result) return Array.isArray(result) ? result[0] : result;
		}
	} catch (e) {
		console.warn('unionPolygonsRobust: geometryEngine.union failed, falling back to ring-concat', e);
	}
	// Fallback: combine rings (same as previous behavior). Visually shows all input polygons,
	// but does NOT produce a topological union — used only when the engine is unavailable.
	const allRings: number[][][] = [];
	for (const poly of polygons) {
		if ((poly as any).rings) for (const ring of (poly as any).rings) allRings.push(ring);
	}
	return new Polygon({ rings: allRings, spatialReference: polygons[0].spatialReference });
};

// ── Widget-level buffer helpers (no WASM required) ─────────────────────────
const _W_UNITS: Record<string, number> = {
	meters: 1, meter: 1, esrimeters: 1, kilometers: 1000, kilometer: 1000, esrikilometers: 1000,
	feet: 0.3048, foot: 0.3048, esrifeet: 0.3048, miles: 1609.344, mile: 1609.344, esrimiles: 1609.344,
	yards: 0.9144, yard: 0.9144, esriyards: 0.9144, nauticalmiles: 1852, esrinauticalmiles: 1852,
};
const bufferToMeters = (dist: number, unit: string): number =>
	dist * (_W_UNITS[(unit || '').toLowerCase().replace(/-/g, '')] ?? 1);
const _wCircle = (cx: number, cy: number, r: number, isGeo: boolean): number[][] => {
	const N = 72, ring: number[][] = [], cl = isGeo ? Math.cos(cy * Math.PI / 180) : 1;
	for (let i = 0; i <= N; i++) { const a = 2 * Math.PI * i / N; ring.push([cx + (r / (isGeo ? 111320 * cl : 1)) * Math.cos(a), cy + (r / (isGeo ? 111320 : 1)) * Math.sin(a)]); }
	return ring;
};
const _wArcPts = (cx: number, cy: number, r: number, from: number): number[][] => {
	const p: number[][] = [];
	for (let i = 0; i <= 18; i++) p.push([cx + r * Math.cos(from + Math.PI * i / 18), cy + r * Math.sin(from + Math.PI * i / 18)]);
	return p;
};
const _wPathBuf = (path: number[][], d: number, sr: any): any => {
	if (path.length < 2) return null;
	const n = path.length;
	const sn = (i: number) => { const dx = path[i + 1][0] - path[i][0], dy = path[i + 1][1] - path[i][1], l = Math.sqrt(dx * dx + dy * dy) || 1; return { nx: -dy / l, ny: dx / l }; };
	const vn = (i: number) => { if (i === 0) return sn(0); if (i === n - 1) return sn(n - 2); const a = sn(i - 1), b = sn(i), mx = a.nx + b.nx, my = a.ny + b.ny, ml = Math.sqrt(mx * mx + my * my) || 1; return { nx: mx / ml, ny: my / ml }; };
	const L: number[][] = [], R: number[][] = [];
	for (let i = 0; i < n; i++) { const { nx, ny } = vn(i); L.push([path[i][0] + nx * d, path[i][1] + ny * d]); R.push([path[i][0] - nx * d, path[i][1] - ny * d]); }
	const ea = Math.atan2(path[n - 1][1] - path[n - 2][1], path[n - 1][0] - path[n - 2][0]);
	const sa = Math.atan2(path[0][1] - path[1][1], path[0][0] - path[1][0]);
	const ring = [...L, ..._wArcPts(path[n - 1][0], path[n - 1][1], d, ea + Math.PI / 2), ...[...R].reverse(), ..._wArcPts(path[0][0], path[0][1], d, sa + Math.PI / 2), L[0]];
	return PolygonCompat.fromJSON({ rings: [ring], spatialReference: sr?.toJSON ? sr.toJSON() : sr });
};
/**
 * Polygon offset buffer (manual, no geometryEngine).
 * Offsets each vertex along the bisector of adjacent outward edge normals.
 * Convex corners get a rounded arc fillet (matches geometryEngine.buffer),
 * concave corners use a single bisector intersection (sharp inner corner).
 * Ring orientation auto-detected via signed area.
 * Mirrors BufferControls.polygonBuffer so the manual fallback produces the
 * same shape as the geometryEngine path for polygons (previously the fallback
 * had no polygon branch and collapsed polygons into a centroid circle).
 */
const _wPolyBuf = (rings: number[][][], distM: number, sr: any): any => {
	if (!rings?.length) return null;
	const offsetRing = (ring: number[][]): number[][] => {
		const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
			? ring.slice(0, -1) : ring;
		const n = pts.length;
		if (n < 3) return ring;
		let area = 0;
		for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
		const s = area > 0 ? 1 : -1;
		const edgeNorm = (i: number) => {
			const j = (i + 1) % n;
			const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
			const len = Math.sqrt(dx * dx + dy * dy) || 1;
			return { nx: s * dy / len, ny: s * (-dx) / len };
		};
		const ARC_STEP = Math.PI / 12, MAX_ARC_STEPS = 24;
		const result: number[][] = [];
		for (let i = 0; i < n; i++) {
			const prev = (i + n - 1) % n;
			const ea = edgeNorm(prev), eb = edgeNorm(i);
			const cross = ea.nx * eb.ny - ea.ny * eb.nx;
			const dot = ea.nx * eb.nx + ea.ny * eb.ny;
			const isConvex = cross * s > 0;
			if (isConvex) {
				const a0 = Math.atan2(ea.ny, ea.nx);
				const a1 = Math.atan2(eb.ny, eb.nx);
				let delta = a1 - a0;
				if (s > 0) { while (delta <= 0) delta += 2 * Math.PI; if (delta > 2 * Math.PI) delta -= 2 * Math.PI; }
				else { while (delta >= 0) delta -= 2 * Math.PI; if (delta < -2 * Math.PI) delta += 2 * Math.PI; }
				const steps = Math.min(MAX_ARC_STEPS, Math.max(2, Math.ceil(Math.abs(delta) / ARC_STEP)));
				for (let k = 0; k <= steps; k++) {
					const a = a0 + delta * (k / steps);
					result.push([pts[i][0] + distM * Math.cos(a), pts[i][1] + distM * Math.sin(a)]);
				}
			} else {
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
	return PolygonCompat.fromJSON({ rings: rings.map(r => offsetRing(r)), spatialReference: sr?.toJSON ? sr.toJSON() : sr });
};
const manualBufferGeometry = (geom: any, distM: number, sr: any): any => {
	if (!geom) return null;
	const isGeo = sr?.isGeographic || sr?.wkid === 4326;
	// Shape-first detection — see _mdpManualBuffer in MyDrawingsPanel.tsx for the
	// full rationale. After Graphic.fromJSON, geom.type can be missing/wrong on
	// restored polygons, sending us to the extent fallback (a circle).
	const hasRings = Array.isArray(geom.rings) && geom.rings.length > 0 &&
		Array.isArray(geom.rings[0]) && geom.rings[0].length >= 3;
	const hasPaths = Array.isArray(geom.paths) && geom.paths.length > 0;
	const hasXY = typeof geom.x === 'number' && typeof geom.y === 'number';
	if (hasRings || geom.type === 'polygon') {
		const r = _wPolyBuf(geom.rings || [], distM, sr);
		if (r) return r;
	}
	if (hasPaths || geom.type === 'polyline') {
		const p: number[][][] = geom.paths || [];
		if (p.length > 0) return _wPathBuf(p[0], distM, sr);
	}
	if (hasXY || geom.type === 'point') {
		return PolygonCompat.fromJSON({ rings: [_wCircle(geom.x, geom.y, distM, isGeo)], spatialReference: sr?.toJSON ? sr.toJSON() : sr });
	}
	const ext = geom.extent;
	if (ext) {
		console.warn('manualBufferGeometry falling back to bounding-circle:', geom);
		const cx = (ext.xmin + ext.xmax) / 2, cy = (ext.ymin + ext.ymax) / 2;
		return PolygonCompat.fromJSON({ rings: [_wCircle(cx, cy, Math.max(ext.width, ext.height) / 2 + distM, isGeo)], spatialReference: sr?.toJSON ? sr.toJSON() : sr });
	}
	return null;
};



const pinIcon = require('./assets/pin.svg');
const curveIcon = require('./assets/curve.svg');
const lineIcon = require('./assets/polygonal.svg');
const rectIcon = require('./assets/rectangle.svg');
const polyIcon = require('./assets/polygon.svg');
const freePolyIcon = require('./assets/irregular.svg');
const circleIcon = require('./assets/circle.svg');
const textIcon = require('./assets/text.svg');
const vAlignTop = require('./assets/text-align-v-t.svg');
const vAlignBot = require('./assets/text-align-v-b.svg');
const vAlignMid = require('./assets/text-align-v-m.svg');
const vAlignBase = require('./assets/text-align-v-base.svg');
const fsBoldIcon = require('./assets/bold.svg');
const fItalicIcon = require('./assets/italic.svg');
const fUnderlineIcon = require('./assets/underline.svg');

interface States {
	currentJimuMapView: JimuMapView;
	graphics?: any[];
	pointBtnActive: boolean;
	lineBtnActive: boolean;
	curveToolActive?: boolean; // a true-curve line tool (arc/endpointArc/bezier) is active
	showCurveMenu?: boolean;   // dedicated curve-tools flyout open
	curveHint?: string;        // help text shown while a curve tool is active
	triangleActive?: boolean;  // custom equilateral-triangle tool active
	triangleHint?: string;     // help text shown while the triangle tool is active
	circlePresetEnabled?: boolean; // preset circle size: one click places a circle of an exact radius or area (off by default)
	circlePresetMode?: 'radius' | 'area';
	circlePresetValue?: number;
	circlePresetUnit?: string;
	flineBtnActive: boolean;
	rectBtnActive: boolean;
	polygonBtnActive: boolean;
	fpolygonBtnActive: boolean;
	circleBtnActive: boolean;
	undoBtnActive: boolean;
	redoBtnActive: boolean;
	clearBtnActive: boolean;
	textBtnActive: boolean;
	showSymPreview: boolean;
	showTextPreview: boolean;
	currentSymbol: any;
	currentSymbolType: JimuSymbolType;
	currentTextSymbol: TextSymbol;
	drawGLLengthcheck: boolean;
	currentTool: 'point' | 'polyline' | 'freepolyline' | 'extent' | 'polygon' | 'circle' | 'freepolygon' | 'text' | 'arc' | 'endpointArc' | 'bezier' | 'triangle' | '';
	clearBtnTitle: string;
	canUndo: boolean;
	canRedo: boolean;
	textSymPreviewText: string;
	fontColor: string;
	fontSize: string;
	fontHaloSize: number;
	fontHaloColor: string;
	fontHaloEnabled: boolean;
	fontHalo: string;
	fontWeight: string;
	fontDecoration: string;
	fontStyle: string;
	hTextAlign: TextAlignValue;
	vTextAlign: 'baseline' | 'top' | 'middle' | 'bottom';
	fontRotation: number;
	textNumLines: number;
	vAlignBaseBtnActive: boolean;
	vAlignTopBtnActive: boolean;
	vAlignMidBtnActive: boolean;
	vAlignBotBtnActive: boolean;
	textPreviewHeight: number;
	hAlignLeftBtnActive: boolean;
	hAlignCenterBtnActive: boolean;
	hAlignRightBtnActive: boolean;
	fsBoldBtnActive: boolean;
	fsItalicBtnActive: boolean;
	fsUnderlineBtnActive: boolean;
	widgetInit: boolean;
	textPreviewisOpen: boolean;
	fontOpacity: number;
	fontHaloOpacity: number;
	textHasChanged: boolean;
	rotationMode: boolean;
	drawLayerTitle: string;
	listMode: string;
	confirmDelete: boolean;
	fontBackgroundColor: string | null | esriColor;
	showDrawingsPanel: boolean; // Added BM
	selectedDrawingIndex: number | null; // Added BM
	activeTab: 'draw' | 'mydrawings'; // Added BM
	selectedGraphicIndex: number | null;
	selectedGraphics: Set<number>;
	arrowEnabled: boolean;
	arrowPosition: 'start' | 'end' | 'both';
	arrowSize: number;
	measurementCheckboxOn: boolean;
	// Copy/Paste feature state
	copiedFeature: {
		geometry: any;
		geometryType: string;
		symbol?: any;
		attributes?: any;
		layerTitle?: string;
	} | null;
	copyModeActive: boolean;
	copyFeatureCandidates: Array<{
		graphic: any;
		layerTitle: string;
		geometryType: string;
	}>;
	showCopyPicker: boolean;
	copyPickerFilter: string;
	copyPasteToast: {
		message: string;
		type: 'success' | 'error' | 'info';
	} | null;
	// New: Layer-first copy approach
	showCopyLayerDropdown: boolean;
	copyableLayers: Array<{
		id: string;
		title: string;
		type: 'feature' | 'graphics' | 'map-image-sublayer' | 'geojson' | 'csv';
		layerRef: any | any | null;
		parentTitle?: string;
	}>;
	selectedCopyLayerId: string | null;
	// Multi-copy selection mode
	showCopyModePrompt: boolean;
	copyModePromptContext: 'click-first' | 'layer-first' | null;
	copySelectionMode: 'single' | 'multiple' | null;
	multiCopySelectedFeatures: Array<{
		graphic: any;
		layerTitle: string;
		geometryType: string;
	}>;
	multiCopyLockedLayerTitle: string | null;
	multiCopySpatialTool: 'rectangle' | 'polygon' | null;
	isActivelyDrawing: boolean;
}
interface ScrollIndicatorProps {
	children: React.ReactNode;
	className?: string;
}

interface ExtendedGraphic extends Graphic {
	measure?: {
		graphic: ExtendedGraphic;
		areaUnit?: string;
		lengthUnit?: string;
	};
	measureParent?: ExtendedGraphic;
	checked?: boolean;
	originalSymbol?: any;
	isBufferDrawing?: boolean;
	sourceGraphicId?: string;
	bufferGraphic?: ExtendedGraphic;
	_selectionOverlay?: any | null;
	bufferSettings?: {
		distance: number;
		unit: string;
		enabled: boolean;
		opacity?: number;
		outlineOnly?: boolean;
		customColor?: string | null;
		customOutlineColor?: string | null;
	};
}

export const ScrollableContainer: React.FC<ScrollIndicatorProps> = ({
	children,
	className = ''
}) => {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const [showTopShadow, setShowTopShadow] = React.useState(false);
	const [showBottomShadow, setShowBottomShadow] = React.useState(false);

	const checkScroll = () => {
		if (!containerRef.current) return;

		const { scrollTop, scrollHeight, clientHeight } = containerRef.current;

		// Show top shadow if scrolled down
		setShowTopShadow(scrollTop > 10);

		// Show bottom shadow if there's more content below
		setShowBottomShadow(scrollTop + clientHeight < scrollHeight - 10);
	};

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Initial check
		checkScroll();

		// 🔧 FIX: Add scroll listener with passive flag for better scroll performance
		container.addEventListener('scroll', checkScroll, { passive: true });

		// Add resize observer to handle dynamic content changes
		const resizeObserver = new ResizeObserver(() => {
			setTimeout(checkScroll, 100); // Delay to allow content to settle
		});

		resizeObserver.observe(container);

		return () => {
			// 🔧 FIX: Use same passive option for cleanup
			container.removeEventListener('scroll', checkScroll, { passive: true } as any);
			resizeObserver.disconnect();
		};
	}, []);

	return (
		<div
			className="scrollable-container-wrapper"
			role="region"
			aria-label="Scrollable content area"
		>
			{/* Top scroll indicator - hidden from screen readers as decorative */}
			<div
				className={`scroll-shadow scroll-shadow-top ${showTopShadow ? 'visible' : ''}`}
				aria-hidden="true"
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					height: '8px',
					background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), transparent)',
					pointerEvents: 'none',
					zIndex: 5,
					opacity: showTopShadow ? 1 : 0,
					transition: 'opacity 0.3s ease'
				}}
			/>

			{/* Scrollable content */}
			<div
				ref={containerRef}
				className={`tab-content ${className}`}
				role="region"
				aria-label="Scrollable panel content"
				tabIndex={0}
				style={{
					flex: 1,
					overflowY: 'auto',
					overflowX: 'hidden',
					minHeight: 0,
					position: 'relative'
				}}
			>
				{children}
			</div>

			{/* Bottom scroll indicator - hidden from screen readers as decorative */}
			<div
				className={`scroll-shadow scroll-shadow-bottom ${showBottomShadow ? 'visible' : ''}`}
				aria-hidden="true"
				style={{
					position: 'absolute',
					bottom: 0,
					left: 0,
					right: 0,
					height: '8px',
					background: 'linear-gradient(to top, rgba(0,0,0,0.1), transparent)',
					pointerEvents: 'none',
					zIndex: 5,
					opacity: showBottomShadow ? 1 : 0,
					transition: 'opacity 0.3s ease'
				}}
			/>
		</div>
	);
};

type WidgetProps = AllWidgetProps<IMConfig> & {
	id: string;
	widgetId?: string;
	useMapWidgetIds?: string[];
	useDataSources?: any[];
	[key: string]: any;
};

export default class Widget extends React.PureComponent<WidgetProps, States> {
	declare props: WidgetProps;
	declare state: States;
	declare setState: any;
	declare forceUpdate: any;
	textPreviewSpan: React.RefObject<HTMLSpanElement> = React.createRef();
	sketchViewModel: SketchViewModel;
	drawLayer: GraphicsLayer = null;
	identifyResultsLayer: GraphicsLayer = null; // Read-only layer for Identify graphics
	_sketchEl: any = null;
	_jimuMapViewForDraw: any = null;
	_widgetRoot: HTMLElement | null = null;
	_jimuDrawReadyResolve: ((el: any) => void) | null = null;
	private _bufferUpdateInProgress: Set<string> = new Set();
	Graphic: any = null;
	creationMode: DrawMode;
	currentSymbol: any | any | any | any | any | any | any;
	measureRef: React.RefObject<any> = React.createRef();

	// Identify By Query integration - event listener cleanup
	private identifyListenerCleanup: (() => void) | null = null;

	private _selectionEpoch = 0;
	private _measurementWasEnabled: boolean = false;

	/**
	 * FIX #13: Shared helper to save measurement labels, cancel SketchVM, and restore labels.
	 * Consolidates the duplicate save/cancel/restore logic that existed in click-away
	 * deselect and explicit cancel handlers.
	 * @param graphics - Array of graphics whose labels should be preserved
	 * @returns number of restored labels
	 */
	private cancelSketchVMWithLabelPreservation = (graphics: any[]): number => {
		if (!this.drawLayer || !this.sketchViewModel) return 0;

		// 1. Collect all measurement labels from the provided graphics
		const labelsToPreserve: Array<{ graphic: any; label: any; type: string }> = [];

		graphics.forEach((graphic: any) => {
			if (!graphic || graphic.attributes?.isMeasurementLabel) return;
			if (!this.drawLayer.graphics.includes(graphic)) return;

			// Main measurement label
			if (graphic.measure?.graphic && this.drawLayer.graphics.includes(graphic.measure.graphic)) {
				labelsToPreserve.push({
					graphic,
					label: graphic.measure.graphic,
					type: 'main'
				});
				graphic.measure.graphic.attributes.protectedFromSketchVM = true;
			}

			// Segment labels
			if (Array.isArray(graphic.attributes?.relatedSegmentLabels)) {
				graphic.attributes.relatedSegmentLabels.forEach((segLabel: any) => {
					if (segLabel && this.drawLayer.graphics.includes(segLabel)) {
						labelsToPreserve.push({ graphic, label: segLabel, type: 'segment' });
						if (!segLabel.attributes) segLabel.attributes = {};
						segLabel.attributes.protectedFromSketchVM = true;
					}
				});
			}

			// relatedMeasurementLabels
			if (Array.isArray(graphic.attributes?.relatedMeasurementLabels)) {
				graphic.attributes.relatedMeasurementLabels.forEach((mLabel: any) => {
					if (mLabel && this.drawLayer.graphics.includes(mLabel)) {
						const alreadyAdded = labelsToPreserve.some(item => item.label === mLabel);
						if (!alreadyAdded) {
							labelsToPreserve.push({ graphic, label: mLabel, type: 'measurement' });
							if (!mLabel.attributes) mLabel.attributes = {};
							mLabel.attributes.protectedFromSketchVM = true;
						}
					}
				});
			}
		});

		// 2. Temporarily remove labels to protect them from SketchVM cancel
		const tempRemoved: any[] = [];
		labelsToPreserve.forEach(({ label }) => {
			if (this.drawLayer.graphics.includes(label)) {
				this.drawLayer.remove(label);
				tempRemoved.push(label);
			}
		});

		// 3. Cancel SketchVM
		try {
			if (this.sketchViewModel.view) {
				this.sketchViewModel.cancel();
			}
		} catch (error) {
			console.warn('Error canceling SketchViewModel:', error);
		}

		// 4. Restore all labels immediately
		let restoredCount = 0;
		tempRemoved.forEach((label) => {
			try {
				label.visible = true;
				this.drawLayer.add(label);
				restoredCount++;
			} catch (e) {
				console.warn('Failed to restore label after cancel:', e);
			}
		});

		// 5. Re-establish any severed parent relationships
		labelsToPreserve.forEach(({ graphic, label }) => {
			if (label && this.drawLayer.graphics.includes(label)) {
				label.visible = true;
				if (!label.attributes) label.attributes = {};
				label.attributes.isMeasurementLabel = true;
				label.attributes.hideFromList = true;
				label.attributes.parentGraphicId = graphic.attributes?.uniqueId;
				(label as any).measureParent = graphic;
			}
		});

		// Restore measure property if it was lost
		graphics.forEach((graphic: any) => {
			if (graphic && !graphic.measure) {
				const mainEntry = labelsToPreserve.find(e => e.graphic === graphic && e.type === 'main');
				if (mainEntry) {
					graphic.measure = { graphic: mainEntry.label };
				}
			}
		});

		return restoredCount;
	};
	private _measurementUpdateTimeout: any = null;
	private _activeMeasurementUpdateTimeout: any = null;
	private _positionWatchers: { [key: string]: any } = {};
	private _copyHighlightGraphic: any | null = null;
	private _multiCopyHighlightGraphics: any[] = [];
	private _spatialSelectSketchVM: SketchViewModel | null = null;
	private _spatialSelectLayer: GraphicsLayer | null = null;
	private _toastTimer: ReturnType<typeof setTimeout> | null = null;

	// 🔧 MEMORY FIX: Track all listener handles attached inside activeViewChangeHandler
	// so they can be removed on the next view switch and on unmount. Previously these
	// were registered without storing return handles, causing them to accumulate on
	// every map-view change and every widget close/reopen cycle.
	private _viewHandles: Array<{ remove: () => void }> = [];
	// Custom true-curve line tool state (arc / endpointArc / bezier) — multi-segment
	private _curveType: 'arc' | 'endpointArc' | 'bezier' | null = null;
	private _curveHandles: Array<{ remove: () => void }> = [];
	private _curvePathStart: number[] | null = null; // first vertex of the whole path
	private _curveStart: number[] | null = null;     // start vertex of the in-progress segment
	private _curveSegs: any[] = [];                   // committed curvePaths segments
	private _curvePending: number[][] = [];           // clicks collected for the in-progress segment
	private _curvePreview: any = null;
	private _curvePrevPopup: boolean | null = null;
	// Custom equilateral-triangle tool state
	private _triHandles: Array<{ remove: () => void }> = [];
	private _triCenter: number[] | null = null;
	private _triPreview: any = null;
	private _triPrevPopup: boolean | null = null;
	private _triClickTimer: any = null;
	// Preset circle size tool (one-click circle of an exact radius or area)
	private _cpHandles: Array<{ remove: () => void }> = [];
	private _cpPreview: any = null;
	private _cpPrevPopup: boolean | null = null;
	private _cpClickTimer: any = null;
	private _curveUpdateBackup: Map<string, { json: any; cx: number; cy: number }> = new Map();
	// Live snap feedback: marker shown at the snapped point + throttle guards so
	// the async feature query doesn't run on every pointer-move.
	private _snapIndicator: any = null;
	private _previewSnapInFlight = false;
	private _previewSnapLastTs = 0;
	private _snapFeatSegs: number[][] = []; // cached nearby feature segments [ax,ay,bx,by] (view SR)
	private _snapFeatPts: number[][] = [];  // cached nearby feature points (view SR)
	private _snapCacheAt: number[] | null = null; // cursor point the feature cache was built for
	private _snapLast: number[] | null = null;    // last snapped point (for hysteresis)
	private _cursorTip: HTMLDivElement | null = null; // on-map drawing tooltip for custom tools

	// 🔧 MEMORY FIX: Track DOM elements wired up by onSymbolPopper, so the same
	// element doesn't get a fresh click handler stacked on top each time the
	// symbol picker opens. WeakSet so GC'd DOM nodes don't pin entries.
	private _popperWiredElements: WeakSet<HTMLElement> = new WeakSet();

	/**
	 * 🔧 MEMORY FIX: Drain and remove all listener handles attached during
	 * activeViewChangeHandler. Safe to call multiple times.
	 */
	private removeViewHandles = (): void => {
		if (!this._viewHandles || this._viewHandles.length === 0) {
			this._viewHandles = [];
			return;
		}
		for (const handle of this._viewHandles) {
			try {
				handle?.remove?.();
			} catch (err) {
				console.warn('Error removing view handle:', err);
			}
		}
		this._viewHandles = [];
	};
	private handleTabChange = (nextTab: 'draw' | 'mydrawings') => {
		// Block switching to My Drawings when disabled in settings
		if (nextTab === 'mydrawings' && this.props.config.enableMyDrawings === false) {
			return;
		}

		// Deactivate copy mode and close layer dropdown when switching tabs
		if (this.state.copyModeActive) {
			this.deactivateCopyMode();
		}
		if (this.state.showCopyLayerDropdown) {
			this.setState({ showCopyLayerDropdown: false, copyableLayers: [] });
		}
		if (this.state.showCopyModePrompt) {
			this.setState({ showCopyModePrompt: false, copyModePromptContext: null });
		}

		if (nextTab === 'mydrawings') {
			const drawings = this.snapshotDrawingsFromLayer();
			this.myDrawingsRef?.current?.ingestDrawings?.(drawings);

			// Reset drawing tool and cancel any active sketch
			this.setDrawToolBtnState('');
			try { this.sketchViewModel?.cancel(); } catch { /* no-op */ }
			this.measureRef?.current?.disableMeasurementEditing?.();

			// 🔄 Auto-turn off measurements when switching to My Drawings tab
			//console.log('✅ Tab switch: Auto-unchecking measurement checkbox - leaving Draw tab');
			this.measureRef?.current?.setMeasurementEnabled?.(false);
			this.setState({ graphics: drawings, activeTab: 'mydrawings', measurementCheckboxOn: false });
			return;
		}

		// Switching to Draw tab
		if (this.measureRef?.current) {
			this.measureRef.current.disableMeasurementEditing?.();

			const selectedGraphic = this.sketchViewModel?.updateGraphics?.getItemAt(0);
			let checkboxShouldBeChecked = false; // No selected graphic -> measurement off by default

			if (selectedGraphic) {
				const extGraphic = selectedGraphic as any;
				// 🔧 FIX: Check for CURRENT measurements on the layer, not hadMeasurements flag
				// Only consider measurements that currently exist and are still on the layer
				const hasMainMeasurement =
					extGraphic.measure?.graphic &&
					extGraphic.measure.graphic.layer &&
					this.drawLayer?.graphics?.includes(extGraphic.measure.graphic);

				const hasValidMeasurementLabels =
					extGraphic.attributes?.relatedMeasurementLabels?.some(
						label => label && label.layer && this.drawLayer?.graphics?.includes(label)
					);

				const hasValidSegmentLabels =
					extGraphic.attributes?.relatedSegmentLabels?.some(
						label => label && label.layer && this.drawLayer?.graphics?.includes(label)
					);

				const hasCurrentMeasurements =
					hasMainMeasurement || hasValidMeasurementLabels || hasValidSegmentLabels;

				if (hasCurrentMeasurements) {
					checkboxShouldBeChecked = true;
					//console.log('✅ Tab switch: Auto-checking measurement checkbox - selected graphic has measurements');
				} else {
					checkboxShouldBeChecked = false;
					//console.log('✅ Tab switch: Auto-unchecking measurement checkbox - selected graphic has no measurements');
				}
			}

			this.setDrawToolBtnState('');
			this.setState({
				activeTab: nextTab,
				measurementCheckboxOn: checkboxShouldBeChecked,
				// ...other state resets...
			});

			// Sync Measure component with determined checkbox state
			this.measureRef.current.setMeasurementEnabled?.(checkboxShouldBeChecked);
			return;
		}

		// Fallback for when measureRef is not available
		this.setDrawToolBtnState('');
		this.setState({
			activeTab: nextTab,
			pointBtnActive: false,
			lineBtnActive: false,
			flineBtnActive: false,
			rectBtnActive: false,
			polygonBtnActive: false,
			fpolygonBtnActive: false,
			circleBtnActive: false,
			textBtnActive: false,
			currentTool: ''
		});
	};

	// ✅ NEW: External control for measurement system (used by MyDrawingsPanel)
	private onMeasurementSystemControl = (enabled: boolean) => {
		//console.log(`🔧 Measurement system control invoked: ${enabled ? 'ON' : 'OFF'}`);
		this.setState({ measurementCheckboxOn: enabled });
		this.measureRef?.current?.setMeasurementEnabled?.(enabled);
	};

	private onMeasurementCheckboxChange = (checked: boolean) => {
		//console.log(`📊 Measurement checkbox ${checked ? 'ENABLED' : 'DISABLED'}`);

		// Update your own UI state
		this.setState({ measurementCheckboxOn: checked });

		// ✅ NEW: When unchecking, add a note that existing measurements are preserved
		if (!checked) {
			//console.log('ℹ️  Checkbox OFF - NEW graphics will not get measurements');
			//console.log('ℹ️  Existing measurements are preserved and independent of checkbox');
		} else {
			//console.log('ℹ️  Checkbox ON - NEW graphics will get measurements automatically');
		}

		// Push state to Measure
		// This ONLY controls whether NEW graphics get measurements
		// Existing measurements are preserved via hadMeasurements/measurementsPermanent flags
		this.measureRef?.current?.setMeasurementEnabled?.(checked);
	};
	private _savePositionTimeout: any = null;
	private renderSymbolSelectorSection() {
		const { currentSymbol, currentSymbolType, rotationMode } = this.state;

		return (
			<div
				className='mb-2'
				role="region"
				aria-label="Symbol style customization"
			>
				<h6
					className='drawToolbarDiv'
					id="symbol-style-heading"
				>
					Change Symbol Style/Stil:
				</h6>
				<div
					className="myss border"
					style={{ width: '90%', margin: '0 auto' }}
					aria-labelledby="symbol-style-heading"
				>
					<SymbolSelector
						symbol={currentSymbol}
						jimuSymbolType={currentSymbolType}
						btnSize={'sm'}
						onPopperToggle={this.onSymbolPopper}
						onPointSymbolChanged={this.onPointSymChanged}
						onPolygonSymbolChanged={this.onPolygonSymbolChanged}
						onPolylineSymbolChanged={this.onPolylineSymbolChanged}
						theme={this.props.theme}
					/>
				</div>

				{/* Point symbol rotation controls */}
				{rotationMode && (
					<div
						className='drawToolbarDiv'
						role="group"
						aria-label="Point symbol rotation controls"
					>
						<h6
							className='mt-2'
							id="rotation-heading"
						>
							Rotate Point Symbol:
						</h6>
						<div
							className='w-100 d-flex align-items-center'
							aria-labelledby="rotation-heading"
						>
							<NumericInput
								size='sm'
								value={this.state.currentSymbol.angle}
								min={0}
								max={360}
								step={0.1}
								onChange={(e) => this.handlePointRotation(e)}
								className='mr-2 decimalInput'
								aria-label="Point symbol rotation angle in degrees"
								aria-valuemin={0}
								aria-valuemax={360}
								aria-valuenow={this.state.currentSymbol.angle}
								title="Enter rotation angle between 0 and 360 degrees"
							/>
							<span aria-hidden="true">0°</span>
							<Slider
								value={this.state.currentSymbol.angle}
								min={0}
								max={360}
								step={0.1}
								onChange={(e) => this.handlePointRotation(e)}
								className='mx-2 flex-grow-1'
								aria-label={`Point symbol rotation slider, current value ${this.state.currentSymbol.angle} degrees`}
								aria-valuemin={0}
								aria-valuemax={360}
								aria-valuenow={this.state.currentSymbol.angle}
								title={`Rotation: ${this.state.currentSymbol.angle}° - Drag to adjust rotation`}
							/>
							<span aria-hidden="true">360°</span>
						</div>
					</div>
				)}

				{/* Arrow controls for polylines */}
				{currentSymbolType === JimuSymbolType.Polyline && this.renderArrowControls()}

				{/* Preset circle size controls for the circle tool */}
				{this.state.circleBtnActive && this.renderCirclePresetControls()}
			</div>
		);
	}
	private snapshotDrawingsFromLayer = (): any[] => {
		if (!this.drawLayer || !this.drawLayer.graphics) return [];
		const all = this.drawLayer.graphics.toArray();

		// Exclude labels/overlays/buffers, keep real user drawings
		return all.filter((g: any) => {
			if (g?.attributes?.isMeasurementLabel) return false;
			if (g?.attributes?.isSelectionOverlay) return false;
			if (g?.attributes?.isPreviewBuffer || g?.attributes?.isBuffer || g?.attributes?.isBufferDrawing) return false;
			return !!g?.geometry;
		});
	};

	private myDrawingsRef: React.RefObject<MyDrawingsPanel> = React.createRef();

	/**
	 * Gets the localStorage key based on the configured storage scope.
	 * - APP_SPECIFIC: Returns undefined to let MyDrawingsPanel use its default app-specific key
	 * - GLOBAL: Returns a fixed key for shared storage across all applications
	 */
	getLocalStorageKey = (): string | undefined => {
		const { config } = this.props;

		if (String(config.storageScope) === 'global') {
			return 'drawings_global_shared';
		}

		return undefined;
	}

	private _drawingMap: Map<string, number> = new Map();
	private renderTextSymbolPreviewButton() {
		const { fontColor, fontSize, fontWeight, fontStyle, fontDecoration, fontRotation, fontHalo, currentTextSymbol, textSymPreviewText } = this.state;

		// Convert Color object to CSS color string with proper type checking
		const backgroundColorString = currentTextSymbol.backgroundColor
			? (typeof currentTextSymbol.backgroundColor === 'string'
				? currentTextSymbol.backgroundColor
				: `rgba(${currentTextSymbol.backgroundColor.r}, ${currentTextSymbol.backgroundColor.g}, ${currentTextSymbol.backgroundColor.b}, ${currentTextSymbol.backgroundColor.a})`)
			: 'transparent';

		return (
			<div
				className='mb-2'
				role="region"
				aria-label="Text formatting options"
			>
				<h6
					className='drawToolbarDiv'
					id="text-options-heading"
				>
					Change Text Options:
				</h6>
				<div className="myss">
					<div
						className="jimu-symbol-selector"
						style={{ width: '90%', margin: '0 auto' }}
						aria-labelledby="text-options-heading"
					>
						<Button
							size='sm'
							type='default'
							onClick={this.showTextSymbolPopper}
							id={this.props.widgetId + '_btnTextSymbol'}
							style={{
								width: '100%',
								height: '36px',
								padding: '0',
								backgroundColor: backgroundColorString
							}}
							aria-label="Open text formatting options panel"
							aria-expanded={this.state.textPreviewisOpen}
							aria-haspopup="dialog"
							aria-controls="text-symbol-popper"
							title="Click to customize text appearance including font, color, size, and styling options"
						>
							<span className='icon-btn-sizer' aria-hidden="true">
								<div className="justify-content-center align-items-center symbol-wapper outer-preview-btn d-flex">
									<div
										className="w-100 h-100 justify-content-center d-flex align-items-center symbol-item text-symbol-item"
										style={{ position: 'relative', overflow: 'hidden' }}
									>
										{/* Halo layer — painted first, behind the fill */}
										{fontHalo && (
											<span aria-hidden="true" style={{
												position: 'absolute',
												color: fontColor,
												fontSize: `${Math.min(Number(fontSize), 22)}px`,
												WebkitTextStroke: fontHalo,
												fontWeight,
												fontStyle,
												fontFamily: currentTextSymbol.font.family,
												textDecoration: fontDecoration,
												whiteSpace: 'nowrap',
												WebkitTransform: `rotate(${fontRotation}deg)`,
												pointerEvents: 'none',
												userSelect: 'none'
											}}>
												{textSymPreviewText}
											</span>
										)}
										{/* Fill layer — on top */}
										<span className='text-symbol-span' style={{
											position: 'relative',
											zIndex: 1,
											color: fontColor,
											fontSize: `${Math.min(Number(fontSize), 22)}px`,
											fontWeight,
											fontStyle,
											fontFamily: currentTextSymbol.font.family,
											textDecoration: fontDecoration,
											whiteSpace: 'nowrap',
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											maxWidth: '100%',
											WebkitTransform: `rotate(${fontRotation}deg)`
										}}>
											{textSymPreviewText}
										</span>
									</div>
								</div>
							</span>
							<span className="sr-only">
								Current text style: {currentTextSymbol.font.family}, {fontSize}px,
								{fontWeight === 'bold' ? ' bold,' : ''}
								{fontStyle === 'italic' ? ' italic,' : ''}
								{fontDecoration === 'underline' ? ' underlined,' : ''}
								rotated {fontRotation} degrees
							</span>
						</Button>
					</div>
				</div>
			</div>
		);
	}
	private ensureBufferWatchersForSelectedGraphic = (graphic: any) => {
		// If the graphic has buffer settings, ensure geometry watcher is active
		if (graphic.bufferSettings && graphic.bufferSettings.enabled && graphic.bufferGraphic) {
			const parentId = graphic.attributes?.uniqueId;

			if (parentId) {
				//console.log(`🔧 Widget: Ensuring buffer watcher for selected graphic: ${parentId}`);

				// Set up geometry watcher for real-time buffer updates
				const watcherKey = parentId + '_widget_buffer';
				const existingWatcher = this._positionWatchers[watcherKey];
				if (existingWatcher) {
					existingWatcher.remove();
				}

				// Create a geometry watcher specifically for buffer updates
				this._positionWatchers[watcherKey] = graphic.watch('geometry', async (newGeometry) => {
					//console.log(`🔄 Widget: Geometry changed, updating buffer for ${parentId}`);

					if (graphic.bufferGraphic && graphic.bufferSettings) {
						try {
							// Update buffer immediately
							await this.updateAttachedBuffer(graphic);
						} catch (error) {
							console.error('❌ Widget: Error updating buffer:', error);
						}
					}
				});
			}
		}
	};
	// Add this method to the Widget class
	private ensurePointTextOverlayFromMap = (graphic: ExtendedGraphic) => {
		// console.log('🔶 ensurePointTextOverlayFromMap called with:', {
		//   hasGraphic: !!graphic,
		//   hasDrawLayer: !!this.drawLayer,
		//   geometryType: graphic?.geometry?.type,
		//   symbolType: graphic?.symbol?.type,
		//   graphicName: graphic?.attributes?.name
		// });

		// Guards
		if (!graphic || !this.drawLayer) {
			//console.log('❌ ensurePointTextOverlayFromMap: missing graphic or layer');
			return;
		}
		if (!graphic.geometry || graphic.geometry.type !== 'point') {
			//console.log('❌ ensurePointTextOverlayFromMap: not a point geometry');
			return;
		}

		// Ensure attributes & uniqueId (used for overlay→parent linkage)
		try {
			if (!(graphic as any).attributes) (graphic as any).attributes = {};
			if (!(graphic as any).attributes.uniqueId) {
				(graphic as any).attributes.uniqueId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			}
		} catch (e) {
			console.warn('ensurePointTextOverlayFromMap: could not ensure uniqueId:', e);
		}

		// SINGLE-SELECTION POLICY: clear ALL other overlays before creating this one
		try {
			const all = this.drawLayer.graphics.toArray();
			for (const g of all as any[]) {
				if (g && g.attributes?.isSelectionOverlay) {
					try { this.drawLayer.remove(g); } catch { }
				}
				if (g && g._selectionOverlay && g !== graphic) {
					try { if (g._selectionOverlay.layer === this.drawLayer) this.drawLayer.remove(g._selectionOverlay); } catch { }
					g._selectionOverlay = null;
				}
			}
		} catch (e) {
			console.warn('ensurePointTextOverlayFromMap: failed clearing prior overlays:', e);
		}

		// If this graphic already had an overlay, remove it so we can recreate cleanly
		if ((graphic as any)._selectionOverlay) {
			try {
				if ((graphic as any)._selectionOverlay.layer === this.drawLayer) {
					this.drawLayer.remove((graphic as any)._selectionOverlay);
				}
			} catch { }
			(graphic as any)._selectionOverlay = null;
		}

		// Build halo symbol (square for text, circle for markers); faint fill so hitTest can pick it
		const isText = (graphic.symbol as any)?.type === 'text';
		const overlaySymbol = new SimpleMarkerSymbol({
			style: isText ? 'square' : 'circle',
			size: isText ? 28 : 24,
			color: [255, 128, 0, 0.10],                 // faint orange fill (hit-testable)
			outline: { color: [255, 128, 0, 1], width: 2 }
		});

		const overlay = new Graphic({
			geometry: graphic.geometry,
			symbol: overlaySymbol,
			attributes: {
				hideFromList: true,
				isMeasurementLabel: false,
				isSelectionOverlay: true,
				parentGraphicId: (graphic as any).attributes?.uniqueId ?? null
			}
		});

		try {
			// Add + attach pointer on parent
			this.drawLayer.add(overlay);
			(graphic as any)._selectionOverlay = overlay;

			// Prefer top-of-layer order: remove→add now, then again next frame
			const bringToFront = () => {
				try { this.drawLayer.remove(overlay); } catch { }
				this.drawLayer.add(overlay);
			};

			bringToFront();

			// Next macrotask (guards against SVM repaint on the same tick)
			setTimeout(() => {
				try {
					if ((graphic as any)._selectionOverlay && (graphic as any)._selectionOverlay.layer === this.drawLayer) {
						bringToFront();
					}
				} catch (e) {
					console.warn('Overlay bring-to-front next-tick failed:', e);
				}
			}, 0);

			// If zIndex is supported by your API version, push it up (harmless if unsupported)
			try { (overlay as any).zIndex = 99999; } catch { }

			// Final verification + prune any stray duplicate overlays that may have slipped in
			const overlays = this.drawLayer.graphics.toArray().filter((g: any) => g.attributes?.isSelectionOverlay);
			if (overlays.length > 1) {
				overlays.forEach((g: any) => { if (g !== overlay) { try { this.drawLayer.remove(g); } catch { } } });
			}

			const overlayInLayer = this.drawLayer.graphics.toArray()
				.some((g: any) => g === overlay || g.attributes?.isSelectionOverlay);
			//console.log('🔍 Overlay present in layer:', overlayInLayer);
		} catch (error) {
			console.error('❌ Error creating overlay:', error);
		}
	};

	private updateAttachedBuffer = async (parentGraphic: any) => {
		if (!this.drawLayer || !parentGraphic.bufferGraphic || !parentGraphic.bufferSettings) return;
		// Guard: skip if an update is already in progress for this graphic
		const _bufId = parentGraphic.attributes?.uniqueId ?? 'noid';
		if (this._bufferUpdateInProgress.has(_bufId)) return;
		this._bufferUpdateInProgress.add(_bufId);

		try {
			const { distance, unit, opacity } = parentGraphic.bufferSettings;

			//console.log(`🔄 Widget: Creating new buffer geometry for ${parentGraphic.attributes?.uniqueId} with ${opacity || 50}% opacity`);

			// Create new buffer geometry using async geometry engine
			const newBufferGeometry = await this.createBufferGeometry(
				parentGraphic.geometry,
				distance,
				unit
			);

			if (newBufferGeometry) {
				// Update the buffer graphic's geometry immediately
				const bufferGraphic = parentGraphic.bufferGraphic;

				// 🔧 ENHANCED: Also update the symbol to reflect any opacity changes
				const updatedSymbol = this.createBufferSymbolWithOpacity(parentGraphic, opacity || 50);
				bufferGraphic.symbol = updatedSymbol;

				// Remove from layer
				this.drawLayer.remove(bufferGraphic);

				// Update geometry
				bufferGraphic.geometry = newBufferGeometry;

				// Re-add to layer at correct position
				const parentIndex = this.drawLayer.graphics.indexOf(parentGraphic);
				if (parentIndex >= 0) {
					this.drawLayer.graphics.add(bufferGraphic, parentIndex);
				} else {
					this.drawLayer.add(bufferGraphic);
				}

				//console.log(`✅ Widget: Buffer geometry updated and refreshed for graphic ${parentGraphic.attributes?.uniqueId} with ${opacity || 50}% opacity`);
			}
		} catch (error) {
			console.error('❌ Widget: Error updating attached buffer:', error);
		} finally {
			this._bufferUpdateInProgress.delete(_bufId);
		}
	};
	private createBufferSymbolWithOpacity = (parentGraphic: any, opacity: number): SimpleFillSymbol => {
		const geomType = parentGraphic.geometry?.type;
		const parentSymbol = parentGraphic.symbol;
		const opacityMultiplier = opacity / 100;

		let fillColor = new Color([0, 0, 0, 0.15 * opacityMultiplier]);
		let outlineColor = new Color([0, 0, 0, 0.6 * opacityMultiplier]);
		let outlineWidth = 1.5;

		// Custom color override: drive fill and outline from chosen colors
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
				outlineWidth = 2.5;
				if (parentGraphic.bufferSettings?.outlineOnly) {
					return new SimpleFillSymbol({
						color: new Color([0, 0, 0, 0]),
						outline: new SimpleLineSymbol({ color: outlineColor, width: Math.max(outlineWidth, 2.5), style: 'solid' })
					});
				}
				return new SimpleFillSymbol({
					color: fillColor,
					outline: new SimpleLineSymbol({ color: outlineColor, width: outlineWidth, style: 'dash' })
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
					if (fillSym.outline?.width) {
						outlineWidth = fillSym.outline.width * 0.8;
					}
				}
			} else if (geomType === 'polyline' && parentSymbol) {
				const lineSym = parentSymbol as any;
				if (lineSym?.color) {
					const rgba = lineSym.color.toRgba ? lineSym.color.toRgba() : [0, 0, 0, 1];
					fillColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * 0.6 * opacityMultiplier, 1.0)]);
					outlineColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * opacityMultiplier, 1.0)]);
					if (lineSym.width) {
						outlineWidth = lineSym.width * 0.8;
					}
				}
			} else if (geomType === 'point' && parentSymbol) {
				const markerSym = parentSymbol as any;
				if (markerSym?.color) {
					const rgba = markerSym.color.toRgba ? markerSym.color.toRgba() : [0, 0, 0, 1];
					fillColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * 0.6 * opacityMultiplier, 1.0)]);
					outlineColor = new Color([rgba[0], rgba[1], rgba[2], Math.min(rgba[3] * opacityMultiplier, 1.0)]);
					if (markerSym.outline?.width) {
						outlineWidth = markerSym.outline.width * 0.8;
					}
				}
			}
		} catch (error) {
			console.warn('Error processing colors:', error);
		}

		//console.log(`🎨 Widget: Creating buffer symbol with ${opacity}% opacity`);

		// Outline-only: transparent fill, solid stroke. Keeps the buffer outline
		// visible without a fill when the parent geometry is edited/moved.
		if (parentGraphic.bufferSettings?.outlineOnly) {
			return new SimpleFillSymbol({
				color: new Color([0, 0, 0, 0]),
				outline: new SimpleLineSymbol({
					color: outlineColor,
					width: Math.max(outlineWidth, 2.5),
					style: 'solid'
				})
			});
		}

		return new SimpleFillSymbol({
			color: fillColor,
			outline: new SimpleLineSymbol({
				color: outlineColor,
				width: outlineWidth,
				style: 'dash'
			})
		});
	};
	private createBufferGeometry = async (geometry: any, distance: number, unit: string): Promise<any | null> => {
		try {
			const view = this.state.currentJimuMapView?.view;
			if (!view) return null;
			// True curves carry empty paths, which geometryEngine.buffer and the manual
			// fallback can't consume (the buffer collapses to a bounding circle).
			// Densify the curve into a plain polyline first so the buffer follows it.
			if (geometry?.type === 'polyline' && (geometry as any).curvePaths) {
				try {
					const ext = geometry.extent;
					const span = ext ? Math.max(ext.width || 0, ext.height || 0) : 0;
					const maxSeg = Math.max(span ? span / 200 : 1, 1e-6);
					const dense: any = densifyOperator.execute(geometry, maxSeg);
					if (dense && dense.paths && dense.paths.length) geometry = dense;
				} catch (e) { console.warn('curve densify for buffer failed:', e); }
			}
			// Try the geometry engine first — produces a true geometric buffer (no even/odd
			// ring artifacts, multi-ring inputs collapse to a single merged buffer).
			try {
				const ge: any = (geometryEngine as any).default || geometryEngine;
				if (ge?.buffer) {
					const sr = view.spatialReference;
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
			return manualBufferGeometry(geometry, bufferToMeters(distance, unit), view.spatialReference);
		} catch (e) {
			console.error('Buffer geometry error', e);
			return null;
		}
	};
	private createLineSymbolWithBuiltInArrows = (
		base: any,
		arrowPosition: 'start' | 'end' | 'both',
		arrowSize: number
	): any => {
		// console.log('Creating SimpleLineSymbol with built-in arrows:', {
		//   baseColor: base.color,
		//   baseWidth: base.width,
		//   arrowPosition
		// });

		// Map arrow position to API placement values
		let placement: 'begin' | 'end' | 'begin-end';
		switch (arrowPosition) {
			case 'start':
				placement = 'begin';
				break;
			case 'end':
				placement = 'end';
				break;
			case 'both':
				placement = 'begin-end';
				break;
			default:
				console.warn('Unknown arrow position:', arrowPosition, 'defaulting to end');
				placement = 'end';
		}

		//console.log('Mapped placement:', placement);

		// Create SimpleLineSymbol with marker - arrows scale with line width
		const result = new SimpleLineSymbol({
			color: base.color,
			style: base.style,
			width: base.width,
			marker: {
				type: 'line-marker',
				style: 'arrow',
				placement: placement,
				color: base.color
			}
		});

		//console.log('Created SimpleLineSymbol with arrows');
		return result;
	};

	private renderCirclePresetControls() {
		const presetEnabled = !!this.state.circlePresetEnabled;
		const presetMode = this.state.circlePresetMode || 'radius';

		return (
			<div
				className="circle-preset-controls mt-3"
				role="region"
				aria-label="Preset circle size settings"
			>
				<div className="d-flex align-items-center drawToolbarDiv">
					<Label
						centric
						id="preset-circle-size-label"
					>
						Preset Circle Size
						<Switch
							className="ml-2"
							checked={presetEnabled}
							onChange={(e) => this._setCirclePresetEnabled((e.target as HTMLInputElement).checked)}
							aria-labelledby="preset-circle-size-label"
							aria-describedby="preset-circle-size-description"
							title={presetEnabled ? "Click to disable the preset circle size" : "Click to place a circle with an exact radius or area with one click"}
						/>
						<span id="preset-circle-size-description" className="sr-only">
							Toggle to place a circle with an exact radius or area with a single click on the map
						</span>
					</Label>
				</div>

				{presetEnabled && (
					<div className="mt-2">
						<div className="d-flex align-items-center mb-2 drawToolbarDiv" role="group" aria-label="Preset circle size by">
							<Label
								centric
								className="mb-0"
								id="preset-circle-mode-label"
							>
								Size By:
								<Select
									size="sm"
									className="ml-2"
									value={presetMode}
									onChange={(e) => this._setCirclePresetMode((e.target as HTMLSelectElement).value as 'radius' | 'area')}
									style={{ width: '110px' }}
									aria-labelledby="preset-circle-mode-label"
									title={`Currently sizing by ${presetMode === 'radius' ? 'radius' : 'area'}. Select radius or area.`}
								>
									<Option value="radius">Radius</Option>
									<Option value="area">Area</Option>
								</Select>
							</Label>
						</div>
						<div className="d-flex align-items-center mb-1 drawToolbarDiv" role="group" aria-label="Preset circle size value and unit">
							<Label
								centric
								className="mb-0"
								id="preset-circle-value-label"
							>
								{presetMode === 'radius' ? 'Radius:' : 'Area:'}
								<NumericInput
									size="sm"
									className="ml-2 mr-2"
									value={this.state.circlePresetValue ?? 100}
									min={0.01}
									step={1}
									onChange={(v: number) => this.setState({ circlePresetValue: v })}
									style={{ width: '80px' }}
									aria-labelledby="preset-circle-value-label"
									title={`Current value: ${this.state.circlePresetValue ?? 100}. Enter the circle ${presetMode === 'radius' ? 'radius' : 'area'}.`}
								/>
								<Select
									size="sm"
									value={this.state.circlePresetUnit || 'feet'}
									onChange={(e) => this.setState({ circlePresetUnit: (e.target as HTMLSelectElement).value })}
									style={{ width: '150px' }}
									aria-label={`Circle ${presetMode === 'radius' ? 'radius' : 'area'} unit of measurement`}
									title={`Current unit: ${this.state.circlePresetUnit || 'feet'}. Select the unit of measurement.`}
								>
									{(presetMode === 'radius'
										? [['feet', 'Feet'], ['yards', 'Yards'], ['meters', 'Meters'], ['kilometers', 'Kilometers'], ['miles', 'Miles']]
										: [['acres', 'Acres'], ['square-feet', 'Square Feet'], ['square-meters', 'Square Meters'], ['hectares', 'Hectares'], ['square-kilometers', 'Square Kilometers'], ['square-miles', 'Square Miles']]
									).map(([unitValue, unitLabel]) => (
										<Option key={unitValue} value={unitValue}>{unitLabel}</Option>
									))}
								</Select>
							</Label>
						</div>
						<div className="text-center" style={{ fontSize: 13, opacity: 0.85 }}>Click the map to place the circle&nbsp;&nbsp;&bull;&nbsp;&nbsp;Esc to cancel</div>
					</div>
				)}
			</div>
		);
	}

	private renderArrowControls() {
		const { arrowEnabled, arrowPosition } = this.state;

		return (
			<div
				className="arrow-controls mt-3"
				role="region"
				aria-label="Line arrow settings"
			>
				<div className="d-flex align-items-center drawToolbarDiv">
					<Label
						centric
						id="enable-arrows-label"
					>
						Enable Arrows
						<Switch
							className="ml-2"
							checked={arrowEnabled}
							onChange={this.handleArrowToggle}
							aria-labelledby="enable-arrows-label"
							aria-describedby="enable-arrows-description"
							title={arrowEnabled ? "Click to disable arrow markers on lines" : "Click to enable arrow markers on lines"}
						/>
						<span id="enable-arrows-description" className="sr-only">
							Toggle to add directional arrow markers to line drawings
						</span>
					</Label>
				</div>

				{arrowEnabled && (
					<div
						className="d-flex align-items-center mb-2 drawToolbarDiv"
						role="group"
						aria-label="Arrow position selection"
					>
						<Label
							centric
							className="mb-0"
							id="arrow-position-label"
						>
							Arrow Position:
							<AdvancedButtonGroup
								className='ml-2'
								role="radiogroup"
								aria-labelledby="arrow-position-label"
							>
								<Button
									className='m-0'
									size="sm"
									type={arrowPosition === 'start' ? 'primary' : 'secondary'}
									active={arrowPosition === 'start'}
									onClick={() => {
										this.setState({ arrowPosition: 'start' }, () => {
											this.updateLineArrows();
										});
									}}
									role="radio"
									aria-checked={arrowPosition === 'start'}
									aria-label="Place arrow at the start of the line"
									title="Arrow will appear at the beginning of the line"
								>
									Start
								</Button>
								<Button
									className='m-0'
									size="sm"
									type={arrowPosition === 'end' ? 'primary' : 'secondary'}
									active={arrowPosition === 'end'}
									onClick={() => {
										this.setState({ arrowPosition: 'end' }, () => {
											this.updateLineArrows();
										});
									}}
									role="radio"
									aria-checked={arrowPosition === 'end'}
									aria-label="Place arrow at the end of the line"
									title="Arrow will appear at the end of the line"
								>
									End
								</Button>
								<Button
									className='m-0'
									size="sm"
									type={arrowPosition === 'both' ? 'primary' : 'secondary'}
									active={arrowPosition === 'both'}
									onClick={() => {
										this.setState({ arrowPosition: 'both' }, () => {
											this.updateLineArrows();
										});
									}}
									role="radio"
									aria-checked={arrowPosition === 'both'}
									aria-label="Place arrows at both ends of the line"
									title="Arrows will appear at both the start and end of the line"
								>
									Both
								</Button>
							</AdvancedButtonGroup>
						</Label>
					</div>
				)}
			</div>
		);
	}

	private updateLineArrows = () => {
		//console.log('Updating line arrows with built-in markers, enabled:', this.state.arrowEnabled);
		//console.log('Using arrow size:', this.state.arrowSize);

		// Validate SketchViewModel before proceeding
		if (!this.sketchViewModel || !this.sketchViewModel.view) {
			console.warn('SketchViewModel not available for updateLineArrows');
			return;
		}

		// Update existing graphics
		if (this.state.graphics?.length > 0) {
			this.state.graphics.forEach((gra: Graphic) => {
				if (gra.geometry?.type !== 'polyline') return;

				//console.log('Updating arrows for polyline:', gra.attributes?.uniqueId);

				// Get clean base symbol (remove any existing marker)
				let baseSymbol: any;

				if (gra.symbol?.type === 'simple-line') {
					// Build a fresh marker-free base. delete on an Esri Accessor's
					// 'marker' is unreliable, so reconstruct explicitly.
					const src = gra.symbol as any;
					baseSymbol = new SimpleLineSymbol({ color: src.color, width: src.width, style: src.style });
				} else {
					// Fall back to SketchViewModel's default - with validation
					if (!this.sketchViewModel.polylineSymbol) {
						console.warn('SketchViewModel polylineSymbol not available');
						return;
					}
					const src = this.sketchViewModel.polylineSymbol as any;
					baseSymbol = new SimpleLineSymbol({ color: src.color, width: src.width, style: src.style });
				}

				if (!baseSymbol || baseSymbol.type !== 'simple-line') {
					console.warn('Could not find valid base line symbol');
					return;
				}

				// Apply arrows or remove them - PASS CURRENT STATE VALUES DIRECTLY
				if (this.state.arrowEnabled) {
					try {
						const arrowSymbol = this.createLineSymbolWithBuiltInArrows(
							baseSymbol,
							this.state.arrowPosition,
							this.state.arrowSize
						);
						gra.symbol = arrowSymbol;
						//console.log('Applied built-in arrows to graphic with size:', this.state.arrowSize);
					} catch (error) {
						console.warn('Error applying arrows to graphic:', error);
					}
				} else {
					gra.symbol = baseSymbol; // Remove arrows, use base symbol
					//console.log('Removed arrows from graphic');
				}
			});
		}

		// Update the SketchViewModel symbol for new drawings - FIXED VERSION
		const svmBase = this.sketchViewModel.polylineSymbol as any;
		if (svmBase && svmBase.type === 'simple-line') {
			try {
				// Create a completely clean base symbol without any marker properties
				const cleanBase = new SimpleLineSymbol({
					color: svmBase.color,
					width: svmBase.width,
					style: svmBase.style
					// Explicitly NOT copying the marker property
				});

				const updatedSymbol = this.state.arrowEnabled
					? this.createLineSymbolWithBuiltInArrows(
						cleanBase,
						this.state.arrowPosition,
						this.state.arrowSize
					)
					: cleanBase;

				this.sketchViewModel.polylineSymbol = updatedSymbol;
				this.setState({ currentSymbol: updatedSymbol });
				//console.log('Updated SketchViewModel polyline symbol - arrows enabled:', this.state.arrowEnabled);
			} catch (error) {
				console.warn('Error updating SketchViewModel polyline symbol:', error);
			}
		}
	};

	handleArrowToggle = (e) => {
		const enabled = e.target.checked;
		//console.log('Arrow toggle changed:', enabled);

		this.setState({ arrowEnabled: enabled }, () => {
			//console.log('State updated, calling updateLineArrows');
			this.updateLineArrows();
		});
	};
	private invalidatePendingOverlays = () => {
		// Bump epoch so any scheduled overlay tasks from previous selections are ignored
		this._selectionEpoch++;
	};

	private clearAllSelectionOverlays = () => {
		if (!this.drawLayer) return;
		try {
			this.drawLayer.graphics.toArray().forEach((g: any) => {
				if (g && g._selectionOverlay) {
					try {
						if (g._selectionOverlay.layer === this.drawLayer) {
							this.drawLayer.remove(g._selectionOverlay);
						}
					} catch { }
					g._selectionOverlay = null;
				}
			});
		} catch { }
	};

	private removeAttachedBuffer = (parentGraphic: any) => {
		if (!this.drawLayer || !parentGraphic) return;

		const parentId = parentGraphic.attributes?.uniqueId;
		if (!parentId) return;

		//console.log(`🗑️ Widget: Removing attached buffer for graphic ${parentId}`);

		// Remove buffer graphic from layer
		if (parentGraphic.bufferGraphic) {
			this.drawLayer.remove(parentGraphic.bufferGraphic);
			parentGraphic.bufferGraphic = null;
			//console.log(`✅ Widget: Removed attached buffer graphic`);
		}

		// Clear buffer settings
		if (parentGraphic.bufferSettings) {
			parentGraphic.bufferSettings = null;
			//console.log(`✅ Widget: Cleared buffer settings`);
		}

		// Remove geometry watcher if it exists
		const watcherKey = parentId + '_widget_buffer';
		if (this._positionWatchers && this._positionWatchers[watcherKey]) {
			try {
				this._positionWatchers[watcherKey].remove();
				delete this._positionWatchers[watcherKey];
				//console.log(`✅ Widget: Removed buffer geometry watcher`);
			} catch (error) {
				console.warn('Widget: Error removing buffer geometry watcher:', error);
			}
		}
	};
	private cleanupOrphanedBuffers = () => {
		if (!this.drawLayer) return;

		try {
			const allGraphics = this.drawLayer.graphics.toArray();

			// Get all buffer graphics (including preview buffers and attached buffers)
			const allBuffers = allGraphics.filter(g =>
				g.attributes?.isPreviewBuffer ||
				g.attributes?.isBuffer ||
				g.attributes?.isBufferDrawing
			);

			const measurementLabels = allGraphics.filter(g => g.attributes?.isMeasurementLabel);

			// Get all main graphics (potential parents)
			const mainGraphics = allGraphics.filter(g =>
				!g.attributes?.isPreviewBuffer &&
				!g.attributes?.isBuffer &&
				!g.attributes?.isMeasurementLabel &&
				!g.attributes?.hideFromList &&
				!g.attributes?.isBufferDrawing
			);

			// Create set of valid parent IDs
			const validParentIds = new Set(
				mainGraphics
					.map(g => g.attributes?.uniqueId)
					.filter(id => id)
			);

			// Find orphaned buffers
			const orphanedBuffers = allBuffers.filter(buffer => {
				const parentId = buffer.attributes?.parentId ||
					buffer.attributes?.sourceGraphicId;
				return !parentId || !validParentIds.has(parentId);
			});

			// Find orphaned measurement labels
			const orphanedMeasurementLabels = measurementLabels.filter(label => {
				const parentId = label.attributes?.parentGraphicId;
				return !parentId || !validParentIds.has(parentId);
			});

			// Remove orphaned items
			if (orphanedBuffers.length > 0) {
				//console.log(`Widget: Cleaning up ${orphanedBuffers.length} orphaned buffer graphics`);
				orphanedBuffers.forEach(buffer => {
					this.drawLayer.remove(buffer);
				});
			}

			if (orphanedMeasurementLabels.length > 0) {
				//console.log(`Widget: Cleaning up ${orphanedMeasurementLabels.length} orphaned measurement labels`);
				orphanedMeasurementLabels.forEach(label => {
					this.drawLayer.remove(label);
				});
			}

			if (orphanedBuffers.length > 0 || orphanedMeasurementLabels.length > 0) {
				//console.log(`✅ Widget: Buffer cleanup completed - removed ${orphanedBuffers.length} buffers and ${orphanedMeasurementLabels.length} labels`);
			}
		} catch (error) {
			console.error('❌ Widget: Error cleaning up orphaned graphics:', error);
		}
	};

	constructor(props) {
		super(props);
		this.state = {
			currentJimuMapView: null,
			graphics: [],
			pointBtnActive: false,
			lineBtnActive: false,
			flineBtnActive: false,
			rectBtnActive: false,
			polygonBtnActive: false,
			fpolygonBtnActive: false,
			circleBtnActive: false,
			textBtnActive: false,
			circlePresetEnabled: false,
			circlePresetMode: 'radius',
			circlePresetValue: 100,
			circlePresetUnit: 'feet',
			showSymPreview: false,
			currentSymbol: null,
			currentSymbolType: null,
			currentTextSymbol: TextSymbol.fromJSON({
				type: 'esriTS',
				verticalAlignment: 'middle',
				font: { family: 'Avenir Next LT Pro' },
				text: 'Text',
				lineWidth: 9999
			}),
			undoBtnActive: false,
			redoBtnActive: false,
			clearBtnActive: false,
			drawGLLengthcheck: false,
			currentTool: '',
			clearBtnTitle: this.nls('drawClear'),
			canUndo: false,
			canRedo: false,
			showTextPreview: false,
			textSymPreviewText: 'Text',
			fontColor: 'rgba(0,0,0,1)',
			fontSize: `${new TextSymbol().font.size ?? 14}`,
			fontHaloSize: 1,
			fontHaloColor: 'rgba(255,255,255,1)',
			fontHaloEnabled: false,
			fontHalo: 'unset',
			fontWeight: 'normal',
			fontDecoration: 'none',
			fontStyle: 'normal',
			hTextAlign: TextAlignValue.CENTER,
			vTextAlign: 'middle',
			fontRotation: 0,
			textNumLines: 1,
			vAlignBaseBtnActive: false,
			vAlignTopBtnActive: false,
			vAlignMidBtnActive: true,
			vAlignBotBtnActive: false,
			textPreviewHeight: 25,
			hAlignLeftBtnActive: false,
			hAlignCenterBtnActive: true,
			hAlignRightBtnActive: false,
			fsBoldBtnActive: false,
			fsItalicBtnActive: false,
			fsUnderlineBtnActive: false,
			widgetInit: false,
			textPreviewisOpen: false,
			fontOpacity: 1,
			fontHaloOpacity: 1,
			textHasChanged: false,
			rotationMode: false,
			drawLayerTitle: this.props.config.title,
			listMode: this.props.config.listMode ? 'show' : 'hide',
			confirmDelete: false,
			fontBackgroundColor: 'rgba(0,0,0,0)',
			showDrawingsPanel: false, // Added BM
			selectedDrawingIndex: null, // Added BM
			activeTab: (this.props.config.enableMyDrawings !== false && this.props.config.defaultTab === 'mydrawings') ? 'mydrawings' : 'draw', // Added BM
			selectedGraphicIndex: null,
			selectedGraphics: new Set<number>(),
			arrowEnabled: false,
			arrowPosition: 'end',
			arrowSize: 24,
			measurementCheckboxOn: false,
			// Copy/Paste feature initialization
			copiedFeature: null,
			copyModeActive: false,
			copyFeatureCandidates: [],
			showCopyPicker: false,
			copyPickerFilter: '',
			copyPasteToast: null,
			// New: Layer-first copy approach
			showCopyLayerDropdown: false,
			copyableLayers: [],
			selectedCopyLayerId: null,
			// Multi-copy selection mode
			showCopyModePrompt: false,
			copyModePromptContext: null,
			copySelectionMode: null,
			multiCopySelectedFeatures: [],
			multiCopyLockedLayerTitle: null,
			multiCopySpatialTool: null,
			isActivelyDrawing: false
		};
		this.creationMode = this.props.config.creationMode || DrawMode.SINGLE;
	}

	nls = (id: string) => {
		return this.props.intl ? this.props.intl.formatMessage({ id: id, defaultMessage: defMessages[id] }) : id;
	}

	componentDidMount() {
		this.setState({ widgetInit: true });
		this.drawLayer = new GraphicsLayer({
			id: 'DrawGL',
			listMode: this.props.config.listMode ? 'show' : 'hide',
			title: this.props.config.title
		});
		this.identifyResultsLayer = new GraphicsLayer({ id: 'DrawGL_IdentifyResults', listMode: 'hide' as any, title: 'Identify Results (Draw)' });

		// Initialize drawing map for graphic tracking
		this._drawingMap = new Map();

		// Inject keyframe animation for toast notifications
		if (!document.getElementById('draw-widget-toast-styles')) {
			const style = document.createElement('style');
			style.id = 'draw-widget-toast-styles';
			style.textContent = `@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`;
			document.head.appendChild(style);
		}

		// Listen for save events from BufferControls
		window.addEventListener('saveDrawingsToStorage', this.handleSaveEvent);

		// Add escape key handler for copy mode
		document.addEventListener('keydown', this.handleKeyDown);

		// Set up Identify By Query integration listener
		if (this.props.config?.enableIdentifyIntegration) {
			this.setupIdentifyListener();
		}
	}

	/**
	 * Handle keyboard events - specifically Escape to cancel copy mode
	 */
	private handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			if (this.state.multiCopySpatialTool) {
				// Cancel spatial drawing, stay in multi-copy mode
				this.cleanupSpatialSelectSketch();
				this.setState({ multiCopySpatialTool: null });
				const view = this.state.currentJimuMapView?.view;
				if (view) view.container.style.cursor = 'copy';
				this.announceToScreenReader('Spatial selection cancelled.');
			} else if (this.state.showCopyModePrompt) {
				this.setState({ showCopyModePrompt: false, copyModePromptContext: null });
				this.announceToScreenReader('Copy mode selection cancelled.');
			} else if (this.state.showCopyLayerDropdown) {
				this.setState({ showCopyLayerDropdown: false, copyableLayers: [] });
				this.announceToScreenReader('Layer selection cancelled.');
			} else if (this.state.showCopyPicker) {
				this.cancelCopyPicker();
			} else if (this.state.copySelectionMode === 'multiple' && this.state.multiCopySelectedFeatures.length > 0) {
				this.cancelMultiCopy();
			} else if (this.state.copyModeActive) {
				this.deactivateCopyMode();
				this.announceToScreenReader('Copy mode cancelled.');
			}
		}
	};

	// Add this new method to handle save events
	private handleSaveEvent = (event: CustomEvent) => {
		//console.log('📦 Received save event from BufferControls');

		// Trigger immediate save to localStorage (buffer may have just been created)
		if (this.drawLayer) {
			const allDrawings = this.drawLayer.graphics.toArray();
			// Save immediately (bypass debounce) via direct localStorage write
			this.saveDrawingsToLocalStorage(allDrawings);
			// Also propagate to MyDrawingsPanel for its state sync
			this.handleDrawingsUpdate(allDrawings);
		}
	};

	// ============================================================================
	// COPY/PASTE FEATURE - Copy from map layers, paste into drawings
	// ============================================================================

	/**
	 * Activates copy mode - user will click on a feature to copy it
	 */
	private activateCopyMode = () => {
		// Cancel any active drawing operation
		this.setDrawToolBtnState('');
		try { this.sketchViewModel?.cancel(); } catch { /* no-op */ }

		// Remove any existing highlight from previous copy
		this.removeCopyHighlight();
		this.removeMultiCopyHighlights();

		// Show the single/multiple selection prompt
		this.setState({
			showCopyModePrompt: true,
			copyModePromptContext: 'click-first',
			showCopyLayerDropdown: false,
			selectedCopyLayerId: null
		});
	};

	/**
	 * Actually enter copy mode after mode selection (single or multiple)
	 */
	private enterCopyMode = (selectionMode: 'single' | 'multiple') => {
		this.setState({
			showCopyModePrompt: false,
			copyModePromptContext: null,
			copyModeActive: true,
			copiedFeature: null,
			selectedCopyLayerId: null,
			showCopyLayerDropdown: false,
			copySelectionMode: selectionMode,
			multiCopySelectedFeatures: []
		});

		// Show visual feedback that copy mode is active
		const view = this.state.currentJimuMapView?.view;
		if (view) {
			view.container.style.cursor = 'copy';
		}

		if (selectionMode === 'multiple') {
			this.showCopyPasteToast('Click features to select them. Click Done when finished.', 'info');
			this.announceToScreenReader('Multi-select copy mode active. Click features on the map to select them, then click Done to copy all.');
		} else {
			this.showCopyPasteToast('Click a feature on the map to copy', 'info');
			this.announceToScreenReader('Copy mode active. Click any feature on the map to copy it to your drawings.');
		}
	};

	/**
	 * Deactivates copy mode
	 */
	private deactivateCopyMode = () => {
		this.removeMultiCopyHighlights();
		this.cleanupSpatialSelectSketch();
		this.setState({
			copyModeActive: false,
			selectedCopyLayerId: null,
			showCopyLayerDropdown: false,
			copySelectionMode: null,
			multiCopySelectedFeatures: [],
			showCopyModePrompt: false,
			copyModePromptContext: null,
			multiCopySpatialTool: null
		});

		const view = this.state.currentJimuMapView?.view;
		if (view) {
			view.container.style.cursor = 'default';
		}
	};

	/**
	 * Handle click event during copy mode - queries the selected layer for features
	 */
	private handleCopyModeClick = async (event: any) => {
		if (!this.state.copyModeActive) return;

		const view = this.state.currentJimuMapView?.view;
		if (!view) return;

		try {
			const candidates: Array<{ graphic: any; layerTitle: string; geometryType: string }> = [];
			const { selectedCopyLayerId, copyableLayers } = this.state;

			// Build tolerance-based query extent for better point/line selection
			const tolerance = view.resolution * 20;
			const queryExtent = new Extent({
				xmin: event.mapPoint.x - tolerance,
				ymin: event.mapPoint.y - tolerance,
				xmax: event.mapPoint.x + tolerance,
				ymax: event.mapPoint.y + tolerance,
				spatialReference: event.mapPoint.spatialReference
			});

			// If a specific layer is selected, only query that layer
			if (selectedCopyLayerId) {
				const selectedLayer = copyableLayers.find(l => l.id === selectedCopyLayerId);
				if (!selectedLayer || !selectedLayer.layerRef) {
					this.showCopyPasteToast('Selected layer no longer available.', 'error');
					this.deactivateCopyMode();
					return;
				}

				const { layerRef, title, type } = selectedLayer;

				// Query based on layer type
				if (type === 'feature' || type === 'geojson' || type === 'csv') {
					const layer = layerRef as any;
					try {
						const query = layer.createQuery();
						query.geometry = queryExtent;
						query.spatialRelationship = 'intersects';
						query.returnGeometry = true;
						query.outFields = ['*'];
						query.maxAllowableOffset = 0; // Full-resolution geometry

						const result = await layer.queryFeatures(query);
						if (result?.features?.length > 0) {
							for (const feature of result.features) {
								if (feature.geometry) {
									const geomType = feature.geometry.type === 'extent' ? 'rectangle' : feature.geometry.type;
									candidates.push({ graphic: feature, layerTitle: title, geometryType: geomType });
								}
							}
						}
					} catch (e) {
						console.warn('Query failed for layer:', title, e);
					}
				} else if (type === 'map-image-sublayer') {
					const sublayer = layerRef as any;
					try {
						const query = (sublayer as any).createQuery?.();
						if (query) {
							query.geometry = queryExtent;
							query.spatialRelationship = 'intersects';
							query.returnGeometry = true;
							query.outFields = ['*'];
							query.maxAllowableOffset = 0;

							const result = await (sublayer as any).queryFeatures(query);
							if (result?.features?.length > 0) {
								for (const feature of result.features) {
									if (feature.geometry) {
										const geomType = feature.geometry.type === 'extent' ? 'rectangle' : feature.geometry.type;
										candidates.push({ graphic: feature, layerTitle: title, geometryType: geomType });
									}
								}
							}
						}
					} catch (e) {
						console.warn('Query failed for sublayer:', title, e);
					}
				} else if (type === 'graphics') {
					// For graphics layers, use hitTest
					const graphicsLayer = layerRef as any;
					const hitTestResult = await view.hitTest(event, { include: [graphicsLayer] });
					for (const result of hitTestResult.results) {
						if (!result || !('graphic' in result)) continue;
						const graphic = (result as any).graphic;
						if (!graphic.geometry) continue;
						const geomType = graphic.geometry.type === 'extent' ? 'rectangle' : graphic.geometry.type;
						candidates.push({ graphic, layerTitle: title, geometryType: geomType });
					}
				}

			} else {
				// No layer selected — click-first mode: query ALL visible layers
				const isLayerVisible = (layer: any): boolean => {
					if (!layer || !layer.visible) return false;
					let parent = (layer as any).parent;
					while (parent) {
						if (parent.visible === false) return false;
						parent = parent.parent;
					}
					return true;
				};

				const collectSublayers = (sublayers: any | null, parentTitle: string): Array<{ sublayer: any; title: string }> => {
					const result: Array<{ sublayer: any; title: string }> = [];
					if (!sublayers) return result;
					const arr = sublayers.toArray ? sublayers.toArray() : [];
					for (const sublayer of arr) {
						if (!sublayer.visible) continue;
						if (sublayer.sublayers && sublayer.sublayers.length > 0) {
							result.push(...collectSublayers(sublayer.sublayers, sublayer.title || parentTitle));
						} else {
							result.push({ sublayer, title: sublayer.title || parentTitle });
						}
					}
					return result;
				};

				// 1. hitTest to catch rendered features
				const hitTestResult = await view.hitTest(event);
				const hitTestHits: Array<{
					graphic: any;
					layer: any | null;
					layerTitle: string;
					geomType: string;
				}> = [];

				for (const result of hitTestResult.results) {
					if (!result || !('graphic' in result)) continue;
					const graphic = (result as any).graphic;
					if (graphic.attributes?.isMeasurementLabel) continue;
					if (graphic.attributes?.isSelectionOverlay) continue;
					if (graphic.attributes?.isPreviewBuffer) continue;
					if (!graphic.geometry) continue;

					const layer = (result as any).layer || null;
					const layerTitle = layer?.title || 'Graphics Layer';
					const geomType = graphic.geometry.type === 'extent' ? 'rectangle' : graphic.geometry.type;
					hitTestHits.push({ graphic, layer, layerTitle, geomType });
				}

				// Re-query feature layers for full-resolution geometry
				for (const hit of hitTestHits) {
					const { graphic, layer, layerTitle, geomType } = hit;

					if (!layer || layer.type === 'graphics' || graphic.attributes?.isDrawing) {
						candidates.push({ graphic, layerTitle, geometryType: geomType });
						continue;
					}

					if (layer.type === 'feature') {
						const featureLayer = layer as any;
						const objectIdField = featureLayer.objectIdField || 'OBJECTID';
						const objectId = graphic.attributes?.[objectIdField];
						if (objectId !== undefined) {
							try {
								const query = featureLayer.createQuery();
								query.objectIds = [objectId];
								query.returnGeometry = true;
								query.outFields = ['*'];
								query.maxAllowableOffset = 0;
								const result = await featureLayer.queryFeatures(query);
								if (result?.features?.length > 0) {
									candidates.push({ graphic: result.features[0], layerTitle, geometryType: geomType });
									continue;
								}
							} catch (e) { /* fall through */ }
						}
					}
					candidates.push({ graphic, layerTitle, geometryType: geomType });
				}

				const hitLayerIds = new Set(hitTestHits.filter(h => h.layer?.id).map(h => h.layer!.id));
				const allLayers = view.map.allLayers.toArray();

				// 2. Directly query feature layers not already covered by hitTest
				const featureLayers = allLayers.filter(l => l.type === 'feature' && isLayerVisible(l)) as any[];
				for (const featureLayer of featureLayers) {
					if (hitLayerIds.has(featureLayer.id)) continue;
					try {
						const query = featureLayer.createQuery();
						query.geometry = queryExtent;
						query.spatialRelationship = 'intersects';
						query.returnGeometry = true;
						query.outFields = ['*'];
						query.maxAllowableOffset = 0;
						const result = await featureLayer.queryFeatures(query);
						if (result?.features?.length > 0) {
							for (const feature of result.features) {
								if (feature.geometry) {
									const geomType = feature.geometry.type === 'extent' ? 'rectangle' : feature.geometry.type;
									candidates.push({ graphic: feature, layerTitle: featureLayer.title || 'Feature Layer', geometryType: geomType });
								}
							}
						}
					} catch (e) { /* query failed */ }
				}

				// 3. Query map-image sublayers
				const mapImageLayers = allLayers.filter(l => l.type === 'map-image' && isLayerVisible(l)) as any[];
				for (const mapImageLayer of mapImageLayers) {
					const allSublayers = collectSublayers(mapImageLayer.sublayers, mapImageLayer.title || 'Map Service');
					for (const { sublayer, title } of allSublayers) {
						try {
							const query = (sublayer as any).createQuery?.();
							if (!query) continue;
							query.geometry = queryExtent;
							query.spatialRelationship = 'intersects';
							query.returnGeometry = true;
							query.outFields = ['*'];
							query.maxAllowableOffset = 0;
							const result = await (sublayer as any).queryFeatures(query);
							if (result?.features?.length > 0) {
								for (const feature of result.features) {
									if (feature.geometry) {
										const geomType = feature.geometry.type === 'extent' ? 'rectangle' : feature.geometry.type;
										candidates.push({ graphic: feature, layerTitle: title, geometryType: geomType });
									}
								}
							}
						} catch (e) { /* sublayer might not support queries */ }
					}
				}

				// 4. Query GeoJSON and CSV layers
				const otherQueryableLayers = allLayers.filter(l =>
					(l.type === 'geojson' || l.type === 'csv') && isLayerVisible(l)
				);
				for (const layer of otherQueryableLayers) {
					if (hitLayerIds.has(layer.id)) continue;
					try {
						const query = (layer as any).createQuery?.();
						if (!query) continue;
						query.geometry = queryExtent;
						query.spatialRelationship = 'intersects';
						query.returnGeometry = true;
						query.outFields = ['*'];
						query.maxAllowableOffset = 0;
						const result = await (layer as any).queryFeatures(query);
						if (result?.features?.length > 0) {
							for (const feature of result.features) {
								if (feature.geometry) {
									const geomType = feature.geometry.type === 'extent' ? 'rectangle' : feature.geometry.type;
									candidates.push({ graphic: feature, layerTitle: (layer as any).title || 'Layer', geometryType: geomType });
								}
							}
						}
					} catch (e) { /* query failed */ }
				}
			}

			// Process candidates
			if (candidates.length === 0) {
				if (selectedCopyLayerId) {
					const selectedLayer = copyableLayers.find(l => l.id === selectedCopyLayerId);
					const layerName = selectedLayer?.title || 'the selected layer';
					this.showCopyPasteToast(`No feature found from "${layerName}" at click location.`, 'info');
					this.announceToScreenReader(`No feature found from ${layerName}. Try clicking on a visible feature.`);
				} else {
					this.showCopyPasteToast('No feature found at click location.', 'info');
					this.announceToScreenReader('No feature found. Try clicking on a visible feature.');
				}
			} else if (this.state.copySelectionMode === 'multiple') {
				// MULTI-SELECT MODE: add to selection instead of pasting
				if (candidates.length === 1) {
					this.addToMultiCopySelection(candidates[0]);
				} else {
					// Multiple features at click — show picker in multi-add mode
					this.setState({
						copyFeatureCandidates: candidates,
						showCopyPicker: true,
						// Keep copyModeActive true so we return to clicking after selection
						copyPickerFilter: ''
					});
					this.announceToScreenReader(`Found ${candidates.length} features. Select which to add.`);
				}
			} else if (candidates.length === 1) {
				// SINGLE MODE: copy and paste directly
				this.selectCopyCandidate(candidates[0]);
			} else {
				// SINGLE MODE: Multiple features - show picker
				this.setState({
					copyFeatureCandidates: candidates,
					showCopyPicker: true,
					copyModeActive: false,
					copyPickerFilter: ''
				});
				view.container.style.cursor = 'default';
				this.announceToScreenReader(`Found ${candidates.length} features. Select one to copy.`);
			}
		} catch (error) {
			console.error('Error copying feature:', error);
			this.deactivateCopyMode();
		}
	};

	/**
	 * Select a feature from the copy picker and immediately paste it into drawings
	 */
	private selectCopyCandidate = async (candidate: { graphic: any; layerTitle: string; geometryType: string }) => {
		// If in multi-select mode, add to selection instead of pasting
		if (this.state.copySelectionMode === 'multiple') {
			this.setState({
				showCopyPicker: false,
				copyFeatureCandidates: [],
				copyPickerFilter: ''
				// Keep copyModeActive true to continue selecting
			});
			this.addToMultiCopySelection(candidate);
			return;
		}

		const { graphic, layerTitle, geometryType } = candidate;
		const view = this.state.currentJimuMapView?.view;

		// Close the picker immediately
		this.setState({
			copyModeActive: false,
			showCopyPicker: false,
			copyFeatureCandidates: [],
			copyPickerFilter: '',
			copiedFeature: null,
			selectedCopyLayerId: null,
			copySelectionMode: null,
			multiCopySelectedFeatures: []
		});

		if (view) {
			view.container.style.cursor = 'default';
		}

		// Immediately paste the selected feature into drawings
		try {
			if (!this.drawLayer) {
				this.showCopyPasteToast('Drawing layer not available.', 'error');
				return;
			}

			const symbol = this.getSymbolForGeometryType(geometryType, (graphic.symbol as any)?.clone?.() || null);
			const toolName = this.getToolNameForGeometryType(geometryType);

			// Find next available number for this tool type
			const regex = new RegExp(`^${toolName}\\s+(\\d+)$`, "i");
			const nums = this.drawLayer.graphics.toArray()
				.filter(item =>
					item.attributes &&
					typeof item.attributes.name === "string" &&
					item.attributes.name.toLowerCase().startsWith(toolName.toLowerCase()) &&
					!item.attributes.isBuffer &&
					!item.attributes.isMeasurementLabel
				)
				.map(item => {
					const match = item.attributes.name.match(regex);
					return match ? parseInt(match[1], 10) : null;
				})
				.filter(num => num !== null);
			const idx = (nums.length ? Math.max(...nums) : 0) + 1;

			const newGraphic = new Graphic({
				geometry: graphic.geometry.clone(),
				symbol: symbol as any,
				attributes: {
					uniqueId: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					isDrawing: true,
					hideFromList: false,
					drawMode: toolName,
					createdDate: Date.now(),
					name: `${toolName} ${idx}`,
					copiedFrom: graphic.attributes?.OBJECTID || graphic.attributes?.uniqueId || 'external'
				}
			});

			this.drawLayer.add(newGraphic);

			// Update drawing map
			if (this._drawingMap && newGraphic.attributes?.uniqueId) {
				const mainDrawings = this.drawLayer.graphics.toArray().filter(g =>
					!g.attributes?.isBuffer &&
					!g.attributes?.isMeasurementLabel &&
					g.attributes?.isDrawing === true &&
					g.attributes?.hideFromList !== true
				);
				this._drawingMap.set(newGraphic.attributes.uniqueId, Math.max(0, mainDrawings.indexOf(newGraphic)));
			}

			// Save to storage
			this.handleDrawingsUpdate(this.drawLayer.graphics.toArray());

			// Remove any highlight
			this.removeCopyHighlight();

			this.setState({
				drawGLLengthcheck: this.drawLayer.graphics.length > 0
			});

			const displayName = this.getDisplayNameForGeometryType(geometryType);
			this.showCopyPasteToast(`Copied ${displayName} from "${layerTitle}" to drawings`, 'success');
			this.announceToScreenReader(`Copied ${displayName} from ${layerTitle} and added to drawings as ${newGraphic.attributes.name}.`);

			// Select the new graphic
			setTimeout(() => {
				try {
					if (this.sketchViewModel) {
						this.sketchViewModel.update([newGraphic]);
					}
				} catch (e) {
					console.warn('Could not auto-select pasted graphic:', e);
				}
			}, 100);

		} catch (error) {
			console.error('Error copying feature to drawings:', error);
			this.showCopyPasteToast('Error copying feature. Please try again.', 'error');
			this.announceToScreenReader('Error copying feature. Please try again.');
		}
	};

	/**
	 * Show a temporary toast notification for copy/paste actions
	 */
	private showCopyPasteToast = (message: string, type: 'success' | 'error' | 'info') => {
		// Clear any existing toast timer
		if (this._toastTimer) {
			clearTimeout(this._toastTimer);
		}

		this.setState({ copyPasteToast: { message, type } });

		this._toastTimer = setTimeout(() => {
			this.setState({ copyPasteToast: null });
			this._toastTimer = null;
		}, 4000);
	};

	/**
	 * Show highlight on copied feature geometry
	 */
	private showCopyHighlight = (geometry: any) => {
		// Remove any existing highlight first
		this.removeCopyHighlight();

		const view = this.state.currentJimuMapView?.view;
		if (!view || !geometry) return;

		// Standard Esri highlight color: cyan [0, 255, 255]
		const highlightColor = [0, 255, 255];
		let symbol: any;

		switch (geometry.type) {
			case 'point':
			case 'multipoint':
				symbol = {
					type: 'simple-marker',
					color: [...highlightColor, 0.4],
					size: 16,
					outline: {
						color: highlightColor,
						width: 3
					}
				};
				break;
			case 'polyline':
				symbol = {
					type: 'simple-line',
					color: highlightColor,
					width: 4,
					style: 'solid'
				};
				break;
			case 'polygon':
			case 'extent':
			default:
				symbol = {
					type: 'simple-fill',
					color: [...highlightColor, 0.25],
					outline: {
						color: highlightColor,
						width: 3
					}
				};
				break;
		}

		this._copyHighlightGraphic = new Graphic({
			geometry: geometry,
			symbol: symbol,
			attributes: {
				isCopyHighlight: true
			}
		});

		view.graphics.add(this._copyHighlightGraphic);
	};

	/**
	 * Remove the copy highlight from the map
	 */
	private removeCopyHighlight = () => {
		if (this._copyHighlightGraphic) {
			const view = this.state.currentJimuMapView?.view;
			if (view) {
				view.graphics.remove(this._copyHighlightGraphic);
			}
			this._copyHighlightGraphic = null;
		}
	};

	/**
	 * Cancel the copy picker
	 */
	private cancelCopyPicker = () => {
		this.removeCopyHighlight();

		// If in multi-select mode, return to clicking mode instead of fully canceling
		if (this.state.copySelectionMode === 'multiple') {
			this.setState({
				showCopyPicker: false,
				copyFeatureCandidates: [],
				copyPickerFilter: '',
				copyModeActive: true // Keep copy mode active for further clicks
			});
			this.showCopyPasteToast(`${this.state.multiCopySelectedFeatures.length} selected. Click more features or press Done.`, 'info');
			return;
		}

		this.setState({
			showCopyPicker: false,
			copyFeatureCandidates: [],
			copyModeActive: false,
			copyPickerFilter: '',
			showCopyLayerDropdown: false,
			selectedCopyLayerId: null,
			copySelectionMode: null,
			multiCopySelectedFeatures: []
		});

		const view = this.state.currentJimuMapView?.view;
		if (view) {
			view.container.style.cursor = 'default';
		}

		this.announceToScreenReader('Copy cancelled.');
	};

	// ============================================================================
	// MULTI-COPY SELECTION METHODS
	// ============================================================================

	/**
	 * Add a feature to the multi-copy selection with a persistent highlight
	 */
	private addToMultiCopySelection = (candidate: { graphic: any; layerTitle: string; geometryType: string }) => {
		// Check for duplicate (same geometry at same location)
		const isDuplicate = this.state.multiCopySelectedFeatures.some(existing => {
			const existingOid = existing.graphic.attributes?.OBJECTID || existing.graphic.attributes?.FID;
			const candidateOid = candidate.graphic.attributes?.OBJECTID || candidate.graphic.attributes?.FID;
			if (existingOid != null && candidateOid != null && existingOid === candidateOid &&
				existing.layerTitle === candidate.layerTitle) {
				return true;
			}
			return false;
		});

		if (isDuplicate) {
			this.showCopyPasteToast('Feature already selected.', 'info');
			return;
		}

		// Add highlight for this feature
		this.addMultiCopyHighlight(candidate.graphic.geometry);

		const updated = [...this.state.multiCopySelectedFeatures, candidate];
		this.setState({ multiCopySelectedFeatures: updated });

		this.showCopyPasteToast(`${updated.length} feature${updated.length > 1 ? 's' : ''} selected. Click more or press Done.`, 'info');
		this.announceToScreenReader(`Feature added. ${updated.length} total selected.`);
	};

	/**
	 * Remove a feature from the multi-copy selection by index
	 */
	private removeFromMultiCopySelection = (index: number) => {
		const updated = [...this.state.multiCopySelectedFeatures];
		updated.splice(index, 1);

		// Rebuild highlights from scratch
		this.removeMultiCopyHighlights();
		updated.forEach(f => this.addMultiCopyHighlight(f.graphic.geometry));

		this.setState({ multiCopySelectedFeatures: updated });
		this.showCopyPasteToast(`${updated.length} feature${updated.length !== 1 ? 's' : ''} selected.`, 'info');
	};

	/**
	 * Confirm multi-copy: paste all selected features into drawings
	 */
	private confirmMultiCopy = async () => {
		const features = this.state.multiCopySelectedFeatures;
		if (features.length === 0) {
			this.showCopyPasteToast('No features selected.', 'info');
			return;
		}

		// Deactivate copy mode and clear highlights
		this.removeMultiCopyHighlights();
		this.removeCopyHighlight();
		this.cleanupSpatialSelectSketch();

		this.setState({
			copyModeActive: false,
			copySelectionMode: null,
			multiCopySelectedFeatures: [],
			selectedCopyLayerId: null,
			showCopyPicker: false,
			showCopyModePrompt: false,
			multiCopySpatialTool: null
		});

		const view = this.state.currentJimuMapView?.view;
		if (view) {
			view.container.style.cursor = 'default';
		}

		if (!this.drawLayer) {
			this.showCopyPasteToast('Drawing layer not available.', 'error');
			return;
		}

		let successCount = 0;

		for (const candidate of features) {
			try {
				const { graphic, layerTitle, geometryType } = candidate;
				const symbol = this.getSymbolForGeometryType(geometryType, (graphic.symbol as any)?.clone?.() || null);
				const toolName = this.getToolNameForGeometryType(geometryType);

				// Find next available number for this tool type
				const regex = new RegExp(`^${toolName}\\s+(\\d+)$`, "i");
				const nums = this.drawLayer.graphics.toArray()
					.filter(item =>
						item.attributes &&
						typeof item.attributes.name === "string" &&
						item.attributes.name.toLowerCase().startsWith(toolName.toLowerCase()) &&
						!item.attributes.isBuffer &&
						!item.attributes.isMeasurementLabel
					)
					.map(item => {
						const match = item.attributes.name.match(regex);
						return match ? parseInt(match[1], 10) : null;
					})
					.filter(num => num !== null);
				const idx = (nums.length ? Math.max(...nums) : 0) + 1;

				const newGraphic = new Graphic({
					geometry: graphic.geometry.clone(),
					symbol: symbol as any,
					attributes: {
						uniqueId: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
						isDrawing: true,
						hideFromList: false,
						drawMode: toolName,
						createdDate: Date.now(),
						name: `${toolName} ${idx}`,
						copiedFrom: graphic.attributes?.OBJECTID || graphic.attributes?.uniqueId || 'external'
					}
				});

				this.drawLayer.add(newGraphic);

				// Update drawing map
				if (this._drawingMap && newGraphic.attributes?.uniqueId) {
					const mainDrawings = this.drawLayer.graphics.toArray().filter(g =>
						!g.attributes?.isBuffer &&
						!g.attributes?.isMeasurementLabel &&
						g.attributes?.isDrawing === true &&
						g.attributes?.hideFromList !== true
					);
					this._drawingMap.set(newGraphic.attributes.uniqueId, Math.max(0, mainDrawings.indexOf(newGraphic)));
				}

				successCount++;
			} catch (err) {
				console.warn('Error copying feature in multi-copy:', err);
			}
		}

		// Save all at once
		this.handleDrawingsUpdate(this.drawLayer.graphics.toArray());

		this.setState({
			drawGLLengthcheck: this.drawLayer.graphics.length > 0
		});

		this.showCopyPasteToast(`Copied ${successCount} feature${successCount !== 1 ? 's' : ''} to drawings`, 'success');
		this.announceToScreenReader(`Copied ${successCount} features to drawings.`);
	};

	/**
	 * Confirm multi-copy with MERGE: combine all selected features into a single drawing
	 */
	private confirmMultiCopyMerged = async () => {
		const features = this.state.multiCopySelectedFeatures;

		if (features.length < 2) {
			this.showCopyPasteToast('Select at least 2 features to merge.', 'info');
			return;
		}

		// Classify geometry types
		const geomCategories = new Map<string, typeof features>();
		for (const f of features) {
			let cat = f.geometryType === 'extent' ? 'polygon' : f.geometryType;
			if (!cat && f.graphic.geometry) cat = f.graphic.geometry.type === 'extent' ? 'polygon' : f.graphic.geometry.type;
			if (!cat) continue;
			if (!geomCategories.has(cat)) geomCategories.set(cat, []);
			geomCategories.get(cat)!.push(f);
		}

		if (geomCategories.size === 0) {
			this.showCopyPasteToast('Selected features have no geometry to merge.', 'error');
			return;
		}

		if (geomCategories.size > 1) {
			const types = Array.from(geomCategories.keys()).join(', ');
			this.showCopyPasteToast(`Cannot merge mixed types (${types}). Select same geometry type.`, 'error');
			return;
		}

		// Deactivate copy mode and clear highlights
		this.removeMultiCopyHighlights();
		this.removeCopyHighlight();
		this.cleanupSpatialSelectSketch();

		this.setState({
			copyModeActive: false,
			copySelectionMode: null,
			multiCopySelectedFeatures: [],
			selectedCopyLayerId: null,
			showCopyPicker: false,
			showCopyModePrompt: false,
			multiCopySpatialTool: null
		});

		const view = this.state.currentJimuMapView?.view;
		if (view) {
			view.container.style.cursor = 'default';
		}

		if (!this.drawLayer) {
			this.showCopyPasteToast('Drawing layer not available.', 'error');
			return;
		}

		try {
			const geomType = features[0].geometryType === 'extent' ? 'polygon' : (features[0].geometryType || (features[0].graphic.geometry?.type === 'extent' ? 'polygon' : features[0].graphic.geometry?.type));
			const geometries = features.map(f => f.graphic.geometry).filter(Boolean);
			let mergedGeometry: any | null = null;

			if (geomType === 'polygon') {
				const polygons = geometries.map(g => {
					if (g.type === 'extent') return PolygonCompat.fromExtent(g as any);
					return g as any;
				});
				// True polygon union (geometryEngine.union → falls back to ring-concat if unavailable)
				mergedGeometry = unionPolygonsRobust(polygons);
			} else if (geomType === 'polyline') {
				const allPaths: number[][][] = [];
				for (const g of geometries) {
					const pl = g as any;
					if (pl.paths) {
						for (const path of pl.paths) allPaths.push(path);
					}
				}
				mergedGeometry = new Polyline({
					paths: allPaths,
					spatialReference: geometries[0].spatialReference
				});
			} else if (geomType === 'point' || geomType === 'multipoint') {
				const allPoints: number[][] = [];
				for (const g of geometries) {
					if (g.type === 'point') {
						const pt = g as any;
						allPoints.push([pt.x, pt.y]);
					} else if (g.type === 'multipoint') {
						const mp = g as any;
						if (mp.points) {
							for (const p of mp.points) allPoints.push(p);
						}
					}
				}
				mergedGeometry = new Multipoint({
					points: allPoints,
					spatialReference: geometries[0].spatialReference
				});
			}

			if (!mergedGeometry) {
				this.showCopyPasteToast('Could not merge geometries.', 'error');
				return;
			}

			// Use first feature's symbol
			const firstSymbol = (features[0].graphic.symbol as any)?.clone?.() || null;
			const symbol = this.getSymbolForGeometryType(geomType, firstSymbol);
			const toolName = this.getToolNameForGeometryType(geomType);

			// Find next available number
			const regex = new RegExp(`^${toolName}\\s+(\\d+)$`, "i");
			const nums = this.drawLayer.graphics.toArray()
				.filter(item =>
					item.attributes &&
					typeof item.attributes.name === "string" &&
					item.attributes.name.toLowerCase().startsWith(toolName.toLowerCase()) &&
					!item.attributes.isBuffer &&
					!item.attributes.isMeasurementLabel
				)
				.map(item => {
					const match = item.attributes.name.match(regex);
					return match ? parseInt(match[1], 10) : null;
				})
				.filter(num => num !== null);
			const idx = (nums.length ? Math.max(...nums) : 0) + 1;

			// Build name from source layer titles
			const layerNames = [...new Set(features.map(f => f.layerTitle))];
			const mergedName = layerNames.length === 1
				? `Merged ${toolName} ${idx} (${layerNames[0]})`
				: `Merged ${toolName} ${idx}`;

			const newGraphic = new Graphic({
				geometry: mergedGeometry,
				symbol: symbol as any,
				attributes: {
					uniqueId: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					isDrawing: true,
					hideFromList: false,
					drawMode: toolName,
					createdDate: Date.now(),
					name: mergedName,
					mergedFrom: features.map(f =>
						f.graphic.attributes?.OBJECTID || f.graphic.attributes?.uniqueId || 'external'
					)
				}
			});

			this.drawLayer.add(newGraphic);

			if (this._drawingMap && newGraphic.attributes?.uniqueId) {
				const mainDrawings = this.drawLayer.graphics.toArray().filter(g =>
					!g.attributes?.isBuffer &&
					!g.attributes?.isMeasurementLabel &&
					g.attributes?.isDrawing === true &&
					g.attributes?.hideFromList !== true
				);
				this._drawingMap.set(newGraphic.attributes.uniqueId, Math.max(0, mainDrawings.indexOf(newGraphic)));
			}

			this.handleDrawingsUpdate(this.drawLayer.graphics.toArray());

			this.setState({ drawGLLengthcheck: this.drawLayer.graphics.length > 0 });

			const displayName = this.getDisplayNameForGeometryType(geomType);
			this.showCopyPasteToast(
				`Merged ${features.length} ${displayName}${features.length !== 1 ? 's' : ''} into one drawing`,
				'success'
			);
			this.announceToScreenReader(`Merged ${features.length} features into ${mergedName}.`);

			// Select the new graphic
			setTimeout(() => {
				try {
					if (this.sketchViewModel) {
						this.sketchViewModel.update([newGraphic]);
					}
				} catch { /* no-op */ }
			}, 100);

		} catch (error) {
			console.error('Error merging features:', error);
			this.showCopyPasteToast('Error merging features. Please try again.', 'error');
		}
	};

	// ============================================================================
	// MAILING LABELS INTEGRATION
	// ============================================================================

	/**
	 * Send drawing geometry to the Mailing Labels widget via a custom DOM event.
	 * 
	 * Priority order:
	 *   1. If a drawing is actively selected (SketchVM, index, or multi-select) → send that
	 *   2. If nothing selected but drawings exist → combine ALL drawings into one envelope
	 *   3. If no drawings at all → show info message
	 */
	private getMainDrawings = (): any[] => {
		if (!this.drawLayer) return [];
		const isMainDrawing = (g: any) =>
			!g.attributes?.isPreviewBuffer &&
			!g.attributes?.isBuffer &&
			!g.attributes?.isBufferDrawing &&
			!g.attributes?.isMeasurementLabel &&
			!g.attributes?.hideFromList;
		const drawGraphics = this.drawLayer.graphics.toArray().filter(isMainDrawing);
		const identifyGraphics = this.identifyResultsLayer
			? this.identifyResultsLayer.graphics.toArray().filter(isMainDrawing)
			: [];
		return [...drawGraphics, ...identifyGraphics];
	};

	/**
	 * Resolve the best geometry for a drawing when sending to Mailing Labels.
	 * If the drawing has an attached buffer in the draw layer, use the buffer geometry
	 * (larger area = more parcels). Otherwise use the drawing's own geometry.
	 */
	private resolveGeometryForMailingLabels = (graphic: any): any | null => {
		if (!graphic?.geometry) return null;

		const uniqueId = graphic.attributes?.uniqueId;
		if (!uniqueId || !this.drawLayer) {
			return graphic.geometry;
		}

		// Method 1: Check expando property (set by MyDrawingsPanel in-memory)
		if (graphic.bufferGraphic?.geometry) {
			return graphic.bufferGraphic.geometry;
		}

		// Method 2: Search the draw layer for a buffer graphic linked to this parent
		const allGraphics = this.drawLayer.graphics.toArray();

		// Log all buffer-type graphics for debugging
		const bufferGraphics = allGraphics.filter(g =>
			g.attributes?.isBuffer ||
			(g as any).isBufferDrawing ||
			g.attributes?.uniqueId?.startsWith('buffer_')
		);

		const bufferGraphic = bufferGraphics.find(g =>
			(g.attributes?.parentId === uniqueId ||
				g.attributes?.sourceGraphicId === uniqueId ||
				(g as any).sourceGraphicId === uniqueId) &&
			g.geometry
		);

		if (bufferGraphic?.geometry) {
			return bufferGraphic.geometry;
		}

		// Method 3: Check bufferSettings on attributes (persisted drawings)
		if (graphic.attributes?.bufferSettings?.enabled || graphic.bufferSettings?.enabled) {
		}

		return graphic.geometry;
	};

	/** Check if a graphic has an active buffer (for button text/tooltip) */
	private hasActiveBuffer = (graphic: any): boolean => {
		if (!graphic?.attributes?.uniqueId || !this.drawLayer) return false;

		// Expando check
		if (graphic.bufferGraphic?.geometry) return true;

		// Layer lookup
		const uniqueId = graphic.attributes.uniqueId;
		return this.drawLayer.graphics.toArray().some(g =>
			(g.attributes?.isBuffer ||
				(g as any).isBufferDrawing ||
				g.attributes?.uniqueId?.startsWith('buffer_')) &&
			(g.attributes?.parentId === uniqueId ||
				g.attributes?.sourceGraphicId === uniqueId ||
				(g as any).sourceGraphicId === uniqueId) &&
			g.geometry
		);
	};

	/** Returns dynamic button label based on current selection state */
	private getMailingLabelsButtonText = (): string => {
		const mainDrawings = this.getMainDrawings();
		if (mainDrawings.length === 0) return 'Mailing Labels';

		// Check if something is specifically selected
		const sketchGraphic = this.sketchViewModel?.updateGraphics?.getItemAt(0);
		if (sketchGraphic?.geometry) {
			return this.hasActiveBuffer(sketchGraphic) ? 'Send Buffer → Labels' : 'Send Selected → Labels';
		}
		if (this.state.selectedGraphicIndex != null && mainDrawings[this.state.selectedGraphicIndex]) {
			const g = mainDrawings[this.state.selectedGraphicIndex];
			return this.hasActiveBuffer(g) ? 'Send Buffer → Labels' : 'Send Selected → Labels';
		}
		if (this.state.selectedGraphics?.size > 0) {
			return `Send ${this.state.selectedGraphics.size} Selected → Labels`;
		}

		// Nothing selected — will send all
		if (mainDrawings.length === 1) {
			return this.hasActiveBuffer(mainDrawings[0]) ? 'Send Buffer → Labels' : 'Send Drawing → Labels';
		}
		return `Send All (${mainDrawings.length}) → Labels`;
	};

	/** Returns tooltip explaining what the button will do */
	private getMailingLabelsButtonTooltip = (): string => {
		const mainDrawings = this.getMainDrawings();
		if (mainDrawings.length === 0) return 'Draw a shape first, then send to Mailing Labels';

		const bufferNote = ' (buffer area will be used for wider parcel selection)';

		const sketchGraphic = this.sketchViewModel?.updateGraphics?.getItemAt(0);
		if (sketchGraphic?.geometry) {
			return 'Send the selected drawing to Mailing Labels' + (this.hasActiveBuffer(sketchGraphic) ? bufferNote : '');
		}
		if (this.state.selectedGraphicIndex != null && mainDrawings[this.state.selectedGraphicIndex]) {
			const g = mainDrawings[this.state.selectedGraphicIndex];
			return `Send "${g.attributes?.name || 'selected drawing'}" to Mailing Labels` + (this.hasActiveBuffer(g) ? bufferNote : '');
		}
		if (this.state.selectedGraphics?.size > 0) {
			return `Send ${this.state.selectedGraphics.size} selected drawings to Mailing Labels`;
		}
		if (mainDrawings.length === 1) {
			return `Send "${mainDrawings[0].attributes?.name || 'drawing'}" to Mailing Labels` + (this.hasActiveBuffer(mainDrawings[0]) ? bufferNote : '');
		}
		return `Send all ${mainDrawings.length} drawings combined to Mailing Labels for parcel selection`;
	};

	private sendToMailingLabels = async () => {
		const mainDrawings = this.getMainDrawings();


		if (mainDrawings.length === 0) {
			this.showCopyPasteToast('No drawings to send. Draw a shape on the map first.', 'info');
			return;
		}

		let geometry: any | null = null;
		let label = '';

		// --- 1. Check SketchViewModel for an actively edited graphic ---
		const sketchGraphic = this.sketchViewModel?.updateGraphics?.getItemAt(0);
		if (sketchGraphic?.geometry) {
			geometry = this.resolveGeometryForMailingLabels(sketchGraphic);
			const usingBuffer = this.hasActiveBuffer(sketchGraphic);
			label = (sketchGraphic.attributes?.name || 'selected drawing') + (usingBuffer ? ' (buffer)' : '');
		}

		// --- 2. Check single selected index (My Drawings list click) ---
		if (!geometry && this.state.selectedGraphicIndex != null) {
			const g = mainDrawings[this.state.selectedGraphicIndex];
			if (g?.geometry) {
				geometry = this.resolveGeometryForMailingLabels(g);
				const usingBuffer = this.hasActiveBuffer(g);
				label = (g.attributes?.name || `Drawing ${this.state.selectedGraphicIndex + 1}`) + (usingBuffer ? ' (buffer)' : '');
			}
		}

		// --- 3. Check multi-select set ---
		if (!geometry && this.state.selectedGraphics?.size > 0) {
			const selected: any[] = [];
			this.state.selectedGraphics.forEach(idx => {
				const g = mainDrawings[idx];
				const resolved = g ? this.resolveGeometryForMailingLabels(g) : null;
				if (resolved) selected.push(resolved);
			});
			if (selected.length === 1) {
				geometry = selected[0];
				label = '1 selected drawing';
			} else if (selected.length > 1) {
				geometry = await this.combineGeometries(selected);
				label = `${selected.length} selected drawings`;
			}
		}

		// --- 4. Nothing selected → combine ALL drawings ---
		if (!geometry) {
			const allGeoms = mainDrawings
				.map(g => this.resolveGeometryForMailingLabels(g))
				.filter(Boolean) as any[];
			if (allGeoms.length === 1) {
				geometry = allGeoms[0];
				label = mainDrawings[0].attributes?.name || 'drawing';
			} else {
				geometry = await this.combineGeometries(allGeoms);
				label = `all ${allGeoms.length} drawings`;
			}
		}

		if (!geometry) {
			this.showCopyPasteToast('Could not build geometry from drawings.', 'error');
			return;
		}


		// Open the Mailing Labels widget if it's in a controller/sidebar
		const targetWidgetId = this.props.config.mailingLabelsWidgetId;
		if (targetWidgetId) {
			try {
				// Step 1: Close any currently open widgets in the controller
				try {
					const state = getAppStore().getState();
					const runtimeInfo = state?.widgetsRuntimeInfo;
					if (runtimeInfo) {
						const ri = typeof runtimeInfo.asMutable === 'function'
							? runtimeInfo.asMutable({ deep: true })
							: runtimeInfo;
						const openIds = Object.keys(ri).filter(id => {
							const info = ri[id];
							return (info as any)?.state === 'OPENED' || (info as any)?.isOpened;
						});
						if (openIds.length > 0) {
							getAppStore().dispatch(appActions.closeWidgets(openIds));
						}
					}
				} catch { /* silent — proceed with open */ }

				// Also explicitly close the target to reset its panel state
				getAppStore().dispatch((appActions as any).closeWidget(targetWidgetId));

				// Step 2: Open the target widget after a brief delay
				setTimeout(() => {
					getAppStore().dispatch(appActions.openWidgets([targetWidgetId]));

					// Step 3: Send geometry with staggered retries to catch mount timing
					const sendGeometry = (delay: number) => {
						setTimeout(() => {
							try {
								if ((window as any).__pendingMailingLabelsGeometry) {
									window.dispatchEvent(new CustomEvent('drawWidget:mailingLabels', {
										detail: { geometry: (window as any).__pendingMailingLabelsGeometry }
									}));
								}
							} catch { /* silent */ }
						}, delay);
					};

					sendGeometry(200);
					sendGeometry(800);
					sendGeometry(1500);
				}, 100);
			} catch (err) {
				console.warn('[Draw Widget] Could not open Mailing Labels widget:', err);
			}
		}

		// Store geometry globally so the mailing labels widget can pick it up
		// even if it hasn't mounted its event listener yet
		(window as any).__pendingMailingLabelsGeometry = geometry;

		// Also dispatch immediately (works if mailing labels is already open/mounted)
		window.dispatchEvent(new CustomEvent('drawWidget:mailingLabels', {
			detail: { geometry }
		}));

		this.showCopyPasteToast(`Sent ${label} to Mailing Labels`, 'success');
		this.announceToScreenReader(`Drawing geometry sent to Mailing Labels widget.`);
	};

	// ============================================================================
	// Identify By Query Integration
	// ============================================================================

	/** Returns dynamic button label for Identify By Query based on current selection state */
	private getIdentifyButtonText = (): string => {
		const mainDrawings = this.getMainDrawings();
		if (mainDrawings.length === 0) return 'Identify By Query';

		// Check if something is specifically selected
		const sketchGraphic = this.sketchViewModel?.updateGraphics?.getItemAt(0);
		if (sketchGraphic?.geometry) {
			return this.hasActiveBuffer(sketchGraphic) ? 'Send Buffer → Identify' : 'Send Selected → Identify';
		}
		if (this.state.selectedGraphicIndex != null && mainDrawings[this.state.selectedGraphicIndex]) {
			const g = mainDrawings[this.state.selectedGraphicIndex];
			return this.hasActiveBuffer(g) ? 'Send Buffer → Identify' : 'Send Selected → Identify';
		}
		if (this.state.selectedGraphics?.size > 0) {
			return `Send ${this.state.selectedGraphics.size} Selected → Identify`;
		}

		// Nothing selected → send all drawings
		return mainDrawings.length === 1 ? 'Send Drawing → Identify' : `Send All (${mainDrawings.length}) → Identify`;
	};

	/** Returns tooltip explaining what the Identify button will do */
	private getIdentifyButtonTooltip = (): string => {
		const mainDrawings = this.getMainDrawings();
		if (mainDrawings.length === 0) return 'Draw a shape first, then send to Identify By Query';

		const bufferNote = ' (buffer area will be used for feature identification)';

		const sketchGraphic = this.sketchViewModel?.updateGraphics?.getItemAt(0);
		if (sketchGraphic?.geometry) {
			return 'Send the selected drawing to Identify By Query' + (this.hasActiveBuffer(sketchGraphic) ? bufferNote : '');
		}
		if (this.state.selectedGraphicIndex != null && mainDrawings[this.state.selectedGraphicIndex]) {
			const g = mainDrawings[this.state.selectedGraphicIndex];
			return `Send "${g.attributes?.name || 'selected drawing'}" to Identify By Query` + (this.hasActiveBuffer(g) ? bufferNote : '');
		}
		if (this.state.selectedGraphics?.size > 0) {
			return `Send ${this.state.selectedGraphics.size} selected drawings to Identify By Query`;
		}
		if (mainDrawings.length === 1) {
			return `Send "${mainDrawings[0].attributes?.name || 'drawing'}" to Identify By Query` + (this.hasActiveBuffer(mainDrawings[0]) ? bufferNote : '');
		}
		return `Send all ${mainDrawings.length} drawings combined to Identify By Query for feature identification`;
	};

	private sendToIdentifyByQuery = async () => {
		const mainDrawings = this.getMainDrawings();

		if (mainDrawings.length === 0) {
			this.showCopyPasteToast('No drawings to send. Draw a shape on the map first.', 'info');
			return;
		}

		const rawGeometries: any[] = [];
		let label = '';
		const resolveGeom = (g: any): any | null => this.resolveGeometryForMailingLabels(g);

		// --- 1. Check SketchViewModel for an actively edited graphic ---
		const sketchGraphic = this.sketchViewModel?.updateGraphics?.getItemAt(0);
		if (sketchGraphic?.geometry) {
			const geom = resolveGeom(sketchGraphic);
			if (geom) rawGeometries.push(geom);
			label = sketchGraphic.attributes?.name || 'selected drawing';
		}

		// --- 2. Check single selected index (My Drawings list click) ---
		if (!rawGeometries.length && this.state.selectedGraphicIndex != null) {
			const g = mainDrawings[this.state.selectedGraphicIndex];
			if (g?.geometry && !g.attributes?.fromIdentifyWidget) {
				const geom = resolveGeom(g);
				if (geom) rawGeometries.push(geom);
				label = g.attributes?.name || `Drawing ${this.state.selectedGraphicIndex + 1}`;
			}
		}

		// --- 3. Check multi-select set ---
		if (!rawGeometries.length && this.state.selectedGraphics?.size > 0) {
			this.state.selectedGraphics.forEach(idx => {
				const g = mainDrawings[idx];
				const gm_ms = resolveGeom(g); if (g?.geometry && gm_ms) rawGeometries.push(gm_ms);
			});
			label = `${rawGeometries.length} selected drawing${rawGeometries.length !== 1 ? 's' : ''}`;
		}

		// --- 4. Nothing selected → all drawings (excluding Identify-received) ---
		if (!rawGeometries.length) {
			mainDrawings.forEach(g => {
				if (!g.attributes?.fromIdentifyWidget) {
					const gm = resolveGeom(g);
					if (g?.geometry && gm) rawGeometries.push(gm);
				}
			});
			label = rawGeometries.length === 1
				? (mainDrawings[0].attributes?.name || 'drawing')
				: `all ${rawGeometries.length} drawings`;
		}

		if (!rawGeometries.length) {
			this.showCopyPasteToast('Could not build geometry from drawings.', 'error');
			return;
		}
		MutableStoreManager.getInstance().updateStateValue(
			this.props.config.identifyWidgetId,
			'selectedGeometries',
			rawGeometries
		);
	}

	// ============================================================================
	// Identify By Query Integration - Receive "Copy To Draw"
	// ============================================================================

	/**
	 * Set up event listener for receiving geometry from Identify By Query widget
	 * when user clicks "Copy To Draw" button
	 */
	private setupIdentifyListener = () => {
		// Remove existing listener if any
		if (this.identifyListenerCleanup) {
			this.identifyListenerCleanup();
		}

		const handleIdentifyGeometry = (event: CustomEvent) => {
			try {
				const graphicData = event.detail;
				if (!graphicData || !graphicData.geometry) {
					console.warn('[Draw] Invalid geometry received from Identify widget');
					return;
				}

				// Clear the pending flag
				(window as any).__pendingDrawGeometry = null;

				// Import required modules. Note: esri/geometry/support/jsonUtils and
				// esri/symbols/support/jsonUtils export `fromJSON` as a NAMED export,
				// not a default. The previous code destructured `{ default: jsonUtils }`
				// and then called `jsonUtils.fromJSON(...)`, which silently threw because
				// `default` was undefined — the surrounding try/catch swallowed it. This
				// path only worked when the geometry already had a `.type` (so the ternary
				// took the truthy branch and skipped fromJSON); raw JSON would fail.
				import('esri/Graphic').then(({ default: Graphic }) => {
					import('esri/geometry/support/jsonUtils').then((jsonUtils: any) => {
						const geomFromJSON = jsonUtils.fromJSON || jsonUtils.default?.fromJSON;
						// Reconstruct geometry from JSON
						const geometry = graphicData.geometry.type
							? graphicData.geometry
							: (geomFromJSON ? geomFromJSON(graphicData.geometry) : graphicData.geometry);

						// Reconstruct symbol from JSON if provided
						let symbol = null;
						if (graphicData.symbol) {
							try {
								import('esri/symbols/support/jsonUtils').then((symbolJsonUtils: any) => {
									const symFromJSON = symbolJsonUtils.fromJSON || symbolJsonUtils.default?.fromJSON;
									symbol = symFromJSON ? symFromJSON(graphicData.symbol) : null;
									// Use default symbol if no symbol provided
									if (!symbol) {
										symbol = this.getDefaultSymbol(geometry.type);
									}
									// Create the graphic
									const newGraphic = new Graphic({
										geometry: geometry,
										symbol: symbol,
										attributes: {
											uniqueId: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
											name: graphicData.attributes?.name || 'From Identify',
											copiedFrom: graphicData.attributes?.copiedFrom || 'Identify',
											sourceLayer: graphicData.attributes?.sourceLayer,
											createdDate: Date.now(),
											isDrawing: true,
											hideFromList: false,
											drawMode: geometry.type,
											fromIdentifyWidget: true
										}
									});

									// Add to drawings layer
									if (this.drawLayer) {
										this.drawLayer.add(newGraphic);

										// Save to storage. Previously this called
										// this.saveDrawingsToStorage() which doesn't
										// exist — silently skipped saving every Identify
										// copy. Dispatch the documented event instead,
										// which handleSaveEvent listens for and routes
										// to saveDrawingsToLocalStorage.
										try {
											window.dispatchEvent(new CustomEvent('saveDrawingsToStorage'));
										} catch (e) {
											console.warn('[Draw] Could not dispatch save event:', e);
										}

										// The panel listens to the draw layer's graphics
										// collection directly, so adding the new graphic
										// above already triggers its re-render. A previous
										// setState({ drawingsUpdated: Date.now() }) here
										// was dead code — `drawingsUpdated` isn't in
										// States so TypeScript dropped it.

										// Show success toast
										this.showCopyPasteToast(
											`Added "${graphicData.attributes?.name || 'feature'}" from Identify`,
											'success'
										);

										this.announceToScreenReader(`Feature geometry added to My Drawings from Identify widget.`);
									}

								}).catch(() => {
									// Symbol reconstruction failed, will use default
								});
							} catch (e) {
								// Fallback to default symbol
							}
						}
					}).catch(error => {
						console.error('[Draw] Error loading geometry utils:', error);
						this.showCopyPasteToast('Failed to process geometry from Identify', 'error');
					});
				}).catch(error => {
					console.error('[Draw] Error loading Graphic module:', error);
					this.showCopyPasteToast('Failed to add geometry from Identify', 'error');
				});
			} catch (error) {
				console.error('[Draw] Error processing geometry from Identify:', error);
				this.showCopyPasteToast('Failed to add geometry from Identify', 'error');
			}
		};

		// Add event listener
		window.addEventListener('identifyWidget:copyToDraw', handleIdentifyGeometry as EventListener);

		// Check for pending geometry on mount (timing issues)
		setTimeout(() => {
			const pending = (window as any).__pendingDrawGeometry;
			if (pending) {
				window.dispatchEvent(new CustomEvent('identifyWidget:copyToDraw', {
					detail: pending
				}));
			}
		}, 200);

		// Store cleanup function
		this.identifyListenerCleanup = () => {
			window.removeEventListener('identifyWidget:copyToDraw', handleIdentifyGeometry as EventListener);
		};
	};

	/**
	 * Get default symbol based on geometry type
	 */
	private getDefaultSymbol(geometryType: string): any {
		// Return appropriate default symbol based on geometry type
		switch (geometryType) {
			case 'point':
			case 'multipoint':
				return {
					type: 'simple-marker',
					color: [0, 112, 255, 0.5],
					size: 10,
					outline: { color: [0, 112, 255], width: 2 }
				};
			case 'polyline':
				return {
					type: 'simple-line',
					color: [0, 112, 255],
					width: 3
				};
			case 'polygon':
			case 'extent':
				return {
					type: 'simple-fill',
					color: [0, 112, 255, 0.25],
					outline: { color: [0, 112, 255], width: 3 }
				};
			default:
				return {
					type: 'simple-marker',
					color: [0, 112, 255, 0.5],
					size: 10
				};
		}
	}

	/**
	 * Build a single query geometry from an array of raw drawing geometries,
	 * matching the processing IdentifyByQuery performs in buildQueryGeometryFromGeometries:
	 *   - Points   → circle (radius = extent.width * 0.005)
	 *   - Polylines → buffered 1 SR-unit into a polygon
	 *   - Polygons  → used as-is
	 *   - All results → unioned into one polygon
	 */
	/**
	 * Combine multiple geometries into a single geometry for mailing labels.
	 * Unions same-type polygons, or creates a bounding polygon from mixed types.
	 */
	private combineGeometries = async (geometries: any[]): Promise<any | null> => {
		if (geometries.length === 0) return null;
		if (geometries.length === 1) return geometries[0];

		try {
			// Check if all are polygon-like
			const allPolygons = geometries.every(g => g.type === 'polygon' || g.type === 'extent');
			if (allPolygons) {
				const polys = geometries.map(g =>
					g.type === 'extent' ? PolygonCompat.fromExtent(g as any) : g
				);
				// True polygon union (geometryEngine.union → falls back to ring-concat if unavailable)
				return unionPolygonsRobust(polys);
			}

			// All polylines → combine all paths into one polyline
			const allPolylines = geometries.every(g => g.type === 'polyline');
			if (allPolylines) {
				const allPaths: number[][][] = [];
				for (const g of geometries) {
					if ((g as any).paths) for (const path of (g as any).paths) allPaths.push(path);
				}
				return { type: 'polyline', paths: allPaths, spatialReference: geometries[0].spatialReference };
			}

			// Mixed types → combined extent as polygon
			let combinedExtent: any | null = null;
			for (const g of geometries) {
				const ext = g.extent;
				if (ext) {
					combinedExtent = combinedExtent ? combinedExtent.union(ext) : ext.clone();
				}
			}
			return combinedExtent ? PolygonCompat.fromExtent(combinedExtent) : null;
		} catch (err) {
			console.warn('Error combining geometries for mailing labels:', err);
			// Last resort: use first geometry
			return geometries[0];
		}
	};

	/**
	 * Cancel multi-copy mode
	 */
	private cancelMultiCopy = () => {
		this.removeMultiCopyHighlights();
		this.removeCopyHighlight();
		this.cleanupSpatialSelectSketch();

		this.setState({
			copyModeActive: false,
			copySelectionMode: null,
			multiCopySelectedFeatures: [],
			selectedCopyLayerId: null,
			showCopyPicker: false,
			showCopyModePrompt: false,
			copyFeatureCandidates: [],
			copyPickerFilter: '',
			multiCopySpatialTool: null
		});

		const view = this.state.currentJimuMapView?.view;
		if (view) {
			view.container.style.cursor = 'default';
		}

		this.showCopyPasteToast('Multi-select copy cancelled.', 'info');
		this.announceToScreenReader('Multi-select copy cancelled.');
	};

	/**
	 * Add a persistent highlight for a selected multi-copy feature (green)
	 */
	private addMultiCopyHighlight = (geometry: any) => {
		const view = this.state.currentJimuMapView?.view;
		if (!view || !geometry) return;

		const highlightColor = [0, 200, 83]; // Green for "selected"
		let symbol: any;

		switch (geometry.type) {
			case 'point':
			case 'multipoint':
				symbol = {
					type: 'simple-marker',
					color: [...highlightColor, 0.4],
					size: 16,
					outline: { color: highlightColor, width: 3 }
				};
				break;
			case 'polyline':
				symbol = {
					type: 'simple-line',
					color: highlightColor,
					width: 4,
					style: 'solid'
				};
				break;
			default:
				symbol = {
					type: 'simple-fill',
					color: [...highlightColor, 0.25],
					outline: { color: highlightColor, width: 3 }
				};
				break;
		}

		const highlightGraphic = new Graphic({
			geometry: geometry,
			symbol: symbol,
			attributes: { isMultiCopyHighlight: true }
		});

		view.graphics.add(highlightGraphic);
		this._multiCopyHighlightGraphics.push(highlightGraphic);
	};

	/**
	 * Remove all multi-copy highlight graphics from the map
	 */
	private removeMultiCopyHighlights = () => {
		const view = this.state.currentJimuMapView?.view;
		if (view && this._multiCopyHighlightGraphics.length > 0) {
			this._multiCopyHighlightGraphics.forEach(g => {
				try { view.graphics.remove(g); } catch { /* no-op */ }
			});
		}
		this._multiCopyHighlightGraphics = [];
	};

	// ============================================================================
	// SPATIAL SELECTION (Rectangle / Polygon) for multi-copy
	// ============================================================================

	/**
	 * Start drawing a selection rectangle or polygon for spatial feature selection
	 */
	private startSpatialSelection = (tool: 'rectangle' | 'polygon') => {
		const view = this.state.currentJimuMapView?.view;
		if (!view) return;

		// Cancel main SketchVM drawing if active
		try { this.sketchViewModel?.cancel(); } catch { /* no-op */ }

		// Clean up any previous spatial sketch
		this.cleanupSpatialSelectSketch();

		// Create a temporary graphics layer for the selection shape
		if (!this._spatialSelectLayer) {
			this._spatialSelectLayer = new GraphicsLayer({ id: '_spatialSelect', listMode: 'hide' as any });
			view.map.add(this._spatialSelectLayer);
		}

		// Create a temporary SketchViewModel
		this._spatialSelectSketchVM = new SketchViewModel({
			view: view,
			useLegacyCreateTools: true, // selection geometry only: keep the classic single-tool create, no curve segment toolbar
			layer: this._spatialSelectLayer,
			defaultUpdateOptions: { enableRotation: false, enableScaling: false },
			polygonSymbol: new SimpleFillSymbol({
				color: [0, 120, 215, 0.1],
				outline: new SimpleLineSymbol({ color: [0, 120, 215, 0.8], width: 2, style: 'dash' })
			})
		});

		this.setState({ multiCopySpatialTool: tool });
		view.container.style.cursor = 'crosshair';

		this.showCopyPasteToast(
			tool === 'rectangle' ? 'Draw a rectangle to select features' : 'Draw a polygon to select features',
			'info'
		);

		// Listen for completion
		this._spatialSelectSketchVM.on('create', async (event) => {
			if (event.state === 'complete' && event.graphic?.geometry) {
				const selectionGeometry = event.graphic.geometry;
				await this.handleSpatialSelectionComplete(selectionGeometry);
			} else if (event.state === 'cancel') {
				this.cleanupSpatialSelectSketch();
				this.setState({ multiCopySpatialTool: null });
				view.container.style.cursor = 'copy';
			}
		});

		// Start drawing
		this._spatialSelectSketchVM.create(tool === 'rectangle' ? 'rectangle' : 'polygon');
	};

	/**
	 * Process spatial selection: query layers for features within the drawn geometry
	 */
	private handleSpatialSelectionComplete = async (selectionGeometry: any) => {
		const view = this.state.currentJimuMapView?.view;
		if (!view) return;

		// Clean up the selection shape
		this.cleanupSpatialSelectSketch();
		this.setState({ multiCopySpatialTool: null });
		view.container.style.cursor = 'copy';

		this.showCopyPasteToast('Querying features in selection area...', 'info');

		const { selectedCopyLayerId, copyableLayers } = this.state;
		const candidates: Array<{ graphic: any; layerTitle: string; geometryType: string }> = [];

		// Helper to check visibility
		const isLayerVisible = (layer: any): boolean => {
			if (!layer || !layer.visible) return false;
			let parent = (layer as any).parent;
			while (parent) {
				if (parent.visible === false) return false;
				parent = parent.parent;
			}
			return true;
		};

		try {
			if (selectedCopyLayerId) {
				// Query only the locked layer
				const selectedLayer = copyableLayers.find(l => l.id === selectedCopyLayerId);
				if (selectedLayer?.layerRef) {
					const results = await this.querySingleLayerWithGeometry(selectedLayer, selectionGeometry);
					candidates.push(...results);
				}
			} else {
				// Query all visible layers
				const allLayers = view.map.allLayers.toArray();

				// Feature layers
				const featureLayers = allLayers.filter(l =>
					(l.type === 'feature' || l.type === 'geojson' || l.type === 'csv') &&
					isLayerVisible(l) && l.id !== 'DrawGL'
				);
				for (const layer of featureLayers) {
					try {
						const query = (layer as any).createQuery();
						query.geometry = selectionGeometry;
						query.spatialRelationship = 'intersects';
						query.returnGeometry = true;
						query.outFields = ['*'];
						const result = await (layer as any).queryFeatures(query);
						if (result?.features?.length > 0) {
							for (const feature of result.features) {
								if (feature.geometry) {
									const geomType = feature.geometry.type === 'extent' ? 'rectangle' : feature.geometry.type;
									candidates.push({
										graphic: feature,
										layerTitle: (layer as any).title || 'Layer',
										geometryType: geomType
									});
								}
							}
						}
					} catch { /* query failed for this layer */ }
				}

				// Map image sublayers
				const mapImageLayers = allLayers.filter(l => l.type === 'map-image' && isLayerVisible(l));
				for (const mil of mapImageLayers) {
					const sublayers = (mil as any).sublayers?.toArray() || [];
					for (const sublayer of sublayers) {
						if (!sublayer.visible || !(sublayer as any).createQuery) continue;
						try {
							const query = (sublayer as any).createQuery();
							query.geometry = selectionGeometry;
							query.spatialRelationship = 'intersects';
							query.returnGeometry = true;
							query.outFields = ['*'];
							const result = await (sublayer as any).queryFeatures(query);
							if (result?.features?.length > 0) {
								for (const feature of result.features) {
									if (feature.geometry) {
										const geomType = feature.geometry.type === 'extent' ? 'rectangle' : feature.geometry.type;
										candidates.push({
											graphic: feature,
											layerTitle: sublayer.title || 'Sublayer',
											geometryType: geomType
										});
									}
								}
							}
						} catch { /* sublayer query failed */ }
					}
				}
			}

			// Add all found features to multi-copy selection (skip duplicates)
			let addedCount = 0;
			const existingOids = new Set<string>();
			this.state.multiCopySelectedFeatures.forEach(f => {
				const oid = f.graphic.attributes?.OBJECTID || f.graphic.attributes?.FID;
				const key = `${f.layerTitle}:${oid}`;
				if (oid != null) existingOids.add(key);
			});

			const newFeatures = candidates.filter(c => {
				const oid = c.graphic.attributes?.OBJECTID || c.graphic.attributes?.FID;
				const key = `${c.layerTitle}:${oid}`;
				if (oid != null && existingOids.has(key)) return false;
				existingOids.add(key);
				return true;
			});

			if (newFeatures.length > 0) {
				// Add highlights for all new features
				newFeatures.forEach(f => this.addMultiCopyHighlight(f.graphic.geometry));

				const updated = [...this.state.multiCopySelectedFeatures, ...newFeatures];
				this.setState({ multiCopySelectedFeatures: updated });
				addedCount = newFeatures.length;
			}

			if (addedCount > 0) {
				const total = this.state.multiCopySelectedFeatures.length + addedCount;
				this.showCopyPasteToast(`Added ${addedCount} feature${addedCount !== 1 ? 's' : ''}. ${total} total selected.`, 'success');
				this.announceToScreenReader(`Added ${addedCount} features by spatial selection. ${total} total.`);
			} else {
				this.showCopyPasteToast('No new features found in selection area.', 'info');
			}

		} catch (err) {
			console.error('Error in spatial selection:', err);
			this.showCopyPasteToast('Error querying features in selection area.', 'error');
		}
	};

	/**
	 * Query a single layer (from copyableLayers) with the given geometry
	 */
	private querySingleLayerWithGeometry = async (
		layerInfo: States['copyableLayers'][0],
		geometry: any
	): Promise<Array<{ graphic: any; layerTitle: string; geometryType: string }>> => {
		const results: Array<{ graphic: any; layerTitle: string; geometryType: string }> = [];
		const { layerRef, title, type } = layerInfo;
		if (!layerRef) return results;

		try {
			let queryable: any = null;
			if (type === 'feature' || type === 'geojson' || type === 'csv') {
				queryable = layerRef;
			} else if (type === 'map-image-sublayer') {
				queryable = layerRef;
			}

			if (queryable && typeof queryable.createQuery === 'function') {
				const query = queryable.createQuery();
				query.geometry = geometry;
				query.spatialRelationship = 'intersects';
				query.returnGeometry = true;
				query.outFields = ['*'];
				const result = await queryable.queryFeatures(query);
				if (result?.features?.length > 0) {
					for (const feature of result.features) {
						if (feature.geometry) {
							const geomType = feature.geometry.type === 'extent' ? 'rectangle' : feature.geometry.type;
							results.push({ graphic: feature, layerTitle: title, geometryType: geomType });
						}
					}
				}
			}
		} catch (e) {
			console.warn(`Spatial query failed for layer "${title}":`, e);
		}
		return results;
	};

	/**
	 * Clean up the temporary spatial selection SketchViewModel and graphics layer
	 */
	private cleanupSpatialSelectSketch = () => {
		if (this._spatialSelectSketchVM) {
			try { this._spatialSelectSketchVM.cancel(); } catch { /* no-op */ }
			try { this._spatialSelectSketchVM.destroy(); } catch { /* no-op */ }
			this._spatialSelectSketchVM = null;
		}
		if (this._spatialSelectLayer) {
			this._spatialSelectLayer.removeAll();
			const view = this.state.currentJimuMapView?.view;
			if (view?.map) {
				try { view.map.remove(this._spatialSelectLayer); } catch { /* no-op */ }
			}
			this._spatialSelectLayer = null;
		}
	};

	/**
	 * Get all copyable layers from the map, preserving the TOC display order (top-to-bottom).
	 *
	 * view.map.layers is ordered bottom-to-top (index 0 = bottom of draw stack), and
	 * MapImageLayer.sublayers is similarly ordered bottom-to-top. The TOC/Layer List
	 * widget reverses both to show the topmost-drawing layer first. We mirror that here
	 * by iterating both collections in reverse.
	 */
	private getCopyableLayers = (): States['copyableLayers'] => {
		const view = this.state.currentJimuMapView?.view;
		if (!view?.map) return [];

		const layers: States['copyableLayers'] = [];

		// Helper to check if a layer (and all parent groups) are visible
		const isLayerVisible = (layer: any): boolean => {
			if (!layer || !layer.visible) return false;
			let parent = (layer as any).parent;
			while (parent) {
				if (parent.visible === false) return false;
				parent = parent.parent;
			}
			return true;
		};

		/**
		 * Recursively process a single layer and push copyable entries.
		 */
		const processLayer = (layer: any): void => {
			if (!isLayerVisible(layer)) return;

			if (layer.type === 'group') {
				// Group layer — recurse into children in TOC order (reverse)
				const groupLayer = layer as any;
				const children = groupLayer.layers?.toArray() || [];
				for (let i = children.length - 1; i >= 0; i--) {
					processLayer(children[i]);
				}
			} else if (layer.type === 'map-image') {
				// Map image layer — expand sublayers in TOC order (reverse)
				const mapImageLayer = layer as any;
				const parentTitle = mapImageLayer.title || 'Map Service';

				const collectSublayers = (sublayers: any | null, fallbackTitle: string): void => {
					if (!sublayers) return;
					const arr = sublayers.toArray ? sublayers.toArray() : [];
					// Reverse to match TOC top-to-bottom order
					for (let i = arr.length - 1; i >= 0; i--) {
						const sublayer = arr[i];
						if (!sublayer.visible) continue;
						if (sublayer.sublayers && sublayer.sublayers.length > 0) {
							// Group sublayer — recurse (also reversed)
							collectSublayers(sublayer.sublayers, sublayer.title || fallbackTitle);
						} else {
							if (typeof (sublayer as any).createQuery === 'function') {
								layers.push({
									id: `${mapImageLayer.id}-${sublayer.id}`,
									title: sublayer.title || 'Sublayer',
									type: 'map-image-sublayer',
									layerRef: sublayer as any,
									parentTitle
								});
							}
						}
					}
				};
				collectSublayers(mapImageLayer.sublayers, parentTitle);
			} else if (layer.type === 'feature') {
				layers.push({
					id: layer.id,
					title: layer.title || 'Feature Layer',
					type: 'feature',
					layerRef: layer
				});
			} else if (layer.type === 'geojson') {
				layers.push({
					id: layer.id,
					title: (layer as any).title || 'GeoJSON Layer',
					type: 'geojson',
					layerRef: layer
				});
			} else if (layer.type === 'csv') {
				layers.push({
					id: layer.id,
					title: (layer as any).title || 'CSV Layer',
					type: 'csv',
					layerRef: layer
				});
			} else if (layer.type === 'graphics' && layer.id !== 'DrawGL') {
				const gl = layer as any;
				if (gl.graphics && gl.graphics.length > 0) {
					layers.push({
						id: layer.id,
						title: layer.title || 'Graphics Layer',
						type: 'graphics',
						layerRef: layer
					});
				}
			}
		};

		// view.map.layers is bottom-to-top; iterate in reverse for TOC order
		const topLevelLayers = view.map.layers.toArray();
		for (let i = topLevelLayers.length - 1; i >= 0; i--) {
			processLayer(topLevelLayers[i]);
		}

		return layers;
	};

	/**
	 * Toggle the copy layer dropdown
	 */
	private toggleCopyLayerDropdown = () => {
		if (this.state.showCopyLayerDropdown) {
			// Close dropdown
			this.setState({
				showCopyLayerDropdown: false,
				copyableLayers: []
			});
		} else {
			// Open dropdown - refresh the list of copyable layers
			const layers = this.getCopyableLayers();
			this.setState({
				showCopyLayerDropdown: true,
				copyableLayers: layers,
				copyModeActive: false,
				selectedCopyLayerId: null
			});
		}
	};

	/**
	 * Select a layer to copy from and activate copy mode
	 */
	private selectCopySourceLayer = (layerId: string) => {
		// Cancel any active drawing operation
		this.setDrawToolBtnState('');
		try { this.sketchViewModel?.cancel(); } catch { /* no-op */ }

		// Remove any existing highlight from previous copy
		this.removeCopyHighlight();
		this.removeMultiCopyHighlights();

		// Store the selected layer and show the mode prompt
		this.setState({
			showCopyLayerDropdown: false,
			selectedCopyLayerId: layerId,
			showCopyModePrompt: true,
			copyModePromptContext: 'layer-first',
			copiedFeature: null
		});
	};

	/**
	 * Enter copy mode after mode selection for layer-first flow
	 */
	private enterCopyModeForLayer = (selectionMode: 'single' | 'multiple') => {
		const selectedLayer = this.state.copyableLayers.find(l => l.id === this.state.selectedCopyLayerId);
		const layerTitle = selectedLayer?.title || 'selected layer';

		this.setState({
			showCopyModePrompt: false,
			copyModePromptContext: null,
			copyModeActive: true,
			copySelectionMode: selectionMode,
			multiCopySelectedFeatures: []
		});

		// Show visual feedback that copy mode is active
		const view = this.state.currentJimuMapView?.view;
		if (view) {
			view.container.style.cursor = 'copy';
		}

		if (selectionMode === 'multiple') {
			this.showCopyPasteToast(`Click features from "${layerTitle}" to select. Click Done when finished.`, 'info');
			this.announceToScreenReader(`Multi-select copy mode active for ${layerTitle}. Click features to select, then click Done.`);
		} else {
			this.showCopyPasteToast(`Click a feature from "${layerTitle}" to copy`, 'info');
			this.announceToScreenReader(`Copy mode active. Click a feature from ${layerTitle} to copy it to your drawings.`);
		}
	};

	/**
	 * Pastes the copied feature into the drawings layer (internal fallback)
	 */
	private pasteFeature = async () => {
		const { copiedFeature } = this.state;
		if (!copiedFeature || !this.drawLayer) {
			this.showCopyPasteToast('No feature to paste. Use Copy button first.', 'info');
			this.announceToScreenReader('No feature to paste. Use Copy button first to copy a feature from the map.');
			return;
		}

		try {
			// Create appropriate symbol based on geometry type
			const symbol = this.getSymbolForGeometryType(copiedFeature.geometryType, copiedFeature.symbol);

			// Determine the tool name based on geometry type
			const toolName = this.getToolNameForGeometryType(copiedFeature.geometryType);

			// Find next available number for this tool type
			const regex = new RegExp(`^${toolName}\\s+(\\d+)$`, "i");
			const nums = this.drawLayer.graphics.toArray()
				.filter(item =>
					item.attributes &&
					typeof item.attributes.name === "string" &&
					item.attributes.name.toLowerCase().startsWith(toolName.toLowerCase()) &&
					!item.attributes.isBuffer &&
					!item.attributes.isMeasurementLabel
				)
				.map(item => {
					const match = item.attributes.name.match(regex);
					return match ? parseInt(match[1], 10) : null;
				})
				.filter(num => num !== null);
			const idx = (nums.length ? Math.max(...nums) : 0) + 1;

			// Create the new graphic
			const newGraphic = new Graphic({
				geometry: copiedFeature.geometry.clone(),
				symbol: symbol as any,
				attributes: {
					uniqueId: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					isDrawing: true,
					hideFromList: false,
					drawMode: toolName,
					createdDate: Date.now(),
					name: `${toolName} ${idx}`,
					copiedFrom: copiedFeature.attributes?.OBJECTID || copiedFeature.attributes?.uniqueId || 'external'
				}
			});

			// Add to draw layer
			this.drawLayer.add(newGraphic);

			// Update drawing map
			if (this._drawingMap && newGraphic.attributes?.uniqueId) {
				const mainDrawings = this.drawLayer.graphics.toArray().filter(g =>
					!g.attributes?.isBuffer &&
					!g.attributes?.isMeasurementLabel &&
					g.attributes?.isDrawing === true &&
					g.attributes?.hideFromList !== true
				);
				this._drawingMap.set(newGraphic.attributes.uniqueId, Math.max(0, mainDrawings.indexOf(newGraphic)));
			}

			// Save to storage
			this.handleDrawingsUpdate(this.drawLayer.graphics.toArray());

			// Remove the highlight graphic
			this.removeCopyHighlight();

			// Update UI state - clear copied feature
			this.setState({
				drawGLLengthcheck: this.drawLayer.graphics.length > 0,
				copiedFeature: null
			});

			// Show toast and announce
			const displayName = this.getDisplayNameForGeometryType(copiedFeature.geometryType);
			this.showCopyPasteToast(`Copied ${displayName} from "${copiedFeature.layerTitle}" to drawings`, 'success');
			this.announceToScreenReader(`Pasted ${displayName} as ${newGraphic.attributes.name}. Feature added to drawings.`);

			// Select the new graphic
			setTimeout(() => {
				try {
					if (this.sketchViewModel) {
						this.sketchViewModel.update([newGraphic]);
					}
				} catch (e) {
					console.warn('Could not auto-select pasted graphic:', e);
				}
			}, 100);

		} catch (error) {
			console.error('Error pasting feature:', error);
			this.showCopyPasteToast('Error pasting feature. Please try again.', 'error');
			this.announceToScreenReader('Error pasting feature. Please try again.');
		}
	};

	/**
	 * Gets appropriate symbol for geometry type
	 */
	private getSymbolForGeometryType = (geometryType: string, originalSymbol?: any): any => {
		// If we have current drawing symbols set, use those
		if (this.state.currentSymbol) {
			const currentType = this.state.currentSymbolType;

			// Match symbol type to geometry type
			if (geometryType === 'point' && currentType === JimuSymbolType.Point) {
				return this.state.currentSymbol;
			}
			if ((geometryType === 'polyline' || geometryType === 'freepolyline') && currentType === JimuSymbolType.Polyline) {
				return this.state.currentSymbol;
			}
			if ((geometryType === 'polygon' || geometryType === 'extent' || geometryType === 'rectangle' || geometryType === 'circle') && currentType === JimuSymbolType.Polygon) {
				return this.state.currentSymbol;
			}
		}

		// If original symbol exists and is appropriate, use it
		if (originalSymbol) {
			return originalSymbol;
		}

		// Create default symbol based on geometry type
		switch (geometryType) {
			case 'point':
			case 'multipoint':
				return new SimpleMarkerSymbol({
					color: [0, 120, 215, 0.8],
					size: 12,
					outline: {
						color: [255, 255, 255],
						width: 2
					}
				});
			case 'polyline':
			case 'freepolyline':
				return new SimpleLineSymbol({
					color: [0, 120, 215, 1],
					width: 3,
					style: 'solid'
				});
			case 'polygon':
			case 'extent':
			case 'rectangle':
			case 'circle':
			case 'freepolygon':
			default:
				return new SimpleFillSymbol({
					color: [0, 120, 215, 0.3],
					outline: {
						color: [0, 120, 215, 1],
						width: 2
					}
				});
		}
	};

	/**
	 * Maps geometry type to tool name for naming convention
	 */
	private getToolNameForGeometryType = (geometryType: string): string => {
		switch (geometryType) {
			case 'point':
			case 'multipoint':
				return 'point';
			case 'polyline':
				return 'polyline';
			case 'polygon':
				return 'polygon';
			case 'extent':
			case 'rectangle':
				return 'extent';
			case 'circle':
				return 'circle';
			default:
				return 'polygon';
		}
	};

	/**
	 * Gets display-friendly name for geometry type
	 */
	private getDisplayNameForGeometryType = (geometryType: string): string => {
		switch (geometryType) {
			case 'extent':
				return 'rectangle';
			case 'multipoint':
				return 'multipoint';
			default:
				return geometryType;
		}
	};

	/**
	 * Announces message to screen readers using live region
	 */
	private announceToScreenReader = (message: string) => {
		// Create or reuse live region
		let liveRegion = document.getElementById('draw-widget-live-region');
		if (!liveRegion) {
			liveRegion = document.createElement('div');
			liveRegion.id = 'draw-widget-live-region';
			liveRegion.setAttribute('role', 'status');
			liveRegion.setAttribute('aria-live', 'polite');
			liveRegion.setAttribute('aria-atomic', 'true');
			liveRegion.className = 'sr-only';
			liveRegion.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
			document.body.appendChild(liveRegion);
		}
		// Clear and set message to trigger announcement
		liveRegion.textContent = '';
		setTimeout(() => {
			liveRegion.textContent = message;
		}, 100);
	};

	// Private reference for copy mode click handler
	private _copyModeClickHandler: any | null = null;

	componentDidUpdate(prevProps: Readonly<AllWidgetProps<IMConfig>>, prevState: Readonly<States>) {
		if (this.state.currentJimuMapView) {
			const widgetState: WidgetState = this.props.state;
			const view = this.state.currentJimuMapView.view;

			if (widgetState === WidgetState.Closed && this.sketchViewModel) {
				// Properly cancel any active operations
				this.sketchViewModel.cancel();
				this.sketchViewModel.updateOnGraphicClick = false;

				// Clear any active drawing states to prevent interference with map interactions
				this.setDrawToolBtnState(null);

				// Restore original popup state
				if (view) {
					// Only restore if we have the original value
					if (this.originalPopupEnabled !== null) {
						view.popupEnabled = this.originalPopupEnabled;
						//console.log('Restored popup state to:', this.originalPopupEnabled);
					}

					if (view.popup && "autoCloseEnabled" in view.popup) {
						view.popup.autoCloseEnabled = true;
					}

					// Restore highlight appearance
					view.highlightOptions = {
						color: [0, 255, 255, 1],
						fillOpacity: 0.0,
						haloOpacity: 0.8
					};

					// Restore layer-level highlight styling
					view.map.layers.forEach(layer => {
						view.whenLayerView(layer).then((layerView: any) => {
							if (layer.type === "feature") {
								const featureLayerView = layerView as any;
								if ("highlightOptions" in featureLayerView) {
									featureLayerView.highlightOptions = {
										color: [0, 255, 255, 1],
										fillOpacity: 0.0,
										haloOpacity: 0.8
									};
								}
							}
						});
					});

					// Clear widget graphics but preserve draw layer
					const allGraphics = view.graphics.toArray();
					const graphicsToRemove = allGraphics.filter(graphic =>
						graphic.layer !== this.drawLayer
					);
					view.graphics.removeMany(graphicsToRemove);
				}

				if (this.props.config.turnOffOnClose) {
					this.setDrawToolBtnState(null);
				}
			} else if (widgetState === WidgetState.Opened && this.sketchViewModel) {
				this.sketchViewModel.updateOnGraphicClick = true;

				// Disable interactions when widget opens
				if (view) {
					// Store original state only if not already stored
					if (this.originalPopupEnabled === null) {
						this.originalPopupEnabled = view.popupEnabled;
						//console.log('Stored original popup state:', this.originalPopupEnabled);
					}

					// Disable popups and interactions
					view.popupEnabled = false;
					if (view.popup && "autoCloseEnabled" in view.popup) {
						view.popup.autoCloseEnabled = false;
					}
					view.popup.visible = false;

					// Make highlights invisible
					view.highlightOptions = {
						color: [0, 0, 0, 0],
						fillOpacity: 0,
						haloOpacity: 0
					};
				}
			}

			// Backup check for widgets without state management (used outside widget controller)
			if (view && this.originalPopupEnabled !== null) {
				// Check if widget state is undefined/null (not managed by controller)
				const isWidgetControlled = widgetState !== undefined && widgetState !== null;

				if (!isWidgetControlled) {
					// For uncontrolled widgets, restore popups when not in drawing mode
					const isDrawingActive = this.state.pointBtnActive || this.state.lineBtnActive ||
						this.state.flineBtnActive || this.state.rectBtnActive ||
						this.state.polygonBtnActive || this.state.fpolygonBtnActive ||
						this.state.circleBtnActive || this.state.textBtnActive;

					// Check if drawing state changed from active to inactive
					const wasDrawingActive = prevState.pointBtnActive || prevState.lineBtnActive ||
						prevState.flineBtnActive || prevState.rectBtnActive ||
						prevState.polygonBtnActive || prevState.fpolygonBtnActive ||
						prevState.circleBtnActive || prevState.textBtnActive;

					// Restore popups when exiting drawing mode
					if (wasDrawingActive && !isDrawingActive && !view.popupEnabled && this.originalPopupEnabled) {
						view.popupEnabled = this.originalPopupEnabled;
						//console.log('Restored popup state (uncontrolled widget):', this.originalPopupEnabled);

						if (view.popup && "autoCloseEnabled" in view.popup) {
							view.popup.autoCloseEnabled = true;
						}

						// Restore highlight appearance
						view.highlightOptions = {
							color: [0, 255, 255, 1],
							fillOpacity: 0.0,
							haloOpacity: 0.8
						};
					}
					// Disable popups when entering drawing mode
					else if (!wasDrawingActive && isDrawingActive && view.popupEnabled) {
						view.popupEnabled = false;
						//console.log('Disabled popups (uncontrolled widget, entering drawing mode)');

						if (view.popup && "autoCloseEnabled" in view.popup) {
							view.popup.autoCloseEnabled = false;
						}
						view.popup.visible = false;

						// Make highlights invisible
						view.highlightOptions = {
							color: [0, 0, 0, 0],
							fillOpacity: 0,
							haloOpacity: 0
						};
					}
				}
			}
		}

		// Set titles for color picker inputs
		if (document.getElementsByClassName('fontcolorpicker')[0]) {
			(document.getElementsByClassName('fontcolorpicker')[0] as HTMLElement).title = this.nls('fontColor');
		}
		if (document.getElementsByClassName('fontrotationinput')[0]) {
			(document.getElementsByClassName('fontrotationinput')[0] as HTMLElement).title = this.nls('fontRotation');
		}
		if (document.getElementsByClassName('fontsizeinput')[0]) {
			(document.getElementsByClassName('fontsizeinput')[0] as HTMLElement).title = this.nls('fontSize');
		}
		if (document.getElementsByClassName('fonthalocolorpicker')[0]) {
			(document.getElementsByClassName('fonthalocolorpicker')[0] as HTMLElement).title = this.nls('fontHaloColor');
		}
		if (document.getElementsByClassName('fonthalosizeinput')[0]) {
			(document.getElementsByClassName('fonthalosizeinput')[0] as HTMLElement).title = this.nls('fontHaloSize');
		}

		// Handle Identify By Query integration config changes
		if (prevProps.config?.enableIdentifyIntegration !== this.props.config?.enableIdentifyIntegration) {
			if (this.props.config?.enableIdentifyIntegration) {
				this.setupIdentifyListener();
			} else if (this.identifyListenerCleanup) {
				this.identifyListenerCleanup();
				this.identifyListenerCleanup = null;
			}
		}
	}

	componentWillUnmount() {
		// Clean up measurement update timeouts
		if (this._measurementUpdateTimeout) {
			clearTimeout(this._measurementUpdateTimeout);
			this._measurementUpdateTimeout = null;
		}

		if (this._activeMeasurementUpdateTimeout) {
			clearTimeout(this._activeMeasurementUpdateTimeout);
			this._activeMeasurementUpdateTimeout = null;
		}

		if (this._savePositionTimeout) {
			clearTimeout(this._savePositionTimeout);
			this._savePositionTimeout = null;
		}

		// Clean up position watchers
		if (this._positionWatchers) {
			Object.values(this._positionWatchers).forEach(watcher => {
				if (watcher && typeof watcher.remove === 'function') {
					try {
						watcher.remove();
					} catch (error) {
						console.warn('Error removing position watcher:', error);
					}
				}
			});
			this._positionWatchers = {};
		}

		// Remove save event listener
		window.removeEventListener('saveDrawingsToStorage', this.handleSaveEvent);

		// Remove copy/paste keyboard listener
		document.removeEventListener('keydown', this.handleKeyDown);

		// Clean up Identify By Query integration listener
		if (this.identifyListenerCleanup) {
			this.identifyListenerCleanup();
		}

		// 🔧 MEMORY FIX: Remove all view/SVM/drawLayer handlers attached during
		// activeViewChangeHandler. Without this they survive widget close and
		// accumulate on every reopen.
		this.removeViewHandles();

		// 🔧 MEMORY FIX: Tear down the spatial-select SVM if one is lingering
		this.cleanupSpatialSelectSketch();

		// Remove copy highlight graphic if present
		this.removeCopyHighlight();

		// Clean up toast timer
		if (this._toastTimer) {
			clearTimeout(this._toastTimer);
			this._toastTimer = null;
		}

		// Clean up injected toast styles
		const toastStyles = document.getElementById('draw-widget-toast-styles');
		if (toastStyles) toastStyles.remove();

		// Clean up copy/paste live region
		const liveRegion = document.getElementById('draw-widget-live-region');
		if (liveRegion) {
			liveRegion.remove();
		}

		// Always restore original popup state if we have it stored
		if (this.state?.currentJimuMapView?.view && this.originalPopupEnabled !== null) {
			const view = this.state.currentJimuMapView.view;

			try {
				// Restore popup functionality
				view.popupEnabled = this.originalPopupEnabled;
				//console.log('componentWillUnmount: Restored popup state to:', this.originalPopupEnabled);

				if (view.popup && "autoCloseEnabled" in view.popup) {
					view.popup.autoCloseEnabled = true;
				}

				// Restore highlight options to default
				view.highlightOptions = {
					color: [0, 255, 255, 1],
					fillOpacity: 0.0,
					haloOpacity: 0.8
				};

				// Restore layer-level highlight styling
				view.map.layers.forEach(layer => {
					view.whenLayerView(layer).then((layerView: any) => {
						if (layer.type === "feature") {
							const featureLayerView = layerView as any;
							if ("highlightOptions" in featureLayerView) {
								featureLayerView.highlightOptions = {
									color: [0, 255, 255, 1],
									fillOpacity: 0.0,
									haloOpacity: 0.8
								};
							}
						}
					}).catch(err => {
						console.warn(`Could not restore highlight options for layer ${layer.title}:`, err);
					});
				});

				// Clear any widget graphics but preserve draw layer
				const allGraphics = view.graphics.toArray();
				const graphicsToRemove = allGraphics.filter(graphic =>
					graphic.layer !== this.drawLayer
				);
				if (graphicsToRemove.length > 0) {
					view.graphics.removeMany(graphicsToRemove);
				}

			} catch (error) {
				console.warn('Error restoring view state during unmount:', error);
			}

			// Reset the stored value after restoration
			this.originalPopupEnabled = null;
		}

		// Clean up custom curve tool handles
		this._deactivateCurveTool();
		this._deactivateTriangleTool();
		this._deactivateCirclePreset();

		// Clean up SketchViewModel
		if (this.sketchViewModel) {
			try {
				this.sketchViewModel.cancel();
				this.sketchViewModel.destroy();
			} catch (error) {
				console.warn('Error cleaning up SketchViewModel:', error);
			}
			this.sketchViewModel = null;
		}

		// Clean up draw layer
		if (this.drawLayer) {
			try {
				this.drawLayer.removeAll();
			} catch (error) {
				console.warn('Error clearing draw layer:', error);
			}
			this.drawLayer = null;
		}
	}

	activeViewChangeHandler = (jimuMapView: JimuMapView) => {
		// 🔧 MEMORY FIX: Always remove handles from the previous view before
		// attaching to a new one. This prevents handler accumulation on view
		// switches and on widget reopen (where the underlying view may be the
		// same instance the previous mount attached to).
		this.removeViewHandles();

		// Attach to new map view or clear if null
		if (!jimuMapView) {
			if (this.sketchViewModel) {
				try { this.sketchViewModel.cancel(); this.sketchViewModel.destroy(); } catch (error) {
					console.warn('Error cleaning up SketchViewModel:', error);
				}
				this.sketchViewModel = null;
			}
			this.setState({ currentJimuMapView: null });
			return;
		}

		this.setState({ currentJimuMapView: jimuMapView });

		jimuMapView.whenJimuMapViewLoaded().then(async () => {
			const { map } = jimuMapView.view;
			const view = jimuMapView.view;

			if (!view || view.destroyed) {
				console.warn('View is not valid for SketchViewModel initialization');
				return;
			}

			// 🔧 MEMORY FIX: Defensive re-clear in case anything was attached
			// between the entry guard and the loaded promise resolving.
			this.removeViewHandles();

			// Store original popup state
			this.originalPopupEnabled = view.popupEnabled;
			//console.log('Stored original popup state:', this.originalPopupEnabled);

			// Check if widget is controlled by widget state
			const widgetState: WidgetState = this.props.state;
			const isWidgetControlled = widgetState !== undefined && widgetState !== null;

			// Only disable popups immediately if widget is controlled and opened, or if a drawing tool is active
			const isDrawingActive = this.state.pointBtnActive || this.state.lineBtnActive ||
				this.state.flineBtnActive || this.state.rectBtnActive ||
				this.state.polygonBtnActive || this.state.fpolygonBtnActive ||
				this.state.circleBtnActive || this.state.textBtnActive;

			if ((isWidgetControlled && widgetState === WidgetState.Opened) || isDrawingActive) {
				// Disable popups and interactions
				view.popupEnabled = false;
				if (view.popup && "autoCloseEnabled" in view.popup) view.popup.autoCloseEnabled = false;
				view.popup.visible = false;

				view.highlightOptions = { color: [0, 0, 0, 0], fillOpacity: 0, haloOpacity: 0 };
				//console.log('Disabled popups on widget initialization (controlled widget or drawing active)');
			} else {
				// For uncontrolled widgets with no active drawing tools, leave popups enabled
				//console.log('Leaving popups enabled on widget initialization (uncontrolled widget, no drawing active)');
			}

			// Clear existing highlights/effects
			view.map.layers.forEach(layer => {
				view.whenLayerView(layer).then((layerView: any) => {
					try {
						if (layer.type === "feature") {
							const flv = layerView as any;
							if (typeof flv.highlight === "function") {
								const h = flv.highlight([]); h.remove();
								// Only disable highlight options if widget is controlled or drawing is active
								if ("highlightOptions" in flv && ((isWidgetControlled && widgetState === WidgetState.Opened) || isDrawingActive)) {
									flv.highlightOptions = { color: [0, 0, 0, 0], fillOpacity: 0, haloOpacity: 0 };
								}
								if (flv.hasOwnProperty("_highlightIds")) flv._highlightIds = {};
							}
						}
						if ("featureEffect" in layerView) (layerView as any).featureEffect = null;
						if ("filter" in layerView) (layerView as any).filter = null;
						if (typeof (layerView as any).refresh === "function") (layerView as any).refresh();
					} catch (err) {
						console.warn(`Error clearing highlight for layer ${layer.title}:`, err);
					}
				}).catch(err => console.warn(`Could not get layerView for ${layer.title}:`, err));
			});

			if (this.state.widgetInit) {
				this.creationMode = this.props.config.creationMode || DrawMode.SINGLE;
				const dLayer: GraphicsLayer = map.findLayerById('DrawGL') as GraphicsLayer;
				if (dLayer) {
					this.drawLayer = dLayer;
					if (this.drawLayer.graphics.length > 0) this.setState({ drawGLLengthcheck: true });
				} else {
					map.add(this.drawLayer);
					map.add(this.identifyResultsLayer);
				}
			}

			// 🔧 MEMORY FIX: Track the length watcher so it's removed on view switch
			this._viewHandles.push(
				this.drawLayer.graphics.watch('length', (len) => {
					this.setState({ drawGLLengthcheck: len > 0 });
				})
			);

			// Rebuild SketchViewModel cleanly with enhanced configuration
			if (this.sketchViewModel) {
				try { this.sketchViewModel.cancel(); this.sketchViewModel.destroy(); } catch (error) {
					console.warn('Error cleaning up existing SketchViewModel:', error);
				}
			}

			try {
				this.sketchViewModel = new SketchViewModel({
					view,
					useLegacyCreateTools: false, // JSAPI 5.0 next-gen create: true curve tools via shift-drag-to-curve inside the existing line/polygon tools (no OOTB component)
					updateOnGraphicClick: false, // CRITICAL: prevents SVM from intercepting measurement label clicks
					layer: this.drawLayer,
					defaultUpdateOptions: {
						toggleToolOnClick: true // Allows switching between transform and reshape (vertex editing) modes
					}
				});

				// Extra safeguard: ensure it stays off even if modified elsewhere
				(this.sketchViewModel as any).updateOnGraphicClick = false;

				if (!this.sketchViewModel.view) {
					console.error('SketchViewModel created without valid view');
					return;
				}

				// Wait for SketchViewModel to be fully ready before proceeding
				await new Promise<void>((resolve) => {
					if (this.sketchViewModel.state === "ready") {
						resolve();
					} else {
						const handle = this.sketchViewModel.watch("state", (state) => {
							if (state === "ready") {
								handle.remove();
								resolve();
							}
						});
					}
				});

				// 🔧 MEMORY FIX: Track SVM handlers so they are removed alongside
				// the other view handles. SketchViewModel.destroy() also cleans
				// these up implicitly, but storing the handles makes the lifecycle
				// explicit and survives any path that skips destroy().
				this._viewHandles.push(this.sketchViewModel.on('create', this.svmGraCreate));
				this._viewHandles.push(this.sketchViewModel.on('update', this.svmGraUpdate));

				//console.log('✅ SketchViewModel fully initialized and ready');
			} catch (error) {
				console.error('Error creating SketchViewModel:', error);
				return;
			}

			// --- Helper Functions ----------------------------------------------------------

			// Remove ALL selection overlay graphics and null pointers on base graphics
			const clearAllSelectionOverlaysLocal = () => {
				if (!this.drawLayer) return;
				try {
					this.drawLayer.graphics.toArray().forEach((g: any) => {
						if (g && g._selectionOverlay) {
							try {
								if (g._selectionOverlay.layer === this.drawLayer) {
									this.drawLayer.remove(g._selectionOverlay);
								}
							} catch { }
							g._selectionOverlay = null;
						}
					});
				} catch (e) {
					console.warn('clearAllSelectionOverlaysLocal failed:', e);
				}
			};

			// Enhanced measurement label detection
			const isMeasurementLabelGraphic = (graphic: any): boolean => {
				if (!graphic || !graphic.symbol) return false;

				// Primary identification
				if (graphic.attributes?.isMeasurementLabel === true) return true;
				if (graphic.attributes?.measurementType) return true;
				// FIX #4: Only treat hideFromList as measurement if it also has a parentGraphicId
				if (graphic.attributes?.hideFromList && graphic.attributes?.parentGraphicId && graphic.symbol.type === 'text') return true;
				if (graphic.measureParent) return true;

				// FIX #4: Tightened pattern-based identification for restored labels
				// Require entire text to be measurement-like to avoid false positives on user text
				if (graphic.symbol.type === 'text') {
					const text = (graphic.symbol.text || '').trim();
					// Skip if this looks like user-created text (no parent reference)
					if (graphic.attributes?.drawMode === 'text' && !graphic.attributes?.parentGraphicId) return false;

					const strictPatterns = [
						/^[\d,]+(\.\d+)?\s*(km²|mi²|ac|ha|m²|ft²|yd²|km|mi|NM|m|ft|yd)$/,
						/^(Area:|Perimeter:|Radius:|Total:)\s*[\d,]+(\.\d+)?/m,
						/^(Lat:|Lon:|X:|Y:|WKID:)\s*/m
					];
					return strictPatterns.some(pattern => pattern.test(text));
				}

				return false;
			};

			// --- Event Handlers -----------------------------------------------------------

			// HIGH PRIORITY: immediate-click for measurement label interactions
			// 🔧 MEMORY FIX: Store handle so it can be removed on view switch / unmount
			this._viewHandles.push(view.on("immediate-click", async (event) => {
				try {
					//console.log('🔍 WIDGET: Immediate-click for measurement labels at:', event.x, event.y);

					// Only handle measurement labels in this handler
					if (!this.measureRef?.current?.isEditingMeasurements?.()) {
						return; // Not in measurement editing mode
					}

					// Check if drawing tools are active - if so, skip measurement handling
					const isDrawingActive = this.state.pointBtnActive || this.state.lineBtnActive ||
						this.state.flineBtnActive || this.state.rectBtnActive ||
						this.state.polygonBtnActive || this.state.fpolygonBtnActive ||
						this.state.circleBtnActive || this.state.textBtnActive;

					if (isDrawingActive) {
						//console.log('🎨 Drawing tool active - skipping measurement label handling');
						return;
					}

					// Enhanced hit test specifically for measurement labels
					const hitTestResult = await view.hitTest(event, {
						include: [this.drawLayer]
					});

					// Enhanced measurement label detection
					const measurementLabelHit = hitTestResult.results.find(result => {
						if (!result || !('graphic' in result) || !result.graphic) return false;
						return isMeasurementLabelGraphic(result.graphic);
					}) as any | undefined;

					if (measurementLabelHit) {
						//console.log('🏷️ Measurement label detected via immediate-click');

						// Handle measurement label selection
						this.measureRef.current?.handleMeasurementLabelSelection?.(measurementLabelHit.graphic);
						return; // Don't let this fall through to normal click handler
					}

				} catch (error) {
					console.error('❌ Error in immediate-click measurement handler:', error);
				}
			}));

			// STANDARD: click handler for drawing selection and general interactions
			// 🔧 MEMORY FIX: Store handle for cleanup
			this._viewHandles.push(view.on("click", async (event) => {
				try {
					//console.log('🔍 WIDGET: Standard click detected at:', event.x, event.y);

					// COPY MODE: Handle copy feature from map
					if (this.state.copyModeActive) {
						await this.handleCopyModeClick(event);
						return; // Don't process as normal click
					}

					if (!this.sketchViewModel || !this.sketchViewModel.view) {
						console.warn('SketchViewModel not available for click handling');
						return;
					}

					// Check drawing state first to avoid conflicts
					const isDrawingActive = this.state.pointBtnActive || this.state.lineBtnActive ||
						this.state.flineBtnActive || this.state.rectBtnActive ||
						this.state.polygonBtnActive || this.state.fpolygonBtnActive ||
						this.state.circleBtnActive || this.state.textBtnActive;

					// If drawing is active, skip entirely (let SketchViewModel handle)
					if (isDrawingActive) {
						//console.log('🎨 Drawing tool active - letting SketchViewModel handle click');
						return;
					}

					// If measurement editing is active, clear selection when clicking non-measurement graphics
					if (this.measureRef?.current?.isEditingMeasurements?.()) {
						// Do a quick check to see if we hit a measurement label
						const quickHitTest = await view.hitTest(event, { include: [this.drawLayer] });
						const hitMeasurementLabel = quickHitTest.results.some(result => {
							if (!result || !('graphic' in result)) return false;
							return isMeasurementLabelGraphic(result.graphic);
						});

						if (!hitMeasurementLabel) {
							// Clicked on non-measurement, clear measurement selection
							this.measureRef.current?.cleanupMeasurementLabelSelection?.();
							// Continue with normal selection logic below
						} else {
							// This is a measurement label, but immediate-click should have handled it
							// If it gets here, it means immediate-click didn't catch it, so we can handle it
							const measurementLabelHit = quickHitTest.results.find(result => {
								if (!result || !('graphic' in result)) return false;
								return isMeasurementLabelGraphic(result.graphic);
							}) as any | undefined;

							if (measurementLabelHit) {
								//console.log('🏷️ Measurement label caught by standard click (fallback)');
								this.measureRef.current?.handleMeasurementLabelSelection?.(measurementLabelHit.graphic);
								return;
							}
						}
					}

					//console.log('Performing hit test for drawing graphics');

					// Hit test strictly limited to drawLayer — Draw never reaches outside its own layer
					const hitTestResult = await view.hitTest(event, { include: [this.drawLayer] });


					// Normalize overlay hits to parent graphics
					const results = (hitTestResult.results as any[]) || [];
					const normalizedResults: any[] = [];

					for (const r of results) {
						if (!r || !r.graphic) continue;
						const g = r.graphic as any;

						// Convert overlay hits to parent graphic hits
						if (g.attributes?.isSelectionOverlay && g.attributes?.parentGraphicId) {
							const parentId = g.attributes.parentGraphicId;
							const parent = this.drawLayer?.graphics?.find(
								(pg: any) => (pg as any).attributes?.uniqueId === parentId
							) as any | undefined;
							if (parent) {
								normalizedResults.push({ ...r, graphic: parent } as any);
								continue;
							}
						}
						normalizedResults.push(r as any);
					}

					// Filter out measurement labels, buffers, and other non-selectable graphics
					const selectableGraphicHits = normalizedResults.filter((result: any) => {
						if (!result || !result.graphic || result.graphic.layer !== this.drawLayer) return false;

						const graphic = result.graphic as any;

						// Exclude measurement labels
						if (isMeasurementLabelGraphic(graphic)) return false;

						// Exclude buffers
						if (graphic.attributes?.isPreviewBuffer ||
							graphic.attributes?.isBuffer ||
							graphic.attributes?.isBufferDrawing ||
							graphic.attributes?.uniqueId?.startsWith('buffer_')) return false;

						// Exclude selection overlays
						if (graphic.attributes?.isSelectionOverlay) return false;


						return true;
					});

					// Process selectable graphic hits
					if (selectableGraphicHits.length > 0) {
						const clickedGraphic = selectableGraphicHits[0].graphic as any;
						//console.log('✅ Selecting drawing graphic:', (clickedGraphic as any).attributes?.name);

						// Invalidate any pending overlay schedules from previous selection
						this._selectionEpoch++;

						// Clear previous halos BEFORE selecting the new one
						clearAllSelectionOverlaysLocal();

						// Handle the selection
						const uid = (clickedGraphic as any).attributes?.uniqueId;
						const idx = uid && this._drawingMap?.has(uid) ? this._drawingMap.get(uid) : -1;
						this.handleDrawingSelect(clickedGraphic, idx);

						// Sync list UI if index is known
						if (uid && this._drawingMap?.has(uid)) {
							const index = this._drawingMap.get(uid);
							document.querySelectorAll('.drawing-item').forEach(item => item.classList.remove('selected-drawing'));
							const item = document.getElementById(`drawing-item-${index}`);
							if (item) {
								item.classList.add('selected-drawing');
								item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
							}
							this.setState({ selectedGraphicIndex: index, selectedGraphics: new Set([index]) });
						}
					} else {
						// Click away - clear all selections
						//console.log('🔘 WIDGET: No selectable graphics hit - clearing selections');

						// 🔧 CRITICAL FIX: Save measurement labels BEFORE cancel to prevent them from being removed
						// Only proceed if SketchViewModel actually has something selected
						const currentGraphics = this.sketchViewModel?.updateGraphics?.toArray() || [];

						// Don't run deselect logic if nothing is actually selected
						if (currentGraphics.length === 0) {
							// Nothing selected, just clear UI state
							if (this.state.selectedGraphicIndex !== null) {
								this.setState({ selectedGraphicIndex: null, selectedGraphics: new Set() });
								document.querySelectorAll('.drawing-item').forEach(item => item.classList.remove('selected-drawing'));
							}
						} else {
							// CRITICAL FIX: Check if we're in the middle of a create operation
							// Don't cancel if the graphic was just created (within last 500ms)
							const hasRecentlyCreatedGraphic = currentGraphics.some((g: any) => {
								const createdTime = g.attributes?.createdDate;
								if (createdTime && (Date.now() - createdTime) < 500) {
									//console.log('⏸️ Skipping cancel - graphic was just created');
									return true;
								}
								return false;
							});

							if (hasRecentlyCreatedGraphic) {
								// Don't cancel, just clear UI state
								if (this.state.selectedGraphicIndex !== null) {
									this.setState({ selectedGraphicIndex: null, selectedGraphics: new Set() });
									document.querySelectorAll('.drawing-item').forEach(item => item.classList.remove('selected-drawing'));
								}
								return; // Exit early without calling cancel
							}

							// Something is selected — use shared cancel helper
							// FIX #13: Consolidated measurement label save/cancel/restore
							this.cancelSketchVMWithLabelPreservation(currentGraphics);
						}

						// Invalidate any pending overlay schedules
						this._selectionEpoch++;

						// Clear halos and selection states
						clearAllSelectionOverlaysLocal();

						if (this.state.selectedGraphicIndex !== null) {
							this.setState({ selectedGraphicIndex: null, selectedGraphics: new Set() });
							document.querySelectorAll('.drawing-item').forEach(item => item.classList.remove('selected-drawing'));
						}
					}

				} catch (err) {
					console.error("❌ Hit test error:", err);
				}
			}));

			// DOUBLE-CLICK: Enable vertex editing (reshape mode) on double-click
			// 🔧 MEMORY FIX: Store handle for cleanup
			this._viewHandles.push(view.on("double-click", async (event) => {
				try {
					// Check if drawing tools are active - if so, skip
					const isDrawingActive = this.state.pointBtnActive || this.state.lineBtnActive ||
						this.state.flineBtnActive || this.state.rectBtnActive ||
						this.state.polygonBtnActive || this.state.fpolygonBtnActive ||
						this.state.circleBtnActive || this.state.textBtnActive;

					if (isDrawingActive) {
						return; // Let SketchViewModel handle double-click during drawing
					}

					if (!this.sketchViewModel || !this.sketchViewModel.view) {
						return;
					}

					// Hit test strictly limited to drawLayer
					const hitTestResult = await view.hitTest(event, { include: [this.drawLayer] });


					// Normalize overlay hits to parent graphics
					const results = (hitTestResult.results as any[]) || [];
					const normalizedResults: any[] = [];

					for (const r of results) {
						if (!r || !r.graphic) continue;
						const g = r.graphic as any;

						// Convert overlay hits to parent graphic hits
						if (g.attributes?.isSelectionOverlay && g.attributes?.parentGraphicId) {
							const parentId = g.attributes.parentGraphicId;
							const parent = this.drawLayer?.graphics?.find(
								(pg: any) => (pg as any).attributes?.uniqueId === parentId
							) as any | undefined;
							if (parent) {
								normalizedResults.push({ ...r, graphic: parent } as any);
								continue;
							}
						}
						normalizedResults.push(r as any);
					}

					// Filter out measurement labels, buffers, and other non-selectable graphics
					const selectableGraphicHits = normalizedResults.filter((result: any) => {
						if (!result || !result.graphic || result.graphic.layer !== this.drawLayer) return false;

						const graphic = result.graphic as any;

						// Exclude measurement labels
						if (isMeasurementLabelGraphic(graphic)) return false;

						// Exclude buffers
						if (graphic.attributes?.isPreviewBuffer ||
							graphic.attributes?.isBuffer ||
							graphic.attributes?.isBufferDrawing ||
							graphic.attributes?.uniqueId?.startsWith('buffer_')) return false;

						// Exclude selection overlays
						if (graphic.attributes?.isSelectionOverlay) return false;


						// Exclude point graphics (points only have transform, not reshape)
						if (graphic.geometry?.type === 'point') return false;

						return true;
					});

					// Process double-click for vertex editing
					if (selectableGraphicHits.length > 0) {
						const clickedGraphic = selectableGraphicHits[0].graphic as any;

						// Stop the default map behavior (zoom)
						event.stopPropagation();

						// Cancel any current operation first
						try {
							this.sketchViewModel.cancel();
						} catch (e) {
							// Ignore cancel errors
						}

						// Start update. Curves can't be vertex-reshaped without losing
						// their curvePaths, so use transform (move/rotate/scale) for them
						// instead of exposing vertex handles.
						const isCurveGraphic = !!(clickedGraphic?.geometry && (clickedGraphic.geometry as any).curvePaths);
						if (isCurveGraphic) {
							this.sketchViewModel.update([clickedGraphic], {
								tool: 'transform',
								enableRotation: true,
								enableScaling: true,
								preserveAspectRatio: false,
								toggleToolOnClick: false
							});
							try { this.showCopyPasteToast('Curves can be moved, rotated, or scaled, but not vertex-edited.', 'info'); } catch { }
						} else {
							this.sketchViewModel.update([clickedGraphic], {
								tool: 'reshape',
								enableRotation: true,
								enableScaling: true,
								preserveAspectRatio: false,
								toggleToolOnClick: true
							});
						}

						// Update UI state
						const uid = (clickedGraphic as any).attributes?.uniqueId;
						if (uid && this._drawingMap?.has(uid)) {
							const index = this._drawingMap.get(uid);
							document.querySelectorAll('.drawing-item').forEach(item => item.classList.remove('selected-drawing'));
							const item = document.getElementById(`drawing-item-${index}`);
							if (item) {
								item.classList.add('selected-drawing');
								item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
							}
							this.setState({ selectedGraphicIndex: index, selectedGraphics: new Set([index]) });
						}
					}
				} catch (err) {
					console.error("❌ Double-click hit test error:", err);
				}
			}));

			// Clean up orphaned buffers when graphics are removed
			// 🔧 MEMORY FIX: Store handle for cleanup
			this._viewHandles.push(
				this.drawLayer.graphics.on("change", (event) => {
					if (event.removed && event.removed.length > 0) {
						setTimeout(() => { this.cleanupOrphanedBuffers(); }, 100);
					}
				})
			);

			//console.log('✅ Enhanced event handlers configured successfully');

		}).catch(error => {
			console.error('❌ Error in activeViewChangeHandler:', error);
		});
	};

	handleMeasurementSystemControl = (enabled: boolean) => {
		if (this.measureRef?.current) {
			if (enabled) {
				// Remove the complex delay logic - SketchViewModel is now properly initialized
				if (this.sketchViewModel && this.sketchViewModel.view) {
					// Check if drawing tools are active before enabling
					const isDrawingActive = this.state.pointBtnActive || this.state.lineBtnActive ||
						this.state.flineBtnActive || this.state.rectBtnActive ||
						this.state.polygonBtnActive || this.state.fpolygonBtnActive ||
						this.state.circleBtnActive || this.state.textBtnActive;

					if (!isDrawingActive) {
						this.measureRef.current.enableMeasurements();
					} else {
						//console.log('Drawing tool active - measurement enable deferred');
					}
				} else {
					console.warn('SketchViewModel not ready for measurements');
				}
			} else {
				this.measureRef.current.disableMeasurements();
			}
		}
	};

	toggleDrawingsPanel = () => {
		this.setState({ showDrawingsPanel: !this.state.showDrawingsPanel });
	}

	private clearSelectionOverlaysInDrawLayer = () => {
		if (!this.drawLayer) return;
		// End any active vertex edit (reshape/update) so manipulators don't linger
		// on the graphic(s) after the selection is cleared. Preserve their labels.
		try {
			const updating = this.sketchViewModel?.updateGraphics?.toArray?.() || [];
			if (updating.length) this.cancelSketchVMWithLabelPreservation(updating);
		} catch (e) {
			console.warn('Error canceling SketchVM during clear selection:', e);
		}
		try {
			this.drawLayer.graphics.toArray().forEach(g => {
				const ext: any = g;
				if (ext._selectionOverlay) {
					try { this.drawLayer.remove(ext._selectionOverlay); } catch { }
					ext._selectionOverlay = null;
				}
			});
		} catch (e) {
			console.warn('Error clearing selection overlays:', e);
		}
	};


	handleDrawingSelect = (graphic: any, index: number) => {
		if (!graphic) return;
		if ((graphic as any).attributes?.isBuffer) return;

		if (!this.sketchViewModel || !this.sketchViewModel.view) {
			console.warn('SketchViewModel or view not ready for selection');
			return;
		}

		try {
			if (!(graphic as any).attributes) (graphic as any).attributes = {};
			if (!(graphic as any).attributes.uniqueId) {
				(graphic as any).attributes.uniqueId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			}
		} catch (e) {
			console.warn('Could not ensure uniqueId on graphic:', e);
		}

		const extGraphic = graphic as any;

		// FIX #13: Use shared cancel helper instead of duplicate save/cancel/restore logic
		this.cancelSketchVMWithLabelPreservation([graphic]);

		const myEpoch = ++this._selectionEpoch;

		try {
			if (this.drawLayer) {
				this.drawLayer.graphics.toArray().forEach((g: any) => {
					if (g && g._selectionOverlay) {
						try {
							if (g._selectionOverlay.layer === this.drawLayer) {
								this.drawLayer.remove(g._selectionOverlay);
							}
						} catch { }
						g._selectionOverlay = null;
					}
				});
			}
		} catch (e) {
			console.warn('Failed clearing existing selection overlays:', e);
		}

		if (graphic.geometry?.type === 'polyline' && (graphic.symbol as any)?.type !== 'simple-line') {
			const symbolColor = (graphic.symbol as any)?.color || [0, 0, 0, 1];
			const symbolWidth = (graphic.symbol as any)?.width || 2;
			const symbolStyle = (graphic.symbol as any)?.style || 'solid';
			graphic.symbol = new SimpleLineSymbol({ color: symbolColor, width: symbolWidth, style: symbolStyle });
		}

		try {
			if (!this.sketchViewModel.view) {
				console.warn('SketchViewModel view became invalid during selection');
				return;
			}

			this.sketchViewModel.update([graphic]);

			if (this.measureRef?.current) {
				// 🔧 FIX: Commented out automatic checkbox toggling to prevent unwanted measurement re-enabling
				// The checkbox should only be controlled by user actions, not by graphic selection
				// After selecting a drawing (e.g., from My Drawings list):
				// const hasMeasurements =
				// 	extGraphic.attributes?.hadMeasurements ||
				// 	extGraphic.attributes?.measurementsPermanent ||
				// 	extGraphic.measure?.graphic ||
				// 	(extGraphic.attributes?.relatedMeasurementLabels?.length > 0) ||
				// 	(extGraphic.attributes?.relatedSegmentLabels?.length > 0);

				// Toggle measurement checkbox based on graphic's measurements (no tab check needed)
				// 🚫 DISABLED: This was causing measurements to be re-added when user had unchecked the box
				// if (hasMeasurements && !this.state.measurementCheckboxOn) {
				// 	//console.log('✅ Auto-checking measurement checkbox - graphic has measurements');
				// 	this.setState({ measurementCheckboxOn: true });
				// 	this.measureRef.current.setMeasurementEnabled?.(true);
				// } else if (!hasMeasurements && this.state.measurementCheckboxOn) {
				// 	//console.log('✅ Auto-unchecking measurement checkbox - graphic has no measurements');
				// 	this.setState({ measurementCheckboxOn: false });
				// 	this.measureRef.current.setMeasurementEnabled?.(false);
				// }

				setTimeout(() => {
					if (this.measureRef?.current && this.sketchViewModel && this.sketchViewModel.view) {
						// 🔧 FIX: Only update if measurements CURRENTLY exist on the layer
						// Check for ACTUAL measurement graphics that are still on the layer
						const hasMainMeasurement =
							extGraphic.measure?.graphic &&
							extGraphic.measure.graphic.layer &&
							this.drawLayer?.graphics?.includes(extGraphic.measure.graphic);

						const hasValidMeasurementLabels =
							extGraphic.attributes?.relatedMeasurementLabels?.some(
								label => label && label.layer && this.drawLayer?.graphics?.includes(label)
							);

						const hasValidSegmentLabels =
							extGraphic.attributes?.relatedSegmentLabels?.some(
								label => label && label.layer && this.drawLayer?.graphics?.includes(label)
							);

						const hasCurrentMeasurements =
							hasMainMeasurement || hasValidMeasurementLabels || hasValidSegmentLabels;

						const shouldUpdate =
							this.measureRef.current.isMeasurementEnabled?.() ||  // Checkbox is ON - create/update measurements
							hasCurrentMeasurements;  // OR graphic CURRENTLY has measurements on the layer - update them

						if (shouldUpdate) {
							// If graphic has current measurements but checkbox is OFF,
							// we're just refreshing existing measurements, not creating new ones
							if (hasCurrentMeasurements && !this.measureRef.current.isMeasurementEnabled?.()) {
								//console.log('🔄 Refreshing existing measurements for:', extGraphic.attributes?.uniqueId);
							}

							if (!this.measureRef.current.isBusy || !this.measureRef.current.isBusy()) {
								this.measureRef.current.updateMeasurementsForGraphic(graphic);
							} else {
								setTimeout(() => {
									if (this.measureRef?.current && this.sketchViewModel?.view) {
										this.measureRef.current.updateMeasurementsForGraphic(graphic);
									}
								}, 500);
							}
						} else {
							// Graphic has no measurements and checkbox is OFF - skip update
							//console.log('⏭️ Skipping measurement update - no measurements and checkbox OFF');
						}
					} else {
						console.warn('SketchViewModel not ready for measurement update during selection');
					}
				}, 100);
			}

			// 🔧 FIX (Bug A): Robust segment-label rescue around sketchViewModel.update().
			//
			// Background: when the user clicks a drawing in My Drawings, this handler
			// calls sketchViewModel.update([graphic]) to put it into edit mode. Even
			// though cancelSketchVMWithLabelPreservation tries to preserve labels through
			// the cancel(), the subsequent update() call interacts with SVM internals
			// that can either visually obscure segment labels with overlay graphics, or
			// silently strip them from the GraphicsLayer.
			//
			// Strategy: capture a strong reference to every segment label on the layer
			// BEFORE update() runs, then on a delayed tick re-add any that are missing
			// and reset their symbol + visibility. The remove+add cycle on still-present
			// segments forces a fresh draw above SVM's overlay.
			let _segLabelSnapshot: any[] = [];
			try {
				if (this.drawLayer?.graphics) {
					_segLabelSnapshot = this.drawLayer.graphics.toArray().filter((g: any) =>
						g?.attributes?.isSegmentLabel === true ||
						g?.attributes?.measurementType === 'segment'
					);
				}
			} catch (e) { /* non-fatal */ }

			if (this.measureRef?.current?.isEditingMeasurements?.()) {
				setTimeout(() => {
					if (this.measureRef?.current?.selectGraphicMeasurementLabel) {
						this.measureRef.current.selectGraphicMeasurementLabel(graphic as any);
					}
				}, 100);
			}

			// Rescue segment labels after SVM has fully settled into update mode.
			// 200ms gives time for SVM.update() listeners to fire and any cascading
			// state changes to land. We then forcibly re-add any segment labels that
			// dropped off the layer and toggle the still-present ones to defeat
			// z-order issues against SVM's overlay graphics.
			if (_segLabelSnapshot.length > 0) {
				setTimeout(() => {
					try {
						if (!this.drawLayer || !this.drawLayer.graphics) return;
						const layerGraphics = this.drawLayer.graphics;
						_segLabelSnapshot.forEach((seg: any) => {
							try {
								if (!seg || seg.destroyed) return;
								// Reset symbol via clone to undo any transparency/empty-text mutation
								if (seg.symbol && typeof seg.symbol.clone === 'function') {
									const cloned = seg.symbol.clone();
									if (!cloned.text && seg.attributes?.name) {
										cloned.text = seg.attributes.name;
									}
									// Force color alpha back to opaque in case it was zeroed
									if (cloned.color && typeof cloned.color === 'object' && 'a' in cloned.color) {
										if (cloned.color.a === 0) cloned.color.a = 1;
									}
									seg.symbol = cloned;
								}
								seg.visible = true;
								// Remove + re-add — this works whether seg is still on layer
								// (forces re-draw above SVM overlay) or already fell off
								// (puts it back on).
								try {
									if (layerGraphics.includes(seg)) {
										layerGraphics.remove(seg);
									}
								} catch { /* no-op */ }
								try {
									layerGraphics.add(seg);
								} catch { /* no-op */ }
							} catch (e) { /* keep iterating */ }
						});
					} catch (e) {
						console.warn('Segment label rescue failed (non-critical):', e);
					}
				}, 200);
			}

			this.ensureBufferWatchersForSelectedGraphic(graphic as any);

			const isPoint = graphic.geometry?.type === 'point';
			const ext = graphic as any;

			if (!isPoint && ext._selectionOverlay) {
				try {
					if (ext._selectionOverlay.layer === this.drawLayer) this.drawLayer.remove(ext._selectionOverlay);
				} catch { }
				ext._selectionOverlay = null;
			}

			if (isPoint) {
				try {
					if (ext._selectionOverlay) {
						if (ext._selectionOverlay.layer === this.drawLayer) this.drawLayer.remove(ext._selectionOverlay);
						ext._selectionOverlay = null;
					}
				} catch (e) {
					console.warn('Overlay pre-clear on target failed:', e);
					ext._selectionOverlay = null;
				}

				setTimeout(() => {
					if (myEpoch !== this._selectionEpoch) return;
					this.ensurePointTextOverlayFromMap(ext);

					setTimeout(() => {
						if (myEpoch !== this._selectionEpoch) return;
						if (!ext._selectionOverlay || ext._selectionOverlay.layer !== this.drawLayer) {
							this.ensurePointTextOverlayFromMap(ext);
						} else {
							try {
								ext._selectionOverlay.geometry = ext.geometry;
								this.drawLayer.remove(ext._selectionOverlay);
								this.drawLayer.add(ext._selectionOverlay);
							} catch { }
						}
					}, 250);
				}, 150);
			}

			const graphicKey = (graphic.attributes && (graphic.attributes as any).uniqueId) || `temp_${Date.now()}`;

			if (this._positionWatchers) {
				try {
					if (this._positionWatchers[graphicKey]) {
						this._positionWatchers[graphicKey].remove?.();
						delete this._positionWatchers[graphicKey];
					}
					if (this._positionWatchers[graphicKey + '_symbol']) {
						this._positionWatchers[graphicKey + '_symbol'].remove?.();
						delete this._positionWatchers[graphicKey + '_symbol'];
					}
					if (this._positionWatchers[graphicKey + '_attributes']) {
						this._positionWatchers[graphicKey + '_attributes'].remove?.();
						delete this._positionWatchers[graphicKey + '_attributes'];
					}
				} catch (e) {
					console.warn('Error clearing prior watchers:', e);
				}
			} else {
				this._positionWatchers = {};
			}

			this._positionWatchers[graphicKey] = graphic.watch('geometry', async () => {
				if (this.measureRef?.current && this.sketchViewModel?.view) {
					clearTimeout(this._measurementUpdateTimeout);
					this._measurementUpdateTimeout = setTimeout(() => {
						if (this.measureRef?.current && this.sketchViewModel?.view) {
							this.measureRef.current.updateMeasurementsForGraphic(graphic);
						}
					}, 300);
				}

				const extendedGraphic = graphic as any;
				if (extendedGraphic.bufferGraphic && extendedGraphic.bufferSettings) {
					try {
						await this.updateAttachedBuffer(extendedGraphic);
					} catch (error) {
						console.error('❌ Widget: Error updating buffer:', error);
					}
				}

				if (isPoint && (graphic as any)._selectionOverlay) {
					try { (graphic as any)._selectionOverlay.geometry = graphic.geometry; } catch { }
				}
			});

			this._positionWatchers[graphicKey + '_symbol'] = graphic.watch('symbol', () => {
				if (graphic.geometry?.type === 'point' && this.measureRef?.current && this.sketchViewModel?.view) {
					setTimeout(() => {
						if (this.measureRef?.current && this.sketchViewModel?.view) {
							this.measureRef.current.updateMeasurementsForGraphic(graphic);
						}
					}, 100);
				}
			});

			this._positionWatchers[graphicKey + '_attributes'] = graphic.watch('attributes', () => {
				if ((graphic.symbol as any)?.type === 'text' && this.measureRef?.current && this.sketchViewModel?.view) {
					setTimeout(() => {
						if (this.measureRef?.current && this.sketchViewModel?.view) {
							this.measureRef.current.updateMeasurementsForGraphic(graphic);
						}
					}, 100);
				}
			});

		} catch (error) {
			console.error('Error in handleDrawingSelect:', error);
		}
	};

	handleDrawingsUpdate = (updatedDrawings: Graphic[]) => {
		// Filter to get only main drawings (exclude buffers and measurement labels)
		const mainDrawings = updatedDrawings.filter(g =>
			!g.attributes?.isBuffer &&
			!g.attributes?.isMeasurementLabel &&
			!g.attributes?.hideFromList
		);

		// Save to localStorage using the same method as MyDrawingsPanel
		this.saveDrawingsToLocalStorage(mainDrawings);

		//console.log(`Saved ${mainDrawings.length} drawings to localStorage`);
	}

	private originalPopupEnabled: boolean | null = null;

	// Add this method to save drawings to localStorage
	private saveDrawingsToLocalStorage = (drawings: Graphic[]) => {
		try {
			// Use the configured storage key (global or app-specific)
			const localStorageKey = this.getLocalStorageKey() ?? (() => {
				// Fallback to app-specific key if getLocalStorageKey returns undefined
				const fullUrl = `${window.location.origin}${window.location.pathname}`;
				const baseKey = btoa(fullUrl).replace(/[^a-zA-Z0-9]/g, '_');
				return `drawings_${baseKey}`;
			})();

			// Get all graphics from the layer
			const allGraphics = this.drawLayer.graphics.toArray();

			// Separate main drawings from measurement labels
			const mainDrawings = allGraphics.filter(g =>
				!g.attributes?.isMeasurementLabel &&
				!g.attributes?.hideFromList &&
				!g.attributes?.isPreviewBuffer &&
				!g.attributes?.isBuffer &&
				!g.attributes?.isBufferDrawing
			);

			const measurementLabels = allGraphics.filter(g =>
				g.attributes?.isMeasurementLabel &&
				!g.attributes?.isPreviewBuffer
			);

			// Prepare main drawings for storage with buffer settings
			const drawingsToSave = mainDrawings.map((graphic) => {
				const extendedGraphic = graphic as any;
				const json = graphic.toJSON();

				// Ensure each graphic has a uniqueId
				if (!json.attributes) {
					json.attributes = {};
				}
				if (!json.attributes.uniqueId) {
					const uniqueId = `saved_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
					json.attributes.uniqueId = uniqueId;
				}
				if (!json.attributes.createdDate) {
					json.attributes.createdDate = Date.now();
				}

				// Save buffer settings if this graphic has an attached buffer
				if (extendedGraphic.bufferSettings) {
					json.attributes.bufferSettings = {
						distance: extendedGraphic.bufferSettings.distance,
						unit: extendedGraphic.bufferSettings.unit,
						enabled: extendedGraphic.bufferSettings.enabled,
						opacity: extendedGraphic.bufferSettings.opacity ?? 50,
						outlineOnly: extendedGraphic.bufferSettings.outlineOnly ?? false,
						customColor: extendedGraphic.bufferSettings.customColor ?? null,
						customOutlineColor: extendedGraphic.bufferSettings.customOutlineColor ?? null,
						hasLabel: extendedGraphic.bufferLabel ? true : false
					};
				}

				// FIX #11: Persist measurement unit metadata on parent drawing
				if (extendedGraphic.attributes?.measurementUnits) {
					json.attributes.measurementUnits = extendedGraphic.attributes.measurementUnits;
				}

				return json;
			});

			// Prepare measurement labels for storage (matching MyDrawingsPanel v1.5 format)
			const measurementLabelsToSave = measurementLabels.map((label) => {
				const extendedLabel = label as any;
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

				// FIX #1: Save customization flags and custom position data (match v1.5 format)
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

				// 🔧 FIX: explicitly persist segment-specific fields. label.toJSON()
				// copies the attributes object, but being explicit guards against
				// future changes to ExtendedGraphic and makes the saved shape
				// unambiguous — without these, a reload could lose segment identity
				// and segment labels for polylines wouldn't reappear after refresh.
				// (Mirrors the same block in MyDrawingsPanel.tsx's save loop.)
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

			// FIX #1: Read existing localStorage to preserve MyDrawingsPanel v1.5 metadata
			// so we don't overwrite hasManualOrder, sortOption, collapsedDrawings, etc.
			// ALSO: Preserve any saved drawings not yet loaded onto the layer (prior session drawings)
			// ALSO: Respect manual ordering — don't overwrite with layer order
			let existingMeta: any = {};
			let finalDrawingsToSave = drawingsToSave;
			let finalLabelsToSave = measurementLabelsToSave;
			try {
				const existingRaw = localStorage.getItem(localStorageKey);
				if (existingRaw) {
					const existingData = JSON.parse(existingRaw);
					if (existingData.version) {
						existingMeta = {
							hasManualOrder: existingData.hasManualOrder,
							sortOption: existingData.sortOption,
							collapsedDrawings: existingData.collapsedDrawings,
							drawingLabelOption: existingData.drawingLabelOption,
							lockedDrawings: existingData.lockedDrawings,
							allDrawingsLocked: existingData.allDrawingsLocked
						};
					}

					// Build a lookup of current layer drawings by uniqueId for fast access
					const layerDrawingsById = new Map<string, any>();
					drawingsToSave.forEach(d => {
						if (d.attributes?.uniqueId) {
							layerDrawingsById.set(d.attributes.uniqueId, d);
						}
					});

					const existingDrawings = existingData.drawings || (Array.isArray(existingData) ? existingData : []);

					// When hasManualOrder is true, preserve the saved order from localStorage
					// and only append truly new drawings at the end
					if (existingMeta.hasManualOrder && existingDrawings.length > 0) {
						const orderedResult: any[] = [];
						const usedIds = new Set<string>();

						// First pass: walk through existing order, replace with updated layer data
						for (const existingDraw of existingDrawings) {
							const uid = existingDraw.attributes?.uniqueId;
							if (uid && layerDrawingsById.has(uid)) {
								// This drawing is still on the layer — use the updated version
								orderedResult.push(layerDrawingsById.get(uid));
								usedIds.add(uid);
							} else if (uid && !layerDrawingsById.has(uid)) {
								// This drawing is NOT on the layer — it's an unloaded prior-session drawing
								orderedResult.push(existingDraw);
								usedIds.add(uid);
							}
						}

						// Second pass: append any new drawings not in the existing order
						for (const d of drawingsToSave) {
							const uid = d.attributes?.uniqueId;
							if (uid && !usedIds.has(uid)) {
								orderedResult.push(d);
							}
						}

						finalDrawingsToSave = orderedResult;
					} else {
						// No manual order: just append unloaded prior-session drawings
						const layerUniqueIds = new Set<string>(
							drawingsToSave
								.map(d => d.attributes?.uniqueId)
								.filter(Boolean)
						);

						const unloadedDrawings = existingDrawings.filter(d =>
							d.attributes?.uniqueId && !layerUniqueIds.has(d.attributes.uniqueId)
						);

						if (unloadedDrawings.length > 0) {
							finalDrawingsToSave = [...drawingsToSave, ...unloadedDrawings];
						}
					}

					// Preserve measurement labels for unloaded drawings
					const finalDrawingIds = new Set<string>(
						finalDrawingsToSave.map(d => d.attributes?.uniqueId).filter(Boolean)
					);
					const layerLabelParentIds = new Set<string>(
						measurementLabelsToSave.map(l => l.attributes?.parentGraphicId).filter(Boolean)
					);
					const existingLabels = existingData.measurementLabels || [];
					const unloadedLabels = existingLabels.filter(l =>
						l.attributes?.parentGraphicId &&
						finalDrawingIds.has(l.attributes.parentGraphicId) &&
						!layerLabelParentIds.has(l.attributes.parentGraphicId)
					);
					if (unloadedLabels.length > 0) {
						finalLabelsToSave = [...measurementLabelsToSave, ...unloadedLabels];
					}
				}
			} catch { /* ignore parse errors */ }

			// Combine drawings and measurement labels at v1.5 format
			const allGraphicsToSave = {
				drawings: finalDrawingsToSave,
				measurementLabels: finalLabelsToSave,
				version: "1.5",
				// Preserve existing MyDrawingsPanel metadata
				hasManualOrder: existingMeta.hasManualOrder ?? true,
				sortOption: existingMeta.sortOption ?? 'name',
				collapsedDrawings: existingMeta.collapsedDrawings ?? [],
				drawingLabelOption: existingMeta.drawingLabelOption ?? 'off',
				lockedDrawings: existingMeta.lockedDrawings ?? [],
				allDrawingsLocked: existingMeta.allDrawingsLocked ?? false
			};

			// FIX #12: Handle localStorage quota exceeded
			const stringified = JSON.stringify(allGraphicsToSave);
			try {
				localStorage.setItem(localStorageKey, stringified);
			} catch (storageError) {
				if (storageError instanceof DOMException &&
					(storageError.name === 'QuotaExceededError' || storageError.code === 22)) {
					console.error('❌ localStorage quota exceeded. Attempting to save without measurement labels...');
					// Fallback: save without measurement labels to at least preserve drawings
					const fallbackData = {
						...allGraphicsToSave,
						measurementLabels: []
					};
					try {
						localStorage.setItem(localStorageKey, JSON.stringify(fallbackData));
						console.warn('⚠️ Saved drawings without measurement labels due to storage quota');
					} catch (fallbackError) {
						console.error('❌ Cannot save drawings - localStorage quota exceeded even without labels:', fallbackError);
					}
				} else {
					throw storageError;
				}
			}

		} catch (error) {
			console.error(`❌ Error saving drawings to localStorage:`, error);
		}
	};

	showAlert = (message: string, type: 'success' | 'error' | 'info') => {
		//console.log(`${type}: ${message}`);
		alert(message);
	}

	// ── True-curve line tool: arc / endpoint arc / bezier ────────────────
	// Builds real hasCurves geometry via ArcGIS curve segments ("c" = circular
	// arc by interior point, "b" = cubic bezier) and routes through svmGraCreate
	// so it inherits naming, measurement labels and save. No OOTB Esri component.
	// ── True-curve line tool: arc / endpoint arc / bezier ────────────────────
	// Builds real hasCurves geometry via ArcGIS curve segments ("c" = circular
	// arc by interior point, "b" = cubic bezier) as a MULTI-SEGMENT polyline:
	// each completed segment continues from the previous endpoint, like the
	// straight line tool but curved. Finalizes through svmGraCreate so curves get
	// naming, measurement labels, and save. No OOTB Esri component.
	// Lightweight vertex snapping for the custom curve/triangle tools. They bypass
	// the SketchViewModel, so honor the Snapping toggle by snapping a clicked point
	// to the nearest existing drawing vertex within a pixel tolerance. (Feature-layer
	// and grid-node snapping are owned by the SVM and not available to these tools.)
	private _snapMapPoint = (view: any, pt: number[]): number[] => {
		try {
			const so: any = this.sketchViewModel?.snappingOptions || (view as any)?.snappingOptions;
			if (!so?.enabled) return pt;
			const sr = view.spatialReference;
			const toScr = (x: number, y: number) => { try { return view.toScreen(new Point({ x, y, spatialReference: sr })); } catch { return null; } };
			const screen = toScr(pt[0], pt[1]);
			if (!screen) return pt;
			let best: number[] | null = null;
			const tolPx = (typeof so.distance === 'number' && so.distance > 0) ? so.distance : 15; // px tolerance
			let bestD = tolPx;
			const consider = (vx: number, vy: number) => {
				const s = toScr(vx, vy);
				if (!s) return;
				const d = Math.hypot(s.x - screen.x, s.y - screen.y);
				if (d < bestD) { bestD = d; best = [vx, vy]; }
			};
			// Edge snapping: closest point on segment a-b to the click, measured in
			// screen space so the px tolerance is consistent. Matches the built-in
			// tools, which snap to edges, not just vertices.
			const considerSegment = (ax: number, ay: number, bx: number, by: number) => {
				const A = toScr(ax, ay); const B = toScr(bx, by);
				if (!A || !B) { consider(ax, ay); consider(bx, by); return; }
				const vx = B.x - A.x; const vy = B.y - A.y;
				const len2 = vx * vx + vy * vy;
				let t = len2 > 0 ? ((screen.x - A.x) * vx + (screen.y - A.y) * vy) / len2 : 0;
				t = t < 0 ? 0 : (t > 1 ? 1 : t);
				const d = Math.hypot((A.x + t * vx) - screen.x, (A.y + t * vy) - screen.y);
				if (d < bestD) { bestD = d; best = [ax + t * (bx - ax), ay + t * (by - ay)]; }
			};
			const considerRing = (ring: number[][]) => {
				if (ring.length === 1) { consider(ring[0][0], ring[0][1]); return; }
				for (let i = 0; i < ring.length - 1; i++) considerSegment(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
			};
			const gs = this.drawLayer?.graphics?.toArray?.() || [];
			for (const g of gs) {
				const geom: any = (g as any).geometry;
				const attrs: any = (g as any).attributes;
				if (!geom || attrs?.isMeasurementLabel || attrs?.hideFromList || attrs?.isPreviewBuffer) continue;
				if (geom.type === 'point') { consider(geom.x, geom.y); }
				else if (Array.isArray(geom.rings)) { for (const ring of geom.rings) considerRing(ring); }
				else if (Array.isArray(geom.paths) && geom.paths.length) { for (const path of geom.paths) considerRing(path); }
				else if (Array.isArray(geom.curvePaths)) {
					for (const path of geom.curvePaths) for (const el of path) {
						if (Array.isArray(el)) consider(el[0], el[1]);
						else if (el?.c) consider(el.c[0][0], el.c[0][1]);
						else if (el?.b) consider(el.b[0][0], el.b[0][1]);
					}
				}
			}
			// also snap to the in-progress curve path / triangle center (self)
			if (this._curvePathStart) consider(this._curvePathStart[0], this._curvePathStart[1]);
			for (const seg of (this._curveSegs || [])) { const e = this._segEndVertex(seg); if (e) consider(e[0], e[1]); }
			if (this._triCenter) consider(this._triCenter[0], this._triCenter[1]);
			// feature candidates come from the throttled background cache so this stays
			// synchronous and the preview can snap on every pointer-move without flicker.
			// See _refreshFeatCache, which keeps the cache near the cursor.
			if (so.featureEnabled !== false) {
				for (const s of this._snapFeatSegs) considerSegment(s[0], s[1], s[2], s[3]);
				for (const p of this._snapFeatPts) consider(p[0], p[1]);
			}
			// Hysteresis: if nothing newly snapped but the cursor is still close to the
			// last snap target, keep holding it so motion near the threshold doesn't
			// flip the snap on and off.
			if (!best && this._snapLast) {
				const ls = toScr(this._snapLast[0], this._snapLast[1]);
				if (ls && Math.hypot(ls.x - screen.x, ls.y - screen.y) < tolPx * 1.6) return this._snapLast;
			}
			this._snapLast = best;
			return best || pt;
		} catch { return pt; }
	};

	// Show/move/remove the snap indicator marker at the snapped point. Tagged
	// isPreviewBuffer so the snap scan never treats the indicator as a candidate.
	private _updateSnapIndicator = (view: any, snapped: number[] | null) => {
		try {
			if (!snapped) { if (this._snapIndicator) this._snapIndicator.visible = false; return; }
			const geom = new Point({ x: snapped[0], y: snapped[1], spatialReference: view.spatialReference });
			if (!this._snapIndicator) {
				const sym = new SimpleMarkerSymbol({ style: 'circle', size: 12, color: [255, 128, 0, 0.10], outline: { color: [255, 128, 0, 1], width: 2 } });
				this._snapIndicator = new Graphic({ geometry: geom, symbol: sym, visible: true, attributes: { hideFromList: true, isPreviewBuffer: true, isSnapIndicator: true } });
				if (this.drawLayer) this.drawLayer.add(this._snapIndicator);
			} else {
				this._snapIndicator.geometry = geom;
				this._snapIndicator.visible = true;
			}
		} catch { }
	};

	private _clearSnapIndicator = () => {
		try { if (this._snapIndicator && this.drawLayer) this.drawLayer.remove(this._snapIndicator); } catch { }
		this._snapIndicator = null;
		this._snapLast = null;
		this._snapCacheAt = null;
		this._snapFeatSegs = [];
		this._snapFeatPts = [];
	};

	// On-map drawing tooltip for the custom curve/triangle tools, mirroring the SVM
	// tooltipOptions used by the built-in tools. Gated on the same Tooltips toggle
	// (sketchViewModel.tooltipOptions.enabled) and the same display units
	// (sketchViewModel.valueOptions.displayUnits) the Measure panel configures.
	private _tooltipsOn = (): boolean => !!(this.sketchViewModel?.tooltipOptions?.enabled);

	private _ensureCursorTip = (view: any): HTMLDivElement => {
		if (this._cursorTip) return this._cursorTip;
		const d = document.createElement('div');
		d.className = 'drawadv-cursor-tip';
		// Mirrors Esri .esri-tooltip-content: translucent dark bg, hairline border,
		// backdrop blur, soft double shadow, 4px radius.
		d.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:var(--calcite-color-foreground-1,#fff);color:var(--calcite-color-text-1,#151515);font:12px/1.2 var(--calcite-sans-family,"Avenir Next",Avenir,Helvetica,Arial,sans-serif);padding:6px 9px;border:1px solid var(--calcite-color-border-3,#dfdfdf);border-radius:5px;white-space:nowrap;display:none;box-shadow:0 6px 20px -4px rgba(0,0,0,0.18),0 4px 12px -2px rgba(0,0,0,0.12);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
		try { document.body.appendChild(d); } catch { }
		this._cursorTip = d;
		return d;
	};

	private _updateCursorTip = (view: any, sx: number, sy: number, rows: Array<[string, string]>) => {
		if (!rows || rows.length === 0) { this._hideCursorTip(); return; }
		const d = this._ensureCursorTip(view);
		const grid = document.createElement('div');
		grid.style.cssText = 'display:grid;grid-template-columns:max-content max-content;column-gap:12px;row-gap:2px;align-items:baseline;';
		for (const [label, value] of rows) {
			const l = document.createElement('span'); l.textContent = label; l.style.cssText = 'color:var(--calcite-color-text-2,#5a5a5a);';
			const v = document.createElement('span'); v.textContent = value; v.style.cssText = 'color:var(--calcite-color-text-1,#151515);text-align:right;font-variant-numeric:tabular-nums;';
			grid.appendChild(l); grid.appendChild(v);
		}
		d.innerHTML = '';
		d.appendChild(grid);
		let cx = sx + 16, cy = sy + 16;
		try { const r = view.container.getBoundingClientRect(); cx = r.left + sx + 16; cy = r.top + sy + 16; } catch { }
		d.style.left = cx + 'px';
		d.style.top = cy + 'px';
		d.style.display = 'block';
	};

	private _hideCursorTip = () => { if (this._cursorTip) this._cursorTip.style.display = 'none'; };

	private _clearCursorTip = () => {
		try { if (this._cursorTip && this._cursorTip.parentNode) this._cursorTip.parentNode.removeChild(this._cursorTip); } catch { }
		this._cursorTip = null;
	};

	private _tipLenUnit = (): string => this.sketchViewModel?.valueOptions?.displayUnits?.length || 'meters';
	private _tipAreaUnit = (): string => this.sketchViewModel?.valueOptions?.displayUnits?.area || 'square-meters';
	private _lenAbbr = (u: string): string => (({ meters: 'm', feet: 'ft', miles: 'mi', kilometers: 'km', yards: 'yd', 'nautical-miles': 'NM' } as any)[u] || u);
	private _areaAbbr = (u: string): string => (({ 'square-meters': 'm\u00B2', 'square-feet': 'ft\u00B2', 'square-miles': 'mi\u00B2', 'square-kilometers': 'km\u00B2', acres: 'ac', hectares: 'ha', 'square-yards': 'yd\u00B2' } as any)[u] || u);
	private _fmtTip = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	// Length via operators (geodetic first, planar fallback), matching measure.tsx.
	// geometryEngine.geodesicLength does not exist in @arcgis/core 5.0.
	private _lenOp = (geom: any, unit: string): number | null => {
		try { const L = (geodeticLengthOperator as any).execute(geom, { unit }); if (typeof L === 'number' && isFinite(L)) return Math.abs(L); } catch { }
		try { const L = (lengthOperator as any).execute(geom, { unit }); if (typeof L === 'number' && isFinite(L)) return Math.abs(L); } catch { }
		return null;
	};
	private _areaOp = (geom: any, unit: string): number | null => {
		try { const A = (geodeticAreaOperator as any).execute(geom, { unit }); if (typeof A === 'number' && isFinite(A)) return Math.abs(A); } catch { }
		try { const A = (areaOperator as any).execute(geom, { unit }); if (typeof A === 'number' && isFinite(A)) return Math.abs(A); } catch { }
		return null;
	};

	private _measureLengthTip = (view: any, geom: any, unit: string): number | null => {
		try {
			let g = geom;
			if (geom && Array.isArray(geom.curvePaths) && geom.curvePaths.length) {
				const maxSeg = (view?.resolution || 1) * 4;
				try { g = (densifyOperator as any).execute(geom, maxSeg); } catch { g = geom; }
			}
			return this._lenOp(g, unit);
		} catch { return null; }
	};

	private _measureAreaTip = (geom: any, unit: string): number | null => {
		try { return this._areaOp(geom, unit); } catch { return null; }
	};

	// Absolute direction (degrees clockwise from north / +y) from a->b. Mirrors the
	// SketchTooltipOptions "direction" element shown while drawing.
	private _bearing = (ax: number, ay: number, bx: number, by: number): number => {
		let deg = Math.atan2(bx - ax, by - ay) * 180 / Math.PI;
		if (deg < 0) deg += 360;
		return deg;
	};

	// Geodesic length of a single a->b segment, in the given unit.
	private _segMeasure = (view: any, ax: number, ay: number, bx: number, by: number, unit: string): number | null => {
		try {
			const poly = PolylineCompat.fromJSON({ paths: [[[ax, ay], [bx, by]]], spatialReference: view.spatialReference });
			return this._lenOp(poly, unit);
		} catch { return null; }
	};

	// Cursor tooltip text for the curve tool: total length + current segment
	// distance and direction, matching the native polyline sketch tooltip.
	private _curveTipText = (view: any, snapped: number[]): Array<[string, string]> => {
		try {
			const lu = this._tipLenUnit();
			const geom = this._buildCurveGeometry(view, snapped);
			const total = geom ? this._measureLengthTip(view, geom, lu) : null;
			const segStart = (this._curveStart as number[]) || (this._curvePathStart as number[]);
			let seg: number | null = null; let dir: number | null = null;
			if (segStart) { seg = this._segMeasure(view, segStart[0], segStart[1], snapped[0], snapped[1], lu); dir = this._bearing(segStart[0], segStart[1], snapped[0], snapped[1]); }
			const ve: any = this.sketchViewModel?.tooltipOptions?.visibleElements || {};
			// Deflection: relative angle from the previous segment; em dash on the first
			// segment, matching the native sketch tooltip default.
			const nSeg = this._curveSegs?.length || 0;
			let prev: number[] | null = null;
			if (nSeg >= 2) prev = this._segEndVertex(this._curveSegs[nSeg - 2]);
			else if (nSeg === 1) prev = this._curvePathStart as number[];
			let defl: number | null = null;
			if (prev && segStart) {
				let dd = this._bearing(segStart[0], segStart[1], snapped[0], snapped[1]) - this._bearing(prev[0], prev[1], segStart[0], segStart[1]);
				while (dd > 180) dd -= 360; while (dd < -180) dd += 360;
				defl = dd;
			}
			const rows: Array<[string, string]> = [];
			if (ve.direction !== false) rows.push(['Deflection', defl != null ? (Math.round(defl) + '\u00B0') : '\u2013']);
			if (seg != null && ve.distance !== false) rows.push(['Distance', this._fmtTip(seg) + ' ' + this._lenAbbr(lu)]);
			if (total != null && ve.totalLength !== false) rows.push(['Total length', this._fmtTip(total) + ' ' + this._lenAbbr(lu)]);
			return rows;
		} catch { return []; }
	};

	// Cursor tooltip text for the triangle tool: area + radius (center to cursor)
	// and direction, matching the native sized-shape sketch tooltip.
	private _triTipText = (view: any, snapped: number[], geom: any): Array<[string, string]> => {
		try {
			const au = this._tipAreaUnit(); const lu = this._tipLenUnit();
			const A = geom ? this._measureAreaTip(geom, au) : null;
			const center = this._triCenter as number[];
			let rad: number | null = null; let dir: number | null = null;
			if (center) { rad = this._segMeasure(view, center[0], center[1], snapped[0], snapped[1], lu); dir = this._bearing(center[0], center[1], snapped[0], snapped[1]); }
			const ve: any = this.sketchViewModel?.tooltipOptions?.visibleElements || {};
			const rows: Array<[string, string]> = [];
			if (A != null && ve.area !== false) rows.push(['Area', this._fmtTip(A) + ' ' + this._areaAbbr(au)]);
			if (rad != null && ve.distance !== false) rows.push(['Radius', this._fmtTip(rad) + ' ' + this._lenAbbr(lu)]);
			if (dir != null && ve.direction !== false) rows.push(['Direction', Math.round(dir) + '\u00B0']);
			return rows;
		} catch { return []; }
	};

	// Throttled background refresh of feature snap candidates near the cursor. Runs
	// the async layer-view query at most ~16/sec, trims results to segments within a
	// small radius of the cursor (so the synchronous snap stays cheap), and stores
	// them for _snapMapPoint to consume. Never redraws — the move handler draws once.
	private _refreshFeatCache = (view: any, rawPt: number[]) => {
		const now = Date.now();
		if (this._previewSnapInFlight || (now - this._previewSnapLastTs) < 80) return;
		const so: any = this.sketchViewModel?.snappingOptions || (view as any)?.snappingOptions;
		if (!so?.enabled || so.featureEnabled === false) { this._snapFeatSegs = []; this._snapFeatPts = []; return; }
		const sr = view.spatialReference;
		const tolPx = (typeof so.distance === 'number' && so.distance > 0) ? so.distance : 15;
		const tolMap = tolPx * (view.resolution || 0);
		if (tolMap <= 0) return;
		this._previewSnapInFlight = true; this._previewSnapLastTs = now;
		const keep = 3 * tolMap; // retain only segments within ~3x tolerance of the cursor
		const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
			const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay, L = vx * vx + vy * vy;
			let t = L > 0 ? (wx * vx + wy * vy) / L : 0; t = t < 0 ? 0 : (t > 1 ? 1 : t);
			return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
		};
		const ext = new Extent({ xmin: rawPt[0] - tolMap, ymin: rawPt[1] - tolMap, xmax: rawPt[0] + tolMap, ymax: rawPt[1] + tolMap, spatialReference: sr });
		const lvs = (view.allLayerViews?.toArray?.() || []).filter((lv: any) =>
			lv?.layer && lv.layer !== this.drawLayer && lv.visible !== false && typeof lv.queryFeatures === 'function');
		Promise.all(lvs.map(async (lv: any) => {
			try {
				const r = await lv.queryFeatures({ geometry: ext, spatialRelationship: 'intersects', returnGeometry: true, outFields: [], outSpatialReference: sr });
				return r?.features || [];
			} catch { return []; }
		})).then((groups: any[]) => {
			const segs: number[][] = []; const pts: number[][] = [];
			for (const feats of groups) for (const f of feats) {
				const g: any = f.geometry; if (!g) continue;
				if (g.type === 'point') { if (Math.hypot(rawPt[0] - g.x, rawPt[1] - g.y) < keep) pts.push([g.x, g.y]); continue; }
				const rings = g.rings || g.paths; if (!Array.isArray(rings)) continue;
				for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) {
					const a = ring[i], b = ring[i + 1];
					if (segDist(rawPt[0], rawPt[1], a[0], a[1], b[0], b[1]) < keep) segs.push([a[0], a[1], b[0], b[1]]);
				}
			}
			this._previewSnapInFlight = false;
			// Ignore a transient empty result when the cursor hasn't moved off the
			// previous spot, so a stationary cursor near an edge doesn't blink as the
			// background query races with layer updates.
			if (segs.length === 0 && pts.length === 0 && this._snapCacheAt &&
				Math.hypot(rawPt[0] - this._snapCacheAt[0], rawPt[1] - this._snapCacheAt[1]) < tolMap) {
				return;
			}
			this._snapFeatSegs = segs; this._snapFeatPts = pts; this._snapCacheAt = rawPt;
		}).catch(() => { this._previewSnapInFlight = false; });
	};

	startCurveTool = (type: 'arc' | 'endpointArc' | 'bezier') => {
		try { this.setDrawToolBtnState('' as any); } catch { }
		try { this.sketchViewModel?.cancel(); } catch { }
		this._deactivateCurveHandles();
		this._clearCurvePreview();
		const view = this.state.currentJimuMapView?.view;
		if (!view) { console.warn('Curve tool: no map view'); return; }
		this._curveType = type;
		this._resetCurvePath();
		this.setState({ curveToolActive: true, showCurveMenu: false, currentTool: type as any, curveHint: this._curveHintText(), showSymPreview: true, currentSymbolType: JimuSymbolType.Polyline });
		this._activateCurveCapture(view);
	};

	private _resetCurvePath = () => {
		this._clearSnapIndicator();
		this._curvePathStart = null;
		this._curveStart = null;
		this._curveSegs = [];
		this._curvePending = [];
	};

	// Clicks needed to COMPLETE one segment once its start vertex is known.
	private _segClicksNeeded = (): number => (this._curveType === 'bezier' ? 3 : 2);

	// Plain-language, step-numbered instructions for non-GIS users (mirrors the
	// Esri "ABCs" model). Switches to "continue" wording after the first segment.
	// Capitalize the first word after each ": " in on-map hint text.
	private _capAfterColons = (s: string): string => s.replace(/:(\s+)([a-z])/g, (_m, sp, c) => ':' + sp + c.toUpperCase());
	private _curveHintRaw = (): string => {
		const t = this._curveType;
		const started = this._curvePathStart !== null;
		const p = this._curvePending.length;
		const canFinish = this._curveSegs.length > 0;
		const recovery = (started ? '   •   Backspace: Undo Last Point' : '') + (canFinish ? '   •   Double-click: finish' : '') + '   •   Esc: cancel';
		if (t === 'arc') {
			if (!started) return 'Arc — Step 1 of 3: click where the curve starts' + recovery;
			if (p === 0) return (canFinish ? 'Add another arc: click a point on the curve' : 'Step 2 of 3: click a point on the curve (the bump)') + recovery;
			return (canFinish ? 'Now click where this arc ends' : 'Step 3 of 3: click where the curve ends') + recovery;
		}
		if (t === 'endpointArc') {
			if (!started) return 'Endpoint arc — Step 1 of 3: click where the curve starts' + recovery;
			if (p === 0) return (canFinish ? 'Add another arc: click where it ends' : 'Step 2 of 3: click where the curve ends') + recovery;
			return 'Step 3 of 3: move in or out to bend it, then click' + recovery;
		}
		// bezier
		if (!started) return 'Bézier curve — Step 1 of 4: click the start point' + recovery;
		if (p === 0) return (canFinish ? 'Add another curve: click its end point' : 'Step 2 of 4: click the end point') + recovery;
		if (p === 1) return 'Step 3 of 4: click to pull the curve near the start' + recovery;
		return 'Step 4 of 4: click to pull the curve near the end' + recovery;
	};

	private _curveHintText = (): string => this._capAfterColons(this._curveHintRaw());
	private _updateCurveHint = () => { this.setState({ curveHint: this._curveHintText() }); };

	private _activateCurveCapture = (view: any) => {
		this._deactivateCurveHandles();
		if (this._curvePrevPopup === null) this._curvePrevPopup = view.popupEnabled;
		try { view.popupEnabled = false; } catch { }
		if (view.container) view.container.style.cursor = 'crosshair';

		const clickH = view.on('click', (evt: any) => {
			evt.stopPropagation();
			const mp = evt.mapPoint;
			if (!mp) return;
			this._onCurveClick(view, [mp.x, mp.y]);
		});
		const moveH = view.on('pointer-move', (evt: any) => {
			const mp = view.toMap({ x: evt.x, y: evt.y });
			if (!mp) return;
			const raw: number[] = [mp.x, mp.y];
			this._refreshFeatCache(view, raw);                 // throttled background update
			const snapped = this._snapMapPoint(view, raw);     // synchronous
			const didSnap = snapped !== raw;
			this._updateSnapIndicator(view, didSnap ? snapped : null);
			if (this._curvePathStart !== null) this._updateCurvePreview(view, snapped); // single draw
			if (this._tooltipsOn() && this._curvePathStart !== null) {
				this._updateCursorTip(view, evt.x, evt.y, this._curveTipText(view, snapped));
			} else this._hideCursorTip();
		});
		const keyH = view.on('key-down', (evt: any) => {
			if (evt.key === 'Escape') {
				evt.stopPropagation();
				if (this._curvePathStart !== null) this._cancelCurvePath(view); else this._deactivateCurveTool();
			} else if (evt.key === 'Enter') {
				evt.stopPropagation();
				this._finishCurve(view);
			} else if (evt.key === 'Backspace' || evt.key === 'Delete') {
				evt.stopPropagation();
				if (this._curvePathStart !== null) this._undoCurvePoint(view);
			}
		});
		// Double-click finishes the path. The click pair only feeds the in-progress
		// (incomplete) segment, which finish discards — committed segments are safe.
		const dblH = view.on('double-click', (evt: any) => { evt.stopPropagation(); this._finishCurve(view); });
		this._curveHandles.push(clickH, moveH, keyH, dblH);
	};

	private _onCurveClick = async (view: any, mp: number[]) => {
		mp = await this._snapMapPoint(view, mp);
		if (this._curvePathStart === null) {
			this._curvePathStart = mp;
			this._curveStart = mp;
			this._updateCurveHint();
			return;
		}
		this._curvePending.push(mp);
		if (this._curvePending.length >= this._segClicksNeeded()) {
			const made = this._makeSegment(this._curveStart as number[], this._curvePending);
			if (made) { this._curveSegs.push(made.seg); this._curveStart = made.endVertex; }
			this._curvePending = [];
			this._renderCurvePreview(view, null); // redraw committed path without cursor
		}
		this._updateCurveHint();
	};

	// Build one curvePaths segment from its start vertex and the clicks for it.
	private _makeSegment = (start: number[], pending: number[][]): { seg: any, endVertex: number[] } | null => {
		const t = this._curveType;
		try {
			if (t === 'bezier') {
				const end = pending[0], c1 = pending[1], c2 = pending[2];
				return { seg: { b: [end, c1, c2] }, endVertex: end };
			}
			if (t === 'endpointArc') {
				const end = pending[0], radius = pending[1];
				const apex = this._endpointArcInterior(start, end, radius);
				return { seg: apex ? { c: [end, apex] } : end, endVertex: end };
			}
			const through = pending[0], end = pending[1]; // arc
			return { seg: { c: [end, through] }, endVertex: end };
		} catch (e) { console.warn('curve segment build warning:', e); return null; }
	};

	// End vertex of a committed segment (arc/endpointArc -> c[0], bezier -> b[0],
	// straight -> the point itself). Used to rewind _curveStart on undo.
	private _segEndVertex = (seg: any): number[] | null => {
		if (Array.isArray(seg)) return seg;
		if (seg?.c) return seg.c[0];
		if (seg?.b) return seg.b[0];
		return null;
	};

	// Undo the last click: drop an in-progress point, else the last committed
	// segment, else the start point. Gives non-GIS users a simple "oops" recovery.
	private _undoCurvePoint = (view: any) => {
		if (this._curvePending.length > 0) {
			this._curvePending.pop();
		} else if (this._curveSegs.length > 0) {
			this._curveSegs.pop();
			const last = this._curveSegs[this._curveSegs.length - 1];
			this._curveStart = last ? (this._segEndVertex(last) || (this._curvePathStart as number[])) : (this._curvePathStart as number[]);
		} else if (this._curvePathStart !== null) {
			this._curvePathStart = null;
			this._curveStart = null;
		}
		this._renderCurvePreview(view, null);
		this._updateCurveHint();
	};

	private _curveLineSymbol = (): any => {
		try { const base = (this.sketchViewModel?.polylineSymbol as any); if (base?.clone) return base.clone(); } catch { }
		return new SimpleLineSymbol({ color: [0, 0, 0, 1], width: 2, style: 'solid' });
	};

	private _curveSR = (view: any): any => (view.spatialReference?.toJSON ? view.spatialReference.toJSON() : view.spatialReference);

	// Endpoint arc: derive the symmetric apex (midpoint of the arc) from the
	// perpendicular offset of the radius click off the start->end chord. That
	// offset is the sagitta, so moving the cursor perpendicular dials the radius.
	// Returns null when the chord is degenerate or the offset is ~0 (draw straight).
	private _endpointArcInterior = (sPt: number[], ePt: number[], cPt: number[]): number[] | null => {
		const dx = ePt[0] - sPt[0], dy = ePt[1] - sPt[1];
		const Ld = Math.hypot(dx, dy);
		if (Ld < 1e-6) return null;
		const nx = -dy / Ld, ny = dx / Ld;
		const mx = (sPt[0] + ePt[0]) / 2, my = (sPt[1] + ePt[1]) / 2;
		const h = (cPt[0] - mx) * nx + (cPt[1] - my) * ny;
		if (Math.abs(h) < Ld * 1e-3) return null;
		return [mx + nx * h, my + ny * h];
	};

	// Assemble the full curvePaths path: committed segments, optionally plus the
	// in-progress segment using the live cursor.
	private _curvePathJSON = (cursor: number[] | null): any[] | null => {
		if (this._curvePathStart === null) return null;
		const path: any[] = [this._curvePathStart, ...this._curveSegs];
		if (cursor) {
			const t = this._curveType;
			const start = this._curveStart as number[];
			const p = this._curvePending;
			if (t === 'arc') {
				if (p.length === 0) path.push(cursor);            // roaming through/end candidate
				else path.push({ c: [cursor, p[0]] });            // through fixed, end = cursor
			} else if (t === 'endpointArc') {
				if (p.length === 0) path.push(cursor);            // roaming end candidate
				else { const apex = this._endpointArcInterior(start, p[0], cursor); path.push(apex ? { c: [p[0], apex] } : p[0]); }
			} else { // bezier
				if (p.length === 0) path.push(cursor);            // roaming end candidate
				else if (p.length === 1) path.push(p[0]);         // end fixed; placing controls -> straight preview
				else path.push({ b: [p[0], p[1], cursor] });      // end,c1 fixed; c2 = cursor
			}
		}
		return path;
	};

	private _buildCurveGeometry = (view: any, cursor: number[] | null): any => {
		const sr = this._curveSR(view);
		const path = this._curvePathJSON(cursor);
		if (!path || path.length < 2) return null;
		const hasCurve = path.some(el => !Array.isArray(el) && typeof el === 'object');
		try {
			return hasCurve
				? PolylineCompat.fromJSON({ curvePaths: [path], spatialReference: sr })
				: PolylineCompat.fromJSON({ paths: [path], spatialReference: sr });
		} catch (e) {
			console.warn('curve geometry build warning:', e);
			try { return PolylineCompat.fromJSON({ paths: [path.filter(Array.isArray)], spatialReference: sr }); } catch { return null; }
		}
	};

	private _renderCurvePreview = (view: any, cursor: number[] | null) => {
		try {
			const geom = this._buildCurveGeometry(view, cursor);
			if (!geom) return;
			const sym = this._curveLineSymbol();
			if (!this._curvePreview) {
				this._curvePreview = new Graphic({ geometry: geom, symbol: sym, attributes: { hideFromList: true, isPreviewBuffer: true } });
				this.drawLayer.add(this._curvePreview);
			} else { this._curvePreview.geometry = geom; this._curvePreview.symbol = sym; }
		} catch { /* preview best-effort */ }
	};

	private _updateCurvePreview = (view: any, cursor: number[]) => { this._renderCurvePreview(view, cursor); this._livePreviewMeasure(this._curvePreview); };

	private _finishCurve = async (view: any) => {
		if (this._curveSegs.length === 0) { this._cancelCurvePath(view); return; }
		const sr = this._curveSR(view);
		const path = [this._curvePathStart, ...this._curveSegs];
		this._clearCurvePreview();

		let graphic: any = null;
		try {
			const hasCurve = path.some(el => !Array.isArray(el) && typeof el === 'object');
			const geom = hasCurve
				? PolylineCompat.fromJSON({ curvePaths: [path], spatialReference: sr })
				: PolylineCompat.fromJSON({ paths: [path], spatialReference: sr });
			graphic = new Graphic({ geometry: geom, symbol: this._curveLineSymbol() });
			this.drawLayer.add(graphic);
		} catch (e) { console.error('Curve build failed:', e); this._resetCurvePath(); return; }

		try {
			this.setState({ currentTool: (this._curveType || 'arc') as any });
			await this.svmGraCreate({ state: 'complete', graphic });
		} catch (e) { console.warn('Curve finalize warning:', e); }

		// #3: measurement labels normally come from measure.tsx's SVM 'create'
		// listener; curves bypass SketchViewModel.create(), so trigger them now
		// that the graphic has a stable uniqueId from svmGraCreate.
		try {
			if (this.measureRef?.current?.isMeasurementEnabled?.()) {
				this.measureRef.current.updateMeasurementsForGraphic(graphic);
			}
		} catch (e) { console.warn('Curve measurement warning:', e); }

		// Custom tools bypass the SVM 'create' event, so tell BufferControls to
		// auto-buffer this new graphic if the buffer toggle is on.
		try { window.dispatchEvent(new CustomEvent('drawadv:bufferNewGraphic', { detail: { graphic } })); } catch { }

		this._resetCurvePath();
		if (this.creationMode === 'continuous' && this.state.curveToolActive) {
			this.setState({ curveHint: this._curveHintText() }); // keep drawing the next curve
		} else {
			this._deactivateCurveTool();
		}
	};

	// Finish button = explicit "done": commit the current path, then exit the tool
	// and hide the help banner (unlike Enter/double-click which keep drawing).
	private _finishCurveButton = async (view: any) => {
		try { await this._finishCurve(view); } catch { }
		this._deactivateCurveTool();
	};

	private _cancelCurvePath = (view: any) => {
		this._clearCurvePreview();
		this._resetCurvePath();
		if (view?.container) view.container.style.cursor = 'crosshair';
		this._updateCurveHint();
	};

	private _clearCurvePreview = () => {
		this._hideCursorTip();
		if (this._curvePreview) { this._clearPreviewMeasure(this._curvePreview); try { this.drawLayer.remove(this._curvePreview); } catch { } this._curvePreview = null; }
	};

	private _deactivateCurveHandles = () => {
		for (const h of this._curveHandles) { try { h.remove(); } catch { } }
		this._curveHandles = [];
	};

	private _deactivateCurveTool = () => {
		this._deactivateCurveHandles();
		this._clearCurvePreview();
		this._clearCursorTip();
		this._resetCurvePath();
		this._curveType = null;
		const view = this.state.currentJimuMapView?.view;
		if (view) {
			if (view.container) view.container.style.cursor = 'default';
			if (this._curvePrevPopup !== null) { try { view.popupEnabled = this._curvePrevPopup; } catch { } }
		}
		this._curvePrevPopup = null;
		if (this.state.curveToolActive || this.state.curveHint) this.setState({ curveToolActive: false, curveHint: '', showSymPreview: false, currentSymbolType: null });
	};

	// ── Custom equilateral-triangle tool ────────────────────────────────────
	// JSAPI 5.0 SketchViewModel has no triangle primitive (the old Web AppBuilder
	// Draw.TRIANGLE did). Build an equilateral triangle from a center click + a
	// vertex click (sets size and rotation), then finalize through svmGraCreate so
	// it gets naming, measurement labels, and save like every other shape.
	startTriangleTool = () => {
		try { this.setDrawToolBtnState('' as any); } catch { }
		try { this.sketchViewModel?.cancel(); } catch { }
		this._deactivateTriHandles();
		this._clearTriPreview();
		const view = this.state.currentJimuMapView?.view;
		if (!view) { console.warn('Triangle tool: no map view'); return; }
		this._triCenter = null;
		this.setState({ triangleActive: true, showCurveMenu: false, currentTool: 'triangle' as any, triangleHint: this._triHintText(), showSymPreview: true, currentSymbolType: JimuSymbolType.Polygon });
		this._activateTriangleCapture(view);
	};

	private _triHintText = (): string => this._capAfterColons(this._triCenter === null
		? 'Triangle: click the center point   •   Esc to cancel'
		: 'Click to set the size and rotation   •   Esc to cancel');
	private _updateTriHint = () => { this.setState({ triangleHint: this._triHintText() }); };

	private _triFillSymbol = (): any => {
		try { const base = (this.sketchViewModel?.polygonSymbol as any); if (base?.clone) return base.clone(); } catch { }
		return new SimpleFillSymbol({ color: [0, 0, 0, 0.15], outline: { color: [0, 0, 0, 1], width: 2 } });
	};

	// Equilateral triangle: center C, first vertex V (size + rotation). Other two
	// vertices are V rotated 120° and 240° about C.
	private _buildTriangle = (view: any, center: number[], vertex: number[]): any => {
		const sr = view.spatialReference?.toJSON ? view.spatialReference.toJSON() : view.spatialReference;
		const dx = vertex[0] - center[0], dy = vertex[1] - center[1];
		const R = Math.hypot(dx, dy);
		if (R < 1e-6) return null;
		const a0 = Math.atan2(dy, dx);
		const pts = [0, 2 * Math.PI / 3, 4 * Math.PI / 3].map(a => [center[0] + R * Math.cos(a0 + a), center[1] + R * Math.sin(a0 + a)]);
		// ArcGIS exterior rings must wind clockwise so the polygon area is positive;
		// the equilateral points above are counter-clockwise (negative area, which
		// breaks the measurement label), so flip to clockwise when needed.
		const cross = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]);
		if (cross > 0) pts.reverse();
		pts.push([pts[0][0], pts[0][1]]);
		try { return PolygonCompat.fromJSON({ rings: [pts], spatialReference: sr }); }
		catch (e) { console.warn('triangle build warning:', e); return null; }
	};

	private _activateTriangleCapture = (view: any) => {
		this._deactivateTriHandles();
		if (this._triPrevPopup === null) this._triPrevPopup = view.popupEnabled;
		try { view.popupEnabled = false; } catch { }
		if (view.container) view.container.style.cursor = 'crosshair';
		const clickH = view.on('click', (evt: any) => {
			evt.stopPropagation();
			const mp = evt.mapPoint; if (!mp) return;
			const raw: number[] = [mp.x, mp.y];
			// Defer the single click briefly so a double-click can cancel it.
			// ArcGIS fires click(s) AND double-click; without this, the trailing
			// clicks of a double-click create phantom centers / extra triangles.
			if (this._triClickTimer) { clearTimeout(this._triClickTimer); this._triClickTimer = null; }
			this._triClickTimer = setTimeout(async () => {
				this._triClickTimer = null;
				if (this._triCenter === null) { this._triCenter = await this._snapMapPoint(view, raw); this._updateTriHint(); }
				else { this._finishTriangle(view, raw); }
			}, 220);
		});
		const moveH = view.on('pointer-move', (evt: any) => {
			const mp = view.toMap({ x: evt.x, y: evt.y }); if (!mp) return;
			const raw: number[] = [mp.x, mp.y];
			if (this._triCenter === null) {
				// Placing the center: snap it (and show the indicator) so the triangle
				// can start on a feature or existing vertex.
				this._refreshFeatCache(view, raw);
				const snapped = this._snapMapPoint(view, raw);
				this._updateSnapIndicator(view, snapped !== raw ? snapped : null);
				return;
			}
			// Sizing: use the raw cursor for the size vertex. Snapping it would resize
			// the whole triangle as the target shifts, which reads as jitter.
			this._updateSnapIndicator(view, null);
			const geom = this._buildTriangle(view, this._triCenter, raw); if (!geom) return;
			if (!this._triPreview) { this._triPreview = new Graphic({ geometry: geom, symbol: this._triFillSymbol(), attributes: { hideFromList: true, isPreviewBuffer: true } }); this.drawLayer.add(this._triPreview); }
			else { this._triPreview.geometry = geom; }
			this._livePreviewMeasure(this._triPreview);
			if (this._tooltipsOn()) this._updateCursorTip(view, evt.x, evt.y, this._triTipText(view, raw, geom));
			else this._hideCursorTip();
		});
		const keyH = view.on('key-down', (evt: any) => { if (evt.key === 'Escape') { evt.stopPropagation(); this._deactivateTriangleTool(); } });
		// Double-click: cancel the pending single click and act once (set center or
		// finish), and suppress the default map zoom.
		const dblH = view.on('double-click', async (evt: any) => {
			evt.stopPropagation();
			if (this._triClickTimer) { clearTimeout(this._triClickTimer); this._triClickTimer = null; }
			const mp = evt.mapPoint; if (!mp) return;
			const raw: number[] = [mp.x, mp.y];
			if (this._triCenter === null) { this._triCenter = await this._snapMapPoint(view, raw); this._updateTriHint(); }
			else { this._finishTriangle(view, raw); }
		});
		this._triHandles.push(clickH, moveH, keyH, dblH);
	};

	private _finishTriangle = async (view: any, vertex: number[]) => {
		if (this._triClickTimer) { clearTimeout(this._triClickTimer); this._triClickTimer = null; }
		const center = this._triCenter;
		this._clearTriPreview();
		if (!center) { this._deactivateTriangleTool(); return; }
		let graphic: any = null;
		try {
			const geom = this._buildTriangle(view, center, vertex);
			if (!geom) { this._triCenter = null; return; }
			graphic = new Graphic({ geometry: geom, symbol: this._triFillSymbol() });
			this.drawLayer.add(graphic);
		} catch (e) { console.error('Triangle build failed:', e); this._triCenter = null; return; }
		try { this.setState({ currentTool: 'triangle' as any }); await this.svmGraCreate({ state: 'complete', graphic }); }
		catch (e) { console.warn('Triangle finalize warning:', e); }
		try { if (this.measureRef?.current?.isMeasurementEnabled?.()) this.measureRef.current.updateMeasurementsForGraphic(graphic); }
		catch (e) { console.warn('Triangle measurement warning:', e); }
		try { window.dispatchEvent(new CustomEvent('drawadv:bufferNewGraphic', { detail: { graphic } })); } catch { }
		this._triCenter = null;
		if (this.creationMode === 'continuous' && this.state.triangleActive) { this.setState({ triangleHint: this._triHintText() }); }
		else { this._deactivateTriangleTool(); }
	};

	private _clearTriPreview = () => { this._hideCursorTip(); this._clearSnapIndicator(); if (this._triPreview) { this._clearPreviewMeasure(this._triPreview); try { this.drawLayer.remove(this._triPreview); } catch { } this._triPreview = null; } };
	private _deactivateTriHandles = () => { for (const h of this._triHandles) { try { h.remove(); } catch { } } this._triHandles = []; };

	// ---------------------------------------------------------------------
	// Live measurement for custom-tool previews (triangle, curves, preset
	// circle). These tools bypass SketchViewModel.create(), so measure.tsx's
	// SVM 'create' listener never fires during the draw — only at finish via
	// svmGraCreate. Feeding the preview graphic through the same imperative
	// entry point gives it the identical live pipeline (main label + segment
	// labels) SVM-drawn shapes get.
	private _livePreviewMeasure = (preview: any) => {
		try {
			if (preview && this.measureRef?.current?.isMeasurementEnabled?.()) {
				this.measureRef.current.updateMeasurementsForGraphic(preview);
			}
		} catch { /* no-op */ }
	};

	// Remove the live labels a preview accumulated BEFORE the preview graphic
	// itself is removed (finish, cancel, Esc) — otherwise they orphan as
	// ghosts, since the preview never goes through complete-time cleanup.
	private _clearPreviewMeasure = (preview: any) => {
		if (!preview || !this.drawLayer) return;
		try {
			if (preview.measure?.graphic) {
				try { this.drawLayer.remove(preview.measure.graphic); } catch { /* no-op */ }
				preview.measure = null;
			}
			const segs = preview.attributes?.relatedSegmentLabels;
			if (Array.isArray(segs)) {
				segs.forEach((sl: any) => { try { if (sl) this.drawLayer.remove(sl); } catch { /* no-op */ } });
				preview.attributes.relatedSegmentLabels = [];
			}
			const mains = preview.attributes?.relatedMeasurementLabels;
			if (Array.isArray(mains)) {
				mains.forEach((ml: any) => { try { if (ml) this.drawLayer.remove(ml); } catch { /* no-op */ } });
				preview.attributes.relatedMeasurementLabels = [];
			}
		} catch { /* no-op */ }
	};
	private _deactivateTriangleTool = () => {
		if (this._triClickTimer) { clearTimeout(this._triClickTimer); this._triClickTimer = null; }
		this._deactivateTriHandles();
		this._clearTriPreview();
		this._clearCursorTip();
		this._triCenter = null;
		const view = this.state.currentJimuMapView?.view;
		if (view) { if (view.container) view.container.style.cursor = 'default'; if (this._triPrevPopup !== null) { try { view.popupEnabled = this._triPrevPopup; } catch { } } }
		this._triPrevPopup = null;
		if (this.state.triangleActive || this.state.triangleHint) this.setState({ triangleActive: false, triangleHint: '', showSymPreview: false, currentSymbolType: null });
	};

	// ---------------------------------------------------------------------
	// Preset Circle Size: one click places a circle of an exact radius or
	// area (like pre-set circle tools in other GIS viewers). Off by default;
	// toggled from the panel shown while the circle tool is active. Follows
	// the triangle tool's pattern: custom view handlers build the geometry,
	// then the graphic is finalized through the same completion path as a
	// SketchViewModel-created circle.
	// ---------------------------------------------------------------------
	private _cpRadiusMeters = (): number | null => {
		const value = this.state.circlePresetValue;
		if (typeof value !== 'number' || !isFinite(value) || value <= 0) return null;
		const unit = this.state.circlePresetUnit || 'feet';
		if ((this.state.circlePresetMode || 'radius') === 'radius') {
			const toMeters: { [k: string]: number } = { 'feet': 0.3048, 'yards': 0.9144, 'meters': 1, 'kilometers': 1000, 'miles': 1609.344 };
			const f = toMeters[unit]; if (!f) return null;
			return value * f;
		}
		const toSqMeters: { [k: string]: number } = { 'acres': 4046.8564224, 'square-feet': 0.09290304, 'square-meters': 1, 'hectares': 10000, 'square-kilometers': 1000000, 'square-miles': 2589988.110336 };
		const f = toSqMeters[unit]; if (!f) return null;
		return Math.sqrt((value * f) / Math.PI);
	};

	private _cpUnitAbbr = (): string => {
		const unit = this.state.circlePresetUnit || 'feet';
		const abbr: { [k: string]: string } = { 'feet': 'ft', 'yards': 'yd', 'meters': 'm', 'kilometers': 'km', 'miles': 'mi', 'acres': 'ac', 'square-feet': 'ft²', 'square-meters': 'm²', 'hectares': 'ha', 'square-kilometers': 'km²', 'square-miles': 'mi²' };
		return abbr[unit] || unit;
	};

	private _cpFillSymbol = (): any => {
		try { const base = (this.sketchViewModel?.polygonSymbol as any); if (base?.clone) return base.clone(); } catch { }
		return new SimpleFillSymbol({ color: [0, 0, 0, 0.15], outline: { color: [0, 0, 0, 1], width: 2 } });
	};

	// 60 points matches SketchViewModel circles (61-point closed ring), so the
	// measurement system recognizes the result as a circle and shows its radius.
	private _buildPresetCircle = (view: any, center: number[]): any => {
		const radius = this._cpRadiusMeters();
		if (!radius) return null;
		try {
			const sr = view.spatialReference;
			const pt = new Point({ x: center[0], y: center[1], spatialReference: sr });
			const geodesic = !!(sr?.isGeographic || sr?.isWebMercator);
			return new Circle({ center: pt, radius, radiusUnit: 'meters', numberOfPoints: 60, geodesic, spatialReference: sr });
		} catch (e) { console.warn('Preset circle build warning:', e); return null; }
	};

	private _setCirclePresetEnabled = (val: boolean) => {
		this.setState({ circlePresetEnabled: val });
		if (!this.state.circleBtnActive) return;
		const view = this.state.currentJimuMapView?.view;
		if (val) {
			try { this.sketchViewModel?.cancel(); } catch { }
			if (view) this._activateCirclePreset(view);
		} else {
			this._deactivateCirclePreset();
			try { this.sketchViewModel?.create('circle'); } catch { }
		}
	};

	private _setCirclePresetMode = (mode: 'radius' | 'area') => {
		this.setState({ circlePresetMode: mode, circlePresetUnit: mode === 'radius' ? 'feet' : 'acres' });
	};

	private _activateCirclePreset = (view: any) => {
		this._deactivateCpHandles();
		if (this._cpPrevPopup === null) this._cpPrevPopup = view.popupEnabled;
		try { view.popupEnabled = false; } catch { }
		if (view.container) view.container.style.cursor = 'crosshair';
		const clickH = view.on('click', (evt: any) => {
			evt.stopPropagation();
			const mp = evt.mapPoint; if (!mp) return;
			const raw: number[] = [mp.x, mp.y];
			// Defer the single click briefly so a double-click places one circle,
			// not two (ArcGIS fires click(s) AND double-click). Same pattern as
			// the triangle tool.
			if (this._cpClickTimer) { clearTimeout(this._cpClickTimer); this._cpClickTimer = null; }
			this._cpClickTimer = setTimeout(() => { this._cpClickTimer = null; this._finishPresetCircle(view, raw); }, 220);
		});
		const moveH = view.on('pointer-move', (evt: any) => {
			const mp = view.toMap({ x: evt.x, y: evt.y }); if (!mp) return;
			const raw: number[] = [mp.x, mp.y];
			this._refreshFeatCache(view, raw);
			const snapped = this._snapMapPoint(view, raw);
			this._updateSnapIndicator(view, snapped !== raw ? snapped : null);
			const geom = this._buildPresetCircle(view, snapped);
			if (!geom) { this._clearCpPreview(); return; }
			if (!this._cpPreview) { this._cpPreview = new Graphic({ geometry: geom, symbol: this._cpFillSymbol(), attributes: { hideFromList: true, isPreviewBuffer: true, drawMode: 'circle', circleRadiusMeters: this._cpRadiusMeters() } }); this.drawLayer.add(this._cpPreview); }
			else { this._cpPreview.geometry = geom; if (this._cpPreview.attributes) this._cpPreview.attributes.circleRadiusMeters = this._cpRadiusMeters(); }
			this._livePreviewMeasure(this._cpPreview);
			if (this._tooltipsOn()) {
				const modeLabel = (this.state.circlePresetMode || 'radius') === 'radius' ? 'Radius' : 'Area';
				this._updateCursorTip(view, evt.x, evt.y, [[modeLabel, `${this.state.circlePresetValue ?? ''} ${this._cpUnitAbbr()}`]]);
			} else this._hideCursorTip();
		});
		const keyH = view.on('key-down', (evt: any) => { if (evt.key === 'Escape') { evt.stopPropagation(); this.setDrawToolBtnState(''); } });
		const dblH = view.on('double-click', (evt: any) => {
			evt.stopPropagation();
			if (this._cpClickTimer) { clearTimeout(this._cpClickTimer); this._cpClickTimer = null; }
			const mp = evt.mapPoint; if (!mp) return;
			this._finishPresetCircle(view, [mp.x, mp.y]);
		});
		this._cpHandles.push(clickH, moveH, keyH, dblH);
	};

	private _finishPresetCircle = async (view: any, centerRaw: number[]) => {
		let graphic: any = null;
		try {
			const center = this._snapMapPoint(view, centerRaw);
			const geom = this._buildPresetCircle(view, center);
			if (!geom) return;
			// Carry the exact entered radius so measurement labels report the TRUE
			// circle (see preset-circle accuracy note in measure.tsx) rather than
			// measuring the 60-point polygon approximation. Persisted with the
			// graphic's attributes, so saved/reloaded circles keep exact labels.
			graphic = new Graphic({ geometry: geom, symbol: this._cpFillSymbol(), attributes: { circleRadiusMeters: this._cpRadiusMeters() } });
			this.drawLayer.add(graphic);
		} catch (e) { console.error('Preset circle build failed:', e); return; }
		try { await this.svmGraCreate({ state: 'complete', graphic }); }
		catch (e) { console.warn('Preset circle finalize warning:', e); }
		try { if (this.measureRef?.current?.isMeasurementEnabled?.()) this.measureRef.current.updateMeasurementsForGraphic(graphic); }
		catch (e) { console.warn('Preset circle measurement warning:', e); }
		try { window.dispatchEvent(new CustomEvent('drawadv:bufferNewGraphic', { detail: { graphic } })); } catch { }
		this._clearCpPreview();
		if (this.creationMode !== 'continuous') this.setDrawToolBtnState('');
	};

	private _clearCpPreview = () => { this._hideCursorTip(); this._clearSnapIndicator(); if (this._cpPreview) { this._clearPreviewMeasure(this._cpPreview); try { this.drawLayer.remove(this._cpPreview); } catch { } this._cpPreview = null; } };
	private _deactivateCpHandles = () => { for (const h of this._cpHandles) { try { h.remove(); } catch { } } this._cpHandles = []; };
	private _deactivateCirclePreset = () => {
		if (this._cpClickTimer) { clearTimeout(this._cpClickTimer); this._cpClickTimer = null; }
		this._deactivateCpHandles();
		this._clearCpPreview();
		this._clearCursorTip();
		const view = this.state.currentJimuMapView?.view;
		if (view) { if (view.container) view.container.style.cursor = 'default'; if (this._cpPrevPopup !== null) { try { view.popupEnabled = this._cpPrevPopup; } catch { } } }
		this._cpPrevPopup = null;
	};

	svmGraCreate = async (evt) => {
		try {
			// Basic validation
			if (!evt || !evt.graphic) return;

			const g = evt.graphic;

			// ---- START STATE: User began drawing ----
			if (evt.state === 'start') {
				this.setState({ isActivelyDrawing: true });
				window.dispatchEvent(new CustomEvent('drawWidget:drawingModeChanged', {
					detail: { active: true }
				}));
				return;
			}

			// ---- ACTIVE STATE: Show live measurements during drawing ----
			if (evt.state === 'active') {
				// Update live measurements if the measurement system is enabled
				if (this.measureRef?.current) {
					try {
						await this.measureRef.current.updateMeasurementsForGraphic(g);
					} catch (error) {
						console.warn('Error updating live measurements:', error);
					}
				}
				return; // Exit early for active state
			}

			// ---- CANCEL STATE: User aborted drawing ----
			if (evt.state === 'cancel') {
				this.setState({ isActivelyDrawing: false });
				window.dispatchEvent(new CustomEvent('drawWidget:drawingModeChanged', {
					detail: { active: false }
				}));
				return;
			}

			// ---- COMPLETE STATE: Finalize the drawing ----
			if (evt.state !== 'complete') return;

			// ---- 1) Initialize base attributes immediately (before any async) ----
			g.attributes = g.attributes || {};
			if (!g.attributes.uniqueId) {
				g.attributes.uniqueId = `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			}
			g.attributes.isDrawing = true;       // important: prevents measurement cleanup from touching parents
			g.attributes.hideFromList = false;   // ensure it shows in My Drawings
			g.attributes.drawMode = this.state.currentTool;
			g.attributes.createdDate = Date.now();

			// Name after current tool; index will be refined after we ensure layer presence
			g.attributes.name = `${this.state.currentTool} ${this.drawLayer.graphics.length + 1}`;

			// ---- 2) Ensure visibility and layer membership (prevents "exists but not shown") ----
			if (g.visible === false) g.visible = true;

			// SketchViewModel normally adds it, but re-assert to be safe
			if (!this.drawLayer.graphics?.includes?.(g)) {
				try { this.drawLayer.add(g); } catch { /* no-op */ }
			}

			// Give the layer a render turn (prevents race with measurement code)
			const v = this.sketchViewModel?.view;
			if (v && typeof v.whenLayerView === 'function') {
				try { await v.whenLayerView(this.drawLayer); } catch { /* no-op */ }
			}
			await new Promise(r => requestAnimationFrame(() => r(null)));

			// ---- 3) Apply arrows (if enabled) for polylines ----
			if (this.state.arrowEnabled &&
				g.geometry?.type === 'polyline' &&
				g.symbol?.type === 'simple-line') {
				try {
					const baseSymbol = g.symbol as any;
					const arrowSymbol = this.createLineSymbolWithBuiltInArrows(
						baseSymbol,
						this.state.arrowPosition,
						this.state.arrowSize
					);
					g.symbol = arrowSymbol;
				} catch (e) {
					console.warn('Error applying arrows on create:', e);
				}
			}

			// ---- 4) If text tool, ensure the text symbol is applied now ----
			if (this.state.currentTool === 'text') {
				try {
					g.symbol = this.state.currentTextSymbol.clone();
				} catch (e) {
					console.warn('Failed to apply currentTextSymbol:', e);
				}
			}

			// ---- 5) Update name using regex to find next available number ----
			try {
				const toolName = this.state.currentTool;
				const regex = new RegExp(`^${toolName}\\s+(\\d+)$`, "i");
				const nums = this.drawLayer.graphics.toArray()
					.filter(item =>
						item !== g &&  // Exclude the current graphic being created
						item.attributes &&
						typeof item.attributes.name === "string" &&
						item.attributes.name.toLowerCase().startsWith(toolName) &&
						!item.attributes.isBuffer &&
						!item.attributes.isMeasurementLabel
					)
					.map(item => {
						const match = item.attributes.name.match(regex);
						return match ? parseInt(match[1], 10) : null;
					})
					.filter(num => num !== null);
				const idx = (nums.length ? Math.max(...nums) : 0) + 1;
				// For text drawings, name = the actual text on the map so My Drawings
				// list name always matches the label. Fall back to 'text N' only when
				// the symbol text is empty (user hasn't typed anything yet).
				if (toolName === 'text') {
					const symText = (g.symbol as any)?.text;
					g.attributes.name = (symText && symText.trim()) ? symText.trim() : `text ${idx}`;
				} else {
					g.attributes.name = `${toolName} ${idx}`;
				}
			} catch { /* best effort */ }


			// ---- 6) Persist drawings (deferred a tick) ----
			setTimeout(() => {
				try {
					if (this._drawingMap && g.attributes?.uniqueId) {
						const mainDrawings = this.drawLayer.graphics.toArray().filter(gg =>
							!gg.attributes?.isBuffer &&
							!gg.attributes?.isMeasurementLabel &&
							gg.attributes?.isDrawing === true &&
							gg.attributes?.hideFromList !== true
						);
						this._drawingMap.set(g.attributes.uniqueId, Math.max(0, mainDrawings.indexOf(g)));
					}
					this.handleDrawingsUpdate(this.drawLayer.graphics.toArray());
				} catch (e) {
					console.warn('Error saving drawings after create:', e);
				}
			}, 100);

			// ---- 7) Handle creation mode ----
			if (this.creationMode === 'continuous') {
				switch (this.state.currentTool) {
					case 'extent':
						this.sketchViewModel.create('rectangle');
						break;
					case 'freepolyline':
						this.sketchViewModel.create('polyline', { mode: 'freehand' });
						break;
					case 'polyline':
						this.sketchViewModel.create('polyline');
						break;
					case 'point':
						this.sketchViewModel.create('point');
						break;
					case 'polygon':
						this.sketchViewModel.create('polygon');
						break;
					case 'freepolygon':
						this.sketchViewModel.create('polygon', { mode: 'freehand' });
						break;
					case 'circle':
						// Preset Circle Size keeps its own click capture active in
						// continuous mode; re-arming the SketchViewModel here would take
						// over the next click as a drag-to-size circle and ignore the preset.
						if (!this.state.circlePresetEnabled) this.sketchViewModel.create('circle');
						break;
					case 'text':
						// already applied text symbol above; start a new one
						this.sketchViewModel.create('point');
						break;
					default:
						break;
				}
			} else if (this.creationMode === 'single') {
				// For single mode: if tool was text, we already set symbol; now exit draw mode
				this.setDrawToolBtnState(null);
			}

			// ---- 8) Optional: light refresh to ensure visibility in edge cases ----
			this.setState({ isActivelyDrawing: false });
			window.dispatchEvent(new CustomEvent('drawWidget:drawingModeChanged', {
				detail: { active: false }
			}));
			requestAnimationFrame(() => {
				try {
					if (typeof (this.drawLayer as any).refresh === 'function') {
						(this.drawLayer as any).refresh();
					}
				} catch { /* no-op */ }
			});
		} catch (err) {
			console.error('Error in svmGraCreate:', err);
		}
	};

	// Shift every coordinate in a curvePaths JSON by (dx, dy).
	private _translateCurveJSON = (curveJSON: any, dx: number, dy: number): any => {
		const shift = (pt: number[]) => [pt[0] + dx, pt[1] + dy];
		const curvePaths = (curveJSON.curvePaths || []).map((path: any[]) => path.map((el: any) => {
			if (Array.isArray(el)) return shift(el);
			const o: any = {};
			for (const k of Object.keys(el)) o[k] = (el[k] as number[][]).map(shift);
			return o;
		}));
		return { curvePaths, spatialReference: curveJSON.spatialReference };
	};

	// Safety net: if an edit linearized a true curve (curvePaths stripped to plain
	// straight paths), restore the original curve geometry shifted by the net move,
	// so dragging still repositions it but the curve shape is never corrupted.
	private _restoreCurveIfLinearized = (graphic: any) => {
		try {
			const uid = graphic?.attributes?.uniqueId;
			if (!uid || !this._curveUpdateBackup.has(uid)) return;
			const backup = this._curveUpdateBackup.get(uid);
			this._curveUpdateBackup.delete(uid);
			const geom: any = graphic?.geometry;
			if (!geom || geom.type !== 'polyline' || geom.curvePaths) return; // still a curve -> leave it
			let dx = 0, dy = 0;
			const c = geom.extent?.center;
			if (c && isFinite(backup.cx) && isFinite(backup.cy)) { dx = c.x - backup.cx; dy = c.y - backup.cy; }
			graphic.geometry = PolylineCompat.fromJSON(this._translateCurveJSON(backup.json, dx, dy));
			try { if (this.measureRef?.current?.isMeasurementEnabled?.()) this.measureRef.current.updateMeasurementsForGraphic(graphic); } catch { }
		} catch (e) { console.warn('curve restore warning:', e); }
	};

	svmGraUpdate = (evt) => {
		try {
			// Validate SketchViewModel and view before proceeding
			if (!this.sketchViewModel || !this.sketchViewModel.view) {
				console.warn('SketchViewModel view not available in update');
				return;
			}

			// Update undo/redo availability in state
			this.setState({
				canUndo: this.sketchViewModel.canUndo(),
				canRedo: this.sketchViewModel.canRedo()
			});

			if (evt.state === 'start') {
				if (evt.graphics) {
					// Filter out ALL buffer graphics and measurement labels from selection
					const selectableGraphics = evt.graphics.filter((gra: Graphic) => {
						if (gra.attributes?.isBuffer ||
							gra.attributes?.isBufferDrawing ||
							gra.attributes?.isPreviewBuffer ||
							gra.attributes?.uniqueId?.startsWith('buffer_') ||
							gra.attributes?.isMeasurementLabel ||
							gra.attributes?.hideFromList ||
							(gra.geometry?.type === 'point' && gra.symbol?.type === 'text' && gra.attributes?.isMeasurementLabel)) {
							return false;
						}
						return true;
					});

					// If no selectable graphics remain, cancel the update
					if (selectableGraphics.length === 0) {
						try {
							if (this.sketchViewModel && this.sketchViewModel.view) {
								this.sketchViewModel.cancel();
							}
						} catch (error) {
							console.warn('Error canceling SketchViewModel in svmGraUpdate:', error);
						}
						return;
					}

					// Ensure buffer watchers for selected graphics
					selectableGraphics.forEach((graphic: any) => {
						try {
							this.ensureBufferWatchersForSelectedGraphic(graphic);
						} catch (error) {
							console.warn('Error setting up buffer watcher:', error);
						}
					});

					// Snapshot true-curve geometry so it can be restored if an edit
					// linearizes it (SketchViewModel edits curves as straight paths).
					selectableGraphics.forEach((graphic: any) => {
						try {
							const cg = graphic?.geometry;
							if (cg && (cg as any).curvePaths && graphic.attributes?.uniqueId) {
								const c = cg.extent?.center;
								this._curveUpdateBackup.set(graphic.attributes.uniqueId, { json: cg.toJSON(), cx: c?.x ?? NaN, cy: c?.y ?? NaN });
							}
						} catch { }
					});

					// 🔧 FIX: Commented out automatic checkbox toggling to prevent unwanted measurement re-enabling
					// Sync measurement checkbox state if on Draw tab
					// 🚫 DISABLED: This was causing measurements to be re-added when user had unchecked the box
					// if (this.state.activeTab === 'draw') {
					// 	const extGraphic = selectableGraphics[0] as any;
					// 	const hasMeasurements =
					// 		extGraphic.attributes?.hadMeasurements ||
					// 		extGraphic.attributes?.measurementsPermanent ||
					// 		extGraphic.measure?.graphic ||
					// 		(extGraphic.attributes?.relatedMeasurementLabels?.length > 0) ||
					// 		(extGraphic.attributes?.relatedSegmentLabels?.length > 0);

					// 	if (hasMeasurements && !this.state.measurementCheckboxOn) {
					// 		//console.log('✅ Selection: Auto-checking measurement checkbox - selected graphic has measurements');
					// 		this.setState({ measurementCheckboxOn: true });
					// 		this.measureRef.current?.setMeasurementEnabled?.(true);
					// 	} else if (!hasMeasurements && this.state.measurementCheckboxOn) {
					// 		//console.log('✅ Selection: Auto-unchecking measurement checkbox - selected graphic has no measurements');
					// 		this.setState({ measurementCheckboxOn: false });
					// 		this.measureRef.current?.setMeasurementEnabled?.(false);
					// 	}
					// }

					// Continue with only selectable graphics
					selectableGraphics.forEach((gra: Graphic) => {
						try {
							if (gra.geometry.type === 'point' && gra.symbol.type === 'text') {
								let cTextSym: TextSymbol = gra.symbol.clone();
								// `.clone()` round-trips through ArcGIS accessors, which silently
								// cap lineWidth back to the ~192 default. Force it back to 9999
								// (no auto-wrap) via the same toJSON→fromJSON workaround used
								// elsewhere — otherwise re-imported multiline labels render with
								// extra wrapped lines on top of their explicit \n breaks.
								cTextSym = this.applyLineWidth(cTextSym, 9999);

								// Preserve the symbol's actual text (including \n line breaks)
								// for the editor's textarea. Only normalize \u00A0 (non-breaking
								// spaces, used internally to suppress auto-wrap) back to regular
								// spaces so the user sees normal text.
								const symText = cTextSym.text || '';
								const previewText = symText.replace(/\u00A0/g, ' ');

								// Determine the visible line count from the text itself.
								// If the text has explicit \n breaks (typical for re-imports
								// and multiline labels), use that count. Otherwise fall back
								// to the legacy formula derived from lineWidth.
								const explicitLines = symText.includes('\n')
									? Math.max(1, Math.min(20, symText.split('\n').length))
									: null;

								let cState: any = {
									vTextAlign: cTextSym.verticalAlignment,
									vAlignBaseBtnActive: cTextSym.verticalAlignment === 'baseline',
									vAlignTopBtnActive: cTextSym.verticalAlignment === 'top',
									vAlignMidBtnActive: cTextSym.verticalAlignment === 'middle',
									vAlignBotBtnActive: cTextSym.verticalAlignment === 'bottom',
									hTextAlign: cTextSym.horizontalAlignment,
									hAlignLeftBtnActive: cTextSym.horizontalAlignment === 'left',
									hAlignCenterBtnActive: cTextSym.horizontalAlignment === 'center',
									hAlignRightBtnActive: cTextSym.horizontalAlignment === 'right',
									fontRotation: cTextSym.angle,
									showSymPreview: false,
									showTextPreview: true,
									currentSymbol: null,
									currentSymbolType: null,
									currentTextSymbol: cTextSym,
									graphics: selectableGraphics,
									clearBtnTitle: this.nls('drawClearSelected'),
									fontColor: this.convertSymbolColorToColorPickerValue(cTextSym.color),
									fontOpacity: cTextSym.color.a,
									fontSize: cTextSym.font.size,
									textSymPreviewText: previewText,
									// CRITICAL: textarea is bound to `textHasChanged ? textSymPreviewText : ''`,
									// so this flag must be set on select or the box stays empty for
									// re-imported labels.
									textHasChanged: true,
									textNumLines: explicitLines != null
										? explicitLines
										: ((cTextSym.lineWidth == null || cTextSym.lineWidth >= 9999) ? 1 : Math.max(1, Math.round((cTextSym.text?.length ?? 0) * (cTextSym.font?.size ?? 12) * 0.5 / cTextSym.lineWidth))),
									fontHaloEnabled: cTextSym.haloSize !== null,
									fontWeight: cTextSym.font.weight,
									fontDecoration: cTextSym.font.decoration,
									fontStyle: cTextSym.font.style,
									fsBoldBtnActive: cTextSym.font.weight !== 'normal',
									fsItalicBtnActive: cTextSym.font.style !== 'normal',
									fsUnderlineBtnActive: cTextSym.font.decoration !== 'none',
									fontBackgroundColor: this.convertSymbolColorToColorPickerValue(cTextSym.backgroundColor)
								};
								if (cTextSym.haloColor) {
									cState.fontHaloOpacity = cTextSym.haloColor.a;
									cState.fontHaloColor = this.convertSymbolColorToColorPickerValue(cTextSym.haloColor);
									cState.fontHaloSize = cTextSym.haloSize;
									cState.fontHalo = cState.fontHaloSize + 'px ' + cState.fontHaloColor;
								} else {
									cState.fontHaloOpacity = 1;
									cState.fontHalo = 'unset';
									cState.fontHaloColor = 'rgba(255,255,255,1)';
									cState.fontHaloSize = 1;
								}
								this.setState(cState);
							} else {
								// Sync the arrow controls to reflect the selected line's OWN state
								// (so the toggle/position match the line, and can be turned off).
								let selArrowEnabled = this.state.arrowEnabled;
								let selArrowPosition = this.state.arrowPosition;
								if (selectableGraphics[0]?.geometry?.type === 'polyline') {
									const mk = (selectableGraphics[0].symbol as any)?.marker;
									selArrowEnabled = !!mk;
									if (mk) {
										selArrowPosition = mk.placement === 'begin' ? 'start'
											: mk.placement === 'begin-end' ? 'both' : 'end';
									}
								}
								if (gra.geometry.type === 'point') {
									this.setState({ rotationMode: true });
								}
								this.setState({
									showSymPreview: true,
									showTextPreview: false,
									currentSymbol: selectableGraphics[0].symbol,
									currentSymbolType: selectableGraphics[0].geometry?.type === 'polyline' ? JimuSymbolType.Polyline
										: selectableGraphics[0].geometry?.type === 'point' ? JimuSymbolType.Point
											: selectableGraphics[0].geometry?.type === 'polygon' ? JimuSymbolType.Polygon
												: this.state.currentSymbolType,
									graphics: selectableGraphics,
									arrowEnabled: selArrowEnabled,
									arrowPosition: selArrowPosition,
									clearBtnTitle: this.nls('drawClearSelected')
								});
							}
						} catch (error) {
							console.warn('Error processing selectable graphic:', error);
						}
					});
				}
			} else if (evt.state === 'active') {
				// Handle active editing state
				if (evt.graphics && evt.graphics.length > 0) {
					const activeGraphic = evt.graphics[0];
					if (activeGraphic.geometry?.type === 'polyline' && this.state.arrowEnabled) {
						if (activeGraphic.symbol?.type === 'simple-line') {
							const lineSymbol = activeGraphic.symbol as any;
							const hasMarker = !!(lineSymbol as any).marker;
							if (!hasMarker) {
								try {
									const arrowSymbol = this.createLineSymbolWithBuiltInArrows(
										lineSymbol,
										this.state.arrowPosition,
										this.state.arrowSize
									);
									activeGraphic.symbol = arrowSymbol;
								} catch (error) {
									console.warn('Error reapplying arrows during active editing:', error);
								}
							}
						}
					}
				}
			} else if (evt.state === 'complete') {
				this.setState({
					graphics: null,
					clearBtnTitle: this.nls('drawClear'),
					rotationMode: false
				});
				if (evt.graphics && evt.graphics.length > 0) {
					evt.graphics.forEach((g: any) => this._restoreCurveIfLinearized(g));
					const completedGraphic = evt.graphics[0];
					if (completedGraphic.geometry?.type === 'polyline' && this.state.arrowEnabled) {
						if (completedGraphic.symbol?.type === 'simple-line') {
							const lineSymbol = completedGraphic.symbol as any;
							const hasMarker = !!(lineSymbol as any).marker;
							if (!hasMarker) {
								try {
									const arrowSymbol = this.createLineSymbolWithBuiltInArrows(
										lineSymbol,
										this.state.arrowPosition,
										this.state.arrowSize
									);
									completedGraphic.symbol = arrowSymbol;
								} catch (error) {
									console.warn('Error reapplying arrows after editing completion:', error);
								}
							}
						}
					}
				}

				// Save to localStorage after move/reshape/transform completes
				if (this.drawLayer) {
					this.handleDrawingsUpdate(this.drawLayer.graphics.toArray());
				}
			}
		} catch (error) {
			console.error('Error in svmGraUpdate:', error);
		}
	};

	onSymbolPopper = (evt) => {
		//workarounds for symbol selector styling issues
		if (evt) {
			if (this.state.currentSymbolType === JimuSymbolType.Polyline) {
				let ddBtnCont = document.getElementsByClassName('dropdown-button-content')[0] as HTMLElement;
				ddBtnCont.style.filter = 'invert(1)';
			}
			let ddBtn = document.getElementsByClassName('jimu-btn jimu-dropdown-button dropdown-button')[0] as HTMLElement;
			// 🔧 MEMORY FIX: Only wire the click listener once per DOM element.
			// Previously every popper open stacked another listener on the same
			// button, leaking handlers for the lifetime of the page.
			if (ddBtn && !this._popperWiredElements.has(ddBtn)) {
				this._popperWiredElements.add(ddBtn);
				ddBtn.addEventListener('click', (evt) => {
					setTimeout(() => {
						let ddInner = document.getElementsByClassName('dropdown-menu--inner')[0] as HTMLElement;
						if (ddInner) {
							for (let i = 0; i < ddInner.children.length; i++) {
								let btn = ddInner.children[i];
								const imgs = btn.getElementsByTagName('img');
								for (let im = 0; im < imgs.length; im++) {
									imgs[im].style.filter = 'invert(1)';
								}
							}
						}
					}, 20);
				});
			}
			let unitSelectors = document.getElementsByClassName('style-setting--unit-selector');
			Array.from(unitSelectors).forEach((ele: HTMLElement) => {
				// Fix: Check if firstChild exists before accessing its style
				if (ele.firstChild && ele.firstChild instanceof HTMLElement) {
					ele.firstChild.style.padding = '0';
				}
			});
			let popper = document.getElementsByClassName('content-container')[0].parentNode.parentElement;
			setTimeout(() => {
				popper.style.zIndex = '1004';
			}, 5);
			let colorPickerBlocks = document.getElementsByClassName('color-picker-block');
			Array.from(colorPickerBlocks).forEach((ele: HTMLElement) => {
				// 🔧 MEMORY FIX: Guard against re-attaching to the same block.
				if (this._popperWiredElements.has(ele)) return;
				this._popperWiredElements.add(ele);
				ele.addEventListener('click', e => { this.onColorPickerToggle(e) });
			});
		}
	}

	onPointSymChanged = (evt) => {
		this.setState({
			currentSymbol: evt,
			currentSymbolType: JimuSymbolType.Point
		}, () => {
			this.sketchViewModel.pointSymbol = evt;
			if (this.state.graphics && this.state.graphics.length > 0) {
				this.state.graphics.map((gra: Graphic) => {
					if (gra.geometry.type === 'point') {
						gra.symbol = evt;
					}
				});
			}
		});
	}

	onPolygonSymbolChanged = (evt) => {
		this.setState({
			currentSymbol: evt,
			currentSymbolType: JimuSymbolType.Polygon
		}, () => {
			this.sketchViewModel.polygonSymbol = evt;
			if (this.state.graphics && this.state.graphics.length > 0) {
				this.state.graphics.map((gra: Graphic) => {
					if (gra.geometry.type === 'polygon' || gra.geometry.type === 'extent') {
						gra.symbol = evt;
					}
				});
			}
		});
	}

	onPolylineSymbolChanged = (evt) => {
		//console.log('Polyline symbol changed - preserving arrow settings:', evt);

		if (!evt || evt.type !== 'simple-line') {
			console.warn('Invalid symbol passed to onPolylineSymbolChanged');
			return;
		}

		// Build a fresh marker-free symbol (delete on an Esri Accessor's 'marker'
		// is unreliable, which left arrows on the line when toggled off).
		const cleanSymbol = new SimpleLineSymbol({ color: (evt as any).color, width: (evt as any).width, style: (evt as any).style });

		let finalSymbol = cleanSymbol;

		// Apply arrows if enabled using current state values
		if (this.state.arrowEnabled) {
			// console.log('Arrows enabled, creating symbol with current settings:', {
			//   position: this.state.arrowPosition,
			//   size: this.state.arrowSize
			// });
			finalSymbol = this.createLineSymbolWithBuiltInArrows(
				cleanSymbol,
				this.state.arrowPosition,
				this.state.arrowSize
			);
		}

		this.setState({
			currentSymbol: finalSymbol,
			currentSymbolType: JimuSymbolType.Polyline
		}, () => {
			this.sketchViewModel.polylineSymbol = finalSymbol;
			if (this.state.graphics && this.state.graphics.length > 0) {
				this.state.graphics.map((gra: Graphic) => {
					if (gra.geometry.type === 'polyline') {
						gra.symbol = finalSymbol;
					}
				});
			}
		});
	}

	drawClearBtnClick = (forceClearAll: boolean = false) => {
		if (!this.sketchViewModel || !this.sketchViewModel.view) {
			console.warn('SketchViewModel not available for clear operation');
			return;
		}

		try {
			// The same toolbar button handles both "Clear Selected Graphic" and
			// "Clear All Graphics". Selection state can remain populated briefly
			// after the label switches back to clear-all, so the clear-all buttons
			// explicitly pass forceClearAll=true.
			const clearAllRequested = forceClearAll || this.state.clearBtnTitle === this.nls('drawClear');

			if (!clearAllRequested && this.state.graphics && this.state.graphics.length) {
				// Remove any associated measurements, buffers, and attached buffers before deleting the drawing
				this.state.graphics.forEach((gra: Graphic) => {
					try {
						const extendedGraphic = gra as any; // Type assertion for extended properties

						// Remove measurement graphics
						if (extendedGraphic.measure?.graphic) {
							this.drawLayer.remove(extendedGraphic.measure.graphic);
						}
						if (gra.attributes?.relatedSegmentLabels) {
							this.drawLayer.removeMany(gra.attributes.relatedSegmentLabels);
						}

						// 🔧 ENHANCED: Remove attached buffer graphics
						if (extendedGraphic.bufferGraphic) {
							//console.log(`🗑️ Widget: Removing attached buffer for selected graphic`);
							this.drawLayer.remove(extendedGraphic.bufferGraphic);
							extendedGraphic.bufferGraphic = null;
						}

						// Clear buffer settings
						if (extendedGraphic.bufferSettings) {
							extendedGraphic.bufferSettings = null;
						}

						// 🔧 NEW: Remove geometry watchers for this graphic
						const parentId = gra.attributes?.uniqueId;
						if (parentId && this._positionWatchers) {
							const watcherKey = parentId + '_widget_buffer';
							if (this._positionWatchers[watcherKey]) {
								try {
									this._positionWatchers[watcherKey].remove();
									delete this._positionWatchers[watcherKey];
								} catch (error) {
									console.warn('Error removing geometry watcher during clear:', error);
								}
							}
						}
					} catch (error) {
						console.warn('Error processing graphic during clear:', error);
					}
				});

				// Now delete the drawing itself
				try {
					this.sketchViewModel.delete();
				} catch (error) {
					console.error('Error deleting selected graphics:', error);
				}
				return;
			}

			// If clearing all graphics, also remove all buffers and clean up watchers
			const allGraphics = this.drawLayer.graphics.toArray();

			// 🔧 ENHANCED: Remove ALL buffer types when clearing all
			const allBuffers = allGraphics.filter(g =>
				g.attributes?.isBuffer ||
				g.attributes?.isPreviewBuffer ||
				g.attributes?.isBufferDrawing
			);

			if (allBuffers.length > 0) {
				//console.log(`🗑️ Widget: Removing ${allBuffers.length} buffer graphics during clear all`);
				allBuffers.forEach(buffer => {
					try {
						this.drawLayer.remove(buffer);
					} catch (error) {
						console.warn('Error removing buffer graphic:', error);
					}
				});
			}

			// 🔧 NEW: Clean up ALL geometry watchers
			if (this._positionWatchers) {
				Object.values(this._positionWatchers).forEach(watcher => {
					if (watcher && typeof watcher.remove === 'function') {
						try {
							watcher.remove();
						} catch (error) {
							console.warn('Error removing watcher during clear all:', error);
						}
					}
				});
				this._positionWatchers = {};
				//console.log(`✅ Widget: Cleared all geometry watchers`);
			}

			// End any active update before removing the layer contents. Otherwise an
			// edited graphic held by SketchViewModel can survive or be re-added.
			try {
				this.sketchViewModel.cancel();
			} catch (error) {
				console.warn('Error canceling active sketch before clear all:', error);
			}
			try {
				this.sketchViewModel.updateGraphics?.removeAll?.();
			} catch (error) {
				console.warn('Error clearing SketchViewModel selection:', error);
			}

			// Clear the drawing layer.
			try {
				this.drawLayer.removeAll();
			} catch (error) {
				console.warn('Error clearing draw layer:', error);
			}

			// Persist and synchronize the empty drawing collection so graphics do not
			// return from local storage or the My Drawings panel after the clear.
			this.handleDrawingsUpdate([]);
			this.myDrawingsRef?.current?.ingestDrawings?.([]);

			// Reset selection and toolbar state after a full clear.
			this.setDrawToolBtnState('');
			this.setState({
				confirmDelete: false,
				graphics: null,
				clearBtnTitle: this.nls('drawClear'),
				rotationMode: false
			});

			//console.log(`✅ Widget: Clear all completed with buffer cleanup`);

		} catch (error) {
			console.error('Error in drawClearBtnClick:', error);
			// Ensure confirmation dialog is closed even if there's an error
			this.setState({ confirmDelete: false });
		}
	};

	drawUndoBtnClick = () => {
		if (!this.sketchViewModel || !this.sketchViewModel.view) {
			console.warn('SketchViewModel not available for undo');
			return;
		}

		try {
			if (this.sketchViewModel.canUndo()) {
				this.sketchViewModel.undo();
			}
			this.setState({
				canUndo: this.sketchViewModel.canUndo(),
				canRedo: this.sketchViewModel.canRedo()
			});
		} catch (error) {
			console.error('Error in drawUndoBtnClick:', error);
		}
	}

	drawRedoBtnClick = () => {
		if (!this.sketchViewModel || !this.sketchViewModel.view) {
			console.warn('SketchViewModel not available for redo');
			return;
		}

		try {
			if (this.sketchViewModel.canRedo()) {
				this.sketchViewModel.redo();
			}
			this.setState({
				canUndo: this.sketchViewModel.canUndo(),
				canRedo: this.sketchViewModel.canRedo()
			});
		} catch (error) {
			console.error('Error in drawRedoBtnClick:', error);
		}
	}

	TextOnChange = (evt) => {
		const rawValue = evt.currentTarget.value;
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.text = this.wrapTextToLines(rawValue, this.state.textNumLines);
		ts = this.applyLineWidth(ts, 9999);
		this.setState({
			textSymPreviewText: rawValue,
			currentTextSymbol: ts,
			textHasChanged: true
		}, () => { this.updateSelectedTextGras() });
	}

	fontSizeOnChange = (size) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.font.size = size;
		this.setState({
			fontSize: size,
			currentTextSymbol: ts,
			textPreviewHeight: this.getRotatedTextHeight()
		}, () => { this.updateSelectedTextGras() });
	}

	fontHaloSizeChange = (evt) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.haloSize = parseInt(evt);
		this.setState({
			fontHaloSize: parseInt(evt),
			currentTextSymbol: ts,
			fontHalo: this.state.fontHaloEnabled ? evt + "px " + this.state.fontHaloColor : 'unset'
		}, () => { this.updateSelectedTextGras() });
	}

	updateTextColor = (evt) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.color = evt;
		this.setState({
			fontColor: this.convertSymbolColorToColorPickerValue(ts.color),
			fontOpacity: ts.color.a,
			currentTextSymbol: ts
		}, () => { this.updateSelectedTextGras() });
	}

	updateFontHaloColor = (evt) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.haloColor = evt;
		this.setState({
			fontHaloColor: evt,
			currentTextSymbol: ts,
			fontHalo: this.state.fontHaloEnabled ? this.state.fontHaloSize + "px " + evt : 'unset'
		}, () => { this.updateSelectedTextGras() });
	}

	updateBackgroundColor = (evt) => {
		const color = new Color(evt)
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.backgroundColor = color;
		this.setState({
			fontBackgroundColor: color,
			currentTextSymbol: ts
		}, () => { this.updateSelectedTextGras() });
	}

	fontHaloChkChange = (evt) => {
		const target = evt.currentTarget;
		if (!target) return;
		let ts: TextSymbol = this.state.currentTextSymbol;
		if (!target.checked) {
			ts.haloColor = null;
			ts.haloSize = null;
		} else {
			ts.haloColor = this.state.fontHaloColor as any;
			ts.haloSize = this.state.fontHaloSize
		}
		this.setState({
			currentTextSymbol: ts,
			fontHaloEnabled: target.checked,
			fontHalo: target.checked ? this.state.fontHaloSize + "px " + this.state.fontHaloColor : 'unset'
		}, () => { this.updateSelectedTextGras() });
	}

	onHTextAlignChange = (evt) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.horizontalAlignment = evt;

		this.setState({
			hTextAlign: evt,
			currentTextSymbol: ts
		}, () => { this.updateSelectedTextGras() });
	}

	fontRotationChange = (evt) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.angle = evt;

		this.setState({
			fontRotation: evt,
			currentTextSymbol: ts,
			textPreviewHeight: this.getRotatedTextHeight()
		}, () => { this.updateSelectedTextGras() });
	}

	textLineWidthChange = (evt) => {
		// kept as no-op shim — logic moved to textNumLinesChange
	}

	/** Compute ArcGIS lineWidth in points for N lines. 1 line = no wrap (9999). */
	private computeLineWidth = (text: string, numLines: number, fontSize: number): number => {
		return 9999; // always disable ArcGIS auto-wrap — we insert \n ourselves
	}

	/**
	 * Create a TextSymbol with a forced lineWidth value, bypassing ArcGIS's
	 * accessor setter validation which silently caps the value.
	 */
	private applyLineWidth = (ts: TextSymbol, lineWidth: number): TextSymbol => {
		try {
			const json = ts.toJSON();
			json.lineWidth = lineWidth;
			return TextSymbol.fromJSON(json);
		} catch {
			return ts;
		}
	}

	/**
	 * Split raw text into exactly numLines lines by inserting \n at word boundaries.
	 * For 1 line: replace spaces with non-breaking spaces (\u00A0) to prevent ArcGIS auto-wrap.
	 * Uses canvas measurement for proportional accuracy.
	 */
	private wrapTextToLines = (rawText: string, numLines: number): string => {
		if (!rawText) return rawText;

		// If the text already contains explicit \n line breaks (typical when the
		// user typed Enter in the textarea, or when editing a re-imported multiline
		// label), preserve those break points exactly. We just disable auto-wrap
		// inside each segment by replacing regular spaces with non-breaking spaces.
		// To force a re-flow, the user changes the Lines control — that path
		// (textNumLinesChange) explicitly strips \n's before calling this function.
		if (rawText.includes('\n')) {
			return rawText.split('\n').map(line => line.replace(/ /g, '\u00A0')).join('\n');
		}

		// 1 line: prevent ALL wrapping by replacing spaces with non-breaking spaces
		if (numLines <= 1) return rawText.replace(/ /g, '\u00A0');

		const words = rawText.split(/\s+/).filter(Boolean);
		if (words.length <= numLines) {
			// Fewer words than lines — one word per line
			return words.join('\n');
		}

		const ts = this.state.currentTextSymbol;
		const fontSize = ts?.font?.size || 12;
		const fontFamily = ts?.font?.family || 'Arial';
		const fontWeight = ts?.font?.weight === 'bold' ? 'bold' : 'normal';
		const fontStyle = ts?.font?.style === 'italic' ? 'italic' : 'normal';

		// Measure word widths
		let measureWord = (w: string): number => w.length; // fallback
		try {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.font = `${fontStyle} ${fontWeight} ${fontSize * (96 / 72)}px "${fontFamily}"`;
				const spaceW = ctx.measureText(' ').width;
				measureWord = (w: string) => ctx.measureText(w).width;
				const totalW = words.reduce((s, w, i) => s + ctx.measureText(w).width + (i > 0 ? spaceW : 0), 0);
				const targetW = totalW / numLines;

				// Greedy fill: build lines accumulating until we exceed target, then break
				const lines: string[] = [];
				let curLine: string[] = [];
				let curW = 0;
				for (let i = 0; i < words.length; i++) {
					const ww = ctx.measureText(words[i]).width;
					const addW = curW === 0 ? ww : curW + spaceW + ww;
					if (curW > 0 && addW > targetW && lines.length < numLines - 1) {
						lines.push(curLine.join(' '));
						curLine = [words[i]];
						curW = ww;
					} else {
						curLine.push(words[i]);
						curW = addW;
					}
				}
				if (curLine.length) lines.push(curLine.join(' '));
				return lines.join('\n');
			}
		} catch { /* fall through to character split */ }

		// Fallback: character-count split
		const chunkSize = Math.ceil(rawText.length / numLines);
		const result: string[] = [];
		for (let i = 0; i < numLines; i++) {
			result.push(rawText.slice(i * chunkSize, (i + 1) * chunkSize));
		}
		return result.join('\n');
	}

	textNumLinesChange = (evt) => {
		const lines = Math.max(1, Math.min(20, Number(evt) || 1));
		let ts: TextSymbol = this.state.currentTextSymbol;
		// Always strip \n / \u00A0 here — changing the Lines control is an
		// explicit re-flow request, and wrapTextToLines now preserves \n's
		// when present, so we must flatten the text first.
		const rawText = (this.state.textSymPreviewText || ts.text || '').replace(/\n/g, ' ').replace(/\u00A0/g, ' ');
		ts.text = this.wrapTextToLines(rawText, lines);
		ts = this.applyLineWidth(ts, 9999);
		this.setState({
			textNumLines: lines,
			textSymPreviewText: rawText,
			currentTextSymbol: ts,
		}, () => { this.updateSelectedTextGras() });
	}

	onVertFontAlignChange = (evt, valign) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.verticalAlignment = valign;
		this.setState({
			vTextAlign: valign,
			vAlignBaseBtnActive: valign === 'baseline',
			vAlignTopBtnActive: valign === 'top',
			vAlignMidBtnActive: valign === 'middle',
			vAlignBotBtnActive: valign === 'bottom',
			currentTextSymbol: ts
		}, () => { this.updateSelectedTextGras() });
		this.updateActiveBtnIcons();
	}

	updateActiveBtnIcons = () => {
		setTimeout(() => {
			let activeBtns = document.querySelectorAll('.btn-group>.icon-btn');
			Array.from(activeBtns).forEach((ele: HTMLElement) => {
				this.setImgElemFilter(ele, ele.classList.contains('active'));
			});
		}, 20);
	}

	setImgElemFilter = (ele: HTMLElement, isActive: boolean) => {
		let img = ele.getElementsByTagName('img')[0] as HTMLElement;
		if (!img) {
			return;
		}
		if (img.getAttribute('style') && img.getAttribute('style').indexOf("filter:") > -1 && !isActive) {
			img.style.filter = '';
		}
		if ((!img.getAttribute('style') || img.style.filter == "") && isActive) {
			img.style.filter = 'invert(1)';
		}
	}

	onHorizFontAlignChange = (evt, halign) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.horizontalAlignment = halign;
		this.setState({
			hTextAlign: halign,
			hAlignLeftBtnActive: halign === 'left',
			hAlignCenterBtnActive: halign === 'center',
			hAlignRightBtnActive: halign === 'right',
			currentTextSymbol: ts
		}, () => { this.updateSelectedTextGras() });
	}

	updateSelectedTextGras = () => {
		const ts = this.state.currentTextSymbol;

		// Find the graphic currently being edited in the SketchViewModel
		const activeGra: Graphic = this.sketchViewModel?.updateGraphics?.getItemAt(0);

		if (activeGra && activeGra.geometry?.type === 'point' && activeGra.symbol?.type === 'text' && !activeGra.attributes?.isMeasurementLabel) {
			// Update the SketchViewModel's live graphic (what user sees while editing)
			activeGra.symbol = ts;

			// Also update the matching backing graphic in the draw layer by uniqueId
			const uid = activeGra.attributes?.uniqueId;
			if (uid && this.drawLayer?.graphics) {
				const layerGra = this.drawLayer.graphics.find((g: Graphic) => g.attributes?.uniqueId === uid);
				if (layerGra) layerGra.symbol = ts;
			}
		}
	};

	getRotatedTextHeight = () => {
		let span, spanParent,
			rad = this.state.fontRotation * (Math.PI / 180);
		if (document.getElementsByClassName('text-symbol-span')[0]) {
			span = (document.getElementsByClassName('text-symbol-span')[0] as HTMLElement);
		};
		if (document.getElementsByClassName('text-symbol-item')[0]) {
			spanParent = (document.getElementsByClassName('text-symbol-item')[0] as HTMLElement);
		};
		if (span === undefined || span === null) {
			return 13;
		}
		return Math.abs(span.clientWidth * Math.sin(rad) + span.clientHeight * Math.cos(rad)) + 12;
	}

	onFontStyleChange = (evt, key) => {
		let cState = {};
		let ts: TextSymbol = this.state.currentTextSymbol;
		if (key === 'bold') {
			if (!this.state.fsBoldBtnActive) {
				ts.font.weight = 'bold';
			} else {
				ts.font.weight = 'normal';
			}
			cState['fontWeight'] = ts.font.weight;
			cState['fsBoldBtnActive'] = !this.state.fsBoldBtnActive;
		}
		if (key === 'italic') {
			if (!this.state.fsItalicBtnActive) {
				ts.font.style = 'italic';
			} else {
				ts.font.style = 'normal';
			}
			cState['fontStyle'] = ts.font.style;
			cState['fsItalicBtnActive'] = !this.state.fsItalicBtnActive;
		}
		if (key === 'underline') {
			if (!this.state.fsUnderlineBtnActive) {
				ts.font.decoration = 'underline'
			} else {
				ts.font.decoration = 'none';
			}
			cState['fontDecoration'] = ts.font.decoration;
			cState['fsUnderlineBtnActive'] = !this.state.fsUnderlineBtnActive;
		}
		cState['currentTextSymbol'] = ts;
		this.setState(cState, () => { this.updateSelectedTextGras() });
		this.updateActiveBtnIcons();
	}

	setDrawToolBtnState = (toolBtn: 'point' | 'polyline' | 'freepolyline' | 'extent' | 'polygon' | 'circle' | 'freepolygon' | 'text' | '') => {
		console.log('defMessages: ', defMessages);
		// Exit the custom curve line tool whenever any draw tool is (re)selected,
		// so the line button and another tool never show active simultaneously.
		this._deactivateCurveTool();
		this._deactivateTriangleTool();
		this._deactivateCirclePreset();
		// ENHANCED: Clean measurement editing coordination before drawing tool activation
		if (toolBtn !== '' && this.measureRef?.current?.isEditingMeasurements?.()) {
			//console.log('Drawing tool activating - cleaning up measurement editing');
			this.measureRef.current.cleanupMeasurementLabelSelection?.();
			// Note: disableMeasurements() will be called automatically by the measurement component
			// when it detects currentTool prop change
		}

		// Validate SketchViewModel before proceeding with drawing tools
		if (toolBtn !== '' && (!this.sketchViewModel || !this.sketchViewModel.view)) {
			console.warn('SketchViewModel not available for drawing tool activation');
			return;
		}

		// Check if we're exiting all drawing tools for popup restoration
		const wasInDrawingMode = this.state.pointBtnActive || this.state.lineBtnActive ||
			this.state.flineBtnActive || this.state.rectBtnActive ||
			this.state.polygonBtnActive || this.state.fpolygonBtnActive ||
			this.state.circleBtnActive || this.state.textBtnActive;

		const willBeInDrawingMode = toolBtn !== '';

		// FIXED: Check if clicking the same active button to toggle it off
		const isTogglingOff = (
			(toolBtn === 'point' && this.state.pointBtnActive) ||
			(toolBtn === 'polyline' && this.state.lineBtnActive) ||
			(toolBtn === 'freepolyline' && this.state.flineBtnActive) ||
			(toolBtn === 'extent' && this.state.rectBtnActive) ||
			(toolBtn === 'polygon' && this.state.polygonBtnActive) ||
			(toolBtn === 'freepolygon' && this.state.fpolygonBtnActive) ||
			(toolBtn === 'circle' && this.state.circleBtnActive) ||
			(toolBtn === 'text' && this.state.textBtnActive)
		);

		// If toggling off the active tool, treat it as exiting drawing mode
		if (isTogglingOff) {
			toolBtn = '';
		}

		// Initialize button state - all tools off by default
		let cState: Partial<States> = {
			pointBtnActive: false,
			lineBtnActive: false,
			flineBtnActive: false,
			rectBtnActive: false,
			polygonBtnActive: false,
			fpolygonBtnActive: false,
			circleBtnActive: false,
			textBtnActive: false,
			currentTool: toolBtn
		};

		try {
			// Always cancel any existing operations first
			if (this.sketchViewModel) {
				this.sketchViewModel.cancel();
			}

			switch (toolBtn) {
				case 'point':
					cState.currentSymbol = this.sketchViewModel.pointSymbol;
					cState.currentSymbolType = JimuSymbolType.Point;
					this.sketchViewModel.create("point");
					cState.pointBtnActive = true;
					break;

				case 'polyline': {
					let baseSymbol = this.sketchViewModel.polylineSymbol as any;
					let finalSymbol: any = baseSymbol;

					// Apply arrows if enabled
					if (this.state.arrowEnabled && baseSymbol?.type === 'simple-line') {
						try {
							finalSymbol = this.createLineSymbolWithBuiltInArrows(
								baseSymbol,
								this.state.arrowPosition,
								this.state.arrowSize
							);
						} catch (error) {
							console.warn('Error creating arrow symbol, using base symbol:', error);
							finalSymbol = baseSymbol;
						}
					}

					cState.currentSymbol = finalSymbol;
					cState.currentSymbolType = JimuSymbolType.Polyline;
					this.sketchViewModel.polylineSymbol = finalSymbol;
					this.sketchViewModel.create("polyline");
					cState.lineBtnActive = true;
					break;
				}

				case 'freepolyline': {
					let baseSymbol = this.sketchViewModel.polylineSymbol as any;
					let finalSymbol: any = baseSymbol;

					// Apply arrows if enabled
					if (this.state.arrowEnabled && baseSymbol?.type === 'simple-line') {
						try {
							finalSymbol = this.createLineSymbolWithBuiltInArrows(
								baseSymbol,
								this.state.arrowPosition,
								this.state.arrowSize
							);
						} catch (error) {
							console.warn('Error creating arrow symbol, using base symbol:', error);
							finalSymbol = baseSymbol;
						}
					}

					cState.currentSymbol = finalSymbol;
					cState.currentSymbolType = JimuSymbolType.Polyline;
					this.sketchViewModel.polylineSymbol = finalSymbol;
					this.sketchViewModel.create("polyline", { mode: 'freehand' });
					cState.flineBtnActive = true;
					break;
				}

				case 'extent':
					cState.currentSymbol = this.sketchViewModel.polygonSymbol;
					cState.currentSymbolType = JimuSymbolType.Polygon;
					this.sketchViewModel.create("rectangle");
					cState.rectBtnActive = true;
					break;

				case 'polygon':
					cState.currentSymbol = this.sketchViewModel.polygonSymbol;
					cState.currentSymbolType = JimuSymbolType.Polygon;
					this.sketchViewModel.create("polygon");
					cState.polygonBtnActive = true;
					break;

				case 'freepolygon':
					cState.currentSymbol = this.sketchViewModel.polygonSymbol;
					cState.currentSymbolType = JimuSymbolType.Polygon;
					this.sketchViewModel.create("polygon", { mode: 'freehand' });
					cState.fpolygonBtnActive = true;
					break;

				case 'circle':
					cState.currentSymbol = this.sketchViewModel.polygonSymbol;
					cState.currentSymbolType = JimuSymbolType.Polygon;
					if (this.state.circlePresetEnabled) {
						// Preset Circle Size: one click places a circle of an exact
						// radius or area, so skip the SketchViewModel drag-to-size tool.
						const presetView = this.state.currentJimuMapView?.view;
						if (presetView) this._activateCirclePreset(presetView);
					} else {
						this.sketchViewModel.create("circle");
					}
					cState.circleBtnActive = true;
					break;

				case 'text':
					cState.currentSymbol = this.sketchViewModel.pointSymbol;
					cState.currentSymbolType = JimuSymbolType.Point;
					this.sketchViewModel.create("point");
					cState.textBtnActive = true;
					break;

				default:
					// Exiting all drawing tools - cancel is already called above
					break;
			}
		} catch (error) {
			console.error('Error in setDrawToolBtnState:', error);
			// Reset state on error to prevent UI inconsistencies
			cState = {
				pointBtnActive: false,
				lineBtnActive: false,
				flineBtnActive: false,
				rectBtnActive: false,
				polygonBtnActive: false,
				fpolygonBtnActive: false,
				circleBtnActive: false,
				textBtnActive: false,
				currentTool: ''
			};
		}

		// Handle popup restoration for widgets not controlled by widget state
		if (this.state.currentJimuMapView) {
			const view = this.state.currentJimuMapView.view;
			const widgetState: WidgetState = this.props.state;
			const isWidgetControlled = widgetState !== undefined && widgetState !== null;

			if (!isWidgetControlled && view && this.originalPopupEnabled !== null) {
				// Restore popups when exiting drawing mode if not controlled by widget state
				if (wasInDrawingMode && !willBeInDrawingMode && !view.popupEnabled && this.originalPopupEnabled) {
					view.popupEnabled = this.originalPopupEnabled;
					//console.log('Restored popup state (uncontrolled widget, exiting drawing):', this.originalPopupEnabled);

					if (view.popup && "autoCloseEnabled" in view.popup) {
						view.popup.autoCloseEnabled = true;
					}

					// Restore highlight appearance
					view.highlightOptions = {
						color: [0, 255, 255, 1],
						fillOpacity: 0.0,
						haloOpacity: 0.8
					};

					// Restore layer-level highlight styling
					view.map.layers.forEach(layer => {
						view.whenLayerView(layer).then((layerView: any) => {
							if (layer.type === "feature") {
								const featureLayerView = layerView as any;
								if ("highlightOptions" in featureLayerView) {
									featureLayerView.highlightOptions = {
										color: [0, 255, 255, 1],
										fillOpacity: 0.0,
										haloOpacity: 0.8
									};
								}
							}
						});
					});
				}
				// Disable popups when entering drawing mode
				else if (!wasInDrawingMode && willBeInDrawingMode && view.popupEnabled) {
					// Store original state if not already stored
					if (this.originalPopupEnabled === null) {
						this.originalPopupEnabled = view.popupEnabled;
						//console.log('Stored original popup state (uncontrolled widget):', this.originalPopupEnabled);
					}

					view.popupEnabled = false;
					//console.log('Disabled popups (uncontrolled widget, entering drawing mode)');

					if (view.popup && "autoCloseEnabled" in view.popup) {
						view.popup.autoCloseEnabled = false;
					}
					view.popup.visible = false;

					// Make highlights invisible
					view.highlightOptions = {
						color: [0, 0, 0, 0],
						fillOpacity: 0,
						haloOpacity: 0
					};
				}
			}
		}

		// Set preview states
		cState.showSymPreview = toolBtn !== 'text' && toolBtn !== '';
		cState.showTextPreview = toolBtn === 'text';

		// Apply state changes
		this.setState(cState as States);
	};

	handleSwitchToDrawings = () => {
		// Store measurement editing state before switching
		const wasMeasurementEditingEnabled = this.measureRef?.current?.isEditingMeasurements?.() || false;

		this.setDrawToolBtnState('');
		this.setState({ activeTab: 'mydrawings' }, () => {
			// Restore measurement editing state after tab switch if it was enabled
			if (wasMeasurementEditingEnabled) {
				setTimeout(() => {
					if (this.measureRef?.current) {
						// Re-enable measurement editing after tab switch
						this.measureRef.current.enableMeasurements();
					}
				}, 250);
			}
		});
	};

	handleSwitchFromDrawings = () => {
		// Store measurement editing state before switching
		const wasMeasurementEditingEnabled = this.measureRef?.current?.isEditingMeasurements?.() || false;

		this.setDrawToolBtnState('');
		this.setState({ activeTab: 'draw' }, () => {
			// Restore measurement editing state after tab switch if it was enabled
			if (wasMeasurementEditingEnabled) {
				setTimeout(() => {
					if (this.measureRef?.current) {
						// Re-enable measurement editing after tab switch
						this.measureRef.current.enableMeasurements();
					}
				}, 250);
			}
		});
	};

	showTextSymbolPopper = (evt) => {
		// Prevent event bubbling and default behavior
		if (evt) {
			evt.preventDefault();
			evt.stopPropagation();
		}

		this.updateActiveBtnIcons();

		// Workaround for InputUnit styling issue
		setTimeout(() => {
			let unitSelectors = document.getElementsByClassName('style-setting--unit-selector');
			Array.from(unitSelectors).forEach((ele: HTMLElement) => {
				(ele.firstChild as HTMLElement).style.padding = '0';
			});
		}, 200);

		// Toggle the text preview popper state
		this.setState({ textPreviewisOpen: !this.state.textPreviewisOpen });
	}

	updateSymbolOpacity = (value) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.color.a = value;
		this.setState({
			fontOpacity: value,
			currentTextSymbol: ts,
			fontColor: this.convertSymbolColorToColorPickerValue(ts.color)
		}, () => { this.updateSelectedTextGras() });
	}

	onOpacityInputChanged = (e) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.color.a = e.distance / 100;
		this.setState({
			fontOpacity: e.distance / 100,
			currentTextSymbol: ts,
			fontColor: this.convertSymbolColorToColorPickerValue(ts.color)
		}, () => { this.updateSelectedTextGras() });
	}

	updateSymbolHaloOpacity = (value) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.haloColor.a = value;
		this.setState({
			fontHaloOpacity: value,
			currentTextSymbol: ts,
			fontHaloColor: this.convertSymbolColorToColorPickerValue(ts.haloColor),
			fontHalo: this.state.fontHaloEnabled ? this.state.fontHaloSize + "px " + this.convertSymbolColorToColorPickerValue(ts.haloColor) : 'unset'
		}, () => { this.updateSelectedTextGras() });
	}

	onHaloOpacityInputChanged = (e) => {
		let ts: TextSymbol = this.state.currentTextSymbol;
		ts.haloColor.a = e.distance / 100;
		this.setState({
			fontHaloOpacity: e.distance / 100,
			currentTextSymbol: ts,
			fontHaloColor: this.convertSymbolColorToColorPickerValue(ts.haloColor),
			fontHalo: this.state.fontHaloEnabled ? this.state.fontHaloSize + "px " + this.convertSymbolColorToColorPickerValue(ts.haloColor) : 'unset'
		}, () => { this.updateSelectedTextGras() });
	}

	convertSymbolColorToColorPickerValue = (color: esriColor) => {
		if (color) {
			const rgbaClr = color.toRgba();
			return `rgba(${rgbaClr[0]},${rgbaClr[1]},${rgbaClr[2]},${rgbaClr[3]})`
		}
		return null
	}

	onColorPickerToggle = (evt) => {
		//workaround for color picker style issue
		setTimeout(() => {
			let colorPicker = document.querySelectorAll('.color-picker-popper>.popper-box>.sketch-standard')[0] as HTMLElement;
			colorPicker.style.backgroundColor = 'unset';
		}, 200);
	}

	handlePointRotation = (e) => {
		const symbol = this.state.currentSymbol.clone()
		symbol.angle = e.target ? e.target.value : e
		this.onPointSymChanged(symbol)
	}

	handleFontFamily = (e) => {
		const newFont = e.target.value;
		const cTextSym: TextSymbol = this.state.currentTextSymbol.clone();
		cTextSym.font.family = newFont;

		// Update state and apply changes to any selected text graphics
		this.setState({
			currentTextSymbol: cTextSym
		}, () => {
			// Callback to ensure state is updated before applying to graphics
			this.updateSelectedTextGras();
		});
	}

	handleListMode = (e) => {
		const checked = e.target.checked
		if (checked) {
			this.drawLayer.listMode = 'show'
		} else {
			this.drawLayer.listMode = 'hide'
		}
		this.setState({ listMode: this.drawLayer.listMode })
	}

	handleTitleChange = (e) => {
		const title = e.target.value
		this.drawLayer.title = title
		this.setState({ drawLayerTitle: title })
	}

	renderMyDrawingsTab() {
		return (
			<div
				className="my-drawings-tab-container p-3"
				role="region"
				aria-label="My saved drawings management panel"
			>
				{this.drawLayer && (
					<MyDrawingsPanel
						key={`drawings-panel-${this.props.config.storageScope || 'app-specific'}`}
						ref={this.myDrawingsRef}
						graphicsLayer={this.drawLayer}
						jimuMapView={this.state.currentJimuMapView}
						drawings={this.drawLayer.graphics.toArray()}
						allowLocalStorage={true}
						localStorageKey={this.getLocalStorageKey()}
						confirmOnDelete={true}
						onDrawingSelect={this.handleDrawingSelect}
						onDrawingsUpdate={this.handleDrawingsUpdate}
						showAlert={this.showAlert}
						isActiveTab={this.state.activeTab === 'mydrawings'}
						onClearSelectionOverlays={this.clearSelectionOverlaysInDrawLayer}
						measureRef={this.measureRef}
						onMeasurementSystemControl={this.onMeasurementSystemControl}
						sketchViewModel={this.sketchViewModel}
						featureFlags={{
							enableImport: this.props.config.enableMyDrawingsImport !== false,
							enableExport: this.props.config.enableMyDrawingsExport !== false,
							enableLock: this.props.config.enableMyDrawingsLock !== false,
							enableGroup: this.props.config.enableMyDrawingsGroup !== false,
							enableMerge: this.props.config.enableMyDrawingsMerge !== false,
							enableDuplicate: this.props.config.enableMyDrawingsDuplicate !== false,
							enableZoomTo: this.props.config.enableMyDrawingsZoomTo !== false,
							enableProperties: this.props.config.enableMyDrawingsProperties !== false,
							enableSort: this.props.config.enableMyDrawingsSort !== false,
							maxDrawings: this.props.config.maxDrawings ?? 0,
						}}
					/>
				)}
			</div>
		);
	}

	renderDrawPanel() {
		const { config } = this.props;
		const {
			showSymPreview, showTextPreview, drawGLLengthcheck, canRedo, canUndo,
			fontColor, fontSize, fontHaloEnabled, fontHaloColor, fontHaloSize, textSymPreviewText,
			currentSymbol, undoBtnActive, redoBtnActive, clearBtnActive, clearBtnTitle, pointBtnActive,
			lineBtnActive, flineBtnActive, rectBtnActive, polygonBtnActive, fpolygonBtnActive, circleBtnActive,
			textBtnActive, fontHalo, fontWeight, fontDecoration, fontStyle, fontRotation,
			vAlignBaseBtnActive, vAlignBotBtnActive, vAlignMidBtnActive, vAlignTopBtnActive,
			textPreviewHeight, hAlignLeftBtnActive, hAlignCenterBtnActive, hAlignRightBtnActive,
			fsBoldBtnActive, fsItalicBtnActive, fsUnderlineBtnActive, currentSymbolType, textPreviewisOpen,
			fontOpacity, fontHaloOpacity, textHasChanged
		} = this.state;

		const isDrawingActive = pointBtnActive || lineBtnActive || flineBtnActive ||
			rectBtnActive || polygonBtnActive || fpolygonBtnActive || circleBtnActive || textBtnActive ||
			this.state.triangleActive || this.state.curveToolActive;

		if (this.props.config.identifyWidgetId) MutableStoreManager.getInstance().updateStateValue(this.props.config.identifyWidgetId, 'drawActive', isDrawingActive ? 'drawing' : 'not drawing')

		return (
			<div
				className="draw-panel-content"
				role="region"
				aria-label="Drawing tools panel"
			>
				{/* Mode Message - Live region for screen reader announcements */}
				<div
					className="mode-message text-center mb-3"
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					{!isDrawingActive ? (
						<div>
							{this.drawLayer?.graphics.length > 0 ? (
								<div>
									<h5 id="mode-heading">Edit Mode</h5>
									<h6 aria-describedby="mode-heading">Select a Drawing Style to Enter Drawing Mode.</h6>
								</div>
							) : (
								<div>
									<h5 id="mode-heading">No Drawings Yet - {this.nls('widgetLoadError')}</h5>
									<h6 aria-describedby="mode-heading">Select a Drawing Style to Get Started.</h6>
								</div>
							)}
						</div>
					) : (
						<div>
							<h5 id="mode-heading">Drawing Mode</h5>
							<h6 aria-describedby="mode-heading">Click the Active Drawing Style Button to Exit Drawing Mode and Activate Editing Mode.</h6>
						</div>
					)}
				</div>

				{/* Drawing Buttons - Toolbar */}
				<div
					className="drawing-tools-section mb-3"
					role="region"
					aria-label="Drawing tools"
				>
					{this.state.curveToolActive && (
						<div
							role="status"
							aria-live="polite"
							style={{ margin: '0 0 8px', padding: '6px 10px', borderRadius: 4, background: 'var(--light-200, #f0f0f0)', color: 'var(--dark-800, #2b2b2b)', borderLeft: '3px solid var(--primary-600, #2e7d9a)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
						>
							<span style={{ flex: '1 1 auto', minWidth: 0 }}>{this.state.curveHint}</span>
							<Button size="sm" type="default" onClick={() => { const v = this.state.currentJimuMapView?.view; if (v) this._undoCurvePoint(v); }}>Undo Last Point</Button>
							<Button size="sm" type="primary" onClick={() => { const v = this.state.currentJimuMapView?.view; if (v) this._finishCurveButton(v); else this._deactivateCurveTool(); }}>Finish</Button>
							<Button size="sm" type="default" onClick={() => this._deactivateCurveTool()}>Cancel</Button>
						</div>
					)}
					<div className="d-flex justify-content-center">
						<div
							className="drawToolbarDiv d-flex flex-column"
							role="toolbar"
							aria-label="Drawing shape tools"
						>
							<div
								className="buttonRow"
								role="group"
								aria-label="Point and line drawing tools"
							>
								{config.enablePointTool !== false && (
									<Button
										size="sm"
										type="default"
										color={pointBtnActive ? 'primary' : 'default'}
										active={pointBtnActive}
										onClick={() => this.setDrawToolBtnState('point')}
										title={this.nls('drawPoint')}
										aria-label={`Draw point marker${pointBtnActive ? ' - currently active' : ''}`}
										aria-pressed={pointBtnActive}
										aria-describedby="mode-heading"
									>
										<Icon icon={pinIcon} aria-hidden="true" />
										<span className="sr-only">Point marker tool</span>
									</Button>
								)}
								{config.enablePolylineTool !== false && (
									<Button
										size="sm"
										type="default"
										color={lineBtnActive ? 'primary' : 'default'}
										active={lineBtnActive}
										onClick={() => this.setDrawToolBtnState('polyline')}
										title={this.nls('drawLine')}
										aria-label={`Draw line${lineBtnActive ? ' - currently active' : ''}`}
										aria-pressed={lineBtnActive}
									>
										<Icon icon={lineIcon} aria-hidden="true" />
										<span className="sr-only">Line tool</span>
									</Button>
								)}
								{config.enableCurveTools !== false && (
									<div
										style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
										onMouseEnter={() => this.setState({ showCurveMenu: true })}
										onMouseLeave={() => this.setState({ showCurveMenu: false })}
									>
										<Button
											size="sm"
											type="default"
											color={this.state.curveToolActive ? 'primary' : 'default'}
											active={!!this.state.curveToolActive}
											onClick={() => this.setState({ showCurveMenu: !this.state.showCurveMenu })}
											title="True-curve line tools (arc, endpoint arc, bézier)"
											aria-label="Curve line tools"
											aria-haspopup="true"
											aria-expanded={!!this.state.showCurveMenu}
										>
											<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 13 C 4 13, 5 3, 8 3 S 12 13, 15 13" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
											<span className="sr-only">Curve line tools</span>
										</Button>
										{this.state.showCurveMenu && (
											<div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', background: 'var(--white, #fff)', border: '1px solid var(--light-300, #ccc)', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.25)', minWidth: 160, overflow: 'hidden' }}>
												<Button size="sm" type="default" color={this.state.currentTool === 'arc' ? 'primary' : 'default'} active={this.state.currentTool === 'arc'} style={{ display: 'block', width: '100%', margin: 0, boxSizing: 'border-box', borderRadius: 0, textAlign: 'left', whiteSpace: 'nowrap' }} onClick={() => this.startCurveTool('arc')} title="Click start, a point on the curve, then end. Keeps adding connected arc segments.">Arc Segment</Button>
												<Button size="sm" type="default" color={this.state.currentTool === 'endpointArc' ? 'primary' : 'default'} active={this.state.currentTool === 'endpointArc'} style={{ display: 'block', width: '100%', margin: 0, boxSizing: 'border-box', borderRadius: 0, textAlign: 'left', whiteSpace: 'nowrap' }} onClick={() => this.startCurveTool('endpointArc')} title="Click start, end, then move out to set the radius.">Endpoint Arc</Button>
												<Button size="sm" type="default" color={this.state.currentTool === 'bezier' ? 'primary' : 'default'} active={this.state.currentTool === 'bezier'} style={{ display: 'block', width: '100%', margin: 0, boxSizing: 'border-box', borderRadius: 0, textAlign: 'left', whiteSpace: 'nowrap' }} onClick={() => this.startCurveTool('bezier')} title="Click start, end, control 1, control 2.">Bézier Curve</Button>
											</div>
										)}
									</div>
								)}
								{config.enableFreePolylineTool !== false && (
									<Button
										size="sm"
										type="default"
										color={flineBtnActive ? 'primary' : 'default'}
										active={flineBtnActive}
										onClick={() => this.setDrawToolBtnState('freepolyline')}
										title={this.nls('drawFreeLine')}
										aria-label={`Draw freehand line${flineBtnActive ? ' - currently active' : ''}`}
										aria-pressed={flineBtnActive}
									>
										<Icon icon={curveIcon} aria-hidden="true" />
										<span className="sr-only">Freehand line tool</span>
									</Button>
								)}
								{config.enableTextTool !== false && (
									<Button
										size="sm"
										type="default"
										color={textBtnActive ? 'primary' : 'default'}
										active={textBtnActive}
										onClick={() => this.setDrawToolBtnState('text')}
										title={this.nls('drawText')}
										aria-label={`Add text annotation${textBtnActive ? ' - currently active' : ''}`}
										aria-pressed={textBtnActive}
									>
										<Icon icon={textIcon} aria-hidden="true" />
										<span className="sr-only">Text annotation tool</span>
									</Button>
								)}
							</div>
							<div
								className="buttonRow"
								role="group"
								aria-label="Shape drawing tools"
							>
								{config.enableRectangleTool !== false && (
									<Button
										size="sm"
										type="default"
										color={rectBtnActive ? 'primary' : 'default'}
										active={rectBtnActive}
										onClick={() => this.setDrawToolBtnState('extent')}
										title={this.nls('drawRectangle')}
										aria-label={`Draw rectangle${rectBtnActive ? ' - currently active' : ''}`}
										aria-pressed={rectBtnActive}
									>
										<Icon icon={rectIcon} aria-hidden="true" />
										<span className="sr-only">Rectangle tool</span>
									</Button>
								)}
								{config.enablePolygonTool !== false && (
									<Button
										size="sm"
										type="default"
										color={polygonBtnActive ? 'primary' : 'default'}
										active={polygonBtnActive}
										onClick={() => this.setDrawToolBtnState('polygon')}
										title={this.nls('drawPolygon')}
										aria-label={`Draw polygon${polygonBtnActive ? ' - currently active' : ''}`}
										aria-pressed={polygonBtnActive}
									>
										<Icon icon={polyIcon} aria-hidden="true" />
										<span className="sr-only">Polygon tool</span>
									</Button>
								)}
								{config.enableFreePolygonTool !== false && (
									<Button
										size="sm"
										type="default"
										color={fpolygonBtnActive ? 'primary' : 'default'}
										active={fpolygonBtnActive}
										onClick={() => this.setDrawToolBtnState('freepolygon')}
										title={this.nls('drawFreePolygon')}
										aria-label={`Draw freehand polygon${fpolygonBtnActive ? ' - currently active' : ''}`}
										aria-pressed={fpolygonBtnActive}
									>
										<Icon icon={freePolyIcon} aria-hidden="true" />
										<span className="sr-only">Freehand polygon tool</span>
									</Button>
								)}
								{config.enableCircleTool !== false && (
									<Button
										size="sm"
										type="default"
										color={circleBtnActive ? 'primary' : 'default'}
										active={circleBtnActive}
										onClick={() => this.setDrawToolBtnState('circle')}
										title={this.nls('drawCircle')}
										aria-label={`Draw circle${circleBtnActive ? ' - currently active' : ''}`}
										aria-pressed={circleBtnActive}
									>
										<Icon icon={circleIcon} aria-hidden="true" />
										<span className="sr-only">Circle tool</span>
									</Button>
								)}
								{config.enableTriangleTool !== false && (
									<Button
										size="sm"
										type="default"
										color={this.state.triangleActive ? 'primary' : 'default'}
										active={!!this.state.triangleActive}
										onClick={() => { if (this.state.triangleActive) { this._deactivateTriangleTool(); } else { this.startTriangleTool(); } }}
										title="Draw equilateral triangle (click center, then click to set size)"
										aria-label={`Draw triangle${this.state.triangleActive ? ' - currently active' : ''}`}
										aria-pressed={!!this.state.triangleActive}
									>
										<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 L15 14 L1 14 Z" fill="currentColor" /></svg>
										<span className="sr-only">Triangle tool</span>
									</Button>
								)}
							</div>
						</div>
					</div>
				</div>

				{/* Copy from Map - Two buttons: Copy (click-first) and Copy From (layer-first) */}
				{config.enableCopyFromMap !== false && (
					<div className="d-flex flex-column align-items-center mb-1" style={{ position: 'relative' }}>
						{/* Two separate buttons */}
						<div className="d-flex" style={{ gap: '4px' }}>
							{/* Copy — click-first mode (original behavior) */}
							<Button
								size="sm"
								type={(this.state.copyModeActive && !this.state.selectedCopyLayerId) || this.state.showCopyModePrompt ? 'primary' : 'default'}
								onClick={() => {
									if (this.state.showCopyModePrompt) {
										this.setState({ showCopyModePrompt: false, copyModePromptContext: null });
										return;
									}
									if (this.state.showCopyLayerDropdown) {
										this.setState({ showCopyLayerDropdown: false, copyableLayers: [] });
									}
									if (this.state.copyModeActive) {
										this.deactivateCopyMode();
									} else {
										this.activateCopyMode();
									}
								}}
								title={this.state.copyModeActive && !this.state.selectedCopyLayerId
									? "Click on a feature to copy, or press Esc to cancel"
									: "Click on any feature in the map to copy it into your drawings"}
								aria-label={this.state.copyModeActive && !this.state.selectedCopyLayerId
									? "Cancel copy mode"
									: "Copy feature from map"}
							>
								<span className="d-flex align-items-center">
									<CopyOutlined aria-hidden="true" style={{ marginRight: '4px' }} />
									{this.state.copyModeActive && !this.state.selectedCopyLayerId
										? (this.state.copySelectionMode === 'multiple' ? 'Selecting...' : 'Copying...')
										: this.nls('copy')}
								</span>
							</Button>
							{/* Copy From — layer-first mode */}
							<Button
								size="sm"
								type={this.state.showCopyLayerDropdown || (this.state.copyModeActive && !!this.state.selectedCopyLayerId) ? 'primary' : 'default'}
								onClick={() => {
									if (this.state.showCopyModePrompt) {
										this.setState({ showCopyModePrompt: false, copyModePromptContext: null });
										return;
									}
									if (this.state.copyModeActive) {
										this.deactivateCopyMode();
									}
									if (this.state.showCopyLayerDropdown) {
										this.setState({ showCopyLayerDropdown: false, copyableLayers: [] });
									} else {
										this.toggleCopyLayerDropdown();
									}
								}}
								title={this.state.copyModeActive && !!this.state.selectedCopyLayerId
									? "Click on a feature to copy, or press Esc to cancel"
									: "Choose a layer first, then click a feature to copy"}
								aria-label={this.state.copyModeActive && !!this.state.selectedCopyLayerId
									? "Cancel copy from layer mode"
									: "Copy from a specific layer"}
								aria-expanded={this.state.showCopyLayerDropdown}
								aria-haspopup="listbox"
							>
								<span className="d-flex align-items-center">
									<CopyOutlined aria-hidden="true" style={{ marginRight: '4px' }} />
									{this.state.copyModeActive && !!this.state.selectedCopyLayerId
										? (this.state.copySelectionMode === 'multiple' ? 'Selecting...' : 'Copying...')
										: 'Copy From ▾'}
								</span>
							</Button>
						</div>

						{/* Single/Multiple selection mode prompt */}
						{this.state.showCopyModePrompt && (() => {
							const isLayerFirst = this.state.copyModePromptContext === 'layer-first';
							const onSelect = isLayerFirst
								? (mode: 'single' | 'multiple') => this.enterCopyModeForLayer(mode)
								: (mode: 'single' | 'multiple') => this.enterCopyMode(mode);

							return (
								<div>
									{/* Backdrop */}
									<div
										style={{
											position: 'fixed',
											top: 0, left: 0, right: 0, bottom: 0,
											zIndex: 999
										}}
										onClick={() => this.setState({ showCopyModePrompt: false, copyModePromptContext: null })}
									/>
									<div
										style={{
											position: 'absolute',
											top: '100%',
											left: '50%',
											transform: 'translateX(-50%)',
											marginTop: '4px',
											background: '#fff',
											borderRadius: '6px',
											boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
											border: '1px solid #d0d0d0',
											minWidth: '200px',
											zIndex: 1000,
											overflow: 'hidden'
										}}
										role="dialog"
										aria-label="Choose selection mode"
										aria-modal="true"
									>
										{/* Header */}
										<div style={{
											padding: '8px 12px',
											borderBottom: '1px solid #e8e8e8',
											display: 'flex',
											justifyContent: 'space-between',
											alignItems: 'center',
											background: '#fafafa'
										}}>
											<span style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>
												Selection Mode
											</span>
											<button
												onClick={() => this.setState({ showCopyModePrompt: false, copyModePromptContext: null })}
												style={{
													background: 'none', border: 'none', cursor: 'pointer',
													padding: '2px 4px', fontSize: '14px', color: '#999', lineHeight: 1
												}}
												aria-label="Close selection mode picker"
												title="Close"
											>✕</button>
										</div>

										{/* Single option */}
										<div
											style={{
												padding: '8px 12px',
												cursor: 'pointer',
												fontSize: '12px',
												display: 'flex',
												alignItems: 'center',
												gap: '10px',
												transition: 'background 0.1s',
												borderBottom: '1px solid #f0f0f0'
											}}
											onClick={() => onSelect('single')}
											onMouseEnter={(e) => e.currentTarget.style.background = '#e6f4ff'}
											onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
											role="option"
											tabIndex={0}
											onKeyDown={(e) => e.key === 'Enter' && onSelect('single')}
											aria-label="Single feature selection"
										>
											<span style={{
												width: '28px', height: '28px',
												borderRadius: '50%',
												background: '#e6f4ff',
												display: 'flex', alignItems: 'center', justifyContent: 'center',
												flexShrink: 0
											}}>
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
													<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
													<path d="M13 13l6 6" />
												</svg>
											</span>
											<div>
												<div style={{ fontWeight: 600, color: '#333' }}>Single</div>
												<div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>Click one feature to copy</div>
											</div>
										</div>

										{/* Multiple option */}
										<div
											style={{
												padding: '8px 12px',
												cursor: 'pointer',
												fontSize: '12px',
												display: 'flex',
												alignItems: 'center',
												gap: '10px',
												transition: 'background 0.1s'
											}}
											onClick={() => onSelect('multiple')}
											onMouseEnter={(e) => e.currentTarget.style.background = '#e6f4ff'}
											onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
											role="option"
											tabIndex={0}
											onKeyDown={(e) => e.key === 'Enter' && onSelect('multiple')}
											aria-label="Multiple feature selection"
										>
											<span style={{
												width: '28px', height: '28px',
												borderRadius: '50%',
												background: '#f0fdf4',
												display: 'flex', alignItems: 'center', justifyContent: 'center',
												flexShrink: 0
											}}>
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
													<rect x="3" y="3" width="7" height="7" rx="1" />
													<rect x="14" y="3" width="7" height="7" rx="1" />
													<rect x="3" y="14" width="7" height="7" rx="1" />
													<rect x="14" y="14" width="7" height="7" rx="1" />
												</svg>
											</span>
											<div>
												<div style={{ fontWeight: 600, color: '#333' }}>Multiple</div>
												<div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>Click several features, then press Done</div>
											</div>
										</div>
									</div>
								</div>
							);
						})()}

						{/* Multi-copy selection status bar */}
						{this.state.copySelectionMode === 'multiple' && this.state.copyModeActive && (
							<div style={{
								marginTop: '6px',
								padding: '8px 10px',
								borderRadius: '6px',
								background: '#f0fdf4',
								border: '1px solid #bbf7d0',
								display: 'flex',
								flexDirection: 'column',
								gap: '6px',
								fontSize: '12px'
							}}
								role="status"
								aria-live="polite"
							>
								{/* Top row: count + Done/Cancel */}
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span style={{
										background: '#16a34a',
										color: '#fff',
										borderRadius: '50%',
										width: '22px',
										height: '22px',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										fontSize: '11px',
										fontWeight: 700,
										flexShrink: 0
									}}>
										{this.state.multiCopySelectedFeatures.length}
									</span>
									<span style={{ flex: 1, color: '#166534', fontWeight: 500 }}>
										feature{this.state.multiCopySelectedFeatures.length !== 1 ? 's' : ''} selected
									</span>
									<Button
										size="sm"
										type="primary"
										onClick={this.confirmMultiCopy}
										disabled={this.state.multiCopySelectedFeatures.length === 0}
										style={{ fontSize: '11px', padding: '2px 10px' }}
										title="Copy each selected feature as a separate drawing"
										aria-label={`Copy ${this.state.multiCopySelectedFeatures.length} features as separate drawings`}
									>
										Copy
									</Button>
									<Button
										size="sm"
										type="default"
										onClick={this.confirmMultiCopyMerged}
										disabled={(() => {
											if (this.state.multiCopySelectedFeatures.length < 2) return true;
											const types = new Set(
												this.state.multiCopySelectedFeatures
													.map(f => f.geometryType === 'extent' ? 'polygon' : f.geometryType)
													.filter(Boolean)
											);
											return types.size > 1;
										})()}
										style={{ fontSize: '11px', padding: '2px 10px' }}
										title={(() => {
											if (this.state.multiCopySelectedFeatures.length < 2) return 'Select at least 2 features to merge';
											const types = new Set(
												this.state.multiCopySelectedFeatures
													.map(f => f.geometryType === 'extent' ? 'polygon' : f.geometryType)
													.filter(Boolean)
											);
											if (types.size > 1) return `Cannot merge mixed types (${Array.from(types).join(', ')}) — use Copy instead`;
											return 'Merge all selected features into a single drawing';
										})()}
										aria-label={`Merge ${this.state.multiCopySelectedFeatures.length} features into one drawing`}
									>
										Merge
									</Button>
									<Button
										size="sm"
										type="default"
										onClick={this.cancelMultiCopy}
										style={{ fontSize: '11px', padding: '2px 8px' }}
										title="Cancel multi-select copy"
										aria-label="Cancel multi-select copy"
									>
										Cancel
									</Button>
								</div>
								{/* Hint when nothing selected yet */}
								{this.state.multiCopySelectedFeatures.length === 0 && !this.state.multiCopySpatialTool && (
									<div style={{
										borderTop: '1px solid #bbf7d0',
										paddingTop: '6px',
										fontSize: '11px',
										color: '#166534',
										display: 'flex',
										alignItems: 'center',
										gap: '5px'
									}}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
											<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
										</svg>
										Click features on the map to select them one at a time
									</div>
								)}
								{/* Spatial selection tools */}
								<div style={{
									display: 'flex',
									alignItems: 'center',
									gap: '4px',
									borderTop: '1px solid #bbf7d0',
									paddingTop: '6px'
								}}>
									<span style={{ fontSize: '11px', color: '#166534', marginRight: '2px' }}>Select by:</span>
									<button
										onClick={() => this.startSpatialSelection('rectangle')}
										disabled={this.state.multiCopySpatialTool != null}
										style={{
											display: 'flex', alignItems: 'center', gap: '4px',
											padding: '3px 8px', fontSize: '11px', fontWeight: 500,
											border: this.state.multiCopySpatialTool === 'rectangle' ? '1px solid #16a34a' : '1px solid #86efac',
											borderRadius: '4px', cursor: this.state.multiCopySpatialTool ? 'default' : 'pointer',
											background: this.state.multiCopySpatialTool === 'rectangle' ? '#dcfce7' : '#fff',
											color: '#166534', transition: 'all 0.15s'
										}}
										title="Draw a rectangle to select features within it"
										aria-label="Select features by rectangle"
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
											<rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2" />
										</svg>
										Rectangle
									</button>
									<button
										onClick={() => this.startSpatialSelection('polygon')}
										disabled={this.state.multiCopySpatialTool != null}
										style={{
											display: 'flex', alignItems: 'center', gap: '4px',
											padding: '3px 8px', fontSize: '11px', fontWeight: 500,
											border: this.state.multiCopySpatialTool === 'polygon' ? '1px solid #16a34a' : '1px solid #86efac',
											borderRadius: '4px', cursor: this.state.multiCopySpatialTool ? 'default' : 'pointer',
											background: this.state.multiCopySpatialTool === 'polygon' ? '#dcfce7' : '#fff',
											color: '#166534', transition: 'all 0.15s'
										}}
										title="Draw a polygon to select features within it"
										aria-label="Select features by polygon"
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
											<path d="M12 2l8 6-3 10H7L4 8z" strokeDasharray="4 2" />
										</svg>
										Polygon
									</button>
									{this.state.multiCopySpatialTool && (
										<button
											onClick={() => {
												this.cleanupSpatialSelectSketch();
												this.setState({ multiCopySpatialTool: null });
												const v = this.state.currentJimuMapView?.view;
												if (v) v.container.style.cursor = 'copy';
											}}
											style={{
												padding: '3px 6px', fontSize: '11px',
												border: '1px solid #fecaca', borderRadius: '4px',
												background: '#fef2f2', color: '#991b1b', cursor: 'pointer'
											}}
											title="Switch back to clicking features one at a time"
											aria-label="Switch to individual feature selection"
										>
											One at a Time
										</button>
									)}
								</div>
								{/* Warning when spatial tools activated in click-first (Copy) mode only */}
								{this.state.multiCopySpatialTool && !this.state.selectedCopyLayerId && (
									<div style={{
										fontSize: '11px',
										color: '#92400e',
										background: '#fffbeb',
										border: '1px solid #fde68a',
										borderRadius: '4px',
										padding: '5px 8px',
										display: 'flex',
										alignItems: 'flex-start',
										gap: '5px',
										lineHeight: '1.4'
									}}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
											<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
											<line x1="12" y1="9" x2="12" y2="13" />
											<line x1="12" y1="17" x2="12.01" y2="17" />
										</svg>
										<span>This may select many features. For bulk area selection, consider using <strong>Copy From</strong> instead.</span>
									</div>
								)}
							</div>
						)}

						{/* Layer selection dropdown - flat list in published map order */}
						{this.state.showCopyLayerDropdown && (() => {
							const layers = this.state.copyableLayers;
							const hasLayers = layers.length > 0;

							return (
								<div>
									{/* Backdrop */}
									<div
										style={{
											position: 'fixed',
											top: 0, left: 0, right: 0, bottom: 0,
											zIndex: 999
										}}
										onClick={() => this.setState({ showCopyLayerDropdown: false, copyableLayers: [] })}
									/>
									<div
										style={{
											position: 'absolute',
											top: '100%',
											left: '50%',
											transform: 'translateX(-50%)',
											marginTop: '4px',
											background: '#fff',
											borderRadius: '6px',
											boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
											border: '1px solid #d0d0d0',
											minWidth: '220px',
											maxWidth: '300px',
											zIndex: 1000,
											overflow: 'hidden',
											display: 'flex',
											flexDirection: 'column'
										}}
										role="listbox"
										aria-label="Select a layer to copy features from"
									>
										{/* Header */}
										<div style={{
											padding: '8px 12px',
											borderBottom: '1px solid #e8e8e8',
											display: 'flex',
											justifyContent: 'space-between',
											alignItems: 'center',
											background: '#fafafa'
										}}>
											<span style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>
												Copy from Layer
											</span>
											<button
												onClick={() => this.setState({ showCopyLayerDropdown: false, copyableLayers: [] })}
												style={{
													background: 'none', border: 'none', cursor: 'pointer',
													padding: '2px 4px', fontSize: '14px', color: '#999', lineHeight: 1
												}}
												aria-label="Close layer picker"
												title="Close"
											>
												✕
											</button>
										</div>

										{/* Layer list in published map order */}
										<div style={{ maxHeight: '300px', overflowY: 'auto' }}>
											{!hasLayers && (
												<div style={{ padding: '16px', textAlign: 'center', color: '#999', fontSize: '12px' }}>
													No copyable layers found.<br />
													<span style={{ fontSize: '11px' }}>Make sure layers are visible on the map.</span>
												</div>
											)}
											{layers.map(layer => (
												<div
													key={layer.id}
													style={{
														padding: '8px 12px',
														cursor: 'pointer',
														fontSize: '12px',
														borderBottom: '1px solid #f0f0f0',
														display: 'flex',
														flexDirection: layer.parentTitle ? 'column' : 'row',
														alignItems: layer.parentTitle ? 'flex-start' : 'center',
														gap: layer.parentTitle ? '2px' : '8px',
														transition: 'background 0.1s'
													}}
													onClick={() => this.selectCopySourceLayer(layer.id)}
													onKeyDown={(e) => e.key === 'Enter' && this.selectCopySourceLayer(layer.id)}
													onMouseEnter={(e) => e.currentTarget.style.background = '#e6f4ff'}
													onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
													role="option"
													tabIndex={0}
													title={`Select ${layer.title} to copy features from`}
													aria-label={layer.parentTitle ? `${layer.title} from ${layer.parentTitle}` : layer.title}
												>
													<span style={{
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														whiteSpace: 'nowrap',
														flex: 1,
														color: '#333'
													}}>
														{layer.title}
													</span>
													{layer.parentTitle && (
														<span style={{
															fontSize: '10px',
															color: '#999',
															overflow: 'hidden',
															textOverflow: 'ellipsis',
															whiteSpace: 'nowrap'
														}}>
															{layer.parentTitle}
														</span>
													)}
												</div>
											))}
										</div>
									</div>
								</div>
							);
						})()}

						{/* Feature picker (multiple features at click location) */}
						{this.state.showCopyPicker && this.state.copyFeatureCandidates.length > 0 && (() => {
							const candidates = this.state.copyFeatureCandidates;
							const filterText = (this.state.copyPickerFilter || '').toLowerCase().trim();
							const isLayerFirstMode = !!this.state.selectedCopyLayerId;

							// Helper: get a short feature identifier from attributes
							const getFeatureLabel = (graphic: any, idx: number): string => {
								const attrs = graphic?.attributes;
								if (!attrs) return `Feature ${idx + 1}`;
								const nameFields = ['Name', 'NAME', 'name', 'LABEL', 'Label', 'label', 'FACILITYID', 'FacilityID', 'ADDRESS', 'Address', 'STREET', 'Street'];
								for (const field of nameFields) {
									if (attrs[field] != null && String(attrs[field]).trim() !== '') {
										return String(attrs[field]);
									}
								}
								const oidFields = ['OBJECTID', 'objectid', 'ObjectID', 'FID', 'fid', 'OID'];
								for (const field of oidFields) {
									if (attrs[field] != null) {
										return `OID: ${attrs[field]}`;
									}
								}
								return `Feature ${idx + 1}`;
							};

							// Helper: geometry type badge
							const geomBadge = (geomType: string) => {
								const labels: Record<string, string> = {
									'point': 'Pt', 'multipoint': 'MPt', 'polyline': 'Line',
									'polygon': 'Poly', 'extent': 'Rect', 'rectangle': 'Rect', 'circle': 'Circle'
								};
								return labels[geomType] || geomType.charAt(0).toUpperCase();
							};

							// Render a single feature row
							const renderFeatureRow = (candidate: typeof candidates[0], index: number, indent: boolean = false) => {
								const featureLabel = getFeatureLabel(candidate.graphic, index);
								const badge = geomBadge(candidate.geometryType);
								return (
									<div
										key={index}
										style={{
											padding: indent ? '6px 10px 6px 18px' : '8px 12px',
											cursor: 'pointer',
											fontSize: '12px',
											borderBottom: '1px solid #f5f5f5',
											display: 'flex',
											alignItems: 'center',
											gap: '6px',
											transition: 'background 0.1s'
										}}
										onClick={() => this.selectCopyCandidate(candidate)}
										onKeyDown={(e) => e.key === 'Enter' && this.selectCopyCandidate(candidate)}
										onMouseEnter={(e) => {
											e.currentTarget.style.background = '#e6f4ff';
											this.showCopyHighlight(candidate.graphic.geometry);
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = '#fff';
											this.removeCopyHighlight();
										}}
										role="option"
										tabIndex={0}
										title={`Copy ${featureLabel}`}
										aria-label={`${featureLabel} - ${badge} type${!isLayerFirstMode ? ` - from ${candidate.layerTitle}` : ''}`}
									>
										<span style={{
											background: '#e8e8e8', borderRadius: '3px', padding: '1px 4px',
											fontSize: '9px', fontWeight: 600, color: '#777', flexShrink: 0, fontFamily: 'monospace'
										}}>
											{badge}
										</span>
										<span style={{
											overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: '#333'
										}}>
											{featureLabel}
										</span>
									</div>
								);
							};

							// Click-first mode: group by layer with filter on layer name + attributes
							// Layer-first mode: flat list with filter on attributes only
							if (!isLayerFirstMode) {
								// GROUP BY LAYER (click-first / original behavior)
								const grouped: Map<string, Array<{ candidate: typeof candidates[0]; index: number }>> = new Map();
								candidates.forEach((candidate, index) => {
									const key = candidate.layerTitle || 'Unknown Layer';
									if (!grouped.has(key)) grouped.set(key, []);
									grouped.get(key)!.push({ candidate, index });
								});

								const filteredGroups: Map<string, Array<{ candidate: typeof candidates[0]; index: number }>> = new Map();
								grouped.forEach((items, layerName) => {
									if (filterText === '') {
										filteredGroups.set(layerName, items);
									} else {
										const matchingItems = items.filter(({ candidate }) => {
											if (layerName.toLowerCase().includes(filterText)) return true;
											const attrs = candidate.graphic?.attributes;
											if (attrs) {
												return Object.values(attrs).some(v =>
													v != null && String(v).toLowerCase().includes(filterText)
												);
											}
											return false;
										});
										if (matchingItems.length > 0) filteredGroups.set(layerName, matchingItems);
									}
								});

								const totalFiltered = Array.from(filteredGroups.values()).reduce((sum, items) => sum + items.length, 0);
								const showSearch = candidates.length > 5;

								return (
									<div>
										<div
											style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
											onClick={this.cancelCopyPicker}
										/>
										<div
											style={{
												position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
												marginTop: '4px', background: '#fff', borderRadius: '6px',
												boxShadow: '0 4px 16px rgba(0,0,0,0.18)', border: '1px solid #d0d0d0',
												minWidth: '240px', maxWidth: '320px', zIndex: 1000, overflow: 'hidden',
												display: 'flex', flexDirection: 'column'
											}}
											role="dialog" aria-label="Select a feature to copy" aria-modal="true"
										>
											{/* Header */}
											<div style={{
												padding: '8px 12px', borderBottom: '1px solid #e8e8e8',
												display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa'
											}}>
												<span style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>
													Select Feature to Copy ({candidates.length})
												</span>
												<button
													onClick={this.cancelCopyPicker}
													style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: '14px', color: '#999', lineHeight: 1 }}
													aria-label="Close feature picker" title="Close"
												>✕</button>
											</div>

											{showSearch && (
												<div style={{ padding: '6px 10px', borderBottom: '1px solid #e8e8e8' }}>
													<input
														type="text"
														placeholder="Filter by layer or feature name..."
														value={this.state.copyPickerFilter || ''}
														onChange={(e) => this.setState({ copyPickerFilter: e.target.value })}
														style={{
															width: '100%', padding: '5px 8px', border: '1px solid #d9d9d9',
															borderRadius: '3px', fontSize: '12px', outline: 'none', boxSizing: 'border-box'
														}}
														aria-label="Filter features" autoFocus
													/>
												</div>
											)}

											<div style={{ maxHeight: '280px', overflowY: 'auto', overflowX: 'hidden' }} role="listbox" aria-label="Features grouped by layer">
												{filteredGroups.size === 0 && (
													<div style={{ padding: '12px', textAlign: 'center', color: '#999', fontSize: '12px' }}>No matching features</div>
												)}
												{Array.from(filteredGroups.entries()).map(([layerName, items], groupIdx) => (
													<div key={layerName}>
														<div style={{
															padding: '6px 10px', background: '#f5f5f5', borderBottom: '1px solid #e8e8e8',
															borderTop: groupIdx > 0 ? '1px solid #e0e0e0' : 'none',
															fontSize: '11px', fontWeight: 600, color: '#555',
															display: 'flex', justifyContent: 'space-between', alignItems: 'center',
															position: 'sticky', top: 0, zIndex: 1
														}}>
															<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }} title={layerName}>
																{layerName}
															</span>
															<span style={{ background: '#d9d9d9', borderRadius: '8px', padding: '1px 6px', fontSize: '10px', color: '#666', flexShrink: 0 }}>
																{items.length}
															</span>
														</div>
														{items.map(({ candidate, index }) => renderFeatureRow(candidate, index, true))}
													</div>
												))}
											</div>

											{showSearch && filterText && (
												<div style={{ padding: '4px 10px', borderTop: '1px solid #e8e8e8', background: '#fafafa', fontSize: '10px', color: '#999', textAlign: 'center' }}>
													Showing {totalFiltered} of {candidates.length} features
												</div>
											)}
										</div>
									</div>
								);

							} else {
								// FLAT LIST (layer-first mode)
								const filteredCandidates = filterText === ''
									? candidates
									: candidates.filter(candidate => {
										const attrs = candidate.graphic?.attributes;
										if (attrs) {
											return Object.values(attrs).some(v =>
												v != null && String(v).toLowerCase().includes(filterText)
											);
										}
										return false;
									});

								const showSearch = candidates.length > 5;
								const layerTitle = candidates[0]?.layerTitle || 'Selected Layer';

								return (
									<div>
										<div
											style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
											onClick={this.cancelCopyPicker}
										/>
										<div
											style={{
												position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
												marginTop: '4px', background: '#fff', borderRadius: '6px',
												boxShadow: '0 4px 16px rgba(0,0,0,0.18)', border: '1px solid #d0d0d0',
												minWidth: '240px', maxWidth: '320px', zIndex: 1000, overflow: 'hidden',
												display: 'flex', flexDirection: 'column'
											}}
											role="dialog" aria-label="Select a feature to copy" aria-modal="true"
										>
											<div style={{
												padding: '8px 12px', borderBottom: '1px solid #e8e8e8',
												display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa'
											}}>
												<div style={{ flex: 1, minWidth: 0 }}>
													<span style={{ fontSize: '12px', fontWeight: 600, color: '#333', display: 'block' }}>
														Select Feature ({candidates.length})
													</span>
													<span style={{ fontSize: '10px', color: '#666', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
														from {layerTitle}
													</span>
												</div>
												<button
													onClick={this.cancelCopyPicker}
													style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: '14px', color: '#999', lineHeight: 1, flexShrink: 0 }}
													aria-label="Close feature picker" title="Close"
												>✕</button>
											</div>

											{showSearch && (
												<div style={{ padding: '6px 10px', borderBottom: '1px solid #e8e8e8' }}>
													<input
														type="text"
														placeholder="Filter features..."
														value={this.state.copyPickerFilter || ''}
														onChange={(e) => this.setState({ copyPickerFilter: e.target.value })}
														style={{
															width: '100%', padding: '5px 8px', border: '1px solid #d9d9d9',
															borderRadius: '3px', fontSize: '12px', outline: 'none', boxSizing: 'border-box'
														}}
														aria-label="Filter features" autoFocus
													/>
												</div>
											)}

											<div style={{ maxHeight: '280px', overflowY: 'auto', overflowX: 'hidden' }} role="listbox" aria-label="Features">
												{filteredCandidates.length === 0 && (
													<div style={{ padding: '12px', textAlign: 'center', color: '#999', fontSize: '12px' }}>No matching features</div>
												)}
												{filteredCandidates.map((candidate, index) => renderFeatureRow(candidate, index, false))}
											</div>

											{showSearch && filterText && (
												<div style={{ padding: '4px 10px', borderTop: '1px solid #e8e8e8', background: '#fafafa', fontSize: '10px', color: '#999', textAlign: 'center' }}>
													Showing {filteredCandidates.length} of {candidates.length} features
												</div>
											)}
										</div>
									</div>
								);
							}
						})()}
					</div>
				)}

				{/* Mailing Labels — send drawing geometry to Mailing Labels widget */}
				{this.props.config.enableMailingLabels && (
					<div className="d-flex flex-column align-items-center mb-1" style={{ gap: '2px', width: '100%' }}>
						<Button
							size="sm"
							type="default"
							onClick={this.sendToMailingLabels}
							disabled={this.getMainDrawings().length === 0}
							title={this.getMailingLabelsButtonTooltip()}
							aria-label="Send drawings to Mailing Labels"
							style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', width: '215px' }}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<rect x="2" y="4" width="20" height="16" rx="2" />
								<path d="M2 8l10 6 10-6" />
							</svg>
							{this.getMailingLabelsButtonText()}
						</Button>
						{this.getMainDrawings().length === 0 && (
							<span style={{ fontSize: '10px', color: '#999' }}>Draw a shape first</span>
						)}
					</div>
				)}

				{/* Identify By Query — send drawing geometry to Identify By Query widget */}
				{this.props.config.enableIdentifyByQuery && (
					<div className="d-flex flex-column align-items-center mb-1" style={{ gap: '2px', width: '100%' }}>
						<Button
							size="sm"
							type="default"
							onClick={this.sendToIdentifyByQuery}
							disabled={this.getMainDrawings().length === 0 || this.state.isActivelyDrawing}
							title={this.getIdentifyButtonTooltip()}
							aria-label="Send drawings to Identify By Query"
							style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', width: '215px' }}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<circle cx="11" cy="11" r="8" />
								<path d="M21 21l-4.35-4.35" />
								<circle cx="11" cy="11" r="3" />
							</svg>
							{this.getIdentifyButtonText()}
						</Button>
						{this.state.isActivelyDrawing && (
							<span style={{ fontSize: '10px', color: '#999' }}>Finish drawing first</span>
						)}
						{!this.state.isActivelyDrawing && this.getMainDrawings().length === 0 && (
							<span style={{ fontSize: '10px', color: '#999' }}>Draw a shape first</span>
						)}
					</div>
				)}
				{/* Toast notification for copy/paste feedback */}
				{this.state.copyPasteToast && (
					<div
						style={{
							padding: '8px 12px',
							borderRadius: '4px',
							fontSize: '12px',
							fontWeight: 500,
							display: 'flex',
							alignItems: 'center',
							gap: '6px',
							animation: 'fadeIn 0.2s ease-in',
							background: this.state.copyPasteToast.type === 'success' ? '#f0fdf4' :
								this.state.copyPasteToast.type === 'error' ? '#fef2f2' : '#eff6ff',
							color: this.state.copyPasteToast.type === 'success' ? '#166534' :
								this.state.copyPasteToast.type === 'error' ? '#991b1b' : '#1e40af',
							border: `1px solid ${this.state.copyPasteToast.type === 'success' ? '#bbf7d0' :
								this.state.copyPasteToast.type === 'error' ? '#fecaca' : '#bfdbfe'}`
						}}
						role="alert"
						aria-live="polite"
					>
						<span aria-hidden="true">
							{this.state.copyPasteToast.type === 'success' ? '✓' :
								this.state.copyPasteToast.type === 'error' ? '✕' : 'ℹ'}
						</span>
						<span style={{ flex: 1 }}>{this.state.copyPasteToast.message}</span>
						<button
							onClick={() => this.setState({ copyPasteToast: null })}
							style={{
								background: 'none', border: 'none', cursor: 'pointer',
								padding: '0 2px', fontSize: '14px', opacity: 0.6, lineHeight: 1,
								color: 'inherit'
							}}
							aria-label="Dismiss notification"
						>
							✕
						</button>
					</div>
				)}

				{/* Symbol Settings */}
				{config.enableSymbolEditor !== false && showSymPreview && this.sketchViewModel && this.renderSymbolSelectorSection()}

				{/* Text Symbol Settings */}
				{config.enableSymbolEditor !== false && showTextPreview && this.renderTextSymbolPreviewButton()}

				{/* Text Popper - This stays outside the scroll area for proper positioning */}
				{textPreviewisOpen && this.renderTextPopper()}

				{/* === MAIN CHECKBOX STACK: 20px between Measure / Tooltips / Snapping / Buffer === */}
				<div
					className="main-checkbox-stack"
					role="region"
					aria-label="Drawing options and settings"
				>
					{/* Measurements */}
					{config.enableMeasurements !== false && (
						<Measure
							ref={this.measureRef}
							nls={this.nls}
							config={config}
							drawLayer={this.drawLayer}
							currentTextSymbol={this.state.currentTextSymbol}
							sketchViewModel={this.sketchViewModel}
							currentTool={this.state.currentTool}
							showTextPreview={this.state.showTextPreview}
							currentSymbol={this.state.currentSymbol}
							isDrawingActive={isDrawingActive}
						/>
					)}

					{/* Enable Tooltips */}
					{config.enableSnapping !== false && (
						<SnappingControls
							jimuMapView={this.state.currentJimuMapView}
							sketchViewModel={this.sketchViewModel}
						/>
					)}

					{/* Buffer Controls - Hidden for text tool */}
					{config.enableBuffer !== false && !textBtnActive && (
						<BufferControls
							sketchViewModel={this.sketchViewModel}
							jimuMapView={this.state.currentJimuMapView}
							defaultDistance={this.props.config?.defaultBufferDistance}
							defaultUnit={this.props.config?.defaultBufferUnit}
							defaultOpacity={this.props.config?.defaultBufferOpacity}
							defaultColor={this.props.config?.defaultBufferColor}
						/>
					)}
				</div>
				<div
					className='d-flex flex-column justify-content-between'
					style={{ height: '150px' }}
					role="region"
					aria-label="Drawing actions toolbar"
				>
					{/* Bottom Toolbar */}
					<div
						className="drawToolbarBottomDiv"
						role="toolbar"
						aria-label="Undo, redo, and clear drawing actions"
					>

						{config.enableUndoRedo !== false && (canUndo || canRedo) && (
							<div
								className="d-flex gap-2"
								role="group"
								aria-label="Undo and redo actions"
							>
								<Button
									size="sm"
									type="secondary"
									active={undoBtnActive}
									onClick={this.drawUndoBtnClick}
									title={this.nls('drawUndo')}
									disabled={!canUndo}
									aria-label={`Undo last drawing action${!canUndo ? ' - no actions to undo' : ''}`}
									aria-disabled={!canUndo}
								>
									<ArrowUndoOutlined aria-hidden="true" /> Undo
								</Button>
								<Button
									size="sm"
									type="secondary"
									active={redoBtnActive}
									onClick={this.drawRedoBtnClick}
									title={this.nls('drawRedo')}
									disabled={!canRedo}
									aria-label={`Redo drawing action${!canRedo ? ' - no actions to redo' : ''}`}
									aria-disabled={!canRedo}
								>
									<ArrowRedoOutlined aria-hidden="true" /> Redo
								</Button>
							</div>
						)}

						{/* Clear Button Logic */}
						{this.state.clearBtnTitle === this.nls('drawClear') ? (
							(this.props.config.confirmBeforeClear !== false && this.state.confirmDelete) ? (
								<div
									className="d-flex gap-2"
									role="alertdialog"
									aria-label="Confirm delete all drawings"
									aria-describedby="confirm-delete-description"
								>
									<span id="confirm-delete-description" className="sr-only">
										Are you sure you want to delete all drawings? This action cannot be undone.
									</span>
									<Button
										size="sm"
										type="danger"
										active={clearBtnActive}
										onClick={() => this.drawClearBtnClick(true)}
										title={clearBtnTitle}
										aria-label="Confirm: Delete all drawings permanently"
									>
										<TrashOutlined aria-hidden="true" /> {clearBtnTitle}
									</Button>
									<Button
										size="sm"
										type="secondary"
										active={clearBtnActive}
										onClick={() => this.setState({ confirmDelete: false })}
										title="Cancel"
										aria-label="Cancel delete operation"
									>
										<WrongOutlined aria-hidden="true" /> Cancel
									</Button>
								</div>
							) : (
								<Button
									size="sm"
									type="secondary"
									active={clearBtnActive}
									onClick={() => {
										if (this.props.config.confirmBeforeClear === false) {
											this.drawClearBtnClick(true);
										} else {
											this.setState({ confirmDelete: true });
										}
									}}
									title={clearBtnTitle}
									disabled={!drawGLLengthcheck}
									aria-label={`Clear all drawings${!drawGLLengthcheck ? ' - no drawings to clear' : ''}`}
									aria-disabled={!drawGLLengthcheck}
								>
									<TrashOutlined aria-hidden="true" /> {clearBtnTitle}
								</Button>
							)
						) : (
							<Button
								size="sm"
								type="danger"
								active={clearBtnActive}
								onClick={() => this.drawClearBtnClick(false)}
								title={clearBtnTitle}
								aria-label={`Clear: ${clearBtnTitle}`}
							>
								<TrashOutlined aria-hidden="true" /> {clearBtnTitle}
							</Button>
						)}
					</div>
					{/* Draw Layer Settings */}
					{(this.props.config.changeListMode || this.props.config.changeTitle) && (
						<div
							className="drawToolbarDiv"
							role="region"
							aria-label="Draw layer configuration settings"
						>
							<CollapsablePanel
								label="Draw Layer Settings"
								leftIcon={SettingOutlined}
								aria-label="Expand or collapse draw layer settings"
							>
								<div role="group" aria-label="Layer title and visibility options">
									<Label
										className="w-100"
										id="draw-layer-title-label"
									>
										Draw Layer Title:
										<TextInput
											defaultValue={this.props.config.title}
											onChange={(e) => this.handleTitleChange(e)}
											type="text"
											allowClear
											required
											aria-labelledby="draw-layer-title-label"
											aria-describedby="draw-layer-title-hint"
											title="Enter a title for the draw layer that will appear in the map legend"
										/>
										<span id="draw-layer-title-hint" className="sr-only">
											This title will be displayed in the map layer list
										</span>
									</Label>
									<Label
										centric
										id="show-in-list-label"
									>
										<Checkbox
											checked={this.state.listMode === 'show'}
											onClick={(e) => this.handleListMode(e)}
											className="mr-2 mt-2 mb-2 ml-4"
											aria-labelledby="show-in-list-label"
											title="When checked, the draw layer will be visible in the map's layer list"
										/>
										Show In Map Layer List
									</Label>
								</div>
							</CollapsablePanel>
						</div>
					)}
				</div>
			</div>
		);
	}

	// Add the missing renderTextPopper method
	private renderTextPopper() {
		// Convert backgroundColor to string for style prop
		const backgroundColorString = this.state.fontBackgroundColor
			? (typeof this.state.fontBackgroundColor === 'string'
				? this.state.fontBackgroundColor
				: `rgba(${this.state.fontBackgroundColor.r}, ${this.state.fontBackgroundColor.g}, ${this.state.fontBackgroundColor.b}, ${this.state.fontBackgroundColor.a})`)
			: 'transparent';

		return (
			<Popper
				open={this.state.textPreviewisOpen}
				reference={this.props.widgetId + '_btnTextSymbol'}
				placement={'right-start'}
				showArrow={true}
				zIndex={1002}
				toggle={this.showTextSymbolPopper}
				style={{ width: '320px' }}
			>
				<div
					className='p-3 d-flex flex-column'
					role="dialog"
					aria-modal="true"
					aria-labelledby="text-popper-title"
					id="text-symbol-popper"
					style={{ width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}
				>
					<div role="region" aria-label="Text formatting controls">
						<h6 id="text-popper-title" className="sr-only">Text Symbol Formatting Options</h6>
						<div className="w-100 d-flex align-items-center mt-2 mb-2">
							<span style={{ flexShrink: 0, fontSize: "12px", color: "#555", marginRight: "8px" }}>Preview</span>
							<div
								role="img"
								aria-labelledby="preview-label"
								style={{
									flex: 1,
									minHeight: "36px",
									position: "relative",
									overflow: "hidden",
									backgroundColor: backgroundColorString,
									border: "1px solid #ccc",
									borderRadius: "3px",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									padding: "4px 6px",
									wordBreak: "break-word"
								}}
							>
								{/* halo layer — rendered first, behind main text */}
								{this.state.fontHalo && this.state.fontHalo !== "unset" && (
									<span aria-hidden="true" style={{
										position: "absolute",
										color: `${this.state.fontColor}`,
										fontSize: `${Math.min(Number(this.state.fontSize), 28)}px`,
										WebkitTextStroke: `${this.state.fontHalo}`,
										fontWeight: this.state.fontWeight === "normal" ? "normal" : "bold",
										fontStyle: this.state.fontStyle,
										fontFamily: this.state.currentTextSymbol.font.family,
										textDecoration: this.state.fontDecoration,
										whiteSpace: "nowrap",
										pointerEvents: "none",
										transform: `rotate(${this.state.fontRotation}deg)`
									}}>
										{this.state.textSymPreviewText}
									</span>
								)}
								{/* main text layer */}
								<span style={{
									position: "relative",
									color: `${this.state.fontColor}`,
									fontSize: `${Math.min(Number(this.state.fontSize), 28)}px`,
									fontWeight: this.state.fontWeight === "normal" ? "normal" : "bold",
									fontStyle: this.state.fontStyle,
									fontFamily: this.state.currentTextSymbol.font.family,
									textDecoration: this.state.fontDecoration,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									textAlign: "center",
									transform: `rotate(${this.state.fontRotation}deg)`
								}}>
									{this.state.textSymPreviewText}
								</span>
							</div>
						</div>
						<div className="w-100">
							<div className='w-100 d-flex justify-content-between align-items-center pb-2'>
								<textarea
									rows={1}
									placeholder='Your Text Here'
									value={this.state.textHasChanged ? this.state.textSymPreviewText : ''}
									onChange={e => this.TextOnChange(e)}
									aria-label="Enter text to display on the map"
									style={{
										width: '100%',
										resize: 'none',
										overflow: 'hidden',
										minHeight: '30px',
										fontFamily: this.state.currentTextSymbol.font.family,
										fontSize: '12px',
										padding: '4px 6px',
										border: '1px solid #ccc',
										borderRadius: '3px',
										boxSizing: 'border-box',
										lineHeight: '1.4'
									}}
									onInput={e => {
										const el = e.currentTarget as HTMLTextAreaElement;
										el.style.height = 'auto';
										el.style.height = el.scrollHeight + 'px';
									}}
								/>
								<span id="text-input-hint" className="sr-only">
									Type the text you want to add to your drawing
								</span>
							</div>
						</div>
						<div className='w-100 d-flex' role="group" aria-label="Font family selection">
							<label htmlFor="font-family-select" className="mr-2">Font:</label>
							<Select
								size='sm'
								onChange={(e) => this.handleFontFamily(e)}
								className='ml-2'
								value={this.state.currentTextSymbol.font.family}
								id="font-family-select"
								aria-label="Select font family"
								title="Choose a font style for your text"
							>
								<Option value='Alegreya' style={{ fontFamily: 'Alegreya' }}>Alegreya</Option>
								<Option value='Arial' style={{ fontFamily: 'Arial' }}>Arial</Option>
								<Option value='Avenir Next LT Pro' style={{ fontFamily: 'Avenir Next LT Pro' }}>Avenir Next</Option>
								<Option value='Josefin Slab' style={{ fontFamily: 'Josefin Slab' }}>Josefin Slab</Option>
								<Option value='Merriweather' style={{ fontFamily: 'Merriweather' }}>Merriweather</Option>
								<Option value='Montserrat' style={{ fontFamily: 'Montserrat' }}>Montserrat</Option>
								<Option value='Noto Sans' style={{ fontFamily: 'Noto Sans' }}>Noto Sans</Option>
								<Option value='Noto Serif' style={{ fontFamily: 'Noto Serif' }}>Noto Serif</Option>
								<Option value='Playfair Display' style={{ fontFamily: 'Playfair Display' }}>Playfair Display</Option>
								<Option value='Roboto' style={{ fontFamily: 'Roboto' }}>Roboto</Option>
								<Option value='Ubuntu' style={{ fontFamily: 'Ubuntu' }}>Ubuntu</Option>
							</Select>
						</div>
						<div className="w-100" role="group" aria-label="Font color, size, and style">
							<div className='w-100 d-flex justify-content-between align-items-center mb-2'>
								<ColorPicker
									className="fontcolorpicker"
									title={this.nls('fontColor')}
									style={{ padding: '0' }}
									width={26}
									height={26}
									color={this.state.fontColor ? this.state.fontColor : 'rgba(0,0,0,1)'}
									onChange={this.updateTextColor}
									onClick={e => { this.onColorPickerToggle(e) }}
									aria-label={`Text color picker, current color: ${this.state.fontColor}`}
								/>
								<NumericInput
									size='sm'
									onChange={this.fontSizeOnChange}
									value={this.state.fontSize}
									className="fontsizeinput"
									style={{ width: '5rem' }}
									showHandlers={true}
									min={1}
									max={120}
									aria-label={`Font size in pixels, current value: ${this.state.fontSize}`}
									aria-valuemin={1}
									aria-valuemax={120}
									aria-valuenow={Number(this.state.fontSize)}
									title="Font size in pixels (1-120)"
								/>
								<div style={{ borderRight: '1px solid rgb(182, 182, 182)', height: '26px' }} aria-hidden="true" />
								<AdvancedButtonGroup role="group" aria-label="Text styling options">
									<Button
										icon={true}
										size='sm'
										active={this.state.fsBoldBtnActive}
										onClick={(evt) => { this.onFontStyleChange(evt, 'bold') }}
										title={this.nls('fontBold')}
										aria-label={`Bold text${this.state.fsBoldBtnActive ? ' - currently active' : ''}`}
										aria-pressed={this.state.fsBoldBtnActive}
									>
										<Icon icon={fsBoldIcon} size={'m'} aria-hidden="true" />
									</Button>
									<Button
										icon={true}
										size='sm'
										active={this.state.fsItalicBtnActive}
										onClick={(evt) => { this.onFontStyleChange(evt, 'italic') }}
										title={this.nls('fontItalic')}
										aria-label={`Italic text${this.state.fsItalicBtnActive ? ' - currently active' : ''}`}
										aria-pressed={this.state.fsItalicBtnActive}
									>
										<Icon icon={fItalicIcon} size={'m'} aria-hidden="true" />
									</Button>
									<Button
										icon={true}
										size='sm'
										active={this.state.fsUnderlineBtnActive}
										onClick={(evt) => { this.onFontStyleChange(evt, 'underline') }}
										title={this.nls('fontUnderline')}
										aria-label={`Underline text${this.state.fsUnderlineBtnActive ? ' - currently active' : ''}`}
										aria-pressed={this.state.fsUnderlineBtnActive}
									>
										<Icon icon={fUnderlineIcon} width={12} aria-hidden="true" />
									</Button>
								</AdvancedButtonGroup>
							</div>
						</div>
						<Label id="font-opacity-label">
							{this.nls('drawToolOpacity')}:
							<div className='w-100 d-flex justify-content-between align-items-center mb-2 border' role="group" aria-labelledby="font-opacity-label">
								<Slider
									size='default'
									value={this.state.fontOpacity}
									min={0}
									max={1}
									step={0.1}
									hideThumb={false}
									className='mr-2'
									style={{ width: 'calc(100% - 80px)' }}
									title={`${this.nls('drawToolOpacity')}: ${100 * this.state.fontOpacity}%`}
									onChange={(e) => this.updateSymbolOpacity(e.currentTarget.value)}
									aria-label={`Text opacity slider, current value: ${Math.round(100 * this.state.fontOpacity)}%`}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={Math.round(100 * this.state.fontOpacity)}
									aria-valuetext={`${Math.round(100 * this.state.fontOpacity)}%`}
								/>
								<InputUnit
									value={`${100 * this.state.fontOpacity}%`}
									className='input-unit'
									onChange={(e) => this.onOpacityInputChanged(e)}
									style={{ width: '70px' }}
									aria-label={`Text opacity percentage input, current value: ${Math.round(100 * this.state.fontOpacity)}%`}
								/>
							</div>
						</Label>
						<div className="w-100" role="group" aria-label="Text rotation and line width controls" style={{ borderTop: '1px solid #eee', paddingTop: '6px', marginTop: '2px' }}>
							<div className='w-100 d-flex justify-content-between align-items-center mb-2'>
								<label htmlFor="text-rotation-input" style={{ fontSize: '12px', color: '#555', margin: 0 }}>Rotation (°)</label>
								<NumericInput
									size='sm'
									onChange={this.fontRotationChange}
									value={this.state.fontRotation}
									className="fontrotationinput"
									style={{ width: '80px' }}
									showHandlers={true}
									min={-360}
									max={360}
									id="text-rotation-input"
									aria-label={`Text rotation angle in degrees, current value: ${this.state.fontRotation}`}
									title="Rotation angle in degrees (-360 to 360)"
								/>
							</div>
							<div className='w-100 d-flex justify-content-between align-items-center mb-2'>
								<label htmlFor="text-numlines-input" style={{ fontSize: '12px', color: '#555', margin: 0 }} title="Number of lines to split text across. 1 = automatic (wraps at map width). 2+ = forced line breaks.">Lines</label>
								<NumericInput
									size='sm'
									onChange={this.textNumLinesChange}
									value={this.state.textNumLines}
									style={{ width: '80px' }}
									showHandlers={true}
									min={1}
									max={20}
									id="text-numlines-input"
									aria-label={`Number of lines for text wrap. 1 = no wrap. Current value: ${this.state.textNumLines}`}
									title="Number of lines to wrap text across. 1 = no wrap."
								/>
							</div>
						</div>
						<div className="w-100" role="group" aria-label="Text alignment controls">
							<div className='w-100 d-flex justify-content-between align-items-center mb-2'>
								<AdvancedButtonGroup role="radiogroup" aria-label="Horizontal text alignment">
									<Button
										icon={true}
										size='sm'
										active={this.state.hAlignLeftBtnActive}
										onClick={(evt) => { this.onHorizFontAlignChange(evt, 'left') }}
										title={this.nls('fontHAleft')}
										role="radio"
										aria-checked={this.state.hAlignLeftBtnActive}
										aria-label="Align text left"
									>
										<Icon icon={hAlignLeft} size={'m'} aria-hidden="true" />
									</Button>
									<Button
										icon={true}
										size='sm'
										active={this.state.hAlignCenterBtnActive}
										onClick={(evt) => { this.onHorizFontAlignChange(evt, 'center') }}
										title={this.nls('fontHAcenter')}
										role="radio"
										aria-checked={this.state.hAlignCenterBtnActive}
										aria-label="Align text center"
									>
										<Icon icon={hAlignCenter} size={'m'} aria-hidden="true" />
									</Button>
									<Button
										icon={true}
										size='sm'
										active={this.state.hAlignRightBtnActive}
										onClick={(evt) => { this.onHorizFontAlignChange(evt, 'right') }}
										title={this.nls('fontHAright')}
										role="radio"
										aria-checked={this.state.hAlignRightBtnActive}
										aria-label="Align text right"
									>
										<Icon icon={hAlignRight} size={'m'} aria-hidden="true" />
									</Button>
								</AdvancedButtonGroup>
								<div style={{ borderRight: '1px solid rgb(182, 182, 182)', height: '26px' }} aria-hidden="true" />
								<AdvancedButtonGroup role="radiogroup" aria-label="Vertical text alignment">
									<Button
										icon={true}
										size='sm'
										active={this.state.vAlignBaseBtnActive}
										onClick={(evt) => { this.onVertFontAlignChange(evt, 'baseline') }}
										title={this.nls('fontVAbase')}
										role="radio"
										aria-checked={this.state.vAlignBaseBtnActive}
										aria-label="Align text to baseline"
									>
										<Icon icon={vAlignBase} currentColor={true} aria-hidden="true" />
									</Button>
									<Button
										icon={true}
										size='sm'
										active={this.state.vAlignTopBtnActive}
										onClick={(evt) => { this.onVertFontAlignChange(evt, 'top') }}
										title={this.nls('fontVAtop')}
										role="radio"
										aria-checked={this.state.vAlignTopBtnActive}
										aria-label="Align text to top"
									>
										<Icon icon={vAlignTop} aria-hidden="true" />
									</Button>
									<Button
										icon={true}
										size='sm'
										active={this.state.vAlignMidBtnActive}
										onClick={(evt) => { this.onVertFontAlignChange(evt, 'middle') }}
										title={this.nls('fontVAmid')}
										role="radio"
										aria-checked={this.state.vAlignMidBtnActive}
										aria-label="Align text to middle"
									>
										<Icon icon={vAlignMid} aria-hidden="true" />
									</Button>
									<Button
										icon={true}
										size='sm'
										active={this.state.vAlignBotBtnActive}
										onClick={(evt) => { this.onVertFontAlignChange(evt, 'bottom') }}
										title={this.nls('fontVAbottom')}
										role="radio"
										aria-checked={this.state.vAlignBotBtnActive}
										aria-label="Align text to bottom"
									>
										<Icon icon={vAlignBot} aria-hidden="true" />
									</Button>
								</AdvancedButtonGroup>
							</div>
						</div>
						<Label
							centric
							id="background-color-label"
						>
							Background Color:
							<ColorPicker
								className='mr-4 ml-2'
								style={{ padding: '0' }}
								width={26}
								height={26}
								type='icon-only'
								icon={this.state.fontBackgroundColor === 'rgba(0,0,0,0)' ?
									<CloseOutlined title='No Background Color' aria-hidden="true" /> :
									<div title='Background Color' style={{ backgroundColor: backgroundColorString, height: '100%', width: '100%' }} aria-hidden="true" />
								}
								color={this.state.fontBackgroundColor ? backgroundColorString : "#000000"}
								onClick={e => { this.onColorPickerToggle(e) }}
								onChange={this.updateBackgroundColor}
								aria-labelledby="background-color-label"
								aria-label={`Text background color picker${this.state.fontBackgroundColor === 'rgba(0,0,0,0)' ? ', currently no background' : ''}`}
								title="Select a background color for your text"
							/>
						</Label>
					</div>
					<div className='mt-2'>
						<div
							className='border p-2 mb-2'
							role="region"
							aria-labelledby="halo-options-heading"
						>
							<h6 id="halo-options-heading">Text Halo Options</h6>
							<div className="w-100">
								<div className='w-100 d-flex justify-content-between align-items-center mb-2'>
									<Label
										centric
										id="halo-toggle-label"
									>
										{this.state.fontHaloEnabled ? 'Disable' : 'Enable'}
										<Switch
											title={this.nls('enableFontHalo')}
											className="mr-4 ml-2"
											onChange={this.fontHaloChkChange}
											checked={this.state.fontHaloEnabled}
											aria-labelledby="halo-toggle-label"
											aria-describedby="halo-toggle-description"
										/>
										<span id="halo-toggle-description" className="sr-only">
											Toggle to enable or disable the text halo effect (outline around text)
										</span>
									</Label>
									<ColorPicker
										className='mr-4 fonthalocolorpicker'
										style={{ padding: '0' }}
										width={26}
										height={26}
										color={this.state.fontHaloColor ? this.state.fontHaloColor : '#000000'}
										onClick={e => { this.onColorPickerToggle(e) }}
										onChange={this.updateFontHaloColor}
										disabled={!this.state.fontHaloEnabled}
										aria-label={`Halo color picker${!this.state.fontHaloEnabled ? ' - disabled' : ''}`}
										aria-disabled={!this.state.fontHaloEnabled}
										title={this.state.fontHaloEnabled ? "Select halo color" : "Enable halo to change color"}
									/>
									<NumericInput
										size='sm'
										onChange={e => this.fontHaloSizeChange(e)}
										value={this.state.fontHaloSize}
										disabled={!this.state.fontHaloEnabled}
										className="fonthalosizeinput"
										style={{ width: '80px' }}
										showHandlers={true}
										min={1}
										max={20}
										aria-label={`Halo size in pixels${!this.state.fontHaloEnabled ? ' - disabled' : ''}, current value: ${this.state.fontHaloSize}`}
										aria-disabled={!this.state.fontHaloEnabled}
										aria-valuemin={1}
										aria-valuemax={20}
										aria-valuenow={this.state.fontHaloSize}
										title={this.state.fontHaloEnabled ? "Halo size in pixels (1-20)" : "Enable halo to change size"}
									/>
								</div>
							</div>
							<Label id="halo-opacity-label">
								Opacity:
								<div className='w-100 d-flex justify-content-between align-items-center mb-2 border' role="group" aria-labelledby="halo-opacity-label">
									<Slider
										size='default'
										value={this.state.fontHaloOpacity}
										min={0}
										max={1}
										step={0.1}
										hideThumb={false}
										className='mr-2'
										style={{ width: 'calc(100% - 80px)' }}
										title={`${this.nls('fontHalo')} ${this.nls('drawToolOpacity')}: ${100 * this.state.fontHaloOpacity}%`}
										onChange={(e) => {
											if (this.state.fontHaloEnabled) {
												this.updateSymbolHaloOpacity(e.currentTarget.value);
											}
										}}
										aria-label={`Halo opacity slider${!this.state.fontHaloEnabled ? ' - disabled' : ''}, current value: ${Math.round(100 * this.state.fontHaloOpacity)}%`}
										aria-valuemin={0}
										aria-valuemax={100}
										aria-valuenow={Math.round(100 * this.state.fontHaloOpacity)}
										aria-valuetext={`${Math.round(100 * this.state.fontHaloOpacity)}%`}
										aria-disabled={!this.state.fontHaloEnabled}
									/>
									<InputUnit
										value={`${100 * this.state.fontHaloOpacity}%`}
										className='input-unit'
										onChange={(e) => this.onHaloOpacityInputChanged(e)}
										style={{ width: '70px' }}
										disabled={!this.state.fontHaloEnabled}
										aria-label={`Halo opacity percentage${!this.state.fontHaloEnabled ? ' - disabled' : ''}`}
										aria-disabled={!this.state.fontHaloEnabled}
									/>
								</div>
							</Label>
						</div>
					</div>
				</div>
			</Popper>
		);
	}

	render() {
		const { config } = this.props;
		const {
			fontColor, fontSize, fontHalo, fontRotation, fontWeight, fontStyle, fontDecoration,
			fontHaloColor, fontHaloEnabled, fontHaloSize, textSymPreviewText, textPreviewHeight,
			currentSymbol, currentSymbolType, fontOpacity, fontHaloOpacity, textHasChanged,
			undoBtnActive, redoBtnActive, clearBtnActive, clearBtnTitle, canUndo, canRedo,
			showSymPreview, showTextPreview, textPreviewisOpen, drawGLLengthcheck, rotationMode,
			pointBtnActive, lineBtnActive, flineBtnActive, rectBtnActive, polygonBtnActive,
			fpolygonBtnActive, circleBtnActive, textBtnActive, vAlignBaseBtnActive, vAlignTopBtnActive,
			vAlignMidBtnActive, vAlignBotBtnActive, hAlignLeftBtnActive, hAlignCenterBtnActive,
			hAlignRightBtnActive, fsBoldBtnActive, fsItalicBtnActive, fsUnderlineBtnActive,
			activeTab,
			measurementCheckboxOn
		} = this.state as any;

		return (
			<div
				className="widget-draw jimu-widget"
				css={getStyle(this.props.theme, config)}
				role="application"
				aria-label="Drawing and annotation tools widget"
			>
				{/* Attach to Map View */}
				{this.props.useMapWidgetIds && this.props.useMapWidgetIds.length === 1 && (
					<JimuMapViewComponent
						useMapWidgetId={this.props.useMapWidgetIds[0]}
						onActiveViewChange={this.activeViewChangeHandler}
					/>
				)}

				{/* Fixed Tab Header - Accessible Tab List (hidden when My Drawings is disabled) */}
				{config.enableMyDrawings !== false && (
					<div
						className="tab-header"
						role="tablist"
						aria-label="Drawing widget navigation tabs"
					>
						<div
							className={`tab-button ${activeTab === 'draw' ? 'active' : ''}`}
							onClick={() => this.handleTabChange('draw')}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									this.handleTabChange('draw');
								}
								if (e.key === 'ArrowRight') {
									e.preventDefault();
									this.handleTabChange('mydrawings');
								}
							}}
							role="tab"
							id="draw-tab"
							aria-selected={activeTab === 'draw'}
							aria-controls="draw-tabpanel"
							tabIndex={activeTab === 'draw' ? 0 : -1}
							title="Select the Draw tab to create new drawings and annotations on the map"
						>
							Draw
						</div>
						<div
							className={`tab-button ${activeTab === 'mydrawings' ? 'active' : ''}`}
							onClick={() => this.handleTabChange('mydrawings')}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									this.handleTabChange('mydrawings');
								}
								if (e.key === 'ArrowLeft') {
									e.preventDefault();
									this.handleTabChange('draw');
								}
							}}
							role="tab"
							id="mydrawings-tab"
							aria-selected={activeTab === 'mydrawings'}
							aria-controls="mydrawings-tabpanel"
							tabIndex={activeTab === 'mydrawings' ? 0 : -1}
							title="Select the My Drawings tab to view, edit, and manage your saved drawings"
						>
							My Drawings
						</div>
					</div>
				)}

				{/* Scrollable Tab Content */}
				<div
					className="tab-content"
					role="region"
					aria-label="Tab panel content area"
				>
					{/* Draw tab - always mounted for Measure functionality */}
					<div
						className="draw-tab-content"
						style={{ display: activeTab === 'draw' ? 'block' : 'none' }}
						role="tabpanel"
						id="draw-tabpanel"
						aria-labelledby="draw-tab"
						aria-hidden={activeTab !== 'draw'}
						tabIndex={activeTab === 'draw' ? 0 : -1}
					>
						{this.renderDrawPanel()}
					</div>

					{config.enableMyDrawings !== false && activeTab === 'mydrawings' && (
						<div
							role="tabpanel"
							id="mydrawings-tabpanel"
							aria-labelledby="mydrawings-tab"
							tabIndex={0}
						>
							{this.renderMyDrawingsTab()}
						</div>
					)}
				</div>
			</div>
		);
	}
}