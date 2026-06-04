import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { KicadPcb, KicadSch } from "kicadts"
import type { Matrix } from "transformation-matrix"

export interface KicadSymbolLibPinAlternate {
  name: string
  electricalType?: string
  graphicStyle?: string
}

export interface KicadSymbolLibPin {
  name: string
  number: string
  electricalType?: string
  graphicStyle?: string
  at?: {
    x: number
    y: number
    angle: number
  }
  length?: number
  hidden?: boolean
  alternates?: KicadSymbolLibPinAlternate[]
}

export interface KicadSymbolLibPoint {
  x: number
  y: number
}

export interface KicadSymbolLibStroke {
  width?: number
  type?: string
}

export interface KicadSymbolLibFill {
  type?: string
}

export interface KicadSymbolLibPolyline {
  points: KicadSymbolLibPoint[]
  stroke?: KicadSymbolLibStroke
  fill?: KicadSymbolLibFill
}

export interface KicadSymbolLibRectangle {
  start: KicadSymbolLibPoint
  end: KicadSymbolLibPoint
  stroke?: KicadSymbolLibStroke
  fill?: KicadSymbolLibFill
}

export interface KicadSymbolLibCircle {
  center: KicadSymbolLibPoint
  radius: number
  stroke?: KicadSymbolLibStroke
  fill?: KicadSymbolLibFill
}

export interface KicadSymbolLibArc {
  start: KicadSymbolLibPoint
  mid: KicadSymbolLibPoint
  end: KicadSymbolLibPoint
  stroke?: KicadSymbolLibStroke
}

export interface KicadSymbolLibText {
  text: string
  at: {
    x: number
    y: number
    angle: number
  }
  fontSize?: number
}

export interface KicadSymbolLibSymbol {
  name: string
  properties: Record<string, string>
  pins: KicadSymbolLibPin[]
  polylines: KicadSymbolLibPolyline[]
  rectangles: KicadSymbolLibRectangle[]
  circles: KicadSymbolLibCircle[]
  arcs: KicadSymbolLibArc[]
  texts: KicadSymbolLibText[]
  subSymbols: KicadSymbolLibSymbol[]
}

export interface KicadSymbolLib {
  version?: string
  generator?: string
  generatorVersion?: string
  symbols: KicadSymbolLibSymbol[]
}

export interface ConverterContext {
  db: CircuitJsonUtilObjects
  kicadPcb?: KicadPcb
  kicadSch?: KicadSch
  kicadSymbolLib?: KicadSymbolLib

  // Transformation matrices (KiCad → Circuit JSON)
  k2cMatSch?: Matrix
  k2cMatPcb?: Matrix

  // Maps for tracking relationships
  netNumToName?: Map<number, string>
  netNumToSourceNetId?: Map<number, string>
  netNumToSourcePortIds?: Map<number, string[]>
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
