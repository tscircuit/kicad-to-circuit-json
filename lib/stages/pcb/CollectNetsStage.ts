import { ConverterStage, type KicadNetKey } from "../../types"
import { getTopLevelCopperArcs } from "./arc-utils"
import {
  getKicadNetKey,
  getKicadNetName,
  type KicadNetElement,
} from "./net-utils"

export function sanitizeCircuitJsonNetName(
  rawName: string | undefined,
  fallbackName: string,
): string {
  const baseName = rawName?.trim() || fallbackName
  const sanitized = baseName
    .replace(/\+/g, "_P")
    .replace(/-/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  const name = sanitized || fallbackName
  return /^\d/.test(name) ? `net_${name}` : name
}

/**
 * CollectNetsStage builds a mapping from KiCad net numbers to meaningful net names.
 * Prefers KiCad's actual net names, falls back to "Net-<n>" for unnamed nets.
 */
export class CollectNetsStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    // Extract nets from KiCad PCB
    const netArray = this.getNetElements()
    const usedNetNames = new Set<string>()

    for (const netElement of netArray) {
      const netKey = getKicadNetKey(netElement)
      if (
        netKey === null ||
        netKey === 0 ||
        this.ctx.netNumToName.has(netKey)
      ) {
        continue
      }

      const rawNetName = getKicadNetName(netElement)
      const sanitizedNetName = sanitizeCircuitJsonNetName(
        rawNetName,
        `Net_${netKey}`,
      )
      const netName = this.getUniqueNetName({
        sanitizedNetName,
        netKey,
        usedNetNames,
      })
      usedNetNames.add(netName)

      // Store mapping
      this.ctx.netNumToName.set(netKey, netName)
    }

    // Special case: net 0 is typically "no connection" or sometimes GND
    // Only treat as GND if explicitly named
    if (!this.ctx.netNumToName.has(0)) {
      this.ctx.netNumToName.set(0, "")
    }

    this.finished = true
    return false
  }

  private getNetElements(): KicadNetElement[] {
    if (!this.ctx.kicadPcb) return []

    const pads = this.ctx.kicadPcb.footprints.flatMap(
      (footprint) => footprint.fpPads,
    )

    return [
      ...this.ctx.kicadPcb.nets,
      ...pads,
      ...this.ctx.kicadPcb.segments,
      ...getTopLevelCopperArcs(this.ctx.kicadPcb),
      ...this.ctx.kicadPcb.vias,
      ...this.ctx.kicadPcb.zones,
    ]
  }

  private getUniqueNetName({
    sanitizedNetName,
    netKey,
    usedNetNames,
  }: {
    sanitizedNetName: string
    netKey: KicadNetKey
    usedNetNames: Set<string>
  }) {
    if (!usedNetNames.has(sanitizedNetName)) return sanitizedNetName

    if (typeof netKey === "number") {
      return `${sanitizedNetName}_${netKey}`
    }

    let suffix = 2
    while (usedNetNames.has(`${sanitizedNetName}_${suffix}`)) suffix++
    return `${sanitizedNetName}_${suffix}`
  }
}
