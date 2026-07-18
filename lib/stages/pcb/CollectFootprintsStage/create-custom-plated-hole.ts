import type { LayerRef, PcbHoleWithPolygonPad } from "circuit-json"
import type { FootprintPad } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext, Point } from "../../../types"
import { getCustomPadCopperOutline } from "./custom-pad-copper-outline"
import { getNextPcbPlatedHoleId } from "./pad-element-ids"
import { getRightAngleTurns, normalizeRotationDegrees } from "./pad-rotation"
import { rotatePoint } from "./process-graphics"

function transformCustomPadPoint(params: {
  ctx: ConverterContext
  point: Point
  padKicadPosition: Point
  primitiveKicadRotationDegrees: number
}): Point {
  const { ctx, point, padKicadPosition, primitiveKicadRotationDegrees } = params
  const rotatedPoint = rotatePoint({
    point,
    ccwRotationDegrees: primitiveKicadRotationDegrees,
  })

  return applyToPoint(ctx.k2cMatPcb!, {
    x: padKicadPosition.x + rotatedPoint.x,
    y: padKicadPosition.y + rotatedPoint.y,
  })
}

export function createCustomPlatedHole(params: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  position: Point
  size: Point
  layers: LayerRef[]
  pcbPortId?: string
  padKicadPosition: Point
  primitiveKicadRotationDegrees: number
}): void {
  const {
    ctx,
    pad,
    componentId,
    position,
    size,
    layers,
    pcbPortId,
    padKicadPosition,
    primitiveKicadRotationDegrees,
  } = params

  const padOutline = getCustomPadCopperOutline({ pad, size }).map((point) => {
    const transformedPoint = transformCustomPadPoint({
      ctx,
      point,
      padKicadPosition,
      primitiveKicadRotationDegrees,
    })

    return {
      x: transformedPoint.x - position.x,
      y: transformedPoint.y - position.y,
    }
  })

  const drillDiameter = pad.drill?.diameter ?? 0.8
  const drillLength = pad.drill?.width ?? drillDiameter
  const drillIsOval = Math.abs(drillLength - drillDiameter) > 1e-9
  const normalizedRotation = normalizeRotationDegrees(pad.at?.angle)
  const rightAngleTurns = getRightAngleTurns(normalizedRotation)

  const platedHole: PcbHoleWithPolygonPad = {
    type: "pcb_plated_hole",
    shape: "hole_with_polygon_pad",
    pcb_component_id: componentId,
    pcb_port_id: pcbPortId,
    pcb_plated_hole_id: getNextPcbPlatedHoleId(ctx),
    x: position.x,
    y: position.y,
    port_hints: [pad.number],
    hole_shape: drillIsOval ? "pill" : "circle",
    hole_offset_x: 0,
    hole_offset_y: 0,
    pad_outline: padOutline,
    layers,
  }

  if (drillIsOval) {
    const rotationSwapsDimensions =
      rightAngleTurns !== null && Math.abs(rightAngleTurns) % 2 === 1

    platedHole.hole_width = rotationSwapsDimensions
      ? drillLength
      : drillDiameter
    platedHole.hole_height = rotationSwapsDimensions
      ? drillDiameter
      : drillLength

    if (rightAngleTurns === null && normalizedRotation !== 0) {
      platedHole.hole_shape = "rotated_pill"
      platedHole.ccw_rotation = normalizedRotation
    }
  } else {
    platedHole.hole_diameter = drillDiameter
  }

  ctx.db.pcb_plated_hole.insert(platedHole)
}
