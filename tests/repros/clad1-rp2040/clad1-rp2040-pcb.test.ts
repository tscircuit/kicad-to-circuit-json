import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { convertKicadPcbToSvgSnapshot } from "../../fixtures/svg-snapshot-test-utils"

const kicadPcbPath = path.join(import.meta.dir, "clad1-rp2040.kicad_pcb")

test("kicad-to-circuit-json repro: full clad1 RP2040 PCB snapshot", () => {
  convertKicadPcbToSvgSnapshot({
    kicadPcbPath,
    kicadFileName: "clad1-rp2040.kicad_pcb",
    testPath: import.meta.path,
    snapshotName: "clad1-rp2040-circuit-json",
    assertSnapshot: true,
  })
})

test("preserves the clad1 C_XIN-area trace width transition", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "clad1-rp2040.kicad_pcb",
    readFileSync(kicadPcbPath, "utf8"),
  )
  converter.runUntilFinished()

  const pcbTraces = converter
    .getOutput()
    .filter((element: any) => element.type === "pcb_trace") as any[]
  const isAt = (point: any, x: number, y: number) =>
    Math.abs(point.x - x) < 1e-6 && Math.abs(point.y - y) < 1e-6

  // These GND segments run directly below C_XIN in the supplied KiCad board.
  const transitionTrace = pcbTraces.find(
    ({ route }) =>
      route.some((point: any) => isAt(point, 7, -15)) &&
      route.some((point: any) => isAt(point, 8.1, -13.9)),
  )

  expect(transitionTrace).toBeDefined()
  expect(
    transitionTrace.route.map(({ x, y, width }: any) => ({
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      width,
    })),
  ).toEqual([
    { x: 7, y: -6.1, width: 0.1 },
    { x: 7, y: -15, width: 0.25 },
    { x: 8.1, y: -13.9, width: 0.25 },
    { x: 22.6, y: -13.9, width: 0.25 },
  ])
})
