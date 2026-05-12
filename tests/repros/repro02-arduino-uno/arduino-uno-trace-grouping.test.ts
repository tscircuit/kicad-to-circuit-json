import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("stitches Arduino Uno PCB segments into contiguous pcb_trace routes", () => {
  const kicadPcbPath =
    "tests/repros/repro02-arduino-uno/arduino-uno.source.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-uno.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const kicadPcb = converter.ctx!.kicadPcb!
  const rawSegments = Array.isArray(kicadPcb.segments)
    ? kicadPcb.segments
    : kicadPcb.segments
      ? [kicadPcb.segments]
      : []
  const circuitJson = converter.getOutput()
  const pcbTraces = circuitJson.filter(
    (element: any) => element.type === "pcb_trace",
  ) as any[]
  const pcbVias = circuitJson.filter(
    (element: any) => element.type === "pcb_via",
  ) as any[]
  const routeVias = pcbTraces.flatMap((trace) =>
    (trace.route ?? []).filter(
      (routePoint: any) => routePoint.route_type === "via",
    ),
  )
  const sourceTraces = circuitJson.filter(
    (element: any) => element.type === "source_trace",
  ) as any[]
  const sourceTracesById = new Map(
    sourceTraces.map((sourceTrace) => [
      sourceTrace.source_trace_id,
      sourceTrace,
    ]),
  )
  const routeWireSegmentCount = pcbTraces.reduce((count, trace) => {
    const route = trace.route ?? []
    for (let i = 1; i < route.length; i++) {
      const prev = route[i - 1]
      const next = route[i]
      if (
        prev.route_type === "wire" &&
        next.route_type === "wire" &&
        prev.layer === next.layer
      ) {
        count += 1
      }
    }
    return count
  }, 0)

  expect(pcbTraces.length).toBeLessThan(rawSegments.length)
  expect(pcbTraces.some((trace) => trace.route.length > 2)).toBe(true)
  expect(pcbTraces.every((trace) => trace.route.length >= 2)).toBe(true)
  expect(routeWireSegmentCount).toBe(rawSegments.length)
  expect(pcbVias.length).toBeGreaterThan(0)
  expect(routeVias.length).toBeGreaterThan(0)
  expect(
    pcbVias.every(
      (via) =>
        typeof via.hole_diameter === "number" &&
        typeof via.outer_diameter === "number",
    ),
  ).toBe(true)
  expect(
    routeVias.every(
      (via) =>
        typeof via.hole_diameter === "number" &&
        typeof via.outer_diameter === "number",
    ),
  ).toBe(true)
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
