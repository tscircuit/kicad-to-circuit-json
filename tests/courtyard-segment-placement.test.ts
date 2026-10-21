import { expect, test } from "bun:test"
import { Polygon } from "@flatten-js/core"
import { FpArc, FpLine, type Footprint } from "kicadts"
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
  {
    name: "self-intersecting closed chain with nonzero signed area",
    modify: (footprint) => {
      const endpoints = footprint.fpLines
        .filter(isCourtyardLine)
        .flatMap((line) => [line.start!, line.end!])
      const minX = Math.min(...endpoints.map((point) => point.x))
      const maxX = Math.max(...endpoints.map((point) => point.x))
      const minY = Math.min(...endpoints.map((point) => point.y))
      const maxY = Math.max(...endpoints.map((point) => point.y))
      const corners = [
        { x: minX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: maxX, y: (minY + maxY) / 2 },
      ]
      footprint.fpLines = [
        ...footprint.fpLines.filter((line) => !isCourtyardLine(line)),
        ...corners.map(
          (start, index) =>
            new FpLine({
              start,
              end: corners[(index + 1) % corners.length],
              layer: "F.CrtYd",
            }),
        ),
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
      for (const useArc of [false, true]) {
        const { circuitJson } = convertCourtyardFootprint({
          angle,
          layer,
          modify: (footprint) => {
            if (useArc) {
              const edge = footprint.fpLines.find(isCourtyardLine)!
              const start = { x: edge.start!.x, y: edge.start!.y }
              const end = { x: edge.end!.x, y: edge.end!.y }
              footprint.fpLines = footprint.fpLines.filter(
                (line) => line !== edge,
              )
              footprint.fpArcs = [
                ...footprint.fpArcs,
                new FpArc({
                  start,
                  mid: {
                    x: (start.x + end.x) / 2 - (end.y - start.y) / 4,
                    y: (start.y + end.y) / 2 + (end.x - start.x) / 4,
                  },
                  end,
                  layer: "F.CrtYd",
                }),
              ]
            }
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
        if (useArc) expect(courtyards[0]!.outline.length).toBeGreaterThan(5)
      }
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
      // Distinct contours must stay separate even below Edge.Cuts' 0.01 mm tolerance.
      const clearanceOffset = Math.max(...xs) - Math.min(...xs) + 0.001
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
