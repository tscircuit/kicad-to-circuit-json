import type { PcbComponent, PcbRenderLayer, Point } from "circuit-json"
import type { ConverterContext } from "../../../types"

type PcbComponentId = PcbComponent["pcb_component_id"]

/**
 * Emit annotation paths whose points are already in Circuit JSON board world
 * space (mm, +X right, +Y up, +Z above; right-handed). Placement translation
 * and rotation are already applied. This boundary does not transform points.
 */
export function insertFootprintRoute(options: {
  ctx: ConverterContext
  componentId: PcbComponentId
  layer: "top" | "bottom"
  renderLayer: PcbRenderLayer
  route: Point[]
  strokeWidth: number
}) {
  const { ctx, componentId, layer, renderLayer, route, strokeWidth } = options

  if (renderLayer.endsWith("_silkscreen")) {
    ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: componentId,
      layer,
      route,
      stroke_width: strokeWidth,
    })
    return
  }

  if (renderLayer.endsWith("_fabrication_note")) {
    ctx.db.pcb_fabrication_note_path.insert({
      pcb_component_id: componentId,
      layer,
      route,
      stroke_width: strokeWidth,
    })
    return
  }

  ctx.db.pcb_courtyard_outline.insert({
    pcb_component_id: componentId,
    layer,
    outline: route,
  })
}
