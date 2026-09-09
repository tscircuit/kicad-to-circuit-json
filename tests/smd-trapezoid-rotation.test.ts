import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("zero-delta trapezoid pads preserve their absolute board rotation", (): void => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", `(kicad_pcb (version 20211014) (generator pcbnew)
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
    (footprint "Test:C43" (layer "F.Cu") (at 100 100 90) (tstamp "test-c43")
      (fp_text reference "C43" (at 0 0) (layer "F.SilkS")
        (effects (font (size 1 1) (thickness 0.15))))
      (pad "1" smd trapezoid (at -3.4 0 270) (size 2.5 5.3) (layers "F.Cu"))
      (pad "2" smd trapezoid (at 3.4 0 45) (size 2.5 5.3) (rect_delta 0 0) (layers "F.Cu"))
    ))`)
  converter.runUntilFinished()
  const pads = converter.getOutput().filter((element) => element.type === "pcb_smtpad")
  expect(pads).toHaveLength(2)
  expect(pads[0]).toMatchObject({ shape: "rect", width: 5.3, height: 2.5 })
  expect(pads[1]).toMatchObject({
    shape: "rotated_rect", width: 2.5, height: 5.3, ccw_rotation: 45,
  })
})
