import type { Footprint } from "kicadts"
import type { LayerRef } from "circuit-json"

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

/**
 * Maps KiCad text layer to Circuit JSON layer (top or bottom)
 */
export function mapTextLayer(kicadLayer: any): "top" | "bottom" {
  // Handle both string and Layer object
  const layerStr =
    typeof kicadLayer === "string"
      ? kicadLayer
      : kicadLayer?.names?.join(" ") || ""
  if (layerStr.includes("B.") || layerStr.includes("Back")) {
    return "bottom"
  }
  return "top"
}
