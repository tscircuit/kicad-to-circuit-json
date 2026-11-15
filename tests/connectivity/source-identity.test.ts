import { expect, test } from "bun:test"
import { any_source_component, source_port } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../lib"
import { resolveSchematicConnectivity } from "../../lib/stages/schematic/resolve-schematic-connectivity"

const rootUuid = "11111111-1111-4111-8111-111111111111"
const symbolUuid = "22222222-2222-4222-8222-222222222222"
const pin = (
  number: string,
  x: number,
  electricalType = "passive",
  extra = "",
  name = number,
) =>
  `(pin ${electricalType} line (at ${x} 0 0) (length 2.54) ${extra} (name "${name}") (number "${number}"))`
const schematic = (libraryId = "Device:R", reference = "R1", value = "10k") =>
  `(kicad_sch (version 20250114) (generator "eeschema") (uuid "${rootUuid}")
    (lib_symbols (symbol "${libraryId}" (symbol "Part_1_1" ${pin("1", 0)} ${pin("2", 10)})))
    (symbol (lib_id "${libraryId}") (at 20 20 0) (unit 1) (uuid "${symbolUuid}")
      (property "Reference" "${reference}") (property "Value" "${value}"))
    (wire (pts (xy 20 20) (xy 30 20))) (label "SIG" (at 20 20 0)))`
const pad = (number: string, x: number, net = true) =>
  `(pad "${number}" smd rect (at ${x} 0) (size 1 1) (layers "F.Cu") ${net ? '(net 1 "SIG")' : ""})`
const footprint = (pads: string, path = `/${rootUuid}/${symbolUuid}`) =>
  `(footprint "Test:R" (layer "F.Cu") (uuid "footprint-r1") (at 20 20)
    ${path ? `(path "${path}")` : ""}
    (property "Reference" "R1") (property "Value" "10k") (property "MPN" "RES-10K") ${pads})`
const board = (contents: string) =>
  `(kicad_pcb (version 20241229) (generator "pcbnew") (general (thickness 1.6))
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal)) (net 1 "SIG") ${contents})`
const convert = (sch?: string, pcb?: string) => {
  const converter = new KicadToCircuitJsonConverter()
  if (sch) converter.addFile("board.kicad_sch", sch)
  if (pcb) converter.addFile("board.kicad_pcb", pcb)
  converter.runUntilFinished()
  return converter
}

test("connectivity resolution is deterministic and leaves its inputs unchanged", () => {
  const input = {
    traces: [
      {
        type: "schematic_trace" as const,
        schematic_trace_id: "wire",
        edges: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }],
        junctions: [],
      },
    ],
    ports: [],
    junctions: [{ x: 1, y: 0 }],
    labels: [{ name: "SIGNAL", position: { x: 0.5, y: 0 } }],
    implicitLabels: [],
  }
  const before = structuredClone(input)
  const first = resolveSchematicConnectivity(input)
  expect(first).toEqual(resolveSchematicConnectivity(input))
  expect(input).toEqual(before)
  expect([...first[0]!.netNames]).toEqual(["SIGNAL"])
})

test.each([
  ["Device:R", "R1", "10k", "resistance", 10000],
  ["Device:C", "C1", "1uF", "capacitance", 0.000001],
  ["Device:L", "L1", "2mH", "inductance", 0.002],
  ["Transistor:Q_PNP", "Q1", "PNP", "transistor_type", "pnp"],
  ["Connector:PinHeader_1x02", "J1", "Header", "pin_count", 2],
] as const)("placed %s produces a schema-valid source component", (libraryId, reference, value, field, expected) => {
  const converter = convert(
    schematic(String(libraryId), String(reference), String(value)),
  )
  const component = converter.ctx!.db.source_component.list()[0]!
  const parsed = any_source_component.parse(component)
  expect(parsed).toHaveProperty(String(field), expected)
  expect(component.display_value).toBe(value)
  expect(component.manufacturer_part_number).toBeUndefined()
})

test.each([
  `/${rootUuid}/${symbolUuid}`,
  "",
])("schematic and PCB reuse component, terminal and net identities (path %s)", (path) => {
  const converter = convert(
    schematic(),
    board(footprint(`${pad("1", 0)} ${pad("2", 10)}`, path)),
  )
  const db = converter.ctx!.db
  expect(db.source_component.list()).toHaveLength(1)
  expect(db.source_component.list()[0]!.manufacturer_part_number).toBe(
    "RES-10K",
  )
  expect(db.source_port.list()).toHaveLength(2)
  expect(db.source_net.list()).toHaveLength(1)
  expect(db.source_trace.list()).toHaveLength(1)
  expect(db.pcb_component.list()[0]!.source_component_id).toBe(
    db.schematic_component.list()[0]!.source_component_id!,
  )
  const connectivity = getFullConnectivityMapFromCircuitJson(
    converter.getOutput(),
  )
  for (const port of db.pcb_port.list()) {
    expect(
      db.schematic_port
        .list()
        .some((p) => p.source_port_id === port.source_port_id),
    ).toBe(true)
    expect(
      connectivity.areIdsConnected(
        port.pcb_port_id,
        db.schematic_trace.list()[0]!.source_trace_id!,
      ),
    ).toBe(true)
  }
})

test("an explicit footprint path does not fall back to an unrelated reference", () => {
  const db = convert(
    schematic(),
    board(footprint(pad("1", 0), "/unrelated-symbol")),
  ).ctx!.db
  expect(db.source_component.list()).toHaveLength(2)
})

test("numeric-looking pin identifiers retain their exact spelling across imports", () => {
  const sch = schematic()
    .replaceAll('(number "1")', '(number "01")')
    .replaceAll('(number "2")', '(number "1")')
  const db = convert(sch, board(footprint(`${pad("01", 0)} ${pad("1", 10)}`)))
    .ctx!.db
  expect(db.source_port.list()).toHaveLength(2)
  expect(db.pcb_port.list()[0]!.source_port_id).not.toBe(
    db.pcb_port.list()[1]!.source_port_id,
  )
  expect(
    db.source_port.list().some((port) => port.port_hints?.includes("01")),
  ).toBe(true)
})

test.each([
  "pcb",
  "footprint",
] as const)("unnetted pads have existing, schema-valid source ports (%s)", (kind) => {
  const standalone = kind === "footprint"
  const fp = footprint(`${pad("1", 0, false)} ${pad("A", 10, false)}`, "")
  const converter = standalone
    ? new KicadFootprintToCircuitJsonConverter()
    : new KicadToCircuitJsonConverter()
  converter.addFile(
    standalone ? "part.kicad_mod" : "part.kicad_pcb",
    standalone ? fp : board(fp),
  )
  converter.runUntilFinished()
  const db = converter.ctx!.db
  expect(db.pcb_port.list()).toHaveLength(2)
  expect(db.source_port.list()).toHaveLength(2)
  for (const port of db.pcb_port.list()) {
    const source = db.source_port.get(port.source_port_id)!
    expect(source_port.safeParse(source).success).toBe(true)
    expect(source.source_component_id).toBe(
      db.pcb_component.get(port.pcb_component_id!)!.source_component_id,
    )
  }
})

test("repeated symbol units share their common logical pins and nets", () => {
  const converter =
    convert(`(kicad_sch (version 20250114) (generator "eeschema")
    (lib_symbols (symbol "Test:Dual"
      (symbol "Dual_0_1" ${pin("7", 0)})
      (symbol "Dual_1_1" ${pin("1", 10)})
      (symbol "Dual_2_1" ${pin("2", 10)})))
    (symbol (lib_id "Test:Dual") (at 10 10 0) (unit 1) (uuid "unit-a") (property "Reference" "U1"))
    (symbol (lib_id "Test:Dual") (at 30 10 0) (unit 2) (uuid "unit-b") (property "Reference" "U1"))
    (wire (pts (xy 10 10) (xy 20 10))) (wire (pts (xy 30 10) (xy 40 10))))`)
  const db = converter.ctx!.db
  expect(db.source_component.list()).toHaveLength(1)
  expect(db.schematic_component.list()).toHaveLength(2)
  expect(db.source_port.list()).toHaveLength(3)
  expect(db.schematic_port.list()).toHaveLength(4)
  expect(db.source_trace.list()).toHaveLength(1)
  expect(db.source_trace.list()[0]!.connected_source_port_ids).toHaveLength(3)
})

test("hidden power inputs join a named net while visible power inputs remain separate", () => {
  const converter =
    convert(`(kicad_sch (version 20250114) (generator "eeschema")
    (lib_symbols
      (symbol "Test:Hidden" (symbol "Hidden_1_1" ${pin("1", 0, "power_in", "hide", "VCC")}))
      (symbol "Test:Visible" (symbol "Visible_1_1" ${pin("1", 0, "power_in", "", "VCC")})))
    (symbol (lib_id "Test:Hidden") (at 10 10 0) (unit 1) (uuid "hidden-a") (property "Reference" "U1"))
    (symbol (lib_id "Test:Hidden") (at 30 10 0) (unit 1) (uuid "hidden-b") (property "Reference" "U2"))
    (symbol (lib_id "Test:Visible") (at 50 10 0) (unit 1) (uuid "visible") (property "Reference" "U3"))
    (wire (pts (xy 10 10) (xy 20 10))) (wire (pts (xy 30 10) (xy 40 10)))
    (wire (pts (xy 50 10) (xy 60 10))))`)
  const traces = converter.ctx!.db.schematic_trace.list()
  expect(traces[0]!.source_trace_id).toBe(traces[1]!.source_trace_id)
  expect(traces[0]!.source_trace_id).not.toBe(traces[2]!.source_trace_id)
  expect(converter.ctx!.db.source_net.list().map((net) => net.name)).toEqual([
    "VCC",
  ])
})

test("PCB net merges retain all schematic trace, label and connectivity references", () => {
  const sch = schematic().replace(
    '(wire (pts (xy 20 20) (xy 30 20))) (label "SIG" (at 20 20 0))',
    '(wire (pts (xy 20 20) (xy 20 10))) (global_label "A" (at 20 20 0)) (wire (pts (xy 30 20) (xy 30 10))) (global_label "B" (at 30 20 0))',
  )
  const db = convert(sch, board(footprint(`${pad("1", 0)} ${pad("2", 10)}`)))
    .ctx!.db
  expect(db.source_trace.list()).toHaveLength(1)
  const sourceTraceId = db.source_trace.list()[0]!.source_trace_id
  expect(
    db.schematic_trace
      .list()
      .every(
        (t) =>
          t.source_trace_id === sourceTraceId &&
          t.subcircuit_connectivity_map_key === sourceTraceId,
      ),
  ).toBe(true)
  expect(
    db.schematic_net_label
      .list()
      .every((label) => label.source_trace_id === sourceTraceId),
  ).toBe(true)
})
