import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"

/**
 * CollectZonesStage converts KiCad zones with filled copper into Circuit JSON pcb_copper_pour elements.
 * Zones define copper pours/planes that are typically used for ground and power nets.
 */
export class CollectZonesStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    const zones = this.ctx.kicadPcb.zones || []
    const zoneArray = Array.isArray(zones) ? zones : [zones]

    // Process each filled zone
    for (const zone of zoneArray) {
      // Only process zones that are filled
      if (this.isZoneFilled(zone)) {
        this.createCopperPourFromZone(zone)
      }
    }

    this.finished = true
    return false
  }

  private isZoneFilled(zone: any): boolean {
    // kicadts stores data in _rawChildren array
    if (!zone._rawChildren || !Array.isArray(zone._rawChildren)) {
      return false
    }

    // Look for fill entry: ["fill", "yes", ...]
    const fillEntry = zone._rawChildren.find(
      (child: any) => Array.isArray(child) && child[0] === "fill",
    )

    if (fillEntry && fillEntry[1] === "yes") {
      return true
    }

    // Also check if there are filled_polygon entries
    const hasFilledPolygons = zone._rawChildren.some(
      (child: any) => Array.isArray(child) && child[0] === "filled_polygon",
    )

    return hasFilledPolygons
  }

  private createCopperPourFromZone(zone: any) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToName) return

    if (!zone._rawChildren || !Array.isArray(zone._rawChildren)) {
      return
    }

    // Parse zone data from _rawChildren
    const zoneData = this.parseZoneData(zone._rawChildren)

    // Get the filled polygons (there can be multiple filled regions)
    const filledPolygons = this.extractFilledPolygons(zone._rawChildren)

    if (filledPolygons.length === 0) {
      // Try to use the main polygon outline if no filled polygons exist
      const mainPolygon = this.extractMainPolygon(zone._rawChildren)
      if (mainPolygon.length > 0) {
        filledPolygons.push(mainPolygon)
      }
    }

    if (filledPolygons.length === 0) {
      // No valid polygon found, skip this zone
      if (this.ctx.warnings) {
        this.ctx.warnings.push(
          `Zone on layer ${zoneData.layer || "unknown"} has no valid polygon points`,
        )
      }
      return
    }

    // Get layer info
    const layer = this.mapLayer(zoneData.layer)

    // Get net info
    const netNum = zoneData.net || 0
    const netName = this.ctx.netNumToName!.get(netNum) || zoneData.netName || ""

    // Create a copper pour for each filled polygon
    for (const polygonPoints of filledPolygons) {
      // Transform coordinates from KiCad to Circuit JSON
      const transformedPoints = polygonPoints.map((point) =>
        applyToPoint(this.ctx.k2cMatPcb!, { x: point.x, y: point.y }),
      )

      // Create pcb_copper_pour
      this.ctx.db.pcb_copper_pour.insert({
        layer: layer,
        net_name: netName,
        points: transformedPoints,
        shape: "polygon",
      } as any)

      // Update stats if available
      if (this.ctx.stats) {
        this.ctx.stats.copper_pours = (this.ctx.stats.copper_pours || 0) + 1
      }
    }
  }

  private parseZoneData(children: any[]): {
    net?: number
    netName?: string
    layer?: string
  } {
    const data: { net?: number; netName?: string; layer?: string } = {}

    for (const child of children) {
      if (!Array.isArray(child)) continue

      switch (child[0]) {
        case "net":
          data.net = child[1]
          break
        case "net_name":
          data.netName = child[1]
          break
        case "layer":
          data.layer = child[1]
          break
      }
    }

    return data
  }

  private extractMainPolygon(children: any[]): Array<{ x: number; y: number }> {
    // Find the polygon entry: ["polygon", ["pts", ["xy", x, y], ["xy", x, y], ...]]
    const polygonEntry = children.find(
      (child: any) => Array.isArray(child) && child[0] === "polygon",
    )

    if (!polygonEntry) return []

    return this.extractPointsFromPolygonEntry(polygonEntry)
  }

  private extractFilledPolygons(
    children: any[],
  ): Array<Array<{ x: number; y: number }>> {
    // Find all filled_polygon entries
    const filledPolygonEntries = children.filter(
      (child: any) => Array.isArray(child) && child[0] === "filled_polygon",
    )

    const polygons: Array<Array<{ x: number; y: number }>> = []

    for (const entry of filledPolygonEntries) {
      const points = this.extractPointsFromPolygonEntry(entry)
      if (points.length > 0) {
        polygons.push(points)
      }
    }

    return polygons
  }

  private extractPointsFromPolygonEntry(
    polygonEntry: any[],
  ): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = []

    // Look for pts entry: ["pts", ["xy", x, y], ["xy", x, y], ...]
    const ptsEntry = polygonEntry.find(
      (child: any) => Array.isArray(child) && child[0] === "pts",
    )

    if (!ptsEntry) return []

    // Extract xy points from pts entry
    for (let i = 1; i < ptsEntry.length; i++) {
      const item = ptsEntry[i]
      if (Array.isArray(item) && item[0] === "xy" && item.length >= 3) {
        const x = item[1]
        const y = item[2]
        if (typeof x === "number" && typeof y === "number") {
          points.push({ x, y })
        }
      }
    }

    return points
  }

  private mapLayer(kicadLayer: any): "top" | "bottom" {
    const layerStr =
      typeof kicadLayer === "string"
        ? kicadLayer
        : kicadLayer?.names?.join(" ") || kicadLayer?.name || ""

    if (
      layerStr.includes("B.Cu") ||
      layerStr.includes("Back") ||
      layerStr.includes("Bottom")
    ) {
      return "bottom"
    }
    return "top"
  }
}
