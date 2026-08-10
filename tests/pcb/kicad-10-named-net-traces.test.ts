import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { KicadToCircuitJsonConverter } from "../../lib"

const board = `(kicad_pcb (version 20260206) (generator pcbnew)
  (generator_version "10.0")
  (general (thickness 1.6))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen")
    (25 "Edge.Cuts" user)
  )
  (footprint "Test:Pad" (layer "F.Cu")
    (uuid "11111111-1111-4111-8111-111111111111")
    (at 10 10)
    (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd circle (at 0 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net "SIGNAL_A"))
  )
  (footprint "Test:Pad" (layer "F.Cu")
    (uuid "22222222-2222-4222-8222-222222222222")
    (at 20 10)
    (property "Reference" "J2" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd circle (at 0 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net "SIGNAL_A"))
  )
  (footprint "Test:Pad" (layer "F.Cu")
    (uuid "33333333-3333-4333-8333-333333333333")
    (at 15 15)
    (property "Reference" "J3" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd circle (at 0 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net "SIGNAL_A"))
  )
  (footprint "Test:Pad" (layer "F.Cu")
    (uuid "44444444-4444-4444-8444-444444444444")
    (at 10 20)
    (property "Reference" "J4" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd circle (at 0 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net "SIGNAL_B"))
  )
  (footprint "Test:Pad" (layer "F.Cu")
    (uuid "55555555-5555-4555-8555-555555555555")
    (at 20 20)
    (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd circle (at 0 0) (size 1 1)
      (layers "F.Cu" "F.Mask") (net "SIGNAL_B"))
  )
  (segment (start 10 10) (end 15 10) (width 0.25) (layer "F.Cu")
    (net "SIGNAL_A"))
  (segment (start 15 10) (end 20 10) (width 0.25) (layer "F.Cu")
    (net "SIGNAL_A"))
  (segment (start 15 10) (end 15 15) (width 0.25) (layer "F.Cu")
    (net "SIGNAL_A"))
  (segment (start 10 20) (end 20 20) (width 0.25) (layer "F.Cu")
    (net "SIGNAL_B"))
  (gr_rect (start 5 5) (end 25 25) (stroke (width 0.1) (type default))
    (fill none) (layer "Edge.Cuts"))
)`

test("KiCad 10 named nets preserve source connectivity for branched traces", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("named-nets.kicad_pcb", board)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceNets = circuitJson.filter(
    (element) => element.type === "source_net",
  )
  const sourceTraces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )
  const pcbTraces = circuitJson.filter(
    (element) => element.type === "pcb_trace",
  )

  expect(sourceNets.map((net) => net.name).sort()).toEqual([
    "SIGNAL_A",
    "SIGNAL_B",
  ])
  expect(sourceTraces).toHaveLength(2)
  expect(pcbTraces).toHaveLength(4)
  expect(
    pcbTraces.reduce(
      (count, trace) =>
        count +
        trace.route.filter((point) => point.route_type === "wire").length -
        1,
      0,
    ),
  ).toBe(4)
  expect(pcbTraces.every((trace) => trace.source_trace_id)).toBe(true)

  expect(
    sourceTraces
      .map(
        (sourceTrace) =>
          pcbTraces.filter(
            (pcbTrace) =>
              pcbTrace.source_trace_id === sourceTrace.source_trace_id,
          ).length,
      )
      .sort((a, b) => a - b),
  ).toEqual([1, 3])

  const connectivityMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  expect(
    pcbTraces.every((trace) =>
      connectivityMap.getNetConnectedToId(trace.pcb_trace_id),
    ),
  ).toBe(true)
  expect(converter.getWarnings()).toEqual([])
})
