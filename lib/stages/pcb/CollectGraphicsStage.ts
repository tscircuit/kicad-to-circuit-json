import { ConverterStage } from "../../types"
import type {
  PcbCopperText,
  PcbFabricationNoteText,
  PcbRenderLayer,
  PcbSilkscreenText,
} from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import {
  approximateArcPoints,
  approximateCirclePoints,
  approximateCubicBezierPoints,
  getArcStartMidEnd,
  getCircleCenterEnd,
  getGraphicArcs,
  getGraphicCircles,
  getGraphicCurves,
  getCurvePoints,
  getGraphicLayerNames,
  getLineStartEnd,
} from "./arc-utils"
import {
  mapKicadLayerToPcbRenderLayer,
  mapKicadLayerToLayerRef,
  mapKicadLayerToVisibleLayer,
} from "./layer-mapping"
import { mapKicadJustifyToAnchorAlignment } from "./CollectFootprintsStage/text-utils"

type BoardPrimitive =
  | {
      type: "line"
      start: { x: number; y: number }
      end: { x: number; y: number }
    }
  | {
      type: "arc"
      start: { x: number; y: number }
      mid: { x: number; y: number }
      end: { x: number; y: number }
    }
  | {
      type: "circle"
      center: { x: number; y: number }
      start: { x: number; y: number }
      end: { x: number; y: number }
    }
  | {
      type: "curve"
      start: { x: number; y: number }
      control1: { x: number; y: number }
      control2: { x: number; y: number }
      end: { x: number; y: number }
    }

/**
 * CollectGraphicsStage processes KiCad graphics elements:
 * - gr_line on Edge.Cuts → pcb_board.outline
 * - gr_text on silk/fab layers → matching silkscreen/fabrication output
 * - gr_line/gr_arc on silk/fab/courtyard layers → matching PCB output
 * - gr_rect on copper layers (filled) → pcb_smtpad
 * - gr_poly on copper layers (filled) → pcb_smtpad (polygon)
 */
export class CollectGraphicsStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb) {
      this.finished = true
      return false
    }

    // Process gr_line elements
    const lines = this.ctx.kicadPcb.graphicLines || []
    const lineArray = Array.isArray(lines) ? lines : [lines]
    const arcArray = getGraphicArcs(this.ctx.kicadPcb)
    const circleArray = getGraphicCircles(this.ctx.kicadPcb)
    const curveArray = getGraphicCurves(this.ctx.kicadPcb)

    const edgeCutPrimitives: BoardPrimitive[] = []

    for (const line of lineArray) {
      const layerStr = getGraphicLayerNames(line).join(" ")
      if (layerStr.includes("Edge.Cuts")) {
        const { start, end } = getLineStartEnd(line)
        edgeCutPrimitives.push({
          type: "line",
          start,
          end,
        })
      } else if (
        layerStr.includes("SilkS") ||
        layerStr.includes("Fab") ||
        layerStr.includes("CrtYd")
      ) {
        const renderLayer = mapKicadLayerToPcbRenderLayer(line.layer)
        if (renderLayer) this.createGraphicPath(line, renderLayer)
      }
    }
    // Process gr_arc elements
    for (const arc of arcArray) {
      const layerStr = getGraphicLayerNames(arc).join(" ")
      if (layerStr.includes("Edge.Cuts")) {
        const { start, mid, end } = getArcStartMidEnd(arc)
        edgeCutPrimitives.push({
          type: "arc",
          start,
          mid,
          end,
        })
      } else if (
        layerStr.includes("SilkS") ||
        layerStr.includes("Fab") ||
        layerStr.includes("CrtYd")
      ) {
        const renderLayer = mapKicadLayerToPcbRenderLayer(arc.layer)
        if (renderLayer) this.createGraphicArc(arc, renderLayer)
      }
    }

    // Process gr_circle elements
    for (const circle of circleArray) {
      const layerStr = getGraphicLayerNames(circle).join(" ")
      if (!layerStr.includes("Edge.Cuts")) continue

      const { center, end } = getCircleCenterEnd(circle)
      edgeCutPrimitives.push({
        type: "circle",
        center,
        start: end,
        end,
      })
    }

    // Process gr_curve elements
    for (const curve of curveArray) {
      const layerStr = getGraphicLayerNames(curve).join(" ")
      if (!layerStr.includes("Edge.Cuts")) continue

      const points = getCurvePoints(curve)
      if (!points) continue

      edgeCutPrimitives.push({
        type: "curve",
        start: points.start,
        control1: points.control1,
        control2: points.control2,
        end: points.end,
      })
    }

    // Create board outline from edge cuts
    if (edgeCutPrimitives.length > 0) {
      this.createBoardOutline(edgeCutPrimitives)
    }

    // Process gr_rect elements
    const grRects = this.ctx.kicadPcb.graphicRects || []
    for (const rect of grRects) {
      this.processRectangle(rect)
    }

    // Process gr_poly elements
    const grPolys = this.ctx.kicadPcb.graphicPolys || []
    const polyArray = Array.isArray(grPolys) ? grPolys : [grPolys]
    for (const poly of polyArray) {
      this.processPolygon(poly)
    }

    // Process gr_text elements
    const texts = this.ctx.kicadPcb.graphicTexts || []
    const textArray = Array.isArray(texts) ? texts : [texts]
    for (const text of textArray) {
      const renderLayer = mapKicadLayerToPcbRenderLayer(text.layer)
      if (renderLayer) this.createGraphicText(text, renderLayer)
    }

    this.finished = true
    return false
  }

  private createBoardOutline(primitives: BoardPrimitive[]) {
    if (!this.ctx.k2cMatPcb) return

    // Chain the segments together to form a continuous outline
    const orderedSegments: BoardPrimitive[] = []
    const remainingSegments = [...primitives]

    // Start with the first segment
    if (remainingSegments.length > 0) {
      orderedSegments.push(remainingSegments.shift()!)

      // Keep finding connected segments until we can't find any more
      while (remainingSegments.length > 0) {
        const lastSegment = orderedSegments[orderedSegments.length - 1]!
        const lastEnd = lastSegment.end

        // Find a segment that starts where the last one ended
        let foundIndex = remainingSegments.findIndex((seg) =>
          this.pointsEqualKicad(seg.start, lastEnd),
        )

        // If not found, try to find one that ends where the last one ended (reverse it)
        if (foundIndex === -1) {
          foundIndex = remainingSegments.findIndex((seg) =>
            this.pointsEqualKicad(seg.end, lastEnd),
          )
          if (foundIndex !== -1) {
            const seg = remainingSegments[foundIndex]!
            orderedSegments.push(
              seg.type === "arc"
                ? {
                    type: "arc",
                    start: seg.end,
                    mid: seg.mid,
                    end: seg.start,
                  }
                : seg.type === "circle"
                  ? {
                      type: "circle",
                      center: seg.center,
                      start: seg.end,
                      end: seg.start,
                    }
                  : seg.type === "curve"
                    ? {
                        type: "curve",
                        start: seg.end,
                        control1: seg.control2,
                        control2: seg.control1,
                        end: seg.start,
                      }
                    : {
                        type: "line",
                        start: seg.end,
                        end: seg.start,
                      },
            )
            remainingSegments.splice(foundIndex, 1)
            continue
          }
        }

        if (foundIndex !== -1) {
          orderedSegments.push(remainingSegments.splice(foundIndex, 1)[0]!)
        } else {
          // Can't find a connected segment, just add the next one
          orderedSegments.push(remainingSegments.shift()!)
        }
      }
    }

    // Now convert the ordered segments to points in Circuit JSON coordinates
    const points: Array<{ x: number; y: number }> = []

    for (const segment of orderedSegments) {
      let kicadPoints: Array<{ x: number; y: number }>

      if (segment.type === "arc") {
        kicadPoints = approximateArcPoints(
          segment.start,
          segment.mid,
          segment.end,
          {
            segmentLength: 0.25,
            minSegments: 16,
          },
        )
      } else if (segment.type === "circle") {
        kicadPoints = approximateCirclePoints(segment.center, segment.end, {
          segmentLength: 0.25,
          minSegments: 16,
        })
      } else if (segment.type === "curve") {
        kicadPoints = approximateCubicBezierPoints(
          segment.start,
          segment.control1,
          segment.control2,
          segment.end,
          {
            segmentLength: 0.25,
            minSegments: 16,
          },
        )
      } else {
        kicadPoints = [segment.start, segment.end]
      }

      for (const kicadPoint of kicadPoints) {
        const point = applyToPoint(this.ctx.k2cMatPcb, kicadPoint)
        const lastPoint = points[points.length - 1]
        if (!lastPoint || !this.pointsEqual(lastPoint, point)) {
          points.push(point)
        }
      }
    }

    // Create pcb_board with outline
    // Check if board already exists
    const existingBoard = this.ctx.db.pcb_board.list()[0]
    if (existingBoard) {
      // Update outline
      existingBoard.outline = points
      existingBoard.width = this.calculateWidth(points)
      existingBoard.height = this.calculateHeight(points)
    } else {
      // Create new board
      this.ctx.db.pcb_board.insert({
        outline: points,
        width: this.calculateWidth(points),
        height: this.calculateHeight(points),
      } as any)
    }
  }

  private createGraphicPath(line: any, renderLayer: PcbRenderLayer) {
    if (!this.ctx.k2cMatPcb) return

    const { start, end } = getLineStartEnd(line)
    const startPos = applyToPoint(this.ctx.k2cMatPcb, start)
    const endPos = applyToPoint(this.ctx.k2cMatPcb, end)
    const layer = mapKicadLayerToVisibleLayer(line.layer)
    const strokeWidth = line.width || 0.15

    this.insertRouteGraphic({
      layer,
      renderLayer,
      pcbComponentId: "",
      route: [startPos, endPos],
      strokeWidth,
    })
  }

  private createGraphicArc(arc: any, renderLayer: PcbRenderLayer) {
    if (!this.ctx.k2cMatPcb) return

    const { start, mid, end } = getArcStartMidEnd(arc)
    const route = approximateArcPoints(start, mid, end, {
      segmentLength: 0.1,
      minSegments: 8,
    }).map((point) => applyToPoint(this.ctx.k2cMatPcb!, point))

    const layer = mapKicadLayerToVisibleLayer(arc.layer)
    const strokeWidth =
      arc.stroke?.width ?? arc._sxStroke?._sxWidth?.value ?? arc.width ?? 0.15

    this.insertRouteGraphic({
      layer,
      renderLayer,
      pcbComponentId: "",
      route,
      strokeWidth,
    })
  }

  private insertRouteGraphic(options: {
    layer: "top" | "bottom"
    renderLayer: PcbRenderLayer
    pcbComponentId: string
    route: Array<{ x: number; y: number }>
    strokeWidth: number
  }) {
    const { layer, renderLayer, pcbComponentId, route, strokeWidth } = options

    if (renderLayer.endsWith("_silkscreen")) {
      this.ctx.db.pcb_silkscreen_path.insert({
        pcb_component_id: pcbComponentId,
        layer,
        route,
        stroke_width: strokeWidth,
      })
      return
    }

    if (renderLayer.endsWith("_fabrication_note")) {
      this.ctx.db.pcb_fabrication_note_path.insert({
        pcb_component_id: pcbComponentId,
        layer,
        route,
        stroke_width: strokeWidth,
      })
      return
    }

    this.ctx.db.pcb_courtyard_outline.insert({
      pcb_component_id: pcbComponentId,
      layer,
      outline: route,
    })
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

    const layer = mapKicadLayerToVisibleLayer(text.layer)

    // Access font size from kicadts internal structure (_sxEffects._sxFont._sxSize._height)
    const kicadFontSize =
      text._sxEffects?._sxFont?._sxSize?._height ||
      text.effects?.font?.size?.y ||
      1
    const fontSize = kicadFontSize * 1.5
    const textValue = text.text || text._text || ""
    const justify = text._sxEffects?._sxJustify || text.effects?.justify
    const anchorAlignment = mapKicadJustifyToAnchorAlignment(justify)

    if (renderLayer.endsWith("_silkscreen")) {
      this.ctx.db.pcb_silkscreen_text.insert({
        pcb_component_id: "",
        text: textValue,
        anchor_position: pos,
        anchor_alignment: anchorAlignment,
        layer,
        font_size: fontSize,
        font: "tscircuit2024",
      } as PcbSilkscreenText)
      return
    }

    if (renderLayer.endsWith("_fabrication_note")) {
      this.ctx.db.pcb_fabrication_note_text.insert({
        pcb_component_id: "",
        text: textValue,
        anchor_position: pos,
        anchor_alignment: anchorAlignment,
        layer,
        font_size: fontSize,
        font: "tscircuit2024",
      } as PcbFabricationNoteText)
      return
    }

    if (renderLayer.endsWith("_copper")) {
      this.ctx.db.pcb_copper_text.insert({
        pcb_component_id: "",
        text: textValue,
        anchor_position: pos,
        anchor_alignment: anchorAlignment,
        layer,
        font_size: fontSize,
        font: "tscircuit2024",
      } as PcbCopperText)
    }
  }

  private pointsEqual(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ): boolean {
    const epsilon = 0.001
    return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon
  }

  private pointsEqualKicad(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ): boolean {
    const epsilon = 0.001
    return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon
  }

  private calculateWidth(points: Array<{ x: number; y: number }>): number {
    if (points.length === 0) return 0
    const xs = points.map((p) => p.x)
    return Math.max(...xs) - Math.min(...xs)
  }

  private calculateHeight(points: Array<{ x: number; y: number }>): number {
    if (points.length === 0) return 0
    const ys = points.map((p) => p.y)
    return Math.max(...ys) - Math.min(...ys)
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
        const arcPoints = approximateArcPoints(
          { x: pt._sxStart?._x, y: pt._sxStart?._y },
          { x: pt._sxMid?._x, y: pt._sxMid?._y },
          { x: pt._sxEnd?._x, y: pt._sxEnd?._y },
        )
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
