import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { pcb_silkscreen_graphic } from "circuit-json"
import { KicadToCircuitJsonConverter } from "../../lib"

function convertFootprintBoard(footprint: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "silkscreen.kicad_pcb",
    `(kicad_pcb (version 20240108) (generator pcbnew)
      (layers (0 "F.Cu" signal) (31 "B.Cu" signal)
        (36 "B.SilkS" user "b.silkscreen") (37 "F.SilkS" user "f.silkscreen")
        (44 "Edge.Cuts" user))
      (gr_rect (start 145 62) (end 162 78)
        (stroke (width 0.05) (type solid)) (fill none) (layer "Edge.Cuts"))
      ${footprint})`,
  )
  converter.runUntilFinished()
  return converter.getOutput()
}

test("OCuLink OSHW logo retains all 13 filled silkscreen polygons", () => {
  const board = readFileSync(
    "tests/assets/oculink-to-pcie-adapter.kicad_pcb",
    "utf8",
  )
  // Extract the unchanged footprint, including its 90-degree board placement.
  const footprint = board.match(
    /\(footprint "antmicro-footprints:OSHW-Logo2_7\.3x6mm_SilkScreen"[\s\S]*?\n\t\)/,
  )?.[0]
  expect(footprint).toBeDefined()
  const output = convertFootprintBoard(footprint!)
  const graphics = output.filter((el) => el.type === "pcb_silkscreen_graphic")
  const outlines = output.filter((el) => el.type === "pcb_silkscreen_path")
  expect(graphics).toHaveLength(13)
  expect(outlines).toHaveLength(13)
  for (const [i, graphic] of graphics.entries()) {
    expect(pcb_silkscreen_graphic.safeParse(graphic).success).toBe(true)
    expect(graphic.layer).toBe("top")
    expect(graphic.brep_shape.outer_ring.vertices).toEqual(outlines[i]!.route)
    expect(outlines[i]!.stroke_width).toBe(0.01)
  }
})

test.each([
  { side: "F", layer: "top", angle: 0 },
  { side: "F", layer: "top", angle: 37 },
  { side: "B", layer: "bottom", angle: 90 },
  { side: "B", layer: "bottom", angle: 217 },
] as const)(
  "filled polygons retain their shape on $layer at $angle degrees",
  ({ side, layer, angle }) => {
    const output = convertFootprintBoard(`
      (footprint "Test:FilledPolygon" (layer "${side}.Cu") (at 153 70 ${angle})
        (uuid "89e0168d-a16d-496e-b968-f78b6d648864")
        (property "Reference" "LOGO" (at 0 0) (layer "${side}.SilkS") (hide yes))
        (fp_poly (pts (xy 0 0) (xy 3 0) (xy 3 1) (xy 1 1) (xy 1 2) (xy 0 2))
          (stroke (width 0.2) (type solid)) (fill solid) (layer "${side}.SilkS"))
        (fp_poly (pts (xy 4 0) (xy 5 0) (xy 5 1) (xy 4 0))
          (stroke (width 0.1) (type solid)) (fill none) (layer "${side}.SilkS")))
    `)
    const graphics = output.filter((el) => el.type === "pcb_silkscreen_graphic")
    const outlines = output.filter((el) => el.type === "pcb_silkscreen_path")
    expect(graphics).toHaveLength(1)
    expect(outlines).toHaveLength(2)
    const graphic = graphics[0]!
    expect(graphic.layer).toBe(layer)
    const vertices = graphic.brep_shape.outer_ring.vertices
    expect(outlines[0]!.route).toEqual([...vertices, vertices[0]!])
    expect(vertices).toHaveLength(6)
    const radians = (angle * Math.PI) / 180
    // KiCad footprint positions rotate clockwise in its Y-down coordinate space.
    expect(vertices[1]!.x - vertices[0]!.x).toBeCloseTo(
      3 * Math.cos(radians),
      8,
    )
    expect(vertices[1]!.y - vertices[0]!.y).toBeCloseTo(
      3 * Math.sin(radians),
      8,
    )
    const area =
      Math.abs(
        vertices.reduce((sum, p, i) => {
          const next = vertices[(i + 1) % vertices.length]!
          return sum + p.x * next.y - next.x * p.y
        }, 0),
      ) / 2
    expect(area).toBeCloseTo(4, 8)
  },
)

test("zero-width filled polygons do not acquire a fallback outline", () => {
  const output = convertFootprintBoard(`
    (footprint "Test:NoStroke" (layer "F.Cu") (at 153 70)
      (uuid "89e0168d-a16d-496e-b968-f78b6d648864")
      (fp_poly (pts (xy 0 0) (xy 2 0) (xy 0 2))
        (stroke (width 0) (type solid)) (fill yes) (layer "F.SilkS")))
  `)
  expect(
    output.filter((el) => el.type === "pcb_silkscreen_graphic"),
  ).toHaveLength(1)
  expect(output.filter((el) => el.type === "pcb_silkscreen_path")).toHaveLength(
    0,
  )
})
