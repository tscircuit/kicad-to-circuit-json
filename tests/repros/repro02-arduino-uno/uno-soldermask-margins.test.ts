import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseKicadPcb } from "kicadts"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import "../../fixtures/png-matcher"

test("Arduino Uno pad solder mask margins survive import", async () => {
  const source = readFileSync(
    "tests/repros/repro02-arduino-uno/arduino-uno.source.kicad_pcb",
    "utf8",
  )
  const board = parseKicadPcb(source)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-uno.kicad_pcb", source)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()

  const sourceMargins = board.footprints
    .flatMap((footprint) => footprint.fpPads)
    .flatMap((pad) =>
      pad.solderMaskMargin === undefined ? [] : [pad.solderMaskMargin],
    )
    .sort((a, b) => a - b)
  const importedMargins = circuitJson
    .filter((element) => element.type === "pcb_smtpad")
    .flatMap((pad) =>
      pad.soldermask_margin === undefined ? [] : [pad.soldermask_margin],
    )
    .sort((a, b) => a - b)
  expect(sourceMargins).toHaveLength(12)
  expect(importedMargins).toEqual(sourceMargins)

  const sourceFiducial = board.footprints.find((footprint) =>
    footprint.properties.some(
      (property) => property.key === "Reference" && property.value === "FID1",
    ),
  )?.fpPads[0]
  const fiducialComponent = circuitJson
    .filter((element) => element.type === "source_component")
    .find((element) => element.name === "FID1")
  const fiducialPcbComponent = circuitJson
    .filter((element) => element.type === "pcb_component")
    .find(
      (element) =>
        element.source_component_id === fiducialComponent?.source_component_id,
    )
  const importedFiducial = circuitJson
    .filter((element) => element.type === "pcb_smtpad")
    .find(
      (element) =>
        element.pcb_component_id === fiducialPcbComponent?.pcb_component_id,
    )
  if (!sourceFiducial || !importedFiducial) {
    throw new Error("Arduino Uno fiducial FID1 was not imported")
  }

  const copperRadius = (sourceFiducial.size?.width ?? 0) * 40
  const panel = (x: number, title: string, margin: number) => {
    const openingRadius = copperRadius + margin * 80
    const cx = x + 300
    return `<g>
      <rect x="${x}" y="0" width="600" height="360" fill="#112033"/>
      <text x="${x + 28}" y="48" fill="#fff" font-size="25">${title}</text>
      <text x="${x + 28}" y="82" fill="#a9c6df" font-size="18">FID1 mask margin: ${margin} mm</text>
      <circle cx="${cx}" cy="190" r="${openingRadius}" fill="#37b4b0" fill-opacity="0.45" stroke="#77ece3" stroke-width="3"/>
      <circle cx="${cx}" cy="190" r="${copperRadius}" fill="#d89148" stroke="#ffd29d" stroke-width="2"/>
      <text x="${x + 28}" y="333" fill="#a9c6df" font-size="16">Teal: F.Mask opening · Orange: copper pad</text>
    </g>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="360" viewBox="0 0 1800 360">
    ${panel(0, "Source KiCad", sourceFiducial.solderMaskMargin ?? 0)}
    ${panel(600, "Previous import", 0)}
    ${panel(1200, "Fixed import", importedFiducial.soldermask_margin ?? 0)}
  </svg>`
  await expect(sharp(Buffer.from(svg)).png().toBuffer()).toMatchPngSnapshot(
    import.meta.path,
  )
}, 30_000)
