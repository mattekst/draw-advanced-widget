import { React } from 'jimu-core'
import { CollapsableCheckbox, Checkbox, Label, Select, Option, Alert, NumericInput, Button, TextInput, Slider, Switch, AdvancedButtonGroup, ButtonGroup } from 'jimu-ui'
import { ColorPicker } from 'jimu-ui/basic/color-picker'
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash'
import { EditOutlined } from 'jimu-icons/outlined/editor/edit'
import Graphic from "esri/Graphic";
import Point from 'esri/geometry/Point';
import Polyline from 'esri/geometry/Polyline';

const PolylineCompat = Polyline as typeof Polyline & { fromJSON: (json: any) => Polyline };
import SpatialReference from 'esri/geometry/SpatialReference';

const SpatialReferenceCompat = SpatialReference as typeof SpatialReference & { WGS84: SpatialReference };
import * as projectOperator from 'esri/geometry/operators/projectOperator';
import * as geodeticAreaOperator from 'esri/geometry/operators/geodeticAreaOperator';
import * as geodeticLengthOperator from 'esri/geometry/operators/geodeticLengthOperator';
import * as areaOperator from 'esri/geometry/operators/areaOperator'
import * as lengthOperator from 'esri/geometry/operators/lengthOperator'
import * as densifyOperator from 'esri/geometry/operators/densifyOperator'
import Color from 'esri/Color';
import TextSymbol from 'esri/symbols/TextSymbol';
import SimpleMarkerSymbol from 'esri/symbols/SimpleMarkerSymbol';

/**
 * ACCESSIBILITY COMPLIANCE NOTES (Section 508 / WCAG 2.1 AA)
 * ============================================================
 * 
 * This component implements comprehensive accessibility features:
 * 
 * 1. ARIA Labels & Roles:
 *    - All interactive controls have descriptive aria-label attributes
 *    - Proper role attributes (region, group, switch, list, listitem, alert, status)
 *    - aria-expanded for collapsible sections
 *    - aria-controls linking expandable controls to their content panels
 *    - aria-checked for toggle switches and checkboxes
 *    - aria-disabled for disabled controls
 *    - aria-valuemin, aria-valuemax, aria-valuenow for numeric inputs
 *    - aria-describedby for additional context
 * 
 * 2. Screen Reader Support:
 *    - Screen reader only (sr-only) text for additional context
 *    - aria-live regions for dynamic status announcements
 *    - aria-atomic for complete announcement updates
 *    - Descriptive legends for fieldsets (visually hidden but accessible)
 * 
 * 3. Keyboard Navigation:
 *    - All controls are keyboard accessible via Tab navigation
 *    - Logical tab order following visual layout
 *    - Focus indicators (handled by jimu-ui components)
 *    - tabIndex for programmatically focusable elements
 * 
 * 4. Tooltips & Hover Text:
 *    - Comprehensive title attributes on all interactive controls
 *    - Descriptive hover text explaining control purpose and usage
 *    - Context-sensitive titles (e.g., different when disabled)
 * 
 * 5. Form Accessibility:
 *    - Labels properly associated with form controls via id/aria-labelledby
 *    - Fieldsets with legends for grouped controls
 *    - Clear visual and semantic grouping of related controls
 * 
 * 6. Color & Contrast:
 *    - Uses jimu-ui default theme which meets WCAG contrast requirements
 *    - Opacity changes for disabled states are supplemented with aria-disabled
 *    - Status colors (success, info) paired with text descriptions
 * 
 * 7. Dynamic Content:
 *    - Live regions announce status changes to screen readers
 *    - Alert role for warning messages
 *    - Status role for state change announcements
 * 
 * CSS Required for Screen Reader Only Text:
 * .sr-only {
 *   position: absolute;
 *   left: -9999px;
 *   width: 1px;
 *   height: 1px;
 *   overflow: hidden;
 * }
 * 
 * Note: Inline styles are used for sr-only in this component to ensure
 * functionality without external CSS dependencies.
 */

// Import React hooks properly
const { useState, useEffect, useRef, useImperativeHandle, forwardRef } = React

interface ExtendedGraphic extends Graphic {
	measure?: {
		graphic: ExtendedGraphic;
		areaUnit?: string;
		lengthUnit?: string;
	};
	measureParent?: ExtendedGraphic;
	checked?: boolean;
	originalSymbol?: any;
	_selectionOverlay?: any;
	_dragHandle?: any;
	_lastClickTime?: number;
}

interface MeasuredGraphic {
	measure?: {
		graphic: any;
	};
	attributes: {
		[key: string]: any;
		uniqueId?: string;
		relatedSegmentLabels?: any[];
	};
}

interface MeasureProps {
	nls: (id: string, values?: Record<string, any>) => string;
	config: any;
	drawLayer: any;
	currentTextSymbol: any;
	sketchViewModel: any;
	currentTool: string;
	showTextPreview: boolean;
	currentSymbol: any;
	jimuMapView?: any;
	isDrawingActive: boolean;
	measurementEnabled?: boolean;
}

interface MeasureRef {
	updateMeasurementsForGraphic: (graphic: ExtendedGraphic) => void;
	enableMeasurements: () => void;
	disableMeasurements: () => void;
	refreshAllMeasurements: () => void;
	isMeasurementEnabled: () => boolean;
	setMeasurementEnabled: (enabled: boolean) => void;   // ➕ Expose control of measurement state
	setSegmentsEnabled: (enabled: boolean) => void;      // ➕ Restore the global segment-labels toggle on reload
	isBusy: () => boolean;
	handleMeasurementLabelSelection: (labelGraphic: any) => void;
	cleanupMeasurementLabelSelection: () => void;
	isEditingMeasurements: () => boolean;
	startLabelDrag: (labelGraphic: ExtendedGraphic, screenPoint?: any) => void;
	stopLabelDrag: () => void;
	resetLabelPosition: () => void;
	isDragging: () => boolean;
}

// Proper forwardRef structure
const Measure = forwardRef<MeasureRef, MeasureProps>((props, ref) => {
	const drawLayer = props.drawLayer
	const currentTextSymbol = props.currentTextSymbol
	const sketchViewModel = props.sketchViewModel
	const currentTool = props.currentTool
	const showTextPreview = props.showTextPreview

	// Map view reference for forcing refreshes
	let currentMapView: any | any | null = null;

	// All useRef calls moved to the top level of the component
	const measureEnabledRef = React.useRef(false);
	const editableMeasurementsRef = React.useRef(false);

	// 🔧 NEW: Store listeners in refs for immediate synchronous access
	const updateListenerRef = React.useRef(null);
	const createListenerRef = React.useRef(null);
	// 🔧 MEMORY FIX: previously newDeleteListener at line ~4190 was never stored.
	// Every call to setupSketchViewModelListeners registered a fresh 'delete'
	// handler and orphaned the prior one. Track it the same way as update/create.
	const deleteListenerRef = React.useRef(null);
	const removalListenerRef = React.useRef(null);

	// 🔧 NEW: Guard against CollapsableCheckbox firing onCheckedChange during mount
	const isInitialMount = React.useRef(true);

	const settingsRef = React.useRef({
		distanceUnit: null,
		areaUnit: null,
		segmentsOn: false,
		lengthOn: true,
		areaOn: true,
		perimeterOn: true,
		radiusOn: true,
		pointRound: 5,
		otherRound: 2,
		rotateSegments: true
	});

	// Concurrency protection
	const processingQueue = React.useRef(new Set());
	const measurementLock = React.useRef(false);

	// Move debounce function to top to avoid hoisting issues
	const debounce = (func, wait) => {
		let timeout;
		return function executedFunction(...args) {
			const later = () => {
				clearTimeout(timeout);
				func(...args);
			};
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
		};
	};

	const isTextSymbol = (symbol: any): symbol is TextSymbol => {
		return symbol &&
			typeof symbol === 'object' &&
			symbol.type === 'text' &&
			typeof symbol.text === 'string';
	}

	//Built-in units TODO: byt till original med hårdkodad fallback
	const defaultAreaUnits = [
		{ unit: 'square-kilometers', label: props.nls('squareKilometers') || 'Square Kilometers', abbreviation: 'km²', conversion: 0.000001 },
		{ unit: 'square-miles', label: props.nls('squareMiles') || 'Square Miles', abbreviation: 'mi²', conversion: 3.86102e-7 },
		{ unit: 'acres', label: props.nls('acres') || 'Acres', abbreviation: 'ac', conversion: 0.000247105 },
		{ unit: 'hectares', label: props.nls('hectares') || 'Hectares', abbreviation: 'ha', conversion: 0.0001 },
		{ unit: 'square-meters', label: props.nls('squareMeters') || 'Square Meters', abbreviation: 'm²', conversion: 1 },
		{ unit: 'square-feet', label: props.nls('squareFeet') || 'Square Feet', abbreviation: 'ft²', conversion: 10.7639 },
		{ unit: 'square-yards', label: props.nls('squareYards') || 'Square Yards', abbreviation: 'yd²', conversion: 1.19599 }
	];

	const defaultDistanceUnits = [
		{ unit: 'kilometers', label: props.nls('kilometers') || 'Kilometers', abbreviation: 'km', conversion: 0.001 },
		{ unit: 'miles', label: props.nls('miles') || 'Miles', abbreviation: 'mi', conversion: 0.000621371 },
		{ unit: 'meters', label: props.nls('meters') || 'Meters', abbreviation: 'm', conversion: 1 },
		{ unit: 'nautical-miles', label: props.nls('nauticals') || 'Nautical Miles', abbreviation: 'NM', conversion: 0.000539957 },
		{ unit: 'feet', label: props.nls('feet') || 'Feet', abbreviation: 'ft', conversion: 3.28084 },
		{ unit: 'yards', label: props.nls('yards') || 'Yards', abbreviation: 'yd', conversion: 1.09361 }
	];

	//combine built-in and user defined units
	const distanceUnits = [...defaultDistanceUnits, ...props.config.userDistances]
	const areaUnits = [...defaultAreaUnits, ...props.config.userAreas]

	// NOW the state variables can use distanceUnits and areaUnits
	const [distanceUnit, setDistanceUnit] = React.useState(distanceUnits[props.config.defaultDistance] || distanceUnits[0])
	const [areaUnit, setAreaUnit] = React.useState(areaUnits[props.config.defaultArea] || areaUnits[0])
	const [availableDistanceUnits, setAvailableDistanceUnits] = React.useState(distanceUnits)
	const [availableAreaUnits, setAvailableAreaUnits] = React.useState(areaUnits)
	// Inside Measure component initialization
	const [measureEnabled, setMeasureEnabledState] = React.useState(props.measurementEnabled ?? false);

	const setMeasureEnabled = (value: boolean) => {
		setMeasureEnabledState(value);
	};

	const [updateListener, setUpdateListener] = React.useState(null)
	const [createListener, setCreateListener] = React.useState(null)
	const [removalListener, setRemovalListener] = React.useState(null)
	const [xy, setXy] = React.useState(false)
	const [latLong, setLatLong] = React.useState(true)
	const [wkid, setWkid] = React.useState(false)
	const [lengthOn, setLengthOn] = React.useState(true)
	const [areaOn, setAreaOn] = React.useState(true)
	const [perimeterOn, setPerimeterOn] = React.useState(true)
	const [radiusOn, setRadiusOn] = React.useState(true)
	const [segmentsOn, setSegmentsOn] = React.useState(false)
	// Mirror of segmentsOn for closure-safe reads. SketchViewModel listeners and
	// _addMeasurement capture state at the time their effect ran; reading the raw
	// `segmentsOn` state inside shouldCreateSegments meant a rebuild triggered from
	// an older listener closure (e.g. a resize right after a reload that set
	// segmentsOn=true) could still see the stale `false`, clean the segment labels,
	// and skip recreating them. Reading the ref guarantees the live value — same
	// pattern as measureEnabledRef used throughout this file.
	const segmentsOnRef = React.useRef(false)
	React.useEffect(() => { segmentsOnRef.current = segmentsOn }, [segmentsOn])
	const [rotateSegments, setRotateSegments] = React.useState(true)
	const [currentGraphic, setCurrentGraphic] = React.useState(null)
	const [toolType, setToolType] = React.useState(currentTool)
	const [tooltips, setTooltips] = React.useState(false)
	const [pointRound, setPointRound] = React.useState(5)
	const [otherRound, setOtherRound] = React.useState(2)

	// Track processed graphics to prevent duplicate labels
	const [processedGraphics, setProcessedGraphics] = React.useState(new Set())

	// Processing state tracking
	const [isProcessingMeasurements, setIsProcessingMeasurements] = React.useState(false);
	const [activeEvents, setActiveEvents] = React.useState(new Set());

	// Minimal throttling only for complete events, not active
	const [completeTimeouts, setCompleteTimeouts] = React.useState(new Map())
	const COMPLETE_THROTTLE_DELAY = 100;

	// Watch for external graphic changes (from MyDrawingsPanel)
	const [layerWatcher, setLayerWatcher] = React.useState(null);

	// Measurement label editing states
	const [editableMeasurements, setEditableMeasurements] = React.useState(false)
	const [selectedMeasurementLabel, setSelectedMeasurementLabel] = React.useState(null)
	const [measurementTextSymbol, setMeasurementTextSymbol] = React.useState(null)
	const [measurementClickListener, setMeasurementClickListener] = React.useState(null)

	// Text editing states for measurement labels
	const [measurementFontColor, setMeasurementFontColor] = React.useState('rgba(0,0,0,1)')
	const [measurementFontSize, setMeasurementFontSize] = React.useState(14)
	const [measurementFontRotation, setMeasurementFontRotation] = React.useState(0)
	const [measurementHaloEnabled, setMeasurementHaloEnabled] = React.useState(true)
	const [measurementHaloColor, setMeasurementHaloColor] = React.useState('rgba(255,255,255,1)')
	const [measurementHaloSize, setMeasurementHaloSize] = React.useState(2)
	// Add these three functions to handle font formatting for measurement labels

	const updateMeasurementFontWeight = (bold: boolean) => {
		//console.log('Updating font weight to:', bold ? 'bold' : 'normal');
		if (measurementTextSymbol && selectedMeasurementLabel) {
			// Update the symbol immediately and synchronously
			const updatedSymbol = measurementTextSymbol.clone();
			updatedSymbol.font = updatedSymbol.font.clone();
			updatedSymbol.font.weight = bold ? 'bold' : 'normal';

			// Update state
			setMeasurementTextSymbol(updatedSymbol);

			// Apply changes immediately using the updated symbol
			applyMeasurementTextChangesWithSymbol(updatedSymbol);
		}
	};

	const updateMeasurementFontStyle = (italic: boolean) => {
		//console.log('Updating font style to:', italic ? 'italic' : 'normal');
		if (measurementTextSymbol && selectedMeasurementLabel) {
			// Update the symbol immediately and synchronously
			const updatedSymbol = measurementTextSymbol.clone();
			updatedSymbol.font = updatedSymbol.font.clone();
			updatedSymbol.font.style = italic ? 'italic' : 'normal';

			// Update state
			setMeasurementTextSymbol(updatedSymbol);

			// Apply changes immediately using the updated symbol
			applyMeasurementTextChangesWithSymbol(updatedSymbol);
		}
	};

	const updateMeasurementFontDecoration = (underline: boolean) => {
		//console.log('Updating font decoration to:', underline ? 'underline' : 'none');
		if (measurementTextSymbol && selectedMeasurementLabel) {
			// Update the symbol immediately and synchronously
			const updatedSymbol = measurementTextSymbol.clone();
			updatedSymbol.font = updatedSymbol.font.clone();
			updatedSymbol.font.decoration = underline ? 'underline' : 'none';

			// Update state
			setMeasurementTextSymbol(updatedSymbol);

			// Apply changes immediately using the updated symbol
			applyMeasurementTextChangesWithSymbol(updatedSymbol);
		}
	};

	const applyMeasurementTextChangesWithSymbol = (symbolToApply?: TextSymbol) => {
		// console.log('applyMeasurementTextChangesWithSymbol called:', {
		//   hasSelectedLabel: !!selectedMeasurementLabel,
		//   hasSymbolParam: !!symbolToApply,
		//   hasTextSymbol: !!measurementTextSymbol,
		//   hasDrawLayer: !!drawLayer
		// });


		if (!selectedMeasurementLabel) {
			//console.log('Missing selected label for text changes');
			return;
		}

		// Use the provided symbol or fall back to the state symbol
		const symbolSource = symbolToApply || measurementTextSymbol;
		if (!symbolSource) {
			//console.log('Missing symbol source for text changes');
			return;
		}

		try {
			// Preserve the original measurement text
			const originalText = (selectedMeasurementLabel.symbol as TextSymbol).text;

			// Create a completely new symbol using the provided symbol as the source
			const updatedSymbol = new TextSymbol({
				text: originalText,
				color: symbolSource.color, // Use provided symbol's color
				font: {
					size: symbolSource.font.size, // Use provided symbol's font size
					weight: symbolSource.font.weight, // Use provided symbol's weight
					style: symbolSource.font.style, // Use provided symbol's style  
					decoration: symbolSource.font.decoration, // Use provided symbol's decoration
					family: symbolSource.font.family || 'Arial'
				},
				angle: symbolSource.angle, // Use provided symbol's angle
				// FIXED: Use halo properties from the provided symbol instead of React state
				haloColor: symbolSource.haloColor, // Use symbol's halo color
				haloSize: symbolSource.haloSize, // Use symbol's halo size
				verticalAlignment: symbolSource.verticalAlignment,
				horizontalAlignment: symbolSource.horizontalAlignment,
				xoffset: symbolSource.xoffset,
				yoffset: symbolSource.yoffset,
				backgroundColor: symbolSource.backgroundColor
			});

			// console.log('🔄 Applying symbol changes:', {
			//   originalText,
			//   color: updatedSymbol.color,
			//   fontSize: updatedSymbol.font.size,
			//   fontWeight: updatedSymbol.font.weight,
			//   fontStyle: updatedSymbol.font.style,
			//   fontDecoration: updatedSymbol.font.decoration,
			//   angle: updatedSymbol.angle,
			//   haloSize: updatedSymbol.haloSize,
			//   haloColor: updatedSymbol.haloColor
			// });

			// Apply the updated symbol
			selectedMeasurementLabel.symbol = updatedSymbol;

			// Mark as customized
			if (!selectedMeasurementLabel.attributes) selectedMeasurementLabel.attributes = {};
			selectedMeasurementLabel.attributes.customized = true;
			selectedMeasurementLabel.attributes.lastModified = Date.now();

			// Force refresh strategies (same as before)
			try {
				selectedMeasurementLabel.visible = false;
				setTimeout(() => {
					if (selectedMeasurementLabel) {
						selectedMeasurementLabel.visible = true;
					}
				}, 50);
			} catch (e) {
				console.warn('Visibility toggle refresh failed:', e);
			}

			// Layer refresh
			if (drawLayer && typeof (drawLayer as any).refresh === 'function') {
				try {
					(drawLayer as any).refresh();
					//console.log('Layer refresh completed');
				} catch (e) {
					console.warn('Layer refresh failed:', e);
				}
			}

			// Remove and re-add strategy
			if (drawLayer && selectedMeasurementLabel.layer === drawLayer) {
				try {
					const wasVisible = selectedMeasurementLabel.visible;
					const currentGeometry = selectedMeasurementLabel.geometry;

					drawLayer.remove(selectedMeasurementLabel);

					selectedMeasurementLabel.visible = wasVisible;
					selectedMeasurementLabel.geometry = currentGeometry;

					drawLayer.add(selectedMeasurementLabel);
					//console.log('Refreshed graphic via remove/add');
				} catch (refreshError) {
					console.warn('Remove/add refresh failed:', refreshError);
				}
			}

			// Force view redraw
			if (currentMapView) {
				try {
					if (typeof (currentMapView as any).redraw === 'function') {
						(currentMapView as any).redraw();
						//console.log('Map view redraw completed');
					}
				} catch (redrawError) {
					console.warn('Map redraw failed:', redrawError);
				}
			}

			//console.log('✅ Applied text changes to measurement label - marked as customized');

		} catch (error) {
			console.error('❌ Error applying measurement text changes:', error);
		}
	};

	// NEW: Drag functionality states
	const [isDraggingLabel, setIsDraggingLabel] = React.useState(false)
	const [dragStartPoint, setDragStartPoint] = React.useState(null)
	const [dragMoveListener, setDragMoveListener] = React.useState(null)
	const [dragEndListener, setDragEndListener] = React.useState(null)
	const [labelBeingDragged, setLabelBeingDragged] = React.useState(null)
	const isDraggingRef = React.useRef(false);
	const labelBeingDraggedRef = React.useRef<ExtendedGraphic | null>(null);

	// Helper function to check if segments should be created
	const shouldCreateSegments = (geometry: any): boolean => {
		// Segments must be explicitly enabled (read the ref, not the captured state,
		// so rebuilds from older listener closures see the current value)
		if (!segmentsOnRef.current) return false;

		// Only polylines and polygons support segments
		if (geometry.type !== 'polyline' && geometry.type !== 'polygon') {
			return false;
		}

		// For polylines: only create segments if there are multiple segments (more than 2 points)
		if (geometry.type === 'polyline') {
			const polyline = geometry as any;
			// True curves keep their pieces in curvePaths (paths is empty). A curve
			// path is [startVertex, seg, seg, ...]; more than one seg = multi-segment.
			if (Array.isArray(polyline.curvePaths) && polyline.curvePaths.length) {
				return polyline.curvePaths.some((p: any[]) => Array.isArray(p) && p.length > 2);
			}
			if (!polyline.paths || polyline.paths.length === 0) return false;

			// Check if any path has more than 2 points (meaning multiple segments)
			const hasMultipleSegments = polyline.paths.some(path => path.length > 2);
			return hasMultipleSegments;
		}

		// For polygons: check if it's a circle first (circles never get segments)
		if (geometry.type === 'polygon') {
			const polygon = geometry as any;

			// No rings means no segments
			if (!polygon.rings || polygon.rings.length === 0 || !polygon.rings[0]) {
				return false;
			}

			// Circles are represented as polygons with exactly 61 points - never add segments to circles
			const isCircle = polygon.rings[0].length === 61;
			if (isCircle) {
				return false;
			}

			// All other polygons can have segments when enabled
			return true;
		}

		// Default: no segments
		return false;
	};

	// More permissive helper function to identify measurement labels
	const isMeasurementLabel = (graphic: any): boolean => {
		if (!graphic) return false;

		// Primary check: explicit measurement label markers
		if (graphic.attributes?.isMeasurementLabel ||
			graphic.attributes?.measurementType) {
			return true;
		}

		// FIX #4: Only treat hideFromList as measurement if it also has a parentGraphicId
		// (user text can have hideFromList=false, but orphaned labels may have hideFromList=true)
		if (graphic.attributes?.hideFromList && graphic.attributes?.parentGraphicId) {
			return true;
		}

		// Check if it has a measureParent (indicates it's a segment label)
		if (graphic.measureParent) {
			return true;
		}

		// FIX #4: Tightened regex fallback — only match text that is PRIMARILY measurement content.
		// Require the ENTIRE text to match measurement patterns (not just contain them)
		// to avoid false positives on user text like "100 ft setback" or "Area: parking lot"
		if (graphic.symbol?.type === 'text') {
			const text = (graphic.symbol.text || '').trim();
			// Must be a text graphic with no user-facing name that differs from the text
			// (user-created text graphics have name set to the text content or a user-given name)
			const hasDrawMode = graphic.attributes?.drawMode;
			const isUserCreatedText = hasDrawMode === 'text' && !graphic.attributes?.parentGraphicId;
			if (isUserCreatedText) return false;

			// Strict patterns: entire text must be measurement-like
			const strictMeasurementPatterns = [
				// Single measurement value: "1,234.56 km²"
				/^[\d,]+(\.\d+)?\s*(km²|mi²|ac|ha|m²|ft²|yd²|km|mi|NM|m|ft|yd)$/,
				// Labeled measurement: "Area: 1,234.56 km²" with optional multi-line
				/^(Area:|Perimeter:|Radius:|Total:)\s*[\d,]+(\.\d+)?/m,
				// Coordinate labels: "X: 123.456\nY: 789.012"
				/^(Lat:|Lon:|X:|Y:|WKID:)\s*/m
			];

			return strictMeasurementPatterns.some(pattern => pattern.test(text));
		}

		return false;
	};

	const identifyAndMarkRestoredMeasurementLabels = () => {
		if (!drawLayer || !isLayerBasicallyValid()) return;

		const allGraphics = drawLayer.graphics.toArray();

		allGraphics.forEach(graphic => {
			// Skip if already properly identified
			if (graphic.attributes?.isMeasurementLabel) return;

			// FIX #4: Skip user-created text graphics (they have drawMode 'text' but no parentGraphicId)
			if (graphic.attributes?.drawMode === 'text' && !graphic.attributes?.parentGraphicId) return;

			// Check if this looks like a measurement label
			if (graphic.symbol?.type === 'text') {
				const text = (graphic.symbol.text || '').trim();

				// FIX #4: Use strict patterns that require the ENTIRE text to be measurement-like
				const strictPatterns = [
					/^[\d,]+(\.\d+)?\s*(km²|mi²|ac|ha|m²|ft²|yd²|km|mi|NM|m|ft|yd)$/,
					/^(Area:|Perimeter:|Radius:|Total:)\s*[\d,]+(\.\d+)?/m,
					/^(Lat:|Lon:|X:|Y:|WKID:)\s*/m
				];
				const hasMeasurementPattern = strictPatterns.some(p => p.test(text));

				if (hasMeasurementPattern) {
					// Mark as measurement label
					if (!graphic.attributes) graphic.attributes = {};
					graphic.attributes.isMeasurementLabel = true;
					graphic.attributes.hideFromList = true;

					// Try to find parent graphic by proximity or attributes
					const parentGraphic = findParentGraphicForLabel(graphic, allGraphics);
					if (parentGraphic) {
						graphic.attributes.parentGraphicId = parentGraphic.attributes?.uniqueId;
						graphic.measureParent = parentGraphic;

						// Associate with parent
						if (!parentGraphic.measure && !graphic.attributes.measurementType?.includes('segment')) {
							parentGraphic.measure = {
								graphic: graphic,
								lengthUnit: graphic.attributes?.lengthUnit || 'meters',
								areaUnit: graphic.attributes?.areaUnit || 'square-meters'
							};
						}
					}

					//console.log('Identified and marked restored measurement label:', text.substring(0, 30));
				}
			}
		});
	};

	const findParentGraphicForLabel = (labelGraphic: any, allGraphics: any[]) => {
		// First try to find by stored parentGraphicId
		if (labelGraphic.attributes?.parentGraphicId) {
			const parentById = allGraphics.find(g =>
				g.attributes?.uniqueId === labelGraphic.attributes.parentGraphicId
			);
			if (parentById) return parentById;
		}

		// Fallback: find by proximity (closest non-text graphic)
		const labelPoint = labelGraphic.geometry;
		if (!labelPoint) return null;

		let closestGraphic = null;
		let closestDistance = Infinity;

		allGraphics.forEach(graphic => {
			if (graphic === labelGraphic) return;
			if (graphic.symbol?.type === 'text') return;
			if (!graphic.geometry) return;

			const graphicCenter = graphic.geometry.extent?.center || graphic.geometry;
			if (graphicCenter) {
				const distance = Math.sqrt(
					Math.pow(labelPoint.x - graphicCenter.x, 2) +
					Math.pow(labelPoint.y - graphicCenter.y, 2)
				);

				if (distance < closestDistance) {
					closestDistance = distance;
					closestGraphic = graphic;
				}
			}
		});

		return closestGraphic;
	};

	// More permissive helper function to identify actual user drawings
	const isActualDrawing = (graphic: any): boolean => {
		if (!graphic || !graphic.geometry) return false;

		// Skip measurement labels first
		if (isMeasurementLabel(graphic)) return false;

		// Must have supported geometry type
		const supportedTypes = ['polyline', 'polygon', 'point'];
		if (!supportedTypes.includes(graphic.geometry.type)) return false;

		// LESS RESTRICTIVE: Accept graphics unless they're clearly temporary/system generated
		const name = graphic.attributes?.name || '';

		// Only reject graphics with very specific patterns that indicate they're temporary
		const isSystemGenerated =
			name.includes('_temp_') ||
			name.includes('_system_') ||
			/^temp_\d+$/.test(name) ||
			/^system_\d+$/.test(name);

		// Accept all others, including empty names and short names
		return !isSystemGenerated;
	};

	// Helper to identify graphics that should have measurements
	const shouldHaveMeasurement = (graphic: any): boolean => {
		if (!graphic || !measureEnabledRef.current) return false;

		return isActualDrawing(graphic) &&
			!isMeasurementLabel(graphic) &&
			!graphic.measure; // Doesn't already have a measurement
	};

	// Debounced update function
	const debouncedUpdateMeasurements = React.useRef(
		debounce((graphic: ExtendedGraphic) => {
			if (!isProcessingMeasurements && measureEnabledRef.current) {
				_addMeasurement(graphic, null, true);
			}
		}, 200)
	);

	// Helper function to validate if the layer is in a good state for strict operations
	const isLayerValid = () => {
		// Basic existence check
		if (!drawLayer) {
			return false;
		}

		// Check if it's an object with required methods
		try {
			// More permissive - only check for essential methods
			return typeof drawLayer === 'object' &&
				typeof drawLayer.add === 'function' &&
				typeof drawLayer.remove === 'function' &&
				drawLayer.graphics !== undefined &&
				drawLayer.graphics !== null;
		} catch (err) {
			console.warn('Layer validation error:', err);
			return false;
		}
	};

	// Add a more permissive validation for basic operations
	const isLayerBasicallyValid = () => {
		return drawLayer &&
			typeof drawLayer === 'object' &&
			typeof drawLayer.add === 'function';
	};

	// Safe removal with multiple strategies
	const safeLayerRemove = (graphic) => {
		if (!drawLayer || !graphic) return false;
		try {
			// Strategy 1: Use remove method if available
			if (typeof drawLayer.remove === 'function') {
				drawLayer.remove(graphic);
				return true;
			}
			// Strategy 2: Use graphics.remove if available
			if (drawLayer.graphics && typeof drawLayer.graphics.remove === 'function') {
				drawLayer.graphics.remove(graphic);
				return true;
			}
			return false;
		} catch (error) {
			console.warn('Error removing graphic from layer:', error);
			return false;
		}
	};

	// Safe containment check with fallbacks
	const safeLayerContains = (graphic) => {
		if (!drawLayer || !graphic) return false;
		try {
			// Primary check: use graphics.includes if available
			if (drawLayer.graphics && typeof drawLayer.graphics.includes === 'function') {
				return drawLayer.graphics.includes(graphic);
			}

			// Fallback: use contains method if available
			if (typeof drawLayer.contains === 'function') {
				return drawLayer.contains(graphic);
			}

			// Another fallback: check graphics items array
			if (drawLayer.graphics && Array.isArray(drawLayer.graphics.items)) {
				return drawLayer.graphics.items.includes(graphic);
			}

			// Final fallback: iterate through graphics
			if (drawLayer.graphics && drawLayer.graphics.toArray) {
				const allGraphics = drawLayer.graphics.toArray();
				return allGraphics.includes(graphic);
			}

			return false;
		} catch (error) {
			console.warn('Error checking if layer contains graphic:', error);
			return false;
		}
	};

	// Helper function to get the correct coordinate arrays based on geometry type
	const getCoordinateArrays = (geometry: any): number[][][] => {
		if (geometry.type === 'polyline') {
			const polyline = geometry as any;
			return polyline.paths || [];
		} else if (geometry.type === 'polygon') {
			const polygon = geometry as any;
			return polygon.rings || [];
		}
		return [];
	};

	// Generate unique ID for graphics to prevent duplicate processing
	const getGraphicId = (graphic) => {
		if (graphic.attributes?.uniqueId) {
			return graphic.attributes.uniqueId;
		}

		// Generate a simple ID based on geometry and timestamp
		const geomType = graphic.geometry?.type || 'unknown';
		const coords = graphic.geometry?.extent ?
			`${graphic.geometry.extent.xmin}_${graphic.geometry.extent.ymin}` :
			'nocoords';
		return `${geomType}_${coords}_${Date.now()}`;
	};

	// Drag functionality methods
	const setupLabelDragHandlers = (labelGraphic: ExtendedGraphic) => {
		if (!currentMapView || !labelGraphic || !editableMeasurements) return;

		// Create drag handle overlay (visual indicator that label can be moved)
		const dragHandleSymbol = new SimpleMarkerSymbol({
			style: 'circle',
			size: 12,
			color: [0, 150, 255, 0.3], // Light blue
			outline: {
				color: [0, 150, 255, 0.8],
				width: 2,
				style: 'solid'
			}
		});

		// Remove existing drag handle if it exists
		if (labelGraphic._dragHandle) {
			try {
				drawLayer.remove(labelGraphic._dragHandle);
			} catch (e) { }
			labelGraphic._dragHandle = null;
		}

		const dragHandle = new Graphic({
			geometry: labelGraphic.geometry,
			symbol: dragHandleSymbol,
			attributes: {
				isDragHandle: true,
				parentLabelId: labelGraphic.attributes?.uniqueId || 'unknown'
			}
		});

		try {
			drawLayer.add(dragHandle);
			labelGraphic._dragHandle = dragHandle;
			//console.log('Added drag handle for measurement label');
		} catch (error) {
			console.error('Error creating drag handle:', error);
		}
	};

	const removeLabelDragHandlers = (labelGraphic: ExtendedGraphic) => {
		if (labelGraphic?._dragHandle) {
			try {
				drawLayer.remove(labelGraphic._dragHandle);
			} catch (e) { }
			labelGraphic._dragHandle = null;
		}
	};

	let activeDragMoveListener = null;
	let activeDragEndListener = null;

	const startLabelDrag = (labelGraphic: ExtendedGraphic, screenPoint?: any) => {
		if (!currentMapView || !labelGraphic) {
			//console.log('❌ Cannot start drag - missing mapView or graphic');
			return;
		}

		if (isDraggingRef.current) {
			//console.log('⚠️ Drag already in progress');
			return;
		}

		//console.log('🚀 Starting label drag for:', labelGraphic.attributes?.name);

		// Set drag refs immediately (synchronous)
		isDraggingRef.current = true;
		labelBeingDraggedRef.current = labelGraphic;

		// Also update state for UI
		setIsDraggingLabel(true);
		setLabelBeingDragged(labelGraphic);
		setDragStartPoint(screenPoint);

		// Disable basic navigation
		try {
			currentMapView.navigation.mouseWheelZoomEnabled = false;
			currentMapView.navigation.browserTouchPanEnabled = false;
			//console.log('✅ Disabled basic map navigation');
		} catch (error) {
			console.error('❌ Error disabling map navigation:', error);
		}

		// Set cursor
		try {
			const container = currentMapView.container as HTMLElement;
			if (container) {
				container.style.cursor = 'move';
				//console.log('✅ Set cursor to move');
			}
		} catch (error) {
			console.error('❌ Error setting cursor:', error);
		}

		// Set up event listeners - CRITICAL: Store references immediately in module variables
		try {
			// Clean up any existing listeners first
			if (activeDragMoveListener) {
				activeDragMoveListener.remove();
				activeDragMoveListener = null;
			}
			if (activeDragEndListener) {
				activeDragEndListener.remove();
				activeDragEndListener = null;
			}

			activeDragMoveListener = currentMapView.on('pointer-move', (event) => {
				handleLabelDragMoveRef(event);
			});

			activeDragEndListener = currentMapView.on('pointer-up', (event) => {
				handleLabelDragEndRef(event);
			});

			//console.log('✅ Drag event listeners set up successfully');
		} catch (error) {
			console.error('❌ Error setting up drag listeners:', error);
			// Reset state if listener setup fails
			isDraggingRef.current = false;
			labelBeingDraggedRef.current = null;
			setIsDraggingLabel(false);
			setLabelBeingDragged(null);
		}
	};

	const handleLabelDragMoveRef = (event: any) => {
		//console.log('🎯 handleLabelDragMoveRef called');

		if (!isDraggingRef.current || !labelBeingDraggedRef.current || !currentMapView) {
			// console.log('❌ Drag move conditions not met:', {
			//   isDragging: isDraggingRef.current,
			//   hasLabel: !!labelBeingDraggedRef.current,
			//   hasMapView: !!currentMapView
			// });
			return;
		}

		//console.log('✅ Processing drag move - mouse at:', event.x, event.y);

		try {
			const mapPoint = currentMapView.toMap({ x: event.x, y: event.y });

			if (mapPoint && labelBeingDraggedRef.current) {
				//console.log('📍 Moving label to map coords:', mapPoint.x.toFixed(2), mapPoint.y.toFixed(2));

				labelBeingDraggedRef.current.geometry = mapPoint;

				if (labelBeingDraggedRef.current._dragHandle) {
					labelBeingDraggedRef.current._dragHandle.geometry = mapPoint;
				}

				if (labelBeingDraggedRef.current._selectionOverlay) {
					labelBeingDraggedRef.current._selectionOverlay.geometry = mapPoint;
				}

				// Mark as custom position
				if (!labelBeingDraggedRef.current.attributes) {
					labelBeingDraggedRef.current.attributes = {};
				}
				labelBeingDraggedRef.current.attributes.hasCustomPosition = true;
				labelBeingDraggedRef.current.attributes.lastMoved = Date.now();
			}
		} catch (error) {
			console.error('❌ Error during label drag move:', error);
		}
	};

	// True only for measurement labels/overlays/handles
	const isMeasurementOnlyGraphic = (g: any) =>
		!!(g?.attributes?.isMeasurementLabel || g?.attributes?.isDragHandle || g?._selectionOverlay || g?.measureParent);


	const handleLabelDragEndRef = (event?: any) => {
		//console.log('🏁 handleLabelDragEndRef called');

		if (!isDraggingRef.current || !labelBeingDraggedRef.current) {
			//console.log('⚠️ No active drag to end');
			return;
		}

		//console.log('🎯 Processing drag end for:', labelBeingDraggedRef.current.attributes?.name);

		const draggedLabel = labelBeingDraggedRef.current;

		if (event && event.stopPropagation) {
			event.stopPropagation();
		}
		if (event && event.preventDefault) {
			event.preventDefault();
		}

		try {
			// Remove listeners
			if (activeDragMoveListener) {
				activeDragMoveListener.remove();
				activeDragMoveListener = null;
			}
			if (activeDragEndListener) {
				activeDragEndListener.remove();
				activeDragEndListener = null;
			}
			if (dragMoveListener) {
				dragMoveListener.remove();
				setDragMoveListener(null);
			}
			if (dragEndListener) {
				dragEndListener.remove();
				setDragEndListener(null);
			}

			// Re-enable navigation
			if (currentMapView) {
				currentMapView.navigation.mouseWheelZoomEnabled = true;
				currentMapView.navigation.browserTouchPanEnabled = true;

				const container = currentMapView.container as HTMLElement;
				if (container) {
					container.style.cursor = 'default';
				}
			}

			// Mark as customized
			if (draggedLabel.attributes && draggedLabel.geometry) {
				const labelPoint = draggedLabel.geometry as any;
				draggedLabel.attributes.customized = true;
				draggedLabel.attributes.lastModified = Date.now();
				draggedLabel.attributes.hasCustomPosition = true;
				draggedLabel.attributes.customPosition = {
					x: labelPoint.x,
					y: labelPoint.y,
					spatialReference: labelPoint.spatialReference
				};
				draggedLabel.attributes.lastMoved = Date.now();
			}

			// ✨ NEW: Clean up ALL measurement overlays after drag completes
			setTimeout(() => {
				cleanupAllMeasurementOverlays();
			}, 100);

		} catch (error) {
			console.error('❌ Error ending label drag:', error);
		} finally {
			isDraggingRef.current = false;
			labelBeingDraggedRef.current = null;
			setIsDraggingLabel(false);
			setLabelBeingDragged(null);
			setDragStartPoint(null);

			setTimeout(() => {
				if (draggedLabel && editableMeasurementsRef.current) {
					handleMeasurementLabelSelection(draggedLabel);
				}
			}, 250);
		}
	};

	const handleLabelDragMove = (event: any) => {
		//console.log('🎯 handleLabelDragMove called');

		if (!isDraggingLabel || !labelBeingDragged || !currentMapView) {
			// console.log('❌ Drag move conditions not met:', {
			//   isDragging: isDraggingLabel,
			//   hasLabel: !!labelBeingDragged,
			//   hasMapView: !!currentMapView
			// });
			return;
		}

		//console.log('📍 Processing drag move - mouse at:', event.x, event.y);

		try {
			// Convert screen coordinates to map coordinates
			const mapPoint = currentMapView.toMap({
				x: event.x,
				y: event.y
			});

			if (mapPoint && labelBeingDragged) {
				//console.log('✅ Moving label to map coords:', mapPoint.x.toFixed(2), mapPoint.y.toFixed(2));

				// Update label position
				labelBeingDragged.geometry = mapPoint;

				// Update overlay positions if they exist
				if (labelBeingDragged._dragHandle) {
					labelBeingDragged._dragHandle.geometry = mapPoint;
				}

				if (labelBeingDragged._selectionOverlay) {
					labelBeingDragged._selectionOverlay.geometry = mapPoint;
				}

				// Mark as having custom position
				if (!labelBeingDragged.attributes) {
					labelBeingDragged.attributes = {};
				}
				labelBeingDragged.attributes.hasCustomPosition = true;
				labelBeingDragged.attributes.customPosition = {
					x: mapPoint.x,
					y: mapPoint.y,
					spatialReference: mapPoint.spatialReference
				};
				labelBeingDragged.attributes.lastMoved = Date.now();
			}
		} catch (error) {
			console.error('❌ Error during label drag move:', error);
		}
	};

	const handleLabelDragEnd = (event?: any) => {
		//console.log('🏁 handleLabelDragEnd called');

		if (!isDraggingLabel || !labelBeingDragged) {
			//console.log('⚠️ No active drag to end');
			return;
		}

		//console.log('🎯 Processing drag end for:', labelBeingDragged.attributes?.name);

		try {
			// Re-enable map navigation
			if (currentMapView) {
				currentMapView.navigation.mouseWheelZoomEnabled = true;
				currentMapView.navigation.browserTouchPanEnabled = true;

				const container = currentMapView.container as HTMLElement;
				if (container) {
					container.style.cursor = 'default';
					//console.log('✅ Reset cursor to default');
				}
				//console.log('✅ Restored map navigation');
			}

			// Clean up event listeners
			if (dragMoveListener) {
				dragMoveListener.remove();
				setDragMoveListener(null);
				//console.log('✅ Removed move listener');
			}
			if (dragEndListener) {
				dragEndListener.remove();
				setDragEndListener(null);
				//console.log('✅ Removed end listener');
			}

			// Mark the label as customized
			if (labelBeingDragged.attributes) {
				labelBeingDragged.attributes.customized = true;
				labelBeingDragged.attributes.lastModified = Date.now();
			}

			//console.log('✅ Label moved to new position');

		} catch (error) {
			console.error('❌ Error ending label drag:', error);
		} finally {
			// Reset drag state
			setIsDraggingLabel(false);
			setLabelBeingDragged(null);
			setDragStartPoint(null);

			//console.log('🏁 Drag state reset complete');
		}
	};

	// Respect custom position when updating measurements
	const respectCustomPosition = (labelGraphic: ExtendedGraphic, defaultLabelPoint: any) => {
		// If the label has a custom position, use it instead of the calculated position
		if (labelGraphic.attributes?.hasCustomPosition && labelGraphic.attributes?.customPosition) {
			try {
				const customPos = labelGraphic.attributes.customPosition;
				const customPoint = new Point({
					x: customPos.x,
					y: customPos.y,
					spatialReference: customPos.spatialReference
				});

				//console.log('Using custom position for measurement label');
				return customPoint;
			} catch (error) {
				console.warn('Error loading custom position, falling back to default:', error);
				// Clear invalid custom position
				labelGraphic.attributes.hasCustomPosition = false;
				labelGraphic.attributes.customPosition = null;
			}
		}

		return defaultLabelPoint;
	};

	const cleanupAllMeasurementOverlays = () => {
		if (!drawLayer || !isLayerBasicallyValid()) return;

		try {
			const allGraphics = drawLayer.graphics.toArray();

			// Find all measurement-related overlays and handles
			const measurementOverlays = allGraphics.filter(g =>
				g.attributes?.isSelectionOverlay && g.attributes?.isMeasurementOverlay ||
				g.attributes?.isDragHandle
			);

			// Remove them
			measurementOverlays.forEach(overlay => {
				try {
					drawLayer.remove(overlay);
				} catch (e) {
					console.warn('Error removing measurement overlay:', e);
				}
			});

			// Also clear references on measurement labels
			allGraphics.forEach(g => {
				if (isMeasurementLabel(g)) {
					if ((g as any)._selectionOverlay) {
						(g as any)._selectionOverlay = null;
					}
					if ((g as any)._dragHandle) {
						(g as any)._dragHandle = null;
					}
				}
			});

			//console.log(`Cleaned up ${measurementOverlays.length} measurement overlays`);
		} catch (error) {
			console.error('Error in cleanupAllMeasurementOverlays:', error);
		}
	};

	const enhancedMeasurementLabelClickHandler = async (event: any) => {
		//console.log('Measurement click handler triggered');

		// Check tool state first
		if (currentTool && currentTool !== '' && currentTool !== 'text') {
			//console.log('Drawing tool active - bypassing measurement handler:', currentTool);
			return;
		}

		const isEditingEnabled = editableMeasurementsRef.current;
		//console.log('Editing enabled:', isEditingEnabled);

		if (!isEditingEnabled || !currentMapView) {
			//console.log('Editing disabled or no map view');
			return;
		}

		try {
			//console.log('Performing hit test for measurement labels...');

			// Use a more defensive hit test that doesn't rely on layer view
			const hitTestResult = await currentMapView.hitTest(event, {
				// Don't specify include/exclude to avoid layer view issues
			});

			//console.log('Hit test results:', hitTestResult.results.length);

			// Filter results to find measurement labels
			const measurementResults = hitTestResult.results.filter(result => {
				if (!result || !('graphic' in result) || !result.graphic) return false;
				const graphic = result.graphic;

				// More defensive measurement label identification
				if (!graphic.symbol || graphic.symbol.type !== 'text') return false;

				// Check for measurement patterns without relying on layer membership
				const text = (graphic.symbol as any).text || '';
				const hasMeasurementPattern = /(\d+(\.\d+)?\s*(km|mi|m|ft|yd|km²|mi²|ac|ha|m²|ft²|yd²))|Area:|Perimeter:|Radius:|Total:|Lat:|Lon:|X:|Y:/.test(text);

				return hasMeasurementPattern || graphic.attributes?.isMeasurementLabel;
			});

			//console.log('Found measurement results:', measurementResults.length);

			if (measurementResults.length > 0) {
				//console.log('Processing measurement label click');
				const result = measurementResults[0] as any;
				const clickedGraphic = result.graphic;

				handleMeasurementLabelSelection(clickedGraphic);
			} else {
				//console.log('No measurement labels found - clearing selection');
				cleanupMeasurementLabelSelection();
			}
		} catch (error) {
			console.error('Error in measurement label click handler:', error);
		}
	};

	// Automatically select measurement label for the currently selected graphic
	const autoSelectCurrentGraphicMeasurementLabel = () => {
		// Try to get currently selected graphic from various sources
		let selectedGraphic = null;

		// Method 1: From sketchViewModel updateGraphics
		if (sketchViewModel?.updateGraphics?.length > 0) {
			selectedGraphic = sketchViewModel.updateGraphics.getItemAt(0);
		}

		// Method 2: From currentGraphic state
		if (!selectedGraphic && currentGraphic) {
			selectedGraphic = currentGraphic;
		}

		// Method 3: Try to find a recently selected graphic in the layer
		if (!selectedGraphic && drawLayer) {
			// Look for graphics that might be selected (this is implementation-specific)
			const allGraphics = drawLayer.graphics.toArray();
			const drawingGraphics = allGraphics.filter(g =>
				isActualDrawing(g) && !isMeasurementLabel(g)
			);

			// If there's only one drawing, select it
			if (drawingGraphics.length === 1) {
				selectedGraphic = drawingGraphics[0];
			}
		}

		if (selectedGraphic && selectedGraphic.measure?.graphic) {
			//console.log('Auto-selecting measurement label for current graphic');
			handleMeasurementLabelSelection(selectedGraphic.measure.graphic);
		} else if (selectedGraphic) {
			//console.log('Selected graphic found but no measurement label available');
		} else {
			//console.log('No graphic currently selected for measurement label editing');
		}
	};

	const toggleMeasurementEditing = (e) => {
		const newEditingState = e;
		//console.log('Toggling measurement editing from', editableMeasurements, 'to', newEditingState);

		if (!drawLayer) {
			console.error('DrawLayer is null - cannot set up measurement editing');
			return;
		}

		// When DISABLING measurement editing - cleanup FIRST before state changes
		if (!newEditingState) {
			// STEP 1: Clean up all measurement overlays and selections
			cleanupMeasurementLabelSelection();

			// STEP 2: Re-enable SketchViewModel
			if (sketchViewModel && sketchViewModel.view) {
				try {
					sketchViewModel.updateOnGraphicClick = true;
					//console.log('Re-enabled SketchViewModel after measurement editing');
				} catch (error) {
					console.warn('Error re-enabling SketchViewModel:', error);
				}
			}

			// STEP 3: Force cursor reset
			let mapView = currentMapView;
			if (!mapView && sketchViewModel?.view) {
				mapView = sketchViewModel.view;
			}
			if (!mapView && props.jimuMapView?.view) {
				mapView = props.jimuMapView.view;
			}

			if (mapView?.container) {
				(mapView.container as HTMLElement).style.cursor = 'default';
				//console.log('Force reset cursor on disable');
			}

			// STEP 4: Reset drag refs if they exist
			if (isDraggingRef) {
				isDraggingRef.current = false;
			}
			if (labelBeingDraggedRef) {
				labelBeingDraggedRef.current = null;
			}

			// STEP 5: Clean up any remaining event listeners
			if (dragMoveListener) {
				dragMoveListener.remove();
				setDragMoveListener(null);
			}
			if (dragEndListener) {
				dragEndListener.remove();
				setDragEndListener(null);
			}
		}

		// When ENABLING measurement editing
		if (newEditingState && sketchViewModel && sketchViewModel.view) {
			try {
				// Cancel any active operations first
				if (sketchViewModel.state === 'active' && sketchViewModel.activeTool) {
					sketchViewModel.cancel();
					//console.log('Cancelled active SketchViewModel operations for measurement editing');
				}

				// CRITICAL: Disable SketchViewModel completely during measurement editing
				sketchViewModel.updateOnGraphicClick = false;
				//console.log('Disabled SketchViewModel for measurement editing');
			} catch (error) {
				console.warn('Error disabling SketchViewModel:', error);
			}
		}

		// Update state - the useEffect will handle the actual setup/cleanup
		setEditableMeasurements(newEditingState);
	};

	// Set up click listener for measurement labels
	const setupEnhancedMeasurementLabelClickListener = () => {
		if (!currentMapView) {
			console.error('Cannot setup click listener - currentMapView is null');
			return;
		}

		if (!sketchViewModel || !sketchViewModel.view) {
			console.error('Cannot setup click listener - SketchViewModel not ready');
			return;
		}

		// CRITICAL FIX: Don't try to access layer view at all during setup
		// This prevents the LayerLayerViewInfo error

		//console.log('Setting up measurement label click listener WITHOUT layer view access');

		// Remove existing listener first
		removeMeasurementLabelClickListener();

		// Set up the click listener without any layer view operations
		try {
			const clickListener = currentMapView.on('immediate-click', enhancedMeasurementLabelClickHandler);
			setMeasurementClickListener(clickListener);
			//console.log('Measurement click listener set up successfully');
		} catch (error) {
			console.error('Error setting up click listener:', error);
		}
	};

	// Remove measurement label click listener
	const removeMeasurementLabelClickListener = () => {
		if (measurementClickListener) {
			measurementClickListener.remove();
			setMeasurementClickListener(null);
		}
	};

	const handleMeasurementLabelSelection = (labelGraphic: ExtendedGraphic) => {
		if (!editableMeasurements) return;

		try {
			// More permissive check for text symbols - handle restored labels
			const isTextSymbol = labelGraphic.symbol?.type === 'text';
			if (!isTextSymbol) {
				//console.log('Selected graphic is not a text symbol');
				return;
			}

			// Cast to TextSymbol since we've verified the type
			const textSymbol = labelGraphic.symbol as TextSymbol;

			// If not already marked as measurement label, check if it looks like one
			if (!labelGraphic.attributes?.isMeasurementLabel) {
				const text = textSymbol.text || '';
				const hasMeasurementPattern = /(\d+(\.\d+)?\s*(km|mi|m|ft|yd|km²|mi²|ac|ha|m²|ft²|yd²))|Area:|Perimeter:|Radius:|Total:|Lat:|Lon:|X:|Y:/.test(text);

				if (!hasMeasurementPattern) {
					//console.log('Selected text graphic does not appear to be a measurement label:', text.substring(0, 30));
					return;
				}

				// Mark it now for future reference - this handles restored labels
				if (!labelGraphic.attributes) labelGraphic.attributes = {};
				labelGraphic.attributes.isMeasurementLabel = true;
				labelGraphic.attributes.hideFromList = true;
				labelGraphic.attributes.drawMode = 'text';

				// Try to identify measurement type from content
				if (text.includes('Area:') || text.includes('Perimeter:') || text.includes('Radius:')) {
					labelGraphic.attributes.measurementType = 'main';
				} else if (text.includes('Total:')) {
					labelGraphic.attributes.measurementType = 'main';
				} else if (text.includes('Lat:') || text.includes('Lon:') || text.includes('X:') || text.includes('Y:')) {
					labelGraphic.attributes.measurementType = 'coordinate';
				} else if (/^\d+(\.\d+)?\s*(km|mi|m|ft|yd)$/.test(text.trim())) {
					labelGraphic.attributes.measurementType = 'segment';
				} else {
					labelGraphic.attributes.measurementType = 'main';
				}

				// console.log('Identified and marked restored measurement label:', {
				//   text: text.substring(0, 30),
				//   type: labelGraphic.attributes.measurementType
				// });
			}

			// Clear previous selection
			cleanupMeasurementLabelSelection();

			// Set new selection
			setSelectedMeasurementLabel(labelGraphic);

			// Initialize text symbol from selected label - use the cast symbol
			const currentSymbol = textSymbol;
			setMeasurementTextSymbol(currentSymbol.clone());

			// console.log('🔍 Reading symbol properties for UI sync:', {
			//   color: currentSymbol.color,
			//   fontSize: currentSymbol.font.size,
			//   fontWeight: currentSymbol.font.weight,
			//   fontStyle: currentSymbol.font.style,
			//   fontDecoration: currentSymbol.font.decoration,
			//   angle: currentSymbol.angle,
			//   haloSize: currentSymbol.haloSize,
			//   haloColor: currentSymbol.haloColor
			// });

			// ENHANCED: More thorough state synchronization from actual symbol
			setMeasurementFontColor(convertSymbolColorToColorPickerValue(currentSymbol.color));
			setMeasurementFontSize(currentSymbol.font.size || 14);
			setMeasurementFontRotation(currentSymbol.angle || 0);

			// FIXED: Proper halo state detection
			const hasHalo = !!(currentSymbol.haloSize && currentSymbol.haloSize > 0);
			setMeasurementHaloEnabled(hasHalo);

			if (currentSymbol.haloColor) {
				setMeasurementHaloColor(convertSymbolColorToColorPickerValue(currentSymbol.haloColor));
			} else {
				setMeasurementHaloColor('rgba(255,255,255,1)'); // Default white halo
			}

			setMeasurementHaloSize(currentSymbol.haloSize || 2);

			// console.log('✅ UI state synchronized:', {
			//   fontColor: convertSymbolColorToColorPickerValue(currentSymbol.color),
			//   fontSize: currentSymbol.font.size || 14,
			//   fontRotation: currentSymbol.angle || 0,
			//   haloEnabled: hasHalo,
			//   haloColor: currentSymbol.haloColor ? convertSymbolColorToColorPickerValue(currentSymbol.haloColor) : 'rgba(255,255,255,1)',
			//   haloSize: currentSymbol.haloSize || 2
			// });

			// Create selection overlay
			createMeasurementLabelOverlay(labelGraphic);

			// Set up drag handlers
			setupLabelDragHandlers(labelGraphic);

			//console.log('Selected measurement label for editing and movement');
		} catch (error) {
			console.error('Error selecting measurement label:', error);
		}
	};

	// Create selection overlay for measurement label
	const createMeasurementLabelOverlay = (labelGraphic: ExtendedGraphic) => {
		if (!drawLayer || !labelGraphic.geometry) return;

		// Remove existing overlay
		if (labelGraphic._selectionOverlay) {
			try {
				drawLayer.remove(labelGraphic._selectionOverlay);
			} catch (e) { }
			labelGraphic._selectionOverlay = null;
		}

		const overlaySymbol = new SimpleMarkerSymbol({
			style: 'diamond',
			size: 24,
			color: [255, 165, 0, 0.2], // Orange overlay for measurement labels
			outline: {
				color: [255, 165, 0, 0.8],
				width: 2,
				style: 'dash'
			}
		});

		const overlay = new Graphic({
			geometry: labelGraphic.geometry,
			symbol: overlaySymbol,
			attributes: {
				isSelectionOverlay: true,
				isMeasurementOverlay: true,
				parentGraphicId: labelGraphic.attributes?.uniqueId || 'measurement_overlay'
			}
		});

		try {
			drawLayer.add(overlay);
			labelGraphic._selectionOverlay = overlay;
		} catch (error) {
			console.error('Error creating measurement label overlay:', error);
		}
	};

	const cleanupMeasurementLabelSelection = () => {
		if (selectedMeasurementLabel) {
			// Remove selection overlay
			if (selectedMeasurementLabel._selectionOverlay) {
				try {
					drawLayer.remove(selectedMeasurementLabel._selectionOverlay);
				} catch (err) {
					console.warn('Error removing overlay:', err);
				}
				selectedMeasurementLabel._selectionOverlay = null;
			}

			// Remove drag handlers
			removeLabelDragHandlers(selectedMeasurementLabel);

			// Clear React state
			setSelectedMeasurementLabel(null);
			setMeasurementTextSymbol(null);
		}

		// Clean up any ongoing drag operation
		if (isDraggingLabel) {
			handleLabelDragEnd(null);
		}

		// **ADD THIS**: Force cleanup of ALL measurement overlays when disabling
		if (drawLayer && isLayerBasicallyValid()) {
			try {
				const allGraphics = drawLayer.graphics.toArray();
				const measurementOverlays = allGraphics.filter(g =>
					g.attributes?.isSelectionOverlay && g.attributes?.isMeasurementOverlay
				);

				measurementOverlays.forEach(overlay => {
					try {
						drawLayer.remove(overlay);
					} catch (e) {
						console.warn('Error removing orphaned overlay:', e);
					}
				});

				// Also clear any _selectionOverlay references on measurement labels
				allGraphics.forEach(g => {
					if (isMeasurementLabel(g) && (g as any)._selectionOverlay) {
						(g as any)._selectionOverlay = null;
					}
				});

				//console.log(`Cleaned up ${measurementOverlays.length} measurement overlays`);
			} catch (error) {
				console.error('Error in comprehensive overlay cleanup:', error);
			}
		}
	};

	// Apply text changes to selected measurement label
	const applyMeasurementTextChanges = () => {
		applyMeasurementTextChangesWithSymbol(measurementTextSymbol);
	};

	// Reset measurement label to default
	const resetMeasurementLabelToDefault = () => {
		if (!selectedMeasurementLabel) return;

		try {
			// Find parent graphic and regenerate measurement
			const parentGraphicId = selectedMeasurementLabel.attributes?.parentGraphicId;
			if (parentGraphicId && drawLayer) {
				const parentGraphic = drawLayer.graphics.find(
					(g: any) => g.attributes?.uniqueId === parentGraphicId
				);

				if (parentGraphic) {
					// Force regenerate the measurement
					_addMeasurement(parentGraphic as ExtendedGraphic, null, true);
					cleanupMeasurementLabelSelection();
				}
			}
		} catch (error) {
			console.error('Error resetting measurement label:', error);
		}
	};

	// Reset label position to default calculated position
	const resetLabelPosition = () => {
		if (!selectedMeasurementLabel || !selectedMeasurementLabel.measureParent) return;

		try {
			// Clear custom position flags
			selectedMeasurementLabel.attributes.hasCustomPosition = false;
			selectedMeasurementLabel.attributes.customPosition = null;

			const parentGraphic = selectedMeasurementLabel.measureParent;
			let defaultLabelPoint;

			// FIXED: Check if this is a segment label
			const isSegmentLabel = selectedMeasurementLabel.attributes?.measurementType === 'segment';

			if (isSegmentLabel) {
				// For segment labels, we need to find the specific segment's midpoint
				// This requires storing segment info when the label was created
				const segmentInfo = selectedMeasurementLabel.attributes?.segmentInfo;

				if (segmentInfo && segmentInfo.point1 && segmentInfo.point2) {
					// Calculate midpoint of the specific segment
					defaultLabelPoint = _getSegmentMidpoint(
						segmentInfo.point1,
						segmentInfo.point2,
						parentGraphic.geometry
					);
				} else {
					// Fallback if segment info not available
					defaultLabelPoint = _getLabelPoint(parentGraphic.geometry);
				}
			} else {
				// For main labels, use the standard label point calculation
				defaultLabelPoint = _getLabelPoint(parentGraphic.geometry);
			}

			if (defaultLabelPoint) {
				// Move label back to default position
				selectedMeasurementLabel.geometry = defaultLabelPoint;

				// Update drag handle position if it exists
				if (selectedMeasurementLabel._dragHandle) {
					selectedMeasurementLabel._dragHandle.geometry = defaultLabelPoint;
				}

				// Update selection overlay position if it exists
				if (selectedMeasurementLabel._selectionOverlay) {
					selectedMeasurementLabel._selectionOverlay.geometry = defaultLabelPoint;
				}

				//console.log('Reset measurement label to default position');
			}
		} catch (error) {
			console.error('Error resetting label position:', error);
		}
	};

	// Helper function to convert symbol color to color picker value
	const convertSymbolColorToColorPickerValue = (color: any) => {
		if (color && color.toRgba) {
			const rgbaClr = color.toRgba();
			return `rgba(${rgbaClr[0]},${rgbaClr[1]},${rgbaClr[2]},${rgbaClr[3]})`;
		}
		return 'rgba(0,0,0,1)';
	};

	const updateMeasurementHalo = (enabled: boolean, color?: string, size?: number) => {
		//console.log('Updating halo - enabled:', enabled, 'color:', color, 'size:', size);

		if (!measurementTextSymbol || !selectedMeasurementLabel) {
			//console.log('Missing required objects for halo update');
			return;
		}

		// Calculate the actual values to use (prioritize parameters over current state)
		const actualEnabled = enabled;
		const actualColor = color !== undefined ? color : measurementHaloColor;
		const actualSize = size !== undefined ? size : measurementHaloSize;

		// Update state variables for UI consistency
		setMeasurementHaloEnabled(actualEnabled);
		if (color !== undefined) setMeasurementHaloColor(color);
		if (size !== undefined) setMeasurementHaloSize(size);

		// Create updated symbol immediately and synchronously using actual values
		const updatedSymbol = measurementTextSymbol.clone();

		// Apply halo changes to the cloned symbol using actual values (not state)
		if (actualEnabled) {
			updatedSymbol.haloColor = new Color(actualColor);
			updatedSymbol.haloSize = actualSize;
		} else {
			updatedSymbol.haloColor = null;
			updatedSymbol.haloSize = null;
		}

		// Update the measurement text symbol state
		setMeasurementTextSymbol(updatedSymbol);

		// Apply changes immediately using the updated symbol
		applyMeasurementTextChangesWithSymbol(updatedSymbol);
	};

	const updateMeasurementFontColor = (colorValue: string) => {
		//console.log('Updating font color to:', colorValue);

		if (!measurementTextSymbol || !selectedMeasurementLabel) {
			//console.log('Missing required objects for color update');
			return;
		}

		// Update state for UI consistency
		setMeasurementFontColor(colorValue);

		// Create updated symbol immediately using the new color value
		const updatedSymbol = measurementTextSymbol.clone();
		updatedSymbol.color = new Color(colorValue);

		// Update symbol state
		setMeasurementTextSymbol(updatedSymbol);

		// Apply changes immediately using the updated symbol
		applyMeasurementTextChangesWithSymbol(updatedSymbol);
	};

	const updateMeasurementFontSize = (size: number) => {
		//console.log('Updating font size to:', size);

		if (!measurementTextSymbol || !selectedMeasurementLabel) {
			//console.log('Missing required objects for size update');
			return;
		}

		// Update state for UI consistency
		setMeasurementFontSize(size);

		// Create updated symbol immediately using the new size value
		const updatedSymbol = measurementTextSymbol.clone();
		updatedSymbol.font = updatedSymbol.font.clone();
		updatedSymbol.font.size = size; // Use parameter value directly

		// Update symbol state
		setMeasurementTextSymbol(updatedSymbol);

		// Apply changes immediately using the updated symbol
		applyMeasurementTextChangesWithSymbol(updatedSymbol);
	};

	const updateMeasurementFontRotation = (rotation: number) => {
		//console.log('Updating font rotation to:', rotation);

		if (!measurementTextSymbol || !selectedMeasurementLabel) {
			//console.log('Missing required objects for rotation update');
			return;
		}

		// Update state for UI consistency
		setMeasurementFontRotation(rotation);

		// Create updated symbol immediately using the new rotation value
		const updatedSymbol = measurementTextSymbol.clone();
		updatedSymbol.angle = rotation; // Use parameter value directly

		// Update symbol state
		setMeasurementTextSymbol(updatedSymbol);

		// Apply changes immediately using the updated symbol
		applyMeasurementTextChangesWithSymbol(updatedSymbol);
	};

	const _calculateAngle = (x1: number, y1: number, x2: number, y2: number) => {
		const dx = x2 - x1
		const dy = y2 - y1
		const angleRad = Math.atan2(dy, dx)
		let angleDeg = angleRad * -180 / Math.PI
		if (angleDeg > 90 || angleDeg < -90) {
			angleDeg = (angleDeg + 180) % 360
		}
		return angleDeg
	}

	// Calculate the overall angle/direction of a polyline for main label rotation
	const _calculatePolylineAngle = (geometry: any) => {
		if (!geometry || !geometry.paths || geometry.paths.length === 0) {
			return null;
		}

		const path = geometry.paths[0]; // Use the first path
		if (!path || path.length < 2) {
			return null;
		}

		// For simple polylines, use the angle of the longest segment
		let longestSegmentLength = 0;
		let longestSegmentAngle = null;

		for (let i = 1; i < path.length; i++) {
			const point1 = path[i - 1];
			const point2 = path[i];

			// Calculate segment length
			const dx = point2[0] - point1[0];
			const dy = point2[1] - point1[1];
			const segmentLength = Math.sqrt(dx * dx + dy * dy);

			// If this is the longest segment so far, use its angle
			if (segmentLength > longestSegmentLength) {
				longestSegmentLength = segmentLength;
				longestSegmentAngle = _calculateAngle(point1[0], point1[1], point2[0], point2[1]);
			}
		}

		return longestSegmentAngle;
	};

	//finds where to place a label
	const _getLabelPoint = (geometry) => {
		if (!geometry) return null;
		// Curves have an empty paths array -> densify so extent/center is valid.
		geometry = _asMeasurableLine(geometry);

		// If already a point, return it directly
		if (geometry.type === 'point') {
			return new Point({
				x: geometry.x,
				y: geometry.y,
				spatialReference: geometry.spatialReference
			});
		}

		// If the geometry supports centroid (e.g. Polygon), use it
		if ('centroid' in geometry && geometry.centroid) {
			return geometry.centroid;
		}

		// Fallback to extent center if available
		if (geometry.extent?.center) {
			return geometry.extent.center;
		}

		console.warn('Unable to determine label point for geometry type:', geometry.type);
		return null;
	};

	// Helper function to get segment midpoint
	const _getSegmentMidpoint = (point1: number[], point2: number[], geometry: any): any | null => {
		try {
			const midX = (point1[0] + point2[0]) / 2;
			const midY = (point1[1] + point2[1]) / 2;

			return new Point({
				x: midX,
				y: midY,
				spatialReference: geometry.spatialReference
			});
		} catch (error) {
			console.error('Error calculating segment midpoint:', error);
			return null;
		}
	};

	// Helper function to force map refresh
	const forceMapRefresh = () => {
		if (!currentMapView) return;

		try {
			// Method 1: Use redraw method if available
			if (typeof (currentMapView as any).redraw === 'function') {
				(currentMapView as any).redraw();
			}

			// Method 2: Toggle layer visibility briefly
			if (drawLayer && drawLayer.visible !== undefined) {
				const wasVisible = drawLayer.visible;
				drawLayer.visible = false;
				requestAnimationFrame(() => {
					if (drawLayer) {
						drawLayer.visible = wasVisible;
					}
				});
			}

			// Method 3: Force layer refresh if available
			if (drawLayer && typeof (drawLayer as any).refresh === 'function') {
				(drawLayer as any).refresh();
			}
		} catch (error) {
			console.warn('Error forcing map refresh:', error);
		}
	};

	// Function to ensure label visibility
	const ensureLabelVisibility = (labelGraphic: ExtendedGraphic) => {
		if (!labelGraphic || !drawLayer) return;

		try {
			// 🆕 FIX: Make labels visible if measurements are enabled OR parent graphic has measurements
			let shouldBeVisible = measureEnabledRef.current;

			// Check if the parent graphic has/had measurements
			if (!shouldBeVisible) {
				const parentGraphic = labelGraphic.measureParent as ExtendedGraphic;
				if (parentGraphic) {
					shouldBeVisible = !!(
						parentGraphic.measure?.graphic ||
						parentGraphic.attributes?.hadMeasurements ||
						parentGraphic.attributes?.measurementsPermanent ||
						(parentGraphic.attributes?.relatedMeasurementLabels?.length > 0) ||
						(parentGraphic.attributes?.relatedSegmentLabels?.length > 0)
					);
				}
			}

			labelGraphic.visible = shouldBeVisible;

			// Reorder the label to ensure it's on top
			if (drawLayer.graphics.includes(labelGraphic)) {
				drawLayer.remove(labelGraphic);
				drawLayer.add(labelGraphic);
			}

			// Force a refresh after a brief delay
			setTimeout(() => {
				forceMapRefresh();
			}, 100);

		} catch (error) {
			console.warn('Error ensuring label visibility:', error);
		}
	};

	// Minimal throttling only for complete events
	const throttledCompleteUpdate = (graphic: ExtendedGraphic) => {
		if (!graphic || !graphic.geometry || isMeasurementLabel(graphic)) return;

		const graphicId = getGraphicId(graphic);

		// Clear any existing timeout for this graphic
		const existingTimeout = completeTimeouts.get(graphicId);
		if (existingTimeout) {
			clearTimeout(existingTimeout);
		}

		// Schedule update with minimal delay for complete events only
		const timeoutId = setTimeout(() => {
			_addMeasurement(graphic, null, true); // Force update
			setCompleteTimeouts(prev => {
				const newMap = new Map(prev);
				newMap.delete(graphicId);
				return newMap;
			});
		}, COMPLETE_THROTTLE_DELAY);

		setCompleteTimeouts(prev => new Map(prev).set(graphicId, timeoutId));
	};

	// Simple cleanup for complete timeouts only
	const cleanupCompleteThrottling = (graphic: ExtendedGraphic) => {
		if (!graphic) return;

		const graphicId = getGraphicId(graphic);

		// Clear timeout
		const existingTimeout = completeTimeouts.get(graphicId);
		if (existingTimeout) {
			clearTimeout(existingTimeout);
			setCompleteTimeouts(prev => {
				const newMap = new Map(prev);
				newMap.delete(graphicId);
				return newMap;
			});
		}
	};

	// Gate: only allow generation when toggle is ON and this is not a label itself
	const shouldGenerateMeasurements = (g?: ExtendedGraphic) =>
		!!measureEnabledRef.current && (!g || !isMeasurementLabel(g));

	// Best-effort cancel of queued work so nothing runs after we turn OFF
	const cancelPendingMeasurementWork = () => {
		try {
			processingQueue.current?.clear?.();
		} catch { }
		try {
			// If your debounced fn exposes cancel() (lodash.debounce), call it:
			debouncedUpdateMeasurements.current = debounce((g: ExtendedGraphic) => {
				if (!shouldGenerateMeasurements(g)) return;
				_addMeasurement(g, null, false);
			}, 120);
		} catch { }
	};


	//calculate measurements and return a text value
	const _getMeasureText = (geometry, parentGraphic, customDistanceUnit = null, customAreaUnit = null, graphic = null) => {
		if (!geometry) return '';

		try {
			const currentDistanceUnit = customDistanceUnit || distanceUnit.unit;
			const currentAreaUnit = customAreaUnit || areaUnit.unit;

			switch (geometry.type) {
				case 'polyline': {
					const length = _calculatePolylineLength(geometry);
					const lengthUnitInfo = availableDistanceUnits.find(u => u.unit === currentDistanceUnit);
					const lengthUnitLabel = lengthUnitInfo ? lengthUnitInfo.abbreviation : currentDistanceUnit;

					let polylinePattern = lengthOn ? props.config.measurePolylineLabel || '{{length}} {{lengthUnit}}' : '';
					if (shouldCreateSegments(geometry) && polylinePattern) {
						polylinePattern = props.nls('measurementTotal', { value: polylinePattern })
					}
					if (parentGraphic) {
						polylinePattern = props.config.measurePolylineLabel || '{{length}} {{lengthUnit}}';
					}

					return polylinePattern
						.replace(/{{length}}/g, _round(length, otherRound).toLocaleString())
						.replace(/{{lengthUnit}}/g, lengthUnitLabel);
				}

				case 'polygon': {
					// 🔧 PRESET CIRCLE ACCURACY: a preset circle is STORED as a 60-point
					// polygon approximation, and measuring that inscribed 60-gon
					// under-reports the true circle by fixed geometric ratios — area
					// ×(30/π)·sin(π/30) = 0.998172 and perimeter ×(60/π)·sin(π/60) =
					// 0.999543. That is exactly the community report: 1000 ac entered →
					// "998.17 ac" labeled, 1000 ft radius entered → "999.54 ft" labeled
					// (radius derives from perimeter/2π). When the graphic carries the
					// authoritative radius it was built with, label the TRUE circle
					// analytically instead of measuring the approximation. Drag-drawn
					// circles have no entered value to honor and stay measured as-is.
					const authoritativeRadiusM = (graphic as any)?.attributes?.circleRadiusMeters;
					const useAnalyticCircle =
						typeof authoritativeRadiusM === 'number' &&
						isFinite(authoritativeRadiusM) &&
						authoritativeRadiusM > 0;

					let area: number;
					let perimeter: number;
					let analyticRadius: number | null = null;
					if (useAnalyticCircle) {
						const distInfo = availableDistanceUnits.find(u => u.unit === currentDistanceUnit);
						const aInfo = areaUnits.find(u => u.unit === currentAreaUnit);
						analyticRadius = authoritativeRadiusM * ((distInfo as any)?.conversion ?? 1);
						perimeter = 2 * Math.PI * analyticRadius;
						area = Math.PI * authoritativeRadiusM * authoritativeRadiusM * ((aInfo as any)?.conversion ?? 1);
					} else {
						area = _calculatePolygonArea(geometry);
						perimeter = _calculatePolygonPerimeter(geometry);
					}

					const areaUnitInfo = areaUnits.find(u => u.unit === currentAreaUnit);
					const areaUnitLabel = areaUnitInfo ? areaUnitInfo.abbreviation : currentAreaUnit;

					const perimeterUnitInfo = availableDistanceUnits.find(u => u.unit === currentDistanceUnit);
					const perimeterUnitLabel = perimeterUnitInfo ? perimeterUnitInfo.abbreviation : currentDistanceUnit;

					let defaultPattern = ''
					if (areaOn && perimeterOn) {
						defaultPattern = `${props.nls('measurementAreaLine', { value: '{{area}}', unit: '{{areaUnit}}' })}\n${props.nls('measurementPerimeterLine', { value: '{{length}}', unit: '{{lengthUnit}}' })}`
					} else if (areaOn) {
						defaultPattern = props.nls('measurementAreaLine', { value: '{{area}}', unit: '{{areaUnit}}' })
					} else if (perimeterOn) {
						defaultPattern = props.nls('measurementPerimeterLine', { value: '{{length}}', unit: '{{lengthUnit}}' })
					}
					const polygonPattern = props.config.measurePolygonLabel || defaultPattern;

					let result = polygonPattern
						.replace(/{{area}}/g, _round(area, otherRound).toLocaleString())
						.replace(/{{areaUnit}}/g, areaUnitLabel)
						.replace(/{{length}}/g, _round(perimeter, otherRound).toLocaleString())
						.replace(/{{lengthUnit}}/g, perimeterUnitLabel);

					if (geometry.rings[0].length === 61 && radiusOn) {
						const radius = analyticRadius !== null
							? analyticRadius
							: Math.abs(perimeter / (2 * Math.PI)); // Ensure positive radius
						result += `\n${props.nls('measurementRadiusLine', { value: _round(radius, otherRound).toLocaleString(), unit: perimeterUnitInfo.abbreviation })}`;
					}

					return result;
				}

				default:
					console.warn(`Unsupported geometry type for measurement: ${geometry.type}`);
					return '';
			}
		} catch (error) {
			console.error('Error calculating measurement:', error);
			return props.nls('measurementCalculationError');
		}
	};

	//find length of line
	// True-curve polylines (curvePaths) carry an EMPTY paths array, which breaks
	// measurement: the geodetic length operator can't consume curvePaths and the
	// label point falls back to a null extent. Densify curves into a plain polyline
	// for measurement ONLY — the stored graphic keeps its true-curve geometry, and
	// segment labels stay off (the original curve has no straight paths).
	const _asMeasurableLine = (geom: any): any => {
		try {
			if (!geom || geom.type !== 'polyline' || !(geom as any).curvePaths) return geom;
			let maxSeg = 10;
			try { const L = lengthOperator.execute(geom, { unit: 'meters' }); if (L && isFinite(L)) maxSeg = Math.max(1, Math.abs(L) / 120); } catch { }
			const dense = densifyOperator.execute(geom, maxSeg, { unit: 'meters' });
			return (dense && (dense as any).paths && (dense as any).paths.length) ? dense : geom;
		} catch (e) { console.warn('curve densify for measurement failed:', e); return geom; }
	};

	const _calculatePolylineLength = (polyline) => {
		polyline = _asMeasurableLine(polyline);
		let totalLength = 0;
		try {
			if (polyline.spatialReference.isWGS84 || polyline.spatialReference.isWebMercator) {
				totalLength = geodeticLengthOperator.execute(polyline, { unit: 'meters' })
			} else {
				totalLength = lengthOperator.execute(polyline, { unit: 'meters' })
			}
			return _convertLength(Math.abs(totalLength), distanceUnit); // Ensure positive length
		} catch (error) {
			console.error('Error calculating polyline length:', error);
			return 0;
		}
	};

	// Per-segment labels for true curves. curvePaths carries no straight paths, so
	// the normal segment loop yields nothing. Build a one-segment sub-curve for each
	// piece, measure its arc length, and place a label at the arc midpoint.
	const _createCurveSegmentLabels = (graphic: any, geometry: any) => {
		try {
			const cps = (geometry as any).curvePaths;
			if (!Array.isArray(cps) || cps.length === 0) return;
			const sr = geometry.spatialReference;
			const lengthUnitInfo = availableDistanceUnits.find((u) => u.unit === distanceUnit.unit);
			const lengthUnitLabel = lengthUnitInfo ? lengthUnitInfo.abbreviation : distanceUnit.unit;
			const segEnd = (seg: any): number[] => Array.isArray(seg) ? seg : (seg?.c ? seg.c[0] : seg?.b ? seg.b[0] : null);
			if (!graphic.attributes) graphic.attributes = {};
			if (!Array.isArray(graphic.attributes.relatedSegmentLabels)) graphic.attributes.relatedSegmentLabels = [];

			for (const path of cps) {
				if (!Array.isArray(path) || path.length < 2) continue;
				let prev = path[0];
				for (let s = 1; s < path.length; s++) {
					const seg = path[s];
					const end = segEnd(seg);
					if (!prev || !end) { prev = end; continue; }
					const sub = PolylineCompat.fromJSON({ curvePaths: [[prev, seg]], spatialReference: sr });
					const segLen = _calculatePolylineLength(sub);
					// arc midpoint = middle vertex of the densified sub-curve
					const dense: any = _asMeasurableLine(sub);
					const pts = dense?.paths?.[0] || [];
					const midPt = pts.length ? pts[Math.floor(pts.length / 2)] : [(prev[0] + end[0]) / 2, (prev[1] + end[1]) / 2];
					const segMid = new Point({ x: midPt[0], y: midPt[1], spatialReference: sr });
					prev = end;
					if (!(segLen > 0)) continue;

					const segText = `${_round(segLen, otherRound).toLocaleString()} ${lengthUnitLabel}`;
					const segSym: any = currentTextSymbol.clone();
					segSym.text = segText;
					if (!segSym.haloSize) { segSym.haloSize = 2; segSym.haloColor = 'white'; }
					if (segSym.backgroundColor?.a > 0) segSym.backgroundColor.a = 0;

					const segLabel = new Graphic({
						geometry: segMid,
						symbol: segSym,
						visible: measureEnabledRef.current || graphic.attributes?.hadMeasurements || !!graphic.measure,
						attributes: {
							name: segText,
							description: props.nls('segmentLabelDescription'),
							isMeasurementLabel: true,
							hideFromList: true,
							drawMode: 'text',
							measurementType: 'segment',
							parentGraphicId: graphic.attributes?.uniqueId,
							lengthUnit: distanceUnit.unit,
							isSegmentLabel: true,
							segmentIndex: s - 1
						}
					}) as ExtendedGraphic;
					drawLayer.add(segLabel);
					segLabel.measureParent = graphic;
					segLabel.measure = { graphic };
					graphic.attributes.relatedSegmentLabels.push(segLabel);
				}
			}
		} catch (e) { console.warn('curve segment labels warning:', e); }
	};

	//find perimeter
	const _calculatePolygonPerimeter = (polygon) => {
		let perimeter = 0;
		try {
			// Use proper typing for polygon
			const polygonGeometry = polygon as any;
			const rings = polygonGeometry.rings || [];

			for (let i = 0; i < rings.length; i++) {
				const pointArray = rings[i];
				for (let j = 1; j < pointArray.length; j++) {
					const tempGraphic = makeTempLineGraphic(pointArray[j - 1], pointArray[j], polygon);
					let segmentLength = 0;
					if (polygon.spatialReference.isWGS84 || polygon.spatialReference.isWebMercator) {
						segmentLength = geodeticLengthOperator.execute(tempGraphic.geometry, { unit: 'meters' });
					} else {
						segmentLength = lengthOperator.execute(tempGraphic.geometry, { unit: 'meters' });
					}
					perimeter += Math.abs(segmentLength); // Ensure positive segment length
				}
			}
			return _convertLength(perimeter, distanceUnit);
		} catch (error) {
			console.error('Error calculating polygon perimeter:', error);
			return 0;
		}
	};

	//find area
	const _calculatePolygonArea = (polygon) => {
		let area = 0;
		try {
			if (polygon.spatialReference.isWGS84 || polygon.spatialReference.isWebMercator) {
				area = geodeticAreaOperator.execute(polygon, { unit: 'square-meters' })
			} else {
				area = areaOperator.execute(polygon, { unit: 'square-meters' })
			}
			return _convertArea(area, areaUnit);
		} catch (error) {
			console.error('Error calculating polygon area:', error);
			return 0;
		}
	};

	// convert length to desired unit
	const _convertLength = (length, unit) => {
		const factor = unit.conversion || 1;
		return length * factor;
	};

	//convert area to desired unit
	const _convertArea = (area, unit) => {
		const factor = unit.conversion || 1;
		return area * factor;
	};

	// Helper function to calculate segment length directly
	const _calculateSegmentLength = (point1: number[], point2: number[], geometry: any): number => {
		try {
			const tempLine = new Polyline({
				paths: [[point1, point2]],
				spatialReference: geometry.spatialReference
			});

			let segmentLength = 0;
			if (geometry.spatialReference.isWGS84 || geometry.spatialReference.isWebMercator) {
				segmentLength = geodeticLengthOperator.execute(tempLine, { unit: 'meters' });
			} else {
				segmentLength = lengthOperator.execute(tempLine, { unit: 'meters' });
			}

			return _convertLength(Math.abs(segmentLength), distanceUnit); // Ensure positive segment length
		} catch (error) {
			console.error('Error calculating segment length:', error);
			return 0;
		}
	};

	//round output to desired decimals and ensure no negative values
	const _round = (number, decimals = 0) => {
		return Number(Math.abs(number).toFixed(decimals))
	}

	//makes an invisible copy of a line segment for calculating distance and placing text
	const makeTempLineGraphic = (point1, point2, geometry) => {
		const tempLine = new Polyline({
			paths: [[point1, point2]],
			spatialReference: geometry.spatialReference
		})
		const tempGraphic = new Graphic({
			geometry: tempLine,
			symbol: {
				type: 'simple-line'
			},
			visible: false
		})
		return tempGraphic
	}

	const ensureParentOnLayerAndVisible = async (g: ExtendedGraphic) => {
		try {
			if (!g) return;
			// Mark as drawing (helps other codepaths ignore it during label cleanups)
			g.attributes = g.attributes || {};
			g.attributes.isDrawing = true; // never set this on labels

			// Ensure it’s on the layer and visible
			if (!safeLayerContains(g)) drawLayer.add(g);
			if (g.visible === false) g.visible = true;

			// Force a render turn before we add labels
			const v = sketchViewModel?.view;
			if (v && typeof v.whenLayerView === 'function') {
				try { await v.whenLayerView(drawLayer as any); } catch { /* noop */ }
			}
			await new Promise(r => requestAnimationFrame(() => r(null)));

			// Try a soft refresh if available
			if (typeof (drawLayer as any).refresh === 'function') (drawLayer as any).refresh();
		} catch (e) {
			console.warn('Parent persistence failed:', e);
		}
	};


	const cleanExistingMeasurements = (graphic) => {
		if (!graphic) return;

		// Never touch non-text parent drawings here
		// Only clear measurement references on the parent, and remove measurement-only graphics.
		if (!isLayerBasicallyValid()) {
			console.warn('DrawLayer not available for cleanup - clearing references only');
			if (graphic.measure?.graphic) graphic.measure = null;
			// 🔧 NOTE: We intentionally preserve hadMeasurements flag for restoration
			if (Array.isArray(graphic.attributes?.relatedSegmentLabels)) graphic.attributes.relatedSegmentLabels = [];
			// FIX #8: Also clear relatedMeasurementLabels when layer is offline
			if (Array.isArray(graphic.attributes?.relatedMeasurementLabels)) graphic.attributes.relatedMeasurementLabels = [];
			return;
		}

		// Main measurement label
		if (graphic.measure?.graphic) {
			try {
				const mg = graphic.measure.graphic;
				if (mg && isMeasurementOnlyGraphic(mg) && safeLayerContains(mg)) safeLayerRemove(mg);
			} catch (e) {
				console.warn('Failed to remove measurement label:', e);
			} finally {
				graphic.measure = null; // always clear reference
			}
		}

		// Segment labels
		if (Array.isArray(graphic.attributes?.relatedSegmentLabels)) {
			try {
				graphic.attributes.relatedSegmentLabels.forEach((seg) => {
					if (seg && isMeasurementOnlyGraphic(seg)) {
						try { if (safeLayerContains(seg)) safeLayerRemove(seg); } catch (ee) {
							console.warn('Failed to remove a segment label:', ee);
						}
					}
				});
			} finally {
				graphic.attributes.relatedSegmentLabels = [];
			}
		}

		// FIX #8: Also clean relatedMeasurementLabels to prevent stale references
		if (Array.isArray(graphic.attributes?.relatedMeasurementLabels)) {
			try {
				graphic.attributes.relatedMeasurementLabels.forEach((ml) => {
					if (ml && isMeasurementOnlyGraphic(ml)) {
						try { if (safeLayerContains(ml)) safeLayerRemove(ml); } catch (ee) {
							console.warn('Failed to remove a measurement label from relatedMeasurementLabels:', ee);
						}
					}
				});
			} finally {
				graphic.attributes.relatedMeasurementLabels = [];
			}
		}

		// 🔧 IDEMPOTENT CLEAN: the tracked arrays above can go stale — e.g. two
		// rebuilds racing on 'complete' (both call _addMeasurement with forceUpdate,
		// which bypasses the processing-queue guard) can leave an orphaned set of
		// segment labels on the layer that no array references anymore. Those orphans
		// never get updated, so after a resize you see the old value rendered on top
		// of the new one (most visible on rotated side labels). Sweep the layer for
		// ANY label that names this graphic as its parent and remove it, so every
		// rebuild ends with exactly one set.
		try {
			const uid = graphic.attributes?.uniqueId;
			if (uid && isLayerBasicallyValid()) {
				const orphans = drawLayer.graphics.toArray().filter((g: any) =>
					g?.attributes?.isMeasurementLabel &&
					g.attributes?.parentGraphicId === uid
				);
				orphans.forEach((g: any) => {
					try { if (safeLayerContains(g)) safeLayerRemove(g); } catch { /* no-op */ }
				});
			}
		} catch (sweepErr) {
			console.warn('Orphan measurement-label sweep failed:', sweepErr);
		}
	};



	//removes existing measurements when graphic updates
	const removeMeasurementsOnUpdate = () => {
		if (!sketchViewModel || !sketchViewModel.view) {
			console.warn('SketchViewModel not available for removeMeasurementsOnUpdate');
			return;
		}

		const removalListener = sketchViewModel.on('update', (event) => {
			// Validate SketchViewModel at event start
			if (!sketchViewModel || !sketchViewModel.view) {
				console.warn('SketchViewModel not available during removal update');
				return;
			}

			if (!event?.graphics?.length) return;

			const graphic = event.graphics[0];

			// Skip if measurement is still enabled or graphic is invalid
			if (!graphic || measureEnabledRef.current) return;

			// Use more permissive validation
			if (!isLayerBasicallyValid()) {
				console.warn('DrawLayer is not available for removal operations');
				return;
			}

			// Remove main measurement label with safe methods
			if (graphic.measure?.graphic) {
				try {
					if (safeLayerContains(graphic.measure.graphic)) {
						safeLayerRemove(graphic.measure.graphic);
					}
				} catch (err) {
					console.warn('Failed to remove measurement graphic:', err);
				}
			}

			// Remove related segment labels with enhanced safety
			if (Array.isArray(graphic.attributes?.relatedSegmentLabels)) {
				try {
					const segmentLabels = graphic.attributes.relatedSegmentLabels;
					segmentLabels.forEach(label => {
						if (label && safeLayerContains(label)) {
							safeLayerRemove(label);
						}
					});
					graphic.attributes.relatedSegmentLabels = [];
				} catch (err) {
					console.warn('Failed to remove segment labels:', err);
				}
			}
		});

		setRemovalListener(removalListener);
	};

	const preserveCustomLabelProperties = (existingLabel: any, newSymbol: any): any => {
		if (!existingLabel || !existingLabel.attributes || !existingLabel.attributes.customized) {
			return newSymbol;
		}

		// If the label was customized, preserve the custom properties
		const preservedSymbol = newSymbol.clone();
		const existingSymbol = existingLabel.symbol;

		if (isTextSymbol(existingSymbol) && isTextSymbol(preservedSymbol)) {
			// Preserve custom font properties
			preservedSymbol.color = existingSymbol.color;
			preservedSymbol.font.size = existingSymbol.font.size;
			preservedSymbol.angle = existingSymbol.angle;
			preservedSymbol.verticalAlignment = existingSymbol.verticalAlignment;
			preservedSymbol.xoffset = existingSymbol.xoffset;
			preservedSymbol.yoffset = existingSymbol.yoffset;

			// Preserve halo properties
			if (existingSymbol.haloSize) {
				preservedSymbol.haloSize = existingSymbol.haloSize;
				preservedSymbol.haloColor = existingSymbol.haloColor;
			}

			// Preserve background properties
			if (existingSymbol.backgroundColor) {
				preservedSymbol.backgroundColor = existingSymbol.backgroundColor;
			}
		}

		return preservedSymbol;
	};

	React.useEffect(() => {
		if (typeof props.measurementEnabled === 'boolean') {
			measureEnabledRef.current = props.measurementEnabled;
			setMeasureEnabled(props.measurementEnabled);
			if (!props.measurementEnabled && editableMeasurementsRef.current) {
				setEditableMeasurements(false);
			}
		}
	}, [props.measurementEnabled]);

	React.useEffect(() => {
		isInitialMount.current = false;
	}, []);

	// 🔧 NEW: Clean up ALL listeners on component unmount
	React.useEffect(() => {
		return () => {
			//console.log('🧹 Component unmounting - cleaning up all listeners');

			// Remove listeners via refs (synchronous)
			if (updateListenerRef.current) {
				try { updateListenerRef.current.remove(); } catch { }
				updateListenerRef.current = null;
			}
			if (createListenerRef.current) {
				try { createListenerRef.current.remove(); } catch { }
				createListenerRef.current = null;
			}
			// 🔧 MEMORY FIX: tear down the previously-orphaned delete listener.
			if (deleteListenerRef.current) {
				try { deleteListenerRef.current.remove(); } catch { }
				deleteListenerRef.current = null;
			}

			// Also remove via state (defensive)
			if (updateListener) {
				try { updateListener.remove(); } catch { }
			}
			if (createListener) {
				try { createListener.remove(); } catch { }
			}

			// Reset the ref to false
			if (measureEnabledRef) {
				measureEnabledRef.current = false;
			}
		};
	}, []); // Empty deps = runs only on mount/unmount

	React.useImperativeHandle(ref, () => ({
		updateMeasurementsForGraphic: (graphic: ExtendedGraphic) => {
			//console.log('📊 updateMeasurementsForGraphic called for:', graphic?.attributes?.uniqueId);
			if (!sketchViewModel || !sketchViewModel.view) {
				console.warn('📊 Early return: SketchViewModel not available');
				return;
			}
			if (!drawLayer || !isLayerBasicallyValid()) {
				console.warn('📊 Early return: DrawLayer not valid');
				return;
			}
			if (!graphic || isMeasurementLabel(graphic)) {
				console.warn('📊 Early return: No graphic or is measurement label');
				return;
			}

			// 🔧 FIX 11: When measurements are disabled, don't call _addMeasurement
			// _addMeasurement calls cleanExistingMeasurements which removes labels!
			if (!measureEnabledRef.current) {
				// Check if graphic has active measurements
				const graphicHasActiveMeasurements = !!(
					graphic.measure?.graphic ||
					graphic.attributes?.relatedSegmentLabels?.length > 0 ||
					graphic.attributes?.relatedMeasurementLabels?.length > 0
				);

				if (!graphicHasActiveMeasurements) {
					// No active measurements - skip entirely
					//console.log('📊 Measurements disabled and no active measurements - skipping');
					return;
				}

				// Has active measurements - use LIVE update only (doesn't clean)
				// This preserves the measurements without removing and recreating them
				//console.log('📊 Measurements disabled but graphic has measurements - using live update');
				_addMeasurementLive(graphic);
				return;
			}

			// Measurements are enabled - proceed normally
			// For graphics without uniqueId or during active editing, use live measurement update
			// This provides real-time updates during drag without waiting for uniqueId.
			//
			// EXCEPTION: if the graphic has segment labels (either currently on the layer
			// or recorded in relatedSegmentLabels), _addMeasurementLive would only refresh
			// the main length/area label and leave segments stale or disappear after a
			// cancel/select cycle (see "NO SEGMENT HANDLING during live updates" in
			// _addMeasurementLive). Route to the full _addMeasurement so segments get
			// properly rebuilt with their preserved custom symbols and positions.
			const hasSegmentLabels =
				(graphic.attributes?.relatedSegmentLabels?.length ?? 0) > 0;

			const isActiveSketchTarget =
				graphic === sketchViewModel.updateGraphics?.items?.[0];
			const hasNoStableId = !graphic.attributes?.uniqueId;

			// A graphic mid-creation MUST stay on the live path even after live
			// segment labels exist on it: _addMeasurement dead-ends during create
			// (the graphic isn't on drawLayer yet), which would freeze the segment
			// values for the rest of the draw. Detection can't rely on a missing
			// uniqueId anymore (live assigns it on the first frame), so: match the
			// SVM's createGraphic where exposed, treat any custom-tool preview
			// (triangle/curve/preset circle) as live, and fall back to "SVM session
			// active with nothing in updateGraphics and the graphic not yet
			// completed" (svmGraCreate stamps isDrawing at complete).
			const svmAny = sketchViewModel as any;
			const isActiveCreateTarget =
				graphic === svmAny.createGraphic ||
				graphic.attributes?.isPreviewBuffer === true ||
				(svmAny.state === 'active' &&
					((svmAny.updateGraphics?.length ?? 0) === 0) &&
					!graphic.attributes?.isDrawing);

			if (isActiveCreateTarget || hasNoStableId || (isActiveSketchTarget && !hasSegmentLabels)) {
				//console.log('📊 Calling _addMeasurementLive');
				_addMeasurementLive(graphic);
			} else {
				//console.log('📊 Calling _addMeasurement (segments present or stable id)');
				// For completed edits with stable uniqueId, OR for graphics that have
				// segment labels we need to preserve/rebuild, run the full pipeline.
				_addMeasurement(graphic, null, true);
			}
		},

		isMeasurementEnabled: () => !!measureEnabledRef.current,

		// Restore the global segment-labels toggle. On a fresh page load segmentsOn
		// defaults to false, so the post-restore measurement rebuild
		// (_addMeasurement → cleanExistingMeasurements → shouldCreateSegments) strips
		// any restored segment labels because shouldCreateSegments short-circuits on
		// !segmentsOn. Restoring this from saved state keeps the rebuild, the UI
		// switch, and the saved drawings all consistent.
		setSegmentsEnabled: (enabled: boolean) => {
			segmentsOnRef.current = !!enabled;
			setSegmentsOn(!!enabled);
		},

		setMeasurementEnabled: (enabled: boolean) => {
			const on = !!enabled;
			measureEnabledRef.current = on;

			if (!on) {
				// 🔧 CRITICAL: Only remove listeners for NEW graphics
				// Do NOT affect existing graphics with measurements

				// Remove listeners that create measurements for NEW graphics
				if (updateListenerRef.current) {
					try { updateListenerRef.current.remove(); } catch { }
					updateListenerRef.current = null;
				}
				if (createListenerRef.current) {
					try { createListenerRef.current.remove(); } catch { }
					createListenerRef.current = null;
				}
				// 🔧 MEMORY FIX: also clean up the delete listener so the next
				// setupSketchViewModelListeners call doesn't stack a new one
				// on top.
				if (deleteListenerRef.current) {
					try { deleteListenerRef.current.remove(); } catch { }
					deleteListenerRef.current = null;
				}

				// Also clean up state-based listeners (defensive)
				if (updateListener) {
					try { updateListener.remove(); } catch { }
					setUpdateListener(null);
				}
				if (createListener) {
					try { createListener.remove(); } catch { }
					setCreateListener(null);
				}

				// ensure edit mode is off but DO NOT remove existing labels
				if (editableMeasurementsRef.current) setEditableMeasurements(false);
				// 🔒 absolutely stop any in-flight label creation for NEW graphics only
				cancelPendingMeasurementWork();

				// ✅ REVISED Fix 6: Preserve existing measurement labels intelligently
				// Mark all graphics with measurements as having permanent measurements
				if (drawLayer && isLayerBasicallyValid()) {
					try {
						const allGraphics = drawLayer.graphics.toArray();
						let preservedCount = 0;
						allGraphics.forEach((g: any) => {
							// If graphic has a measurement label, mark it as permanent
							if (g.measure?.graphic ||
								g.attributes?.relatedMeasurementLabels?.length > 0 ||
								g.attributes?.relatedSegmentLabels?.length > 0) {
								if (!g.attributes) g.attributes = {};
								g.attributes.hadMeasurements = true;
								g.attributes.measurementsPermanent = true; // ✅ NEW FLAG
								preservedCount++;
							}

							// 🔧 REVISED Fix 6: Keep existing measurement labels visible
							// Don't hide labels that were created with the graphic (permanent)
							if (g.attributes?.isMeasurementLabel) {
								// Keep visible if the label is permanent (was created with the graphic)
								const isPermanent = g.attributes?.measurementsPermanent ||
									g.measureParent?.attributes?.hadMeasurements ||
									g.measureParent?.attributes?.measurementsPermanent;
								if (!isPermanent) {
									g.visible = false; // Only hide non-permanent labels
								}
								// Permanent labels stay visible
							}
						});
						if (preservedCount > 0) {
							//console.log(`✅ Preserved measurements for ${preservedCount} graphic(s) when checkbox unchecked`);
						}
					} catch (e) {
						console.warn('Error preserving measurements:', e);
					}
				}
			} else {
				// ✅ NEW: When enabling, re-establish listeners for NEW graphics
				// Existing graphics with measurements already have them
				//console.log('✅ Measurement system enabled - will add measurements to NEW graphics');
			}

			// Update state last (this will trigger useEffect but listeners already removed)
			setMeasureEnabled(on);
		},

		enableMeasurements: () => {
			if (!sketchViewModel || !sketchViewModel.view) { console.warn('SketchViewModel not ready - cannot enable measurements'); return; }
			if (!drawLayer || !isLayerBasicallyValid()) { console.warn('DrawLayer not available - cannot enable measurements'); return; }
			measureEnabledRef.current = true;
			setMeasureEnabled(true);
		},

		disableMeasurements: (preserveExisting: boolean = false) => {
			measureEnabledRef.current = false;

			// 🔧 Remove listeners using refs first (synchronous)
			if (updateListenerRef.current) {
				try { updateListenerRef.current.remove(); } catch { }
				updateListenerRef.current = null;
			}
			if (createListenerRef.current) {
				try { createListenerRef.current.remove(); } catch { }
				createListenerRef.current = null;
			}
			// 🔧 MEMORY FIX: previously orphaned delete listener — clean it up too.
			if (deleteListenerRef.current) {
				try { deleteListenerRef.current.remove(); } catch { }
				deleteListenerRef.current = null;
			}

			setMeasureEnabled(false);
			if (editableMeasurementsRef.current) setEditableMeasurements(false);

			// 🔧 NEW: Only remove labels if not preserving existing
			if (!preserveExisting) {
				try {
					if (drawLayer && drawLayer.graphics) {
						const all = drawLayer.graphics.toArray();

						// First pass: Remove measurement labels and clean up references
						all.forEach(g => {
							const isLabel = g?.attributes?.isMeasurementLabel ||
								g?.attributes?.measurementType ||
								g?.measureParent;
							if (isLabel) {
								try {
									// 🔧 NEW: Clear references from parent graphic before removing
									if (g.measureParent) {
										const parent = g.measureParent as any;

										// Clear main measure reference
										if (parent.measure?.graphic === g) {
											parent.measure = null;
										}

										// Remove from relatedSegmentLabels array
										if (parent.attributes?.relatedSegmentLabels) {
											parent.attributes.relatedSegmentLabels =
												parent.attributes.relatedSegmentLabels.filter(l => l !== g);
										}

										// Remove from relatedMeasurementLabels array
										if (parent.attributes?.relatedMeasurementLabels) {
											parent.attributes.relatedMeasurementLabels =
												parent.attributes.relatedMeasurementLabels.filter(l => l !== g);
										}
									}

									drawLayer.remove(g);
								} catch (removeErr) {
									console.warn('Error removing measurement label:', removeErr);
								}
							}
						});

						// Second pass: Clear measurement properties from remaining graphics
						all.forEach(g => {
							if (g && !g.attributes?.isMeasurementLabel) {
								if (g.measure) g.measure = null;
								if (g?.attributes?.relatedSegmentLabels) g.attributes.relatedSegmentLabels = [];
								if (g?.attributes?.relatedMeasurementLabels) g.attributes.relatedMeasurementLabels = [];
							}
						});

						if (typeof (drawLayer as any).refresh === 'function') { try { (drawLayer as any).refresh(); } catch { } }
					}
				} catch (err) { console.warn('Error removing measurement labels on disable:', err); }
			} else {
				//console.log('🔒 Preserving existing measurement labels');
			}
		},

		disableMeasurementEditing: () => {
			if (editableMeasurementsRef.current) setEditableMeasurements(false);
		},

		refreshAllMeasurements: () => {
			if (!sketchViewModel || !sketchViewModel.view) { console.warn('SketchViewModel not available for refreshAllMeasurements'); return; }
			if (!drawLayer || !isLayerBasicallyValid()) { console.warn('DrawLayer not available for refreshAllMeasurements'); return; }
			if (isProcessingMeasurements) { console.warn('Cannot refresh measurements - currently processing'); return; }
			const enabled = !!measureEnabledRef.current;
			// A graphic that already has measurements must keep them up to date after a
			// resize even when the global toggle is OFF — otherwise its length/area text
			// and segment values stay frozen at the original geometry. But never CREATE
			// measurements for an unmeasured drawing while the toggle is off.
			const hasExisting = (g: any) => !!(
				g?.measure?.graphic ||
				g?.attributes?.hadMeasurements ||
				g?.attributes?.measurementsPermanent ||
				(g?.attributes?.relatedMeasurementLabels?.length > 0) ||
				(g?.attributes?.relatedSegmentLabels?.length > 0)
			);
			const allGraphics = drawLayer.graphics.toArray();
			// FIX #5: Include ALL actual drawings, not just those without .measure
			// This ensures existing measurements get updated (e.g. after unit change)
			const drawingGraphics = allGraphics.filter(g => isActualDrawing(g) && (enabled || hasExisting(g)));
			drawingGraphics.forEach((graphic, index) => {
				setTimeout(() => {
					if ((enabled || hasExisting(graphic)) && !processingQueue.current.has(getGraphicId(graphic))) {
						_addMeasurement(graphic as ExtendedGraphic, null, true);
					}
				}, index * 50);
			});
		},

		isBusy: () => isProcessingMeasurements || processingQueue.current.size > 0,
		isEditingMeasurements: () => editableMeasurementsRef.current,

		handleMeasurementLabelSelection: (labelGraphic: any) => {
			if (!editableMeasurementsRef.current) { console.warn('Measurement editing not enabled'); return; }
			handleMeasurementLabelSelection(labelGraphic);
		},

		cleanupMeasurementLabelSelection: () => { cleanupMeasurementLabelSelection(); },
		autoSelectCurrentGraphicMeasurementLabel: () => { autoSelectCurrentGraphicMeasurementLabel(); },

		selectGraphicMeasurementLabel: (graphic: ExtendedGraphic) => {
			if (!editableMeasurementsRef.current) { console.warn('Measurement editing not enabled'); return; }
			if (graphic?.measure?.graphic) { handleMeasurementLabelSelection(graphic.measure.graphic); }
			else { console.warn('No measurement label found for provided graphic'); }
		},

		startLabelDrag: (labelGraphic: ExtendedGraphic, screenPoint?: any) => startLabelDrag(labelGraphic, screenPoint),
		stopLabelDrag: () => handleLabelDragEnd(null),
		resetLabelPosition: () => resetLabelPosition(),
		isDragging: () => isDraggingLabel
	}), [sketchViewModel, drawLayer, measureEnabledRef, editableMeasurementsRef, measureEnabled, updateListener, createListener]);


	// 1. Update refs when state changes (keep as-is but optimized)
	React.useEffect(() => {
		measureEnabledRef.current = measureEnabled;
		editableMeasurementsRef.current = editableMeasurements;
		settingsRef.current = {
			distanceUnit,
			areaUnit,
			segmentsOn,
			lengthOn,
			areaOn,
			perimeterOn,
			radiusOn,
			pointRound,
			otherRound,
			rotateSegments
		};
	}, [measureEnabled, editableMeasurements, distanceUnit, areaUnit, segmentsOn, lengthOn, areaOn, perimeterOn, radiusOn, pointRound, otherRound, rotateSegments]);

	// 2. SIMPLIFIED: Measurement editing setup with minimal delays
	// Alternative measurement editing setup with proper TypeScript handling
	// 2. COMPLETELY ISOLATED: Measurement editing setup that avoids SketchViewModel conflicts
	React.useEffect(() => {
		if (editableMeasurements) {
			if (sketchViewModel?.view) {
				//console.log('Setting up isolated measurement editing');
				currentMapView = sketchViewModel.view;

				// Clean up existing listener first
				if (measurementClickListener) {
					measurementClickListener.remove();
					setMeasurementClickListener(null);
				}

				// Use a much longer delay to completely avoid SketchViewModel conflicts
				setTimeout(() => {
					if (!editableMeasurements) return; // Check if still enabled

					try {
						// Use 'pointer-down' instead of 'click' to avoid SketchViewModel interference
						const isolatedClickHandler = currentMapView.on('pointer-down', async (event) => {
							try {
								// Only process if no drawing tool is active
								if (currentTool && currentTool !== '' && currentTool !== 'text') {
									return;
								}

								// Prevent event from reaching SketchViewModel
								event.stopPropagation();

								// Simple hit test without any layer constraints
								const hitTest = await currentMapView.hitTest({
									x: event.x,
									y: event.y
								});

								// Look for measurement labels
								const measurementLabels = hitTest.results.filter(result => {
									if (!result || !('graphic' in result)) return false;
									const graphic = (result as any).graphic;

									if (graphic?.symbol?.type !== 'text') return false;

									const text = (graphic.symbol as any).text || '';
									return /(\d+(\.\d+)?\s*(km|mi|m|ft|yd|km²|mi²|ac|ha|m²|ft²|yd²))|Area:|Perimeter:|Radius:|Total:|Lat:|Lon:|X:|Y:/.test(text) ||
										graphic.attributes?.isMeasurementLabel;
								});

								if (measurementLabels.length > 0) {
									//console.log('Found measurement label via isolated handler');
									const graphicHit = measurementLabels[0] as any;
									handleMeasurementLabelSelection(graphicHit.graphic as ExtendedGraphic);
								} else {
									// Clear selection when clicking elsewhere
									cleanupMeasurementLabelSelection();
								}
							} catch (error) {
								console.warn('Isolated measurement handler error:', error);
							}
						});

						setMeasurementClickListener(isolatedClickHandler);
						//console.log('Isolated measurement handler set up successfully');
					} catch (setupError) {
						console.error('Error setting up isolated measurement handler:', setupError);
					}
				}, 1500); // Very long delay to avoid all SketchViewModel operations
			}
		} else {
			//console.log('Cleaning up measurement editing');

			if (measurementClickListener) {
				measurementClickListener.remove();
				setMeasurementClickListener(null);
			}

			cleanupMeasurementLabelSelection();
		}
	}, [editableMeasurements, sketchViewModel]);

	// 3. CONSOLIDATED: Handle drawing tool activation (remove duplicate)
	React.useEffect(() => {
		// Disable measurement editing when drawing tools become active
		if (editableMeasurements && currentTool && currentTool !== '' && currentTool !== 'text') {
			//console.log('Drawing tool activated via prop - disabling measurement editing:', currentTool);
			setEditableMeasurements(false);
			cleanupMeasurementLabelSelection();
			removeMeasurementLabelClickListener();
		}

		// Handle tool type changes for measurement settings
		if (currentTool === 'text') {
			setMeasureEnabled(false);
		}
		if (currentTool === 'extent') {
			setToolType('polygon');
		} else {
			setToolType(currentTool);
		}
	}, [currentTool, editableMeasurements]);

	// 4. Initialize map view when available
	React.useEffect(() => {
		const initializeMapView = async () => {
			let newMapView = null;

			if (props.jimuMapView?.view) {
				newMapView = props.jimuMapView.view;
				//console.log('Map view set from jimuMapView prop');
			} else if (sketchViewModel?.view) {
				newMapView = sketchViewModel.view;
				//console.log('Map view set from sketchViewModel');
			}

			if (newMapView && newMapView !== currentMapView) {
				try {
					// Wait for the view to be ready before proceeding
					await newMapView.when();

					currentMapView = newMapView;
					//console.log('currentMapView updated and ready');

					// Only re-setup measurement editing if it was previously enabled
					if (editableMeasurements && currentMapView && sketchViewModel?.view) {
						//console.log('Re-setting up measurement editing after mapView sync');
						removeMeasurementLabelClickListener();

						// Add delay to prevent conflicts
						setTimeout(() => {
							if (editableMeasurements) {
								setupEnhancedMeasurementLabelClickListener();
							}
						}, 300);
					}
				} catch (error) {
					console.error('Error initializing map view:', error);
				}
			}
		};

		initializeMapView();
	}, [props.jimuMapView, sketchViewModel, editableMeasurements]);

	// 5. Alternative map view initialization
	React.useEffect(() => {
		if (props.jimuMapView?.view) {
			currentMapView = props.jimuMapView.view;
			//console.log('Map view initialized from jimuMapView prop');
		}
	}, [props.jimuMapView]);

	// 6. ENHANCED: SketchViewModel readiness and measurement system coordination
	React.useEffect(() => {
		// Early return if SketchViewModel isn't ready - don't warn, just defer
		if (!sketchViewModel || !sketchViewModel.view) {
			// If we have a sketchViewModel but no view, it might be loading
			if (sketchViewModel && !sketchViewModel.view) {
				//console.log('SketchViewModel exists but view not ready, deferring configuration...');
				// Set up a one-time listener to configure when view becomes available
				const viewReadyTimeout = setTimeout(() => {
					if (sketchViewModel?.view) {
						//console.log('SketchViewModel view became ready, configuring now...');
						configureSketchViewModel();
					}
				}, 500); // Check again in 500ms

				return () => clearTimeout(viewReadyTimeout);
			}
			return; // Silently defer if completely unavailable
		}

		//console.log('SketchViewModel ready for configuration');
		configureSketchViewModel();

		// Extracted configuration function for reuse
		function configureSketchViewModel() {
			if (!sketchViewModel?.view) return;

			try {
				// Configure tooltips
				if (tooltips) {
					sketchViewModel.tooltipOptions.enabled = true;
				} else {
					sketchViewModel.tooltipOptions.enabled = false;
				}

				// Configure value options
				const foundUnit = defaultDistanceUnits.find(defaultUnit => defaultUnit.unit === distanceUnit.unit);
				const foundAreaUnit = defaultAreaUnits.find(defaultUnit => defaultUnit.unit === areaUnit.unit);

				sketchViewModel.valueOptions = {
					displayUnits: {
						length: foundUnit?.unit || 'meters',
						area: foundAreaUnit?.unit || 'square-meters'
					},
					inputUnits: {
						length: foundUnit?.unit || 'meters',
						area: foundAreaUnit?.unit || 'square-meters'
					}
				};

				//console.log('SketchViewModel configuration applied successfully');
			} catch (error) {
				console.warn('Error configuring SketchViewModel:', error);
			}
		}
	}, [sketchViewModel, sketchViewModel?.view, tooltips, distanceUnit.unit, areaUnit.unit]);

	// 7. ENHANCED: Measurement system lifecycle management
	React.useEffect(() => {
		// console.log('📊 Measurement lifecycle useEffect triggered:', {
		//   measureEnabled,
		//   measureEnabledRef: measureEnabledRef?.current,
		//   hasSketchViewModel: !!sketchViewModel,
		//   hasView: !!sketchViewModel?.view,
		//   updateListenerExists: !!updateListenerRef.current,
		//   createListenerExists: !!createListenerRef.current
		// });


		// Keep the ref in perfect sync immediately to avoid stale closures
		if (measureEnabledRef) {
			measureEnabledRef.current = measureEnabled;
			//console.log('🔄 Updated measureEnabledRef to:', measureEnabled);
		}

		if (measureEnabled) {
			//console.log('✅ Enabling measurements and setting up listeners');
			// Ensure operators are ready and wire live measurement listeners
			geodeticAreaOperator.load();
			geodeticLengthOperator.load();
			liveMeasure();

			// Clear any existing removal listener
			if (removalListener) {
				try { removalListener.remove(); } catch { }
				setRemovalListener(null);
			}
			//console.log('✅ Measurement listeners set up complete');
		} else {
			//console.log('❌ Disabling measurements - but keeping UPDATE listener for existing measurements');

			// 🔧 CRITICAL FIX: Keep UPDATE listener active for graphics with existing measurements!
			// Only set up listeners if they don't exist yet
			if (!updateListenerRef.current && !createListenerRef.current && sketchViewModel?.view) {
				//console.log('🔧 Setting up listeners even though measurements are disabled (for existing measurements)');
				geodeticAreaOperator.load();
				geodeticLengthOperator.load();
				liveMeasure();
			}

			// Only remove CREATE listener (we want to keep UPDATE listener)
			if (createListenerRef.current) {
				//console.log('🗑️ Removing createListener via ref');
				try { createListenerRef.current.remove(); } catch { }
				createListenerRef.current = null;
			}
			if (createListener) {
				//console.log('🗑️ Removing createListener via state');
				try { createListener.remove(); } catch { }
				setCreateListener(null);
			}

			// ⚠️ DO NOT REMOVE UPDATE LISTENER - it's needed for existing measurements!
			// The UPDATE listener itself checks measureEnabledRef to decide what to do

			// 🔧 BUG A FIX: Do NOT attach the legacy removal listener.
			// removeMeasurementsOnUpdate() registers a SECOND SketchViewModel 'update'
			// handler that deletes the main label AND every segment label (clearing
			// relatedSegmentLabels) whenever measurements are disabled and a graphic
			// with existing measurements is touched — including a plain select, which
			// fires update/'start'. That directly contradicts the UPDATE listener kept
			// active just above, whose intent (see comments at "Keep UPDATE listener
			// active for graphics with existing measurements") is to PRESERVE existing
			// measurements and move them live. The two handlers raced and the removal
			// one won, so restored/persistent segment labels vanished the instant the
			// drawing was clicked on the map or in the My Drawings list. The UPDATE
			// listener fully covers the disabled-with-existing case, so the removal
			// listener is redundant. Tear down any previously-attached instance.
			if (removalListener) {
				try { removalListener.remove(); } catch { }
				setRemovalListener(null);
			}
			if (removalListenerRef.current) {
				try { (removalListenerRef.current as any).remove(); } catch { }
				removalListenerRef.current = null;
			}

			//console.log('✅ Measurement state updated - UPDATE listener kept active');
		}
	}, [measureEnabled, sketchViewModel]);

	// 8. ENHANCED: Settings change handler (rebuild listeners when settings change)
	React.useEffect(() => {
		// Only rebuild if listeners exist (measurement is enabled)
		if (updateListener && createListener && measureEnabled) {
			//console.log('Measurement settings changed - rebuilding listeners');
			updateListener.remove();
			createListener.remove();
			liveMeasure();
		}
	}, [distanceUnit.unit, areaUnit.unit, wkid, latLong, xy, lengthOn, segmentsOn, areaOn, perimeterOn, radiusOn, pointRound, otherRound, rotateSegments, measureEnabled]);

	// 9. Handle text preview mode
	React.useEffect(() => {
		if (showTextPreview) {
			setMeasureEnabled(false);
		}
	}, [showTextPreview]);

	// 10. ENHANCED: Handle graphic selection and type detection
	React.useEffect(() => {
		// Primary: Use currentTool to set toolType when actively drawing
		if (currentTool && currentTool !== '') {
			let mappedType = currentTool;

			// Map drawing tool names to geometry types for measurement settings
			if (currentTool === 'extent') {
				mappedType = 'polygon';
			} else if (currentTool === 'freepolyline') {
				mappedType = 'polyline';
			} else if (currentTool === 'arc' || currentTool === 'endpointArc' || currentTool === 'bezier') {
				mappedType = 'polyline';
			} else if (currentTool === 'triangle') {
				mappedType = 'polygon';
			} else if (currentTool === 'freepolygon') {
				mappedType = 'polygon';
			}

			// Only update if different to avoid unnecessary re-renders
			if (toolType !== mappedType) {
				setToolType(mappedType);
				//console.log('Tool type updated from currentTool:', currentTool, '→', mappedType);
			}
			return; // CRITICAL: Exit early to prevent currentGraphic from overriding
		}

		// Secondary: Handle SketchViewModel updateGraphics (when editing existing graphics)
		// Only use this when NO tool is active
		if (sketchViewModel?.updateGraphics && sketchViewModel.updateGraphics.length > 0) {
			const graphic = sketchViewModel.updateGraphics.items[0];
			if (graphic?.visible && graphic?.geometry) {
				const graphicType = graphic.geometry.type;
				let output = graphicType;

				if (graphicType === 'polygon') {
					if (graphic.geometry.rings && graphic.geometry.rings[0] && graphic.geometry.rings[0].length === 61) {
						output = 'circle';
						setSegmentsOn(false);
					} else {
						output = 'polygon';
					}
				}

				if (toolType !== output) {
					setToolType(output);
					//console.log('Tool type updated from updateGraphics:', output);
				}
			}
		}
		// Tertiary: Handle currentGraphic changes (fallback)
		// Only when no tool is active and no updateGraphics
		else if (currentGraphic?.visible && currentGraphic?.geometry) {
			const graphicType = currentGraphic.geometry.type;
			let output = graphicType;

			if (graphicType === 'polygon') {
				if (currentGraphic.geometry.rings && currentGraphic.geometry.rings[0] && currentGraphic.geometry.rings[0].length === 61) {
					output = 'circle';
					setSegmentsOn(false);
				} else {
					output = 'polygon';
				}
			}

			if (toolType !== output) {
				setToolType(output);
				//console.log('Tool type updated from currentGraphic:', output);
			}
		}
	}, [currentTool, sketchViewModel?.updateGraphics?.length, currentGraphic, toolType]);

	// 11. Handle restored measurement labels
	React.useEffect(() => {
		if (drawLayer && drawLayer.graphics.length > 0) {
			// Give the layer a moment to settle after graphics are loaded
			const timeoutId = setTimeout(() => {
				identifyAndMarkRestoredMeasurementLabels();
			}, 500);

			return () => clearTimeout(timeoutId);
		}
	}, [drawLayer?.graphics?.length]);

	// 12. ENHANCED: Cleanup and coordination when measurements disabled
	React.useEffect(() => {
		if (!measureEnabled && editableMeasurements) {
			//console.log('Measurements disabled - cleaning up editing mode');
			toggleMeasurementEditing(false); // Pass false to disable
		}
	}, [measureEnabled, editableMeasurements]);

	// 13. ENHANCED: Component cleanup on unmount
	React.useEffect(() => {
		return () => {
			//console.log('Cleaning up measurement component');

			// Clean up all pending timeouts
			completeTimeouts.forEach(timeoutId => {
				clearTimeout(timeoutId);
			});

			// Clean up layer watcher
			if (layerWatcher) {
				layerWatcher.remove();
			}

			// Reset processing states
			processingQueue.current.clear();
			measurementLock.current = false;

			// Clean up measurement editing
			cleanupMeasurementLabelSelection();
			removeMeasurementLabelClickListener();

			// Clean up measurement listeners
			if (updateListener) {
				try { updateListener.remove(); } catch { }
			}
			if (createListener) {
				try { createListener.remove(); } catch { }
			}
			if (removalListener) {
				try { removalListener.remove(); } catch { }
			}
		};
	}, []);

	// 14. Manages measurement editing mode lifecycle: sets up click handlers when enabled, cleans up listeners and orphaned visual overlays when disabled
	React.useEffect(() => {
		if (editableMeasurements) {
			// ... existing setup code ...
		} else {
			//console.log('Cleaning up measurement editing');

			if (measurementClickListener) {
				measurementClickListener.remove();
				setMeasurementClickListener(null);
			}

			cleanupMeasurementLabelSelection();

			// Clean up any orphaned overlays when disabling
			cleanupAllMeasurementOverlays();
		}
	}, [editableMeasurements, sketchViewModel]);

	// Optimized live measurement function - only updates main label, no segments
	const _addMeasurementLive = async (graphic: ExtendedGraphic) => {
		// Add SketchViewModel validation
		if (!sketchViewModel || !sketchViewModel.view) {
			console.warn('SketchViewModel not available for live measurements');
			return false;
		}

		// Safeguard - prevent processing measurement labels
		if (isMeasurementLabel(graphic)) {
			return false;
		}

		// Early validation checks
		if (!graphic || !graphic.geometry) {
			return false;
		}

		if (graphic.symbol?.type === 'text') {
			return true;
		}

		// Use more permissive validation for normal measurement operations
		if (!isLayerBasicallyValid()) {
			return false;
		}

		const geometry = graphic.geometry;
		const labelPoint = _getLabelPoint(geometry);
		if (!labelPoint) {
			return false;
		}

		const isPoint = geometry.type === 'point';

		// 🔧 STABLE IDENTITY: give the graphic its permanent uniqueId on the FIRST
		// live frame instead of waiting for 'complete' (svmGraCreate keeps a
		// pre-existing uniqueId, so this IS the id the graphic completes with).
		// Live labels then carry a resolvable parentGraphicId from frame one, so
		// every cleanup pass that keys on parent identity — the idempotent sweep
		// in cleanExistingMeasurements, the panel's orphan passes, save/restore —
		// stays consistent across the create→complete boundary. It also stops
		// getGraphicId minting a new throwaway id on every call for in-progress
		// graphics, which made the per-graphic throttle/queue maps useless mid-create.
		if (!isPoint) {
			if (!graphic.attributes) graphic.attributes = {};
			if (!graphic.attributes.uniqueId) {
				graphic.attributes.uniqueId = `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			}
		}

		let text: string;

		try {
			//for point graphics
			if (isPoint) {
				let xyCoords = ''
				let srWkid = ''
				if (xy) {
					xyCoords = `${props.nls('measurementX', { value: labelPoint.x.toFixed(pointRound) })}\n${props.nls('measurementY', { value: labelPoint.y.toFixed(pointRound) })}`
					if (wkid) {
						srWkid = `\n${props.nls('measurementWkid', { value: labelPoint.spatialReference?.latestWkid || labelPoint.spatialReference?.wkid || props.nls('measurementUnknown') })}`;
					}
				}
				let wgsCoords = '';

				try {
					if (!projectOperator.isLoaded()) {
						await projectOperator.load();
					}

					const [projected] = projectOperator.executeMany([labelPoint], SpatialReferenceCompat.WGS84) as any[];

					if (projected && latLong) {
						wgsCoords = `\n${props.nls('measurementLatitude', { value: projected.y.toFixed(pointRound) })}\n${props.nls('measurementLongitude', { value: projected.x.toFixed(pointRound) })}`;
						if (wkid) {
							wgsCoords = `${wgsCoords}\n${props.nls('measurementWkid', { value: 4326 })}`
						}
					}
				} catch (err) {
					console.warn('Projection to WGS84 failed:', err);
				}

				text = `${xyCoords}${srWkid}${wgsCoords}`;

			} else {
				//calculates measurements and returns text
				text = _getMeasureText(geometry, null, null, null, graphic);
			}

			if (!text || text.trim() === '') {
				return false;
			}
		} catch (error) {
			console.error('Error generating measurement text:', error);
			return false;
		}

		const existingMeasureGraphic = graphic.measure && graphic.measure.graphic ? graphic.measure.graphic : false;

		// 🔧 FIX: Check if the measurement graphic is actually in the layer
		// If cancel() was called, the graphic might still be referenced but not in the layer
		const measureGraphicInLayer = existingMeasureGraphic && drawLayer && safeLayerContains(existingMeasureGraphic);

		// Only update existing measurement or create new one - NO SEGMENT HANDLING during live updates
		if (measureGraphicInLayer) {
			try {
				// Simple update of existing label
				if (isTextSymbol(existingMeasureGraphic.symbol)) {
					existingMeasureGraphic.symbol.text = text;
				}
				existingMeasureGraphic.attributes.name = text;

				// Use custom position if available, otherwise use calculated position
				const finalLabelPoint = respectCustomPosition(existingMeasureGraphic, labelPoint);
				existingMeasureGraphic.geometry = finalLabelPoint;

				// 🔧 CRITICAL FIX: Ensure hadMeasurements is set
				if (!graphic.attributes) graphic.attributes = {};
				graphic.attributes.hadMeasurements = true;
				//console.log('✅ Set hadMeasurements flag (update) for graphic:', graphic.attributes?.uniqueId);
			} catch (error) {
				console.error('Error updating existing measurement:', error);
				return false;
			}

		} else {
			// No existing label in layer - need to create new one

			// 🔧 NEW: Check if we should create a label
			// Create if: measurements are enabled OR graphic had measurements before
			const shouldCreateLabel = measureEnabledRef.current ||
				graphic.attributes?.hadMeasurements ||
				graphic.measure;

			if (!shouldCreateLabel) {
				//console.log('⏭️ Skipping label creation - measurements not enabled and graphic has no measurement history');
				return false;
			}

			try {
				//console.log('🏷️ Creating new measurement label for graphic:', graphic.attributes?.uniqueId);

				//copy textSymbol and insert measurement text
				const textSymbol = currentTextSymbol.clone()
				textSymbol.text = text

				//if it's a point offset the text location
				if (isPoint) {
					let lines = 0
					if (xy) {
						lines = -1.5
						if (wkid) {
							lines -= .75
						}
					}
					if (latLong) {
						lines -= 1.5
						if (wkid) {
							lines -= .75
						}
					}
					const fontOffset = textSymbol.font.size * lines
					textSymbol.yoffset = fontOffset
				}

				//add halo if no halo
				if (!textSymbol.haloSize) {
					textSymbol.haloSize = 2
					textSymbol.haloColor = 'white'
				}

				//make any background color transparent
				if (textSymbol.backgroundColor?.a > 0) {
					textSymbol.backgroundColor.a = 0
				}

				// Create label graphic
				const labelGraphic = new Graphic({
					geometry: labelPoint,
					symbol: textSymbol,
					visible: measureEnabledRef.current || graphic.attributes?.hadMeasurements || !!graphic.measure, // 🆕 FIX: Show if enabled OR graphic has measurements
					attributes: {
						name: text,
						description: isPoint ? props.nls('measurementCoordinateLabel') : props.nls('measurementMainLabel'),
						isMeasurementLabel: true,
						hideFromList: true,
						drawMode: 'text',
						lengthUnit: distanceUnit.unit,
						areaUnit: areaUnit.unit,
						parentGraphicId: graphic.attributes?.uniqueId,
						measurementType: isPoint ? 'coordinate' : 'main',
						isSegmentLabel: false,
						alwaysVisible: true
					},
				}) as ExtendedGraphic;

				// Add to layer
				if (drawLayer && typeof drawLayer.add === 'function') {
					// Visibility already set during graphic creation based on measurements
					// labelGraphic.visible already set correctly above

					// 🔧 NEW: Check if label already exists in layer (prevent duplicates)
					const existingInLayer = drawLayer.graphics.toArray().find(g =>
						g.attributes?.isMeasurementLabel &&
						g.attributes?.parentGraphicId === graphic.attributes?.uniqueId &&
						g.attributes?.measurementType === (isPoint ? 'coordinate' : 'main')
					);

					if (existingInLayer) {
						//console.log('⚠️ Label already exists in layer, updating instead');
						// Update existing label
						if (isTextSymbol(existingInLayer.symbol)) {
							existingInLayer.symbol.text = text;
						}
						existingInLayer.attributes.name = text;
						existingInLayer.geometry = labelPoint;

						// Use existing label
						(existingInLayer as any).measureParent = graphic;
						graphic.measure = {
							graphic: existingInLayer,
							lengthUnit: distanceUnit.unit,
							areaUnit: areaUnit.unit,
						};
					} else {
						// Add new label
						drawLayer.add(labelGraphic);
						//console.log('✅ Added new measurement label to layer');

						//associate label graphic with drawing
						labelGraphic.measureParent = graphic;
						graphic.measure = {
							graphic: labelGraphic,
							lengthUnit: distanceUnit.unit,
							areaUnit: areaUnit.unit,
						};

						// Track in parent's measurement labels array
						if (!graphic.attributes) graphic.attributes = {};
						if (!graphic.attributes.relatedMeasurementLabels) {
							graphic.attributes.relatedMeasurementLabels = [];
						}
						if (!graphic.attributes.relatedMeasurementLabels.includes(labelGraphic)) {
							graphic.attributes.relatedMeasurementLabels.push(labelGraphic);
						}

						// 🔧 NEW: Set hadMeasurements flag
						graphic.attributes.hadMeasurements = true;
					}
				}
			} catch (addErr) {
				console.error('Failed to add measurement label:', addErr);
				return false;
			}
		}

		// 🔧 LIVE SEGMENT UPDATE: keep per-segment length labels in sync with the
		// geometry in real time — the same way the main length/area label above does.
		// Existing labels are mutated IN PLACE (text + position + angle), which
		// doesn't flicker; a NEW segment (vertex placed while drawing, or added
		// mid-edit) gets its label created on the spot; a removed segment (vertex
		// undo) drops its label. The full rebuild on 'complete' remains the
		// reconciler of record for preserved custom symbols/positions. This block
		// deliberately contains no awaits, so the two live callers (widget.tsx
		// svmGraCreate and the create/update listeners below) cannot interleave
		// mid-reconciliation and double-create labels.
		try {
			// Freehand tools accumulate hundreds of vertices per second — creating a
			// label per mousemove would jank the draw. Their segments still appear on
			// 'complete' exactly as before. Circles are excluded too: a mid-drag
			// circle ring isn't 61 points yet, so shouldCreateSegments can't block it,
			// and it would spray a label per arc vertex.
			const isFreehand =
				graphic.attributes?.drawMode === 'freepolyline' ||
				graphic.attributes?.drawMode === 'freepolygon' ||
				graphic.attributes?.drawMode === 'circle' ||
				currentTool === 'freepolyline' || currentTool === 'freepolygon' || currentTool === 'circle' ||
				toolType === 'freepolyline' || toolType === 'freepolygon' || toolType === 'circle';

			if (shouldCreateSegments(geometry) && drawLayer) {
				if (!graphic.attributes) graphic.attributes = {};
				if (!Array.isArray(graphic.attributes.relatedSegmentLabels)) graphic.attributes.relatedSegmentLabels = [];

				// 🔧 SELF-HEALING: compact the tracked array to labels ACTUALLY on the
				// layer before pairing. Delayed cleanup passes from the PREVIOUS
				// graphic's complete (throttled rebuild, panel refresh, save/restore)
				// can remove live labels from the layer while this array still
				// references them — count-based pairing then believes every segment
				// is labeled and the live display stays dead for the rest of the
				// draw. Compacting first means anything externally removed is
				// recreated on the very next frame.
				const compacted = graphic.attributes.relatedSegmentLabels.filter(
					(l: any) => l && safeLayerContains(l)
				);
				if (compacted.length !== graphic.attributes.relatedSegmentLabels.length) {
					graphic.attributes.relatedSegmentLabels = compacted;
				}
				const segLabels = graphic.attributes.relatedSegmentLabels;

				// Build the current segments in the same nested order labels are created.
				// 🔧 POLYGON NORMALIZATION: during create the API does NOT keep the ring
				// consistently closed across 'active' frames (vertex-place frames carry
				// the duplicated closing point, mousemove frames often don't). Reading
				// raw rings makes the segment count oscillate ±1 between frames, so the
				// closing-edge label flickered in/out and index pairing shifted. Strip
				// the duplicate closing point and append the closing segment ourselves
				// once the ring has 3+ distinct vertices — stable count every frame,
				// same pair order the 'complete' rebuild produces from a closed ring.
				const segments: Array<[number[], number[]]> = [];
				const isPolygonGeom = geometry.type === 'polygon';
				for (const path of getCoordinateArrays(geometry)) {
					if (!Array.isArray(path) || path.length < 2) continue;
					let pts = path;
					if (isPolygonGeom) {
						const first = path[0];
						const last = path[path.length - 1];
						const isClosed = Array.isArray(first) && Array.isArray(last) &&
							first[0] === last[0] && first[1] === last[1];
						pts = isClosed ? path.slice(0, -1) : path;
					}
					for (let j = 1; j < pts.length; j++) segments.push([pts[j - 1], pts[j]]);
					if (isPolygonGeom && pts.length >= 3) segments.push([pts[pts.length - 1], pts[0]]);
				}
				const lengthUnitInfo = availableDistanceUnits.find((u) => u.unit === distanceUnit.unit);
				const lengthUnitLabel = lengthUnitInfo ? lengthUnitInfo.abbreviation : distanceUnit.unit;

				// 1) Update existing labels IN PLACE, exactly like the main label does
				// (which renders crisp). We intentionally do NOT clone/reassign the
				// symbol every frame — reassigning a rotated, halo'd symbol each drag
				// frame renders unclean; mutating its fields does not. Duplicate/orphan
				// labels are handled by the idempotent sweep in cleanExistingMeasurements.
				const n = Math.min(segLabels.length, segments.length);
				for (let k = 0; k < n; k++) {
					const segLabel = segLabels[k] as ExtendedGraphic;
					if (!segLabel || !safeLayerContains(segLabel)) continue;
					const [p1, p2] = segments[k];
					const segLen = _calculateSegmentLength(p1, p2, geometry);
					if (!(segLen > 0)) continue;
					const segText = `${_round(segLen, otherRound).toLocaleString()} ${lengthUnitLabel}`;
					if (isTextSymbol(segLabel.symbol)) (segLabel.symbol as any).text = segText;
					if (segLabel.attributes) segLabel.attributes.name = segText;
					if (segLabel.attributes?.segmentInfo) {
						segLabel.attributes.segmentInfo = { point1: p1, point2: p2 };
					}
					// Rotated side labels (created with verticalAlignment 'bottom') track
					// the segment's CURRENT angle; only mutate when the angle changed.
					if (
						rotateSegments && !isFreehand &&
						isTextSymbol(segLabel.symbol) &&
						(segLabel.symbol as any).verticalAlignment === 'bottom' &&
						!segLabel.attributes?.customized &&
						!segLabel.attributes?.hasCustomPosition
					) {
						const segAngle = _calculateAngle(p1[0], p1[1], p2[0], p2[1]);
						if ((segLabel.symbol as any).angle !== segAngle) {
							const perp = (segAngle * Math.PI / 180) + Math.PI / 2;
							(segLabel.symbol as any).angle = segAngle;
							(segLabel.symbol as any).yoffset = Math.sin(perp) * 4;
							(segLabel.symbol as any).xoffset = Math.cos(perp) * 4 * -1.5;
						}
					}
					// Position tracks the midpoint unless the user pinned it. The geometry
					// reassignment also forces the graphic to redraw with the new text.
					if (!segLabel.attributes?.hasCustomPosition) {
						const mid = _getSegmentMidpoint(p1, p2, geometry);
						if (mid) segLabel.geometry = mid;
					}
				}

				// 2) Create labels for segments that don't have one yet (live during
				// initial drawing, and for vertices added mid-edit). Mirrors the
				// creation in _addMeasurement minus the preserved-props lookup —
				// preserved custom symbols/positions are re-applied by the full
				// rebuild on 'complete'.
				if (!isFreehand && segments.length > segLabels.length) {
					for (let k = segLabels.length; k < segments.length; k++) {
						const [p1, p2] = segments[k];
						const segLen = _calculateSegmentLength(p1, p2, geometry);
						let segMid = _getSegmentMidpoint(p1, p2, geometry);
						if (!segMid) {
							// Degenerate (zero-length) segment while the cursor sits on the
							// last vertex: still create the label to keep index alignment;
							// it gets real text/position on the next mousemove frame.
							try {
								segMid = new Point({ x: p1[0], y: p1[1], spatialReference: (geometry as any).spatialReference });
							} catch { break; }
						}
						const segText = segLen > 0
							? `${_round(segLen, otherRound).toLocaleString()} ${lengthUnitLabel}`
							: '';
						const segAngle = _calculateAngle(p1[0], p1[1], p2[0], p2[1]);
						const segSym = currentTextSymbol.clone();
						segSym.text = segText;
						if (rotateSegments) {
							segSym.angle = segAngle;
							segSym.verticalAlignment = 'bottom';
							const perp = (segAngle * Math.PI / 180) + Math.PI / 2;
							segSym.yoffset = Math.sin(perp) * 4;
							segSym.xoffset = Math.cos(perp) * 4 * -1.5;
						}
						if (!segSym.haloSize) {
							segSym.haloSize = 2;
							segSym.haloColor = 'white';
						}
						if (segSym.backgroundColor?.a > 0) segSym.backgroundColor.a = 0;

						const segLabel = new Graphic({
							geometry: segMid,
							symbol: segSym,
							visible: true,
							attributes: {
								name: segText,
								description: props.nls('segmentLabelDescription'),
								isMeasurementLabel: true,
								hideFromList: true,
								drawMode: 'text',
								measurementType: 'segment',
								parentGraphicId: graphic.attributes?.uniqueId,
								lengthUnit: distanceUnit.unit,
								isSegmentLabel: true,
								segmentIndex: k,
								customized: false,
								lastModified: null,
								hasCustomPosition: false,
								customPosition: null,
								segmentInfo: { point1: p1, point2: p2 }
							}
						}) as ExtendedGraphic;

						drawLayer.add(segLabel);
						segLabel.measureParent = graphic;
						segLabel.measure = { graphic: graphic };
						segLabels.push(segLabel);
					}
				}

				// 3) Remove labels for segments that no longer exist (vertex undo
				// while drawing, or vertex deletion mid-edit).
				if (segLabels.length > segments.length) {
					const extras = segLabels.splice(segments.length);
					extras.forEach((ex: any) => {
						try { if (ex && safeLayerContains(ex)) safeLayerRemove(ex); } catch { /* no-op */ }
					});
				}
			}
		} catch (segErr) {
			console.warn('Live segment update failed:', segErr);
		}

		setCurrentGraphic(graphic)
		return true;
	};

	const _addMeasurement = async (
		graphic: ExtendedGraphic,
		parent?: ExtendedGraphic,
		forceUpdate = false,
		angle: number = null
	) => {
		// console.log('🔍 CREATE EVENT:', {
		//   state: event.state,
		//   measureEnabledRef: measureEnabledRef.current,
		//   measureEnabledState: measureEnabled,
		//   hasGraphic: !!event.graphic
		// });

		// Allow rebuilds for graphics that ALREADY have measurements even when the
		// global toggle is off — a resize must recompute their length/area + segment
		// text and reposition segment labels. shouldGenerateMeasurements alone (which
		// only checks the toggle) would bail and leave the original values frozen.
		// New/unmeasured graphics are still gated by the toggle.
		const _hasExistingMeasurements = !!(
			graphic?.measure?.graphic ||
			graphic?.attributes?.hadMeasurements ||
			graphic?.attributes?.measurementsPermanent ||
			(graphic?.attributes?.relatedMeasurementLabels?.length > 0) ||
			(graphic?.attributes?.relatedSegmentLabels?.length > 0)
		);
		if (!shouldGenerateMeasurements(graphic) && !_hasExistingMeasurements) return;
		// --------- Hard guards & readiness ---------
		if (!graphic || !graphic.geometry) {
			console.warn('Invalid graphic or geometry in _addMeasurement');
			return false;
		}
		// CRITICAL FIX: Don't process graphics that are being or have been deleted
		if (!graphic.layer || (graphic.layer && graphic.layer !== drawLayer)) {
			//console.log('⚠️ Graphic has been removed from layer, aborting measurement');
			return false;
		}
		// Skip measurement labels
		if (isMeasurementLabel(graphic) || graphic.symbol?.type === 'text') return true;

		// View / layer must exist
		if (!sketchViewModel || !sketchViewModel.view) {
			console.warn('SketchViewModel not available for measurements');
			return false;
		}
		if (!isLayerBasicallyValid()) {
			console.warn('DrawLayer is not available for measurement processing');
			return false;
		}

		// Wait for stable ID for top-level (non-segment) work
		const hasUid = !!graphic.attributes?.uniqueId;
		if (!parent && !hasUid) {
			// Defer exactly once to let widget assign uniqueId on create-complete
			if (!forceUpdate) {
				setTimeout(() => _addMeasurement(graphic, parent, true, angle), 180);
			}
			return false;
		}

		// --------- Concurrency controls ---------
		if (measurementLock.current && !forceUpdate && !parent) return false;

		const graphicId = getGraphicId(graphic);
		// Serialize rebuilds of the SAME top-level graphic even under forceUpdate.
		// On a single resize-complete, measure's own 'update' listener AND the
		// MyDrawingsPanel handler both call _addMeasurement(graphic, null, true);
		// letting both run concurrently races clean/recreate and leaves a duplicate
		// set of segment labels. Segment sub-processing (parent set) is unaffected.
		if (processingQueue.current.has(graphicId) && (!forceUpdate || !parent)) return false;

		processingQueue.current.add(graphicId);
		if (!parent && !forceUpdate) {
			measurementLock.current = true;
			setIsProcessingMeasurements(true);
		}

		try {
			const view = sketchViewModel.view as any | any;

			// --------- Ensure parent graphic is actually renderable ---------
			try {
				// mark explicitly as a real drawing (helps other codepaths ignore it in cleanup)
				graphic.attributes = graphic.attributes || {};
				graphic.attributes.isDrawing = true;

				// FIXED: More careful layer containment check
				const isOnLayer = drawLayer.graphics && drawLayer.graphics.includes && drawLayer.graphics.includes(graphic);

				// If the parent somehow got detached, re-add it - but be more careful
				if (!isOnLayer) {
					//console.log('Re-adding graphic to layer for measurements');
					try {
						drawLayer.add(graphic);
					} catch (addError) {
						console.warn('Could not re-add graphic to layer:', addError);
						// If we can't add it, at least ensure it's visible where it is
					}
				}

				// Make sure it's visible - but don't force if it was intentionally hidden
				if (graphic.visible === false) {
					//console.log('Making graphic visible for measurements');
					graphic.visible = true;
				}

				// Force a tiny render turn before adding labels - but don't await if it fails
				try {
					await view.whenLayerView(drawLayer as any);
				} catch (layerViewError) {
					console.warn('Layer view not ready, proceeding anyway:', layerViewError);
				}

				await new Promise((r) => requestAnimationFrame(() => r(null)));
			} catch (rehydrateErr) {
				console.warn('Failed to ensure parent graphic is visible/present:', rehydrateErr);
				// Don't return false here - continue with measurement creation even if rehydration failed
			}

			const geometry = graphic.geometry;
			const labelPoint = _getLabelPoint(geometry);
			if (!labelPoint) {
				console.warn('Could not determine label point for graphic');
				return false;
			}

			// Decide update semantics
			const alreadyProcessed = processedGraphics.has(graphicId);
			const isUpdate = !!(forceUpdate || (!parent && alreadyProcessed));

			// --------- Preserve customizations BEFORE cleanup ---------
			let preservedMainLabelProperties: null | {
				symbol: any;
				attributes: {
					customized?: boolean;
					lastModified?: number;
					hasCustomPosition?: boolean;
					customPosition?: any;
				};
			} = null;

			const preservedSegmentLabelProperties: Map<
				string,
				{
					symbol: any;
					attributes: {
						customized?: boolean;
						lastModified?: number;
						hasCustomPosition?: boolean;
						customPosition?: any;
					};
				}
			> = new Map();

			if (!parent && (isUpdate || !alreadyProcessed || forceUpdate)) {
				if (graphic.measure?.graphic?.attributes?.customized && graphic.measure?.graphic?.symbol) {
					preservedMainLabelProperties = {
						symbol: (graphic.measure.graphic.symbol as any).clone(),
						attributes: {
							customized: graphic.measure.graphic.attributes.customized,
							lastModified: graphic.measure.graphic.attributes.lastModified,
							hasCustomPosition: graphic.measure.graphic.attributes.hasCustomPosition,
							customPosition: graphic.measure.graphic.attributes.customPosition
						}
					};
				}

				if (Array.isArray(graphic.attributes?.relatedSegmentLabels)) {
					graphic.attributes.relatedSegmentLabels.forEach((segmentLabel: any) => {
						if (segmentLabel?.attributes?.customized && segmentLabel?.symbol && segmentLabel?.geometry) {
							const key = `${Math.round(segmentLabel.geometry.x)}_${Math.round(segmentLabel.geometry.y)}`;
							preservedSegmentLabelProperties.set(key, {
								symbol: (segmentLabel.symbol as any).clone(),
								attributes: {
									customized: segmentLabel.attributes.customized,
									lastModified: segmentLabel.attributes.lastModified,
									hasCustomPosition: segmentLabel.attributes.hasCustomPosition,
									customPosition: segmentLabel.attributes.customPosition
								}
							});
						}
					});
				}

				// Only clean measurements (labels) — never touch the drawing itself
				cleanExistingMeasurements(graphic);

				// Mark processed even in deferred forceUpdate to prevent double passes
				setProcessedGraphics((prev) => {
					const next = new Set(prev);
					next.add(graphicId);
					return next;
				});
			}

			// --------- Build measurement text ---------
			let text: string;
			const isPoint = geometry.type === 'point';
			const isFreehandPolyline =
				graphic.attributes?.drawMode === 'freepolyline' || currentTool === 'freepolyline' || toolType === 'freepolyline';

			try {
				if (isPoint) {
					let xyCoords = '';
					let srWkid = '';
					if (xy) {
						xyCoords = `${props.nls('measurementX', { value: labelPoint.x.toFixed(pointRound) })}\n${props.nls('measurementY', { value: labelPoint.y.toFixed(pointRound) })}`;
						if (wkid) {
							const wk = labelPoint.spatialReference?.latestWkid || labelPoint.spatialReference?.wkid || props.nls('measurementUnknown');
							srWkid = `\n${props.nls('measurementWkid', { value: wk })}`;
						}
					}
					let wgsCoords = '';
					try {
						if (!projectOperator.isLoaded()) await projectOperator.load();
						const [projected] = projectOperator.executeMany([labelPoint], SpatialReferenceCompat.WGS84) as any[];
						if (projected && latLong) {
							wgsCoords = `\n${props.nls('measurementLatitude', { value: projected.y.toFixed(pointRound) })}\n${props.nls('measurementLongitude', { value: projected.x.toFixed(pointRound) })}`;
							if (wkid) wgsCoords = `${wgsCoords}\n${props.nls('measurementWkid', { value: 4326 })}`;
						}
					} catch (projErr) {
						console.warn('Projection to WGS84 failed:', projErr);
					}
					text = `${xyCoords}${srWkid}${wgsCoords}`;
				} else {
					text = _getMeasureText(geometry, parent, null, null, graphic);
				}

				if (!text || text.trim() === '') {
					// Only return early if we don't need to create segment labels
					if (!shouldCreateSegments(geometry)) {
						console.warn('No measurement text generated for graphic');
						return false;
					}
					// Otherwise, continue to create segment labels even without main label
					text = null;
				}
			} catch (buildErr) {
				console.error('Error generating measurement text:', buildErr);
				return false;
			}

			// --------- Update or create the label ---------
			// Only create/update main label if we have text (skip when only showing segments)
			if (text) {
				const existingMeasureGraphic = graphic.measure?.graphic || null;

				if (existingMeasureGraphic) {
					try {
						if (isTextSymbol(existingMeasureGraphic.symbol)) {
							if (preservedMainLabelProperties) {
								const preserved = preservedMainLabelProperties.symbol.clone();
								preserved.text = text;
								existingMeasureGraphic.symbol = preserved;
								existingMeasureGraphic.attributes.customized = !!preservedMainLabelProperties.attributes.customized;
								existingMeasureGraphic.attributes.lastModified =
									preservedMainLabelProperties.attributes.lastModified || Date.now();
								existingMeasureGraphic.attributes.hasCustomPosition =
									!!preservedMainLabelProperties.attributes.hasCustomPosition;
								existingMeasureGraphic.attributes.customPosition =
									preservedMainLabelProperties.attributes.customPosition || null;
							} else {
								(existingMeasureGraphic.symbol as any).text = text;
							}
						}
						existingMeasureGraphic.attributes.name = text;
						existingMeasureGraphic.geometry = respectCustomPosition(existingMeasureGraphic, labelPoint);
						ensureLabelVisibility(existingMeasureGraphic);
					} catch (e) {
						console.error('Error updating existing measurement:', e);
						return false;
					}
				} else {
					try {
						const textSymbol = currentTextSymbol.clone();
						textSymbol.text = text;

						if (preservedMainLabelProperties) {
							const p = preservedMainLabelProperties.symbol;
							textSymbol.color = p.color;
							textSymbol.font = p.font;
							textSymbol.angle = p.angle;
							textSymbol.haloSize = p.haloSize;
							textSymbol.haloColor = p.haloColor;
							textSymbol.verticalAlignment = p.verticalAlignment;
							textSymbol.xoffset = p.xoffset;
							textSymbol.yoffset = p.yoffset;
							if (p.backgroundColor) textSymbol.backgroundColor = p.backgroundColor;
						} else {
							if (angle !== null && rotateSegments) {
								textSymbol.angle = angle;
								textSymbol.verticalAlignment = 'bottom';
								const distance = 4;
								const angleRad = angle * Math.PI / 180;
								const perpendicular = angleRad + Math.PI / 2;
								textSymbol.yoffset = Math.sin(perpendicular) * distance;
								textSymbol.xoffset = Math.cos(perpendicular) * distance * -1.5;
							} else if (
								geometry.type === 'polyline' &&
								!parent &&
								!isFreehandPolyline &&
								!shouldCreateSegments(geometry) &&
								rotateSegments
							) {
								const isSingleSegment =
									geometry.paths && geometry.paths.length > 0 && geometry.paths[0] && geometry.paths[0].length === 2;
								if (isSingleSegment) {
									const polylineAngle = _calculatePolylineAngle(geometry);
									if (polylineAngle !== null) {
										textSymbol.angle = polylineAngle;
										textSymbol.verticalAlignment = 'bottom';
										const distance = 12;
										const angleRad = polylineAngle * Math.PI / 180;
										const perpendicular = angleRad + Math.PI / 2;
										textSymbol.yoffset = Math.sin(perpendicular) * distance;
										textSymbol.xoffset = Math.cos(perpendicular) * distance * -1.5;
									}
								}
							}

							if (isPoint) {
								let lines = 0;
								if (xy) {
									lines = -1.5;
									if (wkid) lines -= 0.75;
								}
								if (latLong) {
									lines -= 1.5;
									if (wkid) lines -= 0.75;
								}
								textSymbol.yoffset = textSymbol.font.size * lines;
							}
							if (!textSymbol.haloSize) {
								textSymbol.haloSize = 2;
								textSymbol.haloColor = 'white';
							}
							if (textSymbol.backgroundColor?.a > 0) textSymbol.backgroundColor.a = 0;
						}

						// Final label position (preserve if customized)
						let finalLabelPoint = labelPoint;
						if (
							preservedMainLabelProperties?.attributes?.hasCustomPosition &&
							preservedMainLabelProperties?.attributes?.customPosition
						) {
							try {
								const cp = preservedMainLabelProperties.attributes.customPosition;
								finalLabelPoint = new Point({ x: cp.x, y: cp.y, spatialReference: cp.spatialReference });
							} catch (e) {
								console.warn('Error loading preserved custom position, using default:', e);
							}
						}

						const labelGraphic = new Graphic({
							geometry: finalLabelPoint,
							symbol: textSymbol,
							visible: measureEnabledRef.current || graphic.attributes?.hadMeasurements || !!graphic.measure, // 🆕 FIX: Show if enabled OR graphic has measurements
							attributes: {
								name: text,
								description: isPoint ? props.nls('measurementCoordinateLabel') : props.nls('measurementMainLabel'),
								isMeasurementLabel: true,
								hideFromList: true,
								drawMode: 'text',
								lengthUnit: distanceUnit.unit,
								areaUnit: areaUnit.unit,
								parentGraphicId: graphic.attributes?.uniqueId,
								measurementType: isPoint ? 'coordinate' : (parent ? 'segment' : 'main'),
								customized: !!preservedMainLabelProperties?.attributes?.customized,
								lastModified: preservedMainLabelProperties?.attributes?.lastModified || null,
								hasCustomPosition: !!preservedMainLabelProperties?.attributes?.hasCustomPosition,
								customPosition: preservedMainLabelProperties?.attributes?.customPosition || null,
								isSegmentLabel: !!parent
							}
						}) as ExtendedGraphic;

						drawLayer.add(labelGraphic);
						labelGraphic.measureParent = graphic;
						labelGraphic.measure = { graphic: graphic };
						graphic.measure = { graphic: labelGraphic, lengthUnit: distanceUnit.unit, areaUnit: areaUnit.unit };

						// FIX #11: Store measurement units on parent graphic for persistence
						if (!graphic.attributes) graphic.attributes = {};
						graphic.attributes.measurementUnits = {
							lengthUnit: distanceUnit.unit,
							areaUnit: areaUnit.unit
						};

						// 🔧 FIX: Set flag to track that this graphic had measurements
						if (!graphic.attributes) graphic.attributes = {};
						graphic.attributes.hadMeasurements = true;

						// Track in main graphic's measurement labels array (if not a parent segment)
						if (!parent) {
							if (!graphic.attributes) graphic.attributes = {};
							if (!graphic.attributes.relatedMeasurementLabels) {
								graphic.attributes.relatedMeasurementLabels = [];
							}
							if (!graphic.attributes.relatedMeasurementLabels.includes(labelGraphic)) {
								graphic.attributes.relatedMeasurementLabels.push(labelGraphic);
							}
						}

						if (parent) {
							if (parent.attributes.relatedSegmentLabels) parent.attributes.relatedSegmentLabels.push(labelGraphic);
							else parent.attributes.relatedSegmentLabels = [labelGraphic];
							labelGraphic.attributes.parentGraphicId = parent.attributes?.uniqueId;
							labelGraphic.measureParent = parent;
							labelGraphic.measure = { graphic: parent };
						}

						ensureLabelVisibility(labelGraphic);
					} catch (addErr) {
						console.error('Failed to add measurement label:', addErr);
						return false;
					}
				}
			} // End of if (text) block

			// --------- Segment labels (direct creation) ---------
			if (!parent && shouldCreateSegments(geometry)) {
				try {
					const coordinateArrays = getCoordinateArrays(geometry);
					for (let i = 0; i < coordinateArrays.length; i++) {
						const path = coordinateArrays[i];
						for (let j = 1; j < path.length; j++) {
							const segLen = _calculateSegmentLength(path[j - 1], path[j], geometry);
							const segMid = _getSegmentMidpoint(path[j - 1], path[j], geometry);
							if (!segMid || segLen <= 0) continue;

							const lengthUnitInfo = availableDistanceUnits.find((u) => u.unit === distanceUnit.unit);
							const lengthUnitLabel = lengthUnitInfo ? lengthUnitInfo.abbreviation : distanceUnit.unit;
							const segText = `${_round(segLen, otherRound).toLocaleString()} ${lengthUnitLabel}`;
							const segAngle = _calculateAngle(path[j - 1][0], path[j - 1][1], path[j][0], path[j][1]);

							let segSym = currentTextSymbol.clone();
							segSym.text = segText;

							const midpointKey = `${Math.round(segMid.x)}_${Math.round(segMid.y)}`;
							const preserved = preservedSegmentLabelProperties.get(midpointKey);

							let segFinalPoint = segMid;

							if (preserved) {
								const p = preserved.symbol;
								segSym.color = p.color;
								segSym.font = p.font;
								segSym.angle = p.angle;
								segSym.haloSize = p.haloSize;
								segSym.haloColor = p.haloColor;
								segSym.verticalAlignment = p.verticalAlignment;
								segSym.xoffset = p.xoffset;
								segSym.yoffset = p.yoffset;
								if (p.backgroundColor) segSym.backgroundColor = p.backgroundColor;

								if (preserved.attributes?.hasCustomPosition && preserved.attributes?.customPosition) {
									try {
										const cp = preserved.attributes.customPosition;
										segFinalPoint = new Point({ x: cp.x, y: cp.y, spatialReference: cp.spatialReference });
									} catch (e) {
										console.warn('Error loading preserved segment custom position, using default:', e);
									}
								}
							} else if (
								rotateSegments &&
								!(graphic.attributes?.drawMode === 'freepolyline' || currentTool === 'freepolyline' || toolType === 'freepolyline')
							) {
								segSym.angle = segAngle;
								segSym.verticalAlignment = 'bottom';
								const distance = 4;
								const ang = segAngle * Math.PI / 180;
								const perp = ang + Math.PI / 2;
								segSym.yoffset = Math.sin(perp) * distance;
								segSym.xoffset = Math.cos(perp) * distance * -1.5;
							}

							if (!segSym.haloSize) {
								segSym.haloSize = 2;
								segSym.haloColor = 'white';
							}
							if (segSym.backgroundColor?.a > 0) segSym.backgroundColor.a = 0;

							const segLabel = new Graphic({
								geometry: segFinalPoint,
								symbol: segSym,
								visible: measureEnabledRef.current || graphic.attributes?.hadMeasurements || !!graphic.measure, // 🆕 FIX: Show if enabled OR graphic has measurements
								attributes: {
									name: segText,
										description: props.nls('segmentLabelDescription'),
									isMeasurementLabel: true,
									hideFromList: true,
									drawMode: 'text',
									measurementType: 'segment',
									parentGraphicId: graphic.attributes?.uniqueId,
									lengthUnit: distanceUnit.unit,
									isSegmentLabel: true,
									segmentIndex: j - 1,
									customized: !!preserved?.attributes?.customized,
									lastModified: preserved?.attributes?.lastModified || null,
									hasCustomPosition: !!preserved?.attributes?.hasCustomPosition,
									customPosition: preserved?.attributes?.customPosition || null,
									// FIXED: Store segment endpoints for proper reset functionality
									segmentInfo: (preserved?.attributes as any)?.segmentInfo || {
										point1: path[j - 1],
										point2: path[j]
									}
								}
							}) as ExtendedGraphic;

							drawLayer.add(segLabel);
							segLabel.measureParent = graphic;
							segLabel.measure = { graphic: graphic };
							if (graphic.attributes.relatedSegmentLabels) graphic.attributes.relatedSegmentLabels.push(segLabel);
							else graphic.attributes.relatedSegmentLabels = [segLabel];
						}
					}
				} catch (segErr) {
					console.error('Error adding segment measurements:', segErr);
				}
			}

			// Per-arc segment labels for true curves (straight loop above no-ops on
			// curves since their paths array is empty).
			if (!parent && shouldCreateSegments(geometry) && (geometry as any).curvePaths) {
				_createCurveSegmentLabels(graphic, geometry);
			}

			// CRITICAL: Final sanity check to ensure the main graphic remains visible and on the layer
			try {
				// Double-check graphic visibility
				if (graphic.visible === false) {
					//console.log('Restoring graphic visibility after measurement processing');
					graphic.visible = true;
				}

				// Ensure it's still on the layer
				const isStillOnLayer = drawLayer.graphics && drawLayer.graphics.includes && drawLayer.graphics.includes(graphic);
				if (!isStillOnLayer) {
					//console.log('Re-adding graphic to layer after measurement processing');
					try {
						drawLayer.add(graphic);
					} catch (finalAddError) {
						console.warn('Final add attempt failed:', finalAddError);
					}
				}

				// Try refresh methods
				if ('redraw' in view && typeof (view as any).redraw === 'function') {
					(view as any).redraw();
				} else if ('refresh' in drawLayer && typeof (drawLayer as any).refresh === 'function') {
					(drawLayer as any).refresh();
				}
			} catch (finalErr) {
				console.warn('Final sanity check failed, but continuing:', finalErr);
			}

			setCurrentGraphic(graphic);
			return true;
		} finally {
			processingQueue.current.delete(graphicId);
			if (!parent && !forceUpdate) {
				setTimeout(() => {
					measurementLock.current = false;
					setIsProcessingMeasurements(false);
				}, 100);
			}
		}
	};

	const liveMeasure = () => {
		// Silently defer if SketchViewModel isn't ready - don't warn, just return
		if (!sketchViewModel || !sketchViewModel.view) {
			//console.log('SketchViewModel not ready for measurement setup, deferring...');
			return;
		}

		//console.log('Setting up measurement listeners...');

		// 🔧 Remove existing listeners using refs first (synchronous)
		if (updateListenerRef.current) {
			try { updateListenerRef.current.remove(); } catch { /* no-op */ }
			updateListenerRef.current = null;
		}
		if (createListenerRef.current) {
			try { createListenerRef.current.remove(); } catch { /* no-op */ }
			createListenerRef.current = null;
		}
		// 🔧 MEMORY FIX: also remove the previous delete listener before
		// registering a fresh one further down. Without this each call to
		// setupSketchViewModelListeners would leak another handler.
		if (deleteListenerRef.current) {
			try { deleteListenerRef.current.remove(); } catch { /* no-op */ }
			deleteListenerRef.current = null;
		}

		// Also clean up state-based listeners (defensive)
		if (updateListener) {
			try { updateListener.remove(); } catch { /* no-op */ }
			setUpdateListener(null);
		}
		if (createListener) {
			try { createListener.remove(); } catch { /* no-op */ }
			setCreateListener(null);
		}

		// --- UPDATE listener (edit/move/reshape, etc.) ---
		const newUpdateListener = sketchViewModel.on('update', async (event) => {
			if (!sketchViewModel || !sketchViewModel.view || !isLayerBasicallyValid()) return;

			const graphic = event.graphics?.[0];
			if (!graphic || isMeasurementLabel(graphic)) {
				console.warn('📊 Early return: No graphic or is measurement label');
				return;
			}

			// 🔧 PRESET CIRCLE ACCURACY: circleRadiusMeters is the authoritative
			// entered radius and drives analytic labels. A scale or reshape changes
			// the actual circle, so the stored radius must be invalidated — labels
			// then fall back to measuring the geometry. Move and rotate preserve
			// the radius and keep exact labels.
			try {
				const tType = (event as any).toolEventInfo?.type as string | undefined;
				if (tType && (graphic as ExtendedGraphic).attributes?.circleRadiusMeters != null &&
					(tType.startsWith('scale') || tType.startsWith('reshape') || tType.startsWith('vertex'))) {
					delete (graphic as ExtendedGraphic).attributes.circleRadiusMeters;
				}
			} catch { /* no-op */ }

			// Check if this graphic has existing measurements (current or historical)
			const hasExistingMeasurements =
				(graphic as ExtendedGraphic).measure?.graphic ||
				(graphic as ExtendedGraphic).attributes?.hadMeasurements ||
				(graphic as ExtendedGraphic).attributes?.measurementsPermanent ||
				((graphic as ExtendedGraphic).attributes?.relatedMeasurementLabels?.length > 0) ||
				((graphic as ExtendedGraphic).attributes?.relatedSegmentLabels?.length > 0);

			// 🔧 FIX 10: Smart measurement handling when measurements are disabled
			if (!measureEnabledRef.current) {
				// If measurements are disabled, we need to handle graphics with existing measurements carefully
				const graphicHasActiveMeasurements = !!(
					(graphic as ExtendedGraphic).measure?.graphic ||
					(graphic as ExtendedGraphic).attributes?.relatedSegmentLabels?.length > 0 ||
					(graphic as ExtendedGraphic).attributes?.relatedMeasurementLabels?.length > 0
				);

				if (!graphicHasActiveMeasurements) {
					// No active measurements - skip processing entirely
					return;
				}

				// Has active measurements - allow LIVE updates while dragging to move labels with graphic
				// Fall through to process 'active' and 'start' events with _addMeasurementLive
			}

			// 🆕 FIX: For 'start' state, ensure labels are visible if they exist
			if (event.state === 'start' && hasExistingMeasurements) {
				// Make sure measurement labels are visible when graphic is selected
				const extGraphic = graphic as ExtendedGraphic;
				if (extGraphic.measure?.graphic) {
					extGraphic.measure.graphic.visible = true;
					ensureLabelVisibility(extGraphic.measure.graphic);
				}
				// Also ensure segment labels are visible
				if (extGraphic.attributes?.relatedSegmentLabels) {
					extGraphic.attributes.relatedSegmentLabels.forEach(segLabel => {
						if (segLabel && drawLayer && safeLayerContains(segLabel)) {
							segLabel.visible = true;
						}
					});
				}
			}

			const graphicId = getGraphicId(graphic);
			if (activeEvents.has(graphicId)) {
				//console.log('Skipping update - already processing:', graphicId);
				return;
			}

			setActiveEvents(prev => new Set(prev).add(graphicId));

			try {
				if (event.state === 'active') {
					// Lightweight updates while actively editing - ALWAYS update if graphic has measurements
					await _addMeasurementLive(graphic as ExtendedGraphic);
				} else if (event.state === 'complete') {
					// 🆕 FIX: For complete state, update if measurements are enabled OR graphic has existing measurements
					if (measureEnabledRef.current || hasExistingMeasurements) {
						cleanupCompleteThrottling(graphic as ExtendedGraphic);
						await throttledCompleteUpdate(graphic as ExtendedGraphic);
					}
				}
			} finally {
				setTimeout(() => {
					setActiveEvents(prev => {
						const next = new Set(prev);
						next.delete(graphicId);
						return next;
					});
				}, 200);
			}
		});

		// --- CREATE listener (new geometries) ---
		const newCreateListener = sketchViewModel.on('create', async (event) => {
			// console.log('🔍 CREATE EVENT:', {
			//   state: event.state,
			//   measureEnabledRef: measureEnabledRef.current,
			//   measureEnabledState: measureEnabled,
			//   hasGraphic: !!event.graphic
			// });

			if (!sketchViewModel || !sketchViewModel.view || !isLayerBasicallyValid()) {
				//console.log('❌ Skipping - SketchViewModel or layer not valid');
				return;
			}

			// Cancel (ESC) discards the in-progress graphic, but the live main and
			// segment labels created during the draw live on drawLayer — remove them
			// or they'd be orphaned as ghosts. Runs even if measurements were toggled
			// off mid-draw.
			if (event.state === 'cancel') {
				const canceled = event.graphic as ExtendedGraphic | undefined;
				if (canceled) {
					try {
						if (canceled.measure?.graphic && safeLayerContains(canceled.measure.graphic)) {
							safeLayerRemove(canceled.measure.graphic);
						}
						if (Array.isArray(canceled.attributes?.relatedSegmentLabels)) {
							canceled.attributes.relatedSegmentLabels.forEach((sl: any) => {
								try { if (sl && safeLayerContains(sl)) safeLayerRemove(sl); } catch { /* no-op */ }
							});
							canceled.attributes.relatedSegmentLabels = [];
						}
					} catch { /* no-op */ }
				}
				return;
			}

			// CRITICAL: if measurements are disabled *right now*, do nothing
			if (!measureEnabledRef.current) {
				//console.log('❌ Skipping create - measureEnabledRef:', measureEnabledRef.current, 'state:', event.state);
				return;
			}

			const graphic = event.graphic as ExtendedGraphic | undefined;
			if (!graphic || isMeasurementLabel(graphic)) {
				//console.log('❌ Skipping - no graphic or is measurement label');
				return;
			}

			//console.log('✅ Proceeding with measurement creation for:', graphic.geometry?.type);

			const graphicId = getGraphicId(graphic);

			// Don't track active events for 'active' state - only for 'complete'
			if (event.state === 'complete') {
				if (activeEvents.has(graphicId)) {
					//console.log('⚠️ Skipping create - already processing:', graphicId);
					return;
				}
				setActiveEvents(prev => new Set(prev).add(graphicId));
			}

			try {
				if (event.state === 'active') {
					//console.log('📊 Creating live measurement');
					// Show live measurements during active drawing - but don't track in activeEvents
					try {
						await _addMeasurementLive(graphic);
					} catch (error) {
						console.warn('Error in live measurement during create:', error);
					}
				} else if (event.state === 'complete') {
					//console.log('✅ Create complete - scheduling final measurement');
					// Add a small delay to ensure the graphic is fully processed by the widget first
					setTimeout(() => {
						//console.log('🔄 Processing final measurement for:', graphicId);
						cleanupCompleteThrottling(graphic);
						throttledCompleteUpdate(graphic);

						// Ensure visibility after measurement processing
						setTimeout(() => {
							if (graphic.measure?.graphic) {
								ensureLabelVisibility(graphic.measure.graphic);
							}

							// CRITICAL: Ensure the main graphic stays visible
							if (graphic.visible === false) {
								//console.log('🔄 Restoring graphic visibility after measurement processing');
								graphic.visible = true;
							}
						}, 100);
					}, 100); // Small delay to let widget finish its processing
				}
			} finally {
				// Only clean up activeEvents for complete state
				if (event.state === 'complete') {
					setTimeout(() => {
						setActiveEvents(prev => {
							const next = new Set(prev);
							next.delete(graphicId);
							return next;
						});
					}, 200);
				}
			}
		});

		// --- DELETE listener (clean up labels/segments) ---
		const newDeleteListener = sketchViewModel.on('delete', (event) => {
			// DON'T check sketchViewModel here - we're already in its event handler!
			const graphic = event.graphics?.[0] as ExtendedGraphic | undefined;
			if (!graphic) return;

			const graphicId = getGraphicId(graphic);

			// Remove from all tracking
			cleanupCompleteThrottling(graphic);
			setProcessedGraphics(prev => {
				const next = new Set(prev);
				next.delete(graphicId);
				return next;
			});
			setActiveEvents(prev => {
				const next = new Set(prev);
				next.delete(graphicId);
				return next;
			});

			// Clean up measurements - use more permissive layer check
			if (isLayerBasicallyValid()) {
				if (graphic.measure?.graphic && safeLayerContains(graphic.measure.graphic)) {
					try {
						safeLayerRemove(graphic.measure.graphic);
						//console.log('✅ Removed measurement label for deleted graphic');
					} catch (err) {
						console.warn("Couldn't remove measurement label:", err);
					}
				}
				if (Array.isArray(graphic.attributes?.relatedSegmentLabels)) {
					try {
						graphic.attributes.relatedSegmentLabels.forEach(segmentLabel => {
							if (segmentLabel && safeLayerContains(segmentLabel)) {
								try {
									safeLayerRemove(segmentLabel);
								} catch (removeErr) {
									console.warn("Couldn't remove segment label:", removeErr);
								}
							}
						});
						graphic.attributes.relatedSegmentLabels = [];
						//console.log('✅ Removed segment labels for deleted graphic');
					} catch (err) {
						console.warn("Couldn't remove segment labels:", err);
					}
				}
			} else {
				// Still clear references even if layer isn't valid
				//console.log('⚠️ Layer not valid, clearing references only');
				if (graphic.measure) graphic.measure = null;
				if (graphic.attributes?.relatedSegmentLabels) graphic.attributes.relatedSegmentLabels = [];
			}

			//console.log('🗑️ Graphic deletion cleanup complete:', graphicId);
		});

		// 🔧 Store in refs for synchronous access
		updateListenerRef.current = newUpdateListener;
		createListenerRef.current = newCreateListener;
		// 🔧 MEMORY FIX: previously newDeleteListener was orphaned. Persist it the
		// same way so the existing teardown blocks (which check *Ref.current and
		// call .remove()) can clean it up.
		deleteListenerRef.current = newDeleteListener;

		// Also store in state for useEffect cleanup
		setUpdateListener(newUpdateListener);
		setCreateListener(newCreateListener);
		//console.log('Measurement listeners set up successfully');
	};

	const renderEnhancedMeasurementEditingControls = () => {
		if (props.isDrawingActive || !measureEnabled) return null;

		// NEW: Check if there are any actual drawings (exclude measurement labels and buffers)
		const hasDrawings = drawLayer && drawLayer.graphics &&
			drawLayer.graphics.toArray().some(g =>
				!g.attributes?.isMeasurementLabel &&
				!g.attributes?.isBuffer &&
				!g.attributes?.isPreviewBuffer &&
				!g.attributes?.hideFromList
			);

		// Hide if no drawings OR if currently in drawing mode
		if (!hasDrawings || currentTool !== '') {
			return null;
		}

		return (
			<span title={props.nls('editMeasurementLabelsTitle')}>
				<CollapsableCheckbox
					label={props.nls('editMeasurementLabels')}
					onCheckedChange={(e) => {
						// 🔧 Guard against spurious firing during mount/remount
						if (!isInitialMount.current) {
							// console.log('🔧 User toggled measurement editing to:', e);
							toggleMeasurementEditing(e);
						}
					}}
					checked={editableMeasurements}  // ✅ Make it controlled
					disableActionForUnchecked
					openForCheck
					closeForUncheck
					className='w-100'
					aria-label={props.nls('editMeasurementLabelsAria')}
					aria-expanded={editableMeasurements}
					aria-controls='measurement-editing-panel'
				>
					<div
						className='d-flex flex-column'
						id='measurement-editing-panel'
						role='region'
						aria-label={props.nls('measurementEditingOptions')}
					>
						{/* Screen reader announcements for status changes */}
						<div
							role='status'
							aria-live='polite'
							aria-atomic='true'
							className='sr-only'
							style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
						>
							{!selectedMeasurementLabel && editableMeasurements && props.nls('measurementEditingActive')}
							{selectedMeasurementLabel && !isDraggingLabel && props.nls('measurementLabelSelectedInstructions')}
							{isDraggingLabel && props.nls('measurementLabelDraggingInstructions')}
						</div>
						<div className='ml-3 my-1'>
							<ul
								className='text-dark m-0 pl-3 small'
								role='list'
								aria-label={props.nls('measurementEditingInstructions')}
							>
								{!selectedMeasurementLabel && (
									<li role='listitem' aria-label={props.nls('selectMeasurementLabelInstructions')}>
										{props.nls('selectMeasurementLabelInstructions')}
									</li>
								)}
								{editableMeasurements && selectedMeasurementLabel && !isDraggingLabel && (
									<li
										className='text-success'
										role='listitem'
										aria-label={props.nls('labelSelected')}
									>
										<strong>{props.nls('labelSelected')}</strong>
									</li>
								)}
								{isDraggingLabel && (
									<li
										className='text-info'
										role='listitem'
										aria-label={props.nls('draggingActive')}
									>
										<strong>{props.nls('draggingActive')}</strong>
									</li>
								)}
							</ul>
						</div>
					</div>
					{selectedMeasurementLabel &&
						<div className='ml-3 my-1' role='form' aria-label={props.nls('measurementLabelStylingControls')}>
							{/* Font, Halo, and Text Formatting Controls - Three Column Layout */}
							<div className='d-flex mb-1' style={{ gap: '12px' }}>
								{/* Left Column - Font Properties */}
								<fieldset style={{ flex: '1', border: 'none', padding: 0, margin: 0 }}>
									<legend className='mb-2' style={{ fontSize: '1rem', fontWeight: 600 }}>
										<h6 className='mb-2' aria-hidden='true'>{props.nls('font')}</h6>
										<span className='sr-only' style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>{props.nls('measurementFontProperties')}</span>
									</legend>

									{/* Font Color */}
									<div className='d-flex align-items-center justify-content-between mb-2'>
										<Label
											className='mb-0'
											style={{ minWidth: '70px', fontSize: '12px' }}
											id='font-color-label'
										>
											{props.nls('fontColor')}:
										</Label>
										<ColorPicker
											color={measurementFontColor}
											onChange={updateMeasurementFontColor}
											width={24}
											height={24}
											aria-labelledby='font-color-label'
											aria-label={props.nls('measurementFontColorPickerAria')}
											title={props.nls('measurementFontColorPickerTitle')}
										/>
									</div>

									{/* Font Size */}
									<div className='d-flex align-items-center justify-content-between mb-2'>
										<Label
											className='mb-0'
											style={{ minWidth: '70px', fontSize: '12px' }}
											id='font-size-label'
										>
											{props.nls('measurementSize')}:
										</Label>
										<NumericInput
											size='sm'
											value={measurementFontSize}
											onChange={updateMeasurementFontSize}
											min={8}
											max={48}
											step={1}
											style={{ width: '60px' }}
											aria-labelledby='font-size-label'
											aria-label={props.nls('measurementFontSizeAria')}
											aria-valuemin={8}
											aria-valuemax={48}
											aria-valuenow={measurementFontSize}
											title={props.nls('measurementFontSizeTitle')}
										/>
									</div>

									{/* Font Rotation */}
									<div className='d-flex align-items-center justify-content-between mb-2'>
										<Label
											className='mb-0'
											style={{ minWidth: '70px', fontSize: '12px' }}
											id='font-rotation-label'
										>
											{props.nls('measurementRotation')}:
										</Label>
										<NumericInput
											size='sm'
											value={measurementFontRotation}
											onChange={updateMeasurementFontRotation}
											min={-180}
											max={180}
											step={5}
											style={{ width: '60px' }}
											aria-labelledby='font-rotation-label'
											aria-label={props.nls('measurementFontRotationAria')}
											aria-valuemin={-180}
											aria-valuemax={180}
											aria-valuenow={measurementFontRotation}
											title={props.nls('measurementFontRotationTitle')}
										/>
									</div>
								</fieldset>

								{/* Middle Column - Halo Properties */}
								<fieldset style={{ flex: '1', border: 'none', padding: 0, margin: 0 }}>
									<legend className='mb-2' style={{ fontSize: '1rem', fontWeight: 600 }}>
										<h6 className='mb-2' aria-hidden='true'>{props.nls('fontHalo')}</h6>
										<span className='sr-only' style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>{props.nls('measurementHaloProperties')}</span>
									</legend>

									{/* Enable Halo */}
									<div className='d-flex align-items-center justify-content-between mb-2'>
										<Label
											className='mb-0'
											style={{ minWidth: '70px', fontSize: '12px' }}
											id='halo-enable-label'
										>
											{props.nls('measurementEnable')}:
										</Label>
										<Switch
											size='sm'
											checked={measurementHaloEnabled}
											onChange={(e) => updateMeasurementHalo(e.target.checked)}
											aria-labelledby='halo-enable-label'
											aria-label={props.nls('measurementHaloToggleAria', { state: props.nls(measurementHaloEnabled ? 'enabled' : 'disabled'), action: props.nls(measurementHaloEnabled ? 'actionDisable' : 'actionEnable') })}
											aria-checked={measurementHaloEnabled}
											role='switch'
											title={props.nls('measurementHaloTitle')}
										/>
									</div>

									{/* Halo Color */}
									<div className='d-flex align-items-center justify-content-between mb-2'>
										<Label
											className='mb-0'
											style={{
												minWidth: '70px',
												fontSize: '12px',
												opacity: measurementHaloEnabled ? 1 : 0.5
											}}
											id='halo-color-label'
										>
											{props.nls('fontColor')}:
										</Label>
										<ColorPicker
											color={measurementHaloColor}
											onChange={(color) => updateMeasurementHalo(true, color)}
											width={24}
											height={24}
											disabled={!measurementHaloEnabled}
											aria-labelledby='halo-color-label'
											aria-label={props.nls('measurementHaloColorPickerAria')}
											aria-disabled={!measurementHaloEnabled}
											title={props.nls(measurementHaloEnabled ? 'measurementHaloColorTitle' : 'measurementEnableHaloColor')}
										/>
									</div>

									{/* Halo Size */}
									<div className='d-flex align-items-center justify-content-between mb-2'>
										<Label
											className='mb-0'
											style={{
												minWidth: '70px',
												fontSize: '12px',
												opacity: measurementHaloEnabled ? 1 : 0.5
											}}
											id='halo-size-label'
										>
											{props.nls('measurementSize')}:
										</Label>
										<NumericInput
											size='sm'
											value={measurementHaloSize}
											onChange={(size) => updateMeasurementHalo(true, undefined, size)}
											min={1}
											max={10}
											step={1}
											style={{ width: '60px' }}
											disabled={!measurementHaloEnabled}
											aria-labelledby='halo-size-label'
											aria-label={props.nls('measurementHaloSizeAria')}
											aria-valuemin={1}
											aria-valuemax={10}
											aria-valuenow={measurementHaloSize}
											aria-disabled={!measurementHaloEnabled}
											title={props.nls(measurementHaloEnabled ? 'measurementHaloSizeTitle' : 'measurementEnableHaloSize')}
										/>
									</div>
								</fieldset>
							</div>
							{/* Right Column - Text Formatting */}
							<fieldset
								className='d-flex justify-content-between'
								style={{ border: 'none', padding: 0, margin: 0 }}
								role='group'
								aria-label={props.nls('textFormattingOptions')}
							>
								<legend className='sr-only' style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
									{props.nls('textFormattingOptions')}
								</legend>
								{/* Bold */}
								<Label
									centric
									style={{ minWidth: '70px', fontSize: '12px' }}
									id='bold-label'
								>
									{props.nls('fontBold')}:
									<Switch
										size='sm'
										checked={measurementTextSymbol?.font?.weight === 'bold'}
										onChange={(e) => updateMeasurementFontWeight(e.target.checked)}
										className='ml-1'
										aria-labelledby='bold-label'
										aria-label={props.nls('measurementBoldAria', { state: props.nls(measurementTextSymbol?.font?.weight === 'bold' ? 'enabled' : 'disabled') })}
										aria-checked={measurementTextSymbol?.font?.weight === 'bold'}
										role='switch'
										title={props.nls('measurementBoldTitle')}
									/>
								</Label>

								{/* Italic */}
								<Label
									centric
									style={{ minWidth: '70px', fontSize: '12px' }}
									id='italic-label'
								>
									{props.nls('fontItalic')}:
									<Switch
										size='sm'
										checked={measurementTextSymbol?.font?.style === 'italic'}
										onChange={(e) => updateMeasurementFontStyle(e.target.checked)}
										className='ml-1'
										aria-labelledby='italic-label'
										aria-label={props.nls('measurementItalicAria', { state: props.nls(measurementTextSymbol?.font?.style === 'italic' ? 'enabled' : 'disabled') })}
										aria-checked={measurementTextSymbol?.font?.style === 'italic'}
										role='switch'
										title={props.nls('measurementItalicTitle')}
									/>
								</Label>

								{/* Underline */}
								<Label
									centric
									style={{ minWidth: '70px', fontSize: '12px' }}
									id='underline-label'
								>
									{props.nls('fontUnderline')}:
									<Switch
										size='sm'
										checked={measurementTextSymbol?.font?.decoration === 'underline'}
										onChange={(e) => updateMeasurementFontDecoration(e.target.checked)}
										className='ml-1'
										aria-labelledby='underline-label'
										aria-label={props.nls('measurementUnderlineAria', { state: props.nls(measurementTextSymbol?.font?.decoration === 'underline' ? 'enabled' : 'disabled') })}
										aria-checked={measurementTextSymbol?.font?.decoration === 'underline'}
										role='switch'
										title={props.nls('measurementUnderlineTitle')}
									/>
								</Label>
							</fieldset>

							{/* Position Controls — equal-width buttons */}
							<div role='group' aria-label={props.nls('measurementLabelPositionControls')}>
								<ButtonGroup
									block
									variant='contained'
									size='sm'
									role='group'
									aria-label={props.nls('measurementMoveResetPosition')}
								>
									<Button
										color='primary'
										onClick={() => {
											if (!currentMapView) {
												if (sketchViewModel?.view) currentMapView = sketchViewModel.view;
												else if (props.jimuMapView?.view) currentMapView = props.jimuMapView.view;
											}
											if (selectedMeasurementLabel && currentMapView) {
												startLabelDrag(selectedMeasurementLabel, null);
											}
										}}
										disabled={isDraggingLabel}
										title={props.nls('measurementMoveLabelTitle')}
										style={{ margin: 0 }}
										aria-label={props.nls(isDraggingLabel ? 'measurementDraggingLabelAria' : 'measurementMoveLabelAria')}
										aria-disabled={isDraggingLabel}
										aria-pressed={isDraggingLabel}
									>
										{props.nls(isDraggingLabel ? 'measurementDragging' : 'measurementMoveLabel')}
									</Button>
									<Button
										onClick={resetLabelPosition}
									title={props.nls('measurementResetPositionTitle')}
										disabled={!selectedMeasurementLabel.attributes?.hasCustomPosition}
										style={{ margin: 0 }}
										variant='outlined'
									aria-label={props.nls('measurementResetPositionAria')}
										aria-disabled={!selectedMeasurementLabel.attributes?.hasCustomPosition}
									>
									{props.nls('measurementResetPosition')}
									</Button>
								</ButtonGroup>
								<Button
									size='sm'
									variant='contained'
									onClick={cleanupMeasurementLabelSelection}
								title={props.nls('measurementClearSelectionTitle')}
									block
									style={{ margin: 0 }}
								aria-label={props.nls('measurementClearSelectionAria')}
								>
								{props.nls('measurementClearSelection')}
								</Button>
							</div>
						</div>
					}
				</CollapsableCheckbox>
			</span>
		);
	};

	return (
		<div
			className='drawToolbarDiv'
			role='region'
			aria-label={props.nls('measurementToolsPanel')}
		>
			<div className='d-flex flex-column'>

				{/* Stack the two main toggles together (CSS now controls spacing = none) */}
				<div
					className="measure-toggle-stack"
					role='group'
					aria-label={props.nls('measurementConfigurationOptions')}
				>
					{showTextPreview ? (
						<></>
					) : (
						<>
							{!editableMeasurements ? (
								<span
									title={
										measureEnabled
											? props.nls('measurementsEnabledTitle')
											: props.nls('measurementsDisabledTitle')
									}
								>
									<CollapsableCheckbox
										label={
											drawLayer?.graphics?.length < 1
												? props.nls('enableMeasurements')
												: measureEnabled
													? props.nls('measurementsAdding')
													: props.nls('measurementsRemoving')
										}
										onCheckedChange={(e) => {
											//console.log('🔧 User toggled measurements:', e);
											setMeasureEnabled(e);
										}}
										checked={measureEnabled}
										disableActionForUnchecked
										openForCheck
										closeForUncheck
										className='w-100'
										aria-label={
											drawLayer?.graphics?.length < 1
												? props.nls('enableMeasurementsAria')
												: measureEnabled
													? props.nls('measurementsAddingAria')
													: props.nls('measurementsRemovingAria')
										}
										aria-expanded={measureEnabled}
										aria-controls='measurement-settings-panel'
									>
										<div
											className='d-flex flex-column'
											id='measurement-settings-panel'
											role='region'
											aria-label={props.nls('measurementUnitDisplaySettings')}
										>
											{toolType === 'point' || toolType === '' || toolType === 'text' ? (
												<></>
											) : (
												<Label
													className='drawToolbarDiv'
													id='linear-units-label'
												>
											{props.nls('linearUnits')}
													<Select
												title={props.nls('linearUnitsTitle')}
														onChange={(e) => setDistanceUnit(e.target.value)}
														defaultValue={availableDistanceUnits[props.config.defaultDistance]}
														aria-labelledby='linear-units-label'
												aria-label={props.nls('linearUnitsAria')}
														aria-describedby='linear-units-description'
													>
														{availableDistanceUnits.map((unit, index) => (
															<Option
																key={index}
																value={unit}
													aria-label={props.nls('measurementUnitOptionAria', { label: unit.label, abbreviation: unit.abbreviation })}
															>
																{unit.label + ' (' + unit.abbreviation + ')'}
															</Option>
														))}
													</Select>
													<span
														id='linear-units-description'
														className='sr-only'
														style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
													>
												{props.nls('linearUnitsDescription')}
													</span>
												</Label>
											)}

											{toolType === 'point' || toolType === 'polyline' || toolType === 'freepolyline' || toolType === '' || toolType === 'text' ? (
												<></>
											) : (
												<Label
													className='drawToolbarDiv'
													id='area-units-label'
												>
											{props.nls('areaUnits')}
													<Select
												title={props.nls('areaUnitsTitle')}
														onChange={(e) => setAreaUnit(e.target.value)}
														defaultValue={availableAreaUnits[props.config.defaultArea]}
														aria-labelledby='area-units-label'
												aria-label={props.nls('areaUnitsAria')}
														aria-describedby='area-units-description'
													>
														{availableAreaUnits.map((unit, index) => (
															<Option
																key={index}
																value={unit}
													aria-label={props.nls('measurementUnitOptionAria', { label: unit.label, abbreviation: unit.abbreviation })}
															>
																{unit.label + ' (' + unit.abbreviation + ')'}
															</Option>
														))}
													</Select>
													<span
														id='area-units-description'
														className='sr-only'
														style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
													>
												{props.nls('areaUnitsDescription')}
													</span>
												</Label>
											)}

											{toolType === 'point' ? (
											<div role='group' aria-label={props.nls('pointCoordinateDisplayOptions')}>
													<fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
														<legend className='sr-only' style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
													{props.nls('coordinateFormatOptions')}
														</legend>
												<div className='d-flex justify-content-center' role='group' aria-label={props.nls('selectCoordinateFormats')}>
															<Label
																centric
																id='xy-checkbox-label'
															>
																<Checkbox
																	className='mr-2 mt-2 mb-2 ml-4'
																	checked={xy}
																	onChange={() => setXy(!xy)}
																	aria-labelledby='xy-checkbox-label'
															aria-label={props.nls('xyCoordinatesAria', { state: props.nls(xy ? 'enabled' : 'disabled') })}
																	aria-checked={xy}
															title={props.nls('xyCoordinatesTitle')}
																/>
																{props.nls('pointXYLabel')}
															</Label>
															<Label
																centric
																id='latlong-checkbox-label'
															>
																<Checkbox
																	className='mr-2 mt-2 mb-2 ml-4'
																	checked={latLong}
																	onChange={() => setLatLong(!latLong)}
																	aria-labelledby='latlong-checkbox-label'
															aria-label={props.nls('latLongAria', { state: props.nls(latLong ? 'enabled' : 'disabled') })}
																	aria-checked={latLong}
															title={props.nls('latLongTitle')}
																/>
																{props.nls('pointLatLongLabel')}
															</Label>
															{xy || latLong ? (
																<Label
																	centric
																	id='wkid-checkbox-label'
																>
																	<Checkbox
																		className='mr-2 mt-2 mb-2 ml-4'
																		checked={wkid}
																		onChange={() => setWkid(!wkid)}
																		aria-labelledby='wkid-checkbox-label'
																aria-label={props.nls('wkidAria', { state: props.nls(wkid ? 'enabled' : 'disabled') })}
																		aria-checked={wkid}
																title={props.nls('wkidTitle')}
																	/>
																	{props.nls('pointWKIDLabel')}
																</Label>
															) : (
																<></>
															)}
														</div>
													</fieldset>
													<Label
														centric
														className='d-flex justify-content-center'
														id='point-decimal-label'
													>
													{props.nls('decimalPlaces')}
														<NumericInput
															className='decimalInput ml-2'
															size='sm'
															max={10}
															min={0}
															step={1}
															value={pointRound}
															onChange={(value) => setPointRound(value)}
															aria-labelledby='point-decimal-label'
													aria-label={props.nls('pointDecimalPlacesAria')}
															aria-valuemin={0}
															aria-valuemax={10}
															aria-valuenow={pointRound}
													title={props.nls('pointDecimalPlacesTitle')}
														/>
													</Label>
												</div>
											) : (
												<></>
											)}

											{toolType === 'polyline' || toolType === 'freepolyline' ? (
											<div role='group' aria-label={props.nls('lineMeasurementDisplayOptions')}>
													<fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
														<legend className='sr-only' style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
													{props.nls('lineMeasurementDisplayOptions')}
														</legend>
												<div className='d-flex justify-content-center' role='group' aria-label={props.nls('selectMeasurementsDisplay')}>
															<Label
																centric
																id='length-checkbox-label'
															>
																<Checkbox
																	className='mr-2 mt-2 mb-2 ml-4'
																	checked={lengthOn}
																	onChange={() => setLengthOn(!lengthOn)}
																	aria-labelledby='length-checkbox-label'
															aria-label={props.nls('totalLengthAria', { state: props.nls(lengthOn ? 'enabled' : 'disabled') })}
																	aria-checked={lengthOn}
															title={props.nls('totalLengthTitle')}
																/>
															{props.nls('drawToolLengthTip')}
															</Label>
															<Label
																centric
																id='line-segments-checkbox-label'
															>
																<Checkbox
																	className='mr-2 mt-2 mb-2 ml-4'
																	checked={segmentsOn}
																	onChange={() => setSegmentsOn(!segmentsOn)}
																	aria-labelledby='line-segments-checkbox-label'
															aria-label={props.nls('lineSegmentsAria', { state: props.nls(segmentsOn ? 'enabled' : 'disabled') })}
																	aria-checked={segmentsOn}
															title={props.nls('lineSegmentsTitle')}
																/>
															{props.nls('lineSegments')}
															</Label>
														</div>
													</fieldset>
													{segmentsOn && (
														<div className='d-flex justify-content-center w-100'>
															<Label
																centric
																id='rotate-segments-label'
															>
																<Switch
																	className='mr-2'
																	checked={rotateSegments}
																	onChange={() => setRotateSegments(!rotateSegments)}
																	aria-labelledby='rotate-segments-label'
															aria-label={props.nls('rotateSegmentLabelsAria', { state: props.nls(rotateSegments ? 'enabled' : 'disabled'), geometry: props.nls('lineSegment') })}
																	aria-checked={rotateSegments}
																	role='switch'
															title={props.nls('rotateSegmentLabelsTitle', { geometry: props.nls('lineSegment') })}
																/>
															{props.nls('rotateLineSegmentLabels')}
															</Label>
														</div>
													)}
													<Label
														centric
														className='d-flex justify-content-center'
														id='line-decimal-label'
													>
													{props.nls('decimalPlaces')}
														<NumericInput
															className='decimalInput ml-2'
															size='sm'
															max={10}
															min={0}
															step={1}
															value={otherRound}
															onChange={(value) => setOtherRound(value)}
															aria-labelledby='line-decimal-label'
													aria-label={props.nls('lineDecimalPlacesAria')}
															aria-valuemin={0}
															aria-valuemax={10}
															aria-valuenow={otherRound}
													title={props.nls('measurementDecimalPlacesTitle')}
														/>
													</Label>
													{toolType === 'freepolyline' ? (
														<Alert
															className='w-100'
															role='alert'
															aria-live='polite'
															tabIndex={0}
														title={props.nls('freehandLineSegmentsWarningTitle')}
														>
														{props.nls('freehandLineSegmentsWarning')}
														</Alert>
													) : (
														<></>
													)}
												</div>
											) : (
												<></>
											)}

											{toolType === 'polygon' || toolType === 'freepolygon' || toolType === 'circle' ? (
											<div role='group' aria-label={props.nls('polygonCircleMeasurementDisplayOptions')}>
													<fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
														<legend className='sr-only' style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
													{props.nls('polygonCircleMeasurementDisplayOptions')}
														</legend>
												<div className='d-flex justify-content-center' role='group' aria-label={props.nls('selectMeasurementsDisplay')}>
															<Label
																centric
																id='area-checkbox-label'
															>
																<Checkbox
																	className='mr-2 mt-2 mb-2 ml-4'
																	checked={areaOn}
																	onChange={() => setAreaOn(!areaOn)}
																	aria-labelledby='area-checkbox-label'
															aria-label={props.nls('areaMeasurementAria', { state: props.nls(areaOn ? 'enabled' : 'disabled') })}
																	aria-checked={areaOn}
															title={props.nls('areaMeasurementTitle')}
																/>
															{props.nls('drawToolAreaTip')}
															</Label>
															<Label
																centric
																id='perimeter-checkbox-label'
															>
																<Checkbox
																	className='mr-2 mt-2 mb-2 ml-4'
																	checked={perimeterOn}
																	onChange={() => setPerimeterOn(!perimeterOn)}
																	aria-labelledby='perimeter-checkbox-label'
															aria-label={props.nls('perimeterMeasurementAria', { state: props.nls(perimeterOn ? 'enabled' : 'disabled') })}
																	aria-checked={perimeterOn}
															title={props.nls('perimeterMeasurementTitle')}
																/>
															{props.nls('perimeter')}
															</Label>
															{toolType === 'circle' ? (
																<Label
																	centric
																	id='radius-checkbox-label'
																>
																	<Checkbox
																		className='mr-2 mt-2 mb-2 ml-4'
																		checked={radiusOn}
																		onChange={() => setRadiusOn(!radiusOn)}
																		aria-labelledby='radius-checkbox-label'
																aria-label={props.nls('radiusMeasurementAria', { state: props.nls(radiusOn ? 'enabled' : 'disabled') })}
																		aria-checked={radiusOn}
																title={props.nls('radiusMeasurementTitle')}
																	/>
																{props.nls('radius')}
																</Label>
															) : (
																<></>
															)}
															{toolType === 'polygon' || toolType === 'freepolygon' ? (
																<Label
																	centric
																	id='polygon-segments-checkbox-label'
																>
																	<Checkbox
																		className='mr-2 mt-2 mb-2 ml-4'
																		checked={segmentsOn}
																		onChange={() => setSegmentsOn(!segmentsOn)}
																		aria-labelledby='polygon-segments-checkbox-label'
																aria-label={props.nls('polygonSegmentsAria', { state: props.nls(segmentsOn ? 'enabled' : 'disabled') })}
																		aria-checked={segmentsOn}
																title={props.nls('polygonSegmentsTitle')}
																	/>
																{props.nls('lineSegments')}
																</Label>
															) : (
																<></>
															)}
														</div>
													</fieldset>
													{segmentsOn && (toolType === 'polygon' || toolType === 'freepolygon') && (
														<div className='d-flex justify-content-center w-100'>
															<Label
																centric
																id='polygon-rotate-segments-label'
															>
																<Switch
																	className='mr-2'
																	checked={rotateSegments}
																	onChange={() => setRotateSegments(!rotateSegments)}
																	aria-labelledby='polygon-rotate-segments-label'
															aria-label={props.nls('rotateSegmentLabelsAria', { state: props.nls(rotateSegments ? 'enabled' : 'disabled'), geometry: props.nls('polygonSide') })}
																	aria-checked={rotateSegments}
																	role='switch'
															title={props.nls('rotateSegmentLabelsTitle', { geometry: props.nls('polygonSide') })}
																/>
															{props.nls('rotateLineSegmentLabels')}
															</Label>
														</div>
													)}
													<Label
														centric
														className='d-flex justify-content-center'
														id='polygon-decimal-label'
													>
													{props.nls('decimalPlaces')}
														<NumericInput
															className='decimalInput ml-2'
															size='sm'
															max={10}
															min={0}
															step={1}
															value={otherRound}
															onChange={(value) => setOtherRound(value)}
															aria-labelledby='polygon-decimal-label'
													aria-label={props.nls('polygonDecimalPlacesAria')}
															aria-valuemin={0}
															aria-valuemax={10}
															aria-valuenow={otherRound}
													title={props.nls('measurementDecimalPlacesTitle')}
														/>
													</Label>
													{toolType === 'freepolygon' ? (
														<Alert
															className='w-100'
															role='alert'
															aria-live='polite'
															tabIndex={0}
														title={props.nls('freehandPolygonSegmentsWarningTitle')}
														>
														{props.nls('freehandLineSegmentsWarning')}
														</Alert>
													) : (
														<></>
													)}
												</div>
											) : (
												<></>
											)}
										</div>
									</CollapsableCheckbox>
								</span>
							) : <></>}

							{/* ⬇️ Edit Measurement Labels */}
							{renderEnhancedMeasurementEditingControls()}
						</>
					)}

					{/* Tooltips toggle */}
					<span title={props.nls(tooltips ? 'tooltipsEnabledTitle' : 'tooltipsDisabledTitle')}>
						<CollapsableCheckbox
							className='w-100'
							checked={tooltips}
							onCheckedChange={() => setTooltips(!tooltips)}
							disableActionForUnchecked
							openForCheck
							closeForUncheck
							label={props.nls(tooltips ? 'disableTooltips' : 'enableTooltips')}
							aria-label={props.nls(tooltips ? 'tooltipsEnabledAria' : 'tooltipsDisabledAria')}
							aria-expanded={tooltips}
							aria-controls='tooltips-info-panel'
						>
							<div
								className='ml-3 my-1'
								id='tooltips-info-panel'
								role='region'
								aria-label={props.nls('tooltipsInformation')}
							>
								<ul
									className='text-dark m-0 pl-3 small'
									role='list'
									aria-label={props.nls('tooltipsKeyboardShortcuts')}
								>
									<li role='listitem' aria-label={props.nls('tooltipsKeyboardTipAria')}>
										{props.nls('tooltipsKeyboardTip')}
									</li>
								</ul>
							</div>
						</CollapsableCheckbox>
					</span>
				</div>
			</div>
		</div>
	);
})

export default Measure
