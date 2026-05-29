import type { PcbHoleCircle } from "circuit-json"
import type { Footprint } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import {
  getCopperSpanLayerRefsFromLayers,
  getLayerRefsFromLayers,
  getPcbCopperLayerRefs,
} from "../layer-mapping"
import { normalizeRotationDegrees } from "./pad-utils"
import { createPlatedHole } from "./process-plated-hole"
import { createPcbPort, type PadPortInfo } from "./process-ports"
import { createSmdPad } from "./process-smd-pad"

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
  const mappedCopperLayers =
    padType === "thru_hole"
      ? getCopperSpanLayerRefsFromLayers(pad.layers || [], ctx.kicadPcb)
      : getLayerRefsFromLayers(pad.layers || [], ctx.kicadPcb)
  const copperLayers =
    mappedCopperLayers.length > 0
      ? mappedCopperLayers
      : padType === "thru_hole"
        ? getPcbCopperLayerRefs(ctx.kicadPcb)
        : []

  const padRotationDegrees = normalizeRotationDegrees(padAt.angle || 0)

  // Create pcb_port for this pad (if it has a pad number)
  const padNumber = pad.number?.toString()
  let pcbPortId: string | undefined
  let sourcePortId: string | undefined
  if (padNumber) {
    const padLayers =
      padType === "smd"
        ? copperLayers.slice(0, 1)
        : padType === "thru_hole"
          ? copperLayers
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
    if (copperLayers.length === 0) {
      return
    }

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
      padRotationDegrees,
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
      copperLayers,
      padRotationDegrees,
      pcbPortId,
      sourcePortId,
    )
  }
}

/**
 * Creates an NPTH (non-plated through-hole) in Circuit JSON
 */
export function createNpthHole(
  ctx: ConverterContext,
  _pad: any,
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
