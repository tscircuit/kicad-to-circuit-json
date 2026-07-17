import type {
  LayerRef,
  PcbHoleCircle,
  PcbHoleCircularWithRectPad,
  PcbHolePillWithRectPad,
  PcbHoleRotatedPillWithRectPad,
  PcbPlatedHoleCircle,
  PcbPlatedHoleOval,
  PcbSmtPadCircle,
  PcbSmtPadPill,
  PcbSmtPadPolygon,
  PcbSmtPadRect,
  PcbSmtPadRotatedPill,
  PcbSmtPadRotatedRect,
} from "circuit-json"
import type { Footprint } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type {
  ConverterContext,
  FootprintPlacement,
  Point,
} from "../../../types"
import {
  getCopperSpanLayerRefsFromLayers,
  getLayerRefsFromLayers,
  getPcbCopperLayerRefs,
} from "../layer-mapping"
import { getSourcePortIdForPad } from "../pad-source-port-id"
import { determineLayerFromLayers } from "./layer-utils"
import { rotatePoint } from "./process-graphics"
import { createPcbPort, type PadPortInfo } from "./process-ports"

const getNextPcbSmtPadId = (ctx: ConverterContext) => {
  const usedIds = new Set(
    ctx.db.pcb_smtpad.list().map((pad) => pad.pcb_smtpad_id),
  )
  let index = usedIds.size
  let candidate = `pcb_smtpad_${index}`
  while (usedIds.has(candidate)) {
    index++
    candidate = `pcb_smtpad_${index}`
  }
  return candidate
}

const getNextPcbPlatedHoleId = (ctx: ConverterContext) => {
  const usedIds = new Set(
    ctx.db.pcb_plated_hole.list().map((hole) => hole.pcb_plated_hole_id),
  )
  let index = usedIds.size
  let candidate = `pcb_plated_hole_${index}`
  while (usedIds.has(candidate)) {
    index++
    candidate = `pcb_plated_hole_${index}`
  }
  return candidate
}

type PolygonContour = Array<{ x: number; y: number }>
type PcbSmtPadPolygonWithContours = PcbSmtPadPolygon & {
  contours?: PolygonContour[]
}

function getCustomPadPolygonRawContours(grPoly: any): any[][] {
  const explicitContours = getRawContourArray(
    grPoly._contours ?? grPoly.contours,
  )
  if (explicitContours.length > 0) return explicitContours

  const rawPoints = getRawPointArray(
    grPoly._sxPts ?? grPoly.points ?? grPoly.pts,
  )
  return rawPoints.length > 0 ? [rawPoints] : []
}

function getRawContourArray(contours: any): any[][] {
  const contourArray = Array.isArray(contours)
    ? contours
    : contours
      ? [contours]
      : []

  return contourArray
    .map(getRawPointArray)
    .filter((points) => points.length > 0)
}

function getRawPointArray(container: any): any[] {
  if (!container) return []
  if (Array.isArray(container)) return container
  if (Array.isArray(container.points)) return container.points
  if (Array.isArray(container.pts)) return container.pts
  if (Array.isArray(container._sxPts)) return container._sxPts
  return []
}

function attachPadPolygonContours(pad: any, contours: PolygonContour[]) {
  Object.defineProperty(pad, "contours", {
    value: contours,
    enumerable: false,
    configurable: true,
  })
}

/**
 * Processes all pads in a footprint and creates Circuit JSON pad elements
 */
export function processPads(params: {
  ctx: ConverterContext
  footprint: Footprint
  componentId: string
  footprintPlacement: FootprintPlacement
  shouldCreatePorts?: boolean
}) {
  const {
    ctx,
    footprint,
    componentId,
    footprintPlacement,
    shouldCreatePorts = true,
  } = params
  if (!ctx.k2cMatPcb) return

  const pads = footprint.fpPads || []
  const padArray = Array.isArray(pads) ? pads : [pads]

  for (const pad of padArray) {
    processPad({
      ctx,
      footprint,
      pad,
      componentId,
      footprintPlacement,
      shouldCreatePorts,
    })
  }
}

/**
 * Processes a single pad and creates the appropriate Circuit JSON element (SMD, plated hole, or NPTH)
 */
export function processPad({
  ctx,
  footprint,
  pad,
  componentId,
  footprintPlacement,
  shouldCreatePorts = true,
}: {
  ctx: ConverterContext
  footprint: Footprint
  pad: any
  componentId: string
  footprintPlacement: FootprintPlacement
  shouldCreatePorts?: boolean
}): void {
  if (!ctx.k2cMatPcb) return

  const padAt = pad.at || { x: 0, y: 0, angle: 0 }
  const padType = pad.padType || pad.type || "thru_hole"
  const padShape = pad.shape || "circle"

  // Get pad position in KiCad global coordinates
  // Pad position is relative to component and needs to be rotated
  // Negate rotation to account for Y-axis flip in coordinate transform
  const rotationRad =
    (-footprintPlacement.componentCcwRotationDegrees * Math.PI) / 180
  const rotatedPadX =
    padAt.x * Math.cos(rotationRad) - padAt.y * Math.sin(rotationRad)
  const rotatedPadY =
    padAt.x * Math.sin(rotationRad) + padAt.y * Math.cos(rotationRad)

  const padKicadPos = {
    x: footprintPlacement.kicadComponentPos.x + rotatedPadX,
    y: footprintPlacement.kicadComponentPos.y + rotatedPadY,
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

  // Custom-pad primitive coordinates are local to the pad. Unlike regular pad
  // shapes, they are emitted as absolute polygon points, so they must include
  // the footprint placement rotation before the KiCad-to-Circuit-JSON Y flip.
  // The pad angle is already expressed in the coordinate convention expected
  // by the primitive conversion below.
  const totalCcwRotationDegrees =
    (padAt.angle || 0) - footprintPlacement.componentCcwRotationDegrees

  // Create pcb_port for this pad (if it has a pad number)
  const padNumber = pad.number?.toString()
  let pcbPortId: string | undefined
  let sourcePortId: string | undefined
  if (padNumber && shouldCreatePorts) {
    sourcePortId = getSourcePortIdForPad({
      componentId,
      footprint,
      pad,
    })
    const padLayers =
      padType === "smd" || padType === "connect"
        ? copperLayers.slice(0, 1)
        : padType === "thru_hole"
          ? copperLayers
          : []

    const padPortInfo: PadPortInfo = {
      padNumber,
      sourcePortId,
      padType,
      layers: padLayers,
      position: globalPos,
    }

    pcbPortId = createPcbPort({
      ctx,
      componentId,
      padInfo: padPortInfo,
    })

    if (!pcbPortId) sourcePortId = undefined
  }

  // Determine pad type and create appropriate CJ element
  // KiCad's "connect" type represents a surface copper contact, commonly used
  // for exposed connector or test contacts, so it maps to an SMT pad in CJ.
  if (padType === "smd" || padType === "connect") {
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
      totalCcwRotationDegrees,
    })
  } else if (padType === "np_thru_hole") {
    createNpthHole({
      ctx,
      componentId,
      pos: globalPos,
      drill,
    })
  } else {
    // thru_hole (plated)
    createPlatedHole({
      ctx,
      pad,
      componentId,
      pos: globalPos,
      size,
      drill,
      padShape,
      layers: copperLayers,
      pcbPortId,
    })
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
  sourcePortId: _sourcePortId,
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

    // Track the bounding box of all primitive copper so we can tell whether the
    // anchor shape adds copper beyond the primitives (and skip it if it doesn't).
    let primMinX = Number.POSITIVE_INFINITY
    let primMinY = Number.POSITIVE_INFINITY
    let primMaxX = Number.NEGATIVE_INFINITY
    let primMaxY = Number.NEGATIVE_INFINITY
    const expandPrimBounds = (x: number, y: number) => {
      if (x < primMinX) primMinX = x
      if (x > primMaxX) primMaxX = x
      if (y < primMinY) primMinY = y
      if (y > primMaxY) primMaxY = y
    }

    // Look for graphics primitives (gr_poly, gr_circle, etc.)
    for (const primitive of primitivesArray) {
      if (primitive.token === "gr_poly") {
        const grPoly = primitive.gr_poly || primitive
        const rawContours = getCustomPadPolygonRawContours(grPoly)

        // Extract points and transform them
        const polygonContours: PolygonContour[] = []

        for (const rawContour of rawContours) {
          const contourPoints: PolygonContour = []

          for (const pt of rawContour) {
            // Handle various point formats ({x,y}, {xy:{x,y}}, SxClass with x,y)
            const x = pt.x ?? pt.xy?.x
            const y = pt.y ?? pt.xy?.y
            if (x !== undefined && y !== undefined) {
              const rotated = rotatePoint({
                point: { x, y },
                ccwRotationDegrees: totalCcwRotationDegrees,
              })
              const kicadPos = {
                x: padKicadPos.x + rotated.x,
                y: padKicadPos.y + rotated.y,
              }
              const globalPt = applyToPoint(ctx.k2cMatPcb!, kicadPos)
              contourPoints.push(globalPt)
              expandPrimBounds(globalPt.x, globalPt.y)
            }
          }

          if (contourPoints.length > 0) {
            polygonContours.push(contourPoints)
          }
        }

        const points = polygonContours.flat()

        if (points.length > 0) {
          // Create polygon SMT pad
          const smtpad: PcbSmtPadPolygonWithContours = {
            type: "pcb_smtpad",
            shape: "polygon",
            pcb_component_id: componentId,
            pcb_port_id: pcbPortId,
            pcb_smtpad_id: getNextPcbSmtPadId(ctx),
            layer: layer,
            port_hints: [pad.number.toString()],
            points: points,
          } as PcbSmtPadPolygonWithContours

          const insertedPad = ctx.db.pcb_smtpad.insert(smtpad)
          if (polygonContours.length > 1) {
            attachPadPolygonContours(insertedPad, polygonContours)
          }
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

        const rotatedCenter = rotatePoint({
          point: center,
          ccwRotationDegrees: totalCcwRotationDegrees,
        })
        const kicadCenterPos = {
          x: padKicadPos.x + rotatedCenter.x,
          y: padKicadPos.y + rotatedCenter.y,
        }
        const globalCenter = applyToPoint(ctx.k2cMatPcb!, kicadCenterPos)
        expandPrimBounds(globalCenter.x - radius, globalCenter.y - radius)
        expandPrimBounds(globalCenter.x + radius, globalCenter.y + radius)

        const smtpad: PcbSmtPadCircle = {
          type: "pcb_smtpad",
          shape: "circle",
          pcb_component_id: componentId,
          pcb_port_id: pcbPortId,
          pcb_smtpad_id: getNextPcbSmtPadId(ctx),
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

    // A KiCad custom pad's copper is the union of its anchor shape (the
    // rect/circle at the pad's at + size) and its primitive graphics. The
    // converter emits the primitives but used to drop the anchor, which loses
    // real copper when the anchor reaches past the primitives -- e.g. the
    // SOT-89 collector-tab neck that extends toward the leads.
    //
    // Only emit the anchor when it actually adds copper: skip KiCad's near-zero
    // placeholder anchors (size ~0.001), and skip anchors that sit within the
    // primitives' footprint (those would just be an overlapping duplicate pad).
    const anchorShape = pad.options?.anchor ?? "rect"
    const anchorCcwRotation = normalizeRotationDegrees(pad.at?.angle)
    const anchorIsPlaceholder = size.x < 0.01 || size.y < 0.01

    let anchorExtendsBeyondPrimitives = true
    if (primitivesProcessed > 0 && primMinX !== Number.POSITIVE_INFINITY) {
      const halfX = size.x / 2
      const halfY = size.y / 2
      let anchorMinX = Number.POSITIVE_INFINITY
      let anchorMinY = Number.POSITIVE_INFINITY
      let anchorMaxX = Number.NEGATIVE_INFINITY
      let anchorMaxY = Number.NEGATIVE_INFINITY
      const anchorCorners: Array<[number, number]> = [
        [-halfX, -halfY],
        [halfX, -halfY],
        [halfX, halfY],
        [-halfX, halfY],
      ]
      for (const [dx, dy] of anchorCorners) {
        const rotated = rotatePoint({
          point: { x: dx, y: dy },
          ccwRotationDegrees: totalCcwRotationDegrees,
        })
        const corner = applyToPoint(ctx.k2cMatPcb!, {
          x: padKicadPos.x + rotated.x,
          y: padKicadPos.y + rotated.y,
        })
        if (corner.x < anchorMinX) anchorMinX = corner.x
        if (corner.x > anchorMaxX) anchorMaxX = corner.x
        if (corner.y < anchorMinY) anchorMinY = corner.y
        if (corner.y > anchorMaxY) anchorMaxY = corner.y
      }
      const tolerance = 0.01
      anchorExtendsBeyondPrimitives =
        anchorMinX < primMinX - tolerance ||
        anchorMaxX > primMaxX + tolerance ||
        anchorMinY < primMinY - tolerance ||
        anchorMaxY > primMaxY + tolerance
    }

    let anchorEmitted = 0

    if (!anchorIsPlaceholder && anchorExtendsBeyondPrimitives) {
      if (anchorShape === "circle") {
        ctx.db.pcb_smtpad.insert({
          type: "pcb_smtpad",
          shape: "circle",
          pcb_component_id: componentId,
          pcb_port_id: pcbPortId,
          pcb_smtpad_id: getNextPcbSmtPadId(ctx),
          layer,
          port_hints: [pad.number.toString()],
          x: pos.x,
          y: pos.y,
          width: size.x,
          height: size.y,
          radius: Math.max(size.x, size.y) / 2,
        } as PcbSmtPadCircle)
      } else if (anchorCcwRotation !== 0) {
        ctx.db.pcb_smtpad.insert({
          type: "pcb_smtpad",
          shape: "rotated_rect",
          pcb_component_id: componentId,
          pcb_port_id: pcbPortId,
          pcb_smtpad_id: getNextPcbSmtPadId(ctx),
          layer,
          port_hints: [pad.number.toString()],
          x: pos.x,
          y: pos.y,
          width: size.x,
          height: size.y,
          ccw_rotation: anchorCcwRotation,
        } as PcbSmtPadRotatedRect)
      } else {
        ctx.db.pcb_smtpad.insert({
          type: "pcb_smtpad",
          shape: "rect",
          pcb_component_id: componentId,
          pcb_port_id: pcbPortId,
          pcb_smtpad_id: getNextPcbSmtPadId(ctx),
          layer,
          port_hints: [pad.number.toString()],
          x: pos.x,
          y: pos.y,
          width: size.x,
          height: size.y,
        } as PcbSmtPadRect)
      }
      anchorEmitted = 1
    }

    if (ctx.stats) {
      ctx.stats.pads =
        (ctx.stats.pads || 0) + primitivesProcessed + anchorEmitted
    }
    // Custom pads are fully handled here (anchor + primitives).
    return
  }

  // Handle standard shapes (circle, oval, rect, roundrect)
  const ccwRotationDegrees = pad.at?.angle

  if (shape === "circle") {
    const smtpad: PcbSmtPadCircle = {
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      pcb_smtpad_id: getNextPcbSmtPadId(ctx),
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
  } else if (shape === "oval") {
    const normalizedCcwRotation = normalizeRotationDegrees(ccwRotationDegrees)
    const rightAngleTurns = getRightAngleTurns(normalizedCcwRotation)
    const radius = Math.min(size.x, size.y) / 2

    if (rightAngleTurns === null && normalizedCcwRotation !== 0) {
      const rotatedSmtPad: PcbSmtPadRotatedPill = {
        type: "pcb_smtpad",
        pcb_component_id: componentId,
        x: pos.x,
        y: pos.y,
        width: size.x,
        height: size.y,
        radius,
        layer: layer,
        pcb_port_id: pcbPortId,
        port_hints: [pad.number.toString()],
        shape: "rotated_pill",
        ccw_rotation: normalizedCcwRotation,
      } as PcbSmtPadRotatedPill
      ctx.db.pcb_smtpad.insert(rotatedSmtPad)
      return
    }

    const shouldSwapDimensions =
      rightAngleTurns !== null && Math.abs(rightAngleTurns) % 2 === 1

    const smtpad: PcbSmtPadPill = {
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      x: pos.x,
      y: pos.y,
      width: shouldSwapDimensions ? size.y : size.x,
      height: shouldSwapDimensions ? size.x : size.y,
      radius,
      layer: layer,
      pcb_port_id: pcbPortId,
      port_hints: [pad.number.toString()],
      shape: "pill",
    } as PcbSmtPadPill

    ctx.db.pcb_smtpad.insert(smtpad)
  } else if (shape === "rect" || shape === "roundrect") {
    const roundrectRatio = pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
    let cornerRadius: number | undefined
    if (shape === "roundrect" && roundrectRatio !== undefined) {
      // KiCad's roundrect_rratio is the ratio of the corner radius to half the smaller dimension
      const minDimension = Math.min(size.x, size.y)
      cornerRadius = (minDimension * roundrectRatio) / 2
    }

    const normalizedCcwRotation = normalizeRotationDegrees(ccwRotationDegrees)
    const rightAngleTurns = getRightAngleTurns(normalizedCcwRotation)

    if (rightAngleTurns === null && normalizedCcwRotation !== 0) {
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
        ccw_rotation: normalizedCcwRotation,
        corner_radius: cornerRadius,
      } as PcbSmtPadRotatedRect
      ctx.db.pcb_smtpad.insert(rotatedsmtpad)
      return
    }

    const shouldSwapDimensions =
      rightAngleTurns !== null && Math.abs(rightAngleTurns) % 2 === 1

    const smtpad: PcbSmtPadRect = {
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      x: pos.x,
      y: pos.y,
      width: shouldSwapDimensions ? size.y : size.x,
      height: shouldSwapDimensions ? size.x : size.y,
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

function normalizeRotationDegrees(rotationDegrees: number | undefined): number {
  if (!rotationDegrees) return 0

  const normalized = rotationDegrees % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function getRightAngleTurns(rotationDegrees: number): number | null {
  const quarterTurns = rotationDegrees / 90

  if (Math.abs(quarterTurns - Math.round(quarterTurns)) > 1e-9) {
    return null
  }

  return Math.round(quarterTurns)
}

/**
 * Creates a plated hole (through-hole pad) in Circuit JSON
 */
export function createPlatedHole(params: {
  ctx: ConverterContext
  pad: any
  componentId: string
  pos: Point
  size: Point
  drill: any
  padShape: string
  layers: LayerRef[]
  pcbPortId?: string
}) {
  const {
    ctx,
    pad,
    componentId,
    pos,
    size,
    drill,
    padShape,
    layers,
    pcbPortId,
  } = params
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

  const outerWidth = size.x
  const outerHeight = size.y

  // Build plated hole object based on shape
  if (padShape === "circle") {
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
      layers,
    } as PcbPlatedHoleCircle
    ctx.db.pcb_plated_hole.insert(platedHole)
  } else if (padShape === "oval") {
    // Oval/pill-shaped pad with pill hole
    const platedHole: PcbPlatedHoleOval = {
      type: "pcb_plated_hole",
      shape: "pill",
      pcb_component_id: componentId,
      pcb_port_id: pcbPortId,
      x: pos.x,
      y: pos.y,
      port_hints: [pad.number?.toString()],
      hole_width: drillY,
      hole_height: drillX,
      outer_width: outerWidth,
      outer_height: outerHeight,
      ccw_rotation: pad.at?.angle || 0,
      layers,
    } as PcbPlatedHoleOval
    ctx.db.pcb_plated_hole.insert(platedHole)
  } else if (
    padShape === "rect" ||
    padShape === "square" ||
    padShape === "roundrect"
  ) {
    // Rectangular pad with pill hole
    const normalizedCcwRotationDegrees = normalizeRotationDegrees(pad.at?.angle)
    if (drillIsOval) {
      if (normalizedCcwRotationDegrees === 0) {
        const platedHole: PcbHolePillWithRectPad = {
          type: "pcb_plated_hole",
          shape: "pill_hole_with_rect_pad",
          pcb_component_id: componentId,
          pcb_port_id: pcbPortId,
          x: pos.x,
          y: pos.y,
          port_hints: [pad.number?.toString()],
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
        if (padShape === "roundrect") {
          const roundrectRatio =
            pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
          if (roundrectRatio !== undefined) {
            const minDimension = Math.min(outerWidth, outerHeight)
            platedHole.rect_border_radius = (minDimension * roundrectRatio) / 2
          }
        }
        ctx.db.pcb_plated_hole.insert(platedHole)
      } else {
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
          hole_ccw_rotation: normalizedCcwRotationDegrees,
          rect_ccw_rotation: normalizedCcwRotationDegrees,
          rect_pad_width: outerWidth,
          rect_pad_height: outerHeight,
          hole_offset_x: 0,
          hole_offset_y: 0,
          layers,
        } as PcbHoleRotatedPillWithRectPad
        if (padShape === "roundrect") {
          const roundrectRatio =
            pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
          if (roundrectRatio !== undefined) {
            const minDimension = Math.min(outerWidth, outerHeight)
            platedHole.rect_border_radius = (minDimension * roundrectRatio) / 2
          }
        }
        ctx.db.pcb_plated_hole.insert(platedHole)
      }
    } else {
      const platedHole: PcbHoleCircularWithRectPad = {
        type: "pcb_plated_hole",
        shape: "circular_hole_with_rect_pad",
        pcb_component_id: componentId,
        pcb_port_id: pcbPortId,
        pcb_plated_hole_id: getNextPcbPlatedHoleId(ctx),
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
        layers,
      } as PcbHoleCircularWithRectPad
      if (padShape === "roundrect") {
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
export function createNpthHole(params: {
  ctx: ConverterContext
  componentId: string
  pos: Point
  drill: any
}) {
  const { ctx, componentId, pos, drill } = params
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
