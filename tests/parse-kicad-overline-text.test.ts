import { expect, test } from "bun:test"
import {
  getCircuitJsonPinLabel,
  parseKicadOverlineText,
} from "../lib/utils/parse-kicad-overline-text"

test("parses braced KiCad overline markup into ordered parts", () => {
  expect(parseKicadOverlineText("A~{B}C~{DE}")).toEqual([
    { text: "A" },
    { text: "B", is_overlined: true },
    { text: "C" },
    { text: "DE", is_overlined: true },
  ])
})

test("parses legacy KiCad tilde-toggle markup into ordered parts", () => {
  expect(parseKicadOverlineText("A~BC~D")).toEqual([
    { text: "A" },
    { text: "BC", is_overlined: true },
    { text: "D" },
  ])
})

test("uses the established N_ fallback for a fully overlined label", () => {
  expect(getCircuitJsonPinLabel("~{RESET}")).toEqual({
    text: "RESET",
    displayText: "N_RESET",
    textParts: [{ text: "RESET", is_overlined: true }],
  })
})
