import { expect, test } from "bun:test"
import {
  createJoiningOverlineText,
  estimateKicadTextWidth,
  getKicadOverlineSegment,
  getKicadOverlineStrokeWidth,
} from "../lib/stages/schematic/utils/decodeKicadText"

test("lays out a centered overline across exactly the marked text", () => {
  const fontSize = 1
  const segment = getKicadOverlineSegment({
    text: "RXT/GPIO.1",
    range: { start: 0, end: 3 },
    fontSize,
    position: { x: 0, y: 0 },
    rotation: 0,
  })

  expect(segment.end.x - segment.start.x).toBe(
    estimateKicadTextWidth("RXT", fontSize),
  )
  expect(segment.start.y).toBe(segment.end.y)
  expect(createJoiningOverlineText({ start: 0, end: 3 })).toBe("───")
})

test("positions baseline-anchored overlines above centered overlines", () => {
  const common = {
    text: "SUSPEND",
    range: { start: 0, end: 7 },
    fontSize: 1,
    position: { x: 0, y: 0 },
    rotation: 0,
  }
  const centered = getKicadOverlineSegment(common)
  const baselineAnchored = getKicadOverlineSegment({
    ...common,
    verticalAnchor: "bottom",
  })

  expect(baselineAnchored.start.y).toBeGreaterThan(centered.start.y)
  expect(getKicadOverlineStrokeWidth(1)).toBeLessThan(0.1)
})
