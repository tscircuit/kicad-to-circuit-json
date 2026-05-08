import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("converts Arduino Uno PCB tracks into per-primitive pcb_trace routes", () => {
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

  const pcbTraces = converter
    .getOutput()
    .filter((element: any) => element.type === "pcb_trace") as any[]
  const wireTraces = pcbTraces.filter(
    (trace) => trace.route[0]?.route_type === "wire",
  )
  const viaTraces = pcbTraces.filter(
    (trace) => trace.route[0]?.route_type === "via",
  )

  expect(wireTraces).toHaveLength(rawSegments.length)
  expect(viaTraces).toHaveLength(rawVias.length)
  expect(wireTraces.every((trace) => trace.route.length === 2)).toBe(true)
  expect(viaTraces.every((trace) => trace.route.length === 1)).toBe(true)
})
