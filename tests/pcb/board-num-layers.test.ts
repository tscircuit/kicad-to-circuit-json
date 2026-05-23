import { expect, test } from "bun:test"
import type { PcbBoard } from "circuit-json"
import { KicadToCircuitJsonConverter } from "../../lib"

function convertBoard(kicadPcb: string): PcbBoard {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const board = converter
    .getOutput()
    .find((el): el is PcbBoard => el.type === "pcb_board")

  if (!board) {
    throw new Error("Expected converted output to include a pcb_board")
  }

  return board
}

test("sets pcb_board.num_layers from KiCad copper layer definitions", () => {
  const kicadPcb = `(kicad_pcb
    (version 20241229)
    (generator "pcbnew")
    (layers
      (0 "F.Cu" signal)
      (1 "In1.Cu" signal)
      (2 "In2.Cu" signal)
      (31 "B.Cu" signal)
      (44 "Edge.Cuts" user)
    )
    (net 0 "")
    (gr_line (start 0 0) (end 20 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 20 0) (end 20 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 20 10) (end 0 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 0 10) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  )`

  expect(convertBoard(kicadPcb).num_layers).toBe(4)
})

test("defaults pcb_board.num_layers to 2 when copper definitions are absent", () => {
  const kicadPcb = `(kicad_pcb
    (version 20241229)
    (generator "pcbnew")
    (layers
      (44 "Edge.Cuts" user)
    )
    (net 0 "")
    (gr_line (start 0 0) (end 20 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 20 0) (end 20 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 20 10) (end 0 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
    (gr_line (start 0 10) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  )`

  expect(convertBoard(kicadPcb).num_layers).toBe(2)
})
