import { expect, test } from "bun:test"
import {
  decodeKicadText,
  parseKicadText,
} from "../lib/stages/schematic/utils/decodeKicadText"

test("extracts KiCad overline ranges without including suffixes", () => {
  expect(parseKicadText("~{RTS}")).toEqual({
    text: "RTS",
    textDecorationRanges: [{ start: 0, end: 3, decoration: "overline" }],
  })
  expect(parseKicadText("~{RXT}/GPIO.1")).toEqual({
    text: "RXT/GPIO.1",
    textDecorationRanges: [{ start: 0, end: 3, decoration: "overline" }],
  })
})

test("preserves malformed overline markup", () => {
  expect(decodeKicadText("~{RESET")).toBe("~{RESET")
})

test("decodes KiCad slash escapes", () => {
  expect(decodeKicadText("USB{slash}D+")).toBe("USB/D+")
})
