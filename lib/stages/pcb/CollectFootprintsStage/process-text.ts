import type { Footprint } from "kicadts"
import type {
  PcbCopperText,
  PcbFabricationNoteText,
  PcbRenderLayer,
  PcbSilkscreenText,
} from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext, FootprintPlacement } from "../../../types"
import {
  isPcbTextRenderLayer,
  mapKicadLayerToPcbRenderLayer,
} from "../layer-mapping"
import { mapTextLayer } from "./layer-utils"
import {
  substituteKicadVariables,
  mapKicadJustifyToAnchorAlignment,
} from "./text-utils"

function convertKiCadAngleToCircuitJsonCcwRotation(
  rotationDegrees: number | undefined,
): number {
  if (!rotationDegrees) return 0

  const circuitJsonRotation = rotationDegrees % 360
  return circuitJsonRotation < 0
    ? circuitJsonRotation + 360
    : circuitJsonRotation
}

function isKicadTextHidden(text: any): boolean {
  return text.hidden === true || text._sxHide?.value === true
}

const KICAD_TEXT_HEIGHT_TO_CIRCUIT_JSON_FONT_SIZE = 1
const TEXT_POSITION_EPSILON = 1e-6

function getPropertyKey(property: any): string {
  return String(property?._key ?? property?.key ?? property?.name ?? "")
}

function getFpTextKind(text: any): string {
  return String(text?._type ?? text?.type ?? text?.kind ?? "")
}

function getKiCadTextAnchor(text: any) {
  return text?._sxPosition || text?.at || text?._sxAt
}

function areKiCadTextAnchorsAtSamePosition(a: any, b: any): boolean {
  return (
    Math.abs((a?.x ?? 0) - (b?.x ?? 0)) < TEXT_POSITION_EPSILON &&
    Math.abs((a?.y ?? 0) - (b?.y ?? 0)) < TEXT_POSITION_EPSILON
  )
}

function isFabTextSameLabelAndPositionAsVisibleSilkscreenText(
  text: any,
  footprint: Footprint,
): boolean {
  const renderLayer = mapKicadLayerToPcbRenderLayer(text.layer)
  if (!renderLayer?.endsWith("_fabrication_note")) return false

  const textValue = substituteKicadVariables(text.text || "", footprint)
  const textAt = getKiCadTextAnchor(text)

  const properties = footprint.properties || []
  const propertyArray = Array.isArray(properties) ? properties : [properties]

  const hasMatchingSilkscreenProperty = propertyArray.some((property) => {
    const propertyLayer = mapKicadLayerToPcbRenderLayer(property.layer)
    if (!propertyLayer?.endsWith("_silkscreen")) return false
    if (isKicadTextHidden(property)) return false
    if (property.value !== textValue) return false

    return areKiCadTextAnchorsAtSamePosition(
      textAt,
      getKiCadTextAnchor(property),
    )
  })

  if (hasMatchingSilkscreenProperty) return true

  const texts = footprint.fpTexts || []
  const textArray = Array.isArray(texts) ? texts : [texts]

  return textArray.some((otherText) => {
    const otherLayer = mapKicadLayerToPcbRenderLayer(otherText.layer)
    if (!otherLayer?.endsWith("_silkscreen")) return false
    if (isKicadTextHidden(otherText)) return false
    if (
      substituteKicadVariables(otherText.text || "", footprint) !== textValue
    ) {
      return false
    }

    return areKiCadTextAnchorsAtSamePosition(
      textAt,
      getKiCadTextAnchor(otherText),
    )
  })
}

/**
 * Processes all text elements in a footprint (properties and fp_text)
 */
export function processFootprintText(params: {
  ctx: ConverterContext
  footprint: Footprint
  componentId: string
  footprintPlacement: FootprintPlacement
}) {
  const { ctx, footprint, componentId, footprintPlacement } = params
  if (!ctx.k2cMatPcb) return

  // Process properties (Reference, Value, etc.) that are on silkscreen/fabrication layers
  processFootprintProperties({
    ctx,
    footprint,
    componentId,
    footprintPlacement,
  })

  // Process additional fp_text elements
  const texts = footprint.fpTexts || []
  const textArray = Array.isArray(texts) ? texts : [texts]

  for (const text of textArray) {
    if (isKicadTextHidden(text)) continue
    if (isFabTextSameLabelAndPositionAsVisibleSilkscreenText(text, footprint)) {
      continue
    }

    // Only process text on silkscreen/fabrication layers
    const renderLayer = mapKicadLayerToPcbRenderLayer(text.layer)
    if (!isPcbTextRenderLayer(renderLayer)) continue

    // Create a properly structured text element with _sxPosition mapped to at
    const textElement = {
      text: text.text,
      at: getKiCadTextAnchor(text), // Use _sxPosition for position
      layer: text.layer,
      effects: (text as any)._sxEffects || text.effects,
      _sxEffects: (text as any)._sxEffects, // Pass _sxEffects for font size access
    }

    createGraphicText({
      ctx,
      textElement,
      renderLayer,
      componentId,
      footprint,
      footprintPlacement,
      isReferenceText:
        ctx.standaloneFootprintConversion &&
        getFpTextKind(text) === "reference",
    })
  }
}

/**
 * Processes footprint properties that should be shown on silkscreen/fabrication
 */
export function processFootprintProperties(params: {
  ctx: ConverterContext
  footprint: Footprint
  componentId: string
  footprintPlacement: FootprintPlacement
}) {
  const { ctx, footprint, componentId, footprintPlacement } = params
  if (!ctx.k2cMatPcb) return

  const properties = footprint.properties || []
  const propertyArray = Array.isArray(properties) ? properties : [properties]

  for (const property of propertyArray) {
    // Only process properties with a layer field
    if (!property.layer) continue

    // Check if the property is on a silkscreen/fabrication layer
    const renderLayer = mapKicadLayerToPcbRenderLayer(property.layer)
    const isPropertyHidden = isKicadTextHidden(property)
    if (!isPcbTextRenderLayer(renderLayer) || isPropertyHidden) continue

    // Create text for this property
    // Property structure uses _sxAt for position (kicadts internal field)
    const textElement = {
      text: property.value,
      at: getKiCadTextAnchor(property),
      layer: property.layer,
      effects: (property as any)._sxEffects || property.effects,
      _sxEffects: (property as any)._sxEffects, // Pass _sxEffects for font size access
    }

    createGraphicText({
      ctx,
      textElement,
      renderLayer,
      componentId,
      footprint,
      footprintPlacement,
      isReferenceText:
        ctx.standaloneFootprintConversion &&
        getPropertyKey(property) === "Reference",
    })
  }
}

/**
 * Creates a footprint text element in the matching Circuit JSON output type
 */
export function createGraphicText(params: {
  ctx: ConverterContext
  textElement: any
  renderLayer: PcbRenderLayer
  componentId: string
  footprint: Footprint
  footprintPlacement: FootprintPlacement
  isReferenceText?: boolean
}) {
  const {
    ctx,
    textElement,
    renderLayer,
    componentId,
    footprint,
    footprintPlacement,
    isReferenceText = false,
  } = params
  if (!ctx.k2cMatPcb) return

  const at = textElement.at
  // Text position in footprint is relative to footprint position and needs to be rotated
  const textLocalX = at?.x ?? 0
  const textLocalY = at?.y ?? 0

  // Negate rotation to account for Y-axis flip in coordinate transform
  const rotationRad =
    (-footprintPlacement.componentCcwRotationDegrees * Math.PI) / 180
  const rotatedTextX =
    textLocalX * Math.cos(rotationRad) - textLocalY * Math.sin(rotationRad)
  const rotatedTextY =
    textLocalX * Math.sin(rotationRad) + textLocalY * Math.cos(rotationRad)

  const textKicadPos = {
    x: footprintPlacement.kicadComponentPos.x + rotatedTextX,
    y: footprintPlacement.kicadComponentPos.y + rotatedTextY,
  }
  const pos = applyToPoint(ctx.k2cMatPcb, textKicadPos)

  const layer = mapTextLayer(textElement.layer)

  // Substitute KiCad variables in text
  const processedText = substituteKicadVariables(
    textElement.text || "",
    footprint,
  )

  // Access font size from kicadts internal structure (_sxEffects._sxFont._sxSize._height)
  const kicadFontSize =
    textElement._sxEffects?._sxFont?._sxSize?._height ||
    textElement.effects?.font?.size?.y ||
    1
  const fontSize = kicadFontSize * KICAD_TEXT_HEIGHT_TO_CIRCUIT_JSON_FONT_SIZE
  const ccwRotation = isReferenceText
    ? 0
    : convertKiCadAngleToCircuitJsonCcwRotation(at?.angle)
  const justify =
    textElement._sxEffects?._sxJustify || textElement.effects?.justify
  const anchorAlignment = mapKicadJustifyToAnchorAlignment(justify)

  if (renderLayer.endsWith("_silkscreen")) {
    ctx.db.pcb_silkscreen_text.insert({
      pcb_component_id: componentId,
      font: "tscircuit2024",
      font_size: fontSize,
      text: processedText,
      anchor_position: pos,
      anchor_alignment: anchorAlignment,
      layer,
      ccw_rotation: ccwRotation || undefined,
    } as PcbSilkscreenText)
    return
  }

  if (renderLayer.endsWith("_fabrication_note")) {
    ctx.db.pcb_fabrication_note_text.insert({
      type: "pcb_fabrication_note_text",
      pcb_fabrication_note_text_id: "",
      pcb_component_id: componentId,
      font: "tscircuit2024",
      font_size: fontSize,
      text: processedText,
      anchor_position: pos,
      anchor_alignment: anchorAlignment,
      layer: layer,
    } as PcbFabricationNoteText)
    return
  }

  if (renderLayer.endsWith("_copper")) {
    ctx.db.pcb_copper_text.insert({
      pcb_component_id: componentId,
      font: "tscircuit2024",
      font_size: fontSize,
      text: processedText,
      anchor_position: pos,
      anchor_alignment: anchorAlignment,
      layer: layer,
      ccw_rotation: ccwRotation || undefined,
    } as PcbCopperText)
  }
}
