import { React } from 'jimu-core';
import { ImmutableObject } from 'jimu-core';
import { CollapsableCheckbox, Alert, Switch, Label, Select, Option, Slider, NumericInput } from 'jimu-ui';
import { ColorPicker } from 'jimu-ui/basic/color-picker';
import type { JimuMapView } from 'jimu-arcgis';
// FeatureSnappingLayerSource removed in JSAPI 5.0 - featureSources autocasts
import FeatureLayer from 'esri/layers/FeatureLayer';
import Collection from 'esri/core/Collection';
import GridControls from 'esri/widgets/support/GridControls';

interface SnappingControlsProps {
    jimuMapView: JimuMapView;
    sketchViewModel: any;
    nls: (id: string, values?: Record<string, any>) => string;
}

// Screen reader only styles for visually hidden but accessible text
const srOnlyStyles: React.CSSProperties = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: '0'
};

export const SnappingControls = (props: SnappingControlsProps): React.ReactElement => {
    const nls = props.nls;
    const [enabled, setEnabled] = React.useState(false);
    const [snapSourcesCount, setSnapSourcesCount] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const processedLayerKeys = React.useRef(new Set<string>());

    // Grid Controls state
    const [gridEnabled, setGridEnabled] = React.useState(false);
    const [gridColor, setGridColor] = React.useState('rgba(0,0,0,1)');
    const [gridTheme, setGridTheme] = React.useState<'light' | 'dark' | 'custom'>('light');
    const [gridRotation, setGridRotation] = React.useState(0);
    const [gridSpacing, setGridSpacing] = React.useState(50);
    const [gridDynamicScale, setGridDynamicScale] = React.useState(true);
    const [gridSnapEnabled, setGridSnapEnabled] = React.useState(true);
    const [gridMajorLineInterval, setGridMajorLineInterval] = React.useState(5);
    const [gridRotateWithMap, setGridRotateWithMap] = React.useState(false);
    const [gridPlacementActive, setGridPlacementActive] = React.useState(false);
    const gridControlsRef = React.useRef<GridControls | null>(null);

    // Linear unit grid state
    const [gridSpacingMode, setGridSpacingMode] = React.useState<'pixels' | 'mapUnits'>('pixels');
    const [gridMapUnit, setGridMapUnit] = React.useState<'feet' | 'meters' | 'yards'>('feet');
    const [gridMapUnitValue, setGridMapUnitValue] = React.useState(100);

    // Track whether grid was on before snapping was disabled (for restore)
    const gridWasEnabledRef = React.useRef(false);
    // Guard against re-entrant state updates during sync
    const isSyncingRef = React.useRef(false);

    // Generate unique IDs for accessibility associations
    const baseId = React.useId();
    const ids = {
        snappingPanel: `${baseId}-snapping-panel`,
        snappingStatus: `${baseId}-snapping-status`,
        snappingInstructions: `${baseId}-snapping-instructions`,
        snappingError: `${baseId}-snapping-error`,
        gridPanel: `${baseId}-grid-panel`,
        gridStatus: `${baseId}-grid-status`,
        gridThemeLabel: `${baseId}-grid-theme-label`,
        gridThemeSelect: `${baseId}-grid-theme-select`,
        gridThemeDesc: `${baseId}-grid-theme-desc`,
        gridColorLabel: `${baseId}-grid-color-label`,
        gridColorPicker: `${baseId}-grid-color-picker`,
        gridSpacingLabel: `${baseId}-grid-spacing-label`,
        gridSpacingSlider: `${baseId}-grid-spacing-slider`,
        gridSpacingInput: `${baseId}-grid-spacing-input`,
        gridSpacingDesc: `${baseId}-grid-spacing-desc`,
        gridRotationLabel: `${baseId}-grid-rotation-label`,
        gridRotationSlider: `${baseId}-grid-rotation-slider`,
        gridRotationInput: `${baseId}-grid-rotation-input`,
        gridRotationDesc: `${baseId}-grid-rotation-desc`,
        gridMajorLineLabel: `${baseId}-grid-majorline-label`,
        gridMajorLineSlider: `${baseId}-grid-majorline-slider`,
        gridMajorLineInput: `${baseId}-grid-majorline-input`,
        gridMajorLineDesc: `${baseId}-grid-majorline-desc`,
        gridDynamicScaleSwitch: `${baseId}-grid-dynamic-scale`,
        gridDynamicScaleDesc: `${baseId}-grid-dynamic-scale-desc`,
        gridSnapSwitch: `${baseId}-grid-snap`,
        gridSnapDesc: `${baseId}-grid-snap-desc`,
        gridPlacementButton: `${baseId}-grid-placement-btn`,
        gridPlacementDesc: `${baseId}-grid-placement-desc`,
        gridRotateMapSwitch: `${baseId}-grid-rotate-map`,
        gridRotateMapDesc: `${baseId}-grid-rotate-map-desc`,
        gridSpacingModeLabel: `${baseId}-grid-spacing-mode-label`,
        gridSpacingModeSelect: `${baseId}-grid-spacing-mode-select`,
        gridSpacingModeDesc: `${baseId}-grid-spacing-mode-desc`,
        gridMapUnitLabel: `${baseId}-grid-map-unit-label`,
        gridMapUnitSelect: `${baseId}-grid-map-unit-select`,
        gridMapUnitValueLabel: `${baseId}-grid-map-unit-value-label`,
        gridMapUnitValueInput: `${baseId}-grid-map-unit-value-input`,
        gridMapUnitValueDesc: `${baseId}-grid-map-unit-value-desc`,
        liveRegion: `${baseId}-live-region`
    };

    // Ref for live region announcements
    const liveRegionRef = React.useRef<HTMLDivElement>(null);

    // Function to announce messages to screen readers
    const announce = React.useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
        if (liveRegionRef.current) {
            liveRegionRef.current.setAttribute('aria-live', priority);
            liveRegionRef.current.textContent = message;
            // Clear after announcement
            setTimeout(() => {
                if (liveRegionRef.current) {
                    liveRegionRef.current.textContent = '';
                }
            }, 1000);
        }
    }, []);

    const isSnappableLayer = (layer: any): boolean => {
        if (!layer?.visible) return false;
        const snappableTypes = ['feature', 'graphics', 'csv', 'geojson', 'wfs'];
        return snappableTypes.includes(layer?.type?.toLowerCase() || '');
    };

    const addSnappingSource = (layer: any, snapSources: any[], key: string) => {
        if (processedLayerKeys.current.has(key)) return;
        try {
            const source: any = { layer, enabled: true }; // JSAPI 5.0 autocasting
            snapSources.push(source);
            processedLayerKeys.current.add(key);
        } catch (err) {
            console.warn(`Failed to add snapping source for ${key}: ${err.message}`);
        }
    };

    const recurseLayers = async (
        layer: any,
        snapSources: any[],
        depth = 0
    ) => {
        if (!layer || depth > 10 || !layer.visible) return;

        const key = layer.id || layer.url || `${layer.title}-${depth}`;

        if (isSnappableLayer(layer)) {
            addSnappingSource(layer, snapSources, key);
        }

        if (layer?.url && layer?.type === 'sublayer' && layer?.layerType === 'Feature Layer') {
            const urlKey = `url:${layer.url}`;
            if (!processedLayerKeys.current.has(urlKey)) {
                try {
                    const featureLayer = new FeatureLayer({ url: layer.url, visible: true, outFields: ['*'] });
                    await featureLayer.load();
                    addSnappingSource(featureLayer, snapSources, urlKey);
                } catch (err) {
                    console.warn(`❌ Could not load feature layer from URL ${layer.url}: ${err.message}`);
                }
            }
        }

        const sublayerCollections = [
            layer.sublayers,
            layer.allSublayers,
            layer.layers,
            layer.subLayers,
            layer.layerInfos
        ];

        for (const coll of sublayerCollections) {
            if (coll?.items) {
                for (const sub of coll.items) await recurseLayers(sub, snapSources, depth + 1);
            } else if (Array.isArray(coll)) {
                for (const sub of coll) await recurseLayers(sub, snapSources, depth + 1);
            }
        }
    };

    const configureSnapping = async () => {
        setIsLoading(true);
        setError(null);
        processedLayerKeys.current.clear();
        announce(nls('snappingConfiguring'), 'polite');

        const view = props.jimuMapView?.view;
        const sketchVM = props.sketchViewModel;

        if (!view) {
            const errorMsg = nls('mapViewUnavailable');
            setError(errorMsg);
            setIsLoading(false);
            announce(nls('errorPrefix') + errorMsg, 'assertive');
            return;
        }
        if (!sketchVM) {
            const errorMsg = nls('sketchViewModelUnavailable');
            setError(errorMsg);
            setIsLoading(false);
            announce(nls('errorPrefix') + errorMsg, 'assertive');
            return;
        }

        try {
            // Enable snapping on the SketchViewModel up front, before the layer scan
            // below (which can be slow or throw). Custom tools (triangle, curve) read
            // snappingOptions.enabled directly, so it must be set even if the scan
            // fails. featureSources are attached afterward once gathered.
            const options = {
                enabled: true,
                featureEnabled: true,
                selfEnabled: true,
                distance: 15,
                featureSources: new Collection()
            };
            sketchVM.snappingOptions = options;
            (view as any).snappingOptions = options;
            if (gridControlsRef.current?.viewModel) {
                gridControlsRef.current.snappingOptions = options;
            }

            const snapSources: any[] = [];
            const allLayers = view.map.allLayers.toArray();

            await Promise.all(
                allLayers
                    .filter((l) => l.load && !l.loaded)
                    .map((l) => l.load().catch(() => { }))
            );

            for (const layer of allLayers) {
                try { await recurseLayers(layer, snapSources); }
                catch (e) { console.warn('Snap layer enumerate failed:', e); }
            }

            // Attach discovered sources to the already-enabled options.
            try {
                const fs = (sketchVM.snappingOptions as any).featureSources;
                if (fs?.removeAll) { fs.removeAll(); fs.addMany(snapSources); }
                else (sketchVM.snappingOptions as any).featureSources = new Collection(snapSources);
            } catch {
                (sketchVM.snappingOptions as any).featureSources = new Collection(snapSources);
            }

            setSnapSourcesCount(snapSources.length);
            if (snapSources.length === 0) {
                const warningMsg = nls('noSnappableLayers');
                setError(warningMsg);
                announce(nls('warningPrefix') + warningMsg, 'polite');
            } else {
                announce(nls('snappingEnabledWithLayers', { count: snapSources.length, plural: snapSources.length !== 1 ? 's' : '' }), 'polite');
            }
        } catch (err: any) {
            console.error('Error configuring snapping:', err);
            const errorMsg = nls('snappingFailed', { error: err.message });
            setError(errorMsg);
            announce(nls('errorPrefix') + errorMsg, 'assertive');
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggle = () => {
        const newState = !enabled;

        if (!newState && gridEnabled) {
            // Snapping is being disabled while grid is on — force grid off first
            gridWasEnabledRef.current = true;
            forceGridOff();
        }

        setEnabled(newState);
        announce(nls(newState ? 'snappingEnabled' : 'snappingDisabled'), 'polite');
    };

    const handleGridToggle = () => {
        // Prevent toggling grid on if snapping is disabled
        if (!enabled && !gridEnabled) {
            announce(nls('enableSnappingFirst'), 'assertive');
            return;
        }

        const newState = !gridEnabled;
        setGridEnabled(newState);

        // Directly sync the viewModel immediately to avoid stale state
        if (gridControlsRef.current?.viewModel) {
            try {
                gridControlsRef.current.viewModel.trySetDisplayEnabled(newState);
                if (!newState) {
                    gridControlsRef.current.viewModel.snappingEnabled = false;
                }
            } catch (e) {
                console.warn('Error syncing grid toggle:', e);
            }
        }

        announce(nls(newState ? 'gridOverlayEnabled' : 'gridOverlayDisabled'), 'polite');
    };

    /**
     * Force grid off and sync all state — used when snapping is disabled
     * to prevent orphaned grid state
     */
    const forceGridOff = React.useCallback(() => {
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;

        try {
            setGridEnabled(false);

            if (gridControlsRef.current?.viewModel) {
                try {
                    gridControlsRef.current.viewModel.trySetDisplayEnabled(false);
                    gridControlsRef.current.viewModel.snappingEnabled = false;
                } catch (e) {
                    console.warn('Error forcing grid off:', e);
                }
            }
        } finally {
            isSyncingRef.current = false;
        }
    }, []);

    React.useEffect(() => {
        if (enabled && props.jimuMapView?.view && props.sketchViewModel) {
            configureSnapping();
        }
        if (!enabled && props.jimuMapView?.view && props.sketchViewModel) {
            // Disable snapping on the SketchViewModel
            props.sketchViewModel.snappingOptions.enabled = false;

            // Also disable on the view if it was set there
            const view = props.jimuMapView.view;
            if ((view as any).snappingOptions) {
                (view as any).snappingOptions.enabled = false;
            }

            // Force grid off when snapping is disabled to prevent orphaned state
            forceGridOff();
        }
    }, [enabled, props.jimuMapView, props.sketchViewModel]);

    // Grid Controls initialization and cleanup
    React.useEffect(() => {
        // Initialize GridControls when we have a 2D MapView (grid only works in 2D)
        if (props.jimuMapView?.view && !gridControlsRef.current) {
            try {
                const view = props.jimuMapView.view;

                // Grid only works with 2D MapView, not SceneView
                if (view.type !== '2d') {
                    return;
                }

                // Create GridControls instance - it manages the view's grid
                const gridControls = new GridControls({
                    view: view as any,
                    theme: gridTheme,
                    customColor: gridTheme === 'custom' ? gridColor : undefined,
                    snappingOptions: props.sketchViewModel?.snappingOptions || (view as any).snappingOptions || undefined,
                    visibleElements: {
                        colorSelection: false,
                        dynamicScaleToggle: false,
                        gridEnabledToggle: false,
                        numericInputs: false,
                        gridSnapEnabledToggle: false,
                        lineIntervalInput: false,
                        outOfScaleWarning: false,
                        placementButtons: false,
                        rotateWithMapToggle: false
                    }
                });

                // Store reference
                gridControlsRef.current = gridControls;

                // Initial grid state - enable if toggle is on
                if (gridControls.viewModel && gridEnabled) {
                    gridControls.viewModel.trySetDisplayEnabled(true);
                    gridControls.viewModel.dynamicScaling = gridSpacingMode === 'mapUnits' ? false : gridDynamicScale;
                    gridControls.viewModel.rotation = gridRotation;
                    gridControls.viewModel.spacing = gridSpacing;
                    gridControls.viewModel.snappingEnabled = gridSnapEnabled;
                    gridControls.viewModel.majorLineInterval = gridMajorLineInterval;
                    gridControls.viewModel.rotateWithMap = gridRotateWithMap;
                }

            } catch (error) {
                console.error('Error initializing GridControls:', error);
            }
        }

        // Cleanup on unmount
        return () => {
            if (gridControlsRef.current) {
                try {
                    // Disable grid before destroying
                    if (gridControlsRef.current.viewModel) {
                        gridControlsRef.current.viewModel.trySetDisplayEnabled(false);
                    }
                    gridControlsRef.current.destroy();
                } catch (error) {
                    console.warn('Error destroying GridControls:', error);
                }
                gridControlsRef.current = null;
            }
        };
    }, [props.jimuMapView, props.sketchViewModel]);

    // Effect 1: Enable or disable the grid display.
    // ONLY fires when gridEnabled changes — avoids re-calling trySetDisplayEnabled
    // on every property tweak, which resets the grid and discards pending changes.
    React.useEffect(() => {
        if (isSyncingRef.current) return;
        if (gridControlsRef.current?.viewModel) {
            try {
                gridControlsRef.current.viewModel.trySetDisplayEnabled(gridEnabled);
                if (!gridEnabled) {
                    gridControlsRef.current.viewModel.snappingEnabled = false;
                }
            } catch (error) {
                console.warn('Error toggling grid display:', error);
            }
        }
    }, [gridEnabled]);

    // Effect 2: Push property changes to the viewModel (only when grid is enabled).
    // This runs independently of trySetDisplayEnabled so property writes aren't
    // clobbered by an enable/disable cycle.
    React.useEffect(() => {
        if (!gridEnabled || isSyncingRef.current) return;
        const vm = gridControlsRef.current?.viewModel;
        if (!vm) return;

        try {
            // CRITICAL: Set dynamicScaling BEFORE spacing.
            // With dynamicScaling on, the engine internally scales the spacing value.
            // We must disable it first so our pixel value is used literally.
            vm.dynamicScaling = gridSpacingMode === 'mapUnits' ? false : gridDynamicScale;

            vm.rotation = gridRotation;
            vm.spacing = gridSpacing;
            vm.snappingEnabled = gridSnapEnabled;
            vm.majorLineInterval = gridMajorLineInterval;
            vm.rotateWithMap = gridRotateWithMap;
            gridControlsRef.current.theme = gridTheme;
            if (gridTheme === 'custom') {
                gridControlsRef.current.customColor = gridColor;
            }
        } catch (error) {
            console.warn('Error updating grid properties:', error);
        }
    }, [gridEnabled, gridRotation, gridSpacing, gridDynamicScale, gridSnapEnabled,
        gridMajorLineInterval, gridRotateWithMap, gridTheme, gridColor, gridSpacingMode, props.jimuMapView]);


    // Synchronize grid snapping with SketchViewModel snapping options
    React.useEffect(() => {
        if (gridControlsRef.current?.viewModel && props.sketchViewModel?.snappingOptions) {
            try {
                gridControlsRef.current.snappingOptions = props.sketchViewModel.snappingOptions;
            } catch (error) {
                console.warn('Error syncing grid snapping:', error);
            }
        }
    }, [gridSnapEnabled, gridEnabled, props.sketchViewModel?.snappingOptions]);

    // Grid placement: toggle interactive placement mode (place origin by clicking the map)
    React.useEffect(() => {
        const vm = gridControlsRef.current?.viewModel;
        if (!vm || !gridEnabled) {
            if (gridPlacementActive) setGridPlacementActive(false);
            return;
        }

        if (gridPlacementActive) {
            vm.interactivePlacementState = 'place';

            // Watch for the viewModel to finish placement (returns to 'interactive' after user clicks)
            const handle = vm.watch('interactivePlacementState', (state) => {
                if (state === 'interactive') {
                    setGridPlacementActive(false);
                }
            });

            return () => {
                handle?.remove();
                if (vm.interactivePlacementState === 'place') {
                    vm.interactivePlacementState = 'interactive';
                }
            };
        } else {
            if (vm.interactivePlacementState === 'place') {
                vm.interactivePlacementState = 'interactive';
            }
        }
    }, [gridPlacementActive, gridEnabled]);

    // ========================================================================
    // LINEAR UNIT-BASED GRID SPACING
    // ========================================================================

    /**
     * Convert a user-specified distance to the value to set on vm.spacing.
     *
     * Empirical testing shows vm.spacing maps 1:1 to measured feet:
     *   vm.spacing = 204.3  → measured 204.25 ft
     *   vm.spacing = 30.48  → measured 30.48 ft
     * This holds regardless of CRS (UTM 32612 / meters) and zoom level.
     *
     * So: convert the user's input to feet and set directly.
     */
    const convertToSpacingValue = React.useCallback((value: number, unit: 'feet' | 'meters' | 'yards'): number => {
        switch (unit) {
            case 'meters':
                return value * 3.28084;  // meters to feet
            case 'yards':
                return value * 3;        // yards to feet
            case 'feet':
            default:
                return value;
        }
    }, []);

    // Effect: In map-units mode, set vm.spacing directly.
    // No CRS conversion needed — vm.spacing empirically maps 1:1 to feet.
    React.useEffect(() => {
        if (gridSpacingMode !== 'mapUnits' || !gridEnabled) return;

        const spacingValue = convertToSpacingValue(gridMapUnitValue, gridMapUnit);

        if (spacingValue <= 0) return;

        const vm = gridControlsRef.current?.viewModel;
        if (!vm) return;

        vm.dynamicScaling = false;
        vm.spacing = spacingValue;

        setGridSpacing(spacingValue);
    }, [gridSpacingMode, gridMapUnitValue, gridMapUnit, gridEnabled, convertToSpacingValue]);

    return (
        <div
            className='drawToolbarDiv'
            role="region"
            aria-label={nls('snappingGridControls')}
        >
            {/* Live region for screen reader announcements */}
            <div
                ref={liveRegionRef}
                id={ids.liveRegion}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                style={srOnlyStyles}
            />

            {/* Wrapper with tooltip for CollapsableCheckbox */}
            <div
                title={enabled
                    ? nls('disableSnappingTitle')
                    : nls('enableSnappingTitle')}
            >
                <CollapsableCheckbox
                    label={nls(enabled ? 'disableSnapping' : 'enableSnapping')}
                    checked={enabled}
                    onCheckedChange={handleToggle}
                    disableActionForUnchecked
                    openForCheck
                    closeForUncheck
                    className='w-100'
                    aria-expanded={enabled}
                    aria-controls={ids.snappingPanel}
                    aria-describedby={ids.snappingInstructions}
                >
                    <div
                        id={ids.snappingPanel}
                        className='ml-3 my-1'
                        role="group"
                        aria-label={nls('snappingOptionsSettings')}
                    >
                        {/* Instructions list with accessibility */}
                        <ul
                            id={ids.snappingInstructions}
                            className='text-dark m-0 pl-3 small'
                            aria-label={nls('snappingInstructions')}
                        >
                            <li>
                                {nls('snappingModifierInstruction')}
                            </li>
                            <li>
                                {nls('snappingAlignmentInstruction')}
                            </li>
                        </ul>

                        {/* Loading state with accessibility */}
                        {isLoading && (
                            <p
                                className='text-info my-1'
                                role="status"
                                aria-busy="true"
                                aria-live="polite"
                            >
                                <span style={srOnlyStyles}>{nls('loading')}</span>
                                {nls('configuringSnapping')}
                            </p>
                        )}

                        {/* Error/Warning alert with accessibility */}
                        {error && (
                            <Alert
                                type='warning'
                                className='mt-2'
                                withIcon
                                text={error}
                                closable
                                role="alert"
                                aria-live="assertive"
                                aria-atomic="true"
                            />
                        )}

                        {/* Snapping status for screen readers */}
                        {enabled && !isLoading && !error && snapSourcesCount > 0 && (
                            <p
                                id={ids.snappingStatus}
                                style={srOnlyStyles}
                                role="status"
                            >
                                {nls('snappingActiveStatus', { count: snapSourcesCount })}
                            </p>
                        )}

                        {/* Grid Controls - Only show in 2D MapView and when snapping is enabled */}
                        {props.jimuMapView?.view?.type !== '2d' ? (
                            // Show info message if not in 2D view
                            <div
                                className='w-100 mt-3'
                                role="note"
                                aria-label={nls('gridUnavailableNotice')}
                            >
                                <Alert
                                    type='info'
                                    withIcon
                                    text={nls('grid2dOnly')}
                                    closable={false}
                                    role="status"
                                    aria-live="polite"
                                />
                            </div>
                        ) : (
                            // Show full grid controls if in 2D view
                            <div
                                className='mt-3'
                                role="region"
                                aria-label={nls('gridOverlayControls')}
                            >
                                {/* Wrapper with tooltip for Grid CollapsableCheckbox */}
                                <div
                                    title={gridEnabled
                                        ? nls('disableGridTitle')
                                        : nls('enableGridTitle')}
                                >
                                    <CollapsableCheckbox
                                        className='w-100'
                                        checked={gridEnabled}
                                        onCheckedChange={handleGridToggle}
                                        disableActionForUnchecked
                                        openForCheck
                                        closeForUncheck
                                        label={nls(gridEnabled ? 'disableGrid' : 'enableGrid')}
                                        aria-expanded={gridEnabled}
                                        aria-controls={ids.gridPanel}
                                    >
                                        <div
                                            id={ids.gridPanel}
                                            className='ml-3 my-1'
                                            role="group"
                                            aria-label={nls('gridConfigurationOptions')}
                                        >
                                            {/* Grid status for screen readers */}
                                            <div
                                                id={ids.gridStatus}
                                                style={srOnlyStyles}
                                                role="status"
                                            >
                                                {gridEnabled
                                                    ? nls('gridEnabledStatus', { theme: nls(`gridTheme${gridTheme.charAt(0).toUpperCase()}${gridTheme.slice(1)}`), spacing: gridSpacingMode === 'mapUnits' ? nls('gridSpacingUnitValue', { value: gridMapUnitValue, unit: gridMapUnit }) : nls('gridSpacingValue', { value: gridSpacing }), rotation: gridRotation })
                                                    : nls('gridDisabledStatus')}
                                            </div>

                                            {gridEnabled && (
                                                <div
                                                    className='d-flex flex-column'
                                                    role="form"
                                                    aria-label={nls('gridSettingsForm')}
                                                >
                                                    {/* Grid Theme Selection */}
                                                    <div className='mb-2'>
                                                        <label
                                                            id={ids.gridThemeLabel}
                                                            htmlFor={ids.gridThemeSelect}
                                                            className='d-flex flex-column'
                                                        >
                                                            <span
                                                                className='mb-1'
                                                                style={{ fontSize: '12px' }}
                                                            >
                                                                {nls('gridTheme')}
                                                            </span>
                                                            <Select
                                                                id={ids.gridThemeSelect}
                                                                size='sm'
                                                                style={{ width: '100%' }}
                                                                value={gridTheme}
                                                                onChange={(e) => {
                                                                    const newTheme = e.target.value as 'light' | 'dark' | 'custom';
                                                                    setGridTheme(newTheme);
                                                                    announce(nls('gridThemeChanged', { theme: newTheme }), 'polite');
                                                                }}
                                                                aria-labelledby={ids.gridThemeLabel}
                                                                aria-describedby={ids.gridThemeDesc}
                                                                title={nls('gridThemeTitle')}
                                                            >
                                                                <Option value='light'>{nls('gridThemeLight')}</Option>
                                                                <Option value='dark'>{nls('gridThemeDark')}</Option>
                                                                <Option value='custom'>{nls('gridThemeCustom')}</Option>
                                                            </Select>
                                                        </label>
                                                        <span
                                                            id={ids.gridThemeDesc}
                                                            style={srOnlyStyles}
                                                        >
                                                            {nls('gridThemeDescription')}
                                                        </span>
                                                    </div>

                                                    {/* Custom Color Picker */}
                                                    {gridTheme === 'custom' && (
                                                        <div className='mb-2'>
                                                            <label
                                                                id={ids.gridColorLabel}
                                                                htmlFor={ids.gridColorPicker}
                                                                className='d-flex flex-column'
                                                            >
                                                                <span
                                                                    className='mb-1'
                                                                    style={{ fontSize: '12px' }}
                                                                >
                                                                    {nls('gridColor')}
                                                                </span>
                                                                <div title={nls('gridColorTitle')}>
                                                                    <ColorPicker
                                                                        color={gridColor}
                                                                        onChange={(color) => {
                                                                            setGridColor(color);
                                                                            announce(nls('gridColorChanged'), 'polite');
                                                                        }}
                                                                        aria-labelledby={ids.gridColorLabel}
                                                                    />
                                                                </div>
                                                            </label>
                                                        </div>
                                                    )}

                                                    {/* Set Grid Origin Button */}
                                                    <div className='mb-2'>
                                                        <span
                                                            className='mb-1 d-block'
                                                            style={{ fontSize: '12px' }}
                                                        >
                                                            {nls('gridOrigin')}
                                                        </span>
                                                        <button
                                                            id={ids.gridPlacementButton}
                                                            type="button"
                                                            className={`btn btn-sm w-100 ${gridPlacementActive ? 'btn-primary' : 'btn-secondary'}`}
                                                            onClick={() => {
                                                                const newState = !gridPlacementActive;
                                                                setGridPlacementActive(newState);
                                                                announce(
                                                                    newState
                                                                        ? nls('gridPlacementActivated')
                                                                        : nls('gridPlacementDeactivated'),
                                                                    'polite'
                                                                );
                                                            }}
                                                            title={gridPlacementActive
                                                                ? nls('gridPlacementButtonTitleActive')
                                                                : nls('gridPlacementButtonTitleInactive')}
                                                            aria-pressed={gridPlacementActive}
                                                            aria-describedby={ids.gridPlacementDesc}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                gap: '6px',
                                                                border: '1px solid var(--light-500)',
                                                                borderRadius: '2px'
                                                            }}
                                                        >
                                                            <svg
                                                                width='14'
                                                                height='14'
                                                                viewBox='0 0 16 16'
                                                                fill='currentColor'
                                                                aria-hidden="true"
                                                                focusable="false"
                                                            >
                                                                <path d='M8 0L7 1v6H1l-1 1 1 1h6v6l1 1 1-1V9h6l1-1-1-1H9V1L8 0z' />
                                                            </svg>
                                                            {nls(gridPlacementActive ? 'gridPlacementActive' : 'gridPlacementInactive')}
                                                        </button>
                                                        <span id={ids.gridPlacementDesc} style={srOnlyStyles}>
                                                            {nls('gridPlacementDescription')}
                                                        </span>
                                                    </div>

                                                    {/* Grid Spacing Mode Selector */}
                                                    <div className='mb-2'>
                                                        <label
                                                            id={ids.gridSpacingModeLabel}
                                                            htmlFor={ids.gridSpacingModeSelect}
                                                            className='d-flex flex-column'
                                                        >
                                                            <span
                                                                className='mb-1'
                                                                style={{ fontSize: '12px' }}
                                                            >
                                                                {nls('spacingMode')}
                                                            </span>
                                                            <Select
                                                                id={ids.gridSpacingModeSelect}
                                                                size='sm'
                                                                style={{ width: '100%' }}
                                                                value={gridSpacingMode}
                                                                onChange={(e) => {
                                                                    const newMode = e.target.value as 'pixels' | 'mapUnits';
                                                                    setGridSpacingMode(newMode);
                                                                    announce(nls('gridSpacingModeChanged', { mode: newMode === 'pixels' ? nls('pixelsScreen') : nls('mapUnitsLinear') }), 'polite');
                                                                }}
                                                                aria-labelledby={ids.gridSpacingModeLabel}
                                                                aria-describedby={ids.gridSpacingModeDesc}
                                                                title={nls('spacingModeTitle')}
                                                            >
                                                                <Option value='pixels'>{nls('pixelsScreen')}</Option>
                                                                <Option value='mapUnits'>{nls('mapUnitsLinear')}</Option>
                                                            </Select>
                                                        </label>
                                                        <span
                                                            id={ids.gridSpacingModeDesc}
                                                            style={srOnlyStyles}
                                                        >
                                                            {nls('spacingModeDescription')}
                                                        </span>
                                                    </div>

                                                    {/* Grid Spacing - Pixel mode */}
                                                    {gridSpacingMode === 'pixels' && (
                                                        <div className='mb-2'>
                                                            <label
                                                                id={ids.gridSpacingLabel}
                                                                className='d-flex flex-column'
                                                            >
                                                                <span
                                                                    className='mb-1'
                                                                    style={{ fontSize: '12px' }}
                                                                >
                                                                    {nls('gridSpacingPixels')}
                                                                </span>
                                                                <div
                                                                    className='d-flex align-items-center'
                                                                    role="group"
                                                                    aria-labelledby={ids.gridSpacingLabel}
                                                                >
                                                                    <div
                                                                        className='flex-grow-1 mr-2'
                                                                        title={nls('gridSpacingSliderTitle', { value: gridSpacing })}
                                                                    >
                                                                        <Slider
                                                                            id={ids.gridSpacingSlider}
                                                                            value={gridSpacing}
                                                                            onChange={(e) => {
                                                                                const newValue = Number(e.target.value);
                                                                                setGridSpacing(newValue);
                                                                                announce(nls('gridSpacingValue', { value: newValue }), 'polite');
                                                                            }}
                                                                            min={10}
                                                                            max={200}
                                                                            step={5}
                                                                            aria-label={nls('gridSpacingValue', { value: gridSpacing })}
                                                                            aria-valuemin={10}
                                                                            aria-valuemax={200}
                                                                            aria-valuenow={gridSpacing}
                                                                            aria-valuetext={nls('gridSpacingValue', { value: gridSpacing })}
                                                                            aria-describedby={ids.gridSpacingDesc}
                                                                        />
                                                                    </div>
                                                                    <NumericInput
                                                                        id={ids.gridSpacingInput}
                                                                        size='sm'
                                                                        value={gridSpacing}
                                                                        onChange={(value) => {
                                                                            setGridSpacing(value);
                                                                            announce(nls('gridSpacingSet', { value }), 'polite');
                                                                        }}
                                                                        min={10}
                                                                        max={200}
                                                                        step={5}
                                                                        style={{ width: '70px' }}
                                                                        aria-label={nls('gridSpacingPixelsAria')}
                                                                        aria-describedby={ids.gridSpacingDesc}
                                                                        title={nls('gridSpacingPixelsTitle')}
                                                                    />
                                                                </div>
                                                            </label>
                                                            <span id={ids.gridSpacingDesc} style={srOnlyStyles}>
                                                                {nls('gridSpacingPixelsDescription')}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Grid Spacing - Map Units mode */}
                                                    {gridSpacingMode === 'mapUnits' && (
                                                        <div className='mb-2'>
                                                            {/* Unit type selector */}
                                                            <label
                                                                id={ids.gridMapUnitLabel}
                                                                htmlFor={ids.gridMapUnitSelect}
                                                                className='d-flex flex-column mb-1'
                                                            >
                                                                <span
                                                                    className='mb-1'
                                                                    style={{ fontSize: '12px' }}
                                                                >
                                                                    {nls('gridUnit')}
                                                                </span>
                                                                <Select
                                                                    id={ids.gridMapUnitSelect}
                                                                    size='sm'
                                                                    style={{ width: '100%' }}
                                                                    value={gridMapUnit}
                                                                    onChange={(e) => {
                                                                        const newUnit = e.target.value as 'feet' | 'meters' | 'yards';
                                                                        setGridMapUnit(newUnit);
                                                                        announce(nls('gridUnitChanged', { unit: newUnit }), 'polite');
                                                                    }}
                                                                    aria-labelledby={ids.gridMapUnitLabel}
                                                                    title={nls('gridUnitTitle')}
                                                                >
                                                                    <Option value='feet'>{nls('feet')}</Option>
                                                                    <Option value='meters'>{nls('meters')}</Option>
                                                                    <Option value='yards'>{nls('yards')}</Option>
                                                                </Select>
                                                            </label>

                                                            {/* Distance value input */}
                                                            <label
                                                                id={ids.gridMapUnitValueLabel}
                                                                className='d-flex flex-column'
                                                            >
                                                                <span
                                                                    className='mb-1'
                                                                    style={{ fontSize: '12px' }}
                                                                >
                                                                    {nls('gridSpacingMapUnit', { unit: nls(gridMapUnit) })}
                                                                </span>
                                                                <NumericInput
                                                                    id={ids.gridMapUnitValueInput}
                                                                    size='sm'
                                                                    value={gridMapUnitValue}
                                                                    onChange={(value) => {
                                                                        if (value != null && value > 0) {
                                                                            setGridMapUnitValue(value);
                                                                            announce(nls('gridSpacingSetToMapUnit', { value, unit: gridMapUnit }), 'polite');
                                                                        }
                                                                    }}
                                                                    min={1}
                                                                    max={50000}
                                                                    step={gridMapUnit === 'meters' ? 10 : gridMapUnit === 'feet' ? 25 : 10}
                                                                    style={{ width: '100%' }}
                                                                    showHandlers={true}
                                                                    aria-label={nls('gridSpacingMapUnitAria', { unit: nls(gridMapUnit) })}
                                                                    aria-describedby={ids.gridMapUnitValueDesc}
                                                                    title={nls('gridSpacingMapUnitTitle', { unit: nls(gridMapUnit) })}
                                                                />
                                                            </label>

                                                            {/* Spacing info */}
                                                            <span id={ids.gridMapUnitValueDesc} style={srOnlyStyles}>
                                                                {nls('gridSpacingMapUnitDescription')}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Grid Rotation */}
                                                    <div className='mb-2'>
                                                        <label
                                                            id={ids.gridRotationLabel}
                                                            className='d-flex flex-column'
                                                        >
                                                            <span
                                                                className='mb-1'
                                                                style={{ fontSize: '12px' }}
                                                            >
                                                                {nls('gridRotation')}
                                                            </span>
                                                            <div
                                                                className='d-flex align-items-center'
                                                                role="group"
                                                                aria-labelledby={ids.gridRotationLabel}
                                                            >
                                                                <div
                                                                    className='flex-grow-1 mr-2'
                                                                    title={nls('gridRotationSliderTitle', { value: gridRotation })}
                                                                >
                                                                    <Slider
                                                                        id={ids.gridRotationSlider}
                                                                        value={gridRotation}
                                                                        onChange={(e) => {
                                                                            let value = Number(e.target.value);
                                                                            // Normalize to 0-360 range
                                                                            value = value % 360;
                                                                            if (value < 0) value += 360;
                                                                            setGridRotation(value);
                                                                            announce(nls('gridRotationValue', { value }), 'polite');
                                                                        }}
                                                                        min={0}
                                                                        max={360}
                                                                        step={5}
                                                                        aria-label={nls('gridRotationValue', { value: gridRotation })}
                                                                        aria-valuemin={0}
                                                                        aria-valuemax={360}
                                                                        aria-valuenow={gridRotation}
                                                                        aria-valuetext={nls('gridRotationValueDegrees', { value: gridRotation })}
                                                                        aria-describedby={ids.gridRotationDesc}
                                                                    />
                                                                </div>
                                                                <NumericInput
                                                                    id={ids.gridRotationInput}
                                                                    size='sm'
                                                                    value={gridRotation}
                                                                    onChange={(value) => {
                                                                        // Normalize to 0-360 range
                                                                        let normalized = value % 360;
                                                                        if (normalized < 0) normalized += 360;
                                                                        setGridRotation(normalized);
                                                                        announce(nls('gridRotationSet', { value: normalized }), 'polite');
                                                                    }}
                                                                    min={0}
                                                                    max={360}
                                                                    step={5}
                                                                    style={{ width: '70px' }}
                                                                    aria-label={nls('gridRotationAria')}
                                                                    aria-describedby={ids.gridRotationDesc}
                                                                    title={nls('gridRotationTitle')}
                                                                />
                                                            </div>
                                                        </label>
                                                        <span id={ids.gridRotationDesc} style={srOnlyStyles}>
                                                            {nls('gridRotationDescription')}
                                                        </span>
                                                    </div>

                                                    {/* Major Line Interval */}
                                                    <div className='mb-2'>
                                                        <label
                                                            id={ids.gridMajorLineLabel}
                                                            className='d-flex flex-column'
                                                        >
                                                            <span
                                                                className='mb-1'
                                                                style={{ fontSize: '12px' }}
                                                            >
                                                                {nls('majorLineInterval')}
                                                            </span>
                                                            <div
                                                                className='d-flex align-items-center'
                                                                role="group"
                                                                aria-labelledby={ids.gridMajorLineLabel}
                                                            >
                                                                <div
                                                                    className='flex-grow-1 mr-2'
                                                                    title={nls('gridMajorLineSliderTitle', { value: gridMajorLineInterval })}
                                                                >
                                                                    <Slider
                                                                        id={ids.gridMajorLineSlider}
                                                                        value={gridMajorLineInterval}
                                                                        onChange={(e) => {
                                                                            const newValue = Number(e.target.value);
                                                                            setGridMajorLineInterval(newValue);
                                                                            announce(nls('majorLineIntervalValue', { value: newValue }), 'polite');
                                                                        }}
                                                                        min={1}
                                                                        max={10}
                                                                        step={1}
                                                                        aria-label={nls('majorLineIntervalValue', { value: gridMajorLineInterval })}
                                                                        aria-valuemin={1}
                                                                        aria-valuemax={10}
                                                                        aria-valuenow={gridMajorLineInterval}
                                                                        aria-valuetext={nls('majorLineIntervalEvery', { value: gridMajorLineInterval })}
                                                                        aria-describedby={ids.gridMajorLineDesc}
                                                                    />
                                                                </div>
                                                                <NumericInput
                                                                    id={ids.gridMajorLineInput}
                                                                    size='sm'
                                                                    value={gridMajorLineInterval}
                                                                    onChange={(value) => {
                                                                        setGridMajorLineInterval(value);
                                                                        announce(nls('majorLineIntervalSet', { value }), 'polite');
                                                                    }}
                                                                    min={1}
                                                                    max={10}
                                                                    step={1}
                                                                    style={{ width: '70px' }}
                                                                    aria-label={nls('majorLineIntervalAria')}
                                                                    aria-describedby={ids.gridMajorLineDesc}
                                                                    title={nls('majorLineIntervalTitle')}
                                                                />
                                                            </div>
                                                        </label>
                                                        <span id={ids.gridMajorLineDesc} style={srOnlyStyles}>
                                                            {nls('majorLineIntervalDescription')}
                                                        </span>
                                                    </div>

                                                    {/* Grid Options Toggles */}
                                                    <fieldset
                                                        className='d-flex flex-column mt-2'
                                                        style={{ border: 'none', padding: 0, margin: 0 }}
                                                    >
                                                        <legend style={srOnlyStyles}>{nls('gridBehaviorOptions')}</legend>

                                                        {/* Dynamic Scaling Toggle — hidden in map-units mode (forced off) */}
                                                        {gridSpacingMode !== 'mapUnits' && (
                                                            <div className='mb-1'>
                                                                <label
                                                                    className='d-flex align-items-center'
                                                                    style={{ cursor: 'pointer' }}
                                                                    title={nls(gridDynamicScale ? 'dynamicScalingEnabledTitle' : 'dynamicScalingDisabledTitle')}
                                                                >
                                                                    <Switch
                                                                        id={ids.gridDynamicScaleSwitch}
                                                                        checked={gridDynamicScale}
                                                                        onChange={() => {
                                                                            const newValue = !gridDynamicScale;
                                                                            setGridDynamicScale(newValue);
                                                                            announce(nls('dynamicScalingStatus', { status: newValue ? nls('enabled') : nls('disabled') }), 'polite');
                                                                        }}
                                                                        className='mr-2'
                                                                        size='sm'
                                                                        role="switch"
                                                                        aria-checked={gridDynamicScale}
                                                                        aria-describedby={ids.gridDynamicScaleDesc}
                                                                    />
                                                                    <span style={{ fontSize: '12px' }}>{nls('dynamicScaling')}</span>
                                                                </label>
                                                                <span id={ids.gridDynamicScaleDesc} style={srOnlyStyles}>
                                                                    {nls('dynamicScalingDescription')}
                                                                </span>
                                                            </div>
                                                        )}

                                                        {/* Snap to Grid Toggle */}
                                                        <div className='mb-1'>
                                                            <label
                                                                className='d-flex align-items-center'
                                                                style={{ cursor: 'pointer' }}
                                                                title={nls(gridSnapEnabled ? 'snapToGridEnabledTitle' : 'snapToGridDisabledTitle')}
                                                            >
                                                                <Switch
                                                                    id={ids.gridSnapSwitch}
                                                                    checked={gridSnapEnabled}
                                                                    onChange={() => {
                                                                        const newValue = !gridSnapEnabled;
                                                                        setGridSnapEnabled(newValue);
                                                                        announce(nls('snapToGridStatus', { status: newValue ? nls('enabled') : nls('disabled') }), 'polite');
                                                                    }}
                                                                    className='mr-2'
                                                                    size='sm'
                                                                    role="switch"
                                                                    aria-checked={gridSnapEnabled}
                                                                    aria-describedby={ids.gridSnapDesc}
                                                                />
                                                                <span style={{ fontSize: '12px' }}>{nls('snapToGrid')}</span>
                                                            </label>
                                                            <span id={ids.gridSnapDesc} style={srOnlyStyles}>
                                                                {nls('snapToGridDescription')}
                                                            </span>
                                                        </div>

                                                        {/* Rotate with Map Toggle */}
                                                        <div className='mb-1'>
                                                            <label
                                                                className='d-flex align-items-center'
                                                                style={{ cursor: 'pointer' }}
                                                                title={nls(gridRotateWithMap ? 'rotateWithMapEnabledTitle' : 'rotateWithMapDisabledTitle')}
                                                            >
                                                                <Switch
                                                                    id={ids.gridRotateMapSwitch}
                                                                    checked={gridRotateWithMap}
                                                                    onChange={() => {
                                                                        const newValue = !gridRotateWithMap;
                                                                        setGridRotateWithMap(newValue);
                                                                        announce(nls('rotateWithMapStatus', { status: newValue ? nls('enabled') : nls('disabled') }), 'polite');
                                                                    }}
                                                                    className='mr-2'
                                                                    size='sm'
                                                                    role="switch"
                                                                    aria-checked={gridRotateWithMap}
                                                                    aria-describedby={ids.gridRotateMapDesc}
                                                                />
                                                                <span style={{ fontSize: '12px' }}>{nls('rotateWithMap')}</span>
                                                            </label>
                                                            <span id={ids.gridRotateMapDesc} style={srOnlyStyles}>
                                                                {nls('rotateWithMapDescription')}
                                                            </span>
                                                        </div>
                                                    </fieldset>
                                                </div>
                                            )}
                                        </div>
                                    </CollapsableCheckbox>
                                </div>
                            </div>
                        )}
                    </div>
                </CollapsableCheckbox>
            </div>
        </div>
    );
};