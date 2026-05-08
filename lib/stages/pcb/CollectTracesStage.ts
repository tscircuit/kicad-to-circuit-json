import type { LayerRef } from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import {
  approximateArcPoints,
  getArcStartMidEnd,
  getLayerNames,
  getTopLevelCopperArcs,
} from "./arc-utils"
import {
  getCopperSpanLayerRefsFromLayers,
  getPcbCopperLayerRefs,
  mapKicadLayerToLayerRef,
} from "./layer-mapping"

interface TracePoint {
  x: number
  y: number
}

interface TracePrimitive {
  start: TracePoint
  end: TracePoint
  points: TracePoint[]
  width: number
  layer: LayerRef
  netNum: number | null
}

/**
 * CollectTracesStage converts KiCad PCB segments (traces) into Circuit JSON pcb_trace elements.
 * Each KiCad copper primitive is emitted as its own pcb_trace/source_trace pair.
 */
export class CollectTracesStage extends ConverterStage {
  private readonly PORT_MATCH_TOLERANCE = 1e-3
  private readonly POINT_KEY_PRECISION = 1e6

  step(): boolean {
    if (
      !this.ctx.kicadPcb ||
      !this.ctx.k2cMatPcb ||
      !this.ctx.netNumToName ||
      !this.ctx.netNumToSourceNetId
    ) {
      this.finished = true
      return false
    }

    const segments = this.ctx.kicadPcb.segments || []
    const segmentArray = Array.isArray(segments) ? segments : [segments]
    const arcArray = getTopLevelCopperArcs(this.ctx.kicadPcb)
    const primitives: TracePrimitive[] = []

    for (const segment of segmentArray) {
      const primitive = this.getTracePrimitiveFromSegment(segment)
      if (primitive) primitives.push(primitive)
    }

    for (const arc of arcArray) {
      const primitive = this.getTracePrimitiveFromArc(arc)
      if (primitive) primitives.push(primitive)
    }

    for (const primitive of primitives) {
      this.insertTracePrimitive(primitive)
    }

    const vias = this.ctx.kicadPcb.vias || []
    const viaArray = Array.isArray(vias) ? vias : [vias]
    for (const via of viaArray) {
      this.insertViaTrace(via)
    }

    this.finished = true
    return false
  }

  private getTracePrimitiveFromSegment(
    segment: any,
  ): TracePrimitive | undefined {
    if (!this.ctx.k2cMatPcb) return undefined

    const start = segment.start || { x: 0, y: 0 }
    const end = segment.end || { x: 0, y: 0 }
    const width = segment.width || 0.2 // Default trace width

    const layer = segment.layer
    const layerNames = getLayerNames(layer)
    const layerStr = layerNames.join(" ")
    const mappedLayer = mapKicadLayerToLayerRef(layerStr)
    const netNum = this.getSegmentNet(segment)

    const startPoint = { x: start.x, y: start.y }
    const endPoint = { x: end.x, y: end.y }
    if (this.pointsMatch(startPoint, endPoint)) {
      return undefined
    }

    return {
      start: startPoint,
      end: endPoint,
      points: [startPoint, endPoint],
      width,
      layer: mappedLayer,
      netNum,
    }
  }

  private getTracePrimitiveFromArc(arc: any): TracePrimitive | undefined {
    if (!this.ctx.k2cMatPcb) return undefined

    const { start, mid, end } = getArcStartMidEnd(arc)
    const width = arc.width ?? arc._sxWidth?.value ?? 0.2
    const layerStr = getLayerNames(arc.layer).join(" ")
    const mappedLayer = mapKicadLayerToLayerRef(layerStr)

    const netNum = this.getSegmentNet(arc)

    const points = approximateArcPoints(start, mid, end, {
      segmentLength: Math.max(width, 0.1),
      minSegments: 8,
    })

    const startPoint = points[0]
    const endPoint = points[points.length - 1]

    if (!startPoint || !endPoint || this.pointsMatch(startPoint, endPoint)) {
      return undefined
    }

    return {
      start: startPoint,
      end: endPoint,
      points,
      width,
      layer: mappedLayer,
      netNum,
    }
  }

  private insertTracePrimitive(primitive: TracePrimitive) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToSourceNetId) return

    const routePoints = primitive.points.map((point) => {
      const transformedPoint = applyToPoint(this.ctx.k2cMatPcb!, point)
      return {
        x: transformedPoint.x,
        y: transformedPoint.y,
        width: primitive.width,
      }
    })
    if (routePoints.length < 2) return

    const firstPoint = routePoints[0]!
    const lastPoint = routePoints[routePoints.length - 1]!
    const sourceTraceId = this.createSourceTraceForEndpoints({
      netNum: primitive.netNum,
      endpoints: [
        { point: firstPoint, layer: primitive.layer },
        { point: lastPoint, layer: primitive.layer },
      ],
    })

    const startPcbPortId = this.findPortAtPosition(firstPoint, primitive.layer)
    const endPcbPortId = this.findPortAtPosition(lastPoint, primitive.layer)
    const route = routePoints.map((point, index) => ({
      route_type: "wire" as const,
      x: point.x,
      y: point.y,
      width: point.width,
      layer: primitive.layer,
      ...(index === 0 && startPcbPortId
        ? { start_pcb_port_id: startPcbPortId }
        : {}),
      ...(index === routePoints.length - 1 && endPcbPortId
        ? { end_pcb_port_id: endPcbPortId }
        : {}),
    }))

    this.insertPcbTrace(route, sourceTraceId)
  }

  private insertViaTrace(via: any) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToSourceNetId) return

    const at = via.at || { x: 0, y: 0 }
    const point = applyToPoint(this.ctx.k2cMatPcb, { x: at.x, y: at.y })
    const netNum = this.getSegmentNet(via)
    const mappedLayers = via.layers
      ? getCopperSpanLayerRefsFromLayers(via.layers, this.ctx.kicadPcb)
      : []
    const layers =
      mappedLayers.length > 0
        ? mappedLayers
        : getPcbCopperLayerRefs(this.ctx.kicadPcb)
    const fromLayer = layers[0]
    const toLayer = layers[layers.length - 1]
    if (!fromLayer || !toLayer || fromLayer === toLayer) return

    const sourceTraceId = this.createSourceTraceForEndpoints({
      netNum,
      endpoints: [
        { point, layer: fromLayer },
        { point, layer: toLayer },
      ],
    })

    this.insertPcbTrace(
      [
        {
          route_type: "via" as const,
          x: point.x,
          y: point.y,
          from_layer: fromLayer,
          to_layer: toLayer,
          hole_diameter: via.drill || 0.4,
          outer_diameter: via.size || 0.8,
        },
      ],
      sourceTraceId,
    )
  }

  private createSourceTraceForEndpoints({
    netNum,
    endpoints,
  }: {
    netNum: number | null
    endpoints: Array<{ point: { x: number; y: number }; layer: LayerRef }>
  }) {
    const sourceNetId =
      netNum !== null
        ? (this.ctx.netNumToSourceNetId?.get(netNum) ?? undefined)
        : undefined
    if (!sourceNetId) return undefined

    const connectedSourcePortIds = this.getConnectedSourcePortIds(
      endpoints.map(({ point, layer }) =>
        this.findPortAtPosition(point, layer),
      ),
    )
    const inferredSourcePortIds = this.getSourcePortIdsForTrace({
      netNum,
      connectedSourcePortIds,
    })

    return this.createSourceTraceForPath({
      sourceNetId,
      connectedSourcePortIds: inferredSourcePortIds,
      netNum,
    })
  }

  private insertPcbTrace(route: any[], sourceTraceId?: string) {
    this.ctx.db.pcb_trace.insert({
      route: route as any,
      source_trace_id: sourceTraceId,
      pcb_port_id: undefined,
    } as any)

    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
  }

  private getPointKey(point: TracePoint): string {
    const x = Math.round(point.x * this.POINT_KEY_PRECISION)
    const y = Math.round(point.y * this.POINT_KEY_PRECISION)
    return `${x},${y}`
  }

  private pointsMatch(a: TracePoint, b: TracePoint): boolean {
    return this.getPointKey(a) === this.getPointKey(b)
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

  private getConnectedSourcePortIds(pcbPortIds: Array<string | undefined>) {
    const connectedSourcePortIds: string[] = []

    for (const pcbPortId of pcbPortIds) {
      if (!pcbPortId) continue

      const pcbPort = this.ctx.db.pcb_port.get(pcbPortId)
      const sourcePortId = pcbPort?.source_port_id
      if (!sourcePortId || connectedSourcePortIds.includes(sourcePortId)) {
        continue
      }

      connectedSourcePortIds.push(sourcePortId)
    }

    return connectedSourcePortIds
  }

  private getSourcePortIdsForTrace({
    netNum,
    connectedSourcePortIds,
  }: {
    netNum: number | null
    connectedSourcePortIds: string[]
  }) {
    if (netNum === null || connectedSourcePortIds.length >= 2) {
      return connectedSourcePortIds
    }

    const netSourcePortIds = this.ctx.netNumToSourcePortIds?.get(netNum) ?? []
    if (netSourcePortIds.length > 2) {
      return connectedSourcePortIds
    }

    const inferredSourcePortIds = [...connectedSourcePortIds]
    for (const sourcePortId of netSourcePortIds) {
      if (!inferredSourcePortIds.includes(sourcePortId)) {
        inferredSourcePortIds.push(sourcePortId)
      }
    }

    return inferredSourcePortIds
  }

  private createSourceTraceForPath({
    sourceNetId,
    connectedSourcePortIds,
    netNum,
  }: {
    sourceNetId: string
    connectedSourcePortIds: string[]
    netNum: number | null
  }) {
    const netName =
      netNum !== null
        ? (this.ctx.netNumToName?.get(netNum) ?? `Net-${netNum}`)
        : undefined
    const sourceTrace = this.ctx.db.source_trace.insert({
      connected_source_port_ids: connectedSourcePortIds,
      connected_source_net_ids: [sourceNetId],
      display_name: netName,
    })

    return sourceTrace.source_trace_id
  }
}
