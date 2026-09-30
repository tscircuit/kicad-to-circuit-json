import type {
  PcbCopperText,
  PcbFabricationNoteText,
  PcbRenderLayer,
  PcbSilkscreenText,
} from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import { approximateArcPoints } from "./arc-utils"
import { mapKicadJustifyToAnchorAlignment } from "./CollectFootprintsStage/text-utils"
import {
  extractKicadLayerNames,
  mapKicadLayerToLayerRef,
  mapKicadLayerToPcbRenderLayer,
  mapKicadLayerToVisibleLayer,
} from "./layer-mapping"

function convertKiCadAngleToCircuitJsonCcwRotation(
  rotationDegrees: number | undefined,
): number {
  if (!rotationDegrees) return 0

  const circuitJsonRotation = rotationDegrees % 360
  return circuitJsonRotation < 0
    ? circuitJsonRotation + 360
    : circuitJsonRotation
}

/** Collects board graphics other than paths and Edge.Cuts geometry. */
export class CollectGraphicsStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb) {
      this.finished = true
      return false
    }

    const grRects = this.ctx.kicadPcb.graphicRects || []
    const rectArray = Array.isArray(grRects) ? grRects : [grRects]
    for (const rect of rectArray) this.processRectangle(rect)

    const grPolys = this.ctx.kicadPcb.graphicPolys || []
    const polyArray = Array.isArray(grPolys) ? grPolys : [grPolys]
    for (const poly of polyArray) this.processPolygon(poly)

    const texts = this.ctx.kicadPcb.graphicTexts || []
    const textArray = Array.isArray(texts) ? texts : [texts]
    for (const text of textArray) {
      const renderLayer = mapKicadLayerToPcbRenderLayer(text.layer)
      if (renderLayer) this.createGraphicText(text, renderLayer)
    }

    this.finished = true
    return false
  }

  private processRectangle(rect: any) {
    if (!this.ctx.k2cMatPcb) return

    // Extract rectangle properties from kicadts internal structure
    const start = {
      x: rect._sxStart?._x ?? 0,
      y: rect._sxStart?._y ?? 0,
    }
    const end = {
      x: rect._sxEnd?._x ?? 0,
      y: rect._sxEnd?._y ?? 0,
    }
    const renderLayer = mapKicadLayerToPcbRenderLayer(rect._sxLayer)
    const isFilled =
      rect._sxFill &&
      (rect._sxFill.isFilled === true ||
        String(rect._sxFill).includes("fill yes"))

    // Check if this is a filled rectangle on a copper layer
    const isCopperLayer = renderLayer?.endsWith("_copper")

    // Calculate center, width, and height in KiCad coordinates
    const centerKicad = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }
    const widthKicad = Math.abs(end.x - start.x)
    const heightKicad = Math.abs(end.y - start.y)

    // Transform center to Circuit JSON coordinates
    const centerCJ = applyToPoint(this.ctx.k2cMatPcb, centerKicad)

    // Only create pcb_smtpad for filled rectangles on copper layers
    if (isFilled && isCopperLayer) {
      // Map layer to top/bottom
      const layer = mapKicadLayerToLayerRef(rect._sxLayer)

      // Create pcb_smtpad
      this.ctx.db.pcb_smtpad.insert({
        pcb_component_id: "", // Not attached to a specific component
        x: centerCJ.x,
        y: centerCJ.y,
        width: widthKicad,
        height: heightKicad,
        layer,
        shape: "rect",
        port_hints: [],
      } as any)

      // Update stats
      if (this.ctx.stats) {
        this.ctx.stats.pads = (this.ctx.stats.pads || 0) + 1
      }
      return
    }

    const layer = mapKicadLayerToVisibleLayer(rect._sxLayer)
    const strokeWidth =
      rect.stroke?.width ??
      rect._sxStroke?._sxWidth?.value ??
      rect.width ??
      0.15

    if (renderLayer?.endsWith("_fabrication_note")) {
      this.ctx.db.pcb_fabrication_note_rect.insert({
        pcb_component_id: "",
        center: centerCJ,
        width: widthKicad,
        height: heightKicad,
        layer,
        stroke_width: strokeWidth,
        is_filled: isFilled,
        has_stroke: true,
      })
      return
    }

    if (renderLayer?.endsWith("_courtyard")) {
      this.ctx.db.pcb_courtyard_rect.insert({
        pcb_component_id: "",
        center: centerCJ,
        width: widthKicad,
        height: heightKicad,
        layer,
      })
    }
  }

  private createGraphicText(text: any, renderLayer: PcbRenderLayer) {
    if (!this.ctx.k2cMatPcb) return

    // Get position from either at or _sxPosition (kicadts internal field)
    const at = text.at || text._sxPosition
    const pos = applyToPoint(this.ctx.k2cMatPcb, {
      x: at?.x ?? 0,
      y: at?.y ?? 0,
    })
    const rotation = convertKiCadAngleToCircuitJsonCcwRotation(at?.angle)

    const layer = mapKicadLayerToVisibleLayer(text.layer)

    // Access font size from kicadts internal structure (_sxEffects._sxFont._sxSize._height)
    const kicadFontSize =
      text._sxEffects?._sxFont?._sxSize?._height ||
      text.effects?.font?.size?.y ||
      1
    const textValue = text.text || text._text || ""
    const justify = text._sxEffects?._sxJustify || text.effects?.justify
    const anchorAlignment = mapKicadJustifyToAnchorAlignment(justify)
    const isKnockout = extractKicadLayerNames(text.layer).includes("knockout")

    if (renderLayer.endsWith("_silkscreen")) {
      const silkscreenText = {
        pcb_component_id: "",
        text: textValue,
        anchor_position: pos,
        anchor_alignment: anchorAlignment,
        layer,
        font_size: kicadFontSize,
        font: "tscircuit2024",
        ccw_rotation: rotation || undefined,
      } as PcbSilkscreenText
      if (isKnockout) {
        silkscreenText.is_knockout = true
      }
      this.ctx.db.pcb_silkscreen_text.insert(silkscreenText)
      return
    }

    if (renderLayer.endsWith("_fabrication_note")) {
      const fabricationNoteText = {
        pcb_component_id: "",
        type: "pcb_fabrication_note_text",
        pcb_fabrication_note_text_id: "",
        text: textValue,
        anchor_position: pos,
        anchor_alignment: anchorAlignment,
        layer,
        font_size: kicadFontSize,
        font: "tscircuit2024",
        ccw_rotation: rotation || undefined,
      } as PcbFabricationNoteText
      this.ctx.db.pcb_fabrication_note_text.insert(fabricationNoteText)
      return
    }

    if (renderLayer.endsWith("_copper")) {
      const copperText = {
        pcb_component_id: "",
        text: textValue,
        anchor_position: pos,
        anchor_alignment: anchorAlignment,
        layer,
        font_size: kicadFontSize,
        font: "tscircuit2024",
        ccw_rotation: rotation || undefined,
      } as PcbCopperText
      this.ctx.db.pcb_copper_text.insert(copperText)
    }
  }

  private processPolygon(poly: any) {
    if (!this.ctx.k2cMatPcb) return

    // Extract layer information
    const renderLayer = mapKicadLayerToPcbRenderLayer(poly._sxLayer)

    // Check if this is a filled polygon on a copper layer
    const isFilled = poly._sxFill?.filled === true
    const isCopperLayer = renderLayer?.endsWith("_copper")

    // Only create pcb_smtpad for filled polygons on copper layers
    if (!isFilled && !renderLayer?.endsWith("_courtyard")) {
      return
    }

    // Extract points from the polygon
    const ptsData = poly._sxPts?.points || []
    const points: Array<{ x: number; y: number }> = []

    for (const pt of ptsData) {
      if (pt.token === "xy") {
        // Simple XY point
        points.push({ x: pt.x, y: pt.y })
      } else if (pt.token === "arc") {
        // Arc - convert to multiple points
        const arcPoints = approximateArcPoints({
          start: { x: pt._sxStart?._x, y: pt._sxStart?._y },
          mid: { x: pt._sxMid?._x, y: pt._sxMid?._y },
          end: { x: pt._sxEnd?._x, y: pt._sxEnd?._y },
        })
        points.push(...arcPoints)
      }
    }

    if (points.length < 3) {
      // Need at least 3 points to form a polygon
      return
    }

    // Transform all points to Circuit JSON coordinates
    const transformedPoints = points.map((pt) =>
      applyToPoint(this.ctx.k2cMatPcb!, pt),
    )

    if (isFilled && isCopperLayer) {
      // Map layer to top/bottom
      const layer = mapKicadLayerToLayerRef(poly._sxLayer)

      // Create pcb_smtpad with polygon shape
      this.ctx.db.pcb_smtpad.insert({
        pcb_component_id: "", // Not attached to a specific component
        shape: "polygon",
        points: transformedPoints,
        layer: layer,
        port_hints: [],
      } as any)

      // Update stats
      if (this.ctx.stats) {
        this.ctx.stats.pads = (this.ctx.stats.pads || 0) + 1
      }
      return
    }

    if (renderLayer?.endsWith("_courtyard")) {
      const layer = mapKicadLayerToVisibleLayer(poly._sxLayer)
      this.ctx.db.pcb_courtyard_outline.insert({
        pcb_component_id: "",
        layer,
        outline: transformedPoints,
      })
    }
  }
}
