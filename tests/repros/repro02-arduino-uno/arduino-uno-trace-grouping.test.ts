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

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-uno.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const pcbTraces = circuitJson.filter(
    (element: any) => element.type === "pcb_trace",
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

  expect(pcbTraces).toHaveLength(232)
  expect(pcbTraces.some((trace) => trace.route.length > 2)).toBe(true)
  expect(pcbTraces.every((trace) => trace.route.length >= 2)).toBe(true)
  expect(
    pcbTraces.reduce(
      (routeSegmentCount, trace) => routeSegmentCount + trace.route.length - 1,
      0,
    ),
  ).toBe(rawSegments.length)
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
