import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"
import {
  approximateArcPoints,
  getArcStartMidEnd,
  getGraphicArcs,
  getLayerNames,
  getLineStartEnd,
} from "./arc-utils"
import {
  mapKicadLayerToLayerRef,
  mapKicadLayerToVisibleLayer,
} from "./layer-mapping"

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

/**
 * CollectGraphicsStage processes KiCad graphics elements:
 * - gr_line on Edge.Cuts → pcb_board.outline
 * - gr_text on silk layers → pcb_silkscreen_text
 * - gr_line on silk layers → pcb_silkscreen_path
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

    const edgeCutPrimitives: BoardPrimitive[] = []
    const silkLines: any[] = []
    const silkArcs: any[] = []

    for (const line of lineArray) {
      const layerStr = getLayerNames(line.layer).join(" ")
      if (layerStr.includes("Edge.Cuts")) {
        const { start, end } = getLineStartEnd(line)
        edgeCutPrimitives.push({
          type: "line",
          start,
          end,
        })
      } else if (layerStr.includes("SilkS")) {
        silkLines.push(line)
      }
    }

    for (const arc of arcArray) {
      const layerStr = getLayerNames(arc.layer).join(" ")
      if (layerStr.includes("Edge.Cuts")) {
        const { start, mid, end } = getArcStartMidEnd(arc)
        edgeCutPrimitives.push({
          type: "arc",
          start,
          mid,
          end,
        })
      } else if (layerStr.includes("SilkS")) {
        silkArcs.push(arc)
      }
    }

    // Create board outline from edge cuts
    if (edgeCutPrimitives.length > 0) {
      this.createBoardOutline(edgeCutPrimitives)
    }

    // Create silkscreen paths
    for (const line of silkLines) {
      this.createSilkscreenPath(line)
    }

    for (const arc of silkArcs) {
      this.createSilkscreenArc(arc)
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
      const layer = text.layer
      const layerNames =
        typeof layer === "string" ? [layer] : layer?.names || []
      // Include text from silk, copper, and fab layers
      if (
        layerNames.some(
          (name: string) =>
            name.includes("SilkS") ||
            name.includes(".Cu") ||
            name.includes("Fab"),
        )
      ) {
        this.createSilkscreenText(text)
      }
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
      const kicadPoints =
        segment.type === "arc"
          ? approximateArcPoints(segment.start, segment.mid, segment.end, {
              segmentLength: 0.25,
              minSegments: 16,
            })
          : [segment.start, segment.end]

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

  private createSilkscreenPath(line: any) {
    if (!this.ctx.k2cMatPcb) return

    const { start, end } = getLineStartEnd(line)

    const startPos = applyToPoint(this.ctx.k2cMatPcb, {
      x: start.x,
      y: start.y,
    })
    const endPos = applyToPoint(this.ctx.k2cMatPcb, { x: end.x, y: end.y })

    const layer = mapKicadLayerToVisibleLayer(line.layer)
    const strokeWidth = line.width || 0.15

    this.ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: "", // Not attached to a specific component
      layer: layer,
      route: [startPos, endPos],
      stroke_width: strokeWidth,
    })
  }

  private createSilkscreenArc(arc: any) {
    if (!this.ctx.k2cMatPcb) return

    const { start, mid, end } = getArcStartMidEnd(arc)
    const route = approximateArcPoints(start, mid, end, {
      segmentLength: 0.1,
      minSegments: 8,
    }).map((point) => applyToPoint(this.ctx.k2cMatPcb!, point))

    const layer = mapKicadLayerToVisibleLayer(arc.layer)
    const strokeWidth =
      arc.stroke?.width ?? arc._sxStroke?._sxWidth?.value ?? arc.width ?? 0.15

    this.ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: "",
      layer,
      route,
      stroke_width: strokeWidth,
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

    const layerNames = rect._sxLayer?._names || []
    const layerStr = layerNames.join(" ")

    // Check if this is a filled rectangle on a copper layer
    const isFilled =
      rect._sxFill &&
      (rect._sxFill.isFilled === true ||
        String(rect._sxFill).includes("fill yes"))
    const isCopperLayer = layerStr.includes(".Cu")

    // Only create pcb_smtpad for filled rectangles on copper layers
    if (!isFilled || !isCopperLayer) {
      return
    }

    // Calculate center, width, and height in KiCad coordinates
    const centerKicad = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }
    const widthKicad = Math.abs(end.x - start.x)
    const heightKicad = Math.abs(end.y - start.y)

    // Transform center to Circuit JSON coordinates
    const centerCJ = applyToPoint(this.ctx.k2cMatPcb, centerKicad)

    // Map layer to top/bottom
    const layer = mapKicadLayerToLayerRef(rect._sxLayer)

    // Create pcb_smtpad
    this.ctx.db.pcb_smtpad.insert({
      pcb_component_id: "", // Not attached to a specific component
      x: centerCJ.x,
      y: centerCJ.y,
      width: widthKicad,
      height: heightKicad,
      layer: layer,
      shape: "rect",
      port_hints: [],
    } as any)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.pads = (this.ctx.stats.pads || 0) + 1
    }
  }

  private createSilkscreenText(text: any) {
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

    this.ctx.db.pcb_silkscreen_text.insert({
      pcb_component_id: "",
      text: text.text || text._text || "",
      anchor_position: pos,
      layer: layer,
      font_size: fontSize,
      font: "tscircuit2024",
    } as any)
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
    const layerNames = poly._sxLayer?._names || []
    const layerStr = layerNames.join(" ")

    // Check if this is a filled polygon on a copper layer
    const isFilled = poly._sxFill?.filled === true
    const isCopperLayer = layerStr.includes(".Cu")

    // Only create pcb_smtpad for filled polygons on copper layers
    if (!isFilled || !isCopperLayer) {
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
  }
}
