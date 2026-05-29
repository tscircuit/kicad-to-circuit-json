import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("kicad-to-circuit-json: normalizes right-angle SMD pad rotations", () => {
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
    (40 "Dwgs.User" user "User.Drawings")
    (41 "Cmts.User" user "User.Comments")
    (42 "Eco1.User" user "User.Eco1")
    (43 "Eco2.User" user "User.Eco2")
    (44 "Edge.Cuts" user)
    (45 "Margin" user)
    (46 "B.CrtYd" user "B.Courtyard")
    (47 "F.CrtYd" user "F.Courtyard")
    (48 "B.Fab" user)
    (49 "F.Fab" user)
  )
  (footprint "Test:RotatedPads" (layer "F.Cu")
    (at 100 100)
    (tstamp "test-rotated-pads")
    (attr smd)
    (fp_text reference "REF**" (at 0 -3) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_text value "RotatedPads" (at 0 3) (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (pad "1" smd rect (at 0 0 0) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "2" smd rect (at 4 0 90) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "3" smd rect (at 8 0 180) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "4" smd rect (at 12 0 270) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "5" smd rect (at 16 0 45) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "6" smd roundrect (at 20 0 90) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "7" smd oval (at 24 0 0) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "8" smd oval (at 28 0 90) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "9" smd oval (at 32 0 45) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const pads = output.filter((el: any) => el.type === "pcb_smtpad")
  const padsByHint = Object.fromEntries(
    pads.map((pad: any) => [pad.port_hints?.[0], pad]),
  )

  expect(pads).toHaveLength(9)

  expect(padsByHint["1"]).toMatchObject({
    shape: "rect",
    width: 1,
    height: 2,
  })
  expect(padsByHint["1"].ccw_rotation).toBeUndefined()

  expect(padsByHint["2"]).toMatchObject({
    shape: "rect",
    width: 2,
    height: 1,
  })
  expect(padsByHint["2"].ccw_rotation).toBeUndefined()

  expect(padsByHint["3"]).toMatchObject({
    shape: "rect",
    width: 1,
    height: 2,
  })
  expect(padsByHint["3"].ccw_rotation).toBeUndefined()

  expect(padsByHint["4"]).toMatchObject({
    shape: "rect",
    width: 2,
    height: 1,
  })
  expect(padsByHint["4"].ccw_rotation).toBeUndefined()

  expect(padsByHint["5"]).toMatchObject({
    shape: "rotated_rect",
    width: 1,
    height: 2,
    ccw_rotation: 45,
  })

  expect(padsByHint["6"]).toMatchObject({
    shape: "rect",
    width: 2,
    height: 1,
    corner_radius: 0.125,
  })
  expect(padsByHint["6"].ccw_rotation).toBeUndefined()

  expect(padsByHint["7"]).toMatchObject({
    shape: "pill",
    width: 1,
    height: 2,
    radius: 0.5,
  })
  expect(padsByHint["7"].ccw_rotation).toBeUndefined()

  expect(padsByHint["8"]).toMatchObject({
    shape: "pill",
    width: 2,
    height: 1,
    radius: 0.5,
  })
  expect(padsByHint["8"].ccw_rotation).toBeUndefined()

  expect(padsByHint["9"]).toMatchObject({
    shape: "rotated_pill",
    width: 1,
    height: 2,
    radius: 0.5,
    ccw_rotation: 45,
  })
})

test("kicad-to-circuit-json: keeps component rotation out of SMD pad-local rotation", () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (35 "F.Paste" user)
    (39 "F.Mask" user)
  )
  (footprint "Test:RotatedOvalPads" (layer "F.Cu")
    (at 100 100 45)
    (tstamp "test-rotated-oval-pads")
    (attr smd)
    (fp_text reference "REF**" (at 0 -3) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (pad "1" smd rect (at 0 0 0) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "2" smd oval (at 4 0 0) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "3" smd oval (at 8 0 90) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
  )
 )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const pads = output.filter((el: any) => el.type === "pcb_smtpad")
  const padsByHint = Object.fromEntries(
    pads.map((pad: any) => [pad.port_hints?.[0], pad]),
  )

  expect(pads).toHaveLength(3)

  expect(padsByHint["1"]).toMatchObject({
    shape: "rect",
    width: 1,
    height: 2,
  })
  expect(padsByHint["1"].ccw_rotation).toBeUndefined()

  expect(padsByHint["2"]).toMatchObject({
    shape: "pill",
    width: 1,
    height: 2,
    radius: 0.5,
  })
  expect(padsByHint["2"].ccw_rotation).toBeUndefined()

  expect(padsByHint["3"]).toMatchObject({
    shape: "pill",
    width: 2,
    height: 1,
    radius: 0.5,
  })
  expect(padsByHint["3"].ccw_rotation).toBeUndefined()
})

test("kicad-to-circuit-json: maps plated oval pads without undefined port hints", () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (38 "B.Mask" user)
    (39 "F.Mask" user)
  )
  (footprint "Test:PlatedOvalPads" (layer "F.Cu")
    (at 100 100)
    (tstamp "test-plated-oval-pads")
    (pad "1" thru_hole oval (at 0 0 90) (size 1.7 1.95) (drill 0.95) (layers "*.Cu" "*.Mask"))
    (pad "2" thru_hole oval (at 4 0 45) (size 2 3) (drill oval 0.8 1.2) (layers "*.Cu" "*.Mask"))
    (pad "" thru_hole oval (at 8 0 0) (size 2 3) (drill 1) (layers "*.Cu" "*.Mask"))
    (pad "4" thru_hole oval (at 12 0 90) (size 1.5 2.7) (drill oval 0.9 2.1) (layers "*.Cu" "*.Mask"))
    (pad "5" thru_hole rect (at 16 0 0) (size 2 4.5) (drill oval 1 3.5) (layers "*.Cu" "*.Mask"))
    (pad "6" thru_hole rect (at 20 0 90) (size 2 4.5) (drill oval 1 3.5) (layers "*.Cu" "*.Mask"))
  )
 )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const holes = output.filter((el: any) => el.type === "pcb_plated_hole")
  const holesByHint = Object.fromEntries(
    holes
      .filter((hole: any) => hole.port_hints?.[0])
      .map((hole: any) => [hole.port_hints[0], hole]),
  )
  const unnumberedHole = holes.find((hole: any) => !hole.port_hints)

  expect(holes).toHaveLength(6)

  expect(holesByHint["1"]).toMatchObject({
    shape: "pill",
    hole_width: 0.95,
    hole_height: 0.95,
    outer_width: 1.7,
    outer_height: 1.95,
    ccw_rotation: 90,
  })

  expect(holesByHint["2"]).toMatchObject({
    shape: "pill",
    hole_width: 0.8,
    hole_height: 1.2,
    outer_width: 2,
    outer_height: 3,
    ccw_rotation: 45,
  })

  expect(holesByHint["4"]).toMatchObject({
    shape: "pill",
    hole_width: 0.9,
    hole_height: 2.1,
    outer_width: 1.5,
    outer_height: 2.7,
    ccw_rotation: 90,
  })

  expect(holesByHint["5"]).toMatchObject({
    shape: "pill_hole_with_rect_pad",
    hole_width: 1,
    hole_height: 3.5,
    rect_pad_width: 2,
    rect_pad_height: 4.5,
  })

  expect(holesByHint["6"]).toMatchObject({
    shape: "rotated_pill_hole_with_rect_pad",
    hole_width: 1,
    hole_height: 3.5,
    rect_pad_width: 2,
    rect_pad_height: 4.5,
    hole_ccw_rotation: 90,
    rect_ccw_rotation: 90,
  })

  expect(unnumberedHole).toMatchObject({
    shape: "pill",
    outer_width: 2,
    outer_height: 3,
  })
})
