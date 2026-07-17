import { test } from "bun:test"
import path from "node:path"
import { convertKicadPcbToSvgSnapshot } from "../../fixtures/svg-snapshot-test-utils"

const repros = [
  ["sample001 U2", "sample001-u2"],
  ["sample004 J1", "sample004-j1"],
  ["sample006 J3", "sample006-j3"],
  ["sample008 QA1", "sample008-qa1"],
] as const

for (const [sampleName, fixtureName] of repros) {
  test(`kicad-to-circuit-json: SRJ24 ${sampleName} SVG snapshot`, () => {
    convertKicadPcbToSvgSnapshot({
      kicadPcbPath: path.join(import.meta.dir, `${fixtureName}.kicad_pcb`),
      kicadFileName: `${fixtureName}.kicad_pcb`,
      testPath: import.meta.path,
      snapshotName: fixtureName,
      assertSnapshot: true,
    })
  })
}
