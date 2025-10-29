import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"

/**
 * CollectTracesStage converts KiCad PCB segments (traces) into Circuit JSON pcb_trace elements.
 * Each segment becomes its own trace with a simple 2-point route.
 */
export class CollectTracesStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    const segments = this.ctx.kicadPcb.segments || []
    const segmentArray = Array.isArray(segments) ? segments : [segments]

    // Create a separate trace for each segment
    for (const segment of segmentArray) {
      this.createTraceFromSegment(segment)
    }

    this.finished = true
    return false
  }

  private createTraceFromSegment(segment: any) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToName) return

    const start = segment.start || { x: 0, y: 0 }
    const end = segment.end || { x: 0, y: 0 }
    const width = segment.width || 0.2 // Default trace width

    // Get layer info
    const layer = segment.layer
    const layerNames = layer?.names || []
    const layerStr = layerNames.join(" ")
    const mappedLayer = this.mapLayer(layerStr)

    // Get net info
    const netNum = segment.net || 0
    const netName = this.ctx.netNumToName.get(netNum) || ""

    // Transform coordinates
    const startPos = applyToPoint(this.ctx.k2cMatPcb, {
      x: start.x,
      y: start.y,
    })
    const endPos = applyToPoint(this.ctx.k2cMatPcb, { x: end.x, y: end.y })

    // Create a simple 2-point route
    const route = [
      {
        route_type: "wire" as const,
        x: startPos.x,
        y: startPos.y,
        width: width,
        layer: mappedLayer,
      },
      {
        route_type: "wire" as const,
        x: endPos.x,
        y: endPos.y,
        width: width,
        layer: mappedLayer,
      },
    ]

    // Create pcb_trace for this segment
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
