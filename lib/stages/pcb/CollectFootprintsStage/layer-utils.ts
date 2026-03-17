import type { Footprint } from "kicadts"
import type { LayerRef, PcbRenderLayer } from "circuit-json"

/**
 * Determines the layer (top or bottom) of a component based on the footprint's layer information
 */
export function getComponentLayer(footprint: Footprint): "top" | "bottom" {
  // Check if footprint is on back layer
  const layer = footprint.layer
  const layerNames = layer?.names || []
  if (
    layerNames.some((name) => name.includes("B.Cu") || name.includes("Back"))
  ) {
    return "bottom"
  }
  return "top"
}

/**
 * Determines the layer (top or bottom) of a pad based on its layer information
 */
export function determineLayerFromLayers(layers: any): LayerRef {
  // Handle both raw arrays and kicadts layer objects
  const layerArray = Array.isArray(layers) ? layers : layers?._layers || []

  if (layerArray.includes("B.Cu") || layerArray.includes("Back")) {
    return "bottom"
  }
  return "top"
}

export interface LayerMapping {
  selectedLayer: "top" | "bottom"
  layers: PcbRenderLayer[]
}

/**
 * Gets a detailed mapping for a KiCad layer
 */
export function getLayerMapping(kicadLayer: any): LayerMapping {
  const layerStr =
    typeof kicadLayer === "string"
      ? kicadLayer
      : kicadLayer?.names?.join(" ") || ""

  const selectedLayer: "top" | "bottom" =
    layerStr.includes("B.") || layerStr.includes("Back") ? "bottom" : "top"

  const layers: PcbRenderLayer[] = []
  if (layerStr.includes("Silk")) {
    layers.push(
      selectedLayer === "top" ? "top_silkscreen" : "bottom_silkscreen",
    )
  } else if (layerStr.includes("Edge.Cuts")) {
    layers.push("edge_cuts")
  }

  return { selectedLayer, layers }
}
