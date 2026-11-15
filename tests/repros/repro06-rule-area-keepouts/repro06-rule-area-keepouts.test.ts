import { expect, test } from "bun:test"
import "bun-match-svg"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../../lib"

async function importFixture() {
  const content = await Bun.file(
    new URL("./copper-only-keepout.kicad_pcb", import.meta.url),
  ).text()
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("copper-only-keepout.kicad_pcb", content)
  converter.runUntilFinished()
  const imported = converter.getOutput()
  const keepouts = imported.filter((element) => element.type === "pcb_keepout")

  return { imported, keepouts }
}

test("repro06: snapshots a copper-only KiCad rule area", async () => {
  const { imported, keepouts } = await importFixture()

  // The 20 x 12 mm board centers (10, 6) at (0, 0). Its authored
  // (6, 4)..(14, 8) rule area is therefore an 8 x 4 mm centered rectangle.
  const expected: CircuitJson = [
    {
      type: "pcb_board",
      pcb_board_id: "expected_board",
      center: { x: 0, y: 0 },
      width: 20,
      height: 12,
      num_layers: 2,
      thickness: 1.6,
      material: "fr4",
    },
    {
      type: "pcb_keepout",
      pcb_keepout_id: "expected_keepout",
      shape: "rect",
      center: { x: 0, y: 0 },
      width: 8,
      height: 4,
      layers: ["top", "bottom"],
    },
  ]
  const options = {
    width: 480,
    height: 288,
    includeVersion: false,
    layer: "top" as const,
    viewport: { minX: -11, maxX: 11, minY: -7, maxY: 7 },
  }
  const snapshot = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">
  <rect width="100%" height="100%" fill="#101820"/>
  <g fill="white" font-family="sans-serif" font-size="19">
    <text x="16" y="27">Expected: 8 x 4 mm copper keepout</text>
    <text x="496" y="27">Imported: ${keepouts.length} keepouts</text>
    <text x="16" y="53" font-size="15">Top and bottom copper; tracks, vias and placements allowed</text>
  </g>
  <g transform="translate(0 72)">${convertCircuitJsonToPcbSvg(expected, options)}</g>
  <g transform="translate(480 72)">${convertCircuitJsonToPcbSvg(imported, options)}</g>
</svg>`
  await expect(snapshot).toMatchSvgSnapshot(import.meta.path, "copper-only")
})

test("repro06: preserves a copper-only KiCad rule area", async () => {
  const { imported, keepouts } = await importFixture()
  expect(keepouts).toHaveLength(1)
  expect(keepouts[0]).toMatchObject({
    shape: "rect",
    center: { x: 0, y: 0 },
    width: 8,
    height: 4,
    layers: ["top", "bottom"],
    allow_traces: true,
    allow_placements: true,
  })
  expect(
    imported.filter((element) => element.type === "pcb_copper_pour"),
  ).toHaveLength(0)
})
