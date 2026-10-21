import { expect, test } from "bun:test"
import "bun-match-svg"
import { Polygon } from "@flatten-js/core"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  convertStockCourtyardBoard,
  stockCourtyardFootprints,
} from "./fixtures/stock-courtyard-board"

test("stock KiCad courtyard boards show the imported contours and enclosed area", async () => {
  const panels: string[] = []
  for (const stockFootprint of stockCourtyardFootprints) {
    const circuitJson = convertStockCourtyardBoard(stockFootprint)
    const hasZeroAreaCourtyard = circuitJson.some(
      (element) =>
        element.type === "pcb_courtyard_outline" &&
        new Polygon(element.outline.map(({ x, y }) => [x, y])).area() === 0,
    )
    const placementResult = hasZeroAreaCourtyard
      ? "Two-point rings: zero area"
      : "Closed courtyard: valid area"
    const outlineCount = circuitJson.filter(
      (element) => element.type === "pcb_courtyard_outline",
    ).length
    const svg = convertCircuitJsonToPcbSvg(
      circuitJson.filter(
        (element) => !element.type.startsWith("pcb_fabrication_note"),
      ),
      { width: 640, height: 340, showCourtyards: true, includeVersion: false },
    )
    const panelY = panels.length * 410
    panels.push(`<text x="16" y="${panelY + 26}">${stockFootprint.reference} · ${stockFootprint.label} + R1 · 0603</text>
      <text x="16" y="${panelY + 52}" fill="#b8c7d3">${outlineCount} courtyard outlines · ${placementResult}</text>
      <svg x="0" y="${panelY + 64}" width="640" height="340" viewBox="0 0 640 340">${svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</svg>`)
  }
  await expect(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="820" viewBox="0 0 640 820"><rect width="640" height="820" fill="#101820"/><g fill="white" font-family="sans-serif" font-size="16">${panels.join("")}</g></svg>`,
  ).toMatchSvgSnapshot(import.meta.path)
})
