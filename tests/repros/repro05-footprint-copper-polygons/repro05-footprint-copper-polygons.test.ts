import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { createSideBySideSvg } from "../../fixtures/create-side-by-side-svg"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

const fixtureDirectory = "tests/repros/repro05-footprint-copper-polygons"
const kicadPcbPath = `${fixtureDirectory}/watchy-antenna.source.kicad_pcb`

test("repro05: compare imported antenna copper against KiCad", async () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "watchy-antenna.kicad_pcb",
    readFileSync(kicadPcbPath, "utf8"),
  )
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
    generatePng: false,
  })
  const snapshotWidth = 960
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson, {
    width: snapshotWidth,
    matchBoardAspectRatio: true,
    drawPaddingOutsideBoard: false,
    includeVersion: false,
    showCourtyards: true,
  })
  const kicadSvg = Object.values(kicadSnapshot.generatedFileContent)[0]!
  const comparisonSvg = createSideBySideSvg(kicadSvg.toString(), circuitJsonSvg)
  const annotatedComparisonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${snapshotWidth * 2}" height="540" viewBox="0 0 ${snapshotWidth * 2} 540">
  <rect width="100%" height="100%" fill="#000"/>
  <g font-family="sans-serif" fill="white">
    <text x="24" y="32" font-size="24">Left: KiCad source</text>
    <text x="${snapshotWidth + 24}" y="32" font-size="24">Right: Imported PCB</text>
    <text x="24" y="64" font-size="20">AE1: filled F.Cu footprint polygons form the antenna copper.</text>
    <text x="${snapshotWidth + 24}" y="64" font-size="20">AE1: antenna copper polygons are missing; only the two pads remain.</text>
  </g>
  <g transform="translate(0 96)">${comparisonSvg}</g>
</svg>`
  await expect(annotatedComparisonSvg).toMatchSvgSnapshot(
    import.meta.path,
    "watchy-antenna",
  )
})
