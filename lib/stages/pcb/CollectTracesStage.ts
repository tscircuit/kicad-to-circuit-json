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

    // Build route from segments with proper layer and width information
    const route: Array<{ route_type: "wire"; x: number; y: number; width: number; layer: string }> = []

    for (const segment of segments) {
      const start = segment.start || { x: 0, y: 0 }
      const end = segment.end || { x: 0, y: 0 }
      const width = segment.width || 0.2 // Default trace width

      const startPos = applyToPoint(this.ctx.k2cMatPcb, { x: start.x, y: start.y })
      const endPos = applyToPoint(this.ctx.k2cMatPcb, { x: end.x, y: end.y })

      // Add start point if route is empty
      if (route.length === 0) {
        route.push({
          route_type: "wire",
          x: startPos.x,
          y: startPos.y,
          width: width,
          layer: mappedLayer,
        })
      }

      // Add end point
      route.push({
        route_type: "wire",
        x: endPos.x,
        y: endPos.y,
        width: width,
        layer: mappedLayer,
      })
    }

    // Create pcb_trace with proper route format
    this.ctx.db.pcb_trace.insert({
      route: route as any,
      pcb_port_id: undefined, // Not connected to a specific port yet
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
