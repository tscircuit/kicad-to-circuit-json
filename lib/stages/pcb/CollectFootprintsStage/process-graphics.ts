import type { Footprint, FpPoly, FpLine, FpCircle, FpArc } from "kicadts"
import type { PcbRenderLayer } from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import {
  isPcbAnnotationRenderLayer,
  mapKicadLayerToPcbRenderLayer,
} from "../layer-mapping"
import { mapTextLayer } from "./layer-utils"

function insertFootprintRoute(options: {
  ctx: ConverterContext
  componentId: string
  layer: "top" | "bottom"
  renderLayer: PcbRenderLayer
  route: Array<{ x: number; y: number }>
  strokeWidth: number
}) {
  const { ctx, componentId, layer, renderLayer, route, strokeWidth } = options

  if (renderLayer.endsWith("_silkscreen")) {
    ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: componentId,
      layer,
      route,
      stroke_width: strokeWidth,
    })
    return
  }

  if (renderLayer.endsWith("_fabrication_note")) {
    ctx.db.pcb_fabrication_note_path.insert({
      pcb_component_id: componentId,
      layer,
      route,
      stroke_width: strokeWidth,
    })
    return
  }

  ctx.db.pcb_courtyard_outline.insert({
    pcb_component_id: componentId,
    layer,
    outline: route,
  })
}

/**
 * Rotates a point by a given angle (in degrees)
 */
export function rotatePoint(
  x: number,
  y: number,
  rotationDeg: number,
): { x: number; y: number } {
  const rotationRad = (rotationDeg * Math.PI) / 180
  return {
    x: x * Math.cos(rotationRad) - y * Math.sin(rotationRad),
    y: x * Math.sin(rotationRad) + y * Math.cos(rotationRad),
  }
}

/**
 * Processes all graphical elements in a footprint (lines, circles, arcs)
 */
export function processFootprintGraphics(
  ctx: ConverterContext,
  footprint: Footprint,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
) {
  if (!ctx.k2cMatPcb) return

  // Process fp_line elements
  const lines = footprint.fpLines || []
  const lineArray = Array.isArray(lines) ? lines : lines ? [lines] : []
  for (const line of lineArray) {
    createFootprintLine(
      ctx,
      line,
      componentId,
      kicadComponentPos,
      componentRotation,
    )
  }

  // Process fp_rect elements
  const rects = footprint.fpRects || []
  const rectArray = Array.isArray(rects) ? rects : rects ? [rects] : []
  for (const rect of rectArray) {
    createFootprintRect(
      ctx,
      rect,
      componentId,
      kicadComponentPos,
      componentRotation,
    )
  }

  // Process fp_circle elements
  const circles = footprint.fpCircles || []
  const circleArray = Array.isArray(circles)
    ? circles
    : circles
      ? [circles]
      : []
  for (const circle of circleArray) {
    createFootprintCircle(
      ctx,
      circle,
      componentId,
      kicadComponentPos,
      componentRotation,
    )
  }

  // Process fp_arc elements
  const arcs = footprint.fpArcs || []
  const arcArray = Array.isArray(arcs) ? arcs : arcs ? [arcs] : []
  for (const arc of arcArray) {
    createFootprintArc(
      ctx,
      arc,
      componentId,
      kicadComponentPos,
      componentRotation,
    )
  }

  // Process fp_poly elements
  const polys = footprint.fpPolys || []
  const polyArray = Array.isArray(polys) ? polys : polys ? [polys] : []
  for (const poly of polyArray) {
    createFootprintPoly(
      ctx,
      poly,
      componentId,
      kicadComponentPos,
      componentRotation,
    )
  }
}

/**
 * Creates a footprint line graphic on the matching output layer type
 */
export function createFootprintLine(
  ctx: ConverterContext,
  line: FpLine,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
) {
  if (!ctx.k2cMatPcb) return

  const renderLayer = mapKicadLayerToPcbRenderLayer(line.layer)
  if (!isPcbAnnotationRenderLayer(renderLayer)) return

  const start = line.start || { x: 0, y: 0 }
  const end = line.end || { x: 0, y: 0 }

  // Rotate line points by component rotation (negated for Y-axis flip)
  const rotatedStart = rotatePoint(start.x, start.y, -componentRotation)
  const rotatedEnd = rotatePoint(end.x, end.y, -componentRotation)

  // Apply component position
  const startKicadPos = {
    x: kicadComponentPos.x + rotatedStart.x,
    y: kicadComponentPos.y + rotatedStart.y,
  }
  const endKicadPos = {
    x: kicadComponentPos.x + rotatedEnd.x,
    y: kicadComponentPos.y + rotatedEnd.y,
  }

  // Transform to Circuit JSON coordinates
  const startPos = applyToPoint(ctx.k2cMatPcb, startKicadPos)
  const endPos = applyToPoint(ctx.k2cMatPcb, endKicadPos)

  const layer = mapTextLayer(line.layer)
  const strokeWidth = line.stroke?.width || line.width || 0.12

  insertFootprintRoute({
    ctx,
    componentId,
    layer,
    renderLayer,
    route: [startPos, endPos],
    strokeWidth,
  })
}

/**
 * Creates a footprint rectangle graphic on the matching output layer type
 */
export function createFootprintRect(
  ctx: ConverterContext,
  rect: any,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
) {
  if (!ctx.k2cMatPcb) return

  const renderLayer = mapKicadLayerToPcbRenderLayer(rect.layer)
  if (!isPcbAnnotationRenderLayer(renderLayer)) return

  const start = rect.start || { x: 0, y: 0 }
  const end = rect.end || { x: 0, y: 0 }
  const center = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }

  // Rotate rectangle center by component rotation (negated for Y-axis flip)
  const rotatedCenter = rotatePoint(center.x, center.y, -componentRotation)

  // Apply component position
  const centerKicadPos = {
    x: kicadComponentPos.x + rotatedCenter.x,
    y: kicadComponentPos.y + rotatedCenter.y,
  }

  // Transform to Circuit JSON coordinates
  const centerPos = applyToPoint(ctx.k2cMatPcb, centerKicadPos)

  const layer = mapTextLayer(rect.layer)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  const strokeWidth = rect.stroke?.width || rect.width || 0.12

  if (renderLayer.endsWith("_courtyard")) {
    ctx.db.pcb_courtyard_rect.insert({
      pcb_component_id: componentId,
      center: centerPos,
      width,
      height,
      layer,
      ccw_rotation: -componentRotation,
    })
    return
  }

  if (renderLayer.endsWith("_fabrication_note")) {
    ctx.db.pcb_fabrication_note_rect.insert({
      pcb_component_id: componentId,
      center: centerPos,
      width,
      height,
      layer,
      stroke_width: strokeWidth,
      is_filled: rect.fill?.filled === true,
      has_stroke: true,
    })
    return
  }

  const corners = [
    { x: start.x, y: start.y },
    { x: end.x, y: start.y },
    { x: end.x, y: end.y },
    { x: start.x, y: end.y },
    { x: start.x, y: start.y },
  ]
  const route = corners.map((point) => {
    const rotated = rotatePoint(point.x, point.y, -componentRotation)
    const kicadPos = {
      x: kicadComponentPos.x + rotated.x,
      y: kicadComponentPos.y + rotated.y,
    }
    return applyToPoint(ctx.k2cMatPcb!, kicadPos)
  })

  insertFootprintRoute({
    ctx,
    componentId,
    layer,
    renderLayer,
    route,
    strokeWidth,
  })
}

/**
 * Creates a footprint circle graphic on the matching output layer type
 */
export function createFootprintCircle(
  ctx: ConverterContext,
  circle: FpCircle,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
) {
  if (!ctx.k2cMatPcb) return

  const renderLayer = mapKicadLayerToPcbRenderLayer(circle.layer)
  if (!isPcbAnnotationRenderLayer(renderLayer)) return

  const center = circle.center || { x: 0, y: 0 }
  const end = circle.end || { x: 0, y: 0 }

  // Calculate radius (distance from center to end point)
  const radius = Math.sqrt((end.x - center.x) ** 2 + (end.y - center.y) ** 2)

  // Rotate center by component rotation (negated for Y-axis flip)
  const rotatedCenter = rotatePoint(center.x, center.y, -componentRotation)

  // Apply component position
  const centerKicadPos = {
    x: kicadComponentPos.x + rotatedCenter.x,
    y: kicadComponentPos.y + rotatedCenter.y,
  }

  // Transform to Circuit JSON coordinates
  const centerPos = applyToPoint(ctx.k2cMatPcb, centerKicadPos)

  const layer = mapTextLayer(circle.layer)
  const strokeWidth = circle.stroke?.width || circle.width || 0.12

  if (renderLayer.endsWith("_courtyard")) {
    ctx.db.pcb_courtyard_circle.insert({
      pcb_component_id: componentId,
      center: centerPos,
      radius,
      layer,
    })
    return
  }

  // Create circle as a path with many points
  // For now, approximate with an octagon
  const numPoints = 16
  const circleRoute: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI
    const x = centerPos.x + radius * Math.cos(angle)
    const y = centerPos.y + radius * Math.sin(angle)
    circleRoute.push({ x, y })
  }

  insertFootprintRoute({
    ctx,
    componentId,
    layer,
    renderLayer,
    route: circleRoute,
    strokeWidth,
  })
}

/**
 * Calculates the center and radius of a circle passing through three points
 */
function calculateArcCenter(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): { center: { x: number; y: number }; radius: number } | null {
  const ax = p1.x - p2.x
  const ay = p1.y - p2.y
  const bx = p2.x - p3.x
  const by = p2.y - p3.y

  const denom = 2 * (ax * by - ay * bx)

  // Points are collinear
  if (Math.abs(denom) < 1e-10) {
    return null
  }

  const d1 = p1.x * p1.x + p1.y * p1.y - p2.x * p2.x - p2.y * p2.y
  const d2 = p2.x * p2.x + p2.y * p2.y - p3.x * p3.x - p3.y * p3.y

  const cx = (d1 * by - d2 * ay) / denom
  const cy = (ax * d2 - bx * d1) / denom

  const radius = Math.sqrt((p1.x - cx) ** 2 + (p1.y - cy) ** 2)

  return { center: { x: cx, y: cy }, radius }
}

/**
 * Creates a footprint arc graphic on the matching output layer type
 */
export function createFootprintArc(
  ctx: ConverterContext,
  arc: FpArc,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
) {
  if (!ctx.k2cMatPcb) return

  const renderLayer = mapKicadLayerToPcbRenderLayer(arc.layer)
  if (!isPcbAnnotationRenderLayer(renderLayer)) return

  const start = arc.start || { x: 0, y: 0 }
  const mid = arc.mid || { x: 0, y: 0 }
  const end = arc.end || { x: 0, y: 0 }

  // Rotate arc points by component rotation (negated for Y-axis flip)
  const rotatedStart = rotatePoint(start.x, start.y, -componentRotation)
  const rotatedMid = rotatePoint(mid.x, mid.y, -componentRotation)
  const rotatedEnd = rotatePoint(end.x, end.y, -componentRotation)

  // Apply component position - these are now in KiCad global coordinates
  const startKicadPos = {
    x: kicadComponentPos.x + rotatedStart.x,
    y: kicadComponentPos.y + rotatedStart.y,
  }
  const midKicadPos = {
    x: kicadComponentPos.x + rotatedMid.x,
    y: kicadComponentPos.y + rotatedMid.y,
  }
  const endKicadPos = {
    x: kicadComponentPos.x + rotatedEnd.x,
    y: kicadComponentPos.y + rotatedEnd.y,
  }

  const layer = mapTextLayer(arc.layer)
  const strokeWidth = arc.stroke?.width || arc.width || 0.12

  // Calculate the arc center and radius IN KICAD SPACE (before coordinate transformation)
  const arcInfo = calculateArcCenter(startKicadPos, midKicadPos, endKicadPos)

  if (!arcInfo) {
    // If points are collinear, fall back to straight line
    const startPos = applyToPoint(ctx.k2cMatPcb, startKicadPos)
    const endPos = applyToPoint(ctx.k2cMatPcb, endKicadPos)
    insertFootprintRoute({
      ctx,
      componentId,
      layer,
      renderLayer,
      route: [startPos, endPos],
      strokeWidth,
    })
    return
  }

  const { center, radius } = arcInfo

  // Calculate angles for start, mid, and end points IN KICAD SPACE
  const startAngle = Math.atan2(
    startKicadPos.y - center.y,
    startKicadPos.x - center.x,
  )
  const midAngle = Math.atan2(
    midKicadPos.y - center.y,
    midKicadPos.x - center.x,
  )
  const endAngle = Math.atan2(
    endKicadPos.y - center.y,
    endKicadPos.x - center.x,
  )

  // Determine arc direction (clockwise or counter-clockwise)
  // by checking if mid angle is between start and end angles
  let sweepAngle = endAngle - startAngle
  let midSweep = midAngle - startAngle

  // Normalize angles to [-π, π]
  while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI
  while (sweepAngle < -Math.PI) sweepAngle += 2 * Math.PI
  while (midSweep > Math.PI) midSweep -= 2 * Math.PI
  while (midSweep < -Math.PI) midSweep += 2 * Math.PI

  // Check if we need to go the long way around
  const isCCW = sweepAngle > 0
  const midIsBetween =
    (isCCW && midSweep > 0 && midSweep < sweepAngle) ||
    (!isCCW && midSweep < 0 && midSweep > sweepAngle)

  if (!midIsBetween) {
    // Take the long way around
    sweepAngle =
      sweepAngle > 0 ? sweepAngle - 2 * Math.PI : sweepAngle + 2 * Math.PI
  }

  // Calculate arc length
  const arcLength = Math.abs(radius * sweepAngle)

  // Create segments at 0.1mm resolution (Circuit JSON is in mm)
  const segmentLength = 0.1
  const numSegments = Math.max(2, Math.ceil(arcLength / segmentLength))

  const arcRoute: Array<{ x: number; y: number }> = []

  // Generate arc points in KiCad space, THEN transform to Circuit JSON space
  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments
    const angle = startAngle + sweepAngle * t
    const kicadPoint = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    }
    // Transform each point to Circuit JSON coordinates
    const cjPoint = applyToPoint(ctx.k2cMatPcb, kicadPoint)
    arcRoute.push(cjPoint)
  }

  insertFootprintRoute({
    ctx,
    componentId,
    layer,
    renderLayer,
    route: arcRoute,
    strokeWidth,
  })
}

export function createFootprintPoly(
  ctx: ConverterContext,
  poly: FpPoly,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentCcwRotationDegrees: number,
) {
  if (!ctx.k2cMatPcb) return

  const renderLayer = mapKicadLayerToPcbRenderLayer(poly.layer)
  if (!isPcbAnnotationRenderLayer(renderLayer)) return

  // Extract points
  const ptArray: any[] = poly.points?.points || []
  if (ptArray.length === 0) return

  // Extract layer
  const layer = mapTextLayer(poly.layer)

  // Extract stroke width
  const strokeWidth = poly.stroke?.width || poly.width || 0.12

  // Map and transform points
  const transformedPts = ptArray.map((p: any) => {
    // Handle both {x, y} and {xy: {x, y}} or {token: 'xy', x, y}
    const x = p.x ?? p.xy?.x ?? 0
    const y = p.y ?? p.xy?.y ?? 0
    const rotated = rotatePoint(x, y, -componentCcwRotationDegrees)
    const kicadPos = {
      x: kicadComponentPos.x + rotated.x,
      y: kicadComponentPos.y + rotated.y,
    }
    return applyToPoint(ctx.k2cMatPcb!, kicadPos)
  })

  if (renderLayer.endsWith("_courtyard")) {
    ctx.db.pcb_courtyard_outline.insert({
      pcb_component_id: componentId,
      layer,
      outline: transformedPts,
    })
    return
  }

  insertFootprintRoute({
    ctx,
    componentId,
    layer,
    renderLayer,
    route: transformedPts,
    strokeWidth,
  })
}
