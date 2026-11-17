import { readFileSync } from "node:fs"
import { join } from "node:path"
import { schematic_text } from "circuit-json"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../../lib"

export interface Evidence {
  name: string
  title: string
  description: string
  passing: boolean
  kind: "pad" | "reference" | "ids" | "anchor"
  expected: string
  actual: string
  detail: string
  values: Record<string, unknown>
}
export function collectEvidence(): Evidence[] {
  const fixture = (name: string) =>
    readFileSync(join(import.meta.dir, "fixtures", name), "utf8")
  const fp = new KicadFootprintToCircuitJsonConverter()
  fp.addFile("footprint.kicad_mod", fixture("footprint.kicad_mod"))
  fp.runUntilFinished()
  const footprint = fp.getOutput() as any[]
  const pcb = new KicadToCircuitJsonConverter()
  pcb.addFile("no-net.kicad_pcb", fixture("no-net.kicad_pcb"))
  pcb.runUntilFinished()
  const board = pcb.getOutput() as any[]
  const sch = new KicadToCircuitJsonConverter()
  sch.addFile("centered-text.kicad_sch", fixture("centered-text.kicad_sch"))
  sch.runUntilFinished()
  const annotation = sch.getOutput().find((e) => e.type === "schematic_text")!
  const parsed = schematic_text.safeParse(annotation)
  const pad = footprint.find((e) => e.type === "pcb_smtpad")
  const expectedRadius = 3 * 0.4 // Shorter side times KiCad roundrect_rratio.
  const texts = footprint.filter((e) => e.type === "pcb_fabrication_note_text")
  const ids = texts.map((e) => e.pcb_fabrication_note_text_id)
  const referenceEvidence = (
    elements: any[],
    standalone: boolean,
  ): Evidence => {
    const port = elements.find((e) => e.type === "pcb_port")
    const source = elements.find(
      (e) =>
        e.type === "source_port" && e.source_port_id === port.source_port_id,
    )
    const nets = elements.filter((e) => e.type === "source_net").length
    const traces = elements.filter((e) => e.type === "source_trace").length
    return {
      name: standalone ? "standalone-source-port" : "no-net-source-port",
      title: standalone
        ? "Standalone footprint: terminal link"
        : "No-net pin: terminal link",
      description: standalone
        ? "A numbered physical pad needs a logical source port."
        : "An unconnected pin still needs a terminal, but no net or trace.",
      kind: "reference",
      passing: Boolean(source) && nets === 0 && traces === 0,
      expected: "Reference resolves",
      actual: source ? "Reference resolves" : "Dangling reference",
      detail: `Logical nets: ${nets}   |   Logical traces: ${traces}`,
      values: {
        pcbPortId: port.pcb_port_id,
        sourcePortId: port.source_port_id,
        sourceExists: Boolean(source),
        nets,
        traces,
      },
    }
  }
  return [
    {
      name: "roundrect-radius",
      title: "Rounded pad: corner radius",
      kind: "pad",
      description: "KiCad pad: 4 x 3 mm, roundrect_rratio = 0.4.",
      passing: Math.abs(pad.corner_radius - expectedRadius) < 1e-8,
      expected: "Radius 1.20 mm",
      actual: `Radius ${pad.corner_radius.toFixed(2)} mm`,
      detail:
        "Same scale in both panels. Geometry is taken from imported Circuit JSON.",
      values: {
        width: pad.width,
        height: pad.height,
        expectedRadius,
        actualRadius: pad.corner_radius,
      },
    },
    {
      name: "fabrication-text-ids",
      title: "Fabrication text: element identity",
      kind: "ids",
      description: "Two distinct text elements need distinct, nonempty IDs.",
      passing:
        ids.length === 2 &&
        ids.every((id) => typeof id === "string" && id.length > 0) &&
        new Set(ids).size === 2,
      expected: "Two unique IDs",
      actual:
        ids.every(Boolean) && new Set(ids).size === 2
          ? "Two unique IDs"
          : "Empty / duplicate IDs",
      detail:
        "The strings below are the actual primary IDs emitted by the importer.",
      values: { ids, text: texts.map((e) => e.text) },
    },
    referenceEvidence(footprint, true),
    referenceEvidence(board, false),
    {
      name: "schematic-text-anchor",
      title: "Schematic text: schema validity",
      kind: "anchor",
      description: "Centered text must use a valid Circuit JSON anchor enum.",
      passing: parsed.success && annotation.anchor === "center",
      expected: 'anchor: "center"',
      actual: `anchor: "${annotation.anchor}"`,
      detail:
        "Schema diagnostic from schematic_text.safeParse; not a schematic rendering.",
      values: {
        anchor: annotation.anchor,
        schemaValid: parsed.success,
        issues: parsed.success
          ? []
          : parsed.error.issues.map((issue) => ({
              path: issue.path,
              code: issue.code,
            })),
      },
    },
  ]
}
