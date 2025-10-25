import { ConverterStage } from "../../types"

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

    for (const net of netArray) {
      const netNum = (net as any).number ?? (net as any).ordinal ?? 0
      const netName = net.name || `Net-${netNum}`

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
