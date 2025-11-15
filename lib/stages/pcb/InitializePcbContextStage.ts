import { ConverterStage } from "../../types"
import { compose, scale, translate } from "transformation-matrix"

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
    this.ctx.footprintUuidToComponentId = new Map()
    this.ctx.footprintUuidToSourceComponentId = new Map()

    this.finished = true
    return false
  }

  private calculateBoardCenter(): { x: number; y: number } {
    if (!this.ctx.kicadPcb) {
      return { x: 0, y: 0 }
    }

    // Find all Edge.Cuts lines to determine board bounds
    const lines = this.ctx.kicadPcb.graphicLines || []
    const lineArray = Array.isArray(lines) ? lines : [lines]

    const edgeCutLines = lineArray.filter((line: any) => {
      const layer = line.layer
      const layerNames =
        typeof layer === "string" ? [layer] : layer?.names || []
      const layerStr = layerNames.join(" ")
      return layerStr.includes("Edge.Cuts")
    })

    if (edgeCutLines.length === 0) {
      // No edge cuts found, use a default center
      return { x: 0, y: 0 }
    }

    // Collect all points from edge cut lines
    const xs: number[] = []
    const ys: number[] = []

    for (const line of edgeCutLines) {
      if (line.start) {
        xs.push(line.start.x)
        ys.push(line.start.y)
      }
      if (line.end) {
        xs.push(line.end.x)
        ys.push(line.end.y)
      }
    }

    if (xs.length === 0 || ys.length === 0) {
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
