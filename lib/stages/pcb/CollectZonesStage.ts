import type { LayerRef } from "circuit-json"
import {
  PtsArc,
  Xy,
  type Zone,
  type ZoneFilledPolygon,
  type ZonePolygon,
} from "kicadts"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import { approximateArcPoints } from "./arc-utils"
import { extractKicadLayerNames, getLayerRefsFromLayers } from "./layer-mapping"
import { getKicadNetKey } from "./net-utils"

type KicadPoint = { x: number; y: number }
type ZonePolygonRecord = {
  layer: LayerRef
  points: KicadPoint[]
}

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

  private isZoneFilled(zone: Zone): boolean {
    return zone.fill?.filled === true || zone.filledPolygons.length > 0
  }

  private createCopperPourFromZone(zone: Zone) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToName) return

    const polygonRecords = this.getZonePolygonRecords(zone)
    if (polygonRecords.length === 0) {
      // A zone on a technical layer, such as a solder mask opening on
      // F.Mask, has no copper. Any other zone here has no usable polygon.
      const reason = this.isZoneOnCopper(zone)
        ? "has no valid polygon points"
        : "is not on a copper layer and was not imported as a copper pour"
      this.ctx.warnings?.push(
        `Zone on layer ${this.getZoneLayerLabel(zone)} ${reason}`,
      )
      return
    }

    // Get net info
    const netKey = getKicadNetKey(zone)
    let netName = zone.netName || ""
    if (netKey !== null) {
      netName = this.ctx.netNumToName!.get(netKey) || netName
    }

    // Create a copper pour for each filled polygon
    for (const polygonRecord of polygonRecords) {
      // Transform coordinates from KiCad to Circuit JSON
      const transformedPoints = polygonRecord.points.map((point) =>
        applyToPoint(this.ctx.k2cMatPcb!, { x: point.x, y: point.y }),
      )

      // Create pcb_copper_pour
      this.ctx.db.pcb_copper_pour.insert({
        layer: polygonRecord.layer,
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

  private getZonePolygonRecords(zone: Zone): ZonePolygonRecord[] {
    const filledPolygonRecords = zone.filledPolygons.flatMap((filledPolygon) =>
      this.createZonePolygonRecordsFromShape(
        filledPolygon,
        this.getPolygonLayers(zone, filledPolygon),
      ),
    )
    if (filledPolygonRecords.length > 0) {
      return filledPolygonRecords
    }

    return zone.polygons.flatMap((polygon) =>
      this.createZonePolygonRecordsFromShape(polygon, this.getZoneLayers(zone)),
    )
  }

  private createZonePolygonRecordsFromShape(
    polygon: ZoneFilledPolygon | ZonePolygon,
    layers: LayerRef[],
  ): ZonePolygonRecord[] {
    const points = this.extractPointsFromPts(polygon.pts?.points ?? [])
    if (points.length < 3 || layers.length === 0) {
      return []
    }

    return layers.map((layer) => ({
      layer,
      points,
    }))
  }

  private getPolygonLayers(zone: Zone, polygon: ZoneFilledPolygon): LayerRef[] {
    if (polygon.layer) {
      return this.getCopperLayerRefs(polygon.layer)
    }

    return this.getZoneLayers(zone)
  }

  private getZoneLayers(zone: Zone): LayerRef[] {
    return this.getCopperLayerRefs(zone.layer ?? zone.layers)
  }

  private isZoneOnCopper(zone: Zone): boolean {
    const layerSources = [
      zone.layer,
      zone.layers,
      ...zone.filledPolygons.map((filledPolygon) => filledPolygon.layer),
    ]
    return layerSources.some(
      (layerSource) => this.getCopperLayerRefs(layerSource).length > 0,
    )
  }

  /**
   * The copper layers that the KiCad layers of a zone or of its fill name.
   * "*.Cu" is every copper layer of the board and the legacy "F&B.Cu" is
   * both outer layers; a technical layer such as F.Mask is none.
   */
  private getCopperLayerRefs(layer: unknown): LayerRef[] {
    const layerNames = extractKicadLayerNames(layer).flatMap((layerName) =>
      layerName === "F&B.Cu" ? ["F.Cu", "B.Cu"] : [layerName],
    )
    return getLayerRefsFromLayers(layerNames, this.ctx.kicadPcb)
  }

  private getZoneLayerLabel(zone: Zone): string {
    return (
      [...(zone.layer?.names ?? []), ...(zone.layers?.names ?? [])].join(" ") ||
      "unknown"
    )
  }

  private extractPointsFromPts(pointsData: Array<Xy | PtsArc>): KicadPoint[] {
    const points: KicadPoint[] = []

    for (const point of pointsData) {
      if (point instanceof Xy) {
        points.push({ x: point.x, y: point.y })
        continue
      }

      if (point instanceof PtsArc && point.start && point.mid && point.end) {
        points.push(
          ...approximateArcPoints({
            start: point.start,
            mid: point.mid,
            end: point.end,
          }),
        )
      }
    }

    return points
  }
}
