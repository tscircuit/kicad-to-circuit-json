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

  // Rotate line points by component rotation
  const rotatedStart = rotatePoint(start.x, start.y, componentRotation)
  const rotatedEnd = rotatePoint(end.x, end.y, componentRotation)

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

  // Rotate center by component rotation
  const rotatedCenter = rotatePoint(center.x, center.y, componentRotation)

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
 * Creates a silkscreen arc from a footprint arc element (approximated as a path)
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

  // Rotate arc points by component rotation
  const rotatedStart = rotatePoint(start.x, start.y, componentRotation)
  const rotatedMid = rotatePoint(mid.x, mid.y, componentRotation)
  const rotatedEnd = rotatePoint(end.x, end.y, componentRotation)

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

  // Approximate arc with multiple line segments
  // For simplicity, use start-mid-end as a rough approximation
  // A better implementation would calculate the actual arc
  const numSegments = 8
  const arcRoute: Array<{ x: number; y: number }> = [startPos]

  // Simple linear interpolation for now (not a true arc, but better than nothing)
  for (let i = 1; i < numSegments; i++) {
    const t = i / numSegments
    if (t < 0.5) {
      const t2 = t * 2
      arcRoute.push({
        x: startPos.x + (midPos.x - startPos.x) * t2,
        y: startPos.y + (midPos.y - startPos.y) * t2,
      })
    } else {
      const t2 = (t - 0.5) * 2
      arcRoute.push({
        x: midPos.x + (endPos.x - midPos.x) * t2,
        y: midPos.y + (endPos.y - midPos.y) * t2,
      })
    }
  }
  arcRoute.push(endPos)

  ctx.db.pcb_silkscreen_path.insert({
    pcb_component_id: componentId,
    layer: layer,
    route: arcRoute,
    stroke_width: strokeWidth,
  })
}
