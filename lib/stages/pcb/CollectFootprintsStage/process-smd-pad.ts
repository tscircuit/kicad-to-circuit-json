import type {
  LayerRef,
  PcbSmtPadCircle,
  PcbSmtPadPill,
  PcbSmtPadPolygon,
  PcbSmtPadRect,
  PcbSmtPadRotatedPill,
  PcbSmtPadRotatedRect,
} from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import { determineLayerFromLayers } from "./layer-utils"
import {
  getPortHintsProps,
  getRoundRectCornerRadius,
  normalizeRotationDegrees,
} from "./pad-utils"
import { rotatePoint } from "./process-graphics"

/**
 * Creates an SMD pad in Circuit JSON
 */
export function createSmdPad({
  ctx,
  pad,
  componentId,
  pos,
  size,
  shape,
  pcbPortId,
  sourcePortId: _sourcePortId,
  padKicadPos,
  padRotationDegrees = 0,
}: {
  ctx: ConverterContext
  pad: any
  componentId: string
  pos: { x: number; y: number }
  size: { x: number; y: number }
  shape: string
  pcbPortId?: string
  sourcePortId?: string
  padKicadPos: { x: number; y: number }
  padRotationDegrees?: number
}) {
  const layers = pad.layers || []
  const layer = determineLayerFromLayers(layers)
  const baseSmtPad = getBaseSmtPadProps({
    componentId,
    pos,
    layer,
    pcbPortId,
    pad,
  })

  if (shape === "custom") {
    // Access primitives from kicadts structure: _sxPrimitives._graphics
    const primitives = pad._sxPrimitives?._graphics || pad.primitives || []
    const primitivesArray = Array.isArray(primitives)
      ? primitives
      : [primitives]

    // List of primitives already processed (to avoid duplicates if we add more types)
    let primitivesProcessed = 0

    // Look for graphics primitives (gr_poly, gr_circle, etc.)
    for (const primitive of primitivesArray) {
      if (primitive.token === "gr_poly") {
        const grPoly = primitive.gr_poly || primitive
        let rawPts: any[] = []
        const ptsContainer = grPoly._sxPts || grPoly.points || grPoly.pts
        const contours = grPoly._contours || grPoly.contours

        if (ptsContainer) {
          if (Array.isArray(ptsContainer)) {
            rawPts = ptsContainer
          } else if (Array.isArray(ptsContainer.points)) {
            rawPts = ptsContainer.points
          } else if (Array.isArray(ptsContainer.pts)) {
            rawPts = ptsContainer.pts
          }
        } else if (Array.isArray(contours)) {
          // Flatten points from all contours
          for (const contour of contours) {
            const contourPts = contour.points || contour.pts || []
            rawPts.push(
              ...(Array.isArray(contourPts) ? contourPts : [contourPts]),
            )
          }
        }

        // Extract points and transform them
        const points: Array<{ x: number; y: number }> = []

        for (const pt of rawPts) {
          // Handle various point formats ({x,y}, {xy:{x,y}}, SxClass with x,y)
          const x = pt.x ?? pt.xy?.x
          const y = pt.y ?? pt.xy?.y
          if (x !== undefined && y !== undefined) {
            const rotated = rotatePoint(x, y, padRotationDegrees)
            const kicadPos = {
              x: padKicadPos.x + rotated.x,
              y: padKicadPos.y + rotated.y,
            }
            points.push(applyToPoint(ctx.k2cMatPcb!, kicadPos))
          }
        }

        if (points.length > 0) {
          const smtpad: PcbSmtPadPolygon = {
            ...baseSmtPad,
            shape: "polygon",
            points: points,
          } as PcbSmtPadPolygon

          ctx.db.pcb_smtpad.insert(smtpad)
          primitivesProcessed++
        }
      }

      if (primitive.token === "gr_circle") {
        const grCircle = primitive.gr_circle || primitive
        const center = grCircle.center || grCircle._sxCenter || { x: 0, y: 0 }
        const end = grCircle.end || grCircle._sxEnd || { x: 0, y: 0 }
        const centerlineRadius = Math.sqrt(
          (end.x - center.x) ** 2 + (end.y - center.y) ** 2,
        )
        const strokeWidth =
          grCircle.stroke?.width ||
          grCircle.width ||
          grCircle._sxWidth?.value ||
          0
        const fill =
          grCircle.fill?.value || grCircle.fill || grCircle._sxFill?.value
        const radius =
          fill === "no" && strokeWidth > 0
            ? centerlineRadius + strokeWidth / 2
            : centerlineRadius

        const rotatedCenter = rotatePoint(
          center.x,
          center.y,
          padRotationDegrees,
        )
        const kicadCenterPos = {
          x: padKicadPos.x + rotatedCenter.x,
          y: padKicadPos.y + rotatedCenter.y,
        }
        const globalCenter = applyToPoint(ctx.k2cMatPcb!, kicadCenterPos)

        const smtpad: PcbSmtPadCircle = {
          ...baseSmtPad,
          shape: "circle",
          x: globalCenter.x,
          y: globalCenter.y,
          radius: radius,
        } as PcbSmtPadCircle

        ctx.db.pcb_smtpad.insert(smtpad)
        primitivesProcessed++
      }
    }

    if (primitivesProcessed > 0) {
      if (ctx.stats) {
        ctx.stats.pads = (ctx.stats.pads || 0) + primitivesProcessed
      }
      // If there are primitives, we'll assume we've handled the pad entirely.
      // In KiCad, custom pads also have an "anchor" shape, but often it's
      // just a placeholder. For now, let's stop here if we found primitives.
      return
    }
  }

  if (shape === "circle") {
    const smtpad: PcbSmtPadCircle = {
      ...baseSmtPad,
      shape: "circle",
      radius: Math.max(size.x, size.y) / 2,
    } as PcbSmtPadCircle
    ctx.db.pcb_smtpad.insert(smtpad)
  } else if (shape === "oval") {
    const normalized = normalizePadShapeRotation(size, padRotationDegrees)
    const radius = Math.min(normalized.width, normalized.height) / 2

    if (normalized.requiresRotation) {
      const smtpad: PcbSmtPadRotatedPill = {
        ...baseSmtPad,
        width: normalized.width,
        height: normalized.height,
        radius,
        shape: "rotated_pill",
        ccw_rotation: normalized.rotationDegrees,
      } as PcbSmtPadRotatedPill
      ctx.db.pcb_smtpad.insert(smtpad)
      return
    }

    const smtpad: PcbSmtPadPill = {
      ...baseSmtPad,
      width: normalized.width,
      height: normalized.height,
      radius,
      shape: "pill",
    } as PcbSmtPadPill

    ctx.db.pcb_smtpad.insert(smtpad)
  } else if (shape === "rect" || shape === "roundrect") {
    const cornerRadius =
      shape === "roundrect" ? getRoundRectCornerRadius(pad, size) : undefined
    const normalized = normalizePadShapeRotation(size, padRotationDegrees)

    if (normalized.requiresRotation) {
      const rotatedsmtpad: PcbSmtPadRotatedRect = {
        ...baseSmtPad,
        width: normalized.width,
        height: normalized.height,
        shape: "rotated_rect",
        ccw_rotation: normalized.rotationDegrees,
        corner_radius: cornerRadius,
      } as PcbSmtPadRotatedRect
      ctx.db.pcb_smtpad.insert(rotatedsmtpad)
      return
    }

    const smtpad: PcbSmtPadRect = {
      ...baseSmtPad,
      width: normalized.width,
      height: normalized.height,
      shape: "rect",
      corner_radius: cornerRadius,
    } as PcbSmtPadRect

    ctx.db.pcb_smtpad.insert(smtpad)
  } else {
    // Default to rect for unknown shapes
    ctx.db.pcb_smtpad.insert({
      ...baseSmtPad,
      width: size.x,
      height: size.y,
      shape: "rect",
    } as PcbSmtPadRect)
  }

  if (ctx.stats) {
    ctx.stats.pads = (ctx.stats.pads || 0) + 1
  }
}

function getBaseSmtPadProps({
  componentId,
  pos,
  layer,
  pcbPortId,
  pad,
}: {
  componentId: string
  pos: { x: number; y: number }
  layer: LayerRef
  pcbPortId?: string
  pad: any
}) {
  return {
    type: "pcb_smtpad" as const,
    pcb_component_id: componentId,
    pcb_smtpad_id: "pcb_smtpad_id",
    x: pos.x,
    y: pos.y,
    layer,
    pcb_port_id: pcbPortId,
    ...getPortHintsProps(pad),
  }
}

function normalizePadShapeRotation(
  size: { x: number; y: number },
  rotationDegrees: number | undefined,
): {
  width: number
  height: number
  rotationDegrees: number
  requiresRotation: boolean
} {
  const normalizedRotation = normalizeRotationDegrees(rotationDegrees)
  const rightAngleTurns = getRightAngleTurns(normalizedRotation)
  const shouldSwapDimensions =
    rightAngleTurns !== null && Math.abs(rightAngleTurns) % 2 === 1

  return {
    width: shouldSwapDimensions ? size.y : size.x,
    height: shouldSwapDimensions ? size.x : size.y,
    rotationDegrees: normalizedRotation,
    requiresRotation: rightAngleTurns === null && normalizedRotation !== 0,
  }
}

function getRightAngleTurns(rotationDegrees: number): number | null {
  const quarterTurns = rotationDegrees / 90

  if (Math.abs(quarterTurns - Math.round(quarterTurns)) > 1e-9) {
    return null
  }

  return Math.round(quarterTurns)
}
