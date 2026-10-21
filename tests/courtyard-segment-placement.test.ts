import { expect, test } from "bun:test"
import { Polygon } from "@flatten-js/core"
import { FpLine, type Footprint } from "kicadts"
import {
  convertCourtyardBoard,
  convertCourtyardFootprint,
} from "./fixtures/stock-courtyard-board"

const isCourtyardLine = (line: FpLine) => line.layer?.names.includes("F.CrtYd")

const malformedCourtyards: Array<{
  name: string
  modify: (footprint: Footprint) => void
}> = [
  {
    name: "missing edge",
    modify: (footprint) => {
      const missingEdge = footprint.fpLines.find(isCourtyardLine)!
      footprint.fpLines = footprint.fpLines.filter(
        (line) => line !== missingEdge,
      )
    },
  },
  {
    name: "duplicate edge",
    modify: (footprint) => {
      const duplicatedEdge = footprint.fpLines.find(isCourtyardLine)!
      footprint.fpLines = [
        ...footprint.fpLines,
        new FpLine({
          start: duplicatedEdge.start,
          end: duplicatedEdge.end,
          layer: "F.CrtYd",
        }),
      ]
    },
  },
  {
    name: "edges split across layers",
    modify: (footprint) => {
      footprint.fpLines.find(isCourtyardLine)!.layer = "B.CrtYd"
    },
  },
  {
    name: "closed zero-area chain",
    modify: (footprint) => {
      const edge = footprint.fpLines.find(isCourtyardLine)!
      footprint.fpLines = [
        ...footprint.fpLines.filter((line) => !isCourtyardLine(line)),
        edge,
        new FpLine({ start: edge.end, end: edge.start, layer: "F.CrtYd" }),
      ]
    },
  },
]

test("stock KiCad line courtyard encloses a valid area for placement checks", async () => {
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

  for (const { modify } of malformedCourtyards) {
    const { circuitJson, warnings } = convertCourtyardFootprint({ modify })
    expect(
      circuitJson.filter((element) => element.type === "pcb_courtyard_outline"),
    ).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
    expect(
      warnings.every(
        (warning) =>
          warning.startsWith("Footprint U1:") &&
          warning.includes("courtyard overlap checks are unavailable"),
      ),
    ).toBe(true)
  }
  const { circuitJson, warnings } = convertCourtyardFootprint({
    modify: (footprint) => {
      const bottomCourtyard = footprint.fpLines.filter(isCourtyardLine).map(
        (line) =>
          new FpLine({
            start: line.start,
            end: line.end,
            layer: "B.CrtYd",
          }),
      )
      footprint.fpLines = [...footprint.fpLines, ...bottomCourtyard]
    },
  })
  expect(
    circuitJson
      .filter((element) => element.type === "pcb_courtyard_outline")
      .map((courtyard) => courtyard.layer)
      .sort(),
  ).toEqual(["bottom", "top"])
  expect(warnings).toEqual([])

  // Disjoint contours owned by the same footprint must not be bridged.
  const separateContours = convertCourtyardFootprint({
    modify: (footprint) => {
      const courtyardLines = footprint.fpLines.filter(isCourtyardLine)
      const xs = courtyardLines.flatMap((line) => [line.start!.x, line.end!.x])
      const clearanceOffset = Math.max(...xs) - Math.min(...xs) + 1
      footprint.fpLines = [
        ...footprint.fpLines,
        ...courtyardLines.map(
          (line) =>
            new FpLine({
              start: { x: line.start!.x + clearanceOffset, y: line.start!.y },
              end: { x: line.end!.x + clearanceOffset, y: line.end!.y },
              layer: "F.CrtYd",
            }),
        ),
      ]
    },
  })
  expect(
    separateContours.circuitJson.filter(
      (element) => element.type === "pcb_courtyard_outline",
    ),
  ).toHaveLength(2)
  expect(separateContours.warnings).toEqual([])

  const unnamedFootprint = convertCourtyardFootprint({
    modify: (footprint) => {
      footprint.properties.find(
        (property) => property.key === "Reference",
      )!.value = ""
      malformedCourtyards[0]!.modify(footprint)
    },
  })
  expect(
    unnamedFootprint.warnings.every((warning) =>
      warning.startsWith("Footprint unnamed footprint:"),
    ),
  ).toBe(true)
})
