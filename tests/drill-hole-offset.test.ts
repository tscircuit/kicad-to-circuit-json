import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"
import { getCircuitJsonHoleOffset } from "../lib/stages/pcb/CollectFootprintsStage/pad-drill-offset"
import { PadDrill, PadDrillOffset } from "kicadts"

const boardPreamble = `(kicad_pcb (version 20211014) (generator pcbnew)
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
`

test("getCircuitJsonHoleOffset flips Y and rotates by pad angle", () => {
  expect(
    getCircuitJsonHoleOffset({
      drill: new PadDrill({ diameter: 0.8, offset: { x: 0.3, y: 0.1 } }),
    }),
  ).toEqual({ hole_offset_x: 0.3, hole_offset_y: -0.1 })

  expect(
    getCircuitJsonHoleOffset({
      drill: new PadDrill({
        diameter: 0.8,
        offset: new PadDrillOffset(0.3, 0),
      }),
      padAngleDegrees: 90,
    }),
  ).toEqual({ hole_offset_x: 0, hole_offset_y: -0.3 })

  expect(
    getCircuitJsonHoleOffset({
      drill: new PadDrill({ diameter: 0.8 }),
    }),
  ).toEqual({ hole_offset_x: 0, hole_offset_y: 0 })
})

test("kicad-to-circuit-json: copies KiCad drill offset onto plated holes", () => {
  const kicadPcb = `${boardPreamble}
  (footprint "Test:OffsetDrill" (layer "F.Cu")
    (at 0 0)
    (tstamp "test-offset-drill")
    (attr through_hole)
    (pad "1" thru_hole roundrect (at 0 0) (size 1.7 1.95) (drill 0.9 (offset 0.3 0.1)) (layers "*.Cu" "*.Mask") (roundrect_rratio 0.15))
    (pad "2" thru_hole rect (at 5 0 90) (size 1.7 1.95) (drill 0.9 (offset 0.3 0)) (layers "*.Cu" "*.Mask"))
    (pad "3" thru_hole circle (at 10 0) (size 1.6 1.6) (drill 0.8 (offset 0.25 0)) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at 0 5) (size 1.2 1.2) (drill 1.2 (offset 0.4 0)) (layers "*.Cu" "*.Mask"))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const platedHoles = output.filter((el: any) => el.type === "pcb_plated_hole")
  const holes = output.filter((el: any) => el.type === "pcb_hole")
  const platedByHint = Object.fromEntries(
    platedHoles.map((hole: any) => [hole.port_hints?.[0], hole]),
  )

  expect(platedByHint["1"]).toMatchObject({
    shape: "circular_hole_with_rect_pad",
    hole_offset_x: 0.3,
    hole_offset_y: -0.1,
    hole_diameter: 0.9,
  })

  expect(platedByHint["2"]).toMatchObject({
    shape: "circular_hole_with_rect_pad",
    hole_offset_x: 0,
    hole_offset_y: -0.3,
    hole_diameter: 0.9,
  })

  expect(platedByHint["3"]).toMatchObject({
    shape: "circular_hole_with_rect_pad",
    hole_offset_x: 0.25,
    hole_offset_y: 0,
    hole_diameter: 0.8,
  })

  expect(holes).toHaveLength(1)
  const npth = holes[0] as { x: number; y: number }
  const pad1 = platedByHint["1"] as { x: number; y: number }
  expect(npth.x).toBeCloseTo(pad1.x + 0.4, 6)
})
