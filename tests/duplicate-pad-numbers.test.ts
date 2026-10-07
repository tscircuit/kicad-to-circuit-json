import { expect, test } from "bun:test"
import { KicadFootprintToCircuitJsonConverter } from "../lib"

test("preserves separated switch pads that share KiCad pad numbers", () => {
  const footprint = `(footprint "Button_Switch_SMD:SW_SPST_PTS810"
    (version 20240108)
    (generator "pcbnew")
    (layer "F.Cu")
    (property "Reference" "SW**" (at 0 -3 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (property "Value" "SW_SPST_PTS810" (at 0 3 0) (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (pad "1" smd rect (at -2.25 -1.5) (size 1.5 1) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "1" smd rect (at -2.25 1.5) (size 1.5 1) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "2" smd rect (at 2.25 -1.5) (size 1.5 1) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "2" smd rect (at 2.25 1.5) (size 1.5 1) (layers "F.Cu" "F.Paste" "F.Mask"))
  )`

  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile("SW_SPST_PTS810.kicad_mod", footprint)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const pads = output.filter((element) => element.type === "pcb_smtpad")
  const pcbPorts = output.filter((element) => element.type === "pcb_port")

  expect(pads.map((pad) => pad.port_hints)).toEqual([
    ["1"],
    ["1"],
    ["2"],
    ["2"],
  ])
  expect(pads.every((pad) => Boolean(pad.pcb_port_id))).toBe(true)
  expect(new Set(pads.map((pad) => pad.pcb_port_id)).size).toBe(4)
  expect(pcbPorts).toHaveLength(4)
  expect(pcbPorts[0]!.source_port_id).toBe(pcbPorts[1]!.source_port_id)
  expect(pcbPorts[2]!.source_port_id).toBe(pcbPorts[3]!.source_port_id)
  expect(pcbPorts[0]!.source_port_id).not.toBe(pcbPorts[2]!.source_port_id)
})
