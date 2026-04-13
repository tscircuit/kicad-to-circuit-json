import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

test("repro: orthogonal smd roundrect pads stay axis-aligned rects", () => {
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
  (footprint "Test:OrthogonalPadRotation" (layer "F.Cu")
    (at 100 100)
    (tstamp "uuid-orthogonal-pad-rotation")
    (fp_text reference "U1" (at 0 -2) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_text value "ORTHO_PAD_TEST" (at 0 2) (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (pad "1" smd roundrect (at 0 0 90) (size 1.5 0.5) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "2" smd roundrect (at 2 0 180) (size 1.5 0.5) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "3" smd roundrect (at 4 0 270) (size 1.5 0.5) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "4" smd roundrect (at 6 0 45) (size 1.5 0.5) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)

  const output = converter.getOutput()
  const smtPads = output
    .filter((element) => element.type === "pcb_smtpad")
    .sort((a, b) =>
      Number(a.port_hints?.[0] ?? 0) - Number(b.port_hints?.[0] ?? 0),
    )

  expect(smtPads).toHaveLength(4)

  expect(smtPads[0]).toMatchObject({
    shape: "rect",
    width: 0.5,
    height: 1.5,
    corner_radius: 0.0625,
  })
  expect((smtPads[0] as any).ccw_rotation).toBeUndefined()

  expect(smtPads[1]).toMatchObject({
    shape: "rect",
    width: 1.5,
    height: 0.5,
    corner_radius: 0.0625,
  })
  expect((smtPads[1] as any).ccw_rotation).toBeUndefined()

  expect(smtPads[2]).toMatchObject({
    shape: "rect",
    width: 0.5,
    height: 1.5,
    corner_radius: 0.0625,
  })
  expect((smtPads[2] as any).ccw_rotation).toBeUndefined()

  expect(smtPads[3]).toMatchObject({
    shape: "rotated_rect",
    width: 1.5,
    height: 0.5,
    ccw_rotation: 45,
    corner_radius: 0.0625,
  })
})
