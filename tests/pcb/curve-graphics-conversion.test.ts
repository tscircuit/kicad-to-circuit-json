import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

test("converts board-level gr_curve and footprint fp_curve elements on annotation and Edge.Cuts layers", () => {
  const kicadPcbContent = `(kicad_pcb
    (version 20240108)
    (generator "pcbnew")
    (layers
      (0 "F.Cu" signal)
      (31 "B.Cu" signal)
      (36 "B.SilkS" user "B.Silkscreen")
      (37 "F.SilkS" user "F.Silkscreen")
      (40 "Dwgs.User" user "User.Drawings")
      (44 "Edge.Cuts" user)
      (46 "B.CrtYd" user "B.Courtyard")
      (47 "F.CrtYd" user "F.Courtyard")
      (48 "B.Fab" user "B.Fab")
      (49 "F.Fab" user "F.Fab")
    )
    (gr_line (start 0 0) (end 20 0) (layer "Edge.Cuts") (width 0.1))
    (gr_line (start 20 0) (end 20 20) (layer "Edge.Cuts") (width 0.1))
    (gr_line (start 20 20) (end 0 20) (layer "Edge.Cuts") (width 0.1))
    (gr_curve
      (pts (xy 1 1) (xy 2 3) (xy 4 3) (xy 5 1))
      (stroke (width 0.18) (type solid))
      (layer "F.SilkS")
    )
    (gr_curve
      (pts (xy 1 5) (xy 2 7) (xy 4 7) (xy 5 5))
      (stroke (width 0.14) (type solid))
      (layer "B.Fab")
    )
    (gr_curve
      (pts (xy 1 9) (xy 2 11) (xy 4 11) (xy 5 9))
      (stroke (width 0.1) (type solid))
      (layer "F.CrtYd")
    )
    (footprint "Test:FP"
      (layer "F.Cu")
      (uuid "00000000-0000-0000-0000-000000000001")
      (at 10 10)
      (property "Reference" "U1" (at 0 -2 0) (layer "F.SilkS"))
      (fp_curve
        (pts (xy 0 20) (xy -2 10) (xy -2 10) (xy 0 0))
        (stroke (width 0.1) (type solid))
        (layer "Edge.Cuts")
      )
      (fp_curve
        (pts (xy -1 -1) (xy 0 -2) (xy 0 -2) (xy 1 -1))
        (stroke (width 0.16) (type solid))
        (layer "F.SilkS")
      )
      (fp_curve
        (pts (xy -1 1) (xy 0 2) (xy 0 2) (xy 1 1))
        (stroke (width 0.12) (type solid))
        (layer "B.Fab")
      )
      (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
    )
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  const silkPaths = circuitJson.filter(
    (el): el is Extract<typeof el, { type: "pcb_silkscreen_path" }> =>
      el.type === "pcb_silkscreen_path",
  )
  expect(silkPaths).toHaveLength(2)
  const boardSilk = silkPaths.find((p) => p.pcb_component_id === "")
  const fpSilk = silkPaths.find((p) => p.pcb_component_id !== "")
  expect(boardSilk?.layer).toBe("top")
  expect(boardSilk?.stroke_width).toBeCloseTo(0.18, 5)
  expect(boardSilk?.route.length).toBeGreaterThanOrEqual(9)
  expect(fpSilk?.layer).toBe("top")
  expect(fpSilk?.stroke_width).toBeCloseTo(0.16, 5)
  expect(fpSilk?.route.length).toBeGreaterThanOrEqual(9)

  const fabPaths = circuitJson.filter(
    (el): el is Extract<typeof el, { type: "pcb_fabrication_note_path" }> =>
      el.type === "pcb_fabrication_note_path",
  )
  expect(fabPaths).toHaveLength(2)
  const boardFab = fabPaths.find((p) => p.pcb_component_id === "")
  const fpFab = fabPaths.find((p) => p.pcb_component_id !== "")
  expect(boardFab?.layer).toBe("bottom")
  expect(boardFab?.stroke_width).toBeCloseTo(0.14, 5)
  expect(boardFab?.route.length).toBeGreaterThanOrEqual(9)
  expect(fpFab?.layer).toBe("bottom")
  expect(fpFab?.stroke_width).toBeCloseTo(0.12, 5)
  expect(fpFab?.route.length).toBeGreaterThanOrEqual(9)

  const courtyardOutlines = circuitJson.filter(
    (el): el is Extract<typeof el, { type: "pcb_courtyard_outline" }> =>
      el.type === "pcb_courtyard_outline",
  )
  expect(courtyardOutlines).toHaveLength(1)
  expect(courtyardOutlines[0]?.layer).toBe("top")
  expect(courtyardOutlines[0]?.outline.length).toBeGreaterThanOrEqual(9)
})
