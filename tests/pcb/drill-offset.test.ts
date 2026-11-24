import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

const board = `(kicad_pcb (version 20240108) (generator pcbnew)
  (general (thickness 1.6))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
  )
  (net 0 "")
  (net 1 "SIG")
  (footprint "Test:OffsetHoles" (layer "F.Cu")
    (uuid "11111111-1111-4111-8111-111111111111")
    (at 10 10)
    (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS"))
    (property "Value" "OffsetHoles" (at 0 1 0) (layer "F.SilkS"))
    (pad "1" thru_hole rect (at 0 0) (size 3 2)
      (drill 0.8 (offset 0.4 0.2))
      (layers "*.Cu" "*.Mask") (net 1 "SIG"))
    (pad "2" thru_hole rect (at 5 0 90) (size 3 2)
      (drill oval 0.6 1.2 (offset 0.5 0))
      (layers "*.Cu" "*.Mask") (net 1 "SIG"))
    (pad "" np_thru_hole circle (at 10 0) (size 2.4 2.4)
      (drill 2.4 (offset 0.3 0)))
  )
  (gr_line (start 0 -5) (end 20 -5) (layer "Edge.Cuts") (width 0.05))
  (gr_line (start 20 -5) (end 20 15) (layer "Edge.Cuts") (width 0.05))
  (gr_line (start 20 15) (end 0 15) (layer "Edge.Cuts") (width 0.05))
  (gr_line (start 0 15) (end 0 -5) (layer "Edge.Cuts") (width 0.05))
)`

function convertBoard() {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", board)
  converter.runUntilFinished()
  return converter.getOutput() as any[]
}

test("KiCad drill offsets are preserved on plated holes", () => {
  const circuitJson = convertBoard()
  const platedHoles = circuitJson.filter((e) => e.type === "pcb_plated_hole")
  expect(platedHoles).toHaveLength(2)

  const pad1Hole = platedHoles.find((h) => h.port_hints?.includes("1"))
  const pad2Hole = platedHoles.find((h) => h.port_hints?.includes("2"))
  expect(pad1Hole).toBeDefined()
  expect(pad2Hole).toBeDefined()

  // Pad 1 is unrotated: the KiCad (offset 0.4 0.2) becomes a board-space
  // offset with the Y axis flipped into Circuit JSON coordinates.
  expect(pad1Hole.shape).toBe("circular_hole_with_rect_pad")
  expect(pad1Hole.hole_offset_x).toBeCloseTo(0.4)
  expect(pad1Hole.hole_offset_y).toBeCloseTo(-0.2)

  // Pad 2 is rotated 90 degrees counterclockwise, so its local +X drill
  // offset lands above the pad center, which is +Y in Circuit JSON.
  expect(pad2Hole.shape).toBe("rotated_pill_hole_with_rect_pad")
  expect(pad2Hole.hole_offset_x).toBeCloseTo(0)
  expect(pad2Hole.hole_offset_y).toBeCloseTo(0.5)
})

test("KiCad drill offsets move non-plated holes", () => {
  const circuitJson = convertBoard()
  const holes = circuitJson.filter((e) => e.type === "pcb_hole")
  expect(holes).toHaveLength(1)

  // The board center is (10, 5) in KiCad coordinates and the pad sits at
  // (20, 10), so the drill's +0.3 X offset puts the hole at (10.3, -5).
  const npth = holes[0]!
  expect(npth.x).toBeCloseTo(10.3)
  expect(npth.y).toBeCloseTo(-5)
})
