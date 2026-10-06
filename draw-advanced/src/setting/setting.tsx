import { React, defaultMessages as jimuCoreMessages } from 'jimu-core';
import { AllWidgetSettingProps } from 'jimu-for-builder';
import { IMConfig, Config, DrawMode, StorageScope } from '../config';
import defaultMessages from './translations/default';
import { MapWidgetSelector, SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components';
import { Select, Option, defaultMessages as jimuUIDefaultMessages, Checkbox, TextInput, TextArea, Label, Button, Alert, Switch, NumericInput, Tooltip } from 'jimu-ui'
import { SidePopper } from 'jimu-ui/advanced/setting-components'
import { ColorPicker } from 'jimu-ui/basic/color-picker'
import UnitMaker from './components/unitMaker';

// ============================================================================
// Types
// ============================================================================

interface Unit {
    unit: string;
    label: string;
    labelKey?: string;
    abbreviation: string;
    conversion: number;
}

const toMutableUnits = (value: any): Unit[] => {
    if (!value) return []
    if (typeof value.asMutable === 'function') return value.asMutable({ deep: true }) as Unit[]
    return Array.isArray(value) ? [...value] as Unit[] : []
}

interface SettingState {
    linearSidePopper: boolean;
    areaSidePopper: boolean;
    defaultDistanceUnit: any;
    defaultAreaUnit: any;
    availableDistanceUnits: Unit[];
    availableAreaUnits: Unit[];
    detectedWidgets: Array<{ id: string; label: string }>;
    scanning: boolean;
    scanMessage: string;
    exportXml: string;
    importXml: string;
    importError: string;
    importSuccess: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const defaultDistanceUnits: Unit[] = [
    { unit: 'kilometers', label: 'Kilometers', labelKey: 'settingUnitKilometers', abbreviation: 'km', conversion: 0.001 },
    { unit: 'miles', label: 'Miles', labelKey: 'settingUnitMiles', abbreviation: 'mi', conversion: 0.000621371 },
    { unit: 'meters', label: 'Meters', labelKey: 'settingUnitMeters', abbreviation: 'm', conversion: 1 },
    { unit: 'nautical-miles', label: 'Nautical Miles', labelKey: 'settingUnitNauticalMiles', abbreviation: 'NM', conversion: 0.000539957 },
    { unit: 'feet', label: 'Feet', labelKey: 'settingUnitFeet', abbreviation: 'ft', conversion: 3.28084 },
    { unit: 'yards', label: 'Yards', labelKey: 'settingUnitYards', abbreviation: 'yd', conversion: 1.09361 }
];

const defaultAreaUnits: Unit[] = [
    { unit: 'square-kilometers', label: 'Square Kilometers', labelKey: 'settingUnitSquareKilometers', abbreviation: 'km\xb2', conversion: 0.000001 },
    { unit: 'square-miles', label: 'Square Miles', labelKey: 'settingUnitSquareMiles', abbreviation: 'mi\xb2', conversion: 3.86102e-7 },
    { unit: 'acres', label: 'Acres', labelKey: 'settingUnitAcres', abbreviation: 'ac', conversion: 0.000247105 },
    { unit: 'hectares', label: 'Hectares', labelKey: 'settingUnitHectares', abbreviation: 'ha', conversion: 0.0001 },
    { unit: 'square-meters', label: 'Square Meters', labelKey: 'settingUnitSquareMeters', abbreviation: 'm\xb2', conversion: 1 },
    { unit: 'square-feet', label: 'Square Feet', labelKey: 'settingUnitSquareFeet', abbreviation: 'ft\xb2', conversion: 10.7639 },
    { unit: 'square-yards', label: 'Square Yards', labelKey: 'settingUnitSquareYards', abbreviation: 'yd\xb2', conversion: 1.19599 }
];

const DRAW_TOOLS: Array<{ key: keyof Config; labelKey: string; icon: string; descKey: string }> = [
    { key: 'enablePointTool', labelKey: 'settingToolPoint', icon: '\u25CF', descKey: 'settingToolPointDescription' },
    { key: 'enablePolylineTool', labelKey: 'settingToolPolyline', icon: '\u2571', descKey: 'settingToolPolylineDescription' },
    { key: 'enableFreePolylineTool', labelKey: 'settingToolFreehandLine', icon: '\u223F', descKey: 'settingToolFreehandLineDescription' },
    { key: 'enableTextTool', labelKey: 'settingToolText', icon: 'T', descKey: 'settingToolTextDescription' },
    { key: 'enableRectangleTool', labelKey: 'settingToolRectangle', icon: '\u25AD', descKey: 'settingToolRectangleDescription' },
    { key: 'enablePolygonTool', labelKey: 'settingToolPolygon', icon: '\u2B20', descKey: 'settingToolPolygonDescription' },
    { key: 'enableFreePolygonTool', labelKey: 'settingToolFreehandPolygon', icon: '\u25CC', descKey: 'settingToolFreehandPolygonDescription' },
    { key: 'enableCircleTool', labelKey: 'settingToolCircle', icon: '\u25CB', descKey: 'settingToolCircleDescription' },
    { key: 'enableTriangleTool', labelKey: 'settingToolTriangle', icon: '\u25B3', descKey: 'settingToolTriangleDescription' },
    { key: 'enableCurveTools', labelKey: 'settingToolCurveTools', icon: '\u2312', descKey: 'settingToolCurveToolsDescription' }
];

// ============================================================================
// Styles
// ============================================================================

const s = {
    toggleRow: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '6px 0'
    } as React.CSSProperties,
    toggleLabel: { margin: 0, fontSize: '13px', fontWeight: 500 } as React.CSSProperties,
    sub: { fontSize: '11px', color: 'var(--calcite-color-text-2, #6c757d)', margin: '2px 0 0 0', lineHeight: '1.4' } as React.CSSProperties,
    sectionDesc: { fontSize: '12px', color: 'var(--calcite-color-text-2, #6c757d)', margin: '0 0 8px 0', lineHeight: '1.4' } as React.CSSProperties,
    checkRow: { display: 'flex', alignItems: 'center', padding: '4px 0' } as React.CSSProperties,
    checkLabel: { marginLeft: '6px', fontSize: '13px' } as React.CSSProperties,
    divider: { borderTop: '1px solid var(--calcite-color-border-3, #e8e8e8)', margin: '8px 0' } as React.CSSProperties,
    indent: { paddingLeft: '12px', borderLeft: '3px solid var(--calcite-color-border-3, #e0e0e0)', marginTop: '6px' } as React.CSSProperties,
    toolGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', padding: '4px 0' } as React.CSSProperties,
    toolIcon: { display: 'inline-block', width: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--calcite-color-text-2, #666)', marginRight: '2px' } as React.CSSProperties,
    quickBtns: { display: 'flex', gap: '6px', marginBottom: '6px' } as React.CSSProperties,
    fieldLabel: { display: 'block', fontSize: '13px', fontWeight: 500, margin: '0 0 4px 0' } as React.CSSProperties,
    fieldRow: { width: '100%', padding: '4px 0' } as React.CSSProperties,
};

// ============================================================================
// Component
// ============================================================================

type SettingProps = AllWidgetSettingProps<IMConfig> & {
    id: string;
    useMapWidgetIds?: string[];
    useDataSources?: any[];
    [key: string]: any;
};

export default class Setting extends React.PureComponent<SettingProps, SettingState> {
    declare props: SettingProps;
    declare state: SettingState;
    declare setState: any;
    declare forceUpdate: any;
    constructor(props) {
        super(props)
        this.state = {
            linearSidePopper: false,
            areaSidePopper: false,
            defaultDistanceUnit: this.props.config.defaultDistance,
            defaultAreaUnit: this.props.config.defaultArea,
            availableDistanceUnits: [...defaultDistanceUnits, ...toMutableUnits(this.props.config.userDistances)],
            availableAreaUnits: [...defaultAreaUnits, ...toMutableUnits(this.props.config.userAreas)],
            detectedWidgets: [],
            scanning: false,
            scanMessage: '',
            exportXml: '',
            importXml: '',
            importError: '',
            importSuccess: false
        }
    }

    // Hidden file input used by the settings XML import
    private fileInputRef = React.createRef<HTMLInputElement>();

    // ========================================================================
    // Config helpers
    // ========================================================================

    formatMessage = (id: string, values?: Record<string, any>) => {
        return this.props.intl
            ? this.props.intl.formatMessage({ id: id, defaultMessage: defaultMessages[id] || id }, values)
            : id
    }

    onPropertyChange = (name: keyof Config, value: any) => {
        const { config } = this.props
        if (value === config[name]) return
        this.props.onSettingChange({ id: this.props.id, config: config.set(name, value) })
    }

    onMapWidgetSelected = (useMapWidgetsId: string[]) => {
        this.props.onSettingChange({ id: this.props.id, useMapWidgetIds: useMapWidgetsId });
    }

    setConfig = (key: keyof Config, value: any) => {
        this.props.onSettingChange({ id: this.props.id, config: this.props.config.set(key, value) })
    }

    setConfigBatch = (updates: Partial<Config>) => {
        let cfg = this.props.config;
        for (const [key, value] of Object.entries(updates) as Array<[keyof Config, Config[keyof Config]]>) {
            cfg = cfg.set(key, value as any) as any;
        }
        this.props.onSettingChange({ id: this.props.id, config: cfg });
    }

    toggleConfig = (key: keyof Config) => {
        this.setConfig(key, !this.props.config[key])
    }

    // ========================================================================
    // Settings import / export (XML) — transfer config between applications
    // ========================================================================

    private escapeXml = (str: string): string =>
        String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')

    /** Serialize the entire widget config to a portable XML document. */
    generateSettingsXml = (): string => {
        const cfg: any = (this.props.config as any)?.asMutable
            ? (this.props.config as any).asMutable({ deep: true })
            : { ...(this.props.config as any) }

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        xml += '<DrawAdvancedSettings version="4.2.0">\n'
        Object.keys(cfg || {}).sort().forEach((key) => {
            const value = cfg[key]
            if (value === undefined || value === null) return
            let type = 'string'
            let text = ''
            if (typeof value === 'boolean') { type = 'boolean'; text = value ? 'true' : 'false' }
            else if (typeof value === 'number') { type = 'number'; text = String(value) }
            else if (typeof value === 'object') { type = 'json'; text = JSON.stringify(value) }
            else { type = 'string'; text = String(value) }
            xml += `  <setting key="${this.escapeXml(key)}" type="${type}">${this.escapeXml(text)}</setting>\n`
        })
        xml += '</DrawAdvancedSettings>'
        return xml
    }

    /** Parse the XML document into a flat key→value map, coercing by declared type. */
    private unescapeXml = (str: string): string =>
        String(str)
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&')

    parseSettingsXml = (xmlString: string): Record<string, any> | null => {
        try {
            if (typeof xmlString !== 'string' || xmlString.indexOf('<DrawAdvancedSettings') === -1) return null

            // Only import keys that already exist in the current config. This
            // both hardens the import (no arbitrary keys) and keeps the parse a
            // plain text scan rather than routing untrusted text through a DOM
            // parser, which is reported as a DOM-based XSS sink.
            const cfg: any = (this.props.config as any)?.asMutable
                ? (this.props.config as any).asMutable({ deep: true })
                : { ...(this.props.config as any) }
            const allowed = new Set(Object.keys(cfg || {}))

            const out: Record<string, any> = {}
            const settingRe = /<setting\b([^>]*)>([\s\S]*?)<\/setting>/g
            const keyRe = /\bkey\s*=\s*"([^"]*)"/
            const typeRe = /\btype\s*=\s*"([^"]*)"/
            let m: RegExpExecArray | null
            while ((m = settingRe.exec(xmlString)) !== null) {
                const attrs = m[1] || ''
                const keyMatch = keyRe.exec(attrs)
                if (!keyMatch) continue
                const key = this.unescapeXml(keyMatch[1])
                if (!allowed.has(key)) continue
                const type = (typeRe.exec(attrs)?.[1]) || 'string'
                const raw = this.unescapeXml(m[2] ?? '')
                try {
                    if (type === 'boolean') out[key] = raw.trim() === 'true'
                    else if (type === 'number') { const n = Number(raw); if (!isNaN(n)) out[key] = n }
                    else if (type === 'json') out[key] = JSON.parse(raw)
                    else out[key] = raw
                } catch { /* skip malformed entry */ }
            }
            return Object.keys(out).length > 0 ? out : null
        } catch {
            return null
        }
    }

    handleGenerateExport = () => {
        this.setState({ exportXml: this.generateSettingsXml() })
    }

    handleCopyExport = () => {
        try { navigator.clipboard?.writeText(this.state.exportXml || this.generateSettingsXml()) } catch { /* no-op */ }
    }

    handleDownloadExport = () => {
        const xml = this.state.exportXml || this.generateSettingsXml()
        const blob = new Blob([xml], { type: 'application/xml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'draw-advanced-settings.xml'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (event) => {
            this.setState({ importXml: (event.target?.result as string) || '', importError: '', importSuccess: false })
        }
        reader.onerror = () => this.setState({ importError: this.formatMessage('settingImportReadError') })
        reader.readAsText(file)
        if (this.fileInputRef.current) this.fileInputRef.current.value = ''
    }

    handleApplyImport = () => {
        const text = (this.state.importXml || '').trim()
        if (!text) { this.setState({ importError: this.formatMessage('settingImportEmptyError'), importSuccess: false }); return }
        const parsed = this.parseSettingsXml(text)
        if (!parsed) { this.setState({ importError: this.formatMessage('settingImportParseError'), importSuccess: false }); return }

        let cfg = this.props.config
        for (const [key, value] of Object.entries(parsed)) {
            cfg = cfg.set(key as keyof Config, value as any) as any
        }
        this.props.onSettingChange({ id: this.props.id, config: cfg })

        // Refresh local state derived from config so the unit pickers reflect the import.
        const importedUserDistances = toMutableUnits(cfg.userDistances)
        const importedUserAreas = toMutableUnits(cfg.userAreas)
        this.setState({
            importError: '',
            importSuccess: true,
            importXml: '',
            defaultDistanceUnit: cfg.defaultDistance,
            defaultAreaUnit: cfg.defaultArea,
            availableDistanceUnits: [...defaultDistanceUnits, ...importedUserDistances],
            availableAreaUnits: [...defaultAreaUnits, ...importedUserAreas]
        })
        setTimeout(() => this.setState({ importSuccess: false }), 4000)
    }

    componentDidMount() {
        if (this.props.config.storageScope === undefined) {
            this.setConfig('storageScope', StorageScope.APP_SPECIFIC)
        }
    }

    // ========================================================================
    // Specific handlers
    // ========================================================================

    handleDrawModeChange = (evt) => { this.onPropertyChange('creationMode', evt?.target?.value) }
    handleTitle = (value) => { this.setConfig('title', value) }

    handleDefaultDistance = (value) => {
        this.setConfig('defaultDistance', value)
        this.setState({ defaultDistanceUnit: value })
    }

    handleDefaultArea = (value) => {
        this.setConfig('defaultArea', value)
        this.setState({ defaultAreaUnit: value })
    }

    handleStorageScopeChange = (evt) => {
        this.setConfig('storageScope', evt?.target?.value as StorageScope)
    }

    handleAddUnit = (newUnit: Unit, type: 'linear' | 'area') => {
        if (type === 'linear') {
            const userDistances = toMutableUnits(this.props.config.userDistances)
            const updatedDistances = [...userDistances, newUnit]
            this.props.onSettingChange({ id: this.props.id, config: this.props.config.set('userDistances', updatedDistances) })
            this.setState({ availableDistanceUnits: [...defaultDistanceUnits, ...updatedDistances], defaultDistanceUnit: null })
        } else {
            const userAreas = toMutableUnits(this.props.config.userAreas)
            const updatedAreas = [...userAreas, newUnit]
            this.props.onSettingChange({ id: this.props.id, config: this.props.config.set('userAreas', updatedAreas) })
            this.setState({ availableAreaUnits: [...defaultAreaUnits, ...updatedAreas], defaultAreaUnit: null })
        }
    }

    handleChangeUnit = (newUnit: Unit, type: 'linear' | 'area') => {
        if (type === 'linear') {
            const userDistances = toMutableUnits(this.props.config.userDistances)
            const updatedDistances = [...userDistances]
            const index = updatedDistances.findIndex(existing => existing.unit === newUnit.unit)
            if (index !== -1) updatedDistances[index] = newUnit
            this.props.onSettingChange({ id: this.props.id, config: this.props.config.set('userDistances', updatedDistances) })
            this.setState({ availableDistanceUnits: [...defaultDistanceUnits, ...updatedDistances], defaultDistanceUnit: null })
        } else {
            const userAreas = toMutableUnits(this.props.config.userAreas)
            const updatedAreas = [...userAreas]
            const index = updatedAreas.findIndex(existing => existing.unit === newUnit.unit)
            if (index !== -1) updatedAreas[index] = newUnit
            this.props.onSettingChange({ id: this.props.id, config: this.props.config.set('userAreas', updatedAreas) })
            this.setState({ availableAreaUnits: [...defaultAreaUnits, ...updatedAreas], defaultAreaUnit: null })
        }
    }

    handleDeleteUnit = (unit: Unit, type: 'linear' | 'area') => {
        if (type === 'linear') {
            const userDistances = toMutableUnits(this.props.config.userDistances)
            const updatedDistances = userDistances.filter(u => u.unit !== unit.unit)
            this.props.onSettingChange({ id: this.props.id, config: this.props.config.set('userDistances', updatedDistances) })
            this.setState({ availableDistanceUnits: [...defaultDistanceUnits, ...updatedDistances], defaultDistanceUnit: null })
        } else {
            const userAreas = toMutableUnits(this.props.config.userAreas)
            const updatedAreas = userAreas.filter(u => u.unit !== unit.unit)
            this.props.onSettingChange({ id: this.props.id, config: this.props.config.set('userAreas', updatedAreas) })
            this.setState({ availableAreaUnits: [...defaultAreaUnits, ...updatedAreas], defaultAreaUnit: null })
        }
    }

    // ========================================================================
    // Render helpers
    // ========================================================================

    /** Scan app config.json for all widgets (ExB dev edition builder doesn't expose user widgets in the store) */
    scanForWidgets = async () => {
        this.setState({ scanning: true });
        try {
            const url = new URL(window.location.href);
            let appId = url.searchParams.get('id');
            if (!appId) {
                const pathMatch = window.location.href.match(/experience\/(\d+)/);
                appId = pathMatch ? pathMatch[1] : null;
            }
            if (!appId) {
                this.setState({ scanning: false, scanMessage: this.formatMessage('settingScanAppIdError') });
                return;
            }

            const baseUrl = window.location.origin;
            const possiblePaths = [
                `${baseUrl}/apps/${appId}/config.json`,
                `/apps/${appId}/config.json`,
            ];

            let appConfigData: any = null;
            for (const path of possiblePaths) {
                try {
                    const resp = await fetch(path);
                    if (resp.ok) {
                        const text = await resp.text();
                        try {
                            const data = JSON.parse(text);
                            if (data.widgets) {
                                appConfigData = data;
                                break;
                            }
                        } catch { /* not valid JSON */ }
                    }
                } catch { /* try next */ }
            }

            if (appConfigData?.widgets) {
                const allWidgets = Object.entries(appConfigData.widgets)
                    .map(([id, w]: [string, any]) => ({
                        id,
                        label: w.label || id
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label));
                this.setState({ detectedWidgets: allWidgets, scanMessage: '' });
            } else {
                this.setState({ scanMessage: this.formatMessage('settingLoadAppConfigError', { appId }) });
            }
        } catch (e) {
            console.warn('Draw Widget Scan: Error', e);
        }
        this.setState({ scanning: false });
    };

    /** Default-ON Switch (enabled unless explicitly false) */
    renderToggle = (key: keyof Config, label: string, description?: string) => {
        const checked = this.props.config[key] !== false;
        const descId = `draw-setting-${key}-desc`;
        const control = (
            <Switch
                checked={checked}
                onChange={() => this.setConfig(key, !checked)}
                aria-label={label}
                aria-describedby={description ? descId : undefined}
                title={description || label}
            />
        );
        return (
            <SettingRow>
                <div style={s.toggleRow}>
                    <div style={{ flex: 1, marginRight: '8px' }}>
                        <Label style={s.toggleLabel} title={description || label}>{label}</Label>
                        {description && <p id={descId} style={s.sub}>{description}</p>}
                    </div>
                    {description ? <Tooltip title={description} placement='left'>{control}</Tooltip> : control}
                </div>
            </SettingRow>
        )
    }

    /** Default-OFF Switch (opt-in, off unless explicitly true) */
    renderOptInToggle = (key: keyof Config, label: string, description?: string) => {
        const checked = this.props.config[key] === true;
        const descId = `draw-setting-${key}-desc`;
        const control = (
            <Switch
                checked={checked}
                onChange={() => this.setConfig(key, !checked)}
                aria-label={label}
                aria-describedby={description ? descId : undefined}
                title={description || label}
            />
        );
        return (
            <SettingRow>
                <div style={s.toggleRow}>
                    <div style={{ flex: 1, marginRight: '8px' }}>
                        <Label style={s.toggleLabel} title={description || label}>{label}</Label>
                        {description && <p id={descId} style={s.sub}>{description}</p>}
                    </div>
                    {description ? <Tooltip title={description} placement='left'>{control}</Tooltip> : control}
                </div>
            </SettingRow>
        )
    }

    /** Checkbox with inline label. defaultOn=true means feature is on unless config says false. */
    renderCheck = (key: keyof Config, label: string, defaultOn: boolean = true, tip?: string) => {
        const checked = defaultOn ? this.props.config[key] !== false : this.props.config[key] === true;
        const row = (
            <div style={s.checkRow} title={tip || label}>
                <Checkbox checked={checked} onChange={() => this.setConfig(key, !checked)} aria-label={tip ? `${label}. ${tip}` : label} />
                <span style={s.checkLabel}>{label}</span>
            </div>
        );
        return tip ? <Tooltip title={tip} placement='left'>{row}</Tooltip> : row;
    }

    // ========================================================================
    // Render
    // ========================================================================

    render() {
        const { useMapWidgetIds, config } = this.props
        const userDistances = toMutableUnits(config.userDistances)
        const userAreas = toMutableUnits(config.userAreas)
        const availableDistanceUnits = this.state.availableDistanceUnits.map(unit =>
            unit.labelKey ? { ...unit, label: this.formatMessage(unit.labelKey) } : unit
        )
        const availableAreaUnits = this.state.availableAreaUnits.map(unit =>
            unit.labelKey ? { ...unit, label: this.formatMessage(unit.labelKey) } : unit
        )

        const enabledToolCount = DRAW_TOOLS.filter(t => config[t.key] !== false).length;
        const myDrawingsEnabled = config.enableMyDrawings !== false;
        const measurementsEnabled = config.enableMeasurements !== false;

        return (
            <div>
                <div className="widget-setting-psearch">

                    {/* ================================================================
                        SECTION 1: MAP & DRAW MODE
                    ================================================================ */}
                    <SettingSection className="map-selector-section" title={this.formatMessage('sourceLabel')}>
                        <SettingRow label={this.formatMessage('selectMapWidget')} />
                        <SettingRow>
                            <MapWidgetSelector onSelect={this.onMapWidgetSelected} useMapWidgetIds={useMapWidgetIds} />
                        </SettingRow>
                        <SettingRow label={this.formatMessage('selectDrawMode')} flow='wrap'>
                            <Select value={config.creationMode} onChange={this.handleDrawModeChange} className='drop-height' aria-label={this.formatMessage('settingDrawingCreationMode')}>
                                <Option value={DrawMode.CONTINUOUS} title={this.formatMessage('settingContinuousModeTitle')}>{this.formatMessage('drawModeContinuous')}</Option>
                                <Option value={DrawMode.SINGLE} title={this.formatMessage('settingSingleModeTitle')}>{this.formatMessage('drawModeSingle')}</Option>
                            </Select>
                            <p style={{ ...s.sub, marginTop: '4px' }}>
                                {config.creationMode === DrawMode.CONTINUOUS
                                    ? this.formatMessage('settingContinuousModeHelp')
                                    : this.formatMessage('settingSingleModeHelp')}
                            </p>
                        </SettingRow>
                    </SettingSection>

                    {/* ================================================================
                        SECTION: IMPORT / EXPORT SETTINGS
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingImportExportTitle')}>
                        <p style={s.sectionDesc}>{this.formatMessage('settingImportExportDescription')}</p>

                        {/* Export */}
                        <div style={s.fieldRow}>
                            <Label style={s.fieldLabel}>{this.formatMessage('settingExport')}</Label>
                            <div style={s.quickBtns}>
                                <Tooltip title={this.formatMessage('settingBuildXmlTooltip')} placement='top'>
                                    <Button size='sm' type='primary' onClick={this.handleGenerateExport} aria-label={this.formatMessage('settingGenerateXml')} title={this.formatMessage('settingGenerateXml')}>
                                        {this.formatMessage('settingGenerateXml')}
                                    </Button>
                                </Tooltip>
                                <Tooltip title={this.formatMessage('settingDownloadXmlTooltip')} placement='top'>
                                    <Button size='sm' type='default' onClick={this.handleDownloadExport} aria-label={this.formatMessage('settingDownloadFile')} title={this.formatMessage('settingDownloadXmlTooltip')}>
                                        {this.formatMessage('settingDownloadFile')}
                                    </Button>
                                </Tooltip>
                            </div>
                            {this.state.exportXml && (
                                <>
                                    <TextArea
                                        className='w-100'
                                        style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '11px' }}
                                        readOnly
                                        value={this.state.exportXml}
                                        aria-label={this.formatMessage('settingExportedXml')}
                                    />
                                    <div style={{ ...s.quickBtns, marginTop: '6px' }}>
                                        <Button size='sm' type='tertiary' onClick={this.handleCopyExport} aria-label={this.formatMessage('settingCopyXmlAria')} title={this.formatMessage('settingCopyXmlTitle')}>
                                            {this.formatMessage('settingCopyToClipboard')}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>

                        <div style={s.divider} />

                        {/* Import */}
                        <div style={s.fieldRow}>
                            <Label style={s.fieldLabel}>{this.formatMessage('settingImport')}</Label>
                            <input
                                ref={this.fileInputRef}
                                type='file'
                                accept='.xml,application/xml,text/xml'
                                onChange={this.handleFileImport}
                                style={{ display: 'none' }}
                                aria-hidden='true'
                                tabIndex={-1}
                            />
                            <div style={s.quickBtns}>
                                <Tooltip title={this.formatMessage('settingChooseXmlTooltip')} placement='top'>
                                    <Button size='sm' type='default' onClick={() => this.fileInputRef.current?.click()} aria-label={this.formatMessage('settingLoadXmlAria')} title={this.formatMessage('settingLoadXmlTitle')}>
                                        {this.formatMessage('settingLoadFromFile')}
                                    </Button>
                                </Tooltip>
                            </div>
                            <Label className='w-100' style={{ fontSize: '12px', marginTop: '4px' }}>
                                {this.formatMessage('settingPasteXml')}
                                <TextArea
                                    className='w-100 mt-1'
                                    style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '11px' }}
                                    value={this.state.importXml}
                                    onChange={(e) => this.setState({ importXml: e.target.value, importError: '', importSuccess: false })}
                                    placeholder={this.formatMessage('settingXmlImportPlaceholder')}
                                    aria-label={this.formatMessage('settingPasteXmlAria')}
                                />
                            </Label>
                            <div style={{ ...s.quickBtns, marginTop: '6px' }}>
                                <Tooltip title={this.formatMessage('settingApplyXmlTooltip')} placement='top'>
                                    <Button size='sm' type='primary' onClick={this.handleApplyImport} aria-label={this.formatMessage('settingApplyXmlAria')} title={this.formatMessage('settingApplyXmlAria')}>
                                        {this.formatMessage('settingApplyXml')}
                                    </Button>
                                </Tooltip>
                            </div>
                            {this.state.importError && (
                                <Alert type='error' role='alert' aria-live='assertive' closable onClose={() => this.setState({ importError: '' })} style={{ width: '100%', marginTop: '6px' }}>
                                    {this.state.importError}
                                </Alert>
                            )}
                            {this.state.importSuccess && (
                                <Alert type='success' role='status' aria-live='polite' style={{ width: '100%', marginTop: '6px' }}>
                                    {this.formatMessage('settingImportSuccess')}
                                </Alert>
                            )}
                        </div>
                    </SettingSection>

                    {/* ================================================================
                        SECTION 2: DRAW TOOLS
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingDrawToolsTitle', { enabled: enabledToolCount, total: DRAW_TOOLS.length })}>
                        <p style={s.sectionDesc}>{this.formatMessage('settingDrawToolsDescription')}</p>

                        <div style={s.quickBtns}>
                            <Button size="sm" type="default" title={this.formatMessage('settingEnableEveryDrawToolTitle')} aria-label={this.formatMessage('settingEnableAllDrawToolsAria')} onClick={() => {
                                const updates: Record<string, any> = {};
                                DRAW_TOOLS.forEach(t => { updates[t.key] = true; });
                                this.setConfigBatch(updates);
                            }}>{this.formatMessage('settingEnableAll')}</Button>
                            <Button size="sm" type="default" title={this.formatMessage('settingDisableEveryDrawToolTitle')} aria-label={this.formatMessage('settingDisableAllDrawToolsAria')} onClick={() => {
                                const updates: Record<string, any> = {};
                                DRAW_TOOLS.forEach(t => { updates[t.key] = false; });
                                this.setConfigBatch(updates);
                            }}>{this.formatMessage('settingDisableAll')}</Button>
                        </div>

                        <div style={s.toolGrid}>
                            {DRAW_TOOLS.map(tool => (
                                <Tooltip key={tool.key} title={this.formatMessage(tool.descKey)} placement='top'>
                                    <div style={s.checkRow} title={this.formatMessage(tool.descKey)}>
                                        <Checkbox
                                            checked={config[tool.key] !== false}
                                            onChange={() => this.setConfig(tool.key, config[tool.key] === false)}
                                            aria-label={`${this.formatMessage(tool.labelKey)} drawing tool. ${this.formatMessage(tool.descKey)}`}
                                        />
                                        <span style={s.checkLabel}>
                                            <span style={s.toolIcon} aria-hidden="true">{tool.icon}</span>
                                            {this.formatMessage(tool.labelKey)}
                                        </span>
                                    </div>
                                </Tooltip>
                            ))}
                        </div>

                        {enabledToolCount === 0 && (
                            <Alert type='warning' style={{ width: '100%', marginTop: '8px' }}>
                                {this.formatMessage('settingNoDrawToolsWarning')}
                            </Alert>
                        )}
                    </SettingSection>

                    {/* ================================================================
                        SECTION 3: FEATURES & CAPABILITIES
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingFeaturesTitle')}>
                        <p style={s.sectionDesc}>{this.formatMessage('settingFeaturesDescription')}</p>

                        {this.renderToggle('enableSymbolEditor', this.formatMessage('settingSymbolEditor'),
                            this.formatMessage('settingSymbolEditorDescription'))}

                        {this.renderToggle('enableMeasurements', this.formatMessage('settingMeasurements'),
                            this.formatMessage('settingMeasurementsDescription'))}

                        {this.renderToggle('enableSnapping', this.formatMessage('settingSnapping'),
                            this.formatMessage('settingSnappingDescription'))}

                        {this.renderToggle('enableBuffer', this.formatMessage('settingBuffer'),
                            this.formatMessage('settingBufferDescription'))}

                        {config.enableBuffer !== false && (
                            <div style={s.indent}>
                                <p style={s.sub}>{this.formatMessage('settingDefaultBufferValuesDescription')}</p>

                                <div style={s.fieldRow}>
                                    <Label style={s.fieldLabel} title={this.formatMessage('settingInitialBufferDistanceUnit')}>{this.formatMessage('settingDefaultDistance')}</Label>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <NumericInput
                                            value={config.defaultBufferDistance ?? 100}
                                            min={0.1}
                                            step={0.1}
                                            onChange={(v) => this.setConfig('defaultBufferDistance', v)}
                                            style={{ width: '100px' }}
                                            aria-label={this.formatMessage('settingDefaultBufferDistanceAria')}
                                            title={this.formatMessage('settingInitialBufferDistanceTitle')}
                                        />
                                        <Select
                                            value={config.defaultBufferUnit || 'feet'}
                                            onChange={(e) => this.setConfig('defaultBufferUnit', e.target.value)}
                                            style={{ flex: 1, minWidth: '110px' }}
                                            aria-label={this.formatMessage('settingDefaultBufferUnitAria')}
                                            title={this.formatMessage('settingInitialBufferDistanceUnitTitle')}
                                        >
                                            <Option value='feet'>{this.formatMessage('settingUnitFeet')}</Option>
                                            <Option value='meters'>{this.formatMessage('settingUnitMeters')}</Option>
                                            <Option value='miles'>{this.formatMessage('settingUnitMiles')}</Option>
                                            <Option value='kilometers'>{this.formatMessage('settingUnitKilometers')}</Option>
                                        </Select>
                                    </div>
                                </div>

                                <div style={s.fieldRow}>
                                    <Label style={s.fieldLabel} title={this.formatMessage('settingInitialBufferOpacityTitle')}>{this.formatMessage('settingDefaultOpacity')}</Label>
                                    <NumericInput
                                        value={config.defaultBufferOpacity ?? 75}
                                        min={1}
                                        max={100}
                                        step={1}
                                        onChange={(v) => this.setConfig('defaultBufferOpacity', v)}
                                        style={{ width: '100px' }}
                                        aria-label={this.formatMessage('settingDefaultBufferOpacityAria')}
                                        title={this.formatMessage('settingInitialBufferOpacityDescription')}
                                    />
                                </div>

                                <div style={s.fieldRow}>
                                    <Label style={s.fieldLabel} title={this.formatMessage('settingDefaultCustomBufferColorDescription')}>{this.formatMessage('settingDefaultCustomColor')}</Label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <ColorPicker
                                            width={28}
                                            height={28}
                                            color={config.defaultBufferColor || '#d83020'}
                                            onChange={(c: string) => this.setConfig('defaultBufferColor', c)}
                                            aria-label={this.formatMessage('settingDefaultBufferColorAria')}
                                            title={this.formatMessage('settingDefaultBufferColorTitle')}
                                        />
                                        <span style={{ ...s.sub, margin: 0, flex: 1 }}>{this.formatMessage('settingCustomBufferColorNote')}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {this.renderToggle('enableUndoRedo', this.formatMessage('settingUndoRedo'),
                            this.formatMessage('settingUndoRedoDescription'))}

                        {this.renderToggle('enableCopyFromMap', this.formatMessage('settingCopyFromMap'),
                            this.formatMessage('settingCopyFromMapDescription'))}
                    </SettingSection>

                    {/* ================================================================
                        SECTION 4: MY DRAWINGS PANEL
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingMyDrawingsTitle')}>
                        {this.renderToggle('enableMyDrawings', this.formatMessage('settingEnableMyDrawings'),
                            this.formatMessage('settingEnableMyDrawingsDescription'))}

                        {myDrawingsEnabled && (
                            <>
                                <div style={s.divider} />
                                <p style={{ ...s.sub, fontWeight: 600, color: 'var(--calcite-color-text-2, #495057)', marginBottom: '6px' }}>
                                    {this.formatMessage('settingMyDrawingsActionsDescription')}
                                </p>
                                <div style={s.indent}>
                                    {this.renderCheck('enableMyDrawingsImport', this.formatMessage('settingImportDrawings'), true, this.formatMessage('settingImportDrawingsDescription'))}
                                    {this.renderCheck('enableMyDrawingsExport', this.formatMessage('settingExportDrawings'), true, this.formatMessage('settingExportDrawingsDescription'))}
                                    {this.renderCheck('enableMyDrawingsLock', this.formatMessage('settingLockDrawings'), true, this.formatMessage('settingLockDrawingsDescription'))}
                                    {this.renderCheck('enableMyDrawingsGroup', this.formatMessage('settingGroupDrawings'), true, this.formatMessage('settingGroupDrawingsDescription'))}
                                    {this.renderCheck('enableMyDrawingsMerge', this.formatMessage('settingMergeDrawings'), true, this.formatMessage('settingMergeDrawingsDescription'))}
                                    {this.renderCheck('enableMyDrawingsDuplicate', this.formatMessage('settingDuplicateDrawings'), true, this.formatMessage('settingDuplicateDrawingsDescription'))}
                                    {this.renderCheck('enableMyDrawingsZoomTo', this.formatMessage('settingZoomToDrawing'), true, this.formatMessage('settingZoomToDrawingDescription'))}
                                    {this.renderCheck('enableMyDrawingsProperties', this.formatMessage('settingViewDrawingProperties'), true, this.formatMessage('settingViewDrawingPropertiesDescription'))}
                                    {this.renderCheck('enableMyDrawingsSort', this.formatMessage('settingSortAndFilterDrawings'), true, this.formatMessage('settingSortAndFilterDrawingsDescription'))}
                                </div>

                                <div style={{ ...s.quickBtns, marginTop: '8px', paddingLeft: '12px' }}>
                                    <Button size="sm" type="default" title={this.formatMessage('settingEnableEveryMyDrawingsActionTitle')} aria-label={this.formatMessage('settingEnableAllMyDrawingsActionsAria')} onClick={() => {
                                        this.setConfigBatch({
                                            enableMyDrawingsImport: true, enableMyDrawingsExport: true,
                                            enableMyDrawingsLock: true, enableMyDrawingsGroup: true,
                                            enableMyDrawingsMerge: true, enableMyDrawingsDuplicate: true,
                                            enableMyDrawingsZoomTo: true, enableMyDrawingsProperties: true,
                                            enableMyDrawingsSort: true
                                        });
                                    }}>{this.formatMessage('settingEnableAll')}</Button>
                                    <Button size="sm" type="default" title={this.formatMessage('settingDisableEveryMyDrawingsActionTitle')} aria-label={this.formatMessage('settingDisableAllMyDrawingsActionsAria')} onClick={() => {
                                        this.setConfigBatch({
                                            enableMyDrawingsImport: false, enableMyDrawingsExport: false,
                                            enableMyDrawingsLock: false, enableMyDrawingsGroup: false,
                                            enableMyDrawingsMerge: false, enableMyDrawingsDuplicate: false,
                                            enableMyDrawingsZoomTo: false, enableMyDrawingsProperties: false,
                                            enableMyDrawingsSort: false
                                        });
                                    }}>{this.formatMessage('settingDisableAll')}</Button>
                                </div>
                            </>
                        )}
                    </SettingSection>

                    {/* ================================================================
                        SECTION 5: DRAW LAYER
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingDrawLayerTitle')}>
                        <SettingRow>
                            <Label className='w-100'>
                                {this.formatMessage('settingDefaultLayerName')}
                                <TextInput
                                    type='text'
                                    required
                                    defaultValue={config.title || this.formatMessage('settingDrawnGraphics')}
                                    onChange={(e) => this.handleTitle(e.target.value)}
                                    aria-label={this.formatMessage('settingDefaultDrawLayerNameAria')}
                                    title={this.formatMessage('settingDefaultDrawLayerNameTitle')}
                                />
                            </Label>
                        </SettingRow>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0' }}>
                            {this.renderCheck('changeTitle', this.formatMessage('settingAllowRenameDrawLayer'), false, this.formatMessage('settingAllowRenameDrawLayerDescription'))}
                            {this.renderCheck('listMode', this.formatMessage('settingShowDrawLayerInList'), false, this.formatMessage('settingShowDrawLayerInListDescription'))}
                            {this.renderCheck('changeListMode', this.formatMessage('settingToggleLayerListVisibility'), false, this.formatMessage('settingToggleLayerListVisibilityDescription'))}
                        </div>
                    </SettingSection>

                    {/* ================================================================
                        SECTION 6: DRAWING STORAGE
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingDrawingStorageTitle')}>
                        <SettingRow>
                            <Label className='w-100'>
                                {this.formatMessage('settingStorageScope')}
                                <Select
                                    value={config.storageScope || StorageScope.APP_SPECIFIC}
                                    onChange={this.handleStorageScopeChange}
                                    className='drop-height'
                                    aria-label={this.formatMessage('settingStorageScopeAria')}
                                    title={this.formatMessage('settingStorageScopeTitle')}
                                >
                                    <Option value={StorageScope.APP_SPECIFIC}>{this.formatMessage('settingThisApplicationOnly')}</Option>
                                    <Option value={StorageScope.GLOBAL}>{this.formatMessage('settingAllApplicationsGlobal')}</Option>
                                </Select>
                            </Label>
                        </SettingRow>
                        <SettingRow>
                            <Alert type='info' style={{ width: '100%' }}>
                                {String(config.storageScope) === 'global'
                                    ? this.formatMessage('settingGlobalStorageNotice')
                                    : this.formatMessage('settingAppStorageNotice')}
                            </Alert>
                        </SettingRow>

                        <div style={s.divider} />

                        <SettingRow>
                            <div style={{ width: '100%' }}>
                                <Label style={s.toggleLabel}>{this.formatMessage('settingMaximumSavedDrawings')}</Label>
                                <p style={s.sub}>
                                    {this.formatMessage('settingMaximumSavedDrawingsDescription')}
                                </p>
                                <NumericInput
                                    value={config.maxDrawings ?? 0}
                                    min={0}
                                    max={10000}
                                    step={10}
                                    onChange={(value) => this.setConfig('maxDrawings', value)}
                                    aria-label={this.formatMessage('settingMaximumSavedDrawingsAria')}
                                    title={this.formatMessage('settingMaximumSavedDrawingsTitle')}
                                    style={{ width: '120px', marginTop: '4px' }}
                                />
                            </div>
                        </SettingRow>
                    </SettingSection>

                    {/* ================================================================
                        SECTION 7: INTEGRATIONS
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingIntegrationsTitle')}>
                        <p style={s.sectionDesc}>{this.formatMessage('settingIntegrationsDescription')}</p>

                        {this.renderOptInToggle('enableMailingLabels', this.formatMessage('settingMailingLabels'),
                            this.formatMessage('settingMailingLabelsDescription'))}

                        {config.enableMailingLabels === true && (
                            <div style={s.indent}>
                                <SettingRow>
                                    <div style={{ width: '100%' }}>
                                        <Label style={s.toggleLabel}>{this.formatMessage('settingTargetWidget')}</Label>
                                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '6px' }}>
                                            <Button size="sm" type="primary" onClick={this.scanForWidgets} disabled={this.state.scanning} style={{ whiteSpace: 'nowrap' }}>
                                                {this.state.scanning ? this.formatMessage('settingScanning') : this.formatMessage('settingScanApp')}
                                            </Button>
                                            <span style={s.sub}>
                                                {this.formatMessage('settingScanAppDescription')}
                                            </span>
                                        </div>
                                        {this.state.scanMessage && (
                                            <Alert
                                                type='warning'
                                                role='status'
                                                aria-live='polite'
                                                closable
                                                onClose={() => this.setState({ scanMessage: '' })}
                                                style={{ width: '100%', marginBottom: '6px' }}
                                            >
                                                {this.state.scanMessage}
                                            </Alert>
                                        )}
                                        {this.state.detectedWidgets.length > 0 ? (
                                            <Select
                                                value={config.mailingLabelsWidgetId || ''}
                                                onChange={(e) => this.setConfig('mailingLabelsWidgetId', e.target.value)}
                                                size="sm"
                                                aria-label={this.formatMessage('settingSelectWidgetAria', { widget: this.formatMessage('settingMailingLabels') })}
                                            >
                                                <Option value=''>{this.formatMessage('settingSelectWidget')}</Option>
                                                {this.state.detectedWidgets.map(w => (
                                                    <Option key={w.id} value={w.id}>{w.label}</Option>
                                                ))}
                                            </Select>
                                        ) : (
                                            <TextInput
                                                value={config.mailingLabelsWidgetId || ''}
                                                onChange={(e) => this.setConfig('mailingLabelsWidgetId', e.target.value)}
                                                placeholder={this.formatMessage('settingWidgetIdPlaceholder', { id: 'widget_3' })}
                                                aria-label={this.formatMessage('settingTargetWidgetIdAria', { widget: this.formatMessage('settingMailingLabels') })}
                                                title={this.formatMessage('settingTargetWidgetIdTitle', { widget: this.formatMessage('settingMailingLabels') })}
                                                size="sm"
                                            />
                                        )}
                                        {config.mailingLabelsWidgetId && (
                                            <span style={s.sub}>{this.formatMessage('settingWidgetId', { id: config.mailingLabelsWidgetId })}</span>
                                        )}

                                        <Label style={{ ...s.toggleLabel, marginTop: '10px' }}>{this.formatMessage('settingParentWidgetController')}</Label>
                                        {this.state.detectedWidgets.length > 0 ? (
                                            <Select
                                                value={config.mailingLabelsControllerId || ''}
                                                onChange={(e) => this.setConfig('mailingLabelsControllerId', e.target.value)}
                                                size="sm"
                                                aria-label={this.formatMessage('settingSelectWidgetControllerAria', { widget: this.formatMessage('settingMailingLabels') })}
                                            >
                                                <Option value=''>{this.formatMessage('settingSelectController')}</Option>
                                                {this.state.detectedWidgets.filter(w => w.label.toLowerCase().includes('controller')).map(w => (
                                                    <Option key={w.id} value={w.id}>{w.label}</Option>
                                                ))}
                                                {/* Also show all widgets in case the controller doesn't have "controller" in its name */}
                                                <Option disabled>{this.formatMessage('settingAllWidgetsDivider')}</Option>
                                                {this.state.detectedWidgets.map(w => (
                                                    <Option key={`all-${w.id}`} value={w.id}>{w.label}</Option>
                                                ))}
                                            </Select>
                                        ) : (
                                            <TextInput
                                                value={config.mailingLabelsControllerId || ''}
                                                onChange={(e) => this.setConfig('mailingLabelsControllerId', e.target.value)}
                                                placeholder={this.formatMessage('settingWidgetIdPlaceholder', { id: 'widget_75' })}
                                                aria-label={this.formatMessage('settingParentControllerIdAria', { widget: this.formatMessage('settingMailingLabels') })}
                                                title={this.formatMessage('settingParentControllerTitle', { widget: this.formatMessage('settingMailingLabels') })}
                                                size="sm"
                                            />
                                        )}
                                        <p style={s.sub}>
                                            {this.formatMessage('settingParentControllerDescription', { widget: this.formatMessage('settingMailingLabels') })}
                                        </p>
                                    </div>
                                </SettingRow>
                                {!config.mailingLabelsWidgetId && (
                                    <Alert type='warning' style={{ width: '100%' }}>
                                        {this.formatMessage('settingNoWidgetSelected')}
                                    </Alert>
                                )}
                            </div>
                        )}
                    </SettingSection>

                    {this.renderOptInToggle('enableIdentifyByQuery', this.formatMessage('settingIdentifyByQuery'),
                        this.formatMessage('settingIdentifyByQueryDescription'))}

                    {config.enableIdentifyByQuery === true && (
                        <div style={s.indent}>
                            <SettingRow>
                                <div style={{ width: '100%' }}>
                                    <Label style={s.toggleLabel}>{this.formatMessage('settingTargetWidget')}</Label>
                                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '6px' }}>
                                        <Button size="sm" type="primary" onClick={this.scanForWidgets} disabled={this.state.scanning} style={{ whiteSpace: 'nowrap' }}>
                                            {this.state.scanning ? this.formatMessage('settingScanning') : this.formatMessage('settingScanApp')}
                                        </Button>
                                        <span style={s.sub}>
                                            {this.formatMessage('settingScanAppDescription')}
                                        </span>
                                    </div>
                                    {this.state.scanMessage && (
                                        <Alert
                                            type='warning'
                                            role='status'
                                            aria-live='polite'
                                            closable
                                            onClose={() => this.setState({ scanMessage: '' })}
                                            style={{ width: '100%', marginBottom: '6px' }}
                                        >
                                            {this.state.scanMessage}
                                        </Alert>
                                    )}
                                    {this.state.detectedWidgets.length > 0 ? (
                                        <Select
                                            value={config.identifyWidgetId || ''}
                                            onChange={(e) => this.setConfig('identifyWidgetId', e.target.value)}
                                            size="sm"
                                            aria-label={this.formatMessage('settingSelectWidgetAria', { widget: this.formatMessage('settingIdentifyByQuery') })}
                                        >
                                            <Option value=''>{this.formatMessage('settingSelectWidget')}</Option>
                                            {this.state.detectedWidgets.map(w => (
                                                <Option key={w.id} value={w.id}>{w.label}</Option>
                                            ))}
                                        </Select>
                                    ) : (
                                        <TextInput
                                            value={config.identifyWidgetId || ''}
                                            onChange={(e) => this.setConfig('identifyWidgetId', e.target.value)}
                                            placeholder={this.formatMessage('settingWidgetIdPlaceholder', { id: 'widget_5' })}
                                            aria-label={this.formatMessage('settingTargetWidgetIdAria', { widget: this.formatMessage('settingIdentifyByQuery') })}
                                            title={this.formatMessage('settingTargetWidgetIdTitle', { widget: this.formatMessage('settingIdentifyByQuery') })}
                                            size="sm"
                                        />
                                    )}
                                    {config.identifyWidgetId && (
                                        <span style={s.sub}>{this.formatMessage('settingWidgetId', { id: config.identifyWidgetId })}</span>
                                    )}

                                    <Label style={{ ...s.toggleLabel, marginTop: '10px' }}>{this.formatMessage('settingParentWidgetController')}</Label>
                                    {this.state.detectedWidgets.length > 0 ? (
                                        <Select
                                            value={config.identifyControllerId || ''}
                                            onChange={(e) => this.setConfig('identifyControllerId', e.target.value)}
                                            size="sm"
                                            aria-label={this.formatMessage('settingSelectWidgetControllerAria', { widget: this.formatMessage('settingIdentifyByQuery') })}
                                        >
                                            <Option value=''>{this.formatMessage('settingSelectController')}</Option>
                                            {this.state.detectedWidgets.filter(w => w.label.toLowerCase().includes('controller')).map(w => (
                                                <Option key={w.id} value={w.id}>{w.label}</Option>
                                            ))}
                                            {/* Also show all widgets in case the controller doesn't have "controller" in its name */}
                                            <Option disabled>{this.formatMessage('settingAllWidgetsDivider')}</Option>
                                            {this.state.detectedWidgets.map(w => (
                                                <Option key={`all-${w.id}`} value={w.id}>{w.label}</Option>
                                            ))}
                                        </Select>
                                    ) : (
                                        <TextInput
                                            value={config.identifyControllerId || ''}
                                            onChange={(e) => this.setConfig('identifyControllerId', e.target.value)}
                                            placeholder={this.formatMessage('settingWidgetIdPlaceholder', { id: 'widget_76' })}
                                            aria-label={this.formatMessage('settingParentControllerIdAria', { widget: this.formatMessage('settingIdentifyByQuery') })}
                                            title={this.formatMessage('settingParentControllerTitle', { widget: this.formatMessage('settingIdentifyByQuery') })}
                                            size="sm"
                                        />
                                    )}
                                    <p style={s.sub}>
                                        {this.formatMessage('settingParentControllerDescription', { widget: this.formatMessage('settingIdentifyByQuery') })}
                                    </p>
                                </div>
                            </SettingRow>
                            {!config.identifyWidgetId && (
                                <Alert type='warning' style={{ width: '100%' }}>
                                    {this.formatMessage('settingNoWidgetSelected')}
                                </Alert>
                            )}
                        </div>
                    )}

                    {this.renderOptInToggle('enableIdentifyIntegration', this.formatMessage('settingReceiveFromIdentify'),
                        this.formatMessage('settingReceiveFromIdentifyDescription'))}

                    {/* ================================================================
                        SECTION 8: MEASUREMENT UNITS
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingMeasurementUnitsTitle')}>
                        {!measurementsEnabled ? (
                            <SettingRow>
                                <Alert type='info' style={{ width: '100%' }}>
                                    {this.formatMessage('settingEnableMeasurementsToConfigureUnits')}
                                </Alert>
                            </SettingRow>
                        ) : (
                            <>
                                {/* Linear */}
                                <SettingRow>
                                    <Button onClick={() => this.setState({ linearSidePopper: true })} style={{ width: '100%' }} title={this.formatMessage('settingAddOrChangeLinearUnitsTitle')} aria-label={this.formatMessage('settingAddOrChangeLinearUnitsAria')}>
                                        {this.formatMessage('settingAddOrChangeLinearUnits')}
                                    </Button>
                                </SettingRow>
                                <SettingRow>
                                    <Label className='w-100'>
                                        {this.formatMessage('settingDefaultLinearUnit')}
                                        <Select title={this.formatMessage('settingDefaultLinearUnitDescription')} aria-label={this.formatMessage('settingDefaultLinearUnitAria')} onChange={(e) => this.handleDefaultDistance(e.target.value)} value={this.state.defaultDistanceUnit}>
                                            {availableDistanceUnits.map((unit, index) => (
                                                <Option key={index} value={index}>{unit.label} ({unit.abbreviation})</Option>
                                            ))}
                                        </Select>
                                        {this.state.defaultDistanceUnit === null && <Alert type='warning'>{this.formatMessage('settingResetDefaultDistanceUnits')}</Alert>}
                                    </Label>
                                </SettingRow>

                                <div style={s.divider} />

                                {/* Area */}
                                <SettingRow>
                                    <Button onClick={() => this.setState({ areaSidePopper: true })} style={{ width: '100%' }} title={this.formatMessage('settingAddOrChangeAreaUnitsTitle')} aria-label={this.formatMessage('settingAddOrChangeAreaUnitsAria')}>
                                        {this.formatMessage('settingAddOrChangeAreaUnits')}
                                    </Button>
                                </SettingRow>
                                <SettingRow>
                                    <Label className='w-100'>
                                        {this.formatMessage('settingDefaultAreaUnits')}
                                        <Select title={this.formatMessage('settingDefaultAreaUnitsDescription')} aria-label={this.formatMessage('settingDefaultAreaUnitsAria')} onChange={(e) => this.handleDefaultArea(e.target.value)} value={this.state.defaultAreaUnit}>
                                            {availableAreaUnits.map((unit, index) => (
                                                <Option key={index} value={index}>{unit.label} ({unit.abbreviation})</Option>
                                            ))}
                                        </Select>
                                        <span style={{ fontSize: '11px', color: 'var(--calcite-color-text-2, #6c757d)' }}>
                                            {this.formatMessage('settingSuperscriptNote')}
                                        </span>
                                        {this.state.defaultAreaUnit === null && <Alert type='warning'>{this.formatMessage('settingResetDefaultAreaUnits')}</Alert>}
                                    </Label>
                                </SettingRow>

                                <div style={s.divider} />

                                {/* Label templates */}
                                <div style={s.fieldRow}>
                                    <Label style={s.fieldLabel} title={this.formatMessage('settingPolylineLabelTemplateTitle')}>{this.formatMessage('settingPolylineLabelTemplate')}</Label>
                                    <TextInput
                                        className='w-100'
                                        value={config.measurePolylineLabel || ''}
                                        placeholder='{{length}} {{lengthUnit}}'
                                        onChange={(e) => this.setConfig('measurePolylineLabel', e.target.value)}
                                        aria-label={this.formatMessage('settingPolylineMeasurementTemplateAria')}
                                        title={this.formatMessage('settingPolylineMeasurementTemplateTitle', { tokens: '{{length}}, {{lengthUnit}}' })}
                                    />
                                </div>
                                <div style={s.fieldRow}>
                                    <Label style={s.fieldLabel} title={this.formatMessage('settingPolygonLabelTemplateTitle')}>{this.formatMessage('settingPolygonLabelTemplate')}</Label>
                                    <TextInput
                                        className='w-100'
                                        value={config.measurePolygonLabel || ''}
                                        placeholder={`${this.formatMessage('settingAreaTemplatePlaceholder')} {{area}} {{areaUnit}}`}
                                        onChange={(e) => this.setConfig('measurePolygonLabel', e.target.value)}
                                        aria-label={this.formatMessage('settingPolygonMeasurementTemplateAria')}
                                        title={this.formatMessage('settingPolygonMeasurementTemplateTitle', { tokens: '{{area}}, {{areaUnit}}, {{length}}, {{lengthUnit}}' })}
                                    />
                                </div>
                                <p style={s.sub}>
                                    {this.formatMessage('settingTemplateTokens')} <code>{'{{length}}'}</code>, <code>{'{{lengthUnit}}'}</code>, <code>{'{{area}}'}</code>, <code>{'{{areaUnit}}'}</code>. {this.formatMessage('settingLeaveBlankForDefaults')}
                                </p>
                            </>
                        )}
                    </SettingSection>

                    {/* ================================================================
                        SECTION 9: WIDGET BEHAVIOR
                    ================================================================ */}
                    <SettingSection title={this.formatMessage('settingWidgetBehaviorTitle')}>
                        {/* Default tab */}
                        {myDrawingsEnabled && (
                            <SettingRow>
                                <Label className='w-100'>
                                    {this.formatMessage('settingDefaultTab')}
                                    <Select
                                        value={config.defaultTab || 'draw'}
                                        onChange={(e) => this.setConfig('defaultTab', e.target.value)}
                                        aria-label={this.formatMessage('settingDefaultTabAria')}
                                        title={this.formatMessage('settingDefaultTabTitle')}
                                    >
                                        <Option value='draw'>{this.formatMessage('settingDrawTab')}</Option>
                                        <Option value='mydrawings'>{this.formatMessage('settingMyDrawingsTab')}</Option>
                                    </Select>
                                    <p style={s.sub}>{this.formatMessage('settingDefaultTabTitle')}</p>
                                </Label>
                            </SettingRow>
                        )}

                        {/* Confirm before clear */}
                        {this.renderCheck('confirmBeforeClear', this.formatMessage('settingRequireConfirmationToClear'), true, this.formatMessage('settingConfirmClearDescription'))}

                        {/* Turn off on close */}
                        <div style={{ marginTop: '4px' }}>
                            {this.renderCheck('turnOffOnClose', this.formatMessage('settingStopDrawingOnClose'), false, this.formatMessage('settingStopDrawingOnCloseDescription'))}
                            <p style={{ ...s.sub, marginLeft: '24px' }}>
                                {this.formatMessage('settingStopDrawingOnCloseHint')}
                            </p>
                        </div>
                    </SettingSection>

                </div>

                {/* Side poppers for unit editors */}
                <SidePopper
                    position='right'
                    isOpen={this.state.linearSidePopper}
                    toggle={() => this.setState({ linearSidePopper: !this.state.linearSidePopper })}
                    title={this.formatMessage('settingChangeLinearUnits')}
                    trigger={<span /> as any as HTMLElement}
                >
                    <Alert>{this.formatMessage('settingResetDefaultLinearUnitsNotice')}</Alert>
                    <UnitMaker allUnits={availableDistanceUnits} handleAddUnit={this.handleAddUnit} type={'linear'} nls={this.formatMessage} />
                    {userDistances && userDistances.length > 0 && <div><hr /><h3>{this.formatMessage('settingEditUnits')}</h3></div>}
                    {userDistances && userDistances.map((oldUnit, index) => (
                        <UnitMaker key={index} allUnits={availableDistanceUnits} handleChangeUnit={this.handleChangeUnit} type={'linear'} oldUnit={oldUnit} handleDeleteUnit={this.handleDeleteUnit} nls={this.formatMessage} />
                    ))}
                </SidePopper>
                <SidePopper
                    position='right'
                    isOpen={this.state.areaSidePopper}
                    toggle={() => this.setState({ areaSidePopper: !this.state.areaSidePopper })}
                    title={this.formatMessage('settingChangeAreaUnits')}
                    trigger={<span /> as any as HTMLElement}
                >
                    <Alert>{this.formatMessage('settingResetDefaultAreaUnitsNotice')}</Alert>
                    <UnitMaker allUnits={availableAreaUnits} handleAddUnit={this.handleAddUnit} type={'area'} nls={this.formatMessage} />
                    {userAreas && userAreas.length > 0 && <div><hr /><h3>{this.formatMessage('settingEditUnits')}</h3></div>}
                    {userAreas && userAreas.map((oldUnit, index) => (
                        <UnitMaker key={index} allUnits={availableAreaUnits} handleChangeUnit={this.handleChangeUnit} type={'area'} oldUnit={oldUnit} handleDeleteUnit={this.handleDeleteUnit} nls={this.formatMessage} />
                    ))}
                </SidePopper>
            </div>
        )
    }
}