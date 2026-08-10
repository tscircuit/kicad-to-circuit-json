import type { Footprint, FootprintPad } from "kicadts"
import { getKicadNetKey } from "./net-utils"

export function getSourcePortIdForPad(params: {
  componentId: string
  footprint: Footprint
  pad: FootprintPad
}) {
  const { componentId, footprint, pad } = params
  const padNumber = pad.number?.toString()
  if (!padNumber) return undefined

  const baseSourcePortId = `${componentId}_port_${padNumber}`
  if (!hasDuplicatePadNumberOnDifferentNets(footprint, padNumber)) {
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
