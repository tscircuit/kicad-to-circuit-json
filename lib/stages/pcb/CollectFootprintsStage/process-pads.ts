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
import {
  type Footprint,
  type FootprintPad,
  PadPrimitiveGrCircle,
  PadPrimitiveGrPoly,
} from "kicadts"
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
import { createCustomPlatedHole } from "./create-custom-plated-hole"
import {
  attachPadPolygonContours,
  getCustomPadPolygonContours,
  type PcbSmtPadPolygonWithContours,
  type PolygonContour,
} from "./custom-pad-polygon-contours"
import { getSupportedPadType } from "./get-supported-pad-type"
import { determineLayerFromLayers } from "./layer-utils"
import { orderOverlappingFootprintPads } from "./order-overlapping-footprint-pads"
import { getNextPcbPlatedHoleId, getNextPcbSmtPadId } from "./pad-element-ids"
import { getRightAngleTurns, normalizeRotationDegrees } from "./pad-rotation"
import { rotatePoint } from "./process-graphics"
import { createPcbPort, type PadPortInfo } from "./process-ports"

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

  const padsInConversionOrder = orderOverlappingFootprintPads(
    footprint.fpPads ?? [],
  )

  for (const pad of padsInConversionOrder) {
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
  pad: FootprintPad
  componentId: string
  footprintPlacement: FootprintPlacement
  shouldCreatePorts?: boolean
}): void {
  if (!ctx.k2cMatPcb) return

  const padAt = pad.at || { x: 0, y: 0, angle: 0 }
  const padType = getSupportedPadType(pad)
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

  const size = {
    x: pad.size?.width || 1,
    y: pad.size?.height || 1,
  }
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

  // Pad angles in a .kicad_pcb are absolute board angles even though the pad
  // position is footprint-local. Custom primitive points therefore rotate by
  // the negated absolute pad angle in KiCad space before the PCB Y-axis flip.
  // Combining the angle with the footprint again rotates custom copper twice.
  const customPrimitiveKicadRotationDegrees = -(padAt.angle || 0)

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
      customPrimitiveKicadRotationDegrees,
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
      padKicadPos,
      customPrimitiveKicadRotationDegrees,
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
  customPrimitiveKicadRotationDegrees = 0,
}: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  pos: { x: number; y: number }
  size: { x: number; y: number }
  shape: string
  pcbPortId?: string
  sourcePortId?: string
  padKicadPos: { x: number; y: number }
  customPrimitiveKicadRotationDegrees?: number
}) {
  const layers = pad.layers || []
  const layer = determineLayerFromLayers(layers)

  if (shape === "custom") {
    const primitives = pad.primitives?.graphics ?? []

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
    for (const primitive of primitives) {
      if (primitive instanceof PadPrimitiveGrPoly) {
        const rawContours = getCustomPadPolygonContours(primitive)

        // Extract points and transform them
        const polygonContours: PolygonContour[] = []

        for (const rawContour of rawContours) {
          const contourPoints: PolygonContour = []

          for (const point of rawContour) {
            const rotatedPoint = rotatePoint({
              point,
              ccwRotationDegrees: customPrimitiveKicadRotationDegrees,
            })
            const kicadPosition = {
              x: padKicadPos.x + rotatedPoint.x,
              y: padKicadPos.y + rotatedPoint.y,
            }
            const globalPoint = applyToPoint(ctx.k2cMatPcb!, kicadPosition)
            contourPoints.push(globalPoint)
            expandPrimBounds(globalPoint.x, globalPoint.y)
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
            attachPadPolygonContours(
              insertedPad as PcbSmtPadPolygon,
              polygonContours,
            )
          }
          primitivesProcessed++
        }
      }

      if (primitive instanceof PadPrimitiveGrCircle) {
        const grCircle = primitive
        const center = grCircle.center ?? { x: 0, y: 0 }
        const end = grCircle.end ?? { x: 0, y: 0 }
        const centerlineRadius = Math.sqrt(
          (end.x - center.x) ** 2 + (end.y - center.y) ** 2,
        )
        const strokeWidth = grCircle.width ?? 0
        const radius =
          grCircle.fill === false && strokeWidth > 0
            ? centerlineRadius + strokeWidth / 2
            : centerlineRadius

        const rotatedCenter = rotatePoint({
          point: center,
          ccwRotationDegrees: customPrimitiveKicadRotationDegrees,
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
          ccwRotationDegrees: customPrimitiveKicadRotationDegrees,
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

  // A placed pad's angle already includes the footprint rotation.
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
  } else {
    // Rectangle fallbacks need the same rotation handling as ordinary pads.
    // A zero-delta trapezoid is exactly a rectangle. For a tapered trapezoid,
    // retain its full copper envelope and report the approximation explicitly.
    let rectangleSize = size
    if (shape === "trapezoid") {
      const deltaX = pad.rectDelta?.x ?? 0
      const deltaY = pad.rectDelta?.y ?? 0
      if (deltaX !== 0 || deltaY !== 0) {
        rectangleSize = {
          x: size.x + Math.abs(deltaY),
          y: size.y + Math.abs(deltaX),
        }
        ;(ctx.warnings ??= []).push(
          `Trapezoid pad ${pad.number} on ${componentId} has nonzero rect_delta; using its conservative rotated rectangle envelope`,
        )
      }
    }
    const roundrectRatio = pad.roundrectRatio
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
        width: rectangleSize.x,
        height: rectangleSize.y,
        layer: layer,
        pcb_port_id: pcbPortId,
        port_hints: [pad.number?.toString()],
        shape: "rotated_rect",
        ccw_rotation: normalizedCcwRotation,
        corner_radius: cornerRadius,
      } as PcbSmtPadRotatedRect
      ctx.db.pcb_smtpad.insert(rotatedsmtpad)
      if (ctx.stats) {
        ctx.stats.pads = (ctx.stats.pads || 0) + 1
      }
      return
    }

    const shouldSwapDimensions =
      rightAngleTurns !== null && Math.abs(rightAngleTurns) % 2 === 1

    const smtpad: PcbSmtPadRect = {
      type: "pcb_smtpad",
      pcb_component_id: componentId,
      x: pos.x,
      y: pos.y,
      width: shouldSwapDimensions ? rectangleSize.y : rectangleSize.x,
      height: shouldSwapDimensions ? rectangleSize.x : rectangleSize.y,
      layer: layer,
      pcb_port_id: pcbPortId,
      port_hints: [pad.number?.toString()],
      shape: "rect",
      corner_radius: cornerRadius,
    } as PcbSmtPadRect

    ctx.db.pcb_smtpad.insert(smtpad)
  }

  if (ctx.stats) {
    ctx.stats.pads = (ctx.stats.pads || 0) + 1
  }
}

/**
 * Creates a plated hole (through-hole pad) in Circuit JSON
 */
export function createPlatedHole(params: {
  ctx: ConverterContext
  pad: FootprintPad
  componentId: string
  pos: Point
  size: Point
  drill: FootprintPad["drill"]
  padShape: string
  layers: LayerRef[]
  pcbPortId?: string
  padKicadPos: Point
  customPrimitiveKicadRotationDegrees: number
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
    padKicadPos,
    customPrimitiveKicadRotationDegrees,
  } = params

  if (padShape === "custom") {
    createCustomPlatedHole({
      ctx,
      pad,
      componentId,
      position: pos,
      size,
      layers,
      pcbPortId,
      padKicadPosition: padKicadPos,
      primitiveKicadRotationDegrees: customPrimitiveKicadRotationDegrees,
    })

    if (ctx.stats) ctx.stats.pads = (ctx.stats.pads || 0) + 1
    return
  }

  // Extract drill dimensions - drill can be scalar (circular) or x/y (oval)
  const drillX = drill?.width ?? drill?.diameter ?? 0.8
  const drillY = drill?.diameter ?? drillX
  const holeDiameter = Math.max(drillX, drillY)

  // Determine drill shape (circular or oval)
  const drillIsOval = drill?.oval ?? Math.abs(drillX - drillY) > 1e-9

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
          const roundrectRatio = pad.roundrectRatio
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
          const roundrectRatio = pad.roundrectRatio
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
        const roundrectRatio = pad.roundrectRatio
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
  drill: FootprintPad["drill"]
}) {
  const { ctx, componentId, pos, drill } = params
  const holeDiameter = drill?.diameter ?? 1

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
