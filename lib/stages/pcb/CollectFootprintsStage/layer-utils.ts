import type { Footprint } from "kicadts"
import type { LayerRef } from "circuit-json"
import {
  extractKicadLayerNames,
  mapKicadLayerToLayerRef,
  mapKicadLayerToVisibleLayer,
} from "../layer-mapping"

/**
 * Determines the layer (top or bottom) of a component based on the footprint's layer information
 */
export function getComponentLayer(footprint: Footprint): "top" | "bottom" {
  return mapKicadLayerToVisibleLayer(footprint.layer)
}

/**
 * Determines the layer (top or bottom) of a pad based on its layer information
 */
export function determineLayerFromLayers(layers: any): LayerRef {
  return mapKicadLayerToLayerRef(extractKicadLayerNames(layers))
}

/**
 * Maps KiCad text layer to Circuit JSON layer (top or bottom)
 */
export function mapTextLayer(kicadLayer: any): "top" | "bottom" {
  return mapKicadLayerToVisibleLayer(kicadLayer)
}
