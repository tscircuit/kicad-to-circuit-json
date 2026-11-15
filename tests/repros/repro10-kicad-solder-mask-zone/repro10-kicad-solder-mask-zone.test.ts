import { expect, test } from "bun:test"
import "bun-match-svg"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

// Fingers 139 to 148 of the SO-DIMM edge connector J1, on both sides of its
// key notch, cut from the open hardware antmicro/lpddr4-testbed (Apache-2.0,
// KiCad 9). The board has two zones beside the notch, one on F.Mask and one
// on B.Mask: solder mask openings, with no net and no copper.
const fixtureFileName = "lpddr4-testbed-key-notch.kicad_pcb"

async function importFixture() {
  const converter = new KicadToCircuitJsonConverter()
  const content = await Bun.file(
    new URL(`./${fixtureFileName}`, import.meta.url),
  ).text()
  converter.addFile(fixtureFileName, content)
  converter.runUntilFinished()
  const imported = converter.getOutput()

  return { imported, importedPourLayers: getPourLayers(imported) }
}

function getPourLayers(circuitJson: CircuitJson) {
  const pourLayers: string[] = []
  for (const element of circuitJson) {
    if (element.type === "pcb_copper_pour") pourLayers.push(element.layer)
  }

  return pourLayers
}

function summarizePours(pourLayers: string[]) {
  if (pourLayers.length === 0) return "no copper pours"
  const pourCountByLayer: Record<string, number> = {}
  for (const layer of pourLayers) {
    pourCountByLayer[layer] = (pourCountByLayer[layer] ?? 0) + 1
  }
  const layerSummary = Object.entries(pourCountByLayer)
    .map(([layer, pourCount]) => `${pourCount} ${layer}`)
    .join(", ")
  return `${pourLayers.length} copper pours (${layerSummary})`
}

test("repro10: snapshots KiCad solder mask zones", async () => {
  const { imported, importedPourLayers } = await importFixture()
  const expected = imported.filter(
    (element) => element.type !== "pcb_copper_pour",
  )

  const options = {
    width: 480,
    height: 288,
    includeVersion: false,
    viewport: { minX: -3.75, maxX: 3.75, minY: -2.25, maxY: 2.25 },
  }
  const snapshot = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">
  <rect width="100%" height="100%" fill="#101820"/>
  <g fill="white" font-family="sans-serif" font-size="19">
    <text x="16" y="27">Expected: ${summarizePours([])}</text>
    <text x="496" y="27">Imported: ${summarizePours(importedPourLayers)}</text>
    <text x="16" y="53" font-size="15">Edge connector fingers beside the key notch; the zones there are on F.Mask and B.Mask, not on copper</text>
  </g>
  <g transform="translate(0 72)">${convertCircuitJsonToPcbSvg(expected, options)}</g>
  <g transform="translate(480 72)">${convertCircuitJsonToPcbSvg(imported, options)}</g>
</svg>`
  await expect(snapshot).toMatchSvgSnapshot(
    import.meta.path,
    "solder-mask-zone",
  )
})

test("repro10: does not import a KiCad solder mask zone as copper", async () => {
  const { importedPourLayers } = await importFixture()
  expect(importedPourLayers).toEqual([])
})
