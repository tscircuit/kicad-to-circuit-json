import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

test("matches trace endpoints inside rotated pill plated holes and custom polygon plated holes", () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
  )
  (net 0 "")
  (net 1 "NET_ROTATED_PILL")
  (net 2 "NET_CUSTOM_PTH")
  (footprint "Test:Connector" (layer "F.Cu")
    (at 10 10 90)
    (uuid "fp-conn-uuid")
    (property "Reference" "J1" (at 0 -2 0) (layer "F.SilkS"))
    (pad "1" thru_hole oval (at 0 0 90) (size 1.0 3.0) (drill 0.6) (layers "*.Cu" "*.Mask") (net 1 "NET_ROTATED_PILL"))
    (pad "2" thru_hole custom (at 0 -5 0) (size 0.5 0.5) (drill 0.4) (layers "*.Cu" "*.Mask") (net 2 "NET_CUSTOM_PTH")
      (options (clearance outline) (anchor circle))
      (primitives
        (gr_poly (pts (xy -2 -0.5) (xy 2 -0.5) (xy 2 0.5) (xy -2 0.5)) (width 0) (fill yes))
      )
    )
  )
  (segment (start 11.2 10) (end 15 10) (width 0.25) (layer "F.Cu") (net 1))
  (segment (start 6.5 10) (end 6.5 15) (width 0.25) (layer "F.Cu") (net 2))
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput() as any[]
  const ports = output.filter((el) => el.type === "pcb_port")
  const traces = output.filter((el) => el.type === "pcb_trace")

  expect(ports).toHaveLength(2)
  expect(traces).toHaveLength(2)

  const [trace1, trace2] = traces

  expect(trace1).toBeDefined()
  expect(trace2).toBeDefined()
  expect(trace1.route[0].start_pcb_port_id).toBeDefined()
  expect(trace2.route[0].start_pcb_port_id).toBeDefined()
  expect(trace1.route[0].start_pcb_port_id).not.toBe(
    trace2.route[0].start_pcb_port_id,
  )
})

test("preserves knockout, mirror, and custom property variable substitution on footprint text", () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (37 "F.SilkS" user "F.Silkscreen")
  )
  (footprint "Test:TextFeatures" (layer "F.Cu")
    (at 0 0 0)
    (descr "High precision sensor")
    (uuid "fp-text-uuid")
    (property "Reference" "U2" (at 0 -2 0) (layer "F.SilkS" knockout)
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (property "Value" "SENS1" (at 0 2 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (property "PartCode" "PN-9000" (at 0 4 0) (layer "F.Fab")
      (hide yes)
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_text user "\${PartCode} / \${FOOTPRINT} / \${DESCRIPTION}" (at 0 6 0) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (fp_text user "BOT_CU" (at 0 8 0) (layer "B.Cu" knockout)
      (effects (font (size 1 1) (thickness 0.15)) (justify mirror))
    )
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput() as any[]
  const silkTexts = output.filter((el) => el.type === "pcb_silkscreen_text")
  const copperTexts = output.filter((el) => el.type === "pcb_copper_text")

  const refText = silkTexts.find((t) => t.text === "U2")
  expect(refText).toBeDefined()
  expect(refText.is_knockout).toBe(true)

  const substitutedText = silkTexts.find((t) => t.text.includes("PN-9000"))
  expect(substitutedText).toBeDefined()
  expect(substitutedText.text).toBe(
    "PN-9000 / Test:TextFeatures / High precision sensor",
  )

  expect(copperTexts).toHaveLength(1)
  expect(copperTexts[0].text).toBe("BOT_CU")
  expect(copperTexts[0].is_knockout).toBe(true)
  expect(copperTexts[0].is_mirrored).toBe(true)
})
