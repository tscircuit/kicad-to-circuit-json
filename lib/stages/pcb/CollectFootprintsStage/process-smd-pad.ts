import type {
  PcbSmtPadCircle,
  PcbSmtPadPill,
  PcbSmtPadPolygon,
  PcbSmtPadRect,
  PcbSmtPadRotatedPill,
  PcbSmtPadRotatedRect,
} from "circuit-json"
import type { FootprintPad } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import { determineLayerFromLayers } from "./layer-utils"
import {
  getPadRoundRectRadius,
  getRightAngleTurns,
  normalizeRotationDegrees,
  type Point,
  type Size,
} from "./pad-utils"
import { rotatePoint } from "./process-graphics"

type PointLike = { x?: number; y?: number; xy?: { x?: number; y?: number } }
type PtsLike = { points?: PointLike[]; pts?: PointLike[] }
type PrimitiveLike = { token?: string }
type PadPrimitiveCircleLike = PrimitiveLike & {
  center?: { x: number; y: number }
  end?: { x: number; y: number }
  stroke?: { width?: number }
  width?: number
  fill?: { value?: string } | string
  _sxCenter?: { x: number; y: number }
  _sxEnd?: { x: number; y: number }
  _sxWidth?: { value?: number }
  _sxFill?: { value?: string }
}
type PadPrimitivePolyLike = PrimitiveLike & {
  _sxPts?: PointLike[] | { points?: PointLike[]; pts?: PointLike[] }
  points?: PointLike[] | { points?: PointLike[]; pts?: PointLike[] }
  pts?: PointLike[]
  _contours?: PtsLike[]
  contours?: PtsLike[]
}

export function createSmdPad({
  ctx,
  pad,
  componentId,
  pos,
  size,
  shape,
  pcbPortId,
  padKicadPos,
  totalCcwRotationDegrees = 0,
}: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  pos: Point
  size: Size
  shape: string
  pcbPortId?: string
  sourcePortId?: string
  padKicadPos: Point
  totalCcwRotationDegrees?: number
}) {
  const layers = pad.layers || []
  const layer = determineLayerFromLayers(layers)

  if (shape === "custom") {
    const primitivesProcessed = createCustomSmdPadPrimitives({
      ctx,
      pad,
      componentId,
      pcbPortId,
      padKicadPos,
      layer,
      totalCcwRotationDegrees,
    })

    if (primitivesProcessed > 0) {
      if (ctx.stats) {
        ctx.stats.pads = (ctx.stats.pads || 0) + primitivesProcessed
      }
      return
    }
  }

  createStandardSmdPad({
    ctx,
    pad,
    componentId,
    pos,
    size,
    shape,
    layer,
    pcbPortId,
  })

  if (ctx.stats) {
    ctx.stats.pads = (ctx.stats.pads || 0) + 1
  }
}

function createCustomSmdPadPrimitives({
  ctx,
  pad,
  componentId,
  pcbPortId,
  padKicadPos,
  layer,
  totalCcwRotationDegrees,
}: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  pcbPortId?: string
  padKicadPos: Point
  layer: string
  totalCcwRotationDegrees: number
}): number {
  const privatePad = pad as unknown as {
    _sxPrimitives?: { _graphics?: PrimitiveLike[] }
  }
  const primitives =
    privatePad._sxPrimitives?._graphics || pad.primitives?.graphics || []
  const primitivesArray = Array.isArray(primitives) ? primitives : [primitives]
  let primitivesProcessed = 0

  for (const primitive of primitivesArray) {
    if (primitive.token === "gr_poly") {
      const polygonPoints = getCustomPadPolygonPoints(
        {
          primitive: primitive as PadPrimitivePolyLike,
          padKicadPos,
          totalCcwRotationDegrees,
        },
        ctx,
      )

      if (polygonPoints.length > 0) {
        ctx.db.pcb_smtpad.insert({
          type: "pcb_smtpad",
          shape: "polygon",
          pcb_component_id: componentId,
          pcb_port_id: pcbPortId,
          pcb_smtpad_id: "pcb_smtpad_id",
          layer,
          port_hints: [pad.number.toString()],
          points: polygonPoints,
        } as PcbSmtPadPolygon)
        primitivesProcessed++
      }
    }

    if (primitive.token === "gr_circle") {
      const circle = getCustomPadCircle(
        {
          primitive: primitive as PadPrimitiveCircleLike,
          padKicadPos,
          totalCcwRotationDegrees,
        },
        ctx,
      )

      ctx.db.pcb_smtpad.insert({
        type: "pcb_smtpad",
        shape: "circle",
        pcb_component_id: componentId,
        pcb_port_id: pcbPortId,
        pcb_smtpad_id: "pcb_smtpad_id",
        layer,
        port_hints: [pad.number.toString()],
        x: circle.center.x,
        y: circle.center.y,
        width: circle.radius * 2,
        height: circle.radius * 2,
        radius: circle.radius,
      } as PcbSmtPadCircle)
      primitivesProcessed++
    }
  }

  return primitivesProcessed
}

function getCustomPadPolygonPoints(
  {
    primitive,
    padKicadPos,
    totalCcwRotationDegrees,
  }: {
    primitive: PadPrimitivePolyLike
    padKicadPos: Point
    totalCcwRotationDegrees: number
  },
  ctx: ConverterContext,
): Point[] {
  const grPoly = primitive
  const rawPoints = getCustomPrimitivePoints(grPoly)
  const points: Point[] = []

  for (const pt of rawPoints) {
    const x = pt.x ?? pt.xy?.x
    const y = pt.y ?? pt.xy?.y

    if (x !== undefined && y !== undefined) {
      const rotated = rotatePoint(x, y, totalCcwRotationDegrees)
      const kicadPos = {
        x: padKicadPos.x + rotated.x,
        y: padKicadPos.y + rotated.y,
      }
      points.push(applyToPoint(ctx.k2cMatPcb!, kicadPos))
    }
  }

  return points
}

function getCustomPrimitivePoints(grPoly: PadPrimitivePolyLike): PointLike[] {
  let rawPoints: PointLike[] = []
  const ptsContainer = grPoly._sxPts || grPoly.points || grPoly.pts
  const contours = grPoly._contours || grPoly.contours

  if (ptsContainer) {
    if (Array.isArray(ptsContainer)) {
      rawPoints = ptsContainer
    } else if (Array.isArray(ptsContainer.points)) {
      rawPoints = ptsContainer.points
    } else if (Array.isArray(ptsContainer.pts)) {
      rawPoints = ptsContainer.pts
    }
  } else if (Array.isArray(contours)) {
    for (const contour of contours) {
      const contourPoints = contour.points || contour.pts || []
      rawPoints.push(
        ...(Array.isArray(contourPoints) ? contourPoints : [contourPoints]),
      )
    }
  }

  return rawPoints
}

function getCustomPadCircle(
  {
    primitive,
    padKicadPos,
    totalCcwRotationDegrees,
  }: {
    primitive: PadPrimitiveCircleLike
    padKicadPos: Point
    totalCcwRotationDegrees: number
  },
  ctx: ConverterContext,
): { center: Point; radius: number } {
  const grCircle = primitive
  const center = grCircle.center || grCircle._sxCenter || { x: 0, y: 0 }
  const end = grCircle.end || grCircle._sxEnd || { x: 0, y: 0 }
  const centerlineRadius = Math.sqrt(
    (end.x - center.x) ** 2 + (end.y - center.y) ** 2,
  )
  const strokeWidth =
    grCircle.stroke?.width || grCircle.width || grCircle._sxWidth?.value || 0
  const fill =
    typeof grCircle.fill === "string"
      ? grCircle.fill
      : grCircle.fill?.value || grCircle._sxFill?.value
  const radius =
    fill === "no" && strokeWidth > 0
      ? centerlineRadius + strokeWidth / 2
      : centerlineRadius

  const rotatedCenter = rotatePoint(center.x, center.y, totalCcwRotationDegrees)
  const kicadCenterPos = {
    x: padKicadPos.x + rotatedCenter.x,
    y: padKicadPos.y + rotatedCenter.y,
  }

  return {
    center: applyToPoint(ctx.k2cMatPcb!, kicadCenterPos),
    radius,
  }
}

function createStandardSmdPad({
  ctx,
  pad,
  componentId,
  pos,
  size,
  shape,
  layer,
  pcbPortId,
}: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  pos: Point
  size: Size
  shape: string
  layer: string
  pcbPortId?: string
}) {
  const portHints = [pad.number?.toString()]
  const ccwRotationDegrees = pad.at?.angle

  if (shape === "circle") {
    ctx.db.pcb_smtpad.insert({
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      pcb_smtpad_id: "pcb_smtpad_id",
      x: pos.x,
      y: pos.y,
      width: size.x,
      height: size.y,
      layer,
      pcb_port_id: pcbPortId,
      port_hints: portHints,
      shape: "circle",
      radius: Math.max(size.x, size.y) / 2,
    } as PcbSmtPadCircle)
    return
  }

  if (shape === "oval") {
    createOvalSmdPad({
      ctx,
      componentId,
      pos,
      size,
      layer,
      pcbPortId,
      portHints,
      ccwRotationDegrees,
    })
    return
  }

  if (shape === "rect" || shape === "roundrect") {
    createRectSmdPad({
      ctx,
      pad,
      componentId,
      pos,
      size,
      shape,
      layer,
      pcbPortId,
      portHints,
      ccwRotationDegrees,
    })
    return
  }

  ctx.db.pcb_smtpad.insert({
    type: "pcb_smtpad",
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    width: size.x,
    height: size.y,
    layer,
    pcb_port_id: pcbPortId,
    port_hints: portHints,
    shape: "rect",
  } as PcbSmtPadRect)
}

function createOvalSmdPad({
  ctx,
  componentId,
  pos,
  size,
  layer,
  pcbPortId,
  portHints,
  ccwRotationDegrees,
}: {
  ctx: ConverterContext
  componentId: string
  pos: Point
  size: Size
  layer: string
  pcbPortId?: string
  portHints: string[]
  ccwRotationDegrees: number | undefined
}) {
  const normalizedCcwRotation = normalizeRotationDegrees(ccwRotationDegrees)
  const rightAngleTurns = getRightAngleTurns(normalizedCcwRotation)
  const radius = Math.min(size.x, size.y) / 2

  if (rightAngleTurns === null && normalizedCcwRotation !== 0) {
    ctx.db.pcb_smtpad.insert({
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      x: pos.x,
      y: pos.y,
      width: size.x,
      height: size.y,
      radius,
      layer,
      pcb_port_id: pcbPortId,
      port_hints: portHints,
      shape: "rotated_pill",
      ccw_rotation: normalizedCcwRotation,
    } as PcbSmtPadRotatedPill)
    return
  }

  const shouldSwapDimensions =
    rightAngleTurns !== null && Math.abs(rightAngleTurns) % 2 === 1

  ctx.db.pcb_smtpad.insert({
    type: "pcb_smtpad",
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    width: shouldSwapDimensions ? size.y : size.x,
    height: shouldSwapDimensions ? size.x : size.y,
    radius,
    layer,
    pcb_port_id: pcbPortId,
    port_hints: portHints,
    shape: "pill",
  } as PcbSmtPadPill)
}

function createRectSmdPad({
  ctx,
  pad,
  componentId,
  pos,
  size,
  shape,
  layer,
  pcbPortId,
  portHints,
  ccwRotationDegrees,
}: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  pos: Point
  size: Size
  shape: string
  layer: string
  pcbPortId?: string
  portHints: string[]
  ccwRotationDegrees: number | undefined
}) {
  const cornerRadius =
    shape === "roundrect" ? getPadRoundRectRadius(pad, size) : undefined
  const normalizedCcwRotation = normalizeRotationDegrees(ccwRotationDegrees)
  const rightAngleTurns = getRightAngleTurns(normalizedCcwRotation)

  if (rightAngleTurns === null && normalizedCcwRotation !== 0) {
    ctx.db.pcb_smtpad.insert({
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      x: pos.x,
      y: pos.y,
      width: size.x,
      height: size.y,
      layer,
      pcb_port_id: pcbPortId,
      port_hints: portHints,
      shape: "rotated_rect",
      ccw_rotation: normalizedCcwRotation,
      corner_radius: cornerRadius,
    } as PcbSmtPadRotatedRect)
    return
  }

  const shouldSwapDimensions =
    rightAngleTurns !== null && Math.abs(rightAngleTurns) % 2 === 1

  ctx.db.pcb_smtpad.insert({
    type: "pcb_smtpad",
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    width: shouldSwapDimensions ? size.y : size.x,
    height: shouldSwapDimensions ? size.x : size.y,
    layer,
    pcb_port_id: pcbPortId,
    port_hints: portHints,
    shape: "rect",
    corner_radius: cornerRadius,
  } as PcbSmtPadRect)
}
