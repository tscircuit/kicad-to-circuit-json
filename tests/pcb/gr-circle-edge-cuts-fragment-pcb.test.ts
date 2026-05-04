import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"
import { takeKicadSnapshot } from "../fixtures/take-kicad-snapshot"
import { takeCircuitJsonSnapshot } from "../fixtures/take-circuit-json-snapshot"
import { stackCircuitJsonKicadPngs } from "../fixtures/stackCircuitJsonKicadPngs"
import "../fixtures/png-matcher"

test("kicad-to-circuit-json: Edge.Cuts gr_circle fragment PCB", async () => {
  const kicadPcbPath = "tests/assets/gr-circle-edge-cuts-fragment.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("gr-circle-edge-cuts-fragment.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  const pcbBoard = circuitJson.find(
    (element: any) => element.type === "pcb_board",
  )
  expect(pcbBoard).toBeDefined()
  expect(pcbBoard.outline.length).toBeGreaterThan(100)
  expect(pcbBoard.width).toBeCloseTo(20.05, 2)
  expect(pcbBoard.height).toBeCloseTo(20.05, 2)

  const fs = await import("node:fs/promises")
  await fs.writeFile(
    "tests/pcb/__snapshots__/gr-circle-edge-cuts-fragment-circuit-json.json",
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
    "tests/pcb/__snapshots__/gr-circle-edge-cuts-fragment-circuit-json.svg",
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "gr-circle-edge-cuts-fragment-pcb",
  )
}, 20_000)
