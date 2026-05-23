import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("kicad-to-circuit-json: maps silkscreen text size and rotation", () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (44 "Edge.Cuts" user)
    (49 "F.Fab" user)
  )
  (gr_text "BOARD" (at 104 100 -90) (layer "F.SilkS")
    (uuid "board-text-uuid")
    (effects (font (size 0.7 0.7) (thickness 0.1)))
  )
  (footprint "Test:RotatedText" (layer "F.Cu")
    (at 100 100 90)
    (tstamp "test-rotated-text")
    (property "Reference" "U1" (at 0 -2 -90) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (property "HiddenRef" "HIDDEN" (at 0 -4 0) (layer "F.SilkS")
      (hide yes)
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (property "Value" "RotatedText" (at 0 2 0) (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_text user "\${REFERENCE}" (at 1 0 180) (layer "F.SilkS")
      (uuid "user-text-uuid")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
    (fp_text user "\${REFERENCE}" (at 0 -2 -90) (layer "F.Fab")
      (uuid "duplicate-fab-reference-text-uuid")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
    (fp_text user "K" (at 2 0 0) (layer "F.SilkS")
      (uuid "silk-user-text-uuid")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
    (fp_text user "K" (at 2 0 90) (layer "F.Fab")
      (uuid "duplicate-fab-user-text-uuid")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const silkscreenTexts = output.filter(
    (el: any) => el.type === "pcb_silkscreen_text",
  ) as any[]

  const referenceText = silkscreenTexts.find(
    (text) => text.text === "U1" && text.pcb_component_id,
  )
  const userText = silkscreenTexts.find(
    (text) => text.text === "U1" && text !== referenceText,
  )
  const boardText = silkscreenTexts.find((text) => text.text === "BOARD")

  expect(referenceText.font_size).toBeCloseTo(0.8 * (2 / 3))
  expect(referenceText.ccw_rotation).toBe(270)
  expect(userText.font_size).toBeCloseTo(0.6 * (2 / 3))
  expect(userText.ccw_rotation).toBe(180)
  expect(boardText.font_size).toBeCloseTo(0.7 * (2 / 3))
  expect(boardText.ccw_rotation).toBe(270)
  expect(silkscreenTexts.find((text) => text.text === "HIDDEN")).toBeUndefined()

  const fabricationTexts = output.filter(
    (el: any) => el.type === "pcb_fabrication_note_text",
  ) as any[]
  expect(fabricationTexts.find((text) => text.text === "U1")).toBeUndefined()
  expect(fabricationTexts.find((text) => text.text === "K")).toBeUndefined()
})
