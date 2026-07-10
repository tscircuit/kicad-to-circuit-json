import { expect, test } from "bun:test"
import type { PcbCutout } from "circuit-json"
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
  const cutouts = circuitJson.filter(
    (el): el is PcbCutout => el.type === "pcb_cutout",
  )

  expect(board).toBeDefined()
  expect(board.width).toBeCloseTo(20)
  expect(board.height).toBeCloseTo(10)
  expect(cutouts).toHaveLength(1)
  const cutout = cutouts[0]!
  expect(cutout.shape).toBe("polygon")
  if (cutout.shape !== "polygon") throw new Error("Expected polygon cutout")
  expect(cutout.points).toHaveLength(5)
})

test("keeps near-touching Edge.Cuts segments in one board outline", () => {
  const kicadPcb = `(kicad_pcb
    (version 20241229)
    (generator "pcbnew")
    (layers
      (0 "F.Cu" signal)
      (31 "B.Cu" signal)
      (44 "Edge.Cuts" user)
    )
    (net 0 "")
    (gr_line (start 93.229817 71.070604) (end 93.229817 58.569417) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 103.41223 100.625) (end 103.41223 71.070604) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 93.229817 111.05) (end 93.229817 100.625) (stroke (width 0.05) (type default)) (layer "Edge.Cuts"))
    (gr_line (start 81.526 111.05) (end 93.229817 111.05) (stroke (width 0.05) (type default)) (layer "Edge.Cuts"))
    (gr_line (start 81.529836 58.569359) (end 81.529836 100.625018) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 81.526 100.625018) (end 81.526 111.05) (stroke (width 0.05) (type default)) (layer "Edge.Cuts"))
    (gr_line (start 94.129811 71.070604) (end 93.229817 71.070604) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 93.229817 58.569417) (end 81.529836 58.569359) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 103.41223 71.070604) (end 94.129811 71.070604) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 93.229817 100.625) (end 103.41223 100.625) (stroke (width 0.05) (type default)) (layer "Edge.Cuts"))
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("near-touching-edge-cuts.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const board = circuitJson.find((el: any) => el.type === "pcb_board") as any
  const cutouts = circuitJson.filter((el: any) => el.type === "pcb_cutout")

  expect(board).toBeDefined()
  expect(board.width).toBeCloseTo(21.88623)
  expect(board.height).toBeCloseTo(52.480641)
  expect(board.outline).toHaveLength(11)
  expect(cutouts).toHaveLength(0)
})
