import { compose, scale, translate } from "transformation-matrix"
import { ConverterStage } from "../../types"
import {
  approximateArcPoints,
  approximateCirclePoints,
  approximateCubicBezierPoints,
  getArcStartMidEnd,
  getGraphicArcs,
  getGraphicCircles,
  getGraphicCurves,
  getCircleCenterEnd,
  getCurvePoints,
  getGraphicLayerNames,
  getLineStartEnd,
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
    this.ctx.netNumToSourceTraceId = new Map()
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
      for (const point of approximateArcPoints(start, mid, end, {
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
      for (const point of approximateCirclePoints(center, end, {
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

      for (const point of approximateCubicBezierPoints(
        points.start,
        points.control1,
        points.control2,
        points.end,
        {
          segmentLength: 0.25,
          minSegments: 16,
        },
      )) {
        xs.push(point.x)
        ys.push(point.y)
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
}
