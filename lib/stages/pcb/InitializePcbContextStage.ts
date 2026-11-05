import { compose, scale, translate } from "transformation-matrix"
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

/**
 * InitializePcbContextStage sets up the coordinate transformation
 * from KiCad PCB space to Circuit JSON space.
 *
 * KiCad→CJ PCB transform (inverse of CJ→KiCad):
 * - CJ→KiCad used: translate(100, 100) ∘ scale(1, -1)
 * - KiCad→CJ uses: scale(1, -1) ∘ translate(-100, -100)
 */
export class InitializePcbContextStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb) {
      this.finished = true
      return false
    }

    // Calculate board center from Edge.Cuts to center the output at (0, 0)
    const center = this.calculateBoardCenter()

    // Build the transform for PCB
    // 1. Translate to center at origin
    // 2. Flip Y axis (KiCad Y down, Circuit JSON Y up)
    this.ctx.k2cMatPcb = compose(scale(1, -1), translate(-center.x, -center.y))

    // Initialize net mapping and component tracking
    this.ctx.netNumToName = new Map()
    this.ctx.netNumToSourceNetId = new Map()
    this.ctx.netNumToSourceTraceId = new Map()
    this.ctx.netNumToSourcePortIds = new Map()
    this.ctx.footprintUuidToComponentId = new Map()
    this.ctx.footprintUuidToSourceComponentId = new Map()

    this.finished = true
    return false
  }

  private calculateBoardCenter(): { x: number; y: number } {
    if (!this.ctx.kicadPcb) {
      return { x: 0, y: 0 }
    }

    // Find all Edge.Cuts primitives to determine board bounds
    const lines = this.ctx.kicadPcb.graphicLines || []
    const lineArray = Array.isArray(lines) ? lines : [lines]
    const arcArray = getGraphicArcs(this.ctx.kicadPcb)
    const circleArray = getGraphicCircles(this.ctx.kicadPcb)
    const curveArray = getGraphicCurves(this.ctx.kicadPcb)
    const rectArray = this.getGraphicRects()

    const xs: number[] = []
    const ys: number[] = []

    for (const line of lineArray) {
      const layerStr = getGraphicLayerNames(line).join(" ")
      if (!layerStr.includes("Edge.Cuts")) continue

      const { start, end } = getLineStartEnd(line)
      xs.push(start.x, end.x)
      ys.push(start.y, end.y)
    }

    for (const arc of arcArray) {
      const layerStr = getGraphicLayerNames(arc).join(" ")
      if (!layerStr.includes("Edge.Cuts")) continue

      const { start, mid, end } = getArcStartMidEnd(arc)
      for (const point of approximateArcPoints({
        start,
        mid,
        end,
        segmentLength: 0.25,
        minSegments: 16,
      })) {
        xs.push(point.x)
        ys.push(point.y)
      }
    }

    for (const circle of circleArray) {
      const layerStr = getGraphicLayerNames(circle).join(" ")
      if (!layerStr.includes("Edge.Cuts")) continue

      const { center, end } = getCircleCenterEnd(circle)
      for (const point of approximateCirclePoints({
        center,
        end,
        segmentLength: 0.25,
        minSegments: 16,
      })) {
        xs.push(point.x)
        ys.push(point.y)
      }
    }

    for (const curve of curveArray) {
      const layerStr = getGraphicLayerNames(curve).join(" ")
      if (!layerStr.includes("Edge.Cuts")) continue

      const points = getCurvePoints(curve)
      if (!points) continue

      for (const point of approximateCubicBezierPoints({
        start: points.start,
        control1: points.control1,
        control2: points.control2,
        end: points.end,
        segmentLength: 0.25,
        minSegments: 16,
      })) {
        xs.push(point.x)
        ys.push(point.y)
      }
    }

    for (const rect of rectArray) {
      const layerStr = getGraphicLayerNames(rect).join(" ")
      if (!layerStr.includes("Edge.Cuts")) continue

      const { start, end } = this.getRectStartEnd(rect)
      xs.push(start.x, end.x)
      ys.push(start.y, end.y)
    }

    const footprints = this.ctx.kicadPcb.footprints || []
    const footprintArray = Array.isArray(footprints) ? footprints : [footprints]

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
        const transformedStart = this.transformFootprintPoint(
          start,
          footprintPosition,
          footprintRotation,
        )
        const transformedEnd = this.transformFootprintPoint(
          end,
          footprintPosition,
          footprintRotation,
        )
        xs.push(transformedStart.x, transformedEnd.x)
        ys.push(transformedStart.y, transformedEnd.y)
      }

      const fpArcs = footprint.fpArcs || []
      const fpArcArray = Array.isArray(fpArcs) ? fpArcs : [fpArcs]
      for (const arc of fpArcArray) {
        const layerStr = getGraphicLayerNames(arc).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const { start, mid, end } = getArcStartMidEnd(arc as any)
        for (const point of approximateArcPoints({
          start: this.transformFootprintPoint(
            start,
            footprintPosition,
            footprintRotation,
          ),
          mid: this.transformFootprintPoint(
            mid,
            footprintPosition,
            footprintRotation,
          ),
          end: this.transformFootprintPoint(
            end,
            footprintPosition,
            footprintRotation,
          ),
          segmentLength: 0.25,
          minSegments: 16,
        })) {
          xs.push(point.x)
          ys.push(point.y)
        }
      }

      const fpCircles = footprint.fpCircles || []
      const fpCircleArray = Array.isArray(fpCircles) ? fpCircles : [fpCircles]
      for (const circle of fpCircleArray) {
        const layerStr = getGraphicLayerNames(circle).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const { center, end } = getCircleCenterEnd(circle as any)
        for (const point of approximateCirclePoints({
          center: this.transformFootprintPoint(
            center,
            footprintPosition,
            footprintRotation,
          ),
          end: this.transformFootprintPoint(
            end,
            footprintPosition,
            footprintRotation,
          ),
          segmentLength: 0.25,
          minSegments: 16,
        })) {
          xs.push(point.x)
          ys.push(point.y)
        }
      }

      const fpCurves = (footprint as any).fpCurves || []
      const fpCurveArray = Array.isArray(fpCurves) ? fpCurves : [fpCurves]
      for (const curve of fpCurveArray) {
        const layerStr = getGraphicLayerNames(curve).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const points = getCurvePoints(curve)
        if (!points) continue

        for (const point of approximateCubicBezierPoints({
          start: this.transformFootprintPoint(
            points.start,
            footprintPosition,
            footprintRotation,
          ),
          control1: this.transformFootprintPoint(
            points.control1,
            footprintPosition,
            footprintRotation,
          ),
          control2: this.transformFootprintPoint(
            points.control2,
            footprintPosition,
            footprintRotation,
          ),
          end: this.transformFootprintPoint(
            points.end,
            footprintPosition,
            footprintRotation,
          ),
          segmentLength: 0.25,
          minSegments: 16,
        })) {
          xs.push(point.x)
          ys.push(point.y)
        }
      }

      const fpRects = footprint.fpRects || []
      const fpRectArray = Array.isArray(fpRects) ? fpRects : [fpRects]
      for (const rect of fpRectArray) {
        const layerStr = getGraphicLayerNames(rect).join(" ")
        if (!layerStr.includes("Edge.Cuts")) continue

        const { start, end } = this.getRectStartEnd(rect)
        const corners = [
          { x: start.x, y: start.y },
          { x: end.x, y: start.y },
          { x: end.x, y: end.y },
          { x: start.x, y: end.y },
        ]
        for (const corner of corners) {
          const transformedCorner = this.transformFootprintPoint(
            corner,
            footprintPosition,
            footprintRotation,
          )
          xs.push(transformedCorner.x)
          ys.push(transformedCorner.y)
        }
      }
    }

    if (xs.length === 0 || ys.length === 0) {
      // No edge cuts found, use a default center
      return { x: 0, y: 0 }
    }

    // Calculate center
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    }
  }

  private getGraphicRects() {
    const rects = this.ctx.kicadPcb?.graphicRects || []
    return Array.isArray(rects) ? rects : [rects]
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

  private transformFootprintPoint(
    point: { x: number; y: number },
    footprintPosition: { x: number; y: number },
    footprintCcwRotationDegrees: number,
  ): { x: number; y: number } {
    const radians = (-footprintCcwRotationDegrees * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return {
      x: footprintPosition.x + (point.x * cos - point.y * sin),
      y: footprintPosition.y + (point.x * sin + point.y * cos),
    }
  }
}
