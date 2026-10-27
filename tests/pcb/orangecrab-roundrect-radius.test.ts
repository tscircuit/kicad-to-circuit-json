import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

// OrangeCrab r0.2.1 C13 uses a 0.59 x 0.64 mm pad and roundrect_rratio=0.25.
// The audit measured 0.1475 mm with native pcbnew.GetRoundRectCornerRadius().
// These independently authored minimal boards also exercise the plated paths.
const variants = [
  { name: "SMT top", kind: "smd", layer: "F.Cu", angle: 0, drill: "" },
  { name: "SMT bottom", kind: "smd", layer: "B.Cu", angle: 90, drill: "" },
  { name: "SMT rotated", kind: "smd", layer: "F.Cu", angle: 45, drill: "" },
  {
    name: "plated round drill",
    kind: "thru_hole",
    layer: "F.Cu",
    angle: 0,
    drill: "(drill 0.8)",
  },
  {
    name: "plated oval drill",
    kind: "thru_hole",
    layer: "F.Cu",
    angle: 0,
    drill: "(drill oval 0.8 1.2)",
  },
  {
    name: "plated rotated oval drill",
    kind: "thru_hole",
    layer: "F.Cu",
    angle: 30,
    drill: "(drill oval 0.8 1.2)",
  },
]

const importPad = (variant: (typeof variants)[number], ratio: number) => {
  const smd = variant.kind === "smd"
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "roundrect.kicad_pcb",
    `(kicad_pcb
    (version 20240108) (generator "pcbnew") (general (thickness 1.6))
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
    (footprint "RoundrectRadiusRepro" (layer "${variant.layer}")
      (uuid "10000000-0000-4000-8000-000000000001") (at 10 10)
      (property "Reference" "U1" (at 0 -2) (layer "F.SilkS"))
      (pad "1" ${variant.kind} roundrect (at 0 0 ${variant.angle})
        (size ${smd ? "0.59 0.64" : "2.4 3.2"}) ${variant.drill}
        (layers ${smd ? `"${variant.layer}"` : '"*.Cu" "*.Mask"'})
        (roundrect_rratio ${ratio}))))`,
  )
  converter.runUntilFinished()
  return converter
    .getOutput()
    .find(
      (element) => element.type === (smd ? "pcb_smtpad" : "pcb_plated_hole"),
    )
}

for (const variant of variants) {
  for (const ratio of [0.15, 0.25, 0.5]) {
    test.failing(`${variant.name}: roundrect radius ratio ${ratio}`, () => {
      const pad = importPad(variant, ratio)
      if (pad?.type === "pcb_smtpad" && "corner_radius" in pad) {
        expect(pad.corner_radius).toBeCloseTo(0.59 * ratio, 9)
      } else if (
        pad?.type === "pcb_plated_hole" &&
        "rect_border_radius" in pad
      ) {
        expect(pad.rect_border_radius).toBeCloseTo(2.4 * ratio, 9)
      } else {
        throw new Error("Missing rounded pad geometry")
      }
    })
  }
  test(`${variant.name}: zero ratio remains square`, () => {
    const pad = importPad(variant, 0)
    if (pad?.type === "pcb_smtpad" && "corner_radius" in pad) {
      expect(pad.corner_radius).toBe(0)
    } else if (pad?.type === "pcb_plated_hole" && "rect_border_radius" in pad) {
      expect(pad.rect_border_radius).toBe(0)
    } else {
      throw new Error("Missing rectangular pad geometry")
    }
  })
}
