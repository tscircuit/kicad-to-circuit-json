import { expect, test } from "bun:test"
import type {
  PcbBoard,
  PcbComponent,
  PcbCopperPour,
  PcbPlatedHole,
  PcbVia,
} from "circuit-json"
import { KicadToCircuitJsonConverter } from "../../lib"

test("centers PCB coordinates when Edge.Cuts outline is defined inside a footprint", () => {
  const kicadPcb = `(kicad_pcb
    (version 20241229)
    (generator "pcbnew")
    (layers
      (0 "F.Cu" signal)
      (31 "B.Cu" signal)
      (44 "Edge.Cuts" user)
    )
    (net 0 "")
    (footprint "BoardOutline:Enclosure"
      (layer "F.Cu")
      (uuid "11111111-1111-4111-8111-111111111111")
      (at 100 80 90)
      (property "Reference" "U1" (at 0 0 0) (layer "F.SilkS"))
      (fp_rect (start -20 -10) (end 20 10) (stroke (width 0.1) (type solid)) (fill none) (layer "Edge.Cuts"))
      (pad "1" smd rect (at 0 0 90) (size 1 1) (layers "F.Cu"))
    )
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const board = output.find((el): el is PcbBoard => el.type === "pcb_board")
  const component = output.find(
    (el): el is PcbComponent => el.type === "pcb_component",
  )

  expect(board).toBeDefined()
  expect(component).toBeDefined()

  const outlineXs = (board?.outline ?? []).map((p) => p.x)
  const outlineYs = (board?.outline ?? []).map((p) => p.y)
  expect(Math.min(...outlineXs)).toBeCloseTo(-10, 5)
  expect(Math.max(...outlineXs)).toBeCloseTo(10, 5)
  expect(Math.min(...outlineYs)).toBeCloseTo(-20, 5)
  expect(Math.max(...outlineYs)).toBeCloseTo(20, 5)
  expect(component?.center.x).toBeCloseTo(0, 5)
  expect(component?.center.y).toBeCloseTo(0, 5)
})

test("orders copper stackup when B.Cu precedes inner layers and supports F&B.Cu and In*.Cu wildcards", () => {
  const kicadPcb = `(kicad_pcb
    (version 20241229)
    (generator "pcbnew")
    (layers
      (0 "F.Cu" signal)
      (2 "B.Cu" signal)
      (4 "In1.Cu" signal)
      (6 "In2.Cu" signal)
      (25 "Edge.Cuts" user)
    )
    (net 0 "")
    (net 1 "GND")
    (gr_rect (start -10 -10) (end 10 10) (stroke (width 0.1) (type solid)) (fill none) (layer "Edge.Cuts"))
    (footprint "Package_DIP:DIP-2"
      (layer "F.Cu")
      (uuid "22222222-2222-4222-8222-222222222222")
      (at 0 0)
      (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS"))
      (pad "1" thru_hole circle (at -2 0) (size 1.6 1.6) (drill 0.8) (layers "F&B.Cu" "*.Mask") (net 1 "GND"))
      (pad "2" thru_hole circle (at 2 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (net 1 "GND"))
    )
    (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
    (zone
      (net 1)
      (net_name "GND")
      (layers "In*.Cu")
      (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
      (polygon (pts (xy -5 -5) (xy 5 -5) (xy 5 5) (xy -5 5)))
    )
    (zone
      (net 1)
      (net_name "GND")
      (layer "F&B.Cu")
      (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
      (polygon (pts (xy -4 -4) (xy 4 -4) (xy 4 4) (xy -4 4)))
    )
  )`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  converter.runUntilFinished()

  const output = converter.getOutput()
  const via = output.find((el): el is PcbVia => el.type === "pcb_via")
  const platedHoles = output.filter(
    (el): el is PcbPlatedHole => el.type === "pcb_plated_hole",
  )
  const copperPours = output.filter(
    (el): el is PcbCopperPour => el.type === "pcb_copper_pour",
  )

  expect(via?.layers).toEqual(["top", "inner1", "inner2", "bottom"])

  const pad1 = platedHoles.find((h) => h.x < 0)
  const pad2 = platedHoles.find((h) => h.x > 0)
  expect(pad1?.layers).toEqual(["top", "bottom"])
  expect(pad2?.layers).toEqual(["top", "inner1", "inner2", "bottom"])

  expect(copperPours.map((pour) => pour.layer)).toEqual([
    "inner1",
    "inner2",
    "top",
    "bottom",
  ])
})
