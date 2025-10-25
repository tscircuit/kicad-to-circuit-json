import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"

/**
 * CollectTracesStage converts KiCad PCB segments (traces) into Circuit JSON pcb_trace elements.
 * Groups segments by net and layer to create trace routes.
 */
export class CollectTracesStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    const segments = this.ctx.kicadPcb.segments || []
    const segmentArray = Array.isArray(segments) ? segments : [segments]

    // Group segments by net and layer
    const traceGroups = new Map<string, any[]>()

    for (const segment of segmentArray) {
      const netNum = segment.net || 0
      const layer = segment.layer
      const layerNames = layer?.names || []
      const layerStr = layerNames.join(" ")
      const mappedLayer = this.mapLayer(layerStr)
      const key = `${netNum}_${mappedLayer}`

      if (!traceGroups.has(key)) {
        traceGroups.set(key, [])
      }
      traceGroups.get(key)!.push(segment)
    }

    // Create traces for each group
    for (const [key, segments] of traceGroups) {
      this.createTrace(segments, key)
    }

    this.finished = true
    return false
  }

  private createTrace(segments: any[], groupKey: string) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToName) return

    // Extract net info from first segment
    const firstSegment = segments[0]
    const netNum = firstSegment.net || 0
    const layer = firstSegment.layer
    const layerNames = layer?.names || []
    const layerStr = layerNames.join(" ")
    const mappedLayer = this.mapLayer(layerStr)
    const netName = this.ctx.netNumToName.get(netNum) || ""

    // Build route from segments
    const route: Array<{ x: number; y: number; via?: boolean; to_layer?: string }> = []

    for (const segment of segments) {
      const start = segment.start || { x: 0, y: 0 }
      const end = segment.end || { x: 0, y: 0 }

      const startPos = applyToPoint(this.ctx.k2cMatPcb, { x: start.x, y: start.y })
      const endPos = applyToPoint(this.ctx.k2cMatPcb, { x: end.x, y: end.y })

      // Add start point if route is empty
      if (route.length === 0) {
        route.push(startPos)
      }

      // Add end point
      route.push(endPos)
    }

    // Create pcb_trace
    this.ctx.db.pcb_trace.insert({
      route: route as any, // TODO: Fix route type - CJ expects wire/via segments with layer/width
    } as any)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
  }

  private mapLayer(kicadLayer: string): "top" | "bottom" {
    if (kicadLayer?.includes("B.Cu") || kicadLayer?.includes("Back")) {
      return "bottom"
    }
    return "top"
  }
}
