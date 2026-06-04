import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("kicad-to-circuit-json: assigns unique ids to generated pad primitives", () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive")
    (33 "F.Adhes" user "F.Adhesive")
    (34 "B.Paste" user)
    (35 "F.Paste" user)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user)
    (39 "F.Mask" user)
    (44 "Edge.Cuts" user)
  )
  (footprint "Test:PadIds" (layer "F.Cu")
    (at 0 0)
    (tstamp "test-pad-ids")
    (attr smd)
    (fp_text reference "REF**" (at 0 -3) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_text value "PadIds" (at 0 3) (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (pad "1" smd custom (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")
      (primitives
        (gr_circle (center 0 0) (end 0.4 0) (width 0) (fill yes))
      )
    )
    (pad "2" smd custom (at 2 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")
      (primitives
        (gr_circle (center 0 0) (end 0.4 0) (width 0) (fill yes))
      )
    )
    (pad "3" thru_hole rect (at 0 3) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask"))
    (pad "4" thru_hole rect (at 2 3) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask"))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const smtpadIds = output
    .filter((el: any) => el.type === "pcb_smtpad")
    .map((el: any) => el.pcb_smtpad_id)
  const platedHoleIds = output
    .filter((el: any) => el.type === "pcb_plated_hole")
    .map((el: any) => el.pcb_plated_hole_id)

  expect(smtpadIds).toHaveLength(2)
  expect(smtpadIds.every((id) => typeof id === "string")).toBe(true)
  expect(new Set(smtpadIds).size).toBe(smtpadIds.length)
  expect(smtpadIds).not.toContain("pcb_smtpad_id")

  expect(platedHoleIds).toHaveLength(2)
  expect(platedHoleIds.every((id) => typeof id === "string")).toBe(true)
  expect(new Set(platedHoleIds).size).toBe(platedHoleIds.length)
  expect(platedHoleIds).not.toContain("pcb_plated_hole_id")
})
