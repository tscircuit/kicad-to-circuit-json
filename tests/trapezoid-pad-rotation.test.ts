import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

function convertPad({
  angle,
  footprintAngle = 0,
  side = "F",
  delta,
}: {
  angle: number
  footprintAngle?: number
  side?: "F" | "B"
  delta?: [number, number]
}) {
  const source = `(kicad_pcb (version 20240108) (generator pcbnew)
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
    (gr_rect (start -30 -30) (end 30 30)
      (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts"))
    (footprint "Synthetic:Trapezoid" (layer "${side}.Cu")
      (at 0 0 ${footprintAngle})
      (uuid "371b4a38-e91b-4d94-84f2-05087890be82")
      (property "Reference" "C1" (at 0 0) (layer "${side}.SilkS"))
      (pad "1" smd trapezoid (at -3.4 0 ${angle}) (size 2.5 5.3)
        ${delta ? `(rect_delta ${delta[0]} ${delta[1]})` : ""}
        (layers "${side}.Cu" "${side}.Mask" "${side}.Paste"))))`
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("synthetic.kicad_pcb", source)
  converter.runUntilFinished()
  const output = converter.getOutput()
  const pads = output.filter((element) => element.type === "pcb_smtpad")
  expect(pads).toHaveLength(1)
  const pad = pads[0]!
  if (pad.shape !== "rect" && pad.shape !== "rotated_rect") {
    throw new Error(`Expected a rectangle envelope, received ${pad.shape}`)
  }
  expect(pad.pcb_port_id).toBeDefined()
  expect(output.filter((element) => element.type === "pcb_port")).toHaveLength(
    1,
  )
  expect(converter.getStats().pads).toBe(1)
  return { pad, warnings: converter.getWarnings() }
}

for (const side of ["F", "B"] as const) {
  for (const angle of [0, 90, 180, 270, -90, 450]) {
    test(`zero-delta trapezoid at ${angle} degrees on ${side}.Cu preserves its dimensions`, () => {
      const { pad, warnings } = convertPad({ angle, side })
      const swapsAxes = Math.abs(angle / 90) % 2 === 1
      expect(pad).toMatchObject({
        shape: "rect",
        width: swapsAxes ? 5.3 : 2.5,
        height: swapsAxes ? 2.5 : 5.3,
        layer: side === "F" ? "top" : "bottom",
        x: -3.4,
        y: 0,
      })
      expect(warnings).toEqual([])
    })
  }

  for (const angle of [37, -23]) {
    test(`zero-delta trapezoid at ${angle} degrees on ${side}.Cu preserves its angle`, () => {
      const { pad, warnings } = convertPad({ angle, side, delta: [0, 0] })
      expect(pad).toMatchObject({
        shape: "rotated_rect",
        width: 2.5,
        height: 5.3,
        ccw_rotation: angle < 0 ? angle + 360 : angle,
        layer: side === "F" ? "top" : "bottom",
      })
      expect(warnings).toEqual([])
    })
  }

  test(`a rotated footprint on ${side}.Cu does not rotate its pad angle twice`, () => {
    const { pad } = convertPad({ angle: 270, footprintAngle: -90, side })
    expect(pad).toMatchObject({ shape: "rect", width: 5.3, height: 2.5 })
    expect(pad.x).toBeCloseTo(0, 10)
    expect(pad.y).toBeCloseTo(3.4, 10)
  })

  test(`an independent pad angle survives an arbitrary footprint rotation on ${side}.Cu`, () => {
    const { pad } = convertPad({ angle: 12, footprintAngle: 35, side })
    expect(pad).toMatchObject({
      shape: "rotated_rect",
      width: 2.5,
      height: 5.3,
      ccw_rotation: 12,
    })
    expect(pad.x).toBeCloseTo(-3.4 * Math.cos((35 * Math.PI) / 180), 10)
    expect(pad.y).toBeCloseTo(-3.4 * Math.sin((35 * Math.PI) / 180), 10)
  })
}

for (const delta of [
  [0.8, 0],
  [0, -1.2],
] as [number, number][]) {
  for (const angle of [90, 37]) {
    test(`tapered trapezoid ${delta} at ${angle} degrees keeps a conservative envelope and reports it`, () => {
      const { pad, warnings } = convertPad({ angle, delta })
      const width = 2.5 + Math.abs(delta[1])
      const height = 5.3 + Math.abs(delta[0])
      expect(pad).toMatchObject({
        shape: angle === 90 ? "rect" : "rotated_rect",
        width: angle === 90 ? height : width,
        height: angle === 90 ? width : height,
      })
      if (pad.shape === "rotated_rect") expect(pad.ccw_rotation).toBe(angle)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("nonzero rect_delta")
      expect(warnings[0]).toContain("conservative rotated rectangle envelope")
    })
  }
}
