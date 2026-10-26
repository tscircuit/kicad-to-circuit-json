import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../types"
import { getSchematicPaperSize } from "./getSchematicPaperSize"

/** Render document fields using KiCad's default drawing-sheet text positions. */
export function emitSchematicTitleBlock(ctx: ConverterContext) {
  const { kicadSch, k2cMatSch, schematicSheetId } = ctx
  const titleBlock = kicadSch?.titleBlock
  if (!titleBlock || !k2cMatSch || !schematicSheetId) return

  const { width, height } = getSchematicPaperSize(kicadSch.paper)
  const color = "rgb(132, 0, 0)"
  const unitScale = Math.abs(k2cMatSch.a)

  // The default worksheet has 10 mm margins; offsets are measured inward
  // from its bottom-right corner, as in pagelayout_default.kicad_wks.
  const fromBottomRight = (x: number, y: number) =>
    applyToPoint(k2cMatSch, { x: width - 10 - x, y: height - 10 - y })
  const insertText = (
    value: string | undefined,
    offsetX: number,
    offsetY: number,
    prefix = "",
    fontSize = 1.5,
  ) => {
    if (!value) return
    ctx.db.schematic_text.insert({
      text: `${prefix}${value}`,
      position: fromBottomRight(offsetX, offsetY),
      font_size: fontSize * unitScale,
      rotation: 0,
      anchor: "bottom_left",
      color,
      schematic_sheet_id: schematicSheetId,
    })
  }

  insertText(titleBlock.title, 109, 10.7, "Title: ", 2)
  insertText(titleBlock.date, 87, 6.9, "Date: ")
  insertText(titleBlock.rev, 24, 6.9, "Rev: ")
  insertText(titleBlock.company, 109, 20)
  for (const comment of titleBlock.comments) {
    insertText(comment.value, 109, 20 + comment.index * 3)
  }

  const topOffset = Math.max(
    34,
    ...titleBlock.comments
      .filter((comment) => comment.value)
      .map((comment) => 22 + comment.index * 3),
  )
  const topLeft = fromBottomRight(110, topOffset)
  const bottomRight = fromBottomRight(2, 2)
  ctx.db.schematic_rect.insert({
    center: {
      x: (topLeft.x + bottomRight.x) / 2,
      y: (topLeft.y + bottomRight.y) / 2,
    },
    width: 108 * unitScale,
    height: (topOffset - 2) * unitScale,
    rotation: 0,
    stroke_width: 0.15 * unitScale,
    color,
    is_filled: false,
    is_dashed: false,
    schematic_sheet_id: schematicSheetId,
  })
  const insertLine = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.db.schematic_line.insert({
      x1: fromBottomRight(x1, y1).x,
      y1: fromBottomRight(x1, y1).y,
      x2: fromBottomRight(x2, y2).x,
      y2: fromBottomRight(x2, y2).y,
      stroke_width: 0.15 * unitScale,
      color,
      is_dashed: false,
      schematic_sheet_id: schematicSheetId,
    })
  }
  for (const y of [5.5, 8.5, 12.5, 18.5]) insertLine(110, y, 2, y)
  insertLine(90, 8.5, 90, 5.5)
  insertLine(26, 8.5, 26, 2)
}
