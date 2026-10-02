import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseKicadPcb } from "kicadts"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import "../../fixtures/png-matcher"

const sourcePath = join(import.meta.dir, "footprint-3d-model.source.kicad_pcb")

function renderBoard(boardPath: string, imagePath: string): void {
  execFileSync("kicad-cli", [
    "pcb",
    "render",
    boardPath,
    "-o",
    imagePath,
    "--width",
    "700",
    "--height",
    "420",
    "--rotate",
    "45,0,45",
    "--perspective",
    "--quality",
    "basic",
  ])
}

test("repro04: KiCad footprint 3D model survives import", async () => {
  const sourceText = await readFile(sourcePath, "utf8")
  const sourcePcb = parseKicadPcb(sourceText)
  const originalModel = sourcePcb.footprints[0]?.models[0]
  const originalModelPath = originalModel?.path
  if (!originalModelPath) throw new Error("Expected one KiCad 3D model")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("footprint-3d-model.kicad_pcb", sourceText)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const component = circuitJson.find(
    (element) => element.type === "pcb_component",
  )
  expect(component).toBeDefined()

  const cadModel = circuitJson.find(
    (element) =>
      element.type === "cad_component" &&
      element.pcb_component_id === component?.pcb_component_id &&
      (element.model_step_url === originalModelPath ||
        element.model_wrl_url === originalModelPath),
  )
  const retainedModelPath =
    (component?.type === "pcb_component"
      ? component.metadata?.kicad_footprint?.model?.path
      : undefined) ??
    (cadModel?.type === "cad_component"
      ? (cadModel.model_step_url ?? cadModel.model_wrl_url)
      : undefined)
  const importedModelMetadata =
    component?.type === "pcb_component"
      ? component.metadata?.kicad_footprint?.model
      : undefined
  expect(importedModelMetadata).toEqual({
    path: originalModelPath,
    offset: originalModel?.offset,
    scale: originalModel?.scale,
    rotate: originalModel?.rotate,
  })

  // Render only the model links carried through Circuit JSON. The right panel
  // becomes bare if the importer drops the model link again.
  const importedPcb = parseKicadPcb(sourceText)
  if (retainedModelPath !== originalModelPath) {
    importedPcb.footprints[0]!.models = []
  }

  const temporaryDir = await mkdtemp(join(tmpdir(), "kicad-model-repro-"))
  try {
    const sourceBoardPath = join(temporaryDir, "source.kicad_pcb")
    const importedBoardPath = join(temporaryDir, "imported.kicad_pcb")
    const sourceImagePath = join(temporaryDir, "source.png")
    const importedImagePath = join(temporaryDir, "imported.png")
    await writeFile(sourceBoardPath, sourceText)
    await writeFile(importedBoardPath, importedPcb.getString())
    renderBoard(sourceBoardPath, sourceImagePath)
    renderBoard(importedBoardPath, importedImagePath)

    // KiCad's basic renderer makes this black battery holder quite dark.
    const sourceImage = await sharp(await readFile(sourceImagePath))
      .modulate({ brightness: 1.8 })
      .resize({ width: 336 })
      .blur(2)
      .png()
      .toBuffer()
    const importedImage = await sharp(await readFile(importedImagePath))
      .modulate({ brightness: 1.8 })
      .resize({ width: 336 })
      .blur(2)
      .png()
      .toBuffer()
    const { width, height } = await sharp(sourceImage).metadata()
    if (!width || !height) throw new Error("KiCad produced an empty 3D render")

    const labels = Buffer.from(`<svg width="${width * 2}" height="36">
      <text x="12" y="26" fill="white" font-size="21">Original KiCad board</text>
      <text x="${width + 12}" y="26" fill="white" font-size="21">Model links retained by import</text>
    </svg>`)
    const comparison = await sharp({
      create: {
        width: width * 2,
        height: height + 36,
        channels: 4,
        background: "#101820",
      },
    })
      .composite([
        { input: labels, left: 0, top: 0 },
        { input: sourceImage, left: 0, top: 36 },
        { input: importedImage, left: width, top: 36 },
      ])
      .png()
      .toBuffer()

    expect(comparison).toMatchPngSnapshot(
      import.meta.path,
      "repro04-footprint-3d-model",
    )
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
  }

  expect(retainedModelPath).toBe(originalModelPath)
}, 30_000)
