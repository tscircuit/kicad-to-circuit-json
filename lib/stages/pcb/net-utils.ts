import type { KicadNetKey } from "../../types"

interface KicadNetReference {
  id?: number
  name?: string
  number?: number
  ordinal?: number
}

type KicadNet = KicadNetKey | KicadNetReference

export type KicadNetElement =
  | KicadNet
  | {
      net?: KicadNet
      netName?: string
    }

function getNet(netElement: KicadNetElement): KicadNet | undefined {
  if (typeof netElement === "object" && "net" in netElement) {
    return netElement.net
  }

  return netElement
}

/**
 * Returns the stable identity KiCad uses for a net.
 *
 * KiCad 9 and earlier generally reference nets by numeric ID. KiCad 10 can
 * omit the top-level net table and reference nets directly by name instead.
 */
export function getKicadNetKey(
  netElement: KicadNetElement,
): KicadNetKey | null {
  const net = getNet(netElement)
  if (net === undefined) return null

  if (typeof net === "number") return net

  if (typeof net === "string") {
    if (net.trim() === "") return null
    return net
  }

  const numericKey = net.id ?? net.number ?? net.ordinal
  if (typeof numericKey === "number") return numericKey

  const name = net.name

  if (typeof name !== "string" || name.trim() === "") return null
  return name
}

export function getKicadNetName(
  netElement: KicadNetElement,
): string | undefined {
  const net = getNet(netElement)
  let name: string | undefined

  if (typeof net === "string") {
    name = net
  } else if (typeof net === "object") {
    name = net.name
  } else if (typeof netElement === "object" && "netName" in netElement) {
    name = netElement.netName
  }

  if (typeof name !== "string" || name.trim() === "") return undefined
  return name
}
