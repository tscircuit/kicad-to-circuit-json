import type { LayerRef } from "circuit-json"
import type { PcbArc, Segment, Via } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage, type KicadNetKey } from "../../types"
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
import { getKicadNetKey } from "./net-utils"
import {
  isPointInsidePolygonContours,
  type PolygonPoint,
} from "./polygon-contours"

interface TracePoint {
  x: number
  y: number
}

interface TracePrimitive {
  primitiveType: "wire" | "via"
  start: TracePoint
  end: TracePoint
  points: TracePoint[]
  width?: number
  layer?: LayerRef
  fromLayer?: LayerRef
  toLayer?: LayerRef
  outerDiameter?: number
  holeDiameter?: number
  netKey: KicadNetKey | null
}

interface TraceEdge extends TracePrimitive {
  id: number
  startKey: string
  endKey: string
}

interface OrientedTraceEdge {
  edge: TraceEdge
  reversed: boolean
}

interface TraceGraph {
  edges: TraceEdge[]
  adjacency: Map<string, number[]>
}

interface TraceRoutePointWire {
  routeType: "wire"
  x: number
  y: number
  width: number
  layer: LayerRef
}

interface TraceRoutePointVia {
  routeType: "via"
  x: number
  y: number
  fromLayer: LayerRef
  toLayer: LayerRef
  outerDiameter?: number
  holeDiameter?: number
}

type TraceRoutePoint = TraceRoutePointWire | TraceRoutePointVia

/**
 * CollectTracesStage converts KiCad PCB segments (traces) into Circuit JSON pcb_trace elements.
 * Connected copper primitives are stitched into contiguous pcb_trace routes.
 */
export class CollectTracesStage extends ConverterStage {
  private readonly PORT_MATCH_TOLERANCE = 1e-3
  private readonly POINT_KEY_PRECISION = 1e6

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

    const arcArray = getTopLevelCopperArcs(this.ctx.kicadPcb)
    const primitives: TracePrimitive[] = []

    for (const segment of this.ctx.kicadPcb.segments) {
      const primitive = this.getTracePrimitiveFromSegment(segment)
      if (primitive) primitives.push(primitive)
    }

    for (const arc of arcArray) {
      const primitive = this.getTracePrimitiveFromArc(arc)
      if (primitive) primitives.push(primitive)
    }

    for (const via of this.ctx.kicadPcb.vias) {
      const primitive = this.getTracePrimitiveFromVia(via)
      if (primitive) primitives.push(primitive)
    }

    this.createTracesFromPrimitives(primitives)

    this.finished = true
    return false
  }

  private getTracePrimitiveFromSegment(
    segment: Segment,
  ): TracePrimitive | undefined {
    if (!this.ctx.k2cMatPcb) return undefined

    const start = segment.start || { x: 0, y: 0 }
    const end = segment.end || { x: 0, y: 0 }
    const width = segment.width || 0.2 // Default trace width

    const layer = segment.layer
    const layerNames = getLayerNames(layer)
    const layerStr = layerNames.join(" ")
    const mappedLayer = mapKicadLayerToLayerRef(layerStr)
    const netKey = getKicadNetKey(segment)

    const startPoint = { x: start.x, y: start.y }
    const endPoint = { x: end.x, y: end.y }
    if (this.pointsMatch(startPoint, endPoint)) {
      return undefined
    }

    return {
      primitiveType: "wire",
      start: startPoint,
      end: endPoint,
      points: [startPoint, endPoint],
      width,
      layer: mappedLayer,
      netKey,
    }
  }

  private getTracePrimitiveFromArc(arc: PcbArc): TracePrimitive | undefined {
    if (!this.ctx.k2cMatPcb) return undefined

    const { start, mid, end } = getArcStartMidEnd(arc)
    const width = arc.width ?? 0.2
    const layerStr = getLayerNames(arc.layer).join(" ")
    const mappedLayer = mapKicadLayerToLayerRef(layerStr)

    const netKey = getKicadNetKey(arc)

    const points = approximateArcPoints({
      start,
      mid,
      end,
      segmentLength: Math.max(width, 0.1),
      minSegments: 8,
    })

    const startPoint = points[0]
    const endPoint = points[points.length - 1]

    if (!startPoint || !endPoint || this.pointsMatch(startPoint, endPoint)) {
      return undefined
    }

    return {
      primitiveType: "wire",
      start: startPoint,
      end: endPoint,
      points,
      width,
      layer: mappedLayer,
      netKey,
    }
  }

  private getTracePrimitiveFromVia(via: Via): TracePrimitive | undefined {
    const netKey = getKicadNetKey(via)
    if (netKey === null) return undefined

    const at = via.at || { x: 0, y: 0 }
    const point = { x: at.x, y: at.y }
    const viaLayers = via.layers
      ? getCopperSpanLayerRefsFromLayers(via.layers, this.ctx.kicadPcb)
      : []
    const layers =
      viaLayers.length > 0
        ? viaLayers
        : getPcbCopperLayerRefs(this.ctx.kicadPcb)

    const fromLayer = layers[0]
    const toLayer = layers[layers.length - 1]
    if (!fromLayer || !toLayer || fromLayer === toLayer) return undefined

    return {
      primitiveType: "via",
      start: point,
      end: point,
      points: [point],
      fromLayer,
      toLayer,
      outerDiameter: via.size || 0.8,
      holeDiameter: via.drill || 0.4,
      netKey,
    }
  }

  private createTracesFromPrimitives(primitives: TracePrimitive[]) {
    const groupedPrimitives = new Map<string, TracePrimitive[]>()

    for (const primitive of primitives) {
      const key = this.getPrimitiveGroupKey(primitive)
      const group = groupedPrimitives.get(key) ?? []
      group.push(primitive)
      groupedPrimitives.set(key, group)
    }

    for (const group of groupedPrimitives.values()) {
      this.createTracesFromPrimitiveGroup(group)
    }
  }

  private createTracesFromPrimitiveGroup(primitives: TracePrimitive[]) {
    const graph = this.createTraceGraph(primitives)
    const visitedEdgeIds = new Set<number>()
    const isTerminal = (nodeKey: string): boolean =>
      this.isTerminalNode(nodeKey, graph)

    for (const nodeKey of graph.adjacency.keys()) {
      if (!isTerminal(nodeKey)) continue

      for (const edgeId of graph.adjacency.get(nodeKey) ?? []) {
        if (visitedEdgeIds.has(edgeId)) continue
        const path = this.walkTracePath({
          startNodeKey: nodeKey,
          firstEdgeId: edgeId,
          graph,
          visitedEdgeIds,
        })
        this.insertTracePath(path)
      }
    }

    for (const edge of graph.edges) {
      if (visitedEdgeIds.has(edge.id)) continue
      const path = this.walkTracePath({
        startNodeKey: edge.startKey,
        firstEdgeId: edge.id,
        graph,
        visitedEdgeIds,
      })
      this.insertTracePath(path)
    }
  }

  private createTraceGraph(primitives: TracePrimitive[]): TraceGraph {
    const edges: TraceEdge[] = []
    const adjacency = new Map<string, number[]>()

    for (const primitive of primitives) {
      const id = edges.length
      const startLayer =
        primitive.primitiveType === "via"
          ? primitive.fromLayer!
          : primitive.layer!
      const endLayer =
        primitive.primitiveType === "via"
          ? primitive.toLayer!
          : primitive.layer!
      const startKey = this.getTraceGraphNodeKey(primitive.start, startLayer)
      const endKey = this.getTraceGraphNodeKey(primitive.end, endLayer)
      const edge = { ...primitive, id, startKey, endKey }
      edges.push(edge)

      for (const nodeKey of [startKey, endKey]) {
        const edgeIds = adjacency.get(nodeKey) ?? []
        edgeIds.push(id)
        adjacency.set(nodeKey, edgeIds)
      }
    }

    return { edges, adjacency }
  }

  private walkTracePath(params: {
    startNodeKey: string
    firstEdgeId: number
    graph: TraceGraph
    visitedEdgeIds: Set<number>
  }): OrientedTraceEdge[] {
    const { startNodeKey, firstEdgeId, graph, visitedEdgeIds } = params
    const path: OrientedTraceEdge[] = []
    let currentNodeKey = startNodeKey
    let edgeId = firstEdgeId

    while (!visitedEdgeIds.has(edgeId)) {
      const edge = graph.edges[edgeId]
      if (!edge) break

      const reversed = edge.endKey === currentNodeKey
      path.push({ edge, reversed })
      visitedEdgeIds.add(edgeId)

      currentNodeKey = reversed ? edge.startKey : edge.endKey
      if (this.isTerminalNode(currentNodeKey, graph)) break

      const nextEdgeId = (graph.adjacency.get(currentNodeKey) ?? []).find(
        (candidateEdgeId) =>
          candidateEdgeId !== edgeId && !visitedEdgeIds.has(candidateEdgeId),
      )
      if (nextEdgeId === undefined) break

      edgeId = nextEdgeId
    }

    return path
  }

  private insertTracePath(path: OrientedTraceEdge[]) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToSourceTraceId) return
    if (path.length === 0) return

    const routePoints = this.getPathRoutePoints(path)
    if (routePoints.length < 2) return

    const netKey = path[0]!.edge.netKey
    let sourceTraceId: string | undefined
    if (netKey !== null) {
      sourceTraceId = this.ctx.netNumToSourceTraceId.get(netKey)
    }

    const firstWireIndex = routePoints.findIndex(
      (point) => point.routeType === "wire",
    )
    const lastWireIndex = routePoints.findLastIndex(
      (point) => point.routeType === "wire",
    )
    if (firstWireIndex === -1) return

    const firstWirePoint = routePoints[firstWireIndex] as TraceRoutePointWire
    const lastWirePoint = routePoints[lastWireIndex] as TraceRoutePointWire
    const startPcbPortId = this.findPortAtPosition(
      { x: firstWirePoint.x, y: firstWirePoint.y },
      firstWirePoint.layer,
      netKey,
    )
    const endPcbPortId = this.findPortAtPosition(
      { x: lastWirePoint.x, y: lastWirePoint.y },
      lastWirePoint.layer,
      netKey,
    )

    const route = routePoints.map((point, index) => {
      if (point.routeType === "via") {
        return {
          route_type: "via" as const,
          x: point.x,
          y: point.y,
          from_layer: point.fromLayer,
          to_layer: point.toLayer,
          ...(point.outerDiameter
            ? { outer_diameter: point.outerDiameter }
            : {}),
          ...(point.holeDiameter ? { hole_diameter: point.holeDiameter } : {}),
        }
      }

      return {
        route_type: "wire" as const,
        x: point.x,
        y: point.y,
        width: point.width,
        layer: point.layer,
        ...(index === firstWireIndex && startPcbPortId
          ? { start_pcb_port_id: startPcbPortId }
          : {}),
        ...(index === lastWireIndex && endPcbPortId
          ? { end_pcb_port_id: endPcbPortId }
          : {}),
      }
    })

    this.ctx.db.pcb_trace.insert({
      route: route as any,
      source_trace_id: sourceTraceId,
      pcb_port_id: undefined,
    } as any)

    if (this.ctx.stats) {
      this.ctx.stats.traces = (this.ctx.stats.traces || 0) + 1
    }
  }

  private getPathRoutePoints(path: OrientedTraceEdge[]) {
    const routePoints: TraceRoutePoint[] = []
    let lastRawPoint: TracePoint | undefined
    let lastWireLayer: LayerRef | undefined

    for (const { edge, reversed } of path) {
      if (edge.primitiveType === "via") {
        const point = edge.start
        const transformedPoint = applyToPoint(this.ctx.k2cMatPcb!, point)
        routePoints.push({
          routeType: "via",
          x: transformedPoint.x,
          y: transformedPoint.y,
          fromLayer: reversed ? edge.toLayer! : edge.fromLayer!,
          toLayer: reversed ? edge.fromLayer! : edge.toLayer!,
          outerDiameter: edge.outerDiameter,
          holeDiameter: edge.holeDiameter,
        })
        continue
      }

      const edgePoints = reversed ? [...edge.points].reverse() : edge.points
      const layer = edge.layer!
      const width = edge.width!

      for (const point of edgePoints) {
        if (
          lastRawPoint &&
          lastWireLayer === layer &&
          this.pointsMatch(lastRawPoint, point)
        ) {
          // A wire point's width applies to the segment leaving that point.
          // Keep the shared point, but give it the outgoing edge's width.
          const lastRoutePoint = routePoints[routePoints.length - 1]
          if (lastRoutePoint?.routeType === "wire") {
            lastRoutePoint.width = width
          }
          continue
        }

        const transformedPoint = applyToPoint(this.ctx.k2cMatPcb!, point)
        routePoints.push({
          routeType: "wire",
          x: transformedPoint.x,
          y: transformedPoint.y,
          width,
          layer,
        })
        lastRawPoint = point
        lastWireLayer = layer
      }
    }

    return routePoints
  }

  private isTerminalNode(nodeKey: string, graph: TraceGraph): boolean {
    const edgeIds = graph.adjacency.get(nodeKey) ?? []
    if (edgeIds.length !== 2) return true

    const { point, layer } = this.getTraceGraphNodeFromKey(nodeKey)
    const transformedPoint = applyToPoint(this.ctx.k2cMatPcb!, point)
    const netKey = graph.edges[edgeIds[0]!]?.netKey ?? null
    if (this.findPortCenterAtPosition(transformedPoint, layer, netKey)) {
      return true
    }

    return false
  }

  private getPrimitiveGroupKey(primitive: TracePrimitive): string {
    if (primitive.netKey === null) return "no-net"
    return `${typeof primitive.netKey}:${primitive.netKey}`
  }

  private getPointKey(point: TracePoint): string {
    const x = Math.round(point.x * this.POINT_KEY_PRECISION)
    const y = Math.round(point.y * this.POINT_KEY_PRECISION)
    return `${x},${y}`
  }

  private getPointFromKey(pointKey: string): TracePoint {
    const [x, y] = pointKey.split(",").map(Number)
    return {
      x: (x ?? 0) / this.POINT_KEY_PRECISION,
      y: (y ?? 0) / this.POINT_KEY_PRECISION,
    }
  }

  private getTraceGraphNodeKey(point: TracePoint, layer: LayerRef): string {
    return `${layer}:${this.getPointKey(point)}`
  }

  private getTraceGraphNodeFromKey(nodeKey: string): {
    point: TracePoint
    layer: LayerRef
  } {
    const [layer, ...pointKeyParts] = nodeKey.split(":")
    return {
      layer: layer as LayerRef,
      point: this.getPointFromKey(pointKeyParts.join(":")),
    }
  }

  private pointsMatch(a: TracePoint, b: TracePoint): boolean {
    return this.getPointKey(a) === this.getPointKey(b)
  }

  private findPortAtPosition(
    point: { x: number; y: number },
    layer: LayerRef,
    netKey: KicadNetKey | null,
  ): string | undefined {
    const portAtCenter = this.findPortCenterAtPosition(point, layer, netKey)
    if (portAtCenter) return portAtCenter

    const portContainingPoint = this.findPortContainingPoint(
      point,
      layer,
      netKey,
    )
    if (portContainingPoint) return portContainingPoint

    if (netKey === null) return undefined

    // KiCad permits copper to physically enter a pad whose assigned logical
    // net differs from the track net (for example, an intentional short across
    // two no-connect pins). Prefer the declared net above, but preserve the
    // actual copper connection when geometry provides the only match.
    return (
      this.findPortCenterAtPosition(point, layer, null) ??
      this.findPortContainingPoint(point, layer, null)
    )
  }

  private findPortCenterAtPosition(
    point: { x: number; y: number },
    layer: LayerRef,
    netKey: KicadNetKey | null,
  ): string | undefined {
    const ports = this.ctx.db.pcb_port.list() as any[]

    for (const port of ports) {
      if (!this.isPcbPortOnNet(port, netKey)) continue

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

  private findPortContainingPoint(
    point: { x: number; y: number },
    layer: LayerRef,
    netKey: KicadNetKey | null,
  ): string | undefined {
    const candidates: Array<{ pcbPortId: string; distanceSq: number }> = []
    const collectCandidate = (pad: any) => {
      const pcbPortId = pad.pcb_port_id
      if (!pcbPortId || !this.isPadOnLayer(pad, layer)) return
      const pcbPort = this.ctx.db.pcb_port.get(pcbPortId)
      if (!this.isPcbPortOnNet(pcbPort, netKey)) return
      if (!this.isPointInsidePadCopper(point, pad)) return

      const dx = (pad.x ?? 0) - point.x
      const dy = (pad.y ?? 0) - point.y
      candidates.push({ pcbPortId, distanceSq: dx * dx + dy * dy })
    }

    for (const pad of this.ctx.db.pcb_smtpad.list() as any[]) {
      collectCandidate(pad)
    }

    for (const pad of this.ctx.db.pcb_plated_hole.list() as any[]) {
      collectCandidate(pad)
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq)
    return candidates[0]?.pcbPortId
  }

  private isPcbPortOnNet(port: any, netKey: KicadNetKey | null) {
    if (netKey === null) return true

    const sourcePortId = port?.source_port_id
    if (!sourcePortId) return false

    return (
      this.ctx.netNumToSourcePortIds?.get(netKey)?.includes(sourcePortId) ??
      false
    )
  }

  private isPadOnLayer(pad: any, layer: LayerRef): boolean {
    if (pad.layer && pad.layer !== layer) return false

    const layers = pad.layers as string[] | undefined
    if (layers?.length && !layers.includes(layer)) return false

    return true
  }

  private isPointInsidePadCopper(
    point: { x: number; y: number },
    pad: any,
  ): boolean {
    const shape = pad.shape

    if (shape === "circle") {
      return this.isPointInsideCircle(point, pad)
    }

    if (shape === "polygon") {
      return isPointInsidePolygonContours(
        point,
        this.getPadPolygonContours(pad),
        this.PORT_MATCH_TOLERANCE,
      )
    }

    if (shape === "pill" || shape === "rotated_pill") {
      const width = pad.width ?? pad.outer_width
      const height = pad.height ?? pad.outer_height
      const rotation = shape === "rotated_pill" ? pad.ccw_rotation : 0
      return this.isPointInsidePill(point, pad, width, height, rotation)
    }

    if (shape === "rect" || shape === "rotated_rect") {
      const rotation = shape === "rotated_rect" ? pad.ccw_rotation : 0
      return this.isPointInsideRect(point, pad, pad.width, pad.height, rotation)
    }

    if (
      shape === "circular_hole_with_rect_pad" ||
      shape === "pill_hole_with_rect_pad" ||
      shape === "rotated_pill_hole_with_rect_pad"
    ) {
      return this.isPointInsideRect(
        point,
        pad,
        pad.rect_pad_width,
        pad.rect_pad_height,
        pad.rect_ccw_rotation,
      )
    }

    return false
  }

  private isPointInsideCircle(point: { x: number; y: number }, pad: any) {
    const radius =
      pad.radius ??
      (pad.outer_diameter !== undefined ? pad.outer_diameter / 2 : undefined) ??
      (pad.width !== undefined && pad.height !== undefined
        ? Math.max(pad.width, pad.height) / 2
        : undefined)
    if (radius === undefined) return false

    const dx = point.x - (pad.x ?? 0)
    const dy = point.y - (pad.y ?? 0)
    return dx * dx + dy * dy <= (radius + this.PORT_MATCH_TOLERANCE) ** 2
  }

  private isPointInsideRect(
    point: { x: number; y: number },
    pad: any,
    width: number | undefined,
    height: number | undefined,
    ccwRotationDegrees: number | undefined,
  ) {
    if (width === undefined || height === undefined) return false

    const local = this.getLocalPadPoint(point, pad, ccwRotationDegrees)
    return (
      Math.abs(local.x) <= width / 2 + this.PORT_MATCH_TOLERANCE &&
      Math.abs(local.y) <= height / 2 + this.PORT_MATCH_TOLERANCE
    )
  }

  private isPointInsidePill(
    point: { x: number; y: number },
    pad: any,
    width: number | undefined,
    height: number | undefined,
    ccwRotationDegrees: number | undefined,
  ) {
    if (width === undefined || height === undefined) return false

    const local = this.getLocalPadPoint(point, pad, ccwRotationDegrees)
    const radius = Math.min(width, height) / 2
    const tolerance = this.PORT_MATCH_TOLERANCE

    if (width >= height) {
      const centerHalfWidth = width / 2 - radius
      if (
        Math.abs(local.x) <= centerHalfWidth + tolerance &&
        Math.abs(local.y) <= radius + tolerance
      ) {
        return true
      }

      const capX = local.x < 0 ? -centerHalfWidth : centerHalfWidth
      return (local.x - capX) ** 2 + local.y ** 2 <= (radius + tolerance) ** 2
    }

    const centerHalfHeight = height / 2 - radius
    if (
      Math.abs(local.x) <= radius + tolerance &&
      Math.abs(local.y) <= centerHalfHeight + tolerance
    ) {
      return true
    }

    const capY = local.y < 0 ? -centerHalfHeight : centerHalfHeight
    return local.x ** 2 + (local.y - capY) ** 2 <= (radius + tolerance) ** 2
  }

  private getPadPolygonContours(pad: any): PolygonPoint[][] {
    const contours = pad.contours as PolygonPoint[][] | undefined
    const validContours =
      contours?.filter((contour) => contour.length >= 3) ?? []
    if (validContours.length > 0) return validContours

    const points = pad.points as PolygonPoint[] | undefined
    return points && points.length >= 3 ? [points] : []
  }

  private getLocalPadPoint(
    point: { x: number; y: number },
    pad: any,
    ccwRotationDegrees: number | undefined,
  ) {
    const dx = point.x - (pad.x ?? 0)
    const dy = point.y - (pad.y ?? 0)
    const radians = (-(ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)

    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    }
  }
}
