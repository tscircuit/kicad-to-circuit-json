import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"

/**
 * CollectTracesStage converts KiCad PCB segments (traces) into Circuit JSON pcb_trace elements.
 * Each segment becomes its own trace with a simple 2-point route.
 */
export class CollectTracesStage extends ConverterStage {
  private readonly PORT_MATCH_TOLERANCE = 1e-3

  step(): boolean {
    if (
      !this.ctx.kicadPcb ||
      !this.ctx.k2cMatPcb ||
      !this.ctx.netNumToName ||
      !this.ctx.netNumToSourceTraceId
    ) {
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
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToSourceTraceId) return

    const start = segment.start || { x: 0, y: 0 }
    const end = segment.end || { x: 0, y: 0 }
    const width = segment.width || 0.2 // Default trace width

    // Get layer info
    const layer = segment.layer
    const layerNames = layer?.names || []
    const layerStr = layerNames.join(" ")
    const mappedLayer = this.mapLayer(layerStr)

    // Get net info
    const netNum = this.getSegmentNet(segment)
    const sourceTraceId =
      netNum !== null
        ? (this.ctx.netNumToSourceTraceId.get(netNum) ?? undefined)
        : undefined

    // Transform coordinates
    const startPos = applyToPoint(this.ctx.k2cMatPcb, {
      x: start.x,
      y: start.y,
    })
    const endPos = applyToPoint(this.ctx.k2cMatPcb, { x: end.x, y: end.y })

    // Create a simple 2-point route
    const startPcbPortId = this.findPortAtPosition(startPos, mappedLayer)
    const endPcbPortId = this.findPortAtPosition(endPos, mappedLayer)

    const route = [
      {
        route_type: "wire" as const,
        x: startPos.x,
        y: startPos.y,
        width: width,
        layer: mappedLayer,
        start_pcb_port_id: startPcbPortId,
      },
      {
        route_type: "wire" as const,
        x: endPos.x,
        y: endPos.y,
        width: width,
        layer: mappedLayer,
        end_pcb_port_id: endPcbPortId,
      },
    ]

    // Create pcb_trace for this segment
    this.ctx.db.pcb_trace.insert({
      route: route as any,
      source_trace_id: sourceTraceId,
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

  private getSegmentNet(segment: any): number | null {
    const net = segment?.net
    if (!net) return null

    if (typeof net === "number") return net
    if (typeof net === "object") {
      return net._id ?? net.number ?? net.ordinal ?? null
    }

    return null
  }

  private findPortAtPosition(
    point: { x: number; y: number },
    layer: "top" | "bottom",
  ): string | undefined {
    const ports = this.ctx.db.pcb_port.list() as any[]

    for (const port of ports) {
      const layers = port.layers as string[] | undefined
      if (layers?.length && !layers.includes(layer)) {
        continue
      }

      if (
        Math.abs((port.x ?? 0) - point.x) <= this.PORT_MATCH_TOLERANCE &&
        Math.abs((port.y ?? 0) - point.y) <= this.PORT_MATCH_TOLERANCE
      ) {
        return port.pcb_port_id
      }
    }

    return undefined
  }
}
