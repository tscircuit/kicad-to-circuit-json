import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { KicadFootprintToCircuitJsonConverter } from "../../../lib/KicadFootprintToCircuitJsonConverter"

test("repro: standalone footprint reference at 180 should not flip refdes", async () => {
  const sourcePath =
    "tests/repros/standalone-reference-text-rotation/standalone-reference-text-rotation.source.kicad_mod"
  const snapshotPath =
    "tests/repros/standalone-reference-text-rotation/__snapshots__/standalone-reference-text-rotation-circuit-json.json"
  const svgSnapshotPath =
    "tests/repros/standalone-reference-text-rotation/__snapshots__/standalone-reference-text-rotation-circuit-json.svg"

  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "standalone-reference-text-rotation.source.kicad_mod",
    readFileSync(sourcePath, "utf8"),
  )
  converter.runUntilFinished()

  const output = converter.getOutput() as any[]
  await mkdir("tests/repros/standalone-reference-text-rotation/__snapshots__", {
    recursive: true,
  })
  await writeFile(snapshotPath, JSON.stringify(output, null, 2))
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const svg = convertCircuitJsonToPcbSvg(output as any, {
    showCourtyards: true,
  })
  await writeFile(svgSnapshotPath, svg)

  const referenceText = output.find(
    (el) => el.type === "pcb_silkscreen_text" && el.text === "REF**",
  )
  const valueText = output.find(
    (el) =>
      el.type === "pcb_fabrication_note_text" &&
      el.text === "SMA_Samtec_SMA-J-P-H-ST-EM1_EdgeMount",
  )

  expect(referenceText).toBeDefined()
  expect(referenceText.ccw_rotation ?? 0).toBe(0)
  expect(valueText).toBeDefined()
})
