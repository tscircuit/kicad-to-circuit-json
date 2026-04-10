import type { LayerRef } from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import {
  approximateArcPoints,
  getArcStartMidEnd,
  getLayerNames,
  getTopLevelCopperArcs,
} from "./arc-utils"
import { mapKicadLayerToLayerRef } from "./layer-mapping"

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
    const arcArray = getTopLevelCopperArcs(this.ctx.kicadPcb)

    // Create a separate trace for each segment
    for (const segment of segmentArray) {
      this.createTraceFromSegment(segment)
    }

    for (const arc of arcArray) {
      this.createTraceFromArc(arc)
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
    const layerNames = getLayerNames(layer)
    const layerStr = layerNames.join(" ")
    const mappedLayer = mapKicadLayerToLayerRef(layerStr)

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

  private createTraceFromArc(arc: any) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToSourceTraceId) return

    const { start, mid, end } = getArcStartMidEnd(arc)
    const width = arc.width ?? arc._sxWidth?.value ?? 0.2
    const layerStr = getLayerNames(arc.layer).join(" ")
    const mappedLayer = mapKicadLayerToLayerRef(layerStr)

    const netNum = this.getSegmentNet(arc)
    const sourceTraceId =
      netNum !== null
        ? (this.ctx.netNumToSourceTraceId.get(netNum) ?? undefined)
        : undefined

    const transformedRoute = approximateArcPoints(start, mid, end, {
      segmentLength: Math.max(width, 0.1),
      minSegments: 8,
    }).map((point) => applyToPoint(this.ctx.k2cMatPcb!, point))

    const startPos = transformedRoute[0]
    const endPos = transformedRoute[transformedRoute.length - 1]

    if (!startPos || !endPos) return

    const startPcbPortId = this.findPortAtPosition(startPos, mappedLayer)
    const endPcbPortId = this.findPortAtPosition(endPos, mappedLayer)

    const route = transformedRoute.map((point, index) => ({
      route_type: "wire" as const,
      x: point.x,
      y: point.y,
      width,
      layer: mappedLayer,
      ...(index === 0 ? { start_pcb_port_id: startPcbPortId } : {}),
      ...(index === transformedRoute.length - 1
        ? { end_pcb_port_id: endPcbPortId }
        : {}),
    }))

    this.ctx.db.pcb_trace.insert({
      route: route as any,
      source_trace_id: sourceTraceId,
      pcb_port_id: undefined,
    } as any)

    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
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
    layer: LayerRef,
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
