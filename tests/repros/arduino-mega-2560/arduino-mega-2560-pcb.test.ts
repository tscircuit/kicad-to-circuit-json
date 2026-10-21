import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("kicad-to-circuit-json repro: Arduino Mega 2560 PCB", () => {
  const kicadPcbPath = "tests/assets/Arduino Mega 2560.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-mega-2560.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson.length).toBeGreaterThan(0)
  expect(circuitJson.some((el: any) => el.type === "pcb_board")).toBe(true)
  expect(circuitJson.some((el: any) => el.type === "pcb_component")).toBe(true)
  expect(circuitJson.some((el: any) => el.type === "pcb_trace")).toBe(true)

  const mechanicalCutouts = circuitJson.filter(
    (el: any) =>
      el.type === "pcb_cutout" &&
      el.shape === "circle" &&
      Math.abs(el.radius - 1.6) < 1e-6,
  )
  expect(mechanicalCutouts).toHaveLength(6)

  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })

  expectSvgSnapshot(
    circuitJsonSvg,
    import.meta.path,
    "arduino-mega-2560-circuit-json",
  )
})

function expectSvgSnapshot(
  svg: string,
  testPath: string,
  snapshotName: string,
) {
  const normalizedSvg = normalizeTransientSvgIds(svg)
  const snapshotDir = path.join(path.dirname(testPath), "__snapshots__")
  const snapshotPath = path.join(snapshotDir, `${snapshotName}.snap.svg`)
  const shouldUpdateSnapshot =
    process.argv.includes("--update-snapshots") ||
    process.argv.includes("-u") ||
    Boolean(process.env["BUN_UPDATE_SNAPSHOTS"])

  if (!existsSync(snapshotDir)) {
    mkdirSync(snapshotDir, { recursive: true })
  }

  if (!existsSync(snapshotPath) || shouldUpdateSnapshot) {
    writeFileSync(snapshotPath, normalizedSvg)
  }

  expect(normalizedSvg).toBe(readFileSync(snapshotPath, "utf-8"))
}

function normalizeTransientSvgIds(svg: string) {
  return svg
    .replaceAll(
      /silkscreen-knockout-mask-(pcb_silkscreen_text_\d+)-\d+/g,
      "silkscreen-knockout-mask-$1",
    )
    .replaceAll(/knockout-mask-(pcb_copper_text_\d+)-\d+/g, "knockout-mask-$1")
}

test.failing("V12: Arduino Mega fabrication circles stay within 0.001 mm", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "arduino-mega-2560.kicad_pcb",
    readFileSync("tests/assets/Arduino Mega 2560.kicad_pcb", "utf8"),
  )
  converter.runUntilFinished()
  const elements = converter.getOutput()
  const sources = elements.filter((e) => e.type === "source_component")
  const components = elements.filter((e) => e.type === "pcb_component")
  const circles = elements.filter((e) => e.type === "pcb_fabrication_note_path")
  for (const reference of ["FID1", "FID2", "FID3", "FID4"]) {
    const source = sources.find((e) => e.name === reference)!
    const component = components.find(
      (e) => e.source_component_id === source.source_component_id,
    )!
    const circle = circles.find(
      (e) =>
        e.pcb_component_id === component.pcb_component_id &&
        e.route.length >= 17,
    )!
    for (let i = 1; i < circle.route.length; i++) {
      const start = circle.route[i - 1]!
      const end = circle.route[i]!
      const midpointRadius = Math.hypot(
        (start.x + end.x) / 2 - component.center.x,
        (start.y + end.y) / 2 - component.center.y,
      )
      expect(1.5 - midpointRadius).toBeLessThanOrEqual(0.001)
    }
  }
})
