import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"

const POINT_KEY_PRECISION = 1e6

const getPointKey = (point: { x: number; y: number }) => {
  const x = Math.round(point.x * POINT_KEY_PRECISION)
  const y = Math.round(point.y * POINT_KEY_PRECISION)
  return `${x},${y}`
}

test("emits every Arduino Nano KiCad via as a pcb_via", () => {
  const kicadPcbPath = "tests/repros/arduino-nano/arduino-nano.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")
  const kicadPcb = parseKicadPcb(kicadPcbContent)
  const rawVias = Array.isArray(kicadPcb.vias)
    ? kicadPcb.vias
    : kicadPcb.vias
      ? [kicadPcb.vias]
      : []

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-nano.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const pcbTraces = circuitJson.filter(
    (element: any) => element.type === "pcb_trace",
  ) as any[]
  const pcbVias = circuitJson.filter(
    (element: any) => element.type === "pcb_via",
  ) as any[]
  const routeVias = pcbTraces.flatMap((trace) =>
    trace.route.filter((routePoint: any) => routePoint.route_type === "via"),
  )
  const traceRoutePointKeys = new Set(
    pcbTraces.flatMap((trace) =>
      trace.route.map((routePoint: any) => getPointKey(routePoint)),
    ),
  )
  const pcbViasOnTraceRoutePoints = pcbVias.filter((via) =>
    traceRoutePointKeys.has(getPointKey(via)),
  )

  expect(routeVias.length).toBeGreaterThan(0)
  expect(pcbVias).toHaveLength(rawVias.length)
  expect(pcbViasOnTraceRoutePoints.length).toBeGreaterThanOrEqual(
    routeVias.length,
  )
})
