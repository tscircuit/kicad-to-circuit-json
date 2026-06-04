import type {
  LayerRef,
  PcbHoleCircle,
  PcbHoleCircularWithRectPad,
  PcbHolePillWithRectPad,
  PcbHoleRotatedPillWithRectPad,
  PcbPlatedHoleCircle,
  PcbPlatedHoleOval,
} from "circuit-json"
import type { FootprintPad, PadDrill } from "kicadts"
import type { ConverterContext } from "../../../types"
import {
  getPadRoundRectRadius,
  normalizeRotationDegrees,
  type Point,
  type Size,
} from "./pad-utils"

export function createPlatedHole({
  ctx,
  pad,
  componentId,
  globalPadPosition,
  size,
  drill,
  shape,
  layers,
  pcbPortId,
}: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  globalPadPosition: Point
  size: Size
  drill: PadDrill | undefined
  shape: string
  layers: LayerRef[]
  pcbPortId?: string
}) {
  const { drillX, drillY, holeDiameter, drillIsOval } = getDrillGeometry(drill)
  const outerWidth = size.x
  const outerHeight = size.y
  const portHints = [pad.number?.toString()]

  if (shape === "circle") {
    ctx.db.pcb_plated_hole.insert({
      type: "pcb_plated_hole",
      shape: "circle",
      pcb_component_id: componentId,
      pcb_port_id: pcbPortId,
      x: globalPadPosition.x,
      y: globalPadPosition.y,
      port_hints: portHints,
      hole_diameter: holeDiameter,
      outer_diameter: Math.max(outerWidth, outerHeight),
      layers,
    } as PcbPlatedHoleCircle)
  } else if (shape === "oval") {
    ctx.db.pcb_plated_hole.insert({
      type: "pcb_plated_hole",
      shape: "pill",
      pcb_component_id: componentId,
      pcb_port_id: pcbPortId,
      x: globalPadPosition.x,
      y: globalPadPosition.y,
      port_hints: portHints,
      hole_width: drillY,
      hole_height: drillX,
      outer_width: outerWidth,
      outer_height: outerHeight,
      ccw_rotation: pad.at?.angle || 0,
      layers,
    } as PcbPlatedHoleOval)
  } else if (shape === "rect" || shape === "square" || shape === "roundrect") {
    createRectangularPlatedHole({
      ctx,
      pad,
      componentId,
      globalPadPosition,
      shape,
      drillIsOval,
      drillX,
      drillY,
      holeDiameter,
      outerWidth,
      outerHeight,
      layers,
      pcbPortId,
      portHints,
    })
  }

  if (ctx.stats) {
    ctx.stats.pads = (ctx.stats.pads || 0) + 1
  }
}

function getDrillGeometry(drill: PadDrill | undefined) {
  const drillX = drill?.width || drill?.diameter || 0.8
  const drillY = drill?.diameter || drillX

  return {
    drillX,
    drillY,
    holeDiameter: Math.max(drillX, drillY),
    drillIsOval: Boolean(drill?.oval && drillX !== drillY),
  }
}

function createRectangularPlatedHole({
  ctx,
  pad,
  componentId,
  globalPadPosition,
  shape,
  drillIsOval,
  drillX,
  drillY,
  holeDiameter,
  outerWidth,
  outerHeight,
  layers,
  pcbPortId,
  portHints,
}: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  globalPadPosition: Point
  shape: string
  drillIsOval: boolean
  drillX: number
  drillY: number
  holeDiameter: number
  outerWidth: number
  outerHeight: number
  layers: LayerRef[]
  pcbPortId?: string
  portHints: string[]
}) {
  const normalizedCcwRotationDegrees = normalizeRotationDegrees(pad.at?.angle)
  const rectBorderRadius =
    shape === "roundrect"
      ? getPadRoundRectRadius(pad, { x: outerWidth, y: outerHeight })
      : undefined

  if (drillIsOval) {
    if (normalizedCcwRotationDegrees === 0) {
      const platedHole: PcbHolePillWithRectPad = {
        type: "pcb_plated_hole",
        shape: "pill_hole_with_rect_pad",
        pcb_component_id: componentId,
        pcb_port_id: pcbPortId,
        x: globalPadPosition.x,
        y: globalPadPosition.y,
        port_hints: portHints,
        hole_shape: "pill",
        pad_shape: "rect",
        hole_width: drillY,
        hole_height: drillX,
        rect_pad_width: outerWidth,
        rect_pad_height: outerHeight,
        hole_offset_x: 0,
        hole_offset_y: 0,
        layers,
      } as PcbHolePillWithRectPad
      platedHole.rect_border_radius = rectBorderRadius
      ctx.db.pcb_plated_hole.insert(platedHole)
      return
    }

    const platedHole: PcbHoleRotatedPillWithRectPad = {
      type: "pcb_plated_hole",
      shape: "rotated_pill_hole_with_rect_pad",
      pcb_component_id: componentId,
      pcb_port_id: pcbPortId,
      x: globalPadPosition.x,
      y: globalPadPosition.y,
      port_hints: portHints,
      hole_shape: "rotated_pill",
      pad_shape: "rect",
      hole_width: drillY,
      hole_height: drillX,
      hole_ccw_rotation: normalizedCcwRotationDegrees,
      rect_ccw_rotation: normalizedCcwRotationDegrees,
      rect_pad_width: outerWidth,
      rect_pad_height: outerHeight,
      hole_offset_x: 0,
      hole_offset_y: 0,
      layers,
    } as PcbHoleRotatedPillWithRectPad
    platedHole.rect_border_radius = rectBorderRadius
    ctx.db.pcb_plated_hole.insert(platedHole)
    return
  }

  const platedHole: PcbHoleCircularWithRectPad = {
    type: "pcb_plated_hole",
    shape: "circular_hole_with_rect_pad",
    pcb_component_id: componentId,
    pcb_port_id: pcbPortId,
    pcb_plated_hole_id: "pcb_plated_hole_id",
    x: globalPadPosition.x,
    y: globalPadPosition.y,
    port_hints: portHints,
    hole_shape: "circle",
    pad_shape: "rect",
    hole_diameter: holeDiameter,
    rect_ccw_rotation: pad.at?.angle || 0,
    rect_pad_width: outerWidth,
    rect_pad_height: outerHeight,
    hole_offset_x: 0,
    hole_offset_y: 0,
    layers,
  } as PcbHoleCircularWithRectPad
  platedHole.rect_border_radius = rectBorderRadius
  ctx.db.pcb_plated_hole.insert(platedHole)
}

export function createNpthHole({
  ctx,
  componentId,
  pos,
  drill,
}: {
  ctx: ConverterContext
  componentId: string
  pos: Point
  drill: PadDrill | undefined
}) {
  const holeDiameter = drill?.diameter || 1.0

  ctx.db.pcb_hole.insert({
    type: "pcb_hole",
    hole_shape: "circle",
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    hole_diameter: holeDiameter,
  } as PcbHoleCircle)
}
