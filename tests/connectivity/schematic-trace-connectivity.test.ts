import { expect, test } from "bun:test"
import { getSourcePortConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../lib"

const wire = (x1: number, y1: number, x2: number, y2: number) =>
  `(wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})))`
const label = (name: string, x: number, y: number, global = false) =>
  `(${global ? "global_label" : "label"} "${name}" (at ${x} ${y} 0))`
const terminal = (x: number, y: number, id: string, lib = "Test:Terminal") =>
  `(symbol (lib_id "${lib}") (at ${x} ${y} 0) (unit 1)
    (uuid "${id}") (property "Reference" "${id}")
    (property "Value" "${lib === "Test:Terminal" ? id : lib.split(":")[1]}"))`
const library = (id: string, electricalType: string, power = false) =>
  `(symbol "${id}" ${power ? "(power)" : ""}
    (symbol "${id.split(":")[1]}_1_1"
      (pin ${electricalType} line (at 0 0 0) (length 2.54)
        (name "1") (number "1"))))`

const convert = (contents: string) => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "connectivity.kicad_sch",
    `(kicad_sch (version 20250114) (generator "eeschema")
      (lib_symbols
        ${library("Test:Terminal", "passive")}
        ${library("Custom:GND", "power_in", true)}
        ${library("Custom:PWR_FLAG", "power_out", true)})
      ${contents})`,
  )
  converter.runUntilFinished()
  return converter
}

test("branches and reversed wire segments share a logical trace and hover key", () => {
  const converter = convert(`
    ${wire(10, 10, 20, 10)}
    ${wire(30, 10, 20, 10)}
    ${wire(20, 20, 20, 10)}
    ${wire(40, 10, 50, 10)}
    (junction (at 20 10) (diameter 0))
    ${terminal(10, 10, "J1")}
    ${terminal(30, 10, "J2")}
    ${terminal(20, 20, "J3")}
    ${terminal(40, 10, "J4")}`)
  const db = converter.ctx!.db
  const [a, b, branch, separate] = db.schematic_trace.list()
  const sourceTraces = db.source_trace.list()
  expect(sourceTraces).toHaveLength(2)
  expect(a!.source_trace_id).toBe(b!.source_trace_id)
  expect(a!.source_trace_id).toBe(branch!.source_trace_id)
  expect(a!.source_trace_id).not.toBe(separate!.source_trace_id)
  expect(a!.subcircuit_connectivity_map_key).toBeDefined()
  expect(a!.subcircuit_connectivity_map_key).toBe(
    branch!.subcircuit_connectivity_map_key,
  )
  const logicalTrace = db.source_trace.get(a!.source_trace_id!)!
  expect(logicalTrace.connected_source_port_ids).toHaveLength(3)
  expect(logicalTrace.subcircuit_connectivity_map_key).toBe(
    a!.subcircuit_connectivity_map_key,
  )
  expect(a!.edges[0]!.from_schematic_port_id).toBeDefined()
  expect(b!.edges[0]!.from_schematic_port_id).toBeDefined()
  expect(branch!.edges[0]!.from_schematic_port_id).toBeDefined()

  const map = getSourcePortConnectivityMapFromCircuitJson(converter.getOutput())
  expect(map.areAllIdsConnected(logicalTrace.connected_source_port_ids)).toBe(
    true,
  )
  expect(
    map.areIdsConnected(
      logicalTrace.connected_source_port_ids[0]!,
      sourceTraces[1]!.connected_source_port_ids[0]!,
    ),
  ).toBe(false)
  expect(db.schematic_trace.list().map((trace) => trace.edges.length)).toEqual([
    1, 1, 1, 1,
  ])
  expect(a!.junctions).toHaveLength(1)
  expect(separate!.junctions).toHaveLength(0)

  const svg = convertCircuitJsonToSchematicSvg(converter.getOutput())
  const key = a!.subcircuit_connectivity_map_key!
  expect(
    svg.match(
      new RegExp(`<g[^>]*data-subcircuit-connectivity-map-key="${key}"`, "g"),
    ),
  ).toHaveLength(6) // Each of the three wires has base and overlay groups.
  expect(svg).toContain(
    `svg:has(:is(g.trace[data-subcircuit-connectivity-map-key=`,
  )
})

test("a crossing joins only when it has a junction", () => {
  const contents = `${wire(10, 20, 30, 20)} ${wire(20, 10, 20, 30)}`
  const unjoined = convert(contents).ctx!.db.schematic_trace.list()
  expect(unjoined[0]!.source_trace_id).not.toBe(unjoined[1]!.source_trace_id)

  const joined = convert(
    `${contents} (junction (at 20 20) (diameter 0))`,
  ).ctx!.db.schematic_trace.list()
  expect(joined[0]!.source_trace_id).toBe(joined[1]!.source_trace_id)
  expect(joined.flatMap((trace) => trace.junctions)).toHaveLength(1)
})

test("T endpoints and diagonal wires connect without joining nearby wires", () => {
  const traces = convert(`
    ${wire(10, 10, 30, 30)}
    ${wire(20, 20, 30, 20)}
    ${wire(30, 30, 40, 30)}
    ${wire(20, 20.01, 20, 30)}`).ctx!.db.schematic_trace.list()
  expect(traces[0]!.source_trace_id).toBe(traces[1]!.source_trace_id)
  expect(traces[0]!.source_trace_id).toBe(traces[2]!.source_trace_id)
  expect(traces[0]!.source_trace_id).not.toBe(traces[3]!.source_trace_id)
})

test("junctions belong to their connected net even when another wire comes first", () => {
  const traces = convert(`
    ${wire(50, 10, 60, 10)}
    ${wire(10, 10, 30, 10)}
    ${wire(20, 10, 20, 20)}
    (junction (at 20 10) (diameter 0))`).ctx!.db.schematic_trace.list()
  expect(traces[0]!.junctions).toHaveLength(0)
  expect(traces[1]!.junctions).toHaveLength(1)
  expect(traces[2]!.junctions).toHaveLength(0)
})

test("local and global labels link disconnected wire paths and net aliases", () => {
  const converter = convert(`
    ${wire(10, 10, 20, 10)} ${label("COL3", 15, 10)}
    ${wire(30, 10, 40, 10)} ${label("COL3", 30, 10, true)}
    ${label("COLUMN{slash}3", 40, 10)}
    ${wire(50, 10, 60, 10)} ${label("COLUMN{slash}3", 50, 10)}
    ${wire(70, 10, 80, 10)} ${label("COL4", 70, 10)}`)
  const db = converter.ctx!.db
  const traces = db.schematic_trace.list()
  expect(traces[0]!.source_trace_id).toBe(traces[1]!.source_trace_id)
  expect(traces[0]!.source_trace_id).toBe(traces[2]!.source_trace_id)
  expect(traces[0]!.source_trace_id).not.toBe(traces[3]!.source_trace_id)
  const sourceTrace = db.source_trace.get(traces[0]!.source_trace_id!)!
  expect(sourceTrace.connected_source_net_ids).toHaveLength(2)
  for (const name of ["COL3", "COLUMN/3"]) {
    const net = db.source_net.list().find((net) => net.name === name)!
    expect(net.subcircuit_connectivity_map_key).toBe(
      traces[0]!.subcircuit_connectivity_map_key,
    )
  }
  expect(db.schematic_net_label.list()[0]!.source_trace_id).toBe(
    sourceTrace.source_trace_id,
  )
})

test("custom power symbols join their nets while power flags remain separate", () => {
  const traces = convert(`
    ${wire(10, 10, 20, 10)} ${terminal(10, 10, "G1", "Custom:GND")}
    ${wire(30, 10, 40, 10)} ${terminal(30, 10, "G2", "Custom:GND")}
    ${wire(50, 10, 60, 10)} ${terminal(50, 10, "F1", "Custom:PWR_FLAG")}
    ${wire(70, 10, 80, 10)} ${terminal(70, 10, "F2", "Custom:PWR_FLAG")}`).ctx!.db.schematic_trace.list()
  expect(traces[0]!.source_trace_id).toBe(traces[1]!.source_trace_id)
  expect(traces[2]!.source_trace_id).not.toBe(traces[3]!.source_trace_id)
})

test("touching pins and labels on pins retain connectivity without a wire", () => {
  const db = convert(`
    ${terminal(10, 10, "J1")} ${terminal(10, 10, "J2")}
    ${terminal(20, 10, "J3")} ${label("SIGNAL", 20, 10)}
    ${terminal(30, 10, "J4")} ${label("SIGNAL", 30, 10)}
    ${terminal(40, 10, "J5")}`).ctx!.db
  expect(db.schematic_trace.list()).toHaveLength(0)
  const sourceTraces = db.source_trace.list()
  expect(sourceTraces).toHaveLength(2)
  expect(
    sourceTraces.map((trace) => trace.connected_source_port_ids.length),
  ).toEqual([2, 2])
})
