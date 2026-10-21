import { expect, test } from "bun:test"
import { Polygon } from "@flatten-js/core"
import {
  convertStockCourtyardBoard,
  convertStockCourtyardFootprint,
  stockCourtyardFootprints,
} from "./fixtures/stock-courtyard-board"

test.failing("stock KiCad line courtyards enclose valid areas for placement checks", async () => {
  for (const stockFootprint of stockCourtyardFootprints) {
    const boardCourtyards = convertStockCourtyardBoard(stockFootprint).filter(
      (element) => element.type === "pcb_courtyard_outline",
    )
    expect(boardCourtyards).toHaveLength(1)
    for (const courtyard of boardCourtyards) {
      expect(
        new Polygon(courtyard.outline.map(({ x, y }) => [x, y])).area(),
      ).toBeGreaterThan(0)
    }
    for (const layer of ["top", "bottom"] as const) {
      for (const angle of [0, 90, 180, 270]) {
        const { circuitJson } = convertStockCourtyardFootprint(stockFootprint, {
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
        for (const courtyard of courtyards) {
          const polygon = new Polygon(
            courtyard.outline.map(({ x, y }) => [x, y]),
          )
          expect(polygon.area()).toBeGreaterThan(0)
          expect(polygon.isValid()).toBe(true)
        }
      }
    }
  }
})
