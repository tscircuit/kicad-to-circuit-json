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

  // Get reference (component name)
  const reference = getTextValue(footprint, "reference") || footprint.libraryLink || "U?"

  // Create pcb_component
  const uuid = footprint.uuid?.value
  if (!uuid) return

  const inserted = ctx.db.pcb_component.insert({
    center: { x: cjPos.x, y: cjPos.y },
    layer: getComponentLayer(footprint),
    width: 0, // Will be computed from pads if needed
    height: 0,
  } as any)

  const componentId = inserted.pcb_component_id

  // Map footprint UUID to component ID
  ctx.footprintUuidToComponentId?.set(uuid, componentId)

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
