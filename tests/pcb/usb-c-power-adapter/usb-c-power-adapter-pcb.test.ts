import { expect, test } from "bun:test"
import type { PcbSilkscreenCircle } from "circuit-json"
import { convertKicadPcbToSvgSnapshot } from "../../fixtures/svg-snapshot-test-utils"

test("kicad-to-circuit-json: USB-C power adapter SVG snapshot", () => {
  const circuitJson = convertKicadPcbToSvgSnapshot({
    kicadPcbPath: "tests/assets/usb-c-power-adapter.kicad_pcb",
    kicadFileName: "usb-c-power-adapter.kicad_pcb",
    testPath: import.meta.path,
    snapshotName: "usb-c-power-adapter-circuit-json",
  })

  const silkscreenCircles = circuitJson.filter(
    (element): element is PcbSilkscreenCircle =>
      element.type === "pcb_silkscreen_circle",
  )
  expect(silkscreenCircles.length).toBeGreaterThan(0)
})
