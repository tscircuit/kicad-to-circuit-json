import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("stitches Arduino Uno PCB segments into contiguous pcb_trace routes", () => {
  const kicadPcbPath =
    "tests/repros/repro02-arduino-uno/arduino-uno.source.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")
  const kicadPcb = parseKicadPcb(kicadPcbContent)
  const rawSegments = Array.isArray(kicadPcb.segments)
    ? kicadPcb.segments
    : kicadPcb.segments
      ? [kicadPcb.segments]
      : []
  const rawVias = Array.isArray(kicadPcb.vias)
    ? kicadPcb.vias
    : kicadPcb.vias
      ? [kicadPcb.vias]
      : []

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-uno.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const pcbTraces = circuitJson.filter(
    (element: any) => element.type === "pcb_trace",
  ) as any[]
  const pcbVias = circuitJson.filter(
    (element: any) => element.type === "pcb_via",
  ) as any[]
  const sourceTraces = circuitJson.filter(
    (element: any) => element.type === "source_trace",
  ) as any[]
  const sourceTracesById = new Map(
    sourceTraces.map((sourceTrace) => [
      sourceTrace.source_trace_id,
      sourceTrace,
    ]),
  )

  const routeVias = pcbTraces.flatMap((trace) =>
    trace.route.filter((routePoint: any) => routePoint.route_type === "via"),
  )
  const wireSegmentCount = pcbTraces.reduce((segmentCount, trace) => {
    let count = segmentCount
    for (let i = 1; i < trace.route.length; i++) {
      const previous = trace.route[i - 1]
      const current = trace.route[i]
      if (
        previous.route_type === "wire" &&
        current.route_type === "wire" &&
        previous.layer === current.layer
      ) {
        count++
      }
    }
    return count
  }, 0)

  expect(pcbTraces).toHaveLength(188)
  expect(routeVias.length).toBeGreaterThan(0)
  expect(routeVias.length).toBeGreaterThan(pcbVias.length)
  expect(routeVias.length + pcbVias.length).toBe(rawVias.length)
  expect(
    routeVias.every(
      (via: any) =>
        via.from_layer &&
        via.to_layer &&
        via.from_layer !== via.to_layer &&
        via.outer_diameter &&
        via.hole_diameter,
    ),
  ).toBe(true)
  expect(pcbTraces.some((trace) => trace.route.length > 2)).toBe(true)
  expect(pcbTraces.every((trace) => trace.route.length >= 2)).toBe(true)
  expect(wireSegmentCount).toBe(rawSegments.length)
  expect(
    sourceTraces.every(
      (sourceTrace) => sourceTrace.connected_source_port_ids.length > 0,
    ),
  ).toBe(true)
  expect(
    sourceTraces.every(
      (sourceTrace) => sourceTrace.connected_source_port_ids.length <= 2,
    ),
  ).toBe(true)
  expect(
    pcbTraces.every((pcbTrace) => {
      const sourceTrace = sourceTracesById.get(pcbTrace.source_trace_id)
      return (
        sourceTrace &&
        sourceTrace.connected_source_port_ids.length +
          sourceTrace.connected_source_net_ids.length >=
          2
      )
    }),
  ).toBe(true)
})
