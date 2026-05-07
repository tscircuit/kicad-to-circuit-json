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

  const pcbTraces = converter
    .getOutput()
    .filter((element: any) => element.type === "pcb_trace") as any[]

  expect(pcbTraces).toHaveLength(232)
  expect(pcbTraces.some((trace) => trace.route.length > 2)).toBe(true)
  expect(pcbTraces.every((trace) => trace.route.length >= 2)).toBe(true)
  expect(
    pcbTraces.reduce(
      (routeSegmentCount, trace) => routeSegmentCount + trace.route.length - 1,
      0,
    ),
  ).toBe(rawSegments.length)
})
