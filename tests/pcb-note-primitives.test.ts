import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

test("kicad-to-circuit-json: maps drawing-layer graphics to pcb_note primitives", () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
    (48 "Dwgs.User" user)
    (49 "Cmts.User" user)
  )
  (gr_line (start 1 2) (end 3 4) (layer "Dwgs.User") (width 0.2))
  (gr_arc (start 5 5) (mid 6 6) (end 7 5) (layer "Dwgs.User") (width 0.3))
  (gr_rect (start 10 10) (end 14 12) (layer "Cmts.User") (width 0.4) (fill none))
  (gr_text "BOARD NOTE" (at 8 9 90) (layer "Dwgs.User")
    (effects (font (size 1 1) (thickness 0.15)))
  )
  (dimension (type aligned) (layer "Dwgs.User") (tstamp "dimension-1")
    (pts (xy 20 20) (xy 30 20))
    (height 5)
    (gr_text "10.0000 mm" (at 25 25) (layer "Dwgs.User")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (format (prefix "") (suffix "") (units 3) (units_format 1) (precision 4))
    (style (thickness 0.15) (arrow_length 1.27) (text_position_mode 0) (extension_height 0) (extension_offset 0) keep_text_aligned)
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("notes.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()

  const noteText = output.find((el: any) => el.type === "pcb_note_text") as any
  expect(noteText.text).toBe("BOARD NOTE")
  expect(noteText.layer).toBe("top")
  expect(noteText.font_size).toBe(1.5)

  const noteLine = output.find((el: any) => el.type === "pcb_note_line") as any
  expect(noteLine.stroke_width).toBe(0.2)
  expect(noteLine.layer).toBe("top")

  const notePath = output.find((el: any) => el.type === "pcb_note_path") as any
  expect(notePath.stroke_width).toBe(0.3)
  expect(notePath.route.length).toBeGreaterThan(2)

  const noteRect = output.find((el: any) => el.type === "pcb_note_rect") as any
  expect(noteRect.width).toBe(4)
  expect(noteRect.height).toBe(2)
  expect(noteRect.stroke_width).toBe(0.4)
  expect(noteRect.is_filled).toBe(false)

  expect(output.some((el: any) => el.type === "pcb_note_dimension")).toBe(false)
})
