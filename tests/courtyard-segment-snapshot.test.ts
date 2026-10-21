import { expect, test } from "bun:test"
import "bun-match-svg"
import { runAllPlacementChecks } from "@tscircuit/checks"
import { Polygon } from "@flatten-js/core"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertCourtyardBoard } from "./fixtures/stock-courtyard-board"

test("stock KiCad courtyard board has a valid contour and detects courtyard-only overlap", async () => {
  const circuitJson = convertCourtyardBoard()
  const courtyards = circuitJson.filter(
    (element) => element.type === "pcb_courtyard_outline",
  )
  const hasZeroAreaCourtyard = courtyards.some(
    (courtyard) =>
      new Polygon(courtyard.outline.map(({ x, y }) => [x, y])).area() === 0,
  )
  const placementResult = hasZeroAreaCourtyard
    ? "Two-point rings: zero area"
    : "Closed courtyard: valid area"
  const svg = convertCircuitJsonToPcbSvg(
    circuitJson.filter(
      (element) => !element.type.startsWith("pcb_fabrication_note"),
    ),
    { width: 640, height: 340, showCourtyards: true, includeVersion: false },
  )
  const overlappingCircuitJson = convertCourtyardBoard({ overlap: true })
  const placementErrors = await runAllPlacementChecks(overlappingCircuitJson)
  expect(placementErrors.map((error) => error.type)).toEqual([
    "pcb_courtyard_overlap_error",
  ])
  const overlapSvg = convertCircuitJsonToPcbSvg(
    [...overlappingCircuitJson, ...placementErrors].filter(
      (element) => !element.type.startsWith("pcb_fabrication_note"),
    ),
    {
      width: 640,
      height: 400,
      includeVersion: false,
      showCourtyards: true,
      shouldDrawErrors: true,
    },
  )
  const svgContents = (svg: string) =>
    svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")
  await expect(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="880" viewBox="0 0 640 880"><rect width="640" height="880" fill="#101820"/><g fill="white" font-family="sans-serif" font-size="16"><text x="16" y="26">U1 · SOT-223-3_TabPin2 + R1 · 0603</text><text x="16" y="52" fill="#b8c7d3">${courtyards.length} courtyard outline${courtyards.length === 1 ? "" : "s"} · ${placementResult}</text><text x="16" y="436">SOT-223 + 0603: courtyard-only overlap; copper pads stay clear</text><text x="16" y="462" fill="#b8c7d3">${placementErrors[0]!.message}</text></g><svg y="64" width="640" height="340" viewBox="0 0 640 340">${svgContents(svg)}</svg><svg y="480" width="640" height="400" viewBox="0 0 640 400">${svgContents(overlapSvg)}</svg></svg>`,
  ).toMatchSvgSnapshot(import.meta.path)
})
