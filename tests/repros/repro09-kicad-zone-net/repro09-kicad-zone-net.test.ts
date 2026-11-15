import { expect, test } from "bun:test"
import "bun-match-svg"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

// Fingers 93 to 107 of the SO-DIMM edge connector J1 and the top-layer VDD2
// zone that joins the eight VDD2 fingers, cut from the open hardware
// antmicro/lpddr4-testbed (Apache-2.0, KiCad 9).
const fixtureFileName = "lpddr4-testbed-vdd2-fingers.kicad_pcb"

// The zone is on net VDD2: (zone (net 188) (net_name "VDD2") (layer "F.Cu")).
const expectedPourNetNames = ["VDD2"]

async function importFixture() {
  const converter = new KicadToCircuitJsonConverter()
  const content = await Bun.file(
    new URL(`./${fixtureFileName}`, import.meta.url),
  ).text()
  converter.addFile(fixtureFileName, content)
  converter.runUntilFinished()
  const imported = converter.getOutput()

  return { imported, importedPourNetNames: getPourNetNames(imported) }
}

// The name of the source net each copper pour is connected to.
function getPourNetNames(circuitJson: CircuitJson) {
  const netNameBySourceNetId = new Map<string, string>()
  for (const element of circuitJson) {
    if (element.type !== "source_net") continue
    netNameBySourceNetId.set(element.source_net_id, element.name)
  }

  const pourNetNames: string[] = []
  for (const element of circuitJson) {
    if (element.type !== "pcb_copper_pour") continue
    const netName = netNameBySourceNetId.get(element.source_net_id ?? "")
    pourNetNames.push(netName ?? "no net")
  }

  return pourNetNames
}

function getPourNetLegend(pourNetNames: string[]): CircuitJson {
  return pourNetNames.map((pourNetName, pourIndex) => ({
    type: "pcb_silkscreen_text",
    pcb_silkscreen_text_id: `legend_text_${pourIndex}`,
    pcb_component_id: "legend",
    font: "tscircuit2024",
    font_size: 0.3,
    text: `top pour: ${pourNetName}`,
    layer: "top",
    anchor_position: { x: 2.5, y: 1.5 - pourIndex * 0.5 },
    anchor_alignment: "center_left",
  }))
}

test("repro09: snapshots the net of a KiCad zone", async () => {
  const { imported, importedPourNetNames } = await importFixture()

  const options = {
    width: 480,
    height: 288,
    includeVersion: false,
    layer: "top" as const,
    viewport: { minX: -2.6, maxX: 6.4, minY: -2.7, maxY: 2.7 },
  }
  const expectedLegend = getPourNetLegend(expectedPourNetNames)
  const importedLegend = getPourNetLegend(importedPourNetNames)
  const snapshot = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">
  <rect width="100%" height="100%" fill="#101820"/>
  <g fill="white" font-family="sans-serif" font-size="19">
    <text x="16" y="27">Expected: pour on ${expectedPourNetNames.join(", ")}</text>
    <text x="496" y="27">Imported: pour on ${importedPourNetNames.join(", ")}</text>
    <text x="16" y="53" font-size="15">The top-layer zone that joins the eight VDD2 fingers, labelled with the source net of its pcb_copper_pour</text>
  </g>
  <g transform="translate(0 72)">${convertCircuitJsonToPcbSvg([...imported, ...expectedLegend], options)}</g>
  <g transform="translate(480 72)">${convertCircuitJsonToPcbSvg([...imported, ...importedLegend], options)}</g>
</svg>`
  await expect(snapshot).toMatchSvgSnapshot(import.meta.path, "zone-net")
})

test.failing("repro09: connects a KiCad zone to the source net it is on", async () => {
  const { importedPourNetNames } = await importFixture()
  expect(importedPourNetNames).toEqual(expectedPourNetNames)
})
