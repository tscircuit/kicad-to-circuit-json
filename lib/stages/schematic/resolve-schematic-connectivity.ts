import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Point, SchematicPort, SchematicTrace } from "circuit-json"
import {
  ConnectivityMap,
  findConnectedNetworks,
} from "circuit-json-to-connectivity-map"
import {
  getSchematicPointKey as pointKey,
  SCHEMATIC_POINT_TOLERANCE,
} from "./utils/schematic-net-utils"

export interface SchematicNetAnchor {
  name: string
  position: Point
}

export interface ResolvedSchematicNet {
  traces: SchematicTrace[]
  ports: SchematicPort[]
  junctions: Point[]
  netNames: Set<string>
}

/** Resolve explicit electrical inputs without modifying them or emitting JSON. */
export function resolveSchematicConnectivity({
  traces,
  ports,
  junctions,
  labels,
  implicitLabels,
}: {
  traces: readonly SchematicTrace[]
  ports: readonly SchematicPort[]
  junctions: readonly Point[]
  labels: readonly SchematicNetAnchor[]
  implicitLabels: readonly SchematicNetAnchor[]
}): ResolvedSchematicNet[] {
  const connections: string[][] = []
  for (const trace of traces) {
    for (const edge of trace.edges) {
      connections.push([pointKey(edge.from), pointKey(edge.to)])
    }
  }
  // A logical pin can have multiple drawn representations (symbol units).
  for (const port of ports) {
    connections.push([pointKey(port.center), port.source_port_id])
  }
  for (const point of junctions) connections.push([pointKey(point)])
  const namedPoints = [...labels, ...implicitLabels]
  for (const { name, position } of namedPoints) {
    connections.push([pointKey(position), `net:${name}`])
  }
  // Only explicit junctions and label anchors can attach to wire interiors.
  const interiorConnections = [
    ...junctions,
    ...labels.map((label) => label.position),
  ]
  for (const trace of traces) {
    for (const edge of trace.edges) {
      for (const point of interiorConnections) {
        if (
          pointToSegmentDistance(point, edge.from, edge.to) <=
          SCHEMATIC_POINT_TOLERANCE
        ) {
          connections.push([pointKey(edge.from), pointKey(point)])
        }
      }
    }
  }
  const connectivity = new ConnectivityMap(findConnectedNetworks(connections))
  const groups = new Map<string, ResolvedSchematicNet>()
  const groupAt = (point: Point) => {
    const id = connectivity.getNetConnectedToId(pointKey(point))!
    let group = groups.get(id)
    if (!group) {
      group = { traces: [], ports: [], junctions: [], netNames: new Set() }
      groups.set(id, group)
    }
    return group
  }
  for (const trace of traces) {
    if (trace.edges[0]) groupAt(trace.edges[0].from).traces.push(trace)
  }
  for (const port of ports) groupAt(port.center).ports.push(port)
  for (const point of junctions) groupAt(point).junctions.push(point)
  for (const { name, position } of namedPoints)
    groupAt(position).netNames.add(name)
  return [...groups.values()]
}
