import type { ConverterContext } from "../../../types"
import { determineLayerFromLayers } from "./layer-utils"

export interface PadPortInfo {
  padNumber: string
  padType: "smd" | "thru_hole" | "np_thru_hole"
  layers: string[]
  position: { x: number; y: number }
}

export function createPcbPort({
  ctx,
  componentId,
  padInfo,
}: {
  ctx: ConverterContext
  componentId: string
  padInfo: PadPortInfo
}): boolean {
  const portLayer = determineLayerFromLayers(padInfo.layers)

  if (!portLayer) {
    return false
  }

  // Generate the source_port_id that will be created by CollectSourceTracesStage
  const sourcePortId = `${componentId}_port_${padInfo.padNumber}`

  ctx.db.pcb_port.insert({
    pcb_component_id: componentId,
    source_port_id: sourcePortId,
    x: padInfo.position.x,
    y: padInfo.position.y,
    layers: [portLayer],
  })

  return true
}
