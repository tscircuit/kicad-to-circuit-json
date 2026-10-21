import type { LayerRef } from "circuit-json"
import type { ConverterContext } from "../../../types"

export interface PadPortInfo {
  padNumber: string
  sourcePortId?: string
  /** KiCad's "connect" pad type is a surface copper contact without paste. */
  padType: "smd" | "connect" | "thru_hole" | "np_thru_hole"
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

  // Generate the source_port_id that will be created by CollectSourceTracesStage
  const sourcePortId =
    padInfo.sourcePortId ?? `${componentId}_port_${padInfo.padNumber}`

  // Standalone footprints do not run CollectSourceTracesStage. Resolve their
  // logical terminal references here instead of emitting dangling source IDs.
  if (ctx.standaloneFootprintConversion) {
    const elements = ctx.db.toArray()
    if (
      !elements.some(
        (el) => el.type === "source_port" && el.source_port_id === sourcePortId,
      )
    ) {
      const component = elements.find(
        (el) =>
          el.type === "pcb_component" && el.pcb_component_id === componentId,
      )
      if (component?.type !== "pcb_component")
        throw new Error(`Missing component ${componentId}`)
      const numeric = /^\d+$/.test(padInfo.padNumber)
      ctx.db.source_port.insert({
        source_port_id: sourcePortId,
        source_component_id: component.source_component_id,
        name: numeric ? `pin${Number(padInfo.padNumber)}` : padInfo.padNumber,
        pin_number: numeric ? Number(padInfo.padNumber) : padInfo.padNumber,
      } as any)
    }
  }

  const insertedPort = ctx.db.pcb_port.insert({
    pcb_component_id: componentId,
    source_port_id: sourcePortId,
    x: padInfo.position.x,
    y: padInfo.position.y,
    layers: padInfo.layers as LayerRef[],
  })

  return insertedPort.pcb_port_id
}
