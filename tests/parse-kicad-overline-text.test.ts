import { expect, test } from "bun:test"
import {
  getSourcePortNameFromKicadText,
  parseKicadOverlineText,
} from "../lib/utils/parse-kicad-overline-text"

test("parses braced KiCad overline markup into ordered parts", () => {
  expect(parseKicadOverlineText("A~{B}C~{DE}")).toEqual({
    text: "ABCDE",
    textParts: [
      { text: "A" },
      { text: "B", is_overlined: true },
      { text: "C" },
      { text: "DE", is_overlined: true },
    ],
    isFullyOverlined: false,
  })
})

test("keeps braces nested inside an overlined part", () => {
  expect(parseKicadOverlineText("~{A^{B}}C")).toEqual({
    text: "A^{B}C",
    textParts: [{ text: "A^{B}", is_overlined: true }, { text: "C" }],
    isFullyOverlined: false,
  })
})

test("uses the established N_ convention for a fully overlined source port", () => {
  expect(getSourcePortNameFromKicadText("~{RESET}")).toBe("N_RESET")
})

test("leaves unmatched braced markup as literal text", () => {
  expect(parseKicadOverlineText("A~{BC")).toEqual({
    text: "A~{BC",
    textParts: undefined,
    isFullyOverlined: false,
  })
})

test("does not interpret bare tildes as markup", () => {
  expect(parseKicadOverlineText("A~BC~D").text).toBe("A~BC~D")
})
