import { expect, test } from "bun:test"
import { cju } from "@tscircuit/circuit-json-util"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { scale } from "transformation-matrix"
import { KicadFootprintToCircuitJsonConverter } from "../../lib"
import { createFootprintPoly } from "../../lib/stages/pcb/CollectFootprintsStage/process-graphics"

function routeLength(points: Array<{ x: number; y: number }>) {
  return points.slice(1).reduce((sum, point, i) => {
    const previous = points[i]!
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0)
}

test.each([
  { board: "gmsl-serializer", count: 3 },
  { board: "oculink-to-pcie-adapter", count: 4 },
  { board: "ddr5-testbed", count: 3 },
  { board: "hdmi-edid-debug-board", count: 3 },
  { board: "dual-camera-to-gmsl-serializer-csi-adapter", count: 10 },
])(
  "$board retains all $count fabrication polygon closing edges",
  ({ board, count }) => {
    const pcb = parseKicadPcb(
      readFileSync(`tests/assets/${board}.kicad_pcb`, "utf8"),
    )
    let checked = 0
    for (const footprint of pcb.footprints) {
      for (const poly of footprint.fpPolys) {
        const points = (poly.points?.points ?? []).filter(
          (point) => "x" in point && "y" in point,
        )
        if (
          poly.fill?.filled ||
          !poly.layer?.names.some((name) => name.endsWith(".Fab")) ||
          points.length < 3
        )
          continue
        const first = points[0]!
        const last = points[points.length - 1]!
        if (first.x === last.x && first.y === last.y) continue
        const db = cju([])
        const position = footprint.position!
        const originalPoints = points.map(({ x, y }) => ({ x, y }))
        createFootprintPoly({
          ctx: { db, k2cMatPcb: scale(1, -1) },
          poly,
          componentId: "component",
          footprintPlacement: {
            kicadComponentPos: { x: position.x, y: position.y },
            componentCcwRotationDegrees:
              "angle" in position ? (position.angle ?? 0) : 0,
          },
        })
        const paths = db
          .toArray()
          .filter((element) => element.type === "pcb_fabrication_note_path")
        expect(paths).toHaveLength(1)
        const path = paths[0]!
        expect(path.route).toHaveLength(points.length + 1)
        expect(path.route[path.route.length - 1]).toEqual(path.route[0])
        // All inventoried polygons are 1 x 0.5 mm resistor bodies. The old
        // three-sided route measures 2.5 mm instead of the complete 3 mm perimeter.
        expect(routeLength(path.route)).toBeCloseTo(3, 8)
        expect(path.layer).toBe(
          poly.layer!.names.includes("B.Fab") ? "bottom" : "top",
        )
        expect(points.map(({ x, y }) => ({ x, y }))).toEqual(originalPoints)
        checked++
      }
    }
    expect(checked).toBe(count)
  },
)

for (const layer of ["F.Fab", "B.Fab", "F.SilkS", "B.SilkS"]) {
  for (const angle of [0, 37, 90, 217]) {
    test(`${layer} polygon closes once at ${angle} degrees, while lines stay open`, () => {
      const converter = new KicadFootprintToCircuitJsonConverter()
      converter.addFile(
        "outline.kicad_mod",
        `(footprint "Test:PolygonClosure"
        (version 20240108) (generator test) (layer "${layer.slice(0, 1)}.Cu") (at 10 20 ${angle})
        (fp_poly (pts (xy 0 0) (xy 1 0) (xy 1 0.5) (xy 0 0.5))
          (stroke (width 0.15) (type solid)) (fill none) (layer "${layer}"))
        (fp_poly (pts (xy 2 0) (xy 3 0) (xy 3 0.5) (xy 2 0.5) (xy 2 0))
          (stroke (width 0.2) (type solid)) (fill none) (layer "${layer}"))
        (fp_line (start 4 0) (end 5 0)
          (stroke (width 0.1) (type solid)) (layer "${layer}")))`,
      )
      const paths = converter
        .getOutput()
        .filter(
          (element) =>
            element.type === "pcb_fabrication_note_path" ||
            element.type === "pcb_silkscreen_path",
        )
      expect(paths).toHaveLength(3)
      const polygons = paths.filter((path) => path.stroke_width !== 0.1)
      expect(polygons).toHaveLength(2)
      for (const polygon of polygons) {
        expect(polygon.route).toHaveLength(5)
        expect(polygon.route[4]).toEqual(polygon.route[0])
        expect(routeLength(polygon.route)).toBeCloseTo(3, 8)
        expect(polygon.layer).toBe(layer.startsWith("B") ? "bottom" : "top")
      }
      const line = paths.find((path) => path.stroke_width === 0.1)!
      expect(line.route).toHaveLength(2)
      expect(routeLength(line.route)).toBeCloseTo(1, 8)
      const polygon = polygons[0]!
      const radians = (angle * Math.PI) / 180
      expect(polygon.route[1]!.x - polygon.route[0]!.x).toBeCloseTo(
        Math.cos(radians),
        8,
      )
      expect(polygon.route[1]!.y - polygon.route[0]!.y).toBeCloseTo(
        Math.sin(radians),
        8,
      )
      if (layer.endsWith("Fab")) {
        const svg = convertCircuitJsonToPcbSvg(converter.getOutput(), {
          includeVersion: false,
        })
        expect(svg).toMatch(/class="pcb-fabrication-note-path"[^>]*d="[^"]* Z"/)
      }
    })
  }
}
