import type { CircuitJson } from "circuit-json"
import {
  convertCircuitJsonToSchematicSvg,
  convertCircuitJsonToPcbSvg,
} from "circuit-to-svg"
import sharp from "sharp"

export const takeCircuitJsonSnapshot = async (params: {
  circuitJson: CircuitJson
  outputType: "pcb" | "schematic"
}): Promise<Buffer> => {
  const { circuitJson, outputType } = params
  if (outputType === "schematic") {
    const svg = await convertCircuitJsonToSchematicSvg(circuitJson)
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    return png
  }
  if (outputType === "pcb") {
    const svg = await convertCircuitJsonToPcbSvg(
      removeFabricationNoteElementsFromPcbPreview(circuitJson as any) as any,
      {
        showCourtyards: true,
      },
    )
    // Ensure minimum height of 800px for the pcb image
    const png = await sharp(Buffer.from(svg))
      .resize({ height: 1280, withoutEnlargement: false })
      .png()
      .toBuffer()
    return png
  }
  throw new Error(`Unknown output type: ${outputType}`)
}

function removeFabricationNoteElementsFromPcbPreview(circuitJson: any[]) {
  return circuitJson.filter(
    (el) =>
      el.type !== "pcb_fabrication_note_text" &&
      el.type !== "pcb_fabrication_note_path" &&
      el.type !== "pcb_fabrication_note_rect" &&
      el.type !== "pcb_fabrication_note_dimension",
  )
}
