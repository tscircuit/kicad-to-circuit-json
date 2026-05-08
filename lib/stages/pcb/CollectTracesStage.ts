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
  connectedSourcePortIds?: string[]
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

interface PcbTraceConnectivityNode {
  key: string
  point: TracePoint
  layer: LayerRef
  netNum: number | null
}

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

    this.annotatePrimitivesWithConnectedSourcePorts(primitives)
    this.createTracesFromPrimitives(primitives)

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
      this.isTerminalNode(nodeKey, graph, primitives[0]!)

    for (const nodeKey of graph.adjacency.keys()) {
      if (!isTerminal(nodeKey)) continue

      for (const edgeId of graph.adjacency.get(nodeKey) ?? []) {
        if (visitedEdgeIds.has(edgeId)) continue
        const path = this.walkTracePath(nodeKey, edgeId, graph, visitedEdgeIds)
        this.insertTracePath(path)
      }
    }

    for (const edge of graph.edges) {
      if (visitedEdgeIds.has(edge.id)) continue
      const path = this.walkTracePath(
        edge.startKey,
        edge.id,
        graph,
        visitedEdgeIds,
      )
      this.insertTracePath(path)
    }
  }

  private createTraceGraph(primitives: TracePrimitive[]): TraceGraph {
    const edges: TraceEdge[] = []
    const adjacency = new Map<string, number[]>()

    for (const primitive of primitives) {
      const id = edges.length
      const startKey = this.getPointKey(primitive.start)
      const endKey = this.getPointKey(primitive.end)
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

  private walkTracePath(
    startNodeKey: string,
    firstEdgeId: number,
    graph: TraceGraph,
    visitedEdgeIds: Set<number>,
  ): OrientedTraceEdge[] {
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
      if (this.isTerminalNode(currentNodeKey, graph, edge)) break

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
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToSourceNetId) return
    if (path.length === 0) return

    const routePoints = this.getPathRoutePoints(path)
    if (routePoints.length < 2) return

    const firstPoint = routePoints[0]!
    const lastPoint = routePoints[routePoints.length - 1]!
    const layer = path[0]!.edge.layer
    const netNum = path[0]!.edge.netNum
    const sourceNetId =
      netNum !== null
        ? (this.ctx.netNumToSourceNetId.get(netNum) ?? undefined)
        : undefined

    const startPcbPortId = this.findPortAtPosition(firstPoint, layer)
    const endPcbPortId = this.findPortAtPosition(lastPoint, layer)
    const connectedSourcePortIds = this.getConnectedSourcePortIds([
      startPcbPortId,
      endPcbPortId,
    ])
    const traceConnectedSourcePortIds =
      this.getTraceConnectedSourcePortIds(path)
    const inferredSourcePortIds = this.getSourcePortIdsForTrace({
      netNum,
      connectedSourcePortIds,
      traceConnectedSourcePortIds,
    })
    const sourceTraceId = sourceNetId
      ? this.createSourceTraceForPath({
          sourceNetId,
          connectedSourcePortIds: inferredSourcePortIds,
          netNum,
        })
      : undefined

    const route = routePoints.map((point, index) => ({
      route_type: "wire" as const,
      x: point.x,
      y: point.y,
      width: point.width,
      layer,
      ...(index === 0 && startPcbPortId
        ? { start_pcb_port_id: startPcbPortId }
        : {}),
      ...(index === routePoints.length - 1 && endPcbPortId
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

  private getPathRoutePoints(path: OrientedTraceEdge[]) {
    const routePoints: Array<TracePoint & { width: number }> = []
    let lastRawPoint: TracePoint | undefined

    for (const { edge, reversed } of path) {
      const edgePoints = reversed ? [...edge.points].reverse() : edge.points

      for (const point of edgePoints) {
        if (lastRawPoint && this.pointsMatch(lastRawPoint, point)) {
          continue
        }

        const transformedPoint = applyToPoint(this.ctx.k2cMatPcb!, point)
        routePoints.push({
          x: transformedPoint.x,
          y: transformedPoint.y,
          width: edge.width,
        })
        lastRawPoint = point
      }
    }

    return routePoints
  }

  private isTerminalNode(
    nodeKey: string,
    graph: TraceGraph,
    primitive: Pick<TracePrimitive, "layer" | "netNum">,
  ): boolean {
    const edgeIds = graph.adjacency.get(nodeKey) ?? []
    if (edgeIds.length !== 2) return true

    const point = this.getPointFromKey(nodeKey)
    const transformedPoint = applyToPoint(this.ctx.k2cMatPcb!, point)
    if (this.findPortAtPosition(transformedPoint, primitive.layer)) return true

    return this.hasViaAtPosition(point, primitive.layer, primitive.netNum)
  }

  private hasViaAtPosition(
    point: TracePoint,
    layer: LayerRef,
    netNum: number | null,
  ): boolean {
    const vias = this.ctx.kicadPcb?.vias || []
    const viaArray = Array.isArray(vias) ? vias : [vias]

    for (const via of viaArray) {
      const viaNetNum = this.getSegmentNet(via)
      if (viaNetNum !== netNum) continue

      const at = via.at || { x: 0, y: 0 }
      if (!this.pointsMatch(point, { x: at.x, y: at.y })) continue

      const viaLayers = via.layers
        ? getCopperSpanLayerRefsFromLayers(via.layers, this.ctx.kicadPcb)
        : []
      const layers =
        viaLayers.length > 0
          ? viaLayers
          : getPcbCopperLayerRefs(this.ctx.kicadPcb)

      if (layers.includes(layer)) return true
    }

    return false
  }

  private getPrimitiveGroupKey(primitive: TracePrimitive): string {
    return [
      primitive.netNum ?? "no-net",
      primitive.layer,
      primitive.width.toFixed(6),
    ].join(":")
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

  private pointsMatch(a: TracePoint, b: TracePoint): boolean {
    return this.getPointKey(a) === this.getPointKey(b)
  }

  private getPcbTraceNodeKey({
    netNum,
    layer,
    point,
  }: {
    netNum: number | null
    layer: LayerRef
    point: TracePoint
  }) {
    return `${netNum ?? "no-net"}:${layer}:${this.getPointKey(point)}`
  }

  private annotatePrimitivesWithConnectedSourcePorts(
    primitives: TracePrimitive[],
  ) {
    if (!this.ctx.k2cMatPcb || primitives.length === 0) return

    const nodes = new Map<string, PcbTraceConnectivityNode>()
    const adjacency = new Map<string, Set<string>>()

    const ensureNode = (
      netNum: number | null,
      layer: LayerRef,
      point: TracePoint,
    ) => {
      const key = this.getPcbTraceNodeKey({ netNum, layer, point })
      if (!nodes.has(key)) {
        nodes.set(key, { key, point, layer, netNum })
      }
      if (!adjacency.has(key)) {
        adjacency.set(key, new Set())
      }
      return key
    }

    const connectNodes = (a: string, b: string) => {
      adjacency.get(a)?.add(b)
      adjacency.get(b)?.add(a)
    }

    for (const primitive of primitives) {
      const startKey = ensureNode(
        primitive.netNum,
        primitive.layer,
        primitive.start,
      )
      const endKey = ensureNode(
        primitive.netNum,
        primitive.layer,
        primitive.end,
      )
      connectNodes(startKey, endKey)
    }

    const vias = this.ctx.kicadPcb?.vias || []
    const viaArray = Array.isArray(vias) ? vias : [vias]

    for (const via of viaArray) {
      const netNum = this.getSegmentNet(via)
      if (netNum === null) continue

      const at = via.at || { x: 0, y: 0 }
      const point = { x: at.x, y: at.y }
      const viaLayers = via.layers
        ? getCopperSpanLayerRefsFromLayers(via.layers, this.ctx.kicadPcb)
        : []
      const layers =
        viaLayers.length > 0
          ? viaLayers
          : getPcbCopperLayerRefs(this.ctx.kicadPcb)

      const viaNodeKeys = layers.map((layer) =>
        ensureNode(netNum, layer, point),
      )
      for (let i = 1; i < viaNodeKeys.length; i++) {
        connectNodes(viaNodeKeys[0]!, viaNodeKeys[i]!)
      }
    }

    const connectedSourcePortIdsByNodeKey = new Map<string, string[]>()
    const visited = new Set<string>()

    for (const startNodeKey of nodes.keys()) {
      if (visited.has(startNodeKey)) continue

      const traceNodeKeys: string[] = []
      const traceConnectedSourcePortIds = new Set<string>()
      const stack = [startNodeKey]
      visited.add(startNodeKey)

      while (stack.length > 0) {
        const nodeKey = stack.pop()!
        const node = nodes.get(nodeKey)
        if (!node) continue

        traceNodeKeys.push(nodeKey)

        const transformedPoint = applyToPoint(this.ctx.k2cMatPcb, node.point)
        const pcbPortId = this.findPortAtPosition(transformedPoint, node.layer)
        const sourcePortId = this.getConnectedSourcePortIds([pcbPortId])[0]
        if (sourcePortId) {
          traceConnectedSourcePortIds.add(sourcePortId)
        }

        for (const neighborNodeKey of adjacency.get(nodeKey) ?? []) {
          if (visited.has(neighborNodeKey)) continue
          visited.add(neighborNodeKey)
          stack.push(neighborNodeKey)
        }
      }

      const sourcePortIds = [...traceConnectedSourcePortIds]
      for (const nodeKey of traceNodeKeys) {
        connectedSourcePortIdsByNodeKey.set(nodeKey, sourcePortIds)
      }
    }

    for (const primitive of primitives) {
      const nodeKey = this.getPcbTraceNodeKey({
        netNum: primitive.netNum,
        layer: primitive.layer,
        point: primitive.start,
      })
      primitive.connectedSourcePortIds =
        connectedSourcePortIdsByNodeKey.get(nodeKey) ?? []
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
    traceConnectedSourcePortIds,
  }: {
    netNum: number | null
    connectedSourcePortIds: string[]
    traceConnectedSourcePortIds: string[]
  }) {
    if (netNum === null || connectedSourcePortIds.length >= 2) {
      return connectedSourcePortIds
    }

    const inferredSourcePortIds = [...connectedSourcePortIds]
    for (const sourcePortId of traceConnectedSourcePortIds) {
      if (!inferredSourcePortIds.includes(sourcePortId)) {
        inferredSourcePortIds.push(sourcePortId)
      }
      if (inferredSourcePortIds.length >= 2) {
        return inferredSourcePortIds.slice(0, 2)
      }
    }

    const netSourcePortIds = this.ctx.netNumToSourcePortIds?.get(netNum) ?? []
    for (const sourcePortId of netSourcePortIds) {
      if (!inferredSourcePortIds.includes(sourcePortId)) {
        inferredSourcePortIds.push(sourcePortId)
      }
      if (inferredSourcePortIds.length >= 2) {
        return inferredSourcePortIds.slice(0, 2)
      }
    }

    return inferredSourcePortIds
  }

  private getTraceConnectedSourcePortIds(path: OrientedTraceEdge[]) {
    const sourcePortIds: string[] = []

    for (const { edge } of path) {
      for (const sourcePortId of edge.connectedSourcePortIds ?? []) {
        if (!sourcePortIds.includes(sourcePortId)) {
          sourcePortIds.push(sourcePortId)
        }
      }
    }

    return sourcePortIds
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
