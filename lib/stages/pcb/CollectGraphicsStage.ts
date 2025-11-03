import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"

/**
 * CollectGraphicsStage processes KiCad graphics elements:
 * - gr_line on Edge.Cuts → pcb_board.outline
 * - gr_text on silk layers → pcb_silkscreen_text
 * - gr_line on silk layers → pcb_silkscreen_path
 */
export class CollectGraphicsStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb) {
      this.finished = true
      return false
    }

    // Process gr_line elements
    const lines = this.ctx.kicadPcb.graphicLines || []
    const lineArray = Array.isArray(lines) ? lines : [lines]

    const edgeCutLines: any[] = []
    const silkLines: any[] = []

    for (const line of lineArray) {
      const layer = line.layer
      const layerNames =
        typeof layer === "string" ? [layer] : layer?.names || []
      const layerStr = layerNames.join(" ")
      if (layerStr.includes("Edge.Cuts")) {
        edgeCutLines.push(line)
      } else if (layerStr.includes("SilkS")) {
        silkLines.push(line)
      }
    }

    // Create board outline from edge cuts
    if (edgeCutLines.length > 0) {
      this.createBoardOutline(edgeCutLines)
    }

    // Create silkscreen paths
    for (const line of silkLines) {
      this.createSilkscreenPath(line)
    }

    // Process gr_text elements
    const texts = this.ctx.kicadPcb.graphicTexts || []
    const textArray = Array.isArray(texts) ? texts : [texts]

    for (const text of textArray) {
      const layer = text.layer
      const layerNames =
        typeof layer === "string" ? [layer] : layer?.names || []
      // Include text from silk, copper, and fab layers
      if (
        layerNames.some(
          (name: string) =>
            name.includes("SilkS") ||
            name.includes(".Cu") ||
            name.includes("Fab"),
        )
      ) {
        this.createSilkscreenText(text)
      }
    }

    this.finished = true
    return false
  }

  private createBoardOutline(lines: any[]) {
    if (!this.ctx.k2cMatPcb) return

    // Convert edge cut lines to outline points
    const points: Array<{ x: number; y: number }> = []

    for (const line of lines) {
      const start = line.start ?? { x: 0, y: 0 }
      const end = line.end ?? { x: 0, y: 0 }

      const startPos = applyToPoint(this.ctx.k2cMatPcb, {
        x: start.x,
        y: start.y,
      })
      const endPos = applyToPoint(this.ctx.k2cMatPcb, { x: end.x, y: end.y })

      // Add points if not duplicate
      const lastPoint = points[points.length - 1]
      if (!lastPoint || !this.pointsEqual(lastPoint, startPos)) {
        points.push(startPos)
      }
      const newLastPoint = points[points.length - 1]
      if (newLastPoint && !this.pointsEqual(newLastPoint, endPos)) {
        points.push(endPos)
      }
    }

    // Remove the last point if it's the same as the first (closed polygon)
    if (points.length > 2) {
      const firstPoint = points[0]
      const lastPoint = points[points.length - 1]
      if (firstPoint && lastPoint && this.pointsEqual(firstPoint, lastPoint)) {
        points.pop()
      }
    }

    // Create pcb_board with outline
    // Check if board already exists
    const existingBoard = this.ctx.db.pcb_board.list()[0]
    if (existingBoard) {
      // Update outline
      existingBoard.outline = points
      existingBoard.width = this.calculateWidth(points)
      existingBoard.height = this.calculateHeight(points)
    } else {
      // Create new board
      this.ctx.db.pcb_board.insert({
        outline: points,
        width: this.calculateWidth(points),
        height: this.calculateHeight(points),
      } as any)
    }
  }

  private createSilkscreenPath(line: any) {
    if (!this.ctx.k2cMatPcb) return

    const start = line.start || { x: 0, y: 0 }
    const end = line.end || { x: 0, y: 0 }

    const startPos = applyToPoint(this.ctx.k2cMatPcb, {
      x: start.x,
      y: start.y,
    })
    const endPos = applyToPoint(this.ctx.k2cMatPcb, { x: end.x, y: end.y })

    const layer = this.mapLayer(line.layer)
    const strokeWidth = line.width || 0.15

    this.ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: "", // Not attached to a specific component
      layer: layer,
      route: [startPos, endPos],
      stroke_width: strokeWidth,
    })
  }

  private createSilkscreenText(text: any) {
    if (!this.ctx.k2cMatPcb) return

    // Get position from either at or _sxPosition (kicadts internal field)
    const at = text.at || text._sxPosition
    const pos = applyToPoint(this.ctx.k2cMatPcb, {
      x: at?.x ?? 0,
      y: at?.y ?? 0,
    })

    const layer = this.mapLayer(text.layer)
    // Access font size from kicadts internal structure (_sxEffects._sxFont._sxSize._height)
    const kicadFontSize =
      text._sxEffects?._sxFont?._sxSize?._height ||
      text.effects?.font?.size?.y ||
      1
    const fontSize = kicadFontSize * 1.5

    this.ctx.db.pcb_silkscreen_text.insert({
      pcb_component_id: "",
      text: text.text || text._text || "",
      anchor_position: pos,
      layer: layer,
      font_size: fontSize,
      font: "tscircuit2024",
    } as any)
  }

  private mapLayer(kicadLayer: any): "top" | "bottom" {
    const layerStr =
      typeof kicadLayer === "string"
        ? kicadLayer
        : kicadLayer?.names?.join(" ") || ""
    if (layerStr.includes("B.") || layerStr.includes("Back")) {
      return "bottom"
    }
    return "top"
  }

  private pointsEqual(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ): boolean {
    const epsilon = 0.001
    return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon
  }

  private calculateWidth(points: Array<{ x: number; y: number }>): number {
    if (points.length === 0) return 0
    const xs = points.map((p) => p.x)
    return Math.max(...xs) - Math.min(...xs)
  }

  private calculateHeight(points: Array<{ x: number; y: number }>): number {
    if (points.length === 0) return 0
    const ys = points.map((p) => p.y)
    return Math.max(...ys) - Math.min(...ys)
  }
}
