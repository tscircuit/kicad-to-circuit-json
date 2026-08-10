import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { KicadPcb, KicadSch, KicadSym } from "kicadts"
import type { Matrix } from "transformation-matrix"

export type KicadNetKey = number | string

export interface ConverterContext {
  db: CircuitJsonUtilObjects
  kicadPcb?: KicadPcb
  kicadSch?: KicadSch
  kicadSymbolLib?: KicadSym
  standaloneFootprintConversion?: boolean

  // Transformation matrices (KiCad → Circuit JSON)
  k2cMatSch?: Matrix
  k2cMatPcb?: Matrix

  // Legacy field names: KiCad 10 may use a net name instead of a net number.
  netNumToName?: Map<KicadNetKey, string>
  netNumToSourceNetId?: Map<KicadNetKey, string>
  netNumToSourceTraceId?: Map<KicadNetKey, string>
  netNumToSourcePortIds?: Map<KicadNetKey, string[]>
  footprintUuidToComponentId?: Map<string, string>
  footprintUuidToSourceComponentId?: Map<string, string>
  symbolUuidToComponentId?: Map<string, string>

  // Diagnostics
  warnings?: string[]
  stats?: {
    components?: number
    pads?: number
    vias?: number
    traces?: number
    labels?: number
    copper_pours?: number
  }
}

export interface Point {
  x: number
  y: number
}

export interface FootprintPlacement {
  kicadComponentPos: Point
  componentCcwRotationDegrees: number
}

/**
 * Base class for converter stages that process KiCad data into Circuit JSON.
 * Each stage performs a specific transformation step and can run iteratively.
 */
export abstract class ConverterStage {
  protected MAX_ITERATIONS = 100
  protected iterationCount = 0
  public finished = false

  constructor(protected ctx: ConverterContext) {}

  /**
   * Perform one step of the conversion process.
   * Returns true if the stage has more work to do, false if finished.
   */
  abstract step(): boolean

  /**
   * Run this stage until completion or max iterations reached.
   */
  runUntilFinished(): void {
    this.iterationCount = 0
    while (!this.finished && this.iterationCount < this.MAX_ITERATIONS) {
      const hasMoreWork = this.step()
      if (!hasMoreWork) {
        this.finished = true
      }
      this.iterationCount++
    }

    if (this.iterationCount >= this.MAX_ITERATIONS) {
      this.ctx.warnings = this.ctx.warnings || []
      this.ctx.warnings.push(
        `Stage ${this.constructor.name} exceeded maximum iterations (${this.MAX_ITERATIONS})`,
      )
      this.finished = true
    }
  }
}
