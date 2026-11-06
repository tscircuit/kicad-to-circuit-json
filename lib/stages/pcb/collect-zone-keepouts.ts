import { PtsArc, Xy, type Zone } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext, Point } from "../../types"
import { getArcGeometry } from "./arc-utils"
import { getLayerRefsFromLayers } from "./layer-mapping"

type Interval = { min: number; max: number }
type Rectangle = { minX: number; maxX: number; minY: number; maxY: number }

/** Import filled rule areas without expanding their geometry or restrictions. */
export function collectZoneKeepouts(zone: Zone, ctx: ConverterContext): void {
  const { keepout } = zone
  const transform = ctx.k2cMatPcb
  if (!keepout || !transform) return

  const label = zone.name?.trim() || "Unnamed rule area"
  const warn = (message: string) => {
    ctx.warnings ??= []
    ctx.warnings.push(`Rule area "${label}": ${message}`)
  }

  // KiCad's parser defaults tracks/vias to prohibited. Pads/footprints default
  // to allowed for legacy files; copper fills default to allowed.
  const tracksAllowed = keepout.tracks === "allowed"
  const viasAllowed = keepout.vias === "allowed"
  const padsAllowed = keepout.pads !== "not_allowed"
  const footprintsAllowed = keepout.footprints !== "not_allowed"
  const copperAllowed = keepout.copperpour !== "not_allowed"
  if (
    tracksAllowed &&
    viasAllowed &&
    padsAllowed &&
    footprintsAllowed &&
    copperAllowed
  ) {
    return
  }

  // Circuit JSON always excludes copper pours, and couples tracks/vias and
  // pads/placements. Do not invent stricter exclusions for unsupported rules.
  if (
    copperAllowed ||
    tracksAllowed !== viasAllowed ||
    padsAllowed !== footprintsAllowed
  ) {
    warn(
      "independent KiCad exclusions cannot be represented by Circuit JSON without changing their meaning; the keepout was not imported.",
    )
    return
  }

  const layers = getLayerRefsFromLayers(zone.layer ?? zone.layers, ctx.kicadPcb)
  if (layers.length === 0) {
    warn("no supported copper layers; the keepout was not imported.")
    return
  }

  const common = {
    layers,
    allow_traces: tracksAllowed,
    allow_placements: padsAllowed,
    description: label,
  }
  const circle =
    zone.polygons.length === 1
      ? getCircle(zone.polygons[0]!.pts?.points ?? [])
      : null
  if (circle) {
    const imported = {
      ...common,
      shape: "circle" as const,
      center: applyToPoint(transform, circle.center),
      radius: circle.radius,
    }
    ctx.db.pcb_keepout.insert(imported)
    return
  }

  const contours: Point[][] = []
  for (const polygon of zone.polygons) {
    const vertices = polygon.pts?.points ?? []
    if (vertices.some((vertex) => !(vertex instanceof Xy))) {
      warn("curved boundaries are not supported; the keepout was not imported.")
      return
    }
    // Board-world mm: KiCad +Y down -> Circuit JSON +Y up, with board centering.
    const points = vertices.map((point) => applyToPoint(transform, point as Xy))
    if (
      points.length < 3 ||
      points.some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
      )
    ) {
      warn("a polygon is invalid; the keepout was not imported.")
      return
    }
    const area = points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!
      return sum + point.x * next.y - next.x * point.y
    }, 0)
    if (area === 0) {
      warn("a polygon has no area; the keepout was not imported.")
      return
    }
    if (
      points.some((point, index) => {
        const next = points[(index + 1) % points.length]!
        return point.x !== next.x && point.y !== next.y
      })
    ) {
      // An outline keepout is a stroked path, not a filled polygon. A bounding
      // rectangle would incorrectly block the surrounding free space.
      warn(
        "non-axis-aligned boundaries cannot be represented exactly by Circuit JSON keepouts; the keepout was not imported.",
      )
      return
    }
    contours.push(points)
  }
  if (contours.length === 0) {
    warn("no polygon boundary; the keepout was not imported.")
    return
  }

  for (const rect of partitionOrthogonalArea(contours)) {
    const imported = {
      ...common,
      shape: "rect" as const,
      center: {
        x: (rect.minX + rect.maxX) / 2,
        y: (rect.minY + rect.maxY) / 2,
      },
      width: rect.maxX - rect.minX,
      height: rect.maxY - rect.minY,
    }
    ctx.db.pcb_keepout.insert(imported)
  }
}

/** Recognize a complete circle, not an arbitrary curved boundary's bounds. */
function getCircle(vertices: (Xy | PtsArc)[]) {
  const arcs = vertices.filter(
    (point): point is PtsArc => point instanceof PtsArc,
  )
  if (arcs.length < 2) return null
  const geometries = arcs.map((arc) =>
    arc.start && arc.mid && arc.end
      ? getArcGeometry({ start: arc.start, mid: arc.mid, end: arc.end })
      : null,
  )
  const first = geometries[0]
  if (!first || !Number.isFinite(first.radius)) return null
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-8
  const samePoint = (a: Point, b: Point) => near(a.x, b.x) && near(a.y, b.y)
  let sweep = 0
  for (const arc of geometries) {
    if (
      !arc ||
      !samePoint(arc.center, first.center) ||
      !near(arc.radius, first.radius) ||
      Math.sign(arc.sweepAngle) !== Math.sign(first.sweepAngle)
    )
      return null
    sweep += arc.sweepAngle
  }
  if (!near(Math.abs(sweep), Math.PI * 2)) return null
  let start: Point | undefined
  let cursor: Point | undefined
  for (const vertex of vertices) {
    const from = vertex instanceof Xy ? vertex : vertex.start!
    if (cursor && !samePoint(cursor, from)) return null
    start ??= from
    cursor = vertex instanceof Xy ? vertex : vertex.end!
  }
  if (!start || !cursor || !samePoint(start, cursor)) return null
  return { center: first.center, radius: first.radius }
}

/** Exact rectangular partition; KiCad's first polygon is the exterior, the
 * remaining polygons are holes. Winding and a repeated closing vertex do not
 * affect the result. Adjacent bands with identical spans merge into one rect. */
function partitionOrthogonalArea(contours: Point[][]): Rectangle[] {
  const ys = [
    ...new Set(contours.flatMap((points) => points.map((p) => p.y))),
  ].sort((a, b) => a - b)
  const rectangles: Rectangle[] = []
  let previous = new Map<string, Rectangle>()
  for (let i = 0; i < ys.length - 1; i++) {
    const minY = ys[i]!
    const maxY = ys[i + 1]!
    const y = (minY + maxY) / 2
    let spans = getIntervals(contours[0]!, y)
    for (const hole of contours.slice(1)) {
      for (const cut of getIntervals(hole, y)) {
        spans = spans.flatMap((span) => {
          if (cut.max <= span.min || cut.min >= span.max) return [span]
          const parts: Interval[] = []
          if (cut.min > span.min) parts.push({ min: span.min, max: cut.min })
          if (cut.max < span.max) parts.push({ min: cut.max, max: span.max })
          return parts
        })
      }
    }
    const current = new Map<string, Rectangle>()
    for (const span of spans) {
      const key = `${span.min}:${span.max}`
      const adjacent = previous.get(key)
      if (adjacent) {
        adjacent.maxY = maxY
        current.set(key, adjacent)
      } else {
        const rect = { minX: span.min, maxX: span.max, minY, maxY }
        rectangles.push(rect)
        current.set(key, rect)
      }
    }
    previous = current
  }
  return rectangles
}

function getIntervals(points: Point[], y: number): Interval[] {
  const xs: number[] = []
  for (let i = 0; i < points.length; i++) {
    const start = points[i]!
    const end = points[(i + 1) % points.length]!
    if (y > Math.min(start.y, end.y) && y < Math.max(start.y, end.y)) {
      xs.push(start.x)
    }
  }
  xs.sort((a, b) => a - b)
  const intervals: Interval[] = []
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i]! < xs[i + 1]!) intervals.push({ min: xs[i]!, max: xs[i + 1]! })
  }
  return intervals
}
