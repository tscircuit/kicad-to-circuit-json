import { expect, test } from "bun:test"
import {
  getCircuitJsonPinLabel,
  parseKicadOverlineText,
} from "../lib/utils/parse-kicad-overline-text"

test("parses braced KiCad overline markup into ordered runs", () => {
  expect(parseKicadOverlineText("A~{B}C~{DE}")).toEqual([
    { text: "A" },
    { text: "B", overline: true },
    { text: "C" },
    { text: "DE", overline: true },
  ])
})

test("parses legacy KiCad tilde-toggle overline markup", () => {
  expect(parseKicadOverlineText("A~BC~D")).toEqual([
    { text: "A" },
    { text: "BC", overline: true },
    { text: "D" },
  ])
})

test("uses the established N_ fallback for a fully overlined label", () => {
  expect(getCircuitJsonPinLabel("~{RESET}")).toEqual({
    text: "RESET",
    displayText: "N_RESET",
    textRuns: [{ text: "RESET", overline: true }],
  })
})
