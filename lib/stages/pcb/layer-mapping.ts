import type { LayerRef, PcbRenderLayer } from "circuit-json"
import type { KicadPcb } from "kicadts"

const INNER_COPPER_LAYER_REGEX = /^In([1-9]\d*)\.Cu$/

function dedupeLayerRefs(layers: LayerRef[]): LayerRef[] {
  return [...new Set(layers)]
}

export function extractKicadLayerNames(layer: any): string[] {
  if (!layer) return []
  if (typeof layer === "string") return [layer]
  if (Array.isArray(layer))
    return layer.filter((name) => typeof name === "string")

  return [
    ...(layer.names || []),
    ...(layer._names || []),
    ...(layer._layers || []),
    ...(layer.name ? [layer.name] : []),
    ...(layer._name ? [layer._name] : []),
  ].filter((name): name is string => typeof name === "string")
}

export function mapKicadLayerToPcbRenderLayer(
  layer: any,
): PcbRenderLayer | undefined {
  const layerNames = extractKicadLayerNames(layer)

  for (const layerName of layerNames) {
    const copperLayer = mapKicadLayerNameToLayerRef(layerName)
    if (copperLayer) {
      return `${copperLayer}_copper` as PcbRenderLayer
    }

    if (layerName.includes("Edge.Cuts")) {
      return "edge_cuts"
    }

    const side = mapKicadLayerToVisibleLayer(layerName)

    if (layerName.includes("CrtYd")) {
      return `${side}_courtyard`
    }

    if (layerName.includes("Fab")) {
      return `${side}_fabrication_note`
    }

    if (layerName.includes("SilkS")) {
      return `${side}_silkscreen`
    }
  }

  return undefined
}

export function isPcbAnnotationRenderLayer(
  renderLayer: PcbRenderLayer | undefined,
): renderLayer is PcbRenderLayer {
  return (
    renderLayer?.endsWith("_silkscreen") ||
    renderLayer?.endsWith("_fabrication_note") ||
    renderLayer?.endsWith("_courtyard") ||
    false
  )
}

export function isPcbTextRenderLayer(
  renderLayer: PcbRenderLayer | undefined,
): renderLayer is PcbRenderLayer {
  return (
    renderLayer?.endsWith("_silkscreen") ||
    renderLayer?.endsWith("_fabrication_note") ||
    renderLayer?.endsWith("_copper") ||
    false
  )
}

export function mapKicadLayerNameToLayerRef(
  layerName: string,
): LayerRef | undefined {
  if (layerName === "F.Cu") return "top"
  if (layerName === "B.Cu") return "bottom"

  const innerLayerMatch = layerName.match(INNER_COPPER_LAYER_REGEX)
  if (!innerLayerMatch) return undefined

  return `inner${innerLayerMatch[1]}` as LayerRef
}

export function mapKicadLayerToLayerRef(layer: any): LayerRef {
  const layerNames = extractKicadLayerNames(layer)

  for (const layerName of layerNames) {
    const mappedLayer = mapKicadLayerNameToLayerRef(layerName)
    if (mappedLayer) return mappedLayer
  }

  const layerLabel = layerNames.join(" ")
  if (
    layerLabel.includes("B.") ||
    layerLabel.includes("Back") ||
    layerLabel.includes("Bottom")
  ) {
    return "bottom"
  }

  return "top"
}

export function mapKicadLayerToVisibleLayer(layer: any): "top" | "bottom" {
  return mapKicadLayerToLayerRef(layer) === "bottom" ? "bottom" : "top"
}

export function getPcbCopperLayerRefs(kicadPcb?: KicadPcb): LayerRef[] {
  const definitions = kicadPcb?.layers?.definitions ?? []

  const copperLayers = definitions
    .map((definition) => mapKicadLayerNameToLayerRef(definition.name ?? ""))
    .filter((layer: LayerRef | undefined): layer is LayerRef => Boolean(layer))

  if (copperLayers.length > 0) {
    return dedupeLayerRefs(copperLayers)
  }

  return ["top", "bottom"]
}

export function getPcbCopperLayerCount(kicadPcb?: KicadPcb): number {
  const definitions = kicadPcb?.layers?.definitions ?? []

  const copperLayerCount = definitions.filter(
    (definition) => definition.name?.endsWith(".Cu") ?? false,
  ).length

  return copperLayerCount > 0 ? copperLayerCount : 2
}

export function getLayerRefsFromLayers(
  layers: any,
  kicadPcb?: KicadPcb,
): LayerRef[] {
  const layerNames = extractKicadLayerNames(layers)
  const mappedLayers: LayerRef[] = []

  for (const layerName of layerNames) {
    if (layerName === "*.Cu") {
      mappedLayers.push(...getPcbCopperLayerRefs(kicadPcb))
      continue
    }

    const mappedLayer = mapKicadLayerNameToLayerRef(layerName)
    if (mappedLayer) {
      mappedLayers.push(mappedLayer)
    }
  }

  return dedupeLayerRefs(mappedLayers)
}

export function expandCopperLayerSpan(
  layers: LayerRef[],
  kicadPcb?: KicadPcb,
): LayerRef[] {
  if (layers.length <= 1) {
    return layers
  }

  const copperStack = getPcbCopperLayerRefs(kicadPcb)
  const startIndex = copperStack.indexOf(layers[0]!)
  const endIndex = copperStack.indexOf(layers[layers.length - 1]!)

  if (startIndex === -1 || endIndex === -1) {
    return dedupeLayerRefs(layers)
  }

  const [fromIndex, toIndex] =
    startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex]

  return copperStack.slice(fromIndex, toIndex + 1)
}

export function getCopperSpanLayerRefsFromLayers(
  layers: any,
  kicadPcb?: KicadPcb,
): LayerRef[] {
  return expandCopperLayerSpan(
    getLayerRefsFromLayers(layers, kicadPcb),
    kicadPcb,
  )
}
