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
import { getPcbCopperLayerCount } from "./layer-mapping"

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

/** Builds the board outline and cutouts from board and footprint Edge.Cuts. */
export class CollectBoardGeometryStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb) {
      this.finished = true
      return false
    }

    const lines = this.ctx.kicadPcb.graphicLines || []
    const lineArray = Array.isArray(lines) ? lines : [lines]
    const arcArray = getGraphicArcs(this.ctx.kicadPcb)
    const circleArray = getGraphicCircles(this.ctx.kicadPcb)
    const curveArray = getGraphicCurves(this.ctx.kicadPcb)
    const grRects = this.ctx.kicadPcb.graphicRects || []
    const rectArray = Array.isArray(grRects) ? grRects : [grRects]
    const edgeCutPrimitives: BoardPrimitive[] = []

    for (const line of lineArray) {
      if (!getGraphicLayerNames(line).join(" ").includes("Edge.Cuts")) continue
      const { start, end } = getLineStartEnd(line)
      edgeCutPrimitives.push({ type: "line", start, end })
    }

    for (const arc of arcArray) {
      if (!getGraphicLayerNames(arc).join(" ").includes("Edge.Cuts")) continue
      const { start, mid, end } = getArcStartMidEnd(arc)
      edgeCutPrimitives.push({ type: "arc", start, mid, end })
    }

    for (const circle of circleArray) {
      if (!getGraphicLayerNames(circle).join(" ").includes("Edge.Cuts"))
        continue
      const { center, end } = getCircleCenterEnd(circle)
      edgeCutPrimitives.push({ type: "circle", center, start: end, end })
    }

    for (const curve of curveArray) {
      if (!getGraphicLayerNames(curve).join(" ").includes("Edge.Cuts")) continue
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
      if (!getGraphicLayerNames(rect).join(" ").includes("Edge.Cuts")) continue
      edgeCutPrimitives.push(...this.getRectEdgeCutPrimitives(rect))
    }

    edgeCutPrimitives.push(...this.getFootprintEdgeCutPrimitives())
    if (edgeCutPrimitives.length > 0) this.createBoardOutline(edgeCutPrimitives)

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
          this.transformFootprintPrimitive({
            primitive: {
              type: "line",
              start,
              end,
            },
            footprintPosition,
            footprintCcwRotationDegrees: footprintRotation,
          }),
        )
      }

      const fpArcs = footprint.fpArcs || []
      const fpArcArray = Array.isArray(fpArcs) ? fpArcs : [fpArcs]
      for (const arc of fpArcArray) {
        const layerStr = getGraphicLayerNames(arc).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const { start, mid, end } = getArcStartMidEnd(arc as any)
        primitives.push(
          this.transformFootprintPrimitive({
            primitive: {
              type: "arc",
              start,
              mid,
              end,
            },
            footprintPosition,
            footprintCcwRotationDegrees: footprintRotation,
          }),
        )
      }

      const fpCircles = footprint.fpCircles || []
      const fpCircleArray = Array.isArray(fpCircles) ? fpCircles : [fpCircles]
      for (const circle of fpCircleArray) {
        const layerStr = getGraphicLayerNames(circle).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const { center, end } = getCircleCenterEnd(circle as any)
        primitives.push(
          this.transformFootprintPrimitive({
            primitive: {
              type: "circle",
              center,
              start: end,
              end,
            },
            footprintPosition,
            footprintCcwRotationDegrees: footprintRotation,
          }),
        )
      }

      const fpRects = footprint.fpRects || []
      const fpRectArray = Array.isArray(fpRects) ? fpRects : [fpRects]
      for (const rect of fpRectArray) {
        const layerStr = getGraphicLayerNames(rect).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        primitives.push(
          ...this.getRectEdgeCutPrimitives(rect).map((primitive) =>
            this.transformFootprintPrimitive({
              primitive,
              footprintPosition,
              footprintCcwRotationDegrees: footprintRotation,
            }),
          ),
        )
      }
    }

    return primitives
  }

  private transformFootprintPrimitive(params: {
    primitive: BoardPrimitive
    footprintPosition: { x: number; y: number }
    footprintCcwRotationDegrees: number
  }): BoardPrimitive {
    const { primitive, footprintPosition, footprintCcwRotationDegrees } = params
    if (primitive.type === "arc") {
      return {
        type: "arc",
        start: this.transformFootprintPoint({
          point: primitive.start,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
        mid: this.transformFootprintPoint({
          point: primitive.mid,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
        end: this.transformFootprintPoint({
          point: primitive.end,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
      }
    }

    if (primitive.type === "circle") {
      return {
        type: "circle",
        center: this.transformFootprintPoint({
          point: primitive.center,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
        start: this.transformFootprintPoint({
          point: primitive.start,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
        end: this.transformFootprintPoint({
          point: primitive.end,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
      }
    }

    if (primitive.type === "curve") {
      return {
        type: "curve",
        start: this.transformFootprintPoint({
          point: primitive.start,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
        control1: this.transformFootprintPoint({
          point: primitive.control1,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
        control2: this.transformFootprintPoint({
          point: primitive.control2,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
        end: this.transformFootprintPoint({
          point: primitive.end,
          footprintPosition,
          footprintCcwRotationDegrees,
        }),
      }
    }

    return {
      type: "line",
      start: this.transformFootprintPoint({
        point: primitive.start,
        footprintPosition,
        footprintCcwRotationDegrees,
      }),
      end: this.transformFootprintPoint({
        point: primitive.end,
        footprintPosition,
        footprintCcwRotationDegrees,
      }),
    }
  }

  private transformFootprintPoint(params: {
    point: { x: number; y: number }
    footprintPosition: { x: number; y: number }
    footprintCcwRotationDegrees: number
  }) {
    const { point, footprintPosition, footprintCcwRotationDegrees } = params
    const rotated = rotatePoint({
      point,
      ccwRotationDegrees: -footprintCcwRotationDegrees,
    })
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
      return approximateArcPoints({
        start: segment.start,
        mid: segment.mid,
        end: segment.end,
        segmentLength: 0.25,
        minSegments: 16,
      })
    }

    if (segment.type === "circle") {
      return approximateCirclePoints({
        center: segment.center,
        end: segment.end,
        segmentLength: 0.25,
        minSegments: 16,
      })
    }

    if (segment.type === "curve") {
      return approximateCubicBezierPoints({
        start: segment.start,
        control1: segment.control1,
        control2: segment.control2,
        end: segment.end,
        segmentLength: 0.25,
        minSegments: 16,
      })
    }

    return [segment.start, segment.end]
  }

  private createEdgeCutCutout(contour: BoardContour) {
    const [circle] = contour.primitives
    if (circle?.type === "circle" && contour.primitives.length === 1) {
      this.createEdgeCutCircleCutout(circle)
      return
    }

    this.ctx.db.pcb_cutout.insert({
      shape: "polygon",
      points: contour.points,
    } as any)
  }

  private createEdgeCutCircleCutout(
    circle: Extract<BoardPrimitive, { type: "circle" }>,
  ) {
    if (!this.ctx.k2cMatPcb) return

    const center = applyToPoint(this.ctx.k2cMatPcb, circle.center)
    const radius = Math.hypot(
      circle.end.x - circle.center.x,
      circle.end.y - circle.center.y,
    )

    this.ctx.db.pcb_cutout.insert({
      shape: "circle",
      center,
      radius,
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
}
