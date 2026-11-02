import type { Point, SchematicPort, SchematicTrace } from "circuit-json"
import {
  ConnectivityMap,
  findConnectedNetworks,
} from "circuit-json-to-connectivity-map"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import { getPinsForSymbolInstance } from "./emitKicadSymbolGeometry"

const POINT_TOLERANCE = 1e-6
const pointKey = ({ x, y }: Point): string =>
  `${Math.round(x / POINT_TOLERANCE)},${Math.round(y / POINT_TOLERANCE)}`

interface ConnectedGroup {
  traces: SchematicTrace[]
  ports: SchematicPort[]
  junctions: Point[]
  netNames: Set<string>
}

/** Links drawn wires to their electrical nets without changing their paths. */
export class CollectSchematicConnectivityStage extends ConverterStage {
  step(): boolean {
    const { kicadSch, k2cMatSch, db } = this.ctx
    if (!kicadSch || !k2cMatSch) {
      this.finished = true
      return false
    }

    const traces = db.schematic_trace.list()
    const ports = db.schematic_port.list()
    const connections: string[][] = []

    for (const trace of traces) {
      for (const edge of trace.edges) {
        connections.push([pointKey(edge.from), pointKey(edge.to)])
      }
    }
    for (const port of ports) connections.push([pointKey(port.center)])
    const junctions = kicadSch.junctions.flatMap((junction) =>
      junction.at ? [applyToPoint(k2cMatSch, junction.at)] : [],
    )
    for (const junction of junctions) connections.push([pointKey(junction)])

    const namedPoints: Array<{ name: string; key: string }> = []
    const addNamedPoint = (name: string, position: Point) => {
      const decodedName = name.replaceAll("{slash}", "/")
      const key = pointKey(position)
      namedPoints.push({ name: decodedName, key })
      connections.push([key, `net:${decodedName}`])
    }
    for (const label of [...kicadSch.labels, ...kicadSch.globalLabels]) {
      if (label.at && label.value) {
        addNamedPoint(label.value, applyToPoint(k2cMatSch, label.at))
      }
    }
    const interiorConnections = [
      ...junctions,
      ...[...kicadSch.labels, ...kicadSch.globalLabels].flatMap((label) =>
        label.at && label.value ? [applyToPoint(k2cMatSch, label.at)] : [],
      ),
    ]

    // Power symbols act as implicit net labels, including custom libraries.
    // A PWR_FLAG has a power_out pin and does not name or join remote nets.
    for (const symbol of kicadSch.symbols) {
      const library = kicadSch.libSymbols?.symbols.find(
        (library) => library.libraryId === symbol.libraryId,
      )
      if (!library?._sxPower) continue
      const pins = getPinsForSymbolInstance(library, symbol)
      if (pins.length !== 1 || pins[0]?.pinElectricalType !== "power_in") {
        continue
      }
      const name = symbol.properties.find(
        (property) => property.key === "Value",
      )?.value
      const componentId = symbol.uuid
        ? this.ctx.symbolUuidToComponentId?.get(symbol.uuid)
        : undefined
      if (!name || !componentId) continue
      for (const port of ports) {
        if (port.schematic_component_id === componentId) {
          addNamedPoint(name, port.center)
        }
      }
    }

    // Junctions and labels attach inside a wire. A pin or another wire's
    // endpoint touching its interior does not connect without a junction.
    for (const trace of traces) {
      for (const edge of trace.edges) {
        for (const point of interiorConnections) {
          if (isPointOnSegment(point, edge.from, edge.to)) {
            connections.push([pointKey(edge.from), pointKey(point)])
          }
        }
      }
    }
    const connectivityMap = new ConnectivityMap(
      findConnectedNetworks(connections),
    )

    const groups = new Map<string, ConnectedGroup>()
    const groupAt = (key: string): ConnectedGroup => {
      const id = connectivityMap.getNetConnectedToId(key)!
      let group = groups.get(id)
      if (!group) {
        group = { traces: [], ports: [], junctions: [], netNames: new Set() }
        groups.set(id, group)
      }
      return group
    }
    for (const trace of traces) {
      const firstEdge = trace.edges[0]
      if (firstEdge) groupAt(pointKey(firstEdge.from)).traces.push(trace)
    }
    for (const port of ports) groupAt(pointKey(port.center)).ports.push(port)
    for (const junction of junctions) {
      groupAt(pointKey(junction)).junctions.push(junction)
    }
    for (const { name, key } of namedPoints) groupAt(key).netNames.add(name)

    const sourceNetsByName = new Map(
      db.source_net.list().map((net) => [net.name, net]),
    )
    const netLabels = db.schematic_net_label.list()
    for (const group of groups.values()) {
      const sourcePortIds = [
        ...new Set(group.ports.map((p) => p.source_port_id)),
      ]
      if (
        group.traces.length === 0 &&
        (sourcePortIds.length === 0 ||
          (sourcePortIds.length === 1 && group.netNames.size === 0))
      ) {
        continue
      }
      const sourceNetIds = [...group.netNames].map((name) => {
        let net = sourceNetsByName.get(name)
        if (!net) {
          net = db.source_net.insert({ name, member_source_group_ids: [] })
          sourceNetsByName.set(name, net)
        }
        return net.source_net_id
      })
      const sourceTrace = db.source_trace.insert({
        connected_source_port_ids: sourcePortIds,
        connected_source_net_ids: sourceNetIds,
      })
      const connectivityKey = sourceTrace.source_trace_id
      db.source_trace.update(sourceTrace.source_trace_id, {
        subcircuit_connectivity_map_key: connectivityKey,
      })
      for (const sourceNetId of sourceNetIds) {
        db.source_net.update(sourceNetId, {
          subcircuit_connectivity_map_key: connectivityKey,
        })
      }
      const portsByPosition = new Map(
        group.ports.map((port) => [pointKey(port.center), port]),
      )
      for (const [index, trace] of group.traces.entries()) {
        db.schematic_trace.update(trace.schematic_trace_id, {
          source_trace_id: sourceTrace.source_trace_id,
          subcircuit_connectivity_map_key: connectivityKey,
          junctions: index === 0 ? group.junctions : [],
          edges: trace.edges.map((edge) => ({
            ...edge,
            from_schematic_port_id: portsByPosition.get(pointKey(edge.from))
              ?.schematic_port_id,
            to_schematic_port_id: portsByPosition.get(pointKey(edge.to))
              ?.schematic_port_id,
          })),
        })
      }
      for (const label of netLabels) {
        if (sourceNetIds.includes(label.source_net_id)) {
          db.schematic_net_label.update(label.schematic_net_label_id, {
            source_trace_id: sourceTrace.source_trace_id,
          })
        }
      }
    }

    this.finished = true
    return false
  }
}

const isPointOnSegment = (point: Point, from: Point, to: Point): boolean => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < POINT_TOLERANCE) return pointKey(point) === pointKey(from)
  if (
    Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) >
    POINT_TOLERANCE * length
  ) {
    return false
  }
  const projection =
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / length
  return (
    projection >= -POINT_TOLERANCE && projection <= length + POINT_TOLERANCE
  )
}
