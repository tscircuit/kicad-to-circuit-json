import { test } from "bun:test"
import { convertKicadPcbToSvgSnapshot } from "../../fixtures/svg-snapshot-test-utils"

test("kicad-to-circuit-json: CM5RevEng SVG snapshot", () => {
  convertKicadPcbToSvgSnapshot({
    kicadPcbPath: "tests/assets/CM5RevEng.kicad_pcb",
    kicadFileName: "CM5RevEng.kicad_pcb",
    testPath: import.meta.path,
    snapshotName: "cm5-rev-eng-circuit-json",
  })
}, 200_000)
