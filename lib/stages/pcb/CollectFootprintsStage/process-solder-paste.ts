import type { PcbSolderPaste, PcbSmtPad } from "circuit-json"
import type { Footprint, FootprintPad } from "kicadts"
import type { ConverterContext, Point } from "../../../types"
import { extractKicadLayerNames } from "../layer-mapping"
import { getNextPcbSolderPasteId } from "./pad-element-ids"
import { getRightAngleTurns, normalizeRotationDegrees } from "./pad-rotation"

/**
 * Position is a board-world point in right-handed mm (+X right, +Y up, +Z above).
 * Rotation is the pad's CCW board angle, after KiCad's downward Y is converted.
 */
export function processSolderPaste({
  ctx,
  footprint,
  pad,
  componentId,
  position,
  hasCopper,
  pcbSmtPadId,
}: {
  ctx: ConverterContext
  footprint: Footprint
  pad: FootprintPad
  componentId: string
  position: Point
  hasCopper: boolean
  pcbSmtPadId?: PcbSmtPad["pcb_smtpad_id"]
}): void {
  const layers = extractKicadLayerNames(pad.layers)
  const pasteLayers = (["F.Paste", "B.Paste"] as const).filter(
    (layer) => layers.includes(layer) || layers.includes("*.Paste"),
  )
  if (pasteLayers.length === 0) return
  if (!["circle", "rect", "oval", "roundrect"].includes(pad.shape)) return
  if (
    pad.shape === "roundrect" &&
    pad.chamferRatio &&
    pad.chamferCorners?.length
  )
    return

  const size = pad.size
  if (!size) return
  const margin = hasCopper
    ? (pad.solderPasteMargin ?? footprint.solderPasteMargin?.value ?? 0)
    : 0
  const ratio = hasCopper
    ? (pad.solderPasteMarginRatio ??
      footprint.solderPasteMarginRatio?.value ??
      footprint.solderPasteRatio?.value ??
      0)
    : 0
  const marginX = margin + size.width * ratio
  const marginY = margin + size.height * ratio
  let width = Math.max(0, size.width + 2 * marginX)
  let height = Math.max(0, size.height + 2 * marginY)
  if (width === 0 || height === 0) return

  const rotation = normalizeRotationDegrees(pad.at?.angle)
  const quarterTurns = getRightAngleTurns(rotation)
  const radius =
    pad.shape === "oval"
      ? Math.min(width, height) / 2
      : Math.max(
          0,
          Math.min(
            Math.min(size.width, size.height) * (pad.roundrectRatio ?? 0) +
              Math.min(marginX, marginY),
            width / 2,
            height / 2,
          ),
        )
  if (quarterTurns !== null && quarterTurns % 2 !== 0) {
    ;[width, height] = [height, width]
  }

  for (const pasteLayer of pasteLayers) {
    const base = {
      type: "pcb_solder_paste" as const,
      pcb_solder_paste_id: getNextPcbSolderPasteId(ctx),
      pcb_component_id: componentId,
      pcb_smtpad_id: pcbSmtPadId,
      x: position.x,
      y: position.y,
      layer: pasteLayer === "F.Paste" ? ("top" as const) : ("bottom" as const),
    }
    let aperture: PcbSolderPaste
    if (pad.shape === "circle") {
      aperture = {
        ...base,
        shape: "circle",
        radius: width / 2,
      }
    } else if (pad.shape === "oval" || pad.shape === "roundrect") {
      if (quarterTurns === null) {
        aperture = {
          ...base,
          shape: "rotated_pill",
          width,
          height,
          radius,
          ccw_rotation: rotation,
        }
      } else {
        aperture = {
          ...base,
          shape: "pill",
          width,
          height,
          radius,
        }
      }
    } else if (quarterTurns === null) {
      aperture = {
        ...base,
        shape: "rotated_rect",
        width,
        height,
        ccw_rotation: rotation,
      }
    } else {
      aperture = { ...base, shape: "rect", width, height }
    }
    ctx.db.pcb_solder_paste.insert(aperture)
  }
}
