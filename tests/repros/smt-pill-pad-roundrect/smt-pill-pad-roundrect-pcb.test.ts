import { test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("kicad-to-circuit-json repro: SMD roundrect pill pads", async () => {
  const kicadPcbPath =
    "tests/repros/smt-pill-pad-roundrect/smt-pill-pad-roundrect.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("smt-pill-pad-roundrect.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  const snapshotDir = "tests/repros/smt-pill-pad-roundrect/__snapshots__"
  await mkdir(snapshotDir, { recursive: true })
  await writeFile(
    `${snapshotDir}/smt-pill-pad-roundrect-circuit-json.json`,
    JSON.stringify(circuitJson, null, 2),
  )

  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  await writeFile(
    `${snapshotDir}/smt-pill-pad-roundrect-circuit-json.svg`,
    circuitJsonSvg,
  )
  await writeFile(
    `${snapshotDir}/smt-pill-pad-roundrect-circuit-json.snap.svg`,
    normalizeTransientSvgIds(circuitJsonSvg),
  )
})

function normalizeTransientSvgIds(svg: string) {
  return svg
    .replaceAll(
      /silkscreen-knockout-mask-(pcb_silkscreen_text_\d+)-\d+/g,
      "silkscreen-knockout-mask-$1",
    )
    .replaceAll(/knockout-mask-(pcb_copper_text_\d+)-\d+/g, "knockout-mask-$1")
}
