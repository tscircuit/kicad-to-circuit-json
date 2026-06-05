import { test } from "bun:test"
import { convertKicadPcbToSvgSnapshot } from "../fixtures/svg-snapshot-test-utils"

test("kicad-to-circuit-json: kicad-laser-prefab PCB SVG snapshot", () => {
  convertKicadPcbToSvgSnapshot({
    kicadPcbPath: "tests/assets/kicad_laser_prefab_example.kicad_pcb",
    kicadFileName: "kicad_laser_prefab_example.kicad_pcb",
    testPath: import.meta.path,
    snapshotName: "kicad_laser_prefab_example-circuit-json",
  })
})
