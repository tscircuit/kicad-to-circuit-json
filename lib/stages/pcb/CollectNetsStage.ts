import { ConverterStage } from "../../types"

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
    const nets = this.ctx.kicadPcb.nets || []
    const netArray = Array.isArray(nets) ? nets : [nets]
    const usedNetNames = new Set<string>()

    for (const net of netArray) {
      // kicadts stores net number in _id property
      const netNum =
        (net as any)._id ?? (net as any).number ?? (net as any).ordinal ?? 0
      // kicadts stores net name in _name property
      const rawNetName = (net as any)._name ?? net.name
      const sanitizedNetName = sanitizeCircuitJsonNetName(
        rawNetName,
        `Net_${netNum}`,
      )
      const netName = usedNetNames.has(sanitizedNetName)
        ? `${sanitizedNetName}_${netNum}`
        : sanitizedNetName
      usedNetNames.add(netName)

      // Store mapping
      this.ctx.netNumToName.set(netNum, netName)
    }

    // Special case: net 0 is typically "no connection" or sometimes GND
    // Only treat as GND if explicitly named
    if (!this.ctx.netNumToName.has(0)) {
      this.ctx.netNumToName.set(0, "")
    }

    this.finished = true
    return false
  }
}
