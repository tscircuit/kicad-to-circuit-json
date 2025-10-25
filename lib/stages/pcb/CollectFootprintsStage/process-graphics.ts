import type { Footprint } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import { mapTextLayer } from "./layer-utils"

/**
 * Rotates a point by a given angle (in degrees)
 */
export function rotatePoint(x: number, y: number, rotationDeg: number): { x: number; y: number } {
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
  componentRotation: number
) {
  if (!ctx.k2cMatPcb) return

  // Process fp_line elements
  const lines = (footprint as any).fpLines || []
  const lineArray = Array.isArray(lines) ? lines : (lines ? [lines] : [])
  for (const line of lineArray) {
    createFootprintLine(ctx, line, componentId, kicadComponentPos, componentRotation)
  }

  // Process fp_circle elements
  const circles = (footprint as any).fpCircles || []
  const circleArray = Array.isArray(circles) ? circles : (circles ? [circles] : [])
  for (const circle of circleArray) {
    createFootprintCircle(ctx, circle, componentId, kicadComponentPos, componentRotation)
  }

  // Process fp_arc elements
  const arcs = (footprint as any).fpArcs || []
  const arcArray = Array.isArray(arcs) ? arcs : (arcs ? [arcs] : [])
  for (const arc of arcArray) {
    createFootprintArc(ctx, arc, componentId, kicadComponentPos, componentRotation)
  }
}

/**
 * Creates a silkscreen line from a footprint line element
 */
export function createFootprintLine(
  ctx: ConverterContext,
  line: any,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number
) {
  if (!ctx.k2cMatPcb) return

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

  ctx.db.pcb_silkscreen_path.insert({
    pcb_component_id: componentId,
    layer: layer,
    route: [startPos, endPos],
    stroke_width: strokeWidth,
  })
}

/**
 * Creates a silkscreen circle from a footprint circle element (approximated as a path)
 */
export function createFootprintCircle(
  ctx: ConverterContext,
  circle: any,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number
) {
  if (!ctx.k2cMatPcb) return

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

  // Create circle as a pcb_silkscreen_circle (if supported) or as a path with many points
  // For now, approximate with an octagon
  const numPoints = 16
  const circleRoute: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI
    const x = centerPos.x + radius * Math.cos(angle)
    const y = centerPos.y + radius * Math.sin(angle)
    circleRoute.push({ x, y })
  }

  ctx.db.pcb_silkscreen_path.insert({
    pcb_component_id: componentId,
    layer: layer,
    route: circleRoute,
    stroke_width: strokeWidth,
  })
}

/**
 * Calculates the center and radius of a circle passing through three points
 */
function calculateArcCenter(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
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
 * Creates a silkscreen arc from a footprint arc element with 0.1mm resolution
 */
export function createFootprintArc(
  ctx: ConverterContext,
  arc: any,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number
) {
  if (!ctx.k2cMatPcb) return

  const start = arc.start || { x: 0, y: 0 }
  const mid = arc.mid || { x: 0, y: 0 }
  const end = arc.end || { x: 0, y: 0 }

  // Rotate arc points by component rotation (negated for Y-axis flip)
  const rotatedStart = rotatePoint(start.x, start.y, -componentRotation)
  const rotatedMid = rotatePoint(mid.x, mid.y, -componentRotation)
  const rotatedEnd = rotatePoint(end.x, end.y, -componentRotation)

  // Apply component position
  const startKicadPos = { x: kicadComponentPos.x + rotatedStart.x, y: kicadComponentPos.y + rotatedStart.y }
  const midKicadPos = { x: kicadComponentPos.x + rotatedMid.x, y: kicadComponentPos.y + rotatedMid.y }
  const endKicadPos = { x: kicadComponentPos.x + rotatedEnd.x, y: kicadComponentPos.y + rotatedEnd.y }

  // Transform to Circuit JSON coordinates
  const startPos = applyToPoint(ctx.k2cMatPcb, startKicadPos)
  const midPos = applyToPoint(ctx.k2cMatPcb, midKicadPos)
  const endPos = applyToPoint(ctx.k2cMatPcb, endKicadPos)

  const layer = mapTextLayer(arc.layer)
  const strokeWidth = arc.stroke?.width || arc.width || 0.12

  // Calculate the arc center and radius
  const arcInfo = calculateArcCenter(startPos, midPos, endPos)

  if (!arcInfo) {
    // If points are collinear, fall back to straight line
    ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: componentId,
      layer: layer,
      route: [startPos, endPos],
      stroke_width: strokeWidth,
    })
    return
  }

  const { center, radius } = arcInfo

  // Calculate angles for start, mid, and end points
  const startAngle = Math.atan2(startPos.y - center.y, startPos.x - center.x)
  const midAngle = Math.atan2(midPos.y - center.y, midPos.x - center.x)
  const endAngle = Math.atan2(endPos.y - center.y, endPos.x - center.x)

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
  const midIsBetween = (isCCW && midSweep > 0 && midSweep < sweepAngle) ||
                       (!isCCW && midSweep < 0 && midSweep > sweepAngle)

  if (!midIsBetween) {
    // Take the long way around
    sweepAngle = sweepAngle > 0 ? sweepAngle - 2 * Math.PI : sweepAngle + 2 * Math.PI
  }

  // Calculate arc length
  const arcLength = Math.abs(radius * sweepAngle)

  // Create segments at 0.1mm resolution (Circuit JSON is in mm)
  const segmentLength = 0.1
  const numSegments = Math.max(2, Math.ceil(arcLength / segmentLength))

  const arcRoute: Array<{ x: number; y: number }> = []

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments
    const angle = startAngle + sweepAngle * t
    arcRoute.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    })
  }

  ctx.db.pcb_silkscreen_path.insert({
    pcb_component_id: componentId,
    layer: layer,
    route: arcRoute,
    stroke_width: strokeWidth,
  })
}
