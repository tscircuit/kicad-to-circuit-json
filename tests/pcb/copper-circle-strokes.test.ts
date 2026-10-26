import { expect, test } from "bun:test"
import type { PcbCopperPourBRep } from "circuit-json"
import { pcb_copper_pour } from "circuit-json"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { KicadToCircuitJsonConverter } from "../../lib"

function importBoard(graphics: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "circles.kicad_pcb",
    `(kicad_pcb (version 20241229) (generator pcbnew)
      (general (thickness 1.6))
      (layers (0 "F.Cu" signal) (1 "In1.Cu" signal)
        (2 "In2.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
      ${graphics}
      (gr_rect (start 0 0) (end 40 30)
        (stroke (width 0.05) (type solid)) (fill none) (layer "Edge.Cuts"))
    )`,
  )
  converter.runUntilFinished()
  return converter
}

function getCircles(converter: KicadToCircuitJsonConverter) {
  return converter
    .getOutput()
    .filter(
      (element): element is PcbCopperPourBRep =>
        element.type === "pcb_copper_pour" && element.shape === "brep",
    )
}

function expectCircle(
  circle: PcbCopperPourBRep,
  center: { x: number; y: number },
  outerRadius: number,
  innerRadius?: number,
) {
  expect(pcb_copper_pour.safeParse(circle).success).toBe(true)
  expect(circle.covered_with_solder_mask).toBe(true)
  expect(circle.source_net_id).toBeUndefined()
  expect(circle.brep_shape.inner_rings).toHaveLength(
    innerRadius === undefined ? 0 : 1,
  )
  const rings: Array<
    [PcbCopperPourBRep["brep_shape"]["outer_ring"], number, number]
  > = [[circle.brep_shape.outer_ring, outerRadius, -1]]
  if (innerRadius !== undefined) {
    rings.push([circle.brep_shape.inner_rings[0]!, innerRadius, 1])
  }
  for (const [ring, radius, direction] of rings) {
    expect(ring.vertices.length).toBeGreaterThanOrEqual(2)
    let sweep = 0
    for (const vertex of ring.vertices) {
      expect(Math.hypot(vertex.x - center.x, vertex.y - center.y)).toBeCloseTo(
        radius,
        8,
      )
      sweep += 4 * Math.atan(vertex.bulge ?? 0)
    }
    expect(sweep).toBeCloseTo(direction * 2 * Math.PI, 8)
  }
}

for (const [layer, expectedLayer, angle] of [
  ["F.Cu", "top", 0],
  ["F.Cu", "top", 90],
  ["B.Cu", "bottom", 37],
  ["B.Cu", "bottom", 270],
  ["In1.Cu", "inner1", 180],
  ["In2.Cu", "inner2", 123],
] as const) {
  test(`footprint copper circle on ${layer} at ${angle} degrees`, () => {
    const converter = importBoard(`(footprint "circle"
      (layer "${layer}") (at 18 11 ${angle}) (uuid circle)
      (fp_circle (center 1.3 -2.4) (end 2.05 -2.4)
        (stroke (width 0.2) (type solid)) (fill none) (layer "${layer}")))
    `)
    const circles = getCircles(converter)
    expect(circles).toHaveLength(1)
    const radians = (angle * Math.PI) / 180
    expectCircle(
      circles[0]!,
      {
        x: 18 - 20 + 1.3 * Math.cos(radians) - 2.4 * Math.sin(radians),
        y: 15 - 11 + 1.3 * Math.sin(radians) + 2.4 * Math.cos(radians),
      },
      0.85,
      0.65,
    )
    expect(circles[0]!.layer).toBe(expectedLayer)
    expect(
      converter
        .getOutput()
        .filter((element) =>
          ["pcb_port", "pcb_trace", "pcb_smtpad", "pcb_solder_paste"].includes(
            element.type,
          ),
        ),
    ).toHaveLength(0)
  })
}

test("board copper circles preserve modern and legacy stroke widths and layers", () => {
  const converter = importBoard(`
    (gr_circle (center 8 9) (end 9 9)
      (stroke (width 0.3) (type solid)) (fill none) (layer "B.Cu"))
    (gr_circle (center 12 13) (end 13 13)
      (width 0.4) (fill none) (layer "In1.Cu"))
  `)
  const circles = getCircles(converter)
  expect(circles).toHaveLength(2)
  expectCircle(circles[0]!, { x: -12, y: 6 }, 1.15, 0.85)
  expect(circles[0]!.layer).toBe("bottom")
  expectCircle(circles[1]!, { x: -8, y: 2 }, 1.2, 0.8)
  expect(circles[1]!.layer).toBe("inner1")
})

test("legacy footprint circle width is preserved", () => {
  const converter = importBoard(`(footprint "legacy" (layer "F.Cu")
    (at 20 15) (uuid legacy)
    (fp_circle (center 0 0) (end 1 0) (width 0.24) (layer "F.Cu")))
  `)
  expectCircle(getCircles(converter)[0]!, { x: 0, y: 0 }, 1.12, 0.88)
})

test("Edge.Cuts circles remain board cutouts", () => {
  const converter = importBoard(`
    (gr_circle (center 20 15) (end 21 15)
      (stroke (width 0.05) (type solid)) (fill none) (layer "Edge.Cuts"))
  `)
  expect(getCircles(converter)).toHaveLength(0)
  const cutout = converter
    .getOutput()
    .find((element) => element.type === "pcb_cutout")
  expect(cutout?.shape).toBe("circle")
  if (cutout?.shape !== "circle") throw new Error("Expected circular cutout")
  expect(cutout.center).toEqual({ x: 0, y: 0 })
  expect(cutout.radius).toBeCloseTo(1, 8)
})

test("filled circles include their stroke, thick outlines become disks, zero-width outlines vanish", () => {
  const converter = importBoard(`
    (footprint "filled" (layer "F.Cu") (at 20 15) (uuid filled)
      (fp_circle (center 0 0) (end 1 0)
        (stroke (width 0.2) (type solid)) (fill solid) (layer "F.Cu")))
    (gr_circle (center 23 15) (end 24 15)
      (stroke (width 0) (type solid)) (fill yes) (layer "F.Cu"))
    (gr_circle (center 26 15) (end 27 15)
      (stroke (width 2.4) (type solid)) (fill none) (layer "F.Cu"))
    (gr_circle (center 29 15) (end 30 15)
      (stroke (width 0) (type solid)) (fill none) (layer "F.Cu"))
  `)
  const circles = getCircles(converter)
  expect(circles).toHaveLength(3)
  expectCircle(circles[0]!, { x: 0, y: 0 }, 1.1)
  expectCircle(circles[1]!, { x: 3, y: 0 }, 1)
  expectCircle(circles[2]!, { x: 6, y: 0 }, 2.2)
})

test("dual-camera-to-GMSL adapter retains all eight real Antmicro copper circles", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "gmsl.kicad_pcb",
    readFileSync(
      join(
        import.meta.dir,
        "../assets/dual-camera-to-gmsl-serializer-csi-adapter.kicad_pcb",
      ),
      "utf8",
    ),
  )
  converter.runUntilFinished()
  expect(getCircles(converter)).toHaveLength(8)
  expect(
    getCircles(converter).every(
      (circle) =>
        circle.layer === "top" && circle.brep_shape.inner_rings.length === 1,
    ),
  ).toBe(true)
}, 20000)
