import Flatten from "@flatten-js/core"
import {
  FootprintPad,
  PadPrimitiveGrCircle,
  PadPrimitiveGrLine,
  PadPrimitiveGrPoly,
} from "kicadts"
import type { Point } from "../../../types"
import { getCustomPadPolygonContours } from "./custom-pad-polygon-contours"

type FlattenPolygon = InstanceType<typeof Flatten.Polygon>

function createEllipsePolygon(params: {
  center?: Point
  width: number
  height: number
  segments?: number
}): FlattenPolygon {
  const { center = { x: 0, y: 0 }, width, height, segments = 32 } = params
  const vertices: Array<[number, number]> = []

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    vertices.push([
      center.x + (width / 2) * Math.cos(angle),
      center.y + (height / 2) * Math.sin(angle),
    ])
  }

  return new Flatten.Polygon(vertices)
}

function createRectanglePolygon(start: Point, end: Point): FlattenPolygon {
  return new Flatten.Polygon([
    [Math.min(start.x, end.x), Math.min(start.y, end.y)],
    [Math.max(start.x, end.x), Math.min(start.y, end.y)],
    [Math.max(start.x, end.x), Math.max(start.y, end.y)],
    [Math.min(start.x, end.x), Math.max(start.y, end.y)],
  ])
}

function createCapsulePolygon(params: {
  start: Point
  end: Point
  width: number
  capSegments?: number
}): FlattenPolygon {
  const { start, end, width, capSegments = 8 } = params
  const radius = width / 2
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y

  if (Math.hypot(deltaX, deltaY) < 1e-9) {
    return createEllipsePolygon({
      center: start,
      width,
      height: width,
      segments: capSegments * 2,
    })
  }

  const direction = Math.atan2(deltaY, deltaX)
  const vertices: Array<[number, number]> = []

  for (let index = 0; index <= capSegments; index += 1) {
    const angle = direction - Math.PI / 2 + (index / capSegments) * Math.PI
    vertices.push([
      end.x + radius * Math.cos(angle),
      end.y + radius * Math.sin(angle),
    ])
  }

  for (let index = 0; index <= capSegments; index += 1) {
    const angle = direction + Math.PI / 2 + (index / capSegments) * Math.PI
    vertices.push([
      start.x + radius * Math.cos(angle),
      start.y + radius * Math.sin(angle),
    ])
  }

  return new Flatten.Polygon(vertices)
}

function createAnchorPolygon(pad: FootprintPad, size: Point): FlattenPolygon {
  if (pad.options?.anchor === "circle") {
    return createEllipsePolygon({ width: size.x, height: size.y })
  }

  return createRectanglePolygon(
    { x: -size.x / 2, y: -size.y / 2 },
    { x: size.x / 2, y: size.y / 2 },
  )
}

function createPolygonPrimitiveOutlines(
  primitive: PadPrimitiveGrPoly,
): FlattenPolygon[] {
  return getCustomPadPolygonContours(primitive)
    .filter((contour) => contour.length >= 3)
    .map(
      (contour) =>
        new Flatten.Polygon(
          contour.map(({ x, y }) => [x, y] as [number, number]),
        ),
    )
}

function createCirclePrimitiveOutline(
  primitive: PadPrimitiveGrCircle,
): FlattenPolygon | undefined {
  if (!primitive.center || !primitive.end) return undefined

  const centerlineRadius = Math.hypot(
    primitive.end.x - primitive.center.x,
    primitive.end.y - primitive.center.y,
  )
  const strokeWidth = primitive.width ?? 0
  const radius =
    primitive.fill === false && strokeWidth > 0
      ? centerlineRadius + strokeWidth / 2
      : centerlineRadius

  return createEllipsePolygon({
    center: primitive.center,
    width: radius * 2,
    height: radius * 2,
  })
}

function createLinePrimitiveOutline(
  primitive: PadPrimitiveGrLine,
): FlattenPolygon | undefined {
  if (!primitive.start || !primitive.end || !primitive.width) return undefined

  return createCapsulePolygon({
    start: primitive.start,
    end: primitive.end,
    width: primitive.width,
  })
}

export function getCustomPadCopperOutline(params: {
  pad: FootprintPad
  size: Point
}): Point[] {
  const { pad, size } = params
  const copperPolygons: FlattenPolygon[] = []

  if (size.x >= 0.01 && size.y >= 0.01) {
    copperPolygons.push(createAnchorPolygon(pad, size))
  }

  for (const primitive of pad.primitives?.graphics ?? []) {
    if (primitive instanceof PadPrimitiveGrPoly) {
      copperPolygons.push(...createPolygonPrimitiveOutlines(primitive))
      continue
    }

    if (primitive instanceof PadPrimitiveGrCircle) {
      const outline = createCirclePrimitiveOutline(primitive)
      if (outline) copperPolygons.push(outline)
      continue
    }

    if (primitive instanceof PadPrimitiveGrLine) {
      const outline = createLinePrimitiveOutline(primitive)
      if (outline) copperPolygons.push(outline)
    }
  }

  if (copperPolygons.length === 0) {
    return [
      { x: -size.x / 2, y: -size.y / 2 },
      { x: size.x / 2, y: -size.y / 2 },
      { x: size.x / 2, y: size.y / 2 },
      { x: -size.x / 2, y: size.y / 2 },
    ]
  }

  let combinedCopper = copperPolygons[0]!
  for (const polygon of copperPolygons.slice(1)) {
    combinedCopper = Flatten.BooleanOperations.unify(combinedCopper, polygon)
  }

  // Circuit JSON currently accepts one pad outline, so keep the largest island
  // if a KiCad custom pad contains disconnected copper primitives.
  const largestCopperIsland = combinedCopper
    .splitToIslands()
    .sort(
      (firstIsland, secondIsland) => secondIsland.area() - firstIsland.area(),
    )[0]

  return (largestCopperIsland ?? combinedCopper).vertices.map(({ x, y }) => ({
    x,
    y,
  }))
}
