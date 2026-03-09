import type {
  PcbSmtPadCircle,
  PcbSmtPadRect,
  PcbSmtPadPolygon,
  PcbPlatedHoleCircle,
  PcbPlatedHoleOval,
  PcbHoleCircularWithRectPad,
  PcbHoleRotatedPillWithRectPad,
  PcbHoleCircle,
  PcbSmtPadRotatedRect,
} from "circuit-json"
import type { Footprint } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import { determineLayerFromLayers } from "./layer-utils"
import { rotatePoint } from "./process-graphics"
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
      sizeX = pad.size._width || pad.size.x || 1
      sizeY = pad.size._height || pad.size.y || 1
    }
  }

  const size = { x: sizeX, y: sizeY }
  const drill = pad.drill

  // Calculate total rotation
  const totalCcwRotationDegrees = padAt.angle || 0

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
      padKicadPos,
      totalCcwRotationDegrees,
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
      totalCcwRotationDegrees,
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
  padKicadPos,
  totalCcwRotationDegrees = 0,
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
  totalCcwRotationDegrees?: number
}) {
  const layers = pad.layers || []
  const layer = determineLayerFromLayers(layers)

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
            const rotated = rotatePoint(x, y, totalCcwRotationDegrees)
            const kicadPos = {
              x: padKicadPos.x + rotated.x,
              y: padKicadPos.y + rotated.y,
            }
            points.push(applyToPoint(ctx.k2cMatPcb!, kicadPos))
          }
        }

        if (points.length > 0) {
          // Create polygon SMT pad
          const smtpad: PcbSmtPadPolygon = {
            type: "pcb_smtpad",
            shape: "polygon",
            pcb_component_id: componentId,
            pcb_port_id: pcbPortId,
            pcb_smtpad_id: "pcb_smtpad_id",
            layer: layer,
            port_hints: [pad.number.toString()],
            points: points,
          } as PcbSmtPadPolygon

          ctx.db.pcb_smtpad.insert(smtpad)
          primitivesProcessed++
        }
      }

      if (primitive.token === "gr_circle") {
        const grCircle = primitive.gr_circle || primitive
        const center = grCircle.center || { x: 0, y: 0 }
        const end = grCircle.end || { x: 0, y: 0 }
        const radius = Math.sqrt(
          (end.x - center.x) ** 2 + (end.y - center.y) ** 2,
        )

        const rotatedCenter = rotatePoint(
          center.x,
          center.y,
          totalCcwRotationDegrees,
        )
        const kicadCenterPos = {
          x: padKicadPos.x + rotatedCenter.x,
          y: padKicadPos.y + rotatedCenter.y,
        }
        const globalCenter = applyToPoint(ctx.k2cMatPcb!, kicadCenterPos)

        const smtpad: PcbSmtPadCircle = {
          type: "pcb_smtpad",
          shape: "circle",
          pcb_component_id: componentId,
          pcb_port_id: pcbPortId,
          pcb_smtpad_id: "pcb_smtpad_id",
          layer: layer,
          port_hints: [pad.number.toString()],
          x: globalCenter.x,
          y: globalCenter.y,
          width: radius * 2,
          height: radius * 2,
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

  // Handle standard shapes (circle, rect, roundrect)
  const baseSmtPad = {
    type: "pcb_smtpad",
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    width: size.x,
    height: size.y,
    layer: layer,
    pcb_port_id: pcbPortId,
    port_hints: [pad.number?.toString()],
  }
  const ccwRotationDegrees = pad.at?.angle

  if (shape === "circle") {
    const smtpad: PcbSmtPadCircle = {
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      pcb_smtpad_id: "pcb_smtpad_id",
      x: pos.x,
      y: pos.y,
      width: size.x,
      height: size.y,
      layer: layer,
      pcb_port_id: pcbPortId,
      port_hints: [pad.number?.toString()],
      shape: "circle",
      radius: Math.max(size.x, size.y) / 2,
    } as PcbSmtPadCircle
    ctx.db.pcb_smtpad.insert(smtpad)
  } else if (shape === "rect" || shape === "roundrect") {
    const roundrectRatio = pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
    let cornerRadius: number | undefined
    if (shape === "roundrect" && roundrectRatio !== undefined) {
      // KiCad's roundrect_rratio is the ratio of the corner radius to half the smaller dimension
      const minDimension = Math.min(size.x, size.y)
      cornerRadius = (minDimension * roundrectRatio) / 2
    }

    if (ccwRotationDegrees) {
      const rotatedsmtpad: PcbSmtPadRotatedRect = {
        type: "pcb_smtpad",
        pcb_component_id: componentId,
        x: pos.x,
        y: pos.y,
        width: size.x,
        height: size.y,
        layer: layer,
        pcb_port_id: pcbPortId,
        port_hints: [pad.number.toString()],
        shape: "rotated_rect",
        ccw_rotation: ccwRotationDegrees,
        corner_radius: cornerRadius,
      } as PcbSmtPadRotatedRect
      ctx.db.pcb_smtpad.insert(rotatedsmtpad)
      return
    }
    const smtpad: PcbSmtPadRect = {
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      x: pos.x,
      y: pos.y,
      width: size.x,
      height: size.y,
      layer: layer,
      pcb_port_id: pcbPortId,
      port_hints: [pad.number.toString()],
      shape: "rect",
      corner_radius: cornerRadius,
    } as PcbSmtPadRect

    ctx.db.pcb_smtpad.insert(smtpad)
  } else {
    // Default to rect for unknown shapes
    ctx.db.pcb_smtpad.insert({
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      x: pos.x,
      y: pos.y,
      width: size.x,
      height: size.y,
      layer: layer,
      pcb_port_id: pcbPortId,
      port_hints: [pad.number?.toString()],
      shape: "rect",
    } as PcbSmtPadRect)
  }

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

  let outerWidth = size.x
  let outerHeight = size.y

  // Build plated hole object based on shape
  if (shape === "circle") {
    // Circular pad with circular hole
    const platedHole: PcbPlatedHoleCircle = {
      type: "pcb_plated_hole",
      shape: "circle",
      pcb_component_id: componentId,
      pcb_port_id: pcbPortId,
      x: pos.x,
      y: pos.y,
      port_hints: [pad.number?.toString()],
      hole_diameter: holeDiameter,
      outer_diameter: Math.max(outerWidth, outerHeight),
      layers: ["top", "bottom"],
    } as PcbPlatedHoleCircle
    ctx.db.pcb_plated_hole.insert(platedHole)
  } else if (shape === "oval") {
    // Oval/pill-shaped pad with circular hole
    const platedHole: PcbPlatedHoleOval = {
      type: "pcb_plated_hole",
      shape: "pill",
      pcb_component_id: componentId,
      pcb_port_id: pcbPortId,
      x: pos.x,
      y: pos.y,
      port_hints: [pad.number?.toString()],
      hole_width: holeDiameter, // Circular hole: width = height
      hole_height: holeDiameter,
      outer_width: outerWidth,
      outer_height: outerHeight,
      ccw_rotation: pad.at?.angle || 0,
      layers: ["top", "bottom"],
    } as PcbPlatedHoleOval
    ctx.db.pcb_plated_hole.insert(platedHole)
  } else if (shape === "rect" || shape === "square" || shape === "roundrect") {
    // Rectangular pad with circular hole
    if (drillIsOval) {
      const platedHole: PcbHoleRotatedPillWithRectPad = {
        type: "pcb_plated_hole",
        shape: "rotated_pill_hole_with_rect_pad",
        pcb_component_id: componentId,
        pcb_port_id: pcbPortId,
        x: pos.x,
        y: pos.y,
        port_hints: [pad.number?.toString()],
        hole_shape: "rotated_pill",
        pad_shape: "rect",
        hole_width: drillY,
        hole_height: drillX,
        hole_ccw_rotation: pad.at?.angle || 0,
        rect_ccw_rotation: pad.at?.angle || 0,
        rect_pad_width: outerWidth,
        rect_pad_height: outerHeight,
        hole_offset_x: 0,
        hole_offset_y: 0,
        layers: ["top", "bottom"],
      } as PcbHoleRotatedPillWithRectPad
      if (shape === "roundrect") {
        const roundrectRatio =
          pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
        if (roundrectRatio !== undefined) {
          const minDimension = Math.min(outerWidth, outerHeight)
          platedHole.rect_border_radius = (minDimension * roundrectRatio) / 2
        }
      }
      ctx.db.pcb_plated_hole.insert(platedHole)
    } else {
      const platedHole: PcbHoleCircularWithRectPad = {
        type: "pcb_plated_hole",
        shape: "circular_hole_with_rect_pad",
        pcb_component_id: componentId,
        pcb_port_id: pcbPortId,
        pcb_plated_hole_id: "pcb_plated_hole_id",
        x: pos.x,
        y: pos.y,
        port_hints: [pad.number?.toString()],
        hole_shape: "circle",
        pad_shape: "rect",
        hole_diameter: holeDiameter,
        rect_ccw_rotation: pad.at?.angle || 0,
        rect_pad_width: outerWidth,
        rect_pad_height: outerHeight,
        hole_offset_x: 0,
        hole_offset_y: 0,
        layers: ["top", "bottom"],
      } as PcbHoleCircularWithRectPad
      if (shape === "roundrect") {
        const roundrectRatio =
          pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
        if (roundrectRatio !== undefined) {
          const minDimension = Math.min(outerWidth, outerHeight)
          platedHole.rect_border_radius = (minDimension * roundrectRatio) / 2
        }
      }
      ctx.db.pcb_plated_hole.insert(platedHole)
    }
  }

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

  const hole: PcbHoleCircle = {
    type: "pcb_hole",
    hole_shape: "circle",
    pcb_component_id: componentId,
    x: pos.x,
    y: pos.y,
    hole_diameter: holeDiameter,
  } as PcbHoleCircle

  ctx.db.pcb_hole.insert(hole)
}
