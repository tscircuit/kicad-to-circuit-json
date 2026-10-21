import { expect, test } from "bun:test"
import "bun-match-svg"
import { Polygon } from "@flatten-js/core"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertCourtyardBoard } from "./fixtures/stock-courtyard-board"

test("stock KiCad courtyard board shows the imported contours and enclosed area", async () => {
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
  await expect(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="410" viewBox="0 0 640 410"><rect width="640" height="410" fill="#101820"/><g fill="white" font-family="sans-serif" font-size="16"><text x="16" y="26">U1 · SOT-223-3_TabPin2 + R1 · 0603</text><text x="16" y="52" fill="#b8c7d3">${courtyards.length} courtyard outline${courtyards.length === 1 ? "" : "s"} · ${placementResult}</text></g><svg y="64" width="640" height="340" viewBox="0 0 640 340">${svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</svg></svg>`,
  ).toMatchSvgSnapshot(import.meta.path)
})
