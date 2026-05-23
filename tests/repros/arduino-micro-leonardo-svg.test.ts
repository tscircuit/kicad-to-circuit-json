import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { KicadToCircuitJsonConverter } from "../../lib"

const boards = [
  {
    name: "Arduino Micro",
    kicadPcbPath: "tests/assets/Arduino Micro.kicad_pcb",
    fileName: "arduino-micro.kicad_pcb",
    snapshotName: "arduino-micro-circuit-json",
  },
  {
    name: "Arduino Leonardo",
    kicadPcbPath: "tests/assets/Arduino Leonardo.kicad_pcb",
    fileName: "arduino-leonardo.kicad_pcb",
    snapshotName: "arduino-leonardo-circuit-json",
  },
]

for (const board of boards) {
  test(`kicad-to-circuit-json repro: ${board.name} SVG snapshot`, () => {
    const kicadPcbContent = readFileSync(board.kicadPcbPath, "utf-8")

    const converter = new KicadToCircuitJsonConverter()
    converter.addFile(board.fileName, kicadPcbContent)
    converter.runUntilFinished()

    const circuitJson = converter.getOutput()
    expect(circuitJson.length).toBeGreaterThan(0)
    expect(circuitJson.some((el: any) => el.type === "pcb_board")).toBe(true)
    expect(circuitJson.some((el: any) => el.type === "pcb_component")).toBe(
      true,
    )

    const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
      showCourtyards: true,
    })

    expectSvgSnapshot(circuitJsonSvg, import.meta.path, board.snapshotName)
  })
}

function expectSvgSnapshot(
  svg: string,
  testPath: string,
  snapshotName: string,
) {
  const normalizedSvg = normalizeTransientSvgIds(svg)
  const snapshotDir = path.join(path.dirname(testPath), "__snapshots__")
  const snapshotPath = path.join(snapshotDir, `${snapshotName}.snap.svg`)
  const shouldUpdateSnapshot =
    process.argv.includes("--update-snapshots") ||
    process.argv.includes("-u") ||
    Boolean(process.env["BUN_UPDATE_SNAPSHOTS"])

  if (!existsSync(snapshotDir)) {
    mkdirSync(snapshotDir, { recursive: true })
  }

  if (!existsSync(snapshotPath) || shouldUpdateSnapshot) {
    writeFileSync(snapshotPath, normalizedSvg)
  }

  expect(normalizedSvg).toBe(readFileSync(snapshotPath, "utf-8"))
}

function normalizeTransientSvgIds(svg: string) {
  return svg
    .replaceAll(
      /silkscreen-knockout-mask-(pcb_silkscreen_text_\d+)-\d+/g,
      "silkscreen-knockout-mask-$1",
    )
    .replaceAll(/knockout-mask-(pcb_copper_text_\d+)-\d+/g, "knockout-mask-$1")
}
