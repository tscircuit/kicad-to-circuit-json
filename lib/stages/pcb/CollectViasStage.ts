import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import {
  getCopperSpanLayerRefsFromLayers,
  getPcbCopperLayerRefs,
} from "./layer-mapping"

/**
 * CollectViasStage converts KiCad vias into Circuit JSON pcb_via elements.
 */
export class CollectViasStage extends ConverterStage {
  private readonly POINT_KEY_PRECISION = 1e6

  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    const vias = this.ctx.kicadPcb.vias || []
    const viaArray = Array.isArray(vias) ? vias : [vias]

    for (const via of viaArray) {
      this.processVia(via)
    }

    this.finished = true
    return false
  }

  private processVia(via: any) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToName) return

    const at = via.at || { x: 0, y: 0 }
    const pos = applyToPoint(this.ctx.k2cMatPcb, { x: at.x, y: at.y })

    // Get via dimensions
    const size = via.size || 0.8
    const drill = via.drill || 0.4

    const mappedLayers = via.layers
      ? getCopperSpanLayerRefsFromLayers(via.layers, this.ctx.kicadPcb)
      : []
    const layers =
      mappedLayers.length > 0
        ? mappedLayers
        : getPcbCopperLayerRefs(this.ctx.kicadPcb)

    if (this.hasMatchingTraceRouteVia(pos, layers)) {
      if (this.ctx.stats) {
        this.ctx.stats.vias = (this.ctx.stats.vias || 0) + 1
      }
      return
    }

    // Create pcb_via
    this.ctx.db.pcb_via.insert({
      x: pos.x,
      y: pos.y,
      outer_diameter: size,
      hole_diameter: drill,
      layers,
    })

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.vias = (this.ctx.stats.vias || 0) + 1
    }
  }

  private hasMatchingTraceRouteVia(
    point: { x: number; y: number },
    layers: string[],
  ) {
    const pointKey = this.getPointKey(point)
    const layerSet = new Set(layers)
    const pcbTraces = this.ctx.db.pcb_trace.list() as any[]

    return pcbTraces.some((trace) =>
      (trace.route ?? []).some(
        (routePoint: any) =>
          routePoint.route_type === "via" &&
          this.getPointKey(routePoint) === pointKey &&
          layerSet.has(routePoint.from_layer) &&
          layerSet.has(routePoint.to_layer),
      ),
    )
  }

  private getPointKey(point: { x: number; y: number }): string {
    const x = Math.round(point.x * this.POINT_KEY_PRECISION)
    const y = Math.round(point.y * this.POINT_KEY_PRECISION)
    return `${x},${y}`
  }
}
