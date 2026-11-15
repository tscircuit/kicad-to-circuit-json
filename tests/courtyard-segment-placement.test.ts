import { expect, test } from "bun:test"
import { Polygon } from "@flatten-js/core"
import {
  convertCourtyardBoard,
  convertCourtyardFootprint,
} from "./fixtures/stock-courtyard-board"

test.failing("stock KiCad line courtyard encloses a valid area for placement checks", async () => {
  const boardCourtyards = convertCourtyardBoard().filter(
    (element) => element.type === "pcb_courtyard_outline",
  )
  expect(boardCourtyards).toHaveLength(1)
  expect(
    new Polygon(boardCourtyards[0]!.outline.map(({ x, y }) => [x, y])).area(),
  ).toBeGreaterThan(0)
  for (const layer of ["top", "bottom"] as const) {
    for (const angle of [0, 90, 180, 270]) {
      const { circuitJson } = convertCourtyardFootprint({
        angle,
        layer,
        modify: (footprint) => {
          // KiCad requires connected endpoints, not a particular file order.
          footprint.fpLines = [...footprint.fpLines].reverse()
          for (const [lineIndex, line] of footprint.fpLines.entries()) {
            if (lineIndex % 2 === 0) {
              const start = { x: line.start!.x, y: line.start!.y }
              line.start = { x: line.end!.x, y: line.end!.y }
              line.end = start
            }
          }
        },
      })
      const courtyards = circuitJson.filter(
        (element) => element.type === "pcb_courtyard_outline",
      )
      expect(courtyards).toHaveLength(1)
      const polygon = new Polygon(
        courtyards[0]!.outline.map(({ x, y }) => [x, y]),
      )
      expect(polygon.area()).toBeGreaterThan(0)
      expect(polygon.isValid()).toBe(true)
    }
  }
})
