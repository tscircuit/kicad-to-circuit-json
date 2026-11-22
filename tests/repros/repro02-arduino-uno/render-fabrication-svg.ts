import { createCanvas, SvgExportFlag } from "@napi-rs/canvas"
import type { CircuitJson } from "circuit-json"
import { CircuitToCanvasDrawer, drawText } from "circuit-to-canvas"

export function renderFabricationSvg(circuitJson: CircuitJson): string {
  const canvas = createCanvas(1000, 800, SvgExportFlag.ConvertTextToPaths)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "black"
  ctx.fillRect(0, 0, 1000, 800)

  const drawer = new CircuitToCanvasDrawer(canvas)
  drawer.setCameraBounds({ minX: -40, maxX: 40, minY: -32, maxY: 32 })
  drawer.drawElements(
    circuitJson.filter(
      (element) =>
        element.type === "pcb_board" ||
        element.type === "pcb_fabrication_note_path" ||
        element.type === "pcb_fabrication_note_rect",
    ),
  )

  for (const text of circuitJson) {
    if (text.type !== "pcb_fabrication_note_text") continue
    // The installed element drawer predates fabrication rotation; drawText supports it.
    drawText({
      ctx,
      text: text.text,
      x: text.anchor_position.x,
      y: text.anchor_position.y,
      fontSize: text.font_size,
      anchorAlignment: text.anchor_alignment,
      rotation: text.ccw_rotation ?? 0,
      mirrorX: text.layer === "bottom",
      color: "#afafaf",
      realToCanvasMat: drawer.realToCanvasMat,
    })
  }

  return canvas.getContent().toString("utf8")
}
