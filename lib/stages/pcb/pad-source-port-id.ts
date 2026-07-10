import type { Footprint } from "kicadts"

export function getPadNetNum(pad: any): number | null {
  const net = pad?._sxNet || pad?.net
  if (!net) return null

  if (typeof net === "number") return net
  if (typeof net === "object") {
    return net._id ?? net.number ?? net.ordinal ?? null
  }

  return null
}

export function getSourcePortIdForPad(params: {
  componentId: string
  footprint: Footprint
  pad: any
}) {
  const { componentId, footprint, pad } = params
  const padNumber = pad.number?.toString()
  if (!padNumber) return undefined

  const baseSourcePortId = `${componentId}_port_${padNumber}`
  if (!hasDuplicatePadNumberOnDifferentNets(footprint, padNumber)) {
    return baseSourcePortId
  }

  return `${baseSourcePortId}_net_${getPadNetNum(pad) ?? "none"}`
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
    netKeys.add(String(getPadNetNum(pad) ?? "none"))
  }

  return netKeys.size > 1
}
