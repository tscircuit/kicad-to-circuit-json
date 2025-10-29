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

  const padAt = pad.at || { x: 0, y: 0, angle: 0 }
  const padType = pad.padType || pad.type || "thru_hole"
  const padShape = pad.shape || "circle"

  // Get pad's local rotation angle
  // kicadts stores rotation in the 'angle' property
  const padRotation = padAt.angle || 0

  // Get pad position in KiCad global coordinates
  // Pad position is relative to component and needs to be rotated
  // Negate rotation to account for Y-axis flip in coordinate transform
  const rotationRad = (-componentRotation * Math.PI) / 180
  const rotatedPadX = padAt.x * Math.cos(rotationRad) - padAt.y * Math.sin(rotationRad)
  const rotatedPadY = padAt.x * Math.sin(rotationRad) + padAt.y * Math.cos(rotationRad)

  const padKicadPos = {
    x: kicadComponentPos.x + rotatedPadX,
    y: kicadComponentPos.y + rotatedPadY,
  }

  // Transform from KiCad to Circuit JSON coordinates
  const globalPos = applyToPoint(ctx.k2cMatPcb, padKicadPos)

  // Get pad size - handle various formats
  let sizeX = 1
  let sizeY = 1
  if (pad.size) {
    if (Array.isArray(pad.size)) {
      // Array format: [width, height]
      sizeX = pad.size[0] || 1
      sizeY = pad.size[1] || 1
    } else if (typeof pad.size === 'object') {
      // kicadts returns a Size object with _width and _height properties
      sizeX = (pad.size as any)._width || pad.size.x || 1
      sizeY = (pad.size as any)._height || pad.size.y || 1
    }
  }

  const size = { x: sizeX, y: sizeY }
  const drill = pad.drill

  // Calculate total rotation (component + pad local rotation)
  // In KiCad, rotation is CCW, and we need to account for Y-flip in CJ transform
  const totalRotation = -componentRotation - padRotation

  // Determine pad type and create appropriate CJ element
  if (padType === "smd") {
    createSmdPad(ctx, pad, componentId, globalPos, size, padShape)
  } else if (padType === "np_thru_hole") {
    createNpthHole(ctx, pad, componentId, globalPos, drill)
  } else {
    // thru_hole (plated)
    createPlatedHole(ctx, pad, componentId, globalPos, size, drill, padShape, totalRotation)
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
  shape: string,
  rotation: number = 0
) {
  // Extract drill diameter - can be a number or object with diameter property
  const holeDiameter = typeof drill === 'object' ? (drill?.diameter || drill?.x || 0.8) : (drill || 0.8)

  // Determine hole shape - map KiCad pad shapes to CJ plated hole shapes
  let holeShape: "circle" | "pill" | "oval" | "circular_hole_with_rect_pad" | "pill_hole_with_rect_pad" | "rotated_pill_hole_with_rect_pad" = "circle"

  // Determine drill shape (circular or oval)
  const drillIsOval = typeof drill === 'object' && drill.x !== undefined && drill.y !== undefined && drill.x !== drill.y

  // Apply rotation to dimensions for oval/pill pads
  // Normalize rotation to 0-360 range
  let normalizedRotation = rotation % 360
  if (normalizedRotation < 0) normalizedRotation += 360

  // For 90 or 270 degree rotations, swap width and height
  const shouldSwapDimensions = (normalizedRotation >= 45 && normalizedRotation < 135) ||
                                (normalizedRotation >= 225 && normalizedRotation < 315)

  let outerWidth = size.x
  let outerHeight = size.y

  if (shouldSwapDimensions && shape === "oval") {
    // Swap dimensions for rotated oval pads
    outerWidth = size.y
    outerHeight = size.x
  }

  // Build plated hole object based on shape
  const platedHole: any = {
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    port_hints: [pad.number?.toString()],
  }

  if (shape === "circle") {
    // Circular pad with circular hole
    platedHole.shape = "circle"
    platedHole.hole_diameter = holeDiameter
    platedHole.outer_diameter = Math.max(outerWidth, outerHeight)
    platedHole.layers = ["top", "bottom"]
  } else if (shape === "oval") {
    // Oval/pill-shaped pad with circular hole
    platedHole.shape = "pill"
    platedHole.hole_width = holeDiameter   // Circular hole: width = height
    platedHole.hole_height = holeDiameter
    platedHole.outer_width = outerWidth
    platedHole.outer_height = outerHeight
    platedHole.layers = ["top", "bottom"]
  } else if (shape === "rect" || shape === "square") {
    // Rectangular pad with circular hole
    platedHole.shape = "pill_hole_with_rect_pad"
    platedHole.hole_shape = "circle"
    platedHole.pad_shape = "rect"
    platedHole.hole_width = holeDiameter
    platedHole.hole_height = holeDiameter
    platedHole.rect_pad_width = outerWidth
    platedHole.rect_pad_height = outerHeight
    platedHole.layers = ["top", "bottom"]
  }

  ctx.db.pcb_plated_hole.insert(platedHole)

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
