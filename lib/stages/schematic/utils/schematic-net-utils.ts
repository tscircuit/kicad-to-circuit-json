import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { Point } from "circuit-json"

export const SCHEMATIC_POINT_TOLERANCE = 1e-6

// Remove transform round-off at a precision much finer than the schematic grid.
export const getSchematicPointKey = ({ x, y }: Point): string =>
  `${Math.round(x / SCHEMATIC_POINT_TOLERANCE)},${Math.round(y / SCHEMATIC_POINT_TOLERANCE)}`

export const decodeKicadText = (text: string): string =>
  text.replaceAll("{slash}", "/")

export const getOrCreateSchematicSourceNet = (
  db: CircuitJsonUtilObjects,
  name: string,
) =>
  db.source_net.getWhere({ name }) ??
  db.source_net.insert({ name, member_source_group_ids: [] })
