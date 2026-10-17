import { expect, test } from "bun:test"
import { normalizeSvgPrecision } from "./normalize-svg-precision"

test("SVG comparisons normalize platform trig differences below a micro-pixel", () => {
  const windows = '<path d="M 190.78177134988172 -0.000000000000001"/>'
  const linux = '<path d="M 190.78177134988204 -0.000000000000002"/>'
  expect(normalizeSvgPrecision(windows)).toBe(normalizeSvgPrecision(linux))
  expect(normalizeSvgPrecision(windows)).toBe(
    '<path d="M 190.781771 -0.000000"/>',
  )
})
