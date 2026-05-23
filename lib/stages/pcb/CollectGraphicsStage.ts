import type {
  PcbCopperText,
  PcbFabricationNoteText,
  PcbRenderLayer,
  PcbSilkscreenText,
} from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import {
  approximateArcPoints,
  approximateCirclePoints,
  approximateCubicBezierPoints,
  getArcStartMidEnd,
  getCircleCenterEnd,
  getCurvePoints,
  getGraphicArcs,
  getGraphicCircles,
  getGraphicCurves,
  getGraphicLayerNames,
  getLineStartEnd,
  getPcbPoint,
} from "./arc-utils"
import { rotatePoint } from "./CollectFootprintsStage/process-graphics"
import { mapKicadJustifyToAnchorAlignment } from "./CollectFootprintsStage/text-utils"
import {
  extractKicadLayerNames,
  getPcbCopperLayerCount,
  mapKicadLayerToLayerRef,
  mapKicadLayerToPcbRenderLayer,
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

interface BoardContour {
  primitives: BoardPrimitive[]
  points: Array<{ x: number; y: number }>
  area: number
}

const EDGE_CUT_POINT_EPSILON = 0.01
const KICAD_TEXT_HEIGHT_TO_CIRCUIT_JSON_FONT_SIZE = 2 / 3

function convertKiCadAngleToCircuitJsonCcwRotation(
  rotationDegrees: number | undefined,
): number {
  if (!rotationDegrees) return 0

  const circuitJsonRotation = rotationDegrees % 360
  return circuitJsonRotation < 0
    ? circuitJsonRotation + 360
    : circuitJsonRotation
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
    const grRects = this.ctx.kicadPcb.graphicRects || []
    const rectArray = Array.isArray(grRects) ? grRects : [grRects]

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

    for (const rect of rectArray) {
      const layerStr = getGraphicLayerNames(rect).join(" ")
      if (!layerStr.includes("Edge.Cuts")) continue

      edgeCutPrimitives.push(...this.getRectEdgeCutPrimitives(rect))
    }

    edgeCutPrimitives.push(...this.getFootprintEdgeCutPrimitives())

    // Create board outline from edge cuts
    if (edgeCutPrimitives.length > 0) {
      this.createBoardOutline(edgeCutPrimitives)
    }

    // Process gr_rect elements
    for (const rect of rectArray) {
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

    const contours = this.createBoardContours(primitives)
    if (contours.length === 0) return

    const boardContour = contours.reduce((largestContour, contour) =>
      contour.area > largestContour.area ? contour : largestContour,
    )
    const points = boardContour.points
    const numLayers = getPcbCopperLayerCount(this.ctx.kicadPcb)

    for (const contour of contours) {
      if (contour === boardContour) continue
      this.createEdgeCutCutout(contour)
    }

    // Create pcb_board with outline
    // Check if board already exists
    const existingBoard = this.ctx.db.pcb_board.list()[0]
    if (existingBoard) {
      // Update outline
      existingBoard.outline = points
      existingBoard.width = this.calculateWidth(points)
      existingBoard.height = this.calculateHeight(points)
      existingBoard.num_layers = numLayers
    } else {
      // Create new board
      this.ctx.db.insert({
        type: "pcb_board",
        center: { x: 0, y: 0 },
        outline: points,
        width: this.calculateWidth(points),
        height: this.calculateHeight(points),
        num_layers: numLayers,
      })
    }
  }

  private createBoardContours(primitives: BoardPrimitive[]): BoardContour[] {
    const orderedContours = this.orderConnectedContours(primitives)
    return orderedContours
      .map((contourPrimitives) => {
        const points = this.getBoardContourPoints(contourPrimitives)
        return {
          primitives: contourPrimitives,
          points,
          area: Math.abs(this.calculatePolygonArea(points)),
        }
      })
      .filter((contour) => contour.points.length > 0)
  }

  private getFootprintEdgeCutPrimitives(): BoardPrimitive[] {
    const footprints = this.ctx.kicadPcb?.footprints || []
    const footprintArray = Array.isArray(footprints) ? footprints : [footprints]
    const primitives: BoardPrimitive[] = []

    for (const footprint of footprintArray) {
      const position = footprint.position
      const footprintPosition = getPcbPoint(position)
      const footprintRotation = (position as any)?.angle ?? 0

      const fpLines = footprint.fpLines || []
      const fpLineArray = Array.isArray(fpLines) ? fpLines : [fpLines]
      for (const line of fpLineArray) {
        const layerStr = getGraphicLayerNames(line).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const { start, end } = getLineStartEnd(line as any)
        primitives.push(
          this.transformFootprintPrimitive(
            {
              type: "line",
              start,
              end,
            },
            footprintPosition,
            footprintRotation,
          ),
        )
      }

      const fpArcs = footprint.fpArcs || []
      const fpArcArray = Array.isArray(fpArcs) ? fpArcs : [fpArcs]
      for (const arc of fpArcArray) {
        const layerStr = getGraphicLayerNames(arc).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const { start, mid, end } = getArcStartMidEnd(arc as any)
        primitives.push(
          this.transformFootprintPrimitive(
            {
              type: "arc",
              start,
              mid,
              end,
            },
            footprintPosition,
            footprintRotation,
          ),
        )
      }

      const fpCircles = footprint.fpCircles || []
      const fpCircleArray = Array.isArray(fpCircles) ? fpCircles : [fpCircles]
      for (const circle of fpCircleArray) {
        const layerStr = getGraphicLayerNames(circle).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const { center, end } = getCircleCenterEnd(circle as any)
        primitives.push(
          this.transformFootprintPrimitive(
            {
              type: "circle",
              center,
              start: end,
              end,
            },
            footprintPosition,
            footprintRotation,
          ),
        )
      }

      const fpRects = footprint.fpRects || []
      const fpRectArray = Array.isArray(fpRects) ? fpRects : [fpRects]
      for (const rect of fpRectArray) {
        const layerStr = getGraphicLayerNames(rect).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        primitives.push(
          ...this.getRectEdgeCutPrimitives(rect).map((primitive) =>
            this.transformFootprintPrimitive(
              primitive,
              footprintPosition,
              footprintRotation,
            ),
          ),
        )
      }
    }

    return primitives
  }

  private transformFootprintPrimitive(
    primitive: BoardPrimitive,
    footprintPosition: { x: number; y: number },
    footprintRotation: number,
  ): BoardPrimitive {
    if (primitive.type === "arc") {
      return {
        type: "arc",
        start: this.transformFootprintPoint(
          primitive.start,
          footprintPosition,
          footprintRotation,
        ),
        mid: this.transformFootprintPoint(
          primitive.mid,
          footprintPosition,
          footprintRotation,
        ),
        end: this.transformFootprintPoint(
          primitive.end,
          footprintPosition,
          footprintRotation,
        ),
      }
    }

    if (primitive.type === "circle") {
      return {
        type: "circle",
        center: this.transformFootprintPoint(
          primitive.center,
          footprintPosition,
          footprintRotation,
        ),
        start: this.transformFootprintPoint(
          primitive.start,
          footprintPosition,
          footprintRotation,
        ),
        end: this.transformFootprintPoint(
          primitive.end,
          footprintPosition,
          footprintRotation,
        ),
      }
    }

    if (primitive.type === "curve") {
      return {
        type: "curve",
        start: this.transformFootprintPoint(
          primitive.start,
          footprintPosition,
          footprintRotation,
        ),
        control1: this.transformFootprintPoint(
          primitive.control1,
          footprintPosition,
          footprintRotation,
        ),
        control2: this.transformFootprintPoint(
          primitive.control2,
          footprintPosition,
          footprintRotation,
        ),
        end: this.transformFootprintPoint(
          primitive.end,
          footprintPosition,
          footprintRotation,
        ),
      }
    }

    return {
      type: "line",
      start: this.transformFootprintPoint(
        primitive.start,
        footprintPosition,
        footprintRotation,
      ),
      end: this.transformFootprintPoint(
        primitive.end,
        footprintPosition,
        footprintRotation,
      ),
    }
  }

  private transformFootprintPoint(
    point: { x: number; y: number },
    footprintPosition: { x: number; y: number },
    footprintRotation: number,
  ) {
    const rotated = rotatePoint(point.x, point.y, -footprintRotation)
    return {
      x: footprintPosition.x + rotated.x,
      y: footprintPosition.y + rotated.y,
    }
  }

  private orderConnectedContours(primitives: BoardPrimitive[]) {
    const remainingSegments = [...primitives]
    const contours: BoardPrimitive[][] = []

    while (remainingSegments.length > 0) {
      const orderedSegments = [remainingSegments.shift()!]

      while (remainingSegments.length > 0) {
        const lastSegment = orderedSegments[orderedSegments.length - 1]!
        const lastEnd = lastSegment.end

        let foundIndex = remainingSegments.findIndex((seg) =>
          this.pointsEqualKicad(seg.start, lastEnd),
        )
        if (foundIndex !== -1) {
          orderedSegments.push(remainingSegments.splice(foundIndex, 1)[0]!)
          continue
        }

        foundIndex = remainingSegments.findIndex((seg) =>
          this.pointsEqualKicad(seg.end, lastEnd),
        )
        if (foundIndex !== -1) {
          const segment = remainingSegments.splice(foundIndex, 1)[0]!
          orderedSegments.push(this.reverseBoardPrimitive(segment))
          continue
        }

        break
      }

      contours.push(orderedSegments)
    }

    return contours
  }

  private reverseBoardPrimitive(segment: BoardPrimitive): BoardPrimitive {
    if (segment.type === "arc") {
      return {
        type: "arc",
        start: segment.end,
        mid: segment.mid,
        end: segment.start,
      }
    }

    if (segment.type === "circle") {
      return {
        type: "circle",
        center: segment.center,
        start: segment.end,
        end: segment.start,
      }
    }

    if (segment.type === "curve") {
      return {
        type: "curve",
        start: segment.end,
        control1: segment.control2,
        control2: segment.control1,
        end: segment.start,
      }
    }

    return {
      type: "line",
      start: segment.end,
      end: segment.start,
    }
  }

  private getRectEdgeCutPrimitives(rect: any): BoardPrimitive[] {
    const { start, end } = this.getRectStartEnd(rect)
    const topLeft = { x: start.x, y: start.y }
    const topRight = { x: end.x, y: start.y }
    const bottomRight = { x: end.x, y: end.y }
    const bottomLeft = { x: start.x, y: end.y }

    return [
      { type: "line", start: topLeft, end: topRight },
      { type: "line", start: topRight, end: bottomRight },
      { type: "line", start: bottomRight, end: bottomLeft },
      { type: "line", start: bottomLeft, end: topLeft },
    ]
  }

  private getRectStartEnd(rect: any) {
    return {
      start: {
        x: rect.start?.x ?? rect._sxStart?._x ?? 0,
        y: rect.start?.y ?? rect._sxStart?._y ?? 0,
      },
      end: {
        x: rect.end?.x ?? rect._sxEnd?._x ?? 0,
        y: rect.end?.y ?? rect._sxEnd?._y ?? 0,
      },
    }
  }

  private getBoardContourPoints(primitives: BoardPrimitive[]) {
    if (!this.ctx.k2cMatPcb) return []

    const points: Array<{ x: number; y: number }> = []

    for (const segment of primitives) {
      const kicadPoints = this.getPrimitivePoints(segment)
      for (const kicadPoint of kicadPoints) {
        const point = applyToPoint(this.ctx.k2cMatPcb, kicadPoint)
        const lastPoint = points[points.length - 1]
        if (!lastPoint || !this.pointsEqual(lastPoint, point)) {
          points.push(point)
        }
      }
    }

    return points
  }

  private getPrimitivePoints(segment: BoardPrimitive) {
    if (segment.type === "arc") {
      return approximateArcPoints(segment.start, segment.mid, segment.end, {
        segmentLength: 0.25,
        minSegments: 16,
      })
    }

    if (segment.type === "circle") {
      return approximateCirclePoints(segment.center, segment.end, {
        segmentLength: 0.25,
        minSegments: 16,
      })
    }

    if (segment.type === "curve") {
      return approximateCubicBezierPoints(
        segment.start,
        segment.control1,
        segment.control2,
        segment.end,
        {
          segmentLength: 0.25,
          minSegments: 16,
        },
      )
    }

    return [segment.start, segment.end]
  }

  private createEdgeCutCutout(contour: BoardContour) {
    const [circle] = contour.primitives
    if (circle?.type === "circle" && contour.primitives.length === 1) {
      this.createEdgeCutCircleHole(circle)
      return
    }

    this.ctx.db.pcb_cutout.insert({
      shape: "polygon",
      points: contour.points,
    } as any)
  }

  private createEdgeCutCircleHole(
    circle: Extract<BoardPrimitive, { type: "circle" }>,
  ) {
    if (!this.ctx.k2cMatPcb) return

    const center = applyToPoint(this.ctx.k2cMatPcb, circle.center)
    const radius = Math.hypot(
      circle.end.x - circle.center.x,
      circle.end.y - circle.center.y,
    )

    this.ctx.db.pcb_hole.insert({
      hole_shape: "circle",
      hole_diameter: radius * 2,
      x: center.x,
      y: center.y,
    } as any)
  }

  private calculatePolygonArea(points: Array<{ x: number; y: number }>) {
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const current = points[i]!
      const next = points[(i + 1) % points.length]!
      area += current.x * next.y - next.x * current.y
    }
    return area / 2
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
    const rotation = convertKiCadAngleToCircuitJsonCcwRotation(at?.angle)

    const layer = mapKicadLayerToVisibleLayer(text.layer)

    // Access font size from kicadts internal structure (_sxEffects._sxFont._sxSize._height)
    const kicadFontSize =
      text._sxEffects?._sxFont?._sxSize?._height ||
      text.effects?.font?.size?.y ||
      1
    const fontSize = kicadFontSize * KICAD_TEXT_HEIGHT_TO_CIRCUIT_JSON_FONT_SIZE
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
        font_size: fontSize,
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
        font_size: fontSize,
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
        font_size: fontSize,
        font: "tscircuit2024",
        ccw_rotation: rotation || undefined,
      } as PcbCopperText
      this.ctx.db.pcb_copper_text.insert(copperText)
    }
  }

  private pointsEqual(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ): boolean {
    return (
      Math.abs(p1.x - p2.x) < EDGE_CUT_POINT_EPSILON &&
      Math.abs(p1.y - p2.y) < EDGE_CUT_POINT_EPSILON
    )
  }

  private pointsEqualKicad(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ): boolean {
    return (
      Math.abs(p1.x - p2.x) < EDGE_CUT_POINT_EPSILON &&
      Math.abs(p1.y - p2.y) < EDGE_CUT_POINT_EPSILON
    )
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
