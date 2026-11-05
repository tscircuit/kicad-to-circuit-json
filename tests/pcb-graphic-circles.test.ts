import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("converts board-level gr_circle elements on silkscreen, courtyard, and fabrication layers", () => {
  const kicadPcb = `(kicad_pcb
    (version 20240108)
    (generator "pcbnew")
    (general (thickness 1.6))
    (layers
      (0 "F.Cu" signal)
      (31 "B.Cu" signal)
      (36 "B.SilkS" user "B.Silkscreen")
      (37 "F.SilkS" user "F.Silkscreen")
      (39 "F.Fab" user "F.Fabrication")
      (44 "Edge.Cuts" user)
      (47 "F.CrtYd" user "F.Courtyard")
    )
    (gr_rect (start -10 -10) (end 10 10) (stroke (width 0.1) (type default)) (fill none) (layer "Edge.Cuts"))
    (gr_circle (center 2 3) (end 4 3) (stroke (width 0.2) (type solid)) (fill yes) (layer "F.SilkS"))
    (gr_circle (center -2 -3) (end -2 -1.5) (stroke (width 0.12) (type solid)) (fill none) (layer "F.CrtYd"))
    (gr_circle (center 0 0) (end 1 0) (stroke (width 0.15) (type solid)) (fill none) (layer "F.Fab"))
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()
  const output = converter.getOutput()

  const silkCircle = output.find((el) => el.type === "pcb_silkscreen_circle")
  expect(silkCircle).toBeDefined()
  expect(silkCircle).toMatchObject({
    type: "pcb_silkscreen_circle",
    pcb_component_id: "",
    center: { x: 2, y: -3 },
    radius: 2,
    layer: "top",
    stroke_width: 0.2,
    is_filled: true,
  })

  const courtyardCircle = output.find(
    (el) => el.type === "pcb_courtyard_circle",
  )
  expect(courtyardCircle).toBeDefined()
  expect(courtyardCircle).toMatchObject({
    type: "pcb_courtyard_circle",
    pcb_component_id: "",
    center: { x: -2, y: 3 },
    radius: 1.5,
    layer: "top",
  })

  const fabPath = output.find((el) => el.type === "pcb_fabrication_note_path")
  expect(fabPath).toBeDefined()
  expect(fabPath?.route.length).toBe(17)
  expect(fabPath?.stroke_width).toBe(0.15)
})
