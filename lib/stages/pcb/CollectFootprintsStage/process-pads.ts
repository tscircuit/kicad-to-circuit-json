import type { Footprint } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import { determinePadLayer } from "./layer-utils"

/**
 * Processes all pads in a footprint and creates Circuit JSON pad elements
 */
export function processPads(
  ctx: ConverterContext,
  footprint: Footprint,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number
) {
  if (!ctx.k2cMatPcb) return

  const pads = footprint.fpPads || []
  const padArray = Array.isArray(pads) ? pads : [pads]

  for (const pad of padArray) {
    processPad(ctx, pad, componentId, kicadComponentPos, componentRotation)
  }
}

/**
 * Processes a single pad and creates the appropriate Circuit JSON element (SMD, plated hole, or NPTH)
 */
export function processPad(
  ctx: ConverterContext,
  pad: any,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number
) {
  if (!ctx.k2cMatPcb) return

  const padAt = pad.at || { x: 0, y: 0, a: 0 }
  const padType = pad.type || "thru_hole"
  const padShape = pad.shape || "circle"

  // Get pad position in KiCad global coordinates
  // Pad position is relative to component and needs to be rotated
  const rotationRad = (componentRotation * Math.PI) / 180
  const rotatedPadX = padAt.x * Math.cos(rotationRad) - padAt.y * Math.sin(rotationRad)
  const rotatedPadY = padAt.x * Math.sin(rotationRad) + padAt.y * Math.cos(rotationRad)

  const padKicadPos = {
    x: kicadComponentPos.x + rotatedPadX,
    y: kicadComponentPos.y + rotatedPadY,
  }

  // Transform from KiCad to Circuit JSON coordinates
  const globalPos = applyToPoint(ctx.k2cMatPcb, padKicadPos)

  // Get pad size
  const size = pad.size || { x: 1, y: 1 }
  const drill = pad.drill

  // Determine pad type and create appropriate CJ element
  if (padType === "smd") {
    createSmdPad(ctx, pad, componentId, globalPos, size, padShape)
  } else if (padType === "np_thru_hole") {
    createNpthHole(ctx, pad, componentId, globalPos, drill)
  } else {
    // thru_hole (plated)
    createPlatedHole(ctx, pad, componentId, globalPos, size, drill, padShape)
  }
}

/**
 * Creates an SMD pad in Circuit JSON
 */
export function createSmdPad(
  ctx: ConverterContext,
  pad: any,
  componentId: string,
  pos: { x: number; y: number },
  size: { x: number; y: number },
  shape: string
) {
  const layers = pad.layers || []
  const layer = determinePadLayer(layers)

  ctx.db.pcb_smtpad.insert({
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    layer: layer,
    shape: shape === "circle" ? "circle" : "rect",
    width: size.x,
    height: size.y,
    port_hints: [pad.number?.toString()],
  } as any)

  if (ctx.stats) {
    ctx.stats.pads = (ctx.stats.pads || 0) + 1
  }
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
  shape: string
) {
  // Determine hole shape - map to CJ plated hole shapes
  let holeShape: "circle" | "pill" | "oval" | "circular_hole_with_rect_pad" | "pill_hole_with_rect_pad" | "rotated_pill_hole_with_rect_pad" = "circle"
  if (shape === "oval") {
    holeShape = "pill"
  } else if (shape === "rect" || shape === "square") {
    holeShape = "circular_hole_with_rect_pad"
  }

  const holeDiameter = drill?.diameter || drill || 0.8

  ctx.db.pcb_plated_hole.insert({
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    hole_diameter: holeDiameter,
    shape: holeShape,
    port_hints: [pad.number?.toString()],
  } as any)

  if (ctx.stats) {
    ctx.stats.pads = (ctx.stats.pads || 0) + 1
  }
}

/**
 * Creates an NPTH (non-plated through-hole) in Circuit JSON
 */
export function createNpthHole(
  ctx: ConverterContext,
  pad: any,
  componentId: string,
  pos: { x: number; y: number },
  drill: any
) {
  const holeDiameter = drill?.diameter || drill || 1.0

  ctx.db.pcb_hole.insert({
    x: pos.x,
    y: pos.y,
    hole_diameter: holeDiameter,
    hole_shape: "circle",
  } as any)
}
