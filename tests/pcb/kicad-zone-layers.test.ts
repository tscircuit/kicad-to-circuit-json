import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

// A four-layer board with one zone on the given layers, set to fill but not
// filled yet, so the pours come from the zone outline and the zone layers.
function importZone(zoneLayers: string) {
  const kicadPcb = [
    `(kicad_pcb (version 20240108) (generator "pcbnew") (generator_version "8.0")`,
    `(general (thickness 1.6))`,
    `(paper "A4")`,
    `(layers (0 "F.Cu" signal) (1 "In1.Cu" signal) (2 "In2.Cu" signal) (31 "B.Cu" signal) (39 "F.Mask" user) (44 "Edge.Cuts" user))`,
    `(setup (pad_to_mask_clearance 0))`,
    `(net 0 "")`,
    `(net 1 "GND")`,
    `(gr_rect (start 0 0) (end 10 10) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid "00000000-0000-4000-8000-000000000001"))`,
    `(zone (net 1) (net_name "GND") ${zoneLayers} (uuid "00000000-0000-4000-8000-000000000002") (hatch edge 0.5)`,
    `(connect_pads (clearance 0.2)) (min_thickness 0.2) (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))`,
    `(polygon (pts (xy 2 2) (xy 8 2) (xy 8 8) (xy 2 8))))`,
    `)`,
  ].join("\n")
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("zone.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const pourLayers: string[] = []
  for (const element of converter.getOutput()) {
    if (element.type === "pcb_copper_pour") pourLayers.push(element.layer)
  }
  const warnings = converter.ctx.warnings ?? []

  return { pourLayers: pourLayers.sort(), warnings }
}

test("KiCad zone layers: a zone on one copper layer", () => {
  expect(importZone(`(layer "In2.Cu")`).pourLayers).toEqual(["inner2"])
})

test("KiCad zone layers: a zone on a list of copper layers", () => {
  expect(importZone(`(layers "F.Cu" "In1.Cu")`).pourLayers).toEqual([
    "inner1",
    "top",
  ])
})

test("KiCad zone layers: *.Cu is every copper layer of the board", () => {
  const allCopperLayers = ["bottom", "inner1", "inner2", "top"]
  expect(importZone(`(layers "*.Cu")`).pourLayers).toEqual(allCopperLayers)
  expect(importZone(`(layer "*.Cu")`).pourLayers).toEqual(allCopperLayers)
})

test("KiCad zone layers: the legacy F&B.Cu is both outer layers", () => {
  expect(importZone(`(layers "F&B.Cu")`).pourLayers).toEqual(["bottom", "top"])
})

test("KiCad zone layers: the copper layers of a mixed list", () => {
  expect(importZone(`(layers "B.Cu" "F.Mask")`).pourLayers).toEqual(["bottom"])
})

test("KiCad zone layers: a zone on a technical layer is not a copper pour", () => {
  const { pourLayers, warnings } = importZone(`(layer "F.Mask")`)
  expect(pourLayers).toEqual([])
  expect(warnings).toContain(
    "Zone on layer F.Mask is not on a copper layer and was not imported as a copper pour",
  )
})
