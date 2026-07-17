import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { KicadToCircuitJsonConverter } from "../../lib"

const board = `(kicad_pcb (version 20240108) (generator pcbnew)
  (general (thickness 1.6))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "b.silkscreen")
    (37 "F.SilkS" user "f.silkscreen")
    (44 "Edge.Cuts" user)
  )
  (net 0 "")
  (net 1 "SIGNAL")
  (net 2 "NC_A")
  (net 3 "NC_B")
  (footprint "Test:TagConnect" (layer "B.Cu")
    (uuid "11111111-1111-4111-8111-111111111111")
    (at 10 10)
    (property "Reference" "J1" (at 0 0 0) (layer "B.SilkS"))
    (property "Value" "TagConnect" (at 0 1 0) (layer "B.SilkS"))
    (pad "1" connect circle (at 0 0) (size 0.8 0.8)
      (layers "B.Cu" "B.Mask") (net 1 "SIGNAL"))
  )
  (footprint "" (layer "F.Cu")
    (uuid "22222222-2222-4222-8222-222222222222")
    (at 20 10)
    (attr board_only exclude_from_pos_files exclude_from_bom)
    (property "Reference" "" (at 0 0 0) (layer "F.SilkS") (hide yes))
    (pad "1" smd circle (at 0 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net 1 "SIGNAL"))
  )
  (footprint "" (layer "F.Cu")
    (uuid "33333333-3333-4333-8333-333333333333")
    (at 22 10)
    (attr board_only exclude_from_pos_files exclude_from_bom)
    (property "Reference" "" (at 0 0 0) (layer "F.SilkS") (hide yes))
    (pad "1" smd circle (at 0 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net 1 "SIGNAL"))
  )
  (footprint "Test:IntentionalShort" (layer "F.Cu")
    (uuid "44444444-4444-4444-8444-444444444444")
    (at 30 10)
    (property "Reference" "D1" (at 0 0 0) (layer "F.SilkS"))
    (property "Value" "IntentionalShort" (at 0 1 0) (layer "F.SilkS"))
    (pad "1" smd circle (at 0 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net 2 "NC_A"))
    (pad "2" smd circle (at 2 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net 3 "NC_B"))
  )
  (segment (start 30 10) (end 32 10) (width 0.2) (layer "F.Cu") (net 3))
)`

function convertBoard() {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", board)
  converter.runUntilFinished()
  return converter.getOutput() as any[]
}

test("connect pads are emitted as surface copper with PCB ports", () => {
  const circuitJson = convertBoard()
  const sourceComponent = circuitJson.find(
    (element) => element.type === "source_component" && element.name === "J1",
  )
  const sourcePort = circuitJson.find(
    (element) =>
      element.type === "source_port" &&
      element.source_component_id === sourceComponent?.source_component_id,
  )
  const pcbPort = circuitJson.find(
    (element) =>
      element.type === "pcb_port" &&
      element.source_port_id === sourcePort?.source_port_id,
  )
  const smtPad = circuitJson.find(
    (element) =>
      element.type === "pcb_smtpad" &&
      element.pcb_component_id === pcbPort?.pcb_component_id,
  )

  expect(sourcePort).toMatchObject({ pin_number: 1 })
  expect(pcbPort).toMatchObject({ layers: ["bottom"] })
  expect(smtPad).toMatchObject({
    pcb_port_id: pcbPort.pcb_port_id,
    layer: "bottom",
    shape: "circle",
  })
})

test("anonymous board-only pads keep geometry without source connectivity", () => {
  const circuitJson = convertBoard()
  const anonymousComponents = circuitJson.filter(
    (element) =>
      element.type === "source_component" &&
      element.name.startsWith("UNREFERENCED_"),
  )
  const anonymousComponentIds = new Set(
    anonymousComponents.map((component) => component.source_component_id),
  )
  const anonymousPcbComponentIds = new Set(
    circuitJson
      .filter(
        (element) =>
          element.type === "pcb_component" &&
          anonymousComponentIds.has(element.source_component_id),
      )
      .map((component) => component.pcb_component_id),
  )

  expect(anonymousComponents).toHaveLength(2)
  expect(
    new Set(anonymousComponents.map((component) => component.name)).size,
  ).toBe(2)
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "source_port" &&
        anonymousComponentIds.has(element.source_component_id),
    ),
  ).toHaveLength(0)
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "pcb_port" &&
        anonymousPcbComponentIds.has(element.pcb_component_id),
    ),
  ).toHaveLength(0)
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "pcb_smtpad" &&
        anonymousPcbComponentIds.has(element.pcb_component_id),
    ),
  ).toHaveLength(2)
})

test("trace endpoints preserve geometric shorts across different net labels", () => {
  const circuitJson = convertBoard()
  const d1 = circuitJson.find(
    (element) => element.type === "source_component" && element.name === "D1",
  )
  const d1Ports = circuitJson.filter(
    (element) =>
      element.type === "source_port" &&
      element.source_component_id === d1.source_component_id,
  )
  const pcbPortIdBySourcePortId = new Map(
    circuitJson
      .filter((element) => element.type === "pcb_port")
      .map((port) => [port.source_port_id, port.pcb_port_id]),
  )
  const traceEndpointPortIds = new Set(
    circuitJson
      .filter((element) => element.type === "pcb_trace")
      .flatMap((trace) =>
        trace.route.flatMap((point: any) =>
          [point.start_pcb_port_id, point.end_pcb_port_id].filter(Boolean),
        ),
      ),
  )

  expect(d1Ports).toHaveLength(2)
  for (const port of d1Ports) {
    expect(traceEndpointPortIds).toContain(
      pcbPortIdBySourcePortId.get(port.source_port_id),
    )
  }

  const connectivityMap = getFullConnectivityMapFromCircuitJson(
    circuitJson as any,
  )
  expect(
    connectivityMap.areIdsConnected(
      d1Ports[0].source_port_id,
      d1Ports[1].source_port_id,
    ),
  ).toBe(true)
})
