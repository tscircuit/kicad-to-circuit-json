import { ConverterStage } from "../../types"
import type { LayerRef } from "circuit-json"
import {
  PtsArc,
  Xy,
  type Zone,
  type ZoneFilledPolygon,
  type ZonePolygon,
} from "kicadts"
import { applyToPoint } from "transformation-matrix"
import { approximateArcPoints } from "./arc-utils"
import {
  getLayerRefsFromLayers,
  mapKicadLayerToLayerRef,
} from "./layer-mapping"

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
      // No valid polygon found, skip this zone
      if (this.ctx.warnings) {
        this.ctx.warnings.push(
          `Zone on layer ${this.getZoneLayerLabel(zone)} has no valid polygon points`,
        )
      }
      return
    }

    // Get net info
    const netNum = typeof zone.net === "number" ? zone.net : 0
    const netName = this.ctx.netNumToName!.get(netNum) || zone.netName || ""

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
      return [mapKicadLayerToLayerRef(polygon.layer)]
    }

    return this.getZoneLayers(zone)
  }

  private getZoneLayers(zone: Zone): LayerRef[] {
    if (zone.layer) {
      return [mapKicadLayerToLayerRef(zone.layer)]
    }

    if (zone.layers) {
      const layers = getLayerRefsFromLayers(zone.layers, this.ctx.kicadPcb)
      if (layers.length > 0) {
        return layers
      }
    }

    return []
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
        points.push(...approximateArcPoints(point.start, point.mid, point.end))
      }
    }

    return points
  }
}
