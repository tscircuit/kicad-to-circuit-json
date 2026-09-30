import type { PcbRenderLayer } from "circuit-json"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import {
  approximateArcPoints,
  getArcStartMidEnd,
  getGraphicArcs,
  getGraphicLayerNames,
  getLineStartEnd,
} from "./arc-utils"
import {
  mapKicadLayerToPcbRenderLayer,
  mapKicadLayerToVisibleLayer,
} from "./layer-mapping"

/** Collects silkscreen, fabrication, and courtyard lines and arcs. */
export class CollectGraphicPathsStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb) {
      this.finished = true
      return false
    }

    const lines = this.ctx.kicadPcb.graphicLines || []
    const lineArray = Array.isArray(lines) ? lines : [lines]
    for (const line of lineArray) {
      const layerStr = getGraphicLayerNames(line).join(" ")
      if (layerStr.includes("Edge.Cuts")) continue
      if (
        layerStr.includes("SilkS") ||
        layerStr.includes("Fab") ||
        layerStr.includes("CrtYd")
      ) {
        const renderLayer = mapKicadLayerToPcbRenderLayer(line.layer)
        if (renderLayer) this.createGraphicPath(line, renderLayer)
      }
    }

    for (const arc of getGraphicArcs(this.ctx.kicadPcb)) {
      const layerStr = getGraphicLayerNames(arc).join(" ")
      if (layerStr.includes("Edge.Cuts")) continue
      if (
        layerStr.includes("SilkS") ||
        layerStr.includes("Fab") ||
        layerStr.includes("CrtYd")
      ) {
        const renderLayer = mapKicadLayerToPcbRenderLayer(arc.layer)
        if (renderLayer) this.createGraphicArc(arc, renderLayer)
      }
    }

    this.finished = true
    return false
  }

  private createGraphicPath(line: any, renderLayer: PcbRenderLayer) {
    if (!this.ctx.k2cMatPcb) return

    const { start, end } = getLineStartEnd(line)
    const startPos = applyToPoint(this.ctx.k2cMatPcb, start)
    const endPos = applyToPoint(this.ctx.k2cMatPcb, end)
    const layer = mapKicadLayerToVisibleLayer(line.layer)
    const strokeWidth = line.width || 0.15

    this.insertRouteGraphic({
      layer,
      renderLayer,
      pcbComponentId: "",
      route: [startPos, endPos],
      strokeWidth,
    })
  }

  private createGraphicArc(arc: any, renderLayer: PcbRenderLayer) {
    if (!this.ctx.k2cMatPcb) return

    const { start, mid, end } = getArcStartMidEnd(arc)
    const route = approximateArcPoints({
      start,
      mid,
      end,
      segmentLength: 0.1,
      minSegments: 8,
    }).map((point) => applyToPoint(this.ctx.k2cMatPcb!, point))

    const layer = mapKicadLayerToVisibleLayer(arc.layer)
    const strokeWidth =
      arc.stroke?.width ?? arc._sxStroke?._sxWidth?.value ?? arc.width ?? 0.15

    this.insertRouteGraphic({
      layer,
      renderLayer,
      pcbComponentId: "",
      route,
      strokeWidth,
    })
  }

  private insertRouteGraphic(options: {
    layer: "top" | "bottom"
    renderLayer: PcbRenderLayer
    pcbComponentId: string
    route: Array<{ x: number; y: number }>
    strokeWidth: number
  }) {
    const { layer, renderLayer, pcbComponentId, route, strokeWidth } = options

    if (renderLayer.endsWith("_silkscreen")) {
      this.ctx.db.pcb_silkscreen_path.insert({
        pcb_component_id: pcbComponentId,
        layer,
        route,
        stroke_width: strokeWidth,
      })
      return
    }

    if (renderLayer.endsWith("_fabrication_note")) {
      this.ctx.db.pcb_fabrication_note_path.insert({
        pcb_component_id: pcbComponentId,
        layer,
        route,
        stroke_width: strokeWidth,
      })
      return
    }

    this.ctx.db.pcb_courtyard_outline.insert({
      pcb_component_id: pcbComponentId,
      layer,
      outline: route,
    })
  }
}
