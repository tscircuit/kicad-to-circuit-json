import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadFootprintToCircuitJsonConverter } from "../../lib/KicadFootprintToCircuitJsonConverter"
import { convertKicadFootprintToSvgSnapshot } from "../fixtures/svg-snapshot-test-utils"

function convertFootprint(assetName: string) {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    assetName,
    readFileSync(`tests/assets/${assetName}`, "utf8"),
  )
  converter.runUntilFinished()
  return converter.getOutput() as any[]
}

function padMinX(pad: any): number {
  if (Array.isArray(pad.points)) {
    return Math.min(...pad.points.map((point: any) => point.x))
  }
  if (typeof pad.x === "number") {
    return pad.x - (pad.width ?? 0) / 2
  }
  return Number.POSITIVE_INFINITY
}

// A KiCad "smd custom" pad is the union of its anchor shape (the rect given by
// the pad's (at ...) + (size ...)) and its primitive graphics. The SOT-89-3
// collector tab (pad 2) is an anchor rect (1.475 x 0.9 at x=-1.8625, whose left
// edge reaches x=-2.6) plus a wide polygon (left edge x=-1.125). The converter
// drops the anchor rect and keeps only the polygon, so the tab loses the neck
// that connects toward the leads.
//
// test.failing until the anchor shape is included.
test.failing("custom pad keeps its anchor base shape (SOT-89-3 collector tab)", () => {
  // Visual snapshot of the converted footprint so the collector tab is
  // reviewable. On this branch (no fix) the tab is missing its neck.
  convertKicadFootprintToSvgSnapshot({
    kicadModPath: "tests/assets/SOT-89-3.kicad_mod",
    kicadFileName: "SOT-89-3.kicad_mod",
    testPath: import.meta.path,
    snapshotName: "custom-pad-anchor-shape",
  })

  const output = convertFootprint("SOT-89-3.kicad_mod")
  const pad2 = output.filter(
    (el: any) => el.type === "pcb_smtpad" && el.port_hints?.includes("2"),
  )
  expect(pad2.length).toBeGreaterThan(0)

  // The full pad-2 copper must reach the anchor's left edge (~ -2.6), not
  // stop at the polygon's left edge (~ -1.125).
  const leftmost = Math.min(...pad2.map(padMinX))
  expect(leftmost).toBeLessThan(-2)
})
