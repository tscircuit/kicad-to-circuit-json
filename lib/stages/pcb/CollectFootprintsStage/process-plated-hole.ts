import type {
  LayerRef,
  PcbHoleCircularWithRectPad,
  PcbHolePillWithRectPad,
  PcbHoleRotatedPillWithRectPad,
  PcbPlatedHoleCircle,
  PcbPlatedHoleOval,
} from "circuit-json"
import type { ConverterContext } from "../../../types"
import { getDrillDimensions } from "./pad-drill-utils"
import {
  getPortHintsProps,
  getRoundRectCornerRadius,
  normalizeRotationDegrees,
} from "./pad-utils"

interface PlatedHoleBuilderParams {
  pad: any
  componentId: string
  pos: { x: number; y: number }
  padWidth: number
  padHeight: number
  drillWidth: number
  drillHeight: number
  holeDiameter: number
  layers: LayerRef[]
  pcbPortId?: string
}

/**
 * Creates a plated hole (through-hole pad) in Circuit JSON
 */
export function createPlatedHole(
  ctx: ConverterContext,
  pad: any,
  componentId: string,
  pos: { x: number; y: number },
  size: { x: number; y: number },
  drill: any,
  shape: string,
  layers: LayerRef[],
  _rotation = 0,
  pcbPortId?: string,
  _sourcePortId: string | undefined = undefined,
) {
  const drillDimensions = getDrillDimensions(drill)
  const drillWidth = drillDimensions.width
  const drillHeight = drillDimensions.height
  const holeDiameter = Math.max(drillWidth, drillHeight)

  // Determine drill shape (circular or oval)
  const hasOvalDrill = drillDimensions.isOval || drillWidth !== drillHeight

  const padWidth = size.x
  const padHeight = size.y
  const baseBuilderParams = {
    pad,
    componentId,
    pos,
    padWidth,
    padHeight,
    drillWidth,
    drillHeight,
    holeDiameter,
    layers,
    pcbPortId,
  }

  // Build plated hole object based on shape
  if (shape === "circle") {
    ctx.db.pcb_plated_hole.insert(createCircularPlatedHole(baseBuilderParams))
  } else if (shape === "oval") {
    ctx.db.pcb_plated_hole.insert(
      createOvalPlatedHole({
        ...baseBuilderParams,
        rotationDegrees: _rotation,
      }),
    )
  } else if (shape === "rect" || shape === "square" || shape === "roundrect") {
    const normalizedCcwRotationDegrees = normalizeRotationDegrees(pad.at?.angle)
    if (hasOvalDrill) {
      if (normalizedCcwRotationDegrees === 0) {
        ctx.db.pcb_plated_hole.insert(
          createRectPadWithOvalDrill({
            ...baseBuilderParams,
            shape,
          }),
        )
      } else {
        ctx.db.pcb_plated_hole.insert(
          createRectPadWithRotatedOvalDrill({
            ...baseBuilderParams,
            shape,
            rotationDegrees: normalizedCcwRotationDegrees,
          }),
        )
      }
    } else {
      ctx.db.pcb_plated_hole.insert(
        createRectPadWithCircularDrill({
          ...baseBuilderParams,
          shape,
        }),
      )
    }
  }

  if (ctx.stats) {
    ctx.stats.pads = (ctx.stats.pads || 0) + 1
  }
}

function createCircularPlatedHole({
  pad,
  componentId,
  pos,
  padWidth,
  padHeight,
  holeDiameter,
  layers,
  pcbPortId,
}: PlatedHoleBuilderParams): PcbPlatedHoleCircle {
  return {
    type: "pcb_plated_hole",
    shape: "circle",
    pcb_component_id: componentId,
    pcb_port_id: pcbPortId,
    x: pos.x,
    y: pos.y,
    ...getPortHintsProps(pad),
    hole_diameter: holeDiameter,
    outer_diameter: Math.max(padWidth, padHeight),
    layers,
  } as PcbPlatedHoleCircle
}

function createOvalPlatedHole({
  pad,
  componentId,
  pos,
  padWidth,
  padHeight,
  drillWidth,
  drillHeight,
  layers,
  pcbPortId,
  rotationDegrees,
}: PlatedHoleBuilderParams & { rotationDegrees: number }): PcbPlatedHoleOval {
  return {
    type: "pcb_plated_hole",
    shape: "pill",
    pcb_component_id: componentId,
    pcb_port_id: pcbPortId,
    x: pos.x,
    y: pos.y,
    ...getPortHintsProps(pad),
    hole_width: drillWidth,
    hole_height: drillHeight,
    outer_width: padWidth,
    outer_height: padHeight,
    ccw_rotation: normalizeRotationDegrees(rotationDegrees),
    layers,
  } as PcbPlatedHoleOval
}

function createRectPadWithOvalDrill({
  pad,
  componentId,
  pos,
  padWidth,
  padHeight,
  drillWidth,
  drillHeight,
  layers,
  pcbPortId,
  shape,
}: PlatedHoleBuilderParams & { shape: string }): PcbHolePillWithRectPad {
  const platedHole: PcbHolePillWithRectPad = {
    type: "pcb_plated_hole",
    shape: "pill_hole_with_rect_pad",
    pcb_component_id: componentId,
    pcb_port_id: pcbPortId,
    x: pos.x,
    y: pos.y,
    ...getPortHintsProps(pad),
    hole_shape: "pill",
    pad_shape: "rect",
    hole_width: drillWidth,
    hole_height: drillHeight,
    rect_pad_width: padWidth,
    rect_pad_height: padHeight,
    hole_offset_x: 0,
    hole_offset_y: 0,
    layers,
  } as PcbHolePillWithRectPad

  applyRoundRectBorderRadius(platedHole, pad, shape, padWidth, padHeight)
  return platedHole
}

function createRectPadWithRotatedOvalDrill({
  pad,
  componentId,
  pos,
  padWidth,
  padHeight,
  drillWidth,
  drillHeight,
  layers,
  pcbPortId,
  shape,
  rotationDegrees,
}: PlatedHoleBuilderParams & {
  shape: string
  rotationDegrees: number
}): PcbHoleRotatedPillWithRectPad {
  const platedHole: PcbHoleRotatedPillWithRectPad = {
    type: "pcb_plated_hole",
    shape: "rotated_pill_hole_with_rect_pad",
    pcb_component_id: componentId,
    pcb_port_id: pcbPortId,
    x: pos.x,
    y: pos.y,
    ...getPortHintsProps(pad),
    hole_shape: "rotated_pill",
    pad_shape: "rect",
    hole_width: drillWidth,
    hole_height: drillHeight,
    hole_ccw_rotation: rotationDegrees,
    rect_ccw_rotation: rotationDegrees,
    rect_pad_width: padWidth,
    rect_pad_height: padHeight,
    hole_offset_x: 0,
    hole_offset_y: 0,
    layers,
  } as PcbHoleRotatedPillWithRectPad

  applyRoundRectBorderRadius(platedHole, pad, shape, padWidth, padHeight)
  return platedHole
}

function createRectPadWithCircularDrill({
  pad,
  componentId,
  pos,
  padWidth,
  padHeight,
  holeDiameter,
  layers,
  pcbPortId,
  shape,
}: PlatedHoleBuilderParams & { shape: string }): PcbHoleCircularWithRectPad {
  const platedHole: PcbHoleCircularWithRectPad = {
    type: "pcb_plated_hole",
    shape: "circular_hole_with_rect_pad",
    pcb_component_id: componentId,
    pcb_port_id: pcbPortId,
    pcb_plated_hole_id: "pcb_plated_hole_id",
    x: pos.x,
    y: pos.y,
    ...getPortHintsProps(pad),
    hole_shape: "circle",
    pad_shape: "rect",
    hole_diameter: holeDiameter,
    rect_ccw_rotation: pad.at?.angle || 0,
    rect_pad_width: padWidth,
    rect_pad_height: padHeight,
    hole_offset_x: 0,
    hole_offset_y: 0,
    layers,
  } as PcbHoleCircularWithRectPad

  applyRoundRectBorderRadius(platedHole, pad, shape, padWidth, padHeight)
  return platedHole
}

function applyRoundRectBorderRadius(
  platedHole:
    | PcbHolePillWithRectPad
    | PcbHoleRotatedPillWithRectPad
    | PcbHoleCircularWithRectPad,
  pad: any,
  shape: string,
  padWidth: number,
  padHeight: number,
) {
  if (shape !== "roundrect") return

  const rectBorderRadius = getRoundRectCornerRadius(pad, {
    x: padWidth,
    y: padHeight,
  })
  if (rectBorderRadius !== undefined) {
    platedHole.rect_border_radius = rectBorderRadius
  }
}
