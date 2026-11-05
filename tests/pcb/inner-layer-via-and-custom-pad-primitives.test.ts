import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../lib"

test("emits polygon smtpad and plated hole outlines for custom pad gr_line and gr_arc primitives", () => {
  const footprintMod = `(footprint "Test:CustomLineArcPads"
  (layer "F.Cu")
  (property "Reference" "U1" (at 0 0 0) (layer "F.SilkS"))
  (pad "1" smd custom (at -3 0) (size 0.001 0.001) (layers "F.Cu" "F.Mask")
    (options (clearance outline) (anchor circle))
    (primitives
      (gr_line (start -1 0) (end 1 0) (width 0.6))
    )
  )
  (pad "2" smd custom (at 3 0) (size 0.001 0.001) (layers "F.Cu" "F.Mask")
    (options (clearance outline) (anchor circle))
    (primitives
      (gr_arc (start -1 0) (mid 0 1) (end 1 0) (width 0.5))
    )
  )
  (pad "3" thru_hole custom (at 0 3) (size 0.001 0.001) (drill 0.6) (layers "*.Cu" "*.Mask")
    (options (clearance outline) (anchor circle))
    (primitives
      (gr_arc (start -1.5 0) (mid 0 1.5) (end 1.5 0) (width 0.8))
    )
  )
)`

  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile("custom-line-arc.kicad_mod", footprintMod)
  converter.runUntilFinished()

  const output = converter.getOutput() as any[]
  const smtPads = output.filter((el) => el.type === "pcb_smtpad")
  expect(smtPads).toHaveLength(2)

  const pad1 = smtPads.find((pad) => pad.port_hints?.includes("1"))
  const pad2 = smtPads.find((pad) => pad.port_hints?.includes("2"))
  expect(pad1?.shape).toBe("polygon")
  expect(pad2?.shape).toBe("polygon")

  const pad1Xs = pad1.points.map((pt: { x: number; y: number }) => pt.x)
  expect(Math.min(...pad1Xs)).toBeCloseTo(-4.3, 1)
  expect(Math.max(...pad1Xs)).toBeCloseTo(-1.7, 1)

  const pad2Xs = pad2.points.map((pt: { x: number; y: number }) => pt.x)
  expect(Math.min(...pad2Xs)).toBeCloseTo(1.75, 1)
  expect(Math.max(...pad2Xs)).toBeCloseTo(4.25, 1)

  const platedHoles = output.filter((el) => el.type === "pcb_plated_hole")
  expect(platedHoles).toHaveLength(1)
  expect(platedHoles[0].shape).toBe("hole_with_polygon_pad")
  const outlineXs = platedHoles[0].pad_outline.map(
    (pt: { x: number; y: number }) => pt.x,
  )
  expect(Math.min(...outlineXs)).toBeCloseTo(-1.9, 1)
  expect(Math.max(...outlineXs)).toBeCloseTo(1.9, 1)
})

test("connects traces entering custom smd pads built from gr_line and gr_arc primitives", () => {
  const board = `(kicad_pcb (version 20240108) (generator pcbnew)
  (general (thickness 1.6))
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
  )
  (net 0 "")
  (net 1 "SIG")
  (footprint "Test:CustomPads" (layer "F.Cu")
    (uuid "11111111-1111-4111-8111-111111111111")
    (at 10 10)
    (property "Reference" "U1" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd custom (at 0 0) (size 0.001 0.001) (layers "F.Cu" "F.Mask") (net 1 "SIG")
      (options (clearance outline) (anchor circle))
      (primitives
        (gr_line (start 0 0) (end 2 0) (width 0.8))
      )
    )
    (pad "2" smd custom (at 10 0) (size 0.001 0.001) (layers "F.Cu" "F.Mask") (net 1 "SIG")
      (options (clearance outline) (anchor circle))
      (primitives
        (gr_arc (start -2 0) (mid -1 1) (end 0 0) (width 0.8))
      )
    )
  )
  (segment (start 12 10) (end 18 10) (width 0.25) (layer "F.Cu") (net 1))
  (gr_rect (start 0 0) (end 30 20) (stroke (width 0.1) (type default)) (fill none) (layer "Edge.Cuts"))
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", board)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const ports = circuitJson.filter((el) => el.type === "pcb_port")
  expect(ports).toHaveLength(2)

  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  expect(
    connMap.areIdsConnected(ports[0]!.pcb_port_id, ports[1]!.pcb_port_id),
  ).toBe(true)
})
