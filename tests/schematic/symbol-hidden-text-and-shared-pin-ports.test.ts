import { expect, test } from "bun:test"
import {
  KicadSymbolToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../lib"

test("schematic import skips hidden symbol text, decodes overline symbol text, and deduplicates source_ports for shared pin numbers", () => {
  const kicadSch = `(kicad_sch
    (version 20231120)
    (generator "eeschema")
    (paper "A4")
    (lib_symbols
      (symbol "Custom:SW_DualPin"
        (symbol "SW_DualPin_0_1"
          (text "~{RST}" (at 0 0 0)
            (effects (font (size 1.27 1.27)))
          )
          (text "INTERNAL_HIDDEN_NOTE" (at 0 -2.54 0)
            (effects (font (size 1.27 1.27)) (hide yes))
          )
        )
        (symbol "SW_DualPin_1_1"
          (pin passive line (at -5.08 1.27 0) (length 2.54)
            (name "A" (effects (font (size 1.27 1.27))))
            (number "1" (effects (font (size 1.27 1.27))))
          )
          (pin passive line (at -5.08 -1.27 0) (length 2.54)
            (name "A" (effects (font (size 1.27 1.27))))
            (number "1" (effects (font (size 1.27 1.27))))
          )
          (pin passive line (at 5.08 0 180) (length 2.54)
            (name "B" (effects (font (size 1.27 1.27))))
            (number "2" (effects (font (size 1.27 1.27))))
          )
        )
      )
    )
    (symbol
      (lib_id "Custom:SW_DualPin")
      (at 100 100 0)
      (unit 1)
      (uuid "00000000-0000-0000-0000-000000000101")
      (property "Reference" "SW1" (at 100 95 0)
        (effects (font (size 1.27 1.27)))
      )
      (property "Value" "SW_DualPin" (at 100 105 0)
        (effects (font (size 1.27 1.27)))
      )
    )
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("test.kicad_sch", kicadSch)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const sourcePorts = output.filter((el) => el.type === "source_port")
  const schematicPorts = output.filter((el) => el.type === "schematic_port")
  const schematicTexts = output.filter((el) => el.type === "schematic_text")

  expect(sourcePorts).toHaveLength(2)
  expect(schematicPorts).toHaveLength(3)
  expect(schematicPorts[0]?.source_port_id).toBe(
    schematicPorts[1]?.source_port_id,
  )
  expect(schematicPorts[0]?.source_port_id).not.toBe(
    schematicPorts[2]?.source_port_id,
  )

  expect(schematicTexts.some((t) => t.text === "INTERNAL_HIDDEN_NOTE")).toBe(
    false,
  )
  const rstText = schematicTexts.find((t) => t.text === "RST")
  expect(rstText).toBeDefined()
  expect(rstText?.schematic_component_id).toBeDefined()
  expect((rstText as any)?.text_parts).toEqual([
    { text: "RST", is_overlined: true },
  ])
})

test("symbol library import skips hidden symbol text and hidden properties via effects.hiddenText", () => {
  const kicadSym = `(kicad_symbol_lib
    (version 20231120)
    (generator "kicad_symbol_editor")
    (symbol "TestLib:ChipWithHiddenText"
      (property "Reference" "U" (at 0 2.54 0)
        (effects (font (size 1.27 1.27)))
      )
      (property "Value" "HiddenValueProp" (at 0 -2.54 0)
        (effects (font (size 1.27 1.27)) (hide yes))
      )
      (symbol "ChipWithHiddenText_0_1"
        (text "~{CS}" (at 0 0 0)
          (effects (font (size 1.27 1.27)))
        )
        (text "SECRET_BODY_TEXT" (at 0 -1.27 0)
          (effects (font (size 1.27 1.27)) (hide yes))
        )
      )
      (symbol "ChipWithHiddenText_1_1"
        (pin input line (at -5.08 0 0) (length 2.54)
          (name "IN" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))
        )
      )
    )
  )`

  const converter = new KicadSymbolToCircuitJsonConverter()
  converter.addFile("test.kicad_sym", kicadSym)
  converter.runUntilFinished()

  const texts = converter
    .getOutput()
    .filter((el) => el.type === "schematic_text")
  expect(texts.some((t) => t.text === "SECRET_BODY_TEXT")).toBe(false)
  expect(texts.some((t) => t.text === "HiddenValueProp")).toBe(false)
  const csText = texts.find((t) => t.text === "CS")
  expect(csText).toBeDefined()
  expect((csText as any)?.text_parts).toEqual([
    { text: "CS", is_overlined: true },
  ])
})
