import type { PcbSmtPad, PcbSolderPaste } from "circuit-json"
import type { Footprint, FootprintPad } from "kicadts"
import type { ConverterContext, Point } from "../../../types"
import {
  extractKicadLayerNames,
  mapKicadLayerToVisibleLayer,
} from "../layer-mapping"
import { getPadShape } from "./get-pad-shape"
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
  let margin = 0
  let ratio = 0
  if (hasCopper) {
    margin = pad.solderPasteMargin ?? footprint.solderPasteMargin?.value ?? 0
    ratio =
      pad.solderPasteMarginRatio ??
      footprint.solderPasteMarginRatio?.value ??
      footprint.solderPasteRatio?.value ??
      0
  }
  const marginX = margin + size.width * ratio
  const marginY = margin + size.height * ratio
  const width = Math.max(0, size.width + 2 * marginX)
  const height = Math.max(0, size.height + 2 * marginY)
  if (width === 0 || height === 0) return

  let radius: number | undefined
  if (pad.shape === "oval") {
    radius = Math.min(width, height) / 2
  } else if (pad.shape === "roundrect") {
    radius = Math.max(
      0,
      Math.min(
        Math.min(size.width, size.height) * (pad.roundrectRatio ?? 0) +
          Math.min(marginX, marginY),
        width / 2,
        height / 2,
      ),
    )
  }

  for (const pasteLayer of pasteLayers) {
    const base = {
      type: "pcb_solder_paste" as const,
      pcb_solder_paste_id: getNextPcbSolderPasteId(ctx),
      pcb_component_id: componentId,
      pcb_smtpad_id: pcbSmtPadId,
      x: position.x,
      y: position.y,
      layer: mapKicadLayerToVisibleLayer(pasteLayer),
    }
    let aperture: PcbSolderPaste
    if (pad.shape === "circle") {
      const turns = getRightAngleTurns(normalizeRotationDegrees(pad.at?.angle))
      let diameter = width
      if (turns !== null && turns % 2 !== 0) diameter = height
      aperture = {
        ...base,
        shape: "circle",
        radius: diameter / 2,
      }
    } else {
      aperture = {
        ...base,
        ...getPadShape({
          shape: radius === undefined ? "rect" : "pill",
          width,
          height,
          radius,
          ccwRotationDegrees: pad.at?.angle,
        }),
      }
    }
    ctx.db.pcb_solder_paste.insert(aperture)
  }
}
