import { expect, test } from "bun:test"
import { getDrillDimensions } from "../lib/stages/pcb/CollectFootprintsStage/pad-drill-utils"

test("getDrillDimensions: parses scalar circular drills", () => {
  expect(getDrillDimensions(0.95)).toEqual({
    width: 0.95,
    height: 0.95,
    isOval: false,
  })
})

test("getDrillDimensions: parses object circular drills", () => {
  expect(getDrillDimensions({ diameter: 1.1 })).toEqual({
    width: 1.1,
    height: 1.1,
    isOval: false,
  })
})

test("getDrillDimensions: parses kicadts oval drills", () => {
  expect(
    getDrillDimensions({ _oval: true, _diameter: 0.9, _width: 2.1 }),
  ).toEqual({
    width: 0.9,
    height: 2.1,
    isOval: true,
  })
})
