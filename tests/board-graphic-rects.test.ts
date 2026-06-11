import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("kicad-to-circuit-json: board graphic rects preserve silkscreen layers", () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (37 "F.SilkS" user "F.Silkscreen")
    (44 "Edge.Cuts" user)
    (49 "F.Fab" user)
  )
  (gr_rect (start 80 80) (end 140 120) (stroke (width 0.05) (type solid)) (fill none) (layer "Edge.Cuts"))
  (gr_rect (start 90 90) (end 110 105) (stroke (width 0.2) (type solid)) (fill none) (layer "F.SilkS"))
  (gr_rect (start 92 108) (end 104 116) (stroke (width 0.18) (type solid)) (fill none) (layer "F.Fab"))
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput() as any[]
  const silkscreenRects = output.filter(
    (element) => element.type === "pcb_silkscreen_rect",
  )
  const fabricationRects = output.filter(
    (element) => element.type === "pcb_fabrication_note_rect",
  )

  expect(silkscreenRects).toHaveLength(1)
  expect(silkscreenRects[0]).toMatchObject({
    layer: "top",
    width: 20,
    height: 15,
    stroke_width: 0.2,
    has_stroke: true,
  })

  expect(fabricationRects).toHaveLength(1)
  expect(fabricationRects[0]).toMatchObject({
    layer: "top",
    width: 12,
    height: 8,
    stroke_width: 0.18,
    has_stroke: true,
  })
})
