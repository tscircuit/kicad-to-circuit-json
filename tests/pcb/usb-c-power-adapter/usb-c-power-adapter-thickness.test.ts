import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { applyToPoint, inverse } from "transformation-matrix"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

test("repro4948: USB-C Power Adapter preserves 4 layers and board thickness on import", async () => {
  const content = readFileSync(
    "tests/assets/usb-c-power-adapter.kicad_pcb",
    "utf8",
  )
  const source = parseKicadPcb(content)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("usb-c-power-adapter.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const board = circuitJson.find((item) => item.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  expect(source.general?.thickness).toBe(1.59)
  expect(board.num_layers).toBe(4)
  expect(board.thickness).toBe(1.59)

  const center = applyToPoint(inverse(converter.ctx!.k2cMatPcb!), board.center)
  const width = board.width + 4
  const height = board.height + 4
  const original = await takeKicadSnapshot({
    kicadFileContent: content,
    kicadFileType: "pcb",
    generatePng: false,
    pcbSnapshotBounds: "circuit-json",
  })
  const originalSvg = Object.values(
    original.generatedFileContent,
  )[0]!.toString()
  const importedSvg = convertCircuitJsonToPcbSvg(
    circuitJson.filter((item) => !item.type.startsWith("pcb_fabrication")),
    {
      width: 560,
      height: 690,
      viewport: {
        minX: -width / 2,
        maxX: width / 2,
        minY: -height / 2,
        maxY: height / 2,
      },
      includeVersion: false,
      showCourtyards: false,
      showPcbNotes: false,
      colorOverrides: { drill: "#e2e8f0", substrate: "#263440" },
    },
  )
  const panel = (svg: string, x: number, viewBox: string) =>
    `<svg x="${x}" y="125" width="560" height="690" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${svg
      .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/<title>[\s\S]*?<\/title>/, "")}</svg>`
  const preserved = board.thickness === source.general?.thickness
  const importedThickness =
    board.thickness === undefined ? "missing" : `${board.thickness} mm`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="880" viewBox="0 0 1200 880">
<rect width="100%" height="100%" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">USB-C Power Adapter — board thickness</text>
<text x="24" y="78" font-size="22">Original KiCad · full board</text>
<text x="616" y="78" font-size="22">Current Circuit JSON import · full board</text>
<text x="24" y="108" font-size="19" fill="#8fd6a7">4 copper layers · thickness ${source.general?.thickness} mm</text>
<text x="616" y="108" font-size="19" fill="${preserved ? "#8fd6a7" : "#ff8585"}">${board.num_layers} copper layers · thickness ${importedThickness}</text>
<text x="24" y="854" font-size="18">Board thickness is manufacturing metadata; the top-view geometry alone cannot reveal this loss.</text>
</g>
${panel(originalSvg, 24, `${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`)}
${panel(importedSvg, 616, "0 0 560 690")}
</svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
