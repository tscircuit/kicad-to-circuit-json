import type { Footprint } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import { getLayerMapping } from "./layer-utils"
import { substituteKicadVariables } from "./text-utils"

/**
 * Processes all text elements in a footprint (properties and fp_text)
 */
export function processFootprintText(
  ctx: ConverterContext,
  footprint: Footprint,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
) {
  if (!ctx.k2cMatPcb) return

  // Process properties (Reference, Value, etc.) that are on silkscreen layers
  processFootprintProperties(
    ctx,
    footprint,
    componentId,
    kicadComponentPos,
    componentRotation,
  )

  // Process additional fp_text elements
  const texts = footprint.fpTexts || []
  const textArray = Array.isArray(texts) ? texts : [texts]

  for (const text of textArray) {
    // Check if the layer is one we want to process
    const layerMapping = getLayerMapping(text.layer)
    if (!layerMapping.layers[0]?.includes("silkscreen")) continue

    // Create a properly structured text element with _sxPosition mapped to at
    const textElement = {
      text: text.text,
      at: (text as any)._sxPosition || (text as any).at, // Use _sxPosition for position
      layer: text.layer,
      effects: (text as any)._sxEffects || text.effects,
      _sxEffects: (text as any)._sxEffects, // Pass _sxEffects for font size access
    }

    createFootprintText(
      ctx,
      textElement,
      componentId,
      kicadComponentPos,
      componentRotation,
      footprint,
    )
  }
}

/**
 * Processes footprint properties that should be shown on silkscreen
 */
export function processFootprintProperties(
  ctx: ConverterContext,
  footprint: Footprint,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
) {
  if (!ctx.k2cMatPcb) return

  const properties = footprint.properties || []
  const propertyArray = Array.isArray(properties) ? properties : [properties]

  for (const property of propertyArray) {
    // Only process properties with a layer field
    if (!property.layer) continue

    // Check if the property is on a supported layer
    const layerMapping = getLayerMapping(property.layer)
    if (!layerMapping.layers[0]?.includes("silkscreen")) continue

    // Create footprint text for this property
    // Property structure uses _sxAt for position (kicadts internal field)
    const textElement = {
      text: property.value,
      at: (property as any)._sxAt, // Use _sxAt instead of at
      layer: property.layer,
      effects: (property as any)._sxEffects || property.effects,
      _sxEffects: (property as any)._sxEffects, // Pass _sxEffects for font size access
    }

    createFootprintText(
      ctx,
      textElement,
      componentId,
      kicadComponentPos,
      componentRotation,
      footprint,
    )
  }
}

/**
 * Creates a text element in Circuit JSON (silkscreen or fabrication)
 */
export function createFootprintText(
  ctx: ConverterContext,
  text: any,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
  footprint: Footprint,
) {
  if (!ctx.k2cMatPcb) return

  const at = text.at
  // Text position in footprint is relative to footprint position and needs to be rotated
  const textLocalX = at?.x ?? 0
  const textLocalY = at?.y ?? 0

  // Negate rotation to account for Y-axis flip in coordinate transform
  const rotationRad = (-componentRotation * Math.PI) / 180
  const rotatedTextX =
    textLocalX * Math.cos(rotationRad) - textLocalY * Math.sin(rotationRad)
  const rotatedTextY =
    textLocalX * Math.sin(rotationRad) + textLocalY * Math.cos(rotationRad)

  const textKicadPos = {
    x: kicadComponentPos.x + rotatedTextX,
    y: kicadComponentPos.y + rotatedTextY,
  }
  const pos = applyToPoint(ctx.k2cMatPcb, textKicadPos)

  const layerMapping = getLayerMapping(text.layer)

  // Substitute KiCad variables in text
  const processedText = substituteKicadVariables(text.text || "", footprint)

  // Access font size from kicadts internal structure (_sxEffects._sxFont._sxSize._height)
  const kicadFontSize =
    text._sxEffects?._sxFont?._sxSize?._height ||
    text.effects?.font?.size?.y ||
    1

  if (layerMapping.layers[0]?.includes("silkscreen")) {
    ctx.db.pcb_silkscreen_text.insert({
      pcb_component_id: componentId,
      font: "tscircuit2024",
      font_size: kicadFontSize * 1.5,
      text: processedText,
      anchor_position: pos,
      layer: layerMapping.selectedLayer,
      anchor_alignment: "center",
    })
  }
}
