import { expect } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../lib"

export function convertKicadPcbToSvgSnapshot(params: {
  kicadPcbPath: string
  kicadFileName: string
  testPath: string
  snapshotName: string
}) {
  const kicadPcbContent = readFileSync(params.kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(params.kicadFileName, kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson.length).toBeGreaterThan(0)
  expect(circuitJson.some((el: any) => el.type === "pcb_board")).toBe(true)

  const circuitJsonSvg = convertCircuitJsonToPcbSvg(
    removeFabricationNoteElementsFromPcbPreview(circuitJson) as any,
    {
      showCourtyards: true,
    },
  )

  expectSvgSnapshot(circuitJsonSvg, params.testPath, params.snapshotName)
}

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

function removeFabricationNoteElementsFromPcbPreview(circuitJson: any[]) {
  return circuitJson.filter(
    (el) =>
      el.type !== "pcb_fabrication_note_text" &&
      el.type !== "pcb_fabrication_note_path" &&
      el.type !== "pcb_fabrication_note_rect" &&
      el.type !== "pcb_fabrication_note_dimension",
  )
}
