import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("trapezoid pads retain taper and rotation in polygon copper", (): void => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", `(kicad_pcb (version 20211014) (generator pcbnew)
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
    (footprint "Test:Taper" (layer "F.Cu") (at 0 0) (tstamp "test-taper")
      (pad "1" smd trapezoid (at 0 0 90) (size 4 6) (rect_delta 0 2) (layers "F.Cu"))
      (pad "2" smd trapezoid (at 10 0 0) (size 4 6) (rect_delta 2 0) (layers "F.Cu"))
    ))`)
  converter.runUntilFinished()
  const pads = converter.getOutput().filter((element) => element.type === "pcb_smtpad")
  const expected = [
    [{ x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 1 }, { x: -3, y: -1 }],
    [{ x: 8, y: -4 }, { x: 12, y: -2 }, { x: 12, y: 2 }, { x: 8, y: 4 }],
  ]
  expect(pads).toHaveLength(2)
  for (const [index, pad] of pads.entries()) {
    if (pad.shape !== "polygon") throw new Error("Expected trapezoid polygon copper")
    expect(pad.points).toHaveLength(4)
    for (const [pointIndex, point] of pad.points.entries()) {
      expect(point.x).toBeCloseTo(expected[index]![pointIndex]!.x, 10)
      expect(point.y).toBeCloseTo(expected[index]![pointIndex]!.y, 10)
    }
  }
})
