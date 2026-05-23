import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

test("converts disconnected Edge.Cuts contours into board outline plus cutouts", () => {
  const kicadPcb = `(kicad_pcb
    (version 20241229)
    (generator "pcbnew")
    (layers
      (0 "F.Cu" signal)
      (31 "B.Cu" signal)
      (44 "Edge.Cuts" user)
    )
    (net 0 "")
    (gr_line (start 0 0) (end 20 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 20 0) (end 20 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 20 10) (end 0 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 0 10) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 8 4) (end 12 4) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 12 4) (end 12 6) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 12 6) (end 8 6) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 8 6) (end 8 4) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board-with-cutout.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const board = circuitJson.find((el: any) => el.type === "pcb_board") as any
  const cutouts = circuitJson.filter((el: any) => el.type === "pcb_cutout")

  expect(board).toBeDefined()
  expect(board.width).toBeCloseTo(20)
  expect(board.height).toBeCloseTo(10)
  expect(cutouts).toHaveLength(1)
  expect(cutouts[0].shape).toBe("polygon")
  expect(cutouts[0].points).toHaveLength(5)
})
