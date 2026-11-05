import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("emitKicadSymbolGeometry skips hidden symbol/pin texts, decodes overline/slash text, normalizes rotation, and marks dotted strokes dashed", () => {
  const kicadSch = `(kicad_sch (version 20230121) (generator eeschema)
    (lib_symbols
      (symbol "Custom:CTRL_IC" (in_bom yes) (on_board yes)
        (property "Reference" "U" (at 0 5.08 0)
          (effects (font (size 1.27 1.27)))
        )
        (property "Value" "CTRL_IC" (at 0 -5.08 0)
          (effects (font (size 1.27 1.27)))
        )
        (symbol "Custom:CTRL_IC_0_1"
          (rectangle (start -5.08 3.81) (end 5.08 -3.81)
            (stroke (width 0.254) (type dot))
            (fill (type background))
          )
          (text "INTERNAL_HIDDEN" (at 0 1.27 0)
            (effects (font (size 1.27 1.27)) hide)
          )
          (text "RD{slash}~{WR}" (at 0 0 900)
            (effects (font (size 1.27 1.27)))
          )
        )
        (symbol "Custom:CTRL_IC_1_1"
          (pin input line (at -7.62 1.27 0) (length 2.54)
            (name "CS{slash}~{EN}" (effects (font (size 1.27 1.27))))
            (number "1" (effects (font (size 1.27 1.27)) hide))
          )
          (pin output line (at 7.62 1.27 180) (length 2.54)
            (name "HIDDEN_PIN_NAME" (effects (font (size 1.27 1.27)) hide))
            (number "2" (effects (font (size 1.27 1.27))))
          )
        )
      )
    )
    (symbol (lib_id "Custom:CTRL_IC") (at 50.8 50.8 90) (unit 1)
      (in_bom yes) (on_board yes)
      (uuid "00000000-0000-0000-0000-000000000001")
      (property "Reference" "U1" (at 50.8 45.72 0)
        (effects (font (size 1.27 1.27)))
      )
      (property "Value" "CTRL_IC" (at 50.8 55.88 0)
        (effects (font (size 1.27 1.27)))
      )
    )
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("test.kicad_sch", kicadSch)
  converter.runUntilFinished()
  const output = converter.getOutput()

  const texts = output.filter((el) => el.type === "schematic_text")
  const textValues = texts.map((t) => t.text)

  expect(textValues).not.toContain("INTERNAL_HIDDEN")
  expect(textValues).not.toContain("HIDDEN_PIN_NAME")
  expect(textValues).not.toContain("1")
  expect(textValues).toContain("2")

  const symbolBodyText = texts.find((t) => t.text === "RD/WR")
  expect(symbolBodyText).toBeDefined()
  expect(symbolBodyText?.schematic_component_id).toBeDefined()
  expect(
    (symbolBodyText as { text_parts?: unknown } | undefined)?.text_parts,
  ).toEqual([{ text: "RD/" }, { text: "WR", is_overlined: true }])
  // text angle 90 deg (900 tenths) + instance angle 90 deg = 180 deg -> normalized readable rotation = 0 deg
  expect(Math.abs(symbolBodyText?.rotation ?? 0)).toBe(0)

  const pinNameText = texts.find((t) => t.text === "CS/EN")
  expect(pinNameText).toBeDefined()
  expect(
    (pinNameText as { text_parts?: unknown } | undefined)?.text_parts,
  ).toEqual([{ text: "CS/" }, { text: "EN", is_overlined: true }])

  const rectPaths = output.filter(
    (el): el is Extract<(typeof output)[number], { type: "schematic_path" }> =>
      el.type === "schematic_path" && el.is_filled === true,
  )
  expect(rectPaths.length).toBeGreaterThan(0)
  expect(rectPaths[0]?.is_dashed).toBe(true)
})
