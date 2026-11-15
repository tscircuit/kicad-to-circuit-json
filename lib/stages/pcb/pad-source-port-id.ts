import type { Footprint, FootprintPad } from "kicadts"
import type { ConverterContext } from "../../types"
import { sourcePortMatchesPin } from "../../utils/get-or-create-source-port"
import { getKicadNetKey } from "./net-utils"

export function getSourcePortIdForPad(params: {
  componentId: string
  footprint: Footprint
  pad: FootprintPad
  ctx: ConverterContext
}) {
  const { componentId, footprint, pad, ctx } = params
  const padNumber = pad.number?.toString()
  if (!padNumber) return undefined

  const baseSourcePortId = `${componentId}_port_${padNumber}`
  if (!hasDuplicatePadNumberOnDifferentNets(footprint, padNumber)) {
    if (!ctx.kicadSch) return baseSourcePortId
    const component = ctx.db.pcb_component.get(componentId)
    const existing =
      component &&
      ctx.db.source_port
        .list({ source_component_id: component.source_component_id })
        .find((port) => sourcePortMatchesPin(port, padNumber))
    if (existing) return existing.source_port_id
    return baseSourcePortId
  }

  return `${baseSourcePortId}_net_${getKicadNetKey(pad) ?? "none"}`
}

function hasDuplicatePadNumberOnDifferentNets(
  footprint: Footprint,
  padNumber: string,
) {
  const pads = footprint.fpPads || []
  const padArray = Array.isArray(pads) ? pads : [pads]
  const netKeys = new Set<string>()

  for (const pad of padArray) {
    if (pad.number?.toString() !== padNumber) continue
    netKeys.add(String(getKicadNetKey(pad) ?? "none"))
  }

  return netKeys.size > 1
}
