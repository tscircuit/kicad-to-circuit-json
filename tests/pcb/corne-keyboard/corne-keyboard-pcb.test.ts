import { test, expect } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

test("kicad-to-circuit-json: corne-keyboard PCB", async () => {
  // Load the KiCad PCB file
  const kicadPcbPath = "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  // Convert to Circuit JSON
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("corne-keyboard.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  // Verify we got some output
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  // Write Circuit JSON to file for inspection
  const fs = await import("node:fs/promises")
  await fs.writeFile(
    "tests/pcb/corne-keyboard/__snapshots__/corne-keyboard-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  // Render the original KiCad source directly to SVG.
  const sourceSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
    generatePng: false,
  })
  const sourceSvg = Object.values(sourceSnapshot.generatedFileContent)[0]!

  // Also export the circuit JSON as SVG for inspection
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  await fs.writeFile(
    "tests/pcb/corne-keyboard/__snapshots__/corne-keyboard-circuit-json.svg",
    circuitJsonSvg,
  )

  const width = Number(circuitJsonSvg.match(/\bwidth="([\d.]+)"/)![1])
  const height = Number(circuitJsonSvg.match(/\bheight="([\d.]+)"/)![1])
  // Inline vectors avoid the XML reader's size limit on base64 image attributes.
  const panel = (svg: string, x: number, comparison: string) => {
    const viewBox =
      svg.match(/\bviewBox="([^"]+)"/)?.[1] ?? `0 0 ${width} ${height}`
    const contents = svg
      .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/<title>[\s\S]*?<\/title>/, "")
    return `<svg data-comparison="${comparison}" x="${x}" y="0" width="${width}" height="${height}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${contents}</svg>`
  }
  const sideBySideSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 2}" height="${height}" viewBox="0 0 ${width * 2} ${height}">
<rect width="100%" height="100%" fill="#000"/>
${panel(sourceSvg.toString("utf8"), 0, "source")}
${panel(circuitJsonSvg, width, "converted")}
</svg>`
  expect(sideBySideSvg).toContain('data-comparison="source"')
  expect(sideBySideSvg).toContain('data-comparison="converted"')
  await expect(sideBySideSvg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
