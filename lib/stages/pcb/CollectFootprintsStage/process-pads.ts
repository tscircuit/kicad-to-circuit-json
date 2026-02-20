import type { PcbSmtPadCircle, PcbSmtPadRect } from "circuit-json"
import type { Footprint } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import { determineLayerFromLayers } from "./layer-utils"
import { createPcbPort, type PadPortInfo } from "./process-ports"

/**
 * Processes all pads in a footprint and creates Circuit JSON pad elements
 */
export function processPads(
  ctx: ConverterContext,
  footprint: Footprint,
  componentId: string,
  kicadComponentPos: { x: number; y: number },
  componentRotation: number,
) {
  if (!ctx.k2cMatPcb) return

  const pads = footprint.fpPads || []
  const padArray = Array.isArray(pads) ? pads : [pads]

  for (const pad of padArray) {
    processPad({
      ctx,
      pad,
      componentId,
      kicadComponentPos: kicadComponentPos,
      componentRotation: componentRotation,
    })
  }
}

/**
 * Processes a single pad and creates the appropriate Circuit JSON element (SMD, plated hole, or NPTH)
 */
export function processPad({
  ctx,
  pad,
  componentId,
  kicadComponentPos,
  componentRotation,
}: {
  ctx: ConverterContext
  pad: any
  componentId: string
  kicadComponentPos: { x: number; y: number }
  componentRotation: number
}): void {
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
  const rotatedPadX =
    padAt.x * Math.cos(rotationRad) - padAt.y * Math.sin(rotationRad)
  const rotatedPadY =
    padAt.x * Math.sin(rotationRad) + padAt.y * Math.cos(rotationRad)

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
    } else if (typeof pad.size === "object") {
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

  // Create pcb_port for this pad (if it has a pad number)
  const padNumber = pad.number?.toString()
  let pcbPortId: string | undefined
  let sourcePortId: string | undefined
  if (padNumber) {
    const padLayers =
      padType === "smd"
        ? [determineLayerFromLayers(pad.layers || [])]
        : padType === "thru_hole"
          ? ["top", "bottom"]
          : []

    const padPortInfo: PadPortInfo = {
      padNumber,
      padType,
      layers: padLayers,
      position: globalPos,
    }

    pcbPortId = createPcbPort({
      ctx,
      componentId,
      padInfo: padPortInfo,
    })

    if (pcbPortId) {
      sourcePortId = `${componentId}_port_${padNumber}`
    }
  }

  // Determine pad type and create appropriate CJ element
  if (padType === "smd") {
    createSmdPad({
      ctx,
      pad,
      componentId,
      pos: globalPos,
      size,
      shape: padShape,
      pcbPortId,
      sourcePortId,
    })
  } else if (padType === "np_thru_hole") {
    createNpthHole(ctx, pad, componentId, globalPos, drill)
  } else {
    // thru_hole (plated)
    createPlatedHole(
      ctx,
      pad,
      componentId,
      globalPos,
      size,
      drill,
      padShape,
      totalRotation,
      pcbPortId,
      sourcePortId,
    )
  }
}

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
  sourcePortId,
}: {
  ctx: ConverterContext
  pad: any
  componentId: string
  pos: { x: number; y: number }
  size: { x: number; y: number }
  shape: string
  pcbPortId?: string
  sourcePortId?: string
}) {
  const layers = pad.layers || []
  const layer = determineLayerFromLayers(layers)

  if (shape === "custom") {
    // Access primitives from kicadts structure: _sxPrimitives._graphics
    const primitives = pad._sxPrimitives?._graphics || pad.primitives || []
    const primitivesArray = Array.isArray(primitives)
      ? primitives
      : [primitives]

    // Look for gr_poly primitive
    for (const primitive of primitivesArray) {
      if (
        primitive.token === "gr_poly" ||
        primitive.gr_poly ||
        (primitive as any).type === "gr_poly"
      ) {
        const grPoly = primitive.gr_poly || primitive

        const contours = grPoly._contours || grPoly.contours || []
        const contoursArray = Array.isArray(contours) ? contours : [contours]

        // Extract points from the first contour (should be the main polygon)
        const points: Array<{ x: number; y: number }> = []

        for (const contour of contoursArray) {
          const pts = contour.points || contour.pts || []
          const ptsArray = Array.isArray(pts) ? pts : [pts]

          for (const pt of ptsArray) {
            if (pt.x !== undefined && pt.y !== undefined) {
              points.push({ x: pt.x, y: -pt.y })
            }
          }
        }

        if (points.length > 0) {
          // Create polygon SMT pad
          const smtpad: any = {
            type: "pcb_smtpad",
            shape: "polygon",
            pcb_component_id: componentId,
            pcb_port_id: pcbPortId,
            source_port_id: sourcePortId,
            layer: layer,
            port_hints: [pad.number?.toString()],
            points: points.map((pt) => ({
              x: pos.x + pt.x,
              y: pos.y + pt.y,
            })),
          }

          ctx.db.pcb_smtpad.insert(smtpad)

          if (ctx.stats) {
            ctx.stats.pads = (ctx.stats.pads || 0) + 1
          }

          return
        }
      }
    }
  }

  // Handle standard shapes (circle, rect, roundrect)
  const smtpad: any = {
    type: "pcb_smtpad",
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    width: size.x,
    height: size.y,
    layer: layer,
    pcb_port_id: pcbPortId,
    source_port_id: sourcePortId,
    port_hints: [pad.number?.toString()],
  }

  if (shape === "circle") {
    smtpad.shape = "circle"
    ;(smtpad as PcbSmtPadCircle).radius = Math.max(size.x, size.y) / 2
  } else if (shape === "rect" || shape === "roundrect") {
    smtpad.shape = "rect"

    const roundrectRatio = pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
    if (shape === "roundrect" && roundrectRatio !== undefined) {
      // KiCad's roundrect_rratio is the ratio of the corner radius to half the smaller dimension
      // Formula: corner_radius = min(width, height) * roundrect_rratio / 2
      const minDimension = Math.min(size.x, size.y)
      const cornerRadius = (minDimension * roundrectRatio) / 2
      ;(smtpad as PcbSmtPadRect).corner_radius = cornerRadius
    }
  } else {
    // Default to rect for unknown shapes
    ;(smtpad as PcbSmtPadRect).shape = "rect"
  }

  ctx.db.pcb_smtpad.insert(smtpad)

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
  rotation = 0,
  pcbPortId?: string,
  sourcePortId?: string,
) {
  // Extract drill dimensions - drill can be scalar (circular) or x/y (oval)
  const drillX =
    typeof drill === "object"
      ? drill?.x || drill?._width || drill?.diameter || 0.8
      : drill || 0.8
  const drillY =
    typeof drill === "object"
      ? drill?.y || drill?._height || drill?.diameter || drillX
      : drill || 0.8
  const holeDiameter = Math.max(drillX, drillY)

  // Determine drill shape (circular or oval)
  const drillIsOval =
    typeof drill === "object" &&
    drillX !== undefined &&
    drillY !== undefined &&
    drillX !== drillY

  // Apply rotation to dimensions for oval/pill pads
  // Normalize rotation to 0-360 range
  let normalizedRotation = rotation % 360
  if (normalizedRotation < 0) normalizedRotation += 360

  // For 90 or 270 degree rotations, swap width and height
  const shouldSwapDimensions =
    (normalizedRotation >= 45 && normalizedRotation < 135) ||
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
    pcb_port_id: pcbPortId,
    source_port_id: sourcePortId,
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
    platedHole.hole_width = holeDiameter // Circular hole: width = height
    platedHole.hole_height = holeDiameter
    platedHole.outer_width = outerWidth
    platedHole.outer_height = outerHeight
    platedHole.hole_ccw_rotation = pad.at?.angle
    platedHole.layers = ["top", "bottom"]
  } else if (shape === "rect" || shape === "square" || shape === "roundrect") {
    // Rectangular pad with circular hole
    if (drillIsOval) {
      platedHole.shape = "rotated_pill_hole_with_rect_pad"
      platedHole.hole_shape = "rotated_pill"
      platedHole.pad_shape = "rect"
      platedHole.hole_width = drillY
      platedHole.hole_height = drillX
      platedHole.hole_ccw_rotation = pad.at?.angle
      platedHole.rect_ccw_rotation = pad.at?.angle
      // For rotated pill holes, use swapped pad dimensions to match
      // KiCad's rendered orientation in circuit-json.
      platedHole.rect_pad_width = outerWidth
      platedHole.rect_pad_height = outerHeight
    } else {
      platedHole.shape = "circular_hole_with_rect_pad"
      platedHole.hole_shape = "circle"
      platedHole.pad_shape = "rect"
      platedHole.hole_diameter = holeDiameter
      platedHole.rect_ccw_rotation = pad.at?.angle
      platedHole.rect_pad_width = outerWidth
      platedHole.rect_pad_height = outerHeight
    }
    if (shape === "roundrect") {
      const roundrectRatio =
        pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
      if (roundrectRatio !== undefined) {
        const minDimension = Math.min(outerWidth, outerHeight)
        platedHole.rect_border_radius = (minDimension * roundrectRatio) / 2
      }
    }
    platedHole.hole_offset_x = 0
    platedHole.hole_offset_y = 0
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
  drill: any,
) {
  const holeDiameter = drill?.diameter || drill || 1.0

  ctx.db.pcb_hole.insert({
    x: pos.x,
    y: pos.y,
    hole_diameter: holeDiameter,
    hole_shape: "circle",
  } as any)
}
