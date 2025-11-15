import type { Footprint } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import { getComponentLayer } from "./layer-utils"
import { getTextValue } from "./text-utils"
import { processPads } from "./process-pads"
import { processFootprintText } from "./process-text"
import { processFootprintGraphics } from "./process-graphics"

/**
 * Processes a complete footprint and creates all associated Circuit JSON elements
 * (component, pads, text, and graphics)
 */
export function processFootprint(ctx: ConverterContext, footprint: Footprint) {
  if (!ctx.k2cMatPcb) return

  // Get footprint position and rotation
  const position = footprint.position
  const kicadPos = { x: position?.x ?? 0, y: position?.y ?? 0 }
  const cjPos = applyToPoint(ctx.k2cMatPcb, kicadPos)
  const rotation = (position as any)?.angle ?? 0

  // Get footprint UUID
  const uuid = footprint.uuid?.value || footprint.tstamp?.value
  if (!uuid) return

  // Get the reference and value from footprint properties
  const refdes = getFootprintReference(footprint)
  const value = getFootprintValue(footprint)

  // Infer component type from reference prefix
  const ftype = inferComponentType(refdes)

  // Create source_component with type-specific properties
  const sourceComponentData: any = {
    name: refdes || "U",
    ftype: ftype,
  }

  // Add type-specific value properties based on ftype
  if (value) {
    // Sanitize value: replace comma with dot for numeric parsing (e.g., "5,1K" -> "5.1K")
    const sanitizedValue = value.replace(/,/g, ".")

    switch (ftype) {
      case "simple_resistor":
        sourceComponentData.resistance = sanitizedValue
        break
      case "simple_capacitor":
        sourceComponentData.capacitance = sanitizedValue
        break
      case "simple_inductor":
        sourceComponentData.inductance = sanitizedValue
        break
      // For other types (chips, diodes, transistors, etc.), don't add value properties
    }
  }

  const sourceComponent = ctx.db.source_component.insert(sourceComponentData)

  const sourceComponentId = sourceComponent.source_component_id

  // Create pcb_component linked to source_component
  const inserted = ctx.db.pcb_component.insert({
    center: { x: cjPos.x, y: cjPos.y },
    layer: getComponentLayer(footprint),
    rotation: -rotation, // Negate rotation due to Y-axis flip in coordinate transform
    width: 0, // Will be computed from pads if needed
    height: 0,
    source_component_id: sourceComponentId,
  } as any)

  const componentId = inserted.pcb_component_id

  // Map footprint UUID to component ID and source component ID
  ctx.footprintUuidToComponentId?.set(uuid, componentId)
  ctx.footprintUuidToSourceComponentId?.set(uuid, sourceComponentId)

  // Process pads - pass KiCad position for correct transformation
  processPads(ctx, footprint, componentId, kicadPos, rotation)

  // Process footprint text as silkscreen - pass KiCad position and rotation for correct transformation
  processFootprintText(ctx, footprint, componentId, kicadPos, rotation)

  // Process footprint graphics (fp_line, fp_circle, fp_arc) as silkscreen
  processFootprintGraphics(ctx, footprint, componentId, kicadPos, rotation)

  // Update stats
  if (ctx.stats) {
    ctx.stats.components = (ctx.stats.components || 0) + 1
  }
}

/**
 * Extracts the reference designator from a footprint (e.g., "R1", "C2", "U3")
 */
function getFootprintReference(footprint: Footprint): string | undefined {
  // Try to get reference from properties first
  const properties = footprint.properties || []
  const propertyArray = Array.isArray(properties) ? properties : [properties]

  for (const property of propertyArray) {
    if (
      (property as any).key === "Reference" ||
      (property as any).name === "Reference"
    ) {
      return (property as any).value
    }
  }

  // Fallback: try fpTexts
  const textItems = footprint.fpTexts || []
  const textArray = Array.isArray(textItems) ? textItems : [textItems]

  for (const text of textArray) {
    // FpText objects have a type field that indicates reference/value
    if ((text as any).type === "reference") {
      return text.text
    }
  }

  return undefined
}

/**
 * Extracts the value from a footprint (e.g., "10k", "100nF", "STM32")
 */
function getFootprintValue(footprint: Footprint): string | undefined {
  // Try to get value from properties first
  const properties = footprint.properties || []
  const propertyArray = Array.isArray(properties) ? properties : [properties]

  for (const property of propertyArray) {
    if (
      (property as any).key === "Value" ||
      (property as any).name === "Value"
    ) {
      return (property as any).value
    }
  }

  // Fallback: try fpTexts
  const textItems = footprint.fpTexts || []
  const textArray = Array.isArray(textItems) ? textItems : [textItems]

  for (const text of textArray) {
    if ((text as any).type === "value") {
      return text.text
    }
  }

  return undefined
}

/**
 * Infers the component type (ftype) from the reference designator
 */
function inferComponentType(reference: string | undefined): string {
  if (!reference) return "simple_chip"

  const prefix = reference.match(/^([A-Z]+)/)?.[1]

  switch (prefix) {
    case "R":
      return "simple_resistor"
    case "C":
      return "simple_capacitor"
    case "L":
      return "simple_inductor"
    case "D":
      return "simple_diode"
    case "LED":
      return "simple_diode"
    case "Q":
      return "simple_transistor"
    case "U":
    case "IC":
      return "simple_chip"
    case "J":
    case "P":
      return "simple_chip" // Connectors treated as chips
    default:
      return "simple_chip"
  }
}
