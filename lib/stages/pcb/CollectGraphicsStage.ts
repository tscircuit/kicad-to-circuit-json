import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"

/**
 * CollectGraphicsStage processes KiCad graphics elements:
 * - gr_line on Edge.Cuts → pcb_board.outline
 * - gr_text on silk layers → pcb_silkscreen_text
 * - gr_line on silk layers → pcb_silkscreen_path
 * - gr_rect on copper layers (filled) → pcb_smtpad
 * - gr_poly on copper layers (filled) → pcb_smtpad (polygon)
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

    // Process gr_rect elements
    const grRects = this.ctx.kicadPcb.graphicRects || []

    for (const rect of grRects) {
      this.processRectangle(rect)
    }

    // Process gr_poly elements
    const grPolys = this.ctx.kicadPcb.graphicPolys || []
    const polyArray = Array.isArray(grPolys) ? grPolys : [grPolys]

    for (const poly of polyArray) {
      this.processPolygon(poly)
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

    // Convert lines to a format we can work with (in KiCad coordinates)
    const segments = lines.map((line) => ({
      start: line.start ?? { x: 0, y: 0 },
      end: line.end ?? { x: 0, y: 0 },
    }))

    // Chain the segments together to form a continuous outline
    const orderedSegments: typeof segments = []
    const remainingSegments = [...segments]

    // Start with the first segment
    if (remainingSegments.length > 0) {
      orderedSegments.push(remainingSegments.shift()!)

      // Keep finding connected segments until we can't find any more
      while (remainingSegments.length > 0) {
        const lastSegment = orderedSegments[orderedSegments.length - 1]!
        const lastEnd = lastSegment.end

        // Find a segment that starts where the last one ended
        let foundIndex = remainingSegments.findIndex((seg) =>
          this.pointsEqualKicad(seg.start, lastEnd),
        )

        // If not found, try to find one that ends where the last one ended (reverse it)
        if (foundIndex === -1) {
          foundIndex = remainingSegments.findIndex((seg) =>
            this.pointsEqualKicad(seg.end, lastEnd),
          )
          if (foundIndex !== -1) {
            const seg = remainingSegments[foundIndex]!
            // Reverse the segment
            orderedSegments.push({
              start: seg.end,
              end: seg.start,
            })
            remainingSegments.splice(foundIndex, 1)
            continue
          }
        }

        if (foundIndex !== -1) {
          orderedSegments.push(remainingSegments.splice(foundIndex, 1)[0]!)
        } else {
          // Can't find a connected segment, just add the next one
          orderedSegments.push(remainingSegments.shift()!)
        }
      }
    }

    // Now convert the ordered segments to points in Circuit JSON coordinates
    const points: Array<{ x: number; y: number }> = []

    for (const segment of orderedSegments) {
      const startPos = applyToPoint(this.ctx.k2cMatPcb, {
        x: segment.start.x,
        y: segment.start.y,
      })

      // Only add the start point if it's not a duplicate of the last point
      const lastPoint = points[points.length - 1]
      if (!lastPoint || !this.pointsEqual(lastPoint, startPos)) {
        points.push(startPos)
      }
    }

    // Add the last endpoint if needed (for unclosed paths)
    if (orderedSegments.length > 0) {
      const lastSegment = orderedSegments[orderedSegments.length - 1]!
      const endPos = applyToPoint(this.ctx.k2cMatPcb, {
        x: lastSegment.end.x,
        y: lastSegment.end.y,
      })

      // Check if it closes the loop
      const firstPoint = points[0]
      if (firstPoint && !this.pointsEqual(firstPoint, endPos)) {
        points.push(endPos)
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

  private processRectangle(rect: any) {
    if (!this.ctx.k2cMatPcb) return

    // Extract rectangle properties from kicadts internal structure
    const start = {
      x: rect._sxStart?._x ?? 0,
      y: rect._sxStart?._y ?? 0,
    }
    const end = {
      x: rect._sxEnd?._x ?? 0,
      y: rect._sxEnd?._y ?? 0,
    }

    const layerNames = rect._sxLayer?._names || []
    const layerStr = layerNames.join(" ")

    // Check if this is a filled rectangle on a copper layer
    const isFilled =
      rect._sxFill &&
      (rect._sxFill.isFilled === true ||
        String(rect._sxFill).includes("fill yes"))
    const isCopperLayer = layerStr.includes(".Cu")

    // Only create pcb_smtpad for filled rectangles on copper layers
    if (!isFilled || !isCopperLayer) {
      return
    }

    // Calculate center, width, and height in KiCad coordinates
    const centerKicad = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }
    const widthKicad = Math.abs(end.x - start.x)
    const heightKicad = Math.abs(end.y - start.y)

    // Transform center to Circuit JSON coordinates
    const centerCJ = applyToPoint(this.ctx.k2cMatPcb, centerKicad)

    // Map layer to top/bottom
    const layer = this.mapLayer(rect._sxLayer)

    // Create pcb_smtpad
    this.ctx.db.pcb_smtpad.insert({
      pcb_component_id: "", // Not attached to a specific component
      x: centerCJ.x,
      y: centerCJ.y,
      width: widthKicad,
      height: heightKicad,
      layer: layer,
      shape: "rect",
      port_hints: [],
    } as any)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.pads = (this.ctx.stats.pads || 0) + 1
    }
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

  private pointsEqualKicad(
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

  private processPolygon(poly: any) {
    if (!this.ctx.k2cMatPcb) return

    // Extract layer information
    const layerNames = poly._sxLayer?._names || []
    const layerStr = layerNames.join(" ")

    // Check if this is a filled polygon on a copper layer
    const isFilled = poly._sxFill?.filled === true
    const isCopperLayer = layerStr.includes(".Cu")

    // Only create pcb_smtpad for filled polygons on copper layers
    if (!isFilled || !isCopperLayer) {
      return
    }

    // Extract points from the polygon
    const ptsData = poly._sxPts?.points || []
    const points: Array<{ x: number; y: number }> = []

    for (const pt of ptsData) {
      if (pt.token === "xy") {
        // Simple XY point
        points.push({ x: pt.x, y: pt.y })
      } else if (pt.token === "arc") {
        // Arc - convert to multiple points
        // For simplicity, we'll approximate the arc with several line segments
        const arcPoints = this.convertArcToPoints(
          { x: pt._sxStart?._x, y: pt._sxStart?._y },
          { x: pt._sxMid?._x, y: pt._sxMid?._y },
          { x: pt._sxEnd?._x, y: pt._sxEnd?._y },
        )
        points.push(...arcPoints)
      }
    }

    if (points.length < 3) {
      // Need at least 3 points to form a polygon
      return
    }

    // Transform all points to Circuit JSON coordinates
    const transformedPoints = points.map((pt) =>
      applyToPoint(this.ctx.k2cMatPcb!, pt),
    )

    // Map layer to top/bottom
    const layer = this.mapLayer(poly._sxLayer)

    // Create pcb_smtpad with polygon shape
    this.ctx.db.pcb_smtpad.insert({
      pcb_component_id: "", // Not attached to a specific component
      shape: "polygon",
      points: transformedPoints,
      layer: layer,
      port_hints: [],
    } as any)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.pads = (this.ctx.stats.pads || 0) + 1
    }
  }

  /**
   * Converts an arc defined by start, mid, and end points to multiple line segments
   * Uses the three-point arc definition to approximate the curve
   */
  private convertArcToPoints(
    start: { x: number; y: number },
    mid: { x: number; y: number },
    end: { x: number; y: number },
    numSegments = 8,
  ): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = []

    // Calculate the center and radius of the arc using the three points
    const { center, radius } = this.calculateArcCenter(start, mid, end)

    if (!center || radius === 0) {
      // If we can't calculate the arc, just return start and end
      return [start, end]
    }

    // Calculate start and end angles
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
    const midAngle = Math.atan2(mid.y - center.y, mid.x - center.x)

    // Determine if we're going clockwise or counterclockwise
    let angleRange = endAngle - startAngle

    // Check if we need to go the long way around
    const midFromStart = midAngle - startAngle
    const endFromStart = endAngle - startAngle

    // Normalize angles to -π to π range
    const normalizeMid = ((midFromStart + Math.PI) % (2 * Math.PI)) - Math.PI
    const normalizeEnd = ((endFromStart + Math.PI) % (2 * Math.PI)) - Math.PI

    // If mid angle is not between start and end, we need to go the other way
    if (
      (normalizeEnd > 0 && (normalizeMid < 0 || normalizeMid > normalizeEnd)) ||
      (normalizeEnd < 0 && (normalizeMid > 0 || normalizeMid < normalizeEnd))
    ) {
      angleRange = angleRange - Math.sign(angleRange) * 2 * Math.PI
    }

    // Generate points along the arc
    for (let i = 1; i < numSegments; i++) {
      const t = i / numSegments
      const angle = startAngle + angleRange * t
      points.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      })
    }

    points.push(end)

    return points
  }

  /**
   * Calculate the center and radius of a circle passing through three points
   */
  private calculateArcCenter(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
  ): { center: { x: number; y: number } | null; radius: number } {
    const ax = p1.x
    const ay = p1.y
    const bx = p2.x
    const by = p2.y
    const cx = p3.x
    const cy = p3.y

    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))

    if (Math.abs(d) < 1e-10) {
      // Points are collinear
      return { center: null, radius: 0 }
    }

    const ux =
      ((ax * ax + ay * ay) * (by - cy) +
        (bx * bx + by * by) * (cy - ay) +
        (cx * cx + cy * cy) * (ay - by)) /
      d
    const uy =
      ((ax * ax + ay * ay) * (cx - bx) +
        (bx * bx + by * by) * (ax - cx) +
        (cx * cx + cy * cy) * (bx - ax)) /
      d

    const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2)

    return { center: { x: ux, y: uy }, radius }
  }
}
