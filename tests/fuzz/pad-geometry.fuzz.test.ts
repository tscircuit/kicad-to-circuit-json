import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdirSync, writeFileSync } from "node:fs"
import { importText, validate, near, point, config } from "./harness"
const arb = fc.record({
  width: fc.integer({ min: 10, max: 100 }).map((x) => x / 10),
  height: fc.integer({ min: 10, max: 100 }).map((x) => x / 10),
  angle: fc.oneof(
    fc.constantFrom(0, 90, 180, 270, 359.999, -90),
    fc.integer({ min: -36000, max: 36000 }).map((x) => x / 100),
  ),
  footprintAngle: fc.integer({ min: -18000, max: 18000 }).map((x) => x / 100),
  ratio: fc.integer({ min: 0, max: 50 }).map((x) => x / 100),
  bottom: fc.boolean(),
})
type Geometry = typeof arb extends fc.Arbitrary<infer T> ? T : never
function input(m: Geometry, shape: string) {
  const side = m.bottom ? "B" : "F"
  return `(kicad_pcb (version 20240108) (generator pcbnew)
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (gr_rect (start -30 -30) (end 30 30) (stroke (width .05) (type default)) (fill none) (layer "Edge.Cuts"))
  (footprint "Fuzz" (layer "${side}.Cu") (at 0 0 ${m.footprintAngle})
    (uuid "11111111-1111-4111-8111-111111111111")
    (property "Reference" "U1" (at 0 0) (layer "${side}.SilkS"))
    (pad "1" smd ${shape} (at 2 3 ${m.angle}) (size ${m.width} ${m.height}) (layers "${side}.Cu")
      ${shape === "roundrect" ? `(roundrect_rratio ${m.ratio})` : ""}
      ${shape === "trapezoid" ? "(rect_delta 0.2 0.4)" : ""}
      ${shape === "custom" ? `(options (clearance outline) (anchor rect)) (primitives (gr_poly (pts (xy 0 0) (xy ${m.width} 0) (xy 0 ${m.height})) (width 0) (fill yes)))` : ""})))`
}
for (const shape of ["roundrect", "trapezoid", "custom"]) {
  test(`fuzz independent footprint/pad rotations: ${shape}`, () => {
    const verify = (m: Geometry) => {
      const { elements, warnings } = importText("pcb", input(m, shape))
      validate(elements)
      const theta = (m.footprintAngle * Math.PI) / 180
      const center = {
        x: 2 * Math.cos(theta) + 3 * Math.sin(theta),
        y: 2 * Math.sin(theta) - 3 * Math.cos(theta),
      }
      const pads = elements.filter((e) => e.type === "pcb_smtpad")
      const phi = (m.angle * Math.PI) / 180
      if (shape === "custom") {
        expect(pads).toHaveLength(2)
        const poly = pads.find((p) => p.shape === "polygon")!
        expect(poly.points).toHaveLength(3)
        for (const [i, p] of [
          { x: 0, y: 0 },
          { x: m.width, y: 0 },
          { x: 0, y: m.height },
        ].entries())
          point(poly.points[i], {
            x: center.x + p.x * Math.cos(phi) + p.y * Math.sin(phi),
            y: center.y + p.x * Math.sin(phi) - p.y * Math.cos(phi),
          })
        point(
          pads.find((p) => p.shape !== "polygon"),
          center,
        )
      } else {
        expect(pads).toHaveLength(1)
        const pad = pads[0]!
        point(pad, center)
        expect(pad.layer).toBe(m.bottom ? "bottom" : "top")
        if (shape === "roundrect") {
          // KiCad radius ratio is relative to the shorter SIDE, not half of it.
          // https://gitlab.com/kicad/code/kicad/-/work_items/24751
          near(pad.corner_radius ?? 0, Math.min(m.width, m.height) * m.ratio)
          expect(warnings).toEqual([])
        } else {
          expect(warnings).toHaveLength(1)
          expect(warnings[0]).toContain(
            "conservative rotated rectangle envelope",
          )
        }
        const w = m.width + (shape === "trapezoid" ? 0.4 : 0),
          h = m.height + (shape === "trapezoid" ? 0.2 : 0)
        // Compare actual corners, not only area/AABB; detects mirrored angles.
        const corners = (w: number, h: number, a: number) =>
          [-1, 1].flatMap((x) =>
            [-1, 1].map((y) => ({
              x: ((x * w) / 2) * Math.cos(a) - ((y * h) / 2) * Math.sin(a),
              y: ((x * w) / 2) * Math.sin(a) + ((y * h) / 2) * Math.cos(a),
            })),
          )
        const expected = corners(w, h, phi),
          actual = corners(
            pad.width,
            pad.height,
            ((pad.ccw_rotation ?? 0) * Math.PI) / 180,
          )
        for (const p of expected)
          expect(
            Math.min(...actual.map((q) => Math.hypot(q.x - p.x, q.y - p.y))),
          ).toBeLessThan(1e-6)
      }
    }
    const r = fc.check(fc.property(arb, verify), config())
    if (r.failed) {
      const dir = `work/fuzz-failures/pad-${shape}`
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        `${dir}/input.kicad_pcb`,
        input(r.counterexample![0], shape),
      )
      writeFileSync(
        `${dir}/failure.json`,
        JSON.stringify(
          {
            seed: r.seed,
            path: r.counterexamplePath,
            model: r.counterexample,
            error: String(r.errorInstance),
          },
          null,
          2,
        ),
      )
      throw r.errorInstance
    }
  })
}
