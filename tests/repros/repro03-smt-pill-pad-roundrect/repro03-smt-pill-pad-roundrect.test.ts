import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("kicad-to-circuit-json repro03: SMD roundrect pill pad radius", async () => {
  const kicadPcbPath =
    "tests/repros/repro03-smt-pill-pad-roundrect/smt-pill-pad-roundrect.source.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("smt-pill-pad-roundrect.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  const fs = await import("node:fs/promises")
  await fs.mkdir("tests/repros/repro03-smt-pill-pad-roundrect/__snapshots__", {
    recursive: true,
  })
  await fs.writeFile(
    "tests/repros/repro03-smt-pill-pad-roundrect/__snapshots__/repro03-smt-pill-pad-roundrect-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
  })

  const kicadPng = Object.values(kicadSnapshot.generatedFileContent)[0]!
  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "pcb",
  })

  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  await fs.writeFile(
    "tests/repros/repro03-smt-pill-pad-roundrect/__snapshots__/repro03-smt-pill-pad-roundrect-circuit-json.svg",
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "repro03-smt-pill-pad-roundrect-pcb",
  )
})
