import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

// Actual NEMA34 zone fragments from pd1180-epr@952de54; provenance is in PR #277.
// Original PCB SHA256: 2880cf5c42f62f26465c4ceb164357e5228ccf19ff86d115c116c3b1ec52891e.
const source = readFileSync(
  `${import.meta.dir}/nema34-reduced.kicad_pcb`,
  "utf8",
)
function importPours(text: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("nema34.kicad_pcb", text)
  converter.runUntilFinished()
  return converter.getOutput().filter((el) => el.type === "pcb_copper_pour")
}

test("NEMA34: every filled fragment keeps its zone's own clearance", () => {
  const zones = parseKicadPcb(source).zones
  expect(zones.map((z) => z.connectPads?.clearance)).toEqual([0.16, 0.3])
  const pours = importPours(source)
  expect(pours).toHaveLength(3)
  expect(pours.map((p) => Reflect.get(p, "clearance"))).toEqual([
    0.16, 0.3, 0.3,
  ])
  expect(pours.filter((p) => p.layer === "inner1")).toHaveLength(2)
})

test("explicit zero is preserved and an absent clearance stays absent", () => {
  const zero = importPours(
    source.replaceAll("(clearance 0.3)", "(clearance 0)"),
  )
  expect(
    zero
      .filter((p) => p.layer === "inner1")
      .map((p) => Reflect.get(p, "clearance")),
  ).toEqual([0, 0])
  const omitted = importPours(source.replaceAll("(clearance 0.3)", ""))
  expect(
    omitted
      .filter((p) => p.layer === "inner1")
      .every((p) => !Object.hasOwn(p, "clearance")),
  ).toBe(true)
})

test("outline fallback also preserves clearance when cached fill is absent", () => {
  const pcb = parseKicadPcb(source)
  for (const zone of pcb.zones) zone.filledPolygons = []
  const pours = importPours(pcb.getString())
  expect(pours).toHaveLength(2)
  expect(pours.map((p) => Reflect.get(p, "clearance"))).toEqual([0.16, 0.3])
})

test("NEMA34: compare source and imported PCB copper fragments", async () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("nema34.kicad_pcb", source)
  converter.runUntilFinished()
  const kicadSnapshot = await takeKicadSnapshot({
    kicadFileContent: source,
    kicadFileType: "pcb",
    generatePng: false,
    pcbLayers: ["In1.Cu", "B.Cu", "Edge.Cuts"],
  })
  expect(kicadSnapshot.exitCode).toBe(0)
  const importedSvg = convertCircuitJsonToPcbSvg(converter.getOutput(), {
    width: 800,
    height: 800,
    matchBoardAspectRatio: true,
    drawPaddingOutsideBoard: false,
    includeVersion: false,
  })
  const sourceSvg = Object.values(kicadSnapshot.generatedFileContent)[0]!
  const [sourcePng, importedPng] = await Promise.all(
    [sourceSvg, Buffer.from(importedSvg)].map((svg) =>
      sharp(svg)
        .resize(800, 800, { fit: "contain", background: "black" })
        .flatten({ background: "black" })
        .png()
        .toBuffer(),
    ),
  )
  const png = await stackCircuitJsonKicadPngs(
    importedPng!,
    sourcePng!,
    "horizontal",
  )
  await expect(png).toMatchPngSnapshot(
    import.meta.path,
    "nema34-zone-clearance",
  )
})
