import type { LayerRef } from "circuit-json"
import type { ConverterContext } from "../../../types"

export interface PadPortInfo {
  sourcePortId: string
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
}): string | undefined {
  if (!padInfo.layers || padInfo.layers.length === 0) {
    return undefined
  }

  const insertedPort = ctx.db.pcb_port.insert({
    pcb_component_id: componentId,
    source_port_id: padInfo.sourcePortId,
    x: padInfo.position.x,
    y: padInfo.position.y,
    layers: padInfo.layers as LayerRef[],
  })

  return insertedPort.pcb_port_id
}
