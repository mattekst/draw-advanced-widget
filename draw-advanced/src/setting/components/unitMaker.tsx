import { React } from 'jimu-core'
import { TextInput, NumericInput, Label, Button, CollapsablePanel } from 'jimu-ui'

const { useState, useEffect } = React

const UnitMaker = (props) => {
    const allUnits = props.allUnits
    const type = props.type
    const oldUnit = props.oldUnit

    const [unit, setUnit] = useState(oldUnit?.unit || '')
    const [label, setLabel] = useState(oldUnit?.label || '')
    const [abbreviation, setAbbreviation] = useState(oldUnit?.abbreviation || '')
    const [conversion, setConversion] = useState(oldUnit?.conversion || 1)
    const [allValid, setAllValid] = useState(false)
    const [validityText, setValidityText] = useState('')

    //checks unit for validity
    useEffect(() => {
        let valid = true
        let text = ''
        const letters = /^[a-zA-Z]+$/.test(unit)
        if (unit === '' || label === '' || abbreviation === '') {
            valid = false
            text = props.nls('settingUnitEditorRequiredFieldMissing')
        }
        if (!conversion) {
            valid = false
            text = props.nls('settingUnitEditorInvalidConversion')
        }
        if (!letters) {
            valid = false
            text = props.nls('settingUnitEditorNameLettersOnly')
        }
        for (let i = 0; i < allUnits.length; i++) {
            if (unit === allUnits[i].unit) {
                if (oldUnit && oldUnit.unit === unit) {
                    //intentionally blank
                    continue
                } else {
                    valid = false
                    text = props.nls('settingUnitEditorNameUnique')
                }
            }
        }
        setAllValid(valid)
        setValidityText(text)
    }, [unit, label, abbreviation, conversion])

    return <CollapsablePanel
        defaultIsOpen={!oldUnit}
        label={oldUnit ? props.nls('settingUnitEditorEditDeleteTitle', { label }) : props.nls('settingUnitEditorCreateTitle')}
        type={oldUnit ? 'primary' : 'default'}
        className='mb-2'
    >
        <Label
            className='w-100'
        >
            {props.nls(props.handleChangeUnit ? 'settingUnitEditorNameReadOnly' : 'settingUnitEditorNameNew')}
            <TextInput
                allowClear={!props.handleChangeUnit}
                required
                type='text'
                onChange={(e) => setUnit(e.target.value)}
                defaultValue={unit}
                readOnly={props.handleChangeUnit}
            />
        </Label>
        <Label
            className='w-100'
        >
            {props.nls('settingUnitEditorLabel')}
            <TextInput
                allowClear
                required
                type='text'
                onChange={(e) => setLabel(e.target.value)}
                defaultValue={label}
            />
        </Label>
        <Label
            className='w-100'
        >
            {props.nls('settingUnitEditorAbbreviation')}
            <TextInput
                allowClear
                required
                type='text'
                onChange={(e) => setAbbreviation(e.target.value)}
                defaultValue={abbreviation}
            />
        </Label>
        <Label
            className='w-100'
        >
            {props.nls(type === 'linear' ? 'settingUnitEditorLinearConversion' : 'settingUnitEditorAreaConversion')}
            <NumericInput
                className='w-100'
                required
                defaultValue={conversion}
                onChange={(e) => setConversion(e)}
            />
        </Label>
        {allValid ?
            <div>
                <h6>{props.nls(type === 'linear' ? 'settingUnitEditorLinearPreview' : 'settingUnitEditorAreaPreview', { conversion, label, abbreviation })}</h6>
                <Button
                    block
                    onClick={() => props.handleAddUnit ? props.handleAddUnit({ unit, label, abbreviation, conversion }, type) : props.handleChangeUnit({ unit, label, abbreviation, conversion }, type)}
                >
                    {props.nls('settingUnitEditorSave')}
                </Button>
            </div>
            : <h6>{validityText}</h6>}
        {props.handleDeleteUnit ? 
            <Button
                block
                type='danger'
                onClick={() => props.handleDeleteUnit(unit, type)}
            >
                {props.nls('settingUnitEditorDelete')}
            </Button>
            : <></>
        }
    </CollapsablePanel>
}

export default UnitMaker