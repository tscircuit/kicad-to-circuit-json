import { beforeAll, expect, test } from "bun:test"
import "bun-match-svg"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KicadFootprintToCircuitJsonConverter } from "../../../lib"

const converter = new KicadFootprintToCircuitJsonConverter()

beforeAll(async () => {
  const sourcePath = join(
    import.meta.dir,
    "USB1046.pretty/USB_A_Receptacle_GCT_USB1046.kicad_mod",
  )
  converter.addFile(
    "USB_A_Receptacle_GCT_USB1046.kicad_mod",
    readFileSync(sourcePath, "utf8"),
  )
  converter.runUntilFinished()
  expect(
    converter.getOutput().filter((element) => element.type === "pcb_smtpad"),
  ).toHaveLength(4)
  expect(
    converter
      .getOutput()
      .filter((element) => element.type === "pcb_plated_hole"),
  ).toHaveLength(2)

  const exportDir = mkdtempSync(join(tmpdir(), "usb1046-paste-"))
  try {
    const native = Bun.spawnSync([
      "kicad-cli",
      "fp",
      "export",
      "svg",
      "--layers",
      "F.Paste",
      "--black-and-white",
      "--output",
      exportDir,
      join(import.meta.dir, "USB1046.pretty"),
    ])
    expect(native.exitCode).toBe(0)
    const nativeSvg = readFileSync(
      join(exportDir, "USB_A_Receptacle_GCT_USB1046.svg"),
      "utf8",
    )
      .replace(/<title>.*?<\/title>/s, "")
      .replace(/[ \t]+$/gm, "")
    const apertures = converter
      .getOutput()
      .filter((element) => element.type === "pcb_solder_paste")
      .map((aperture) => {
        if (aperture.shape !== "pill")
          throw new Error("Expected USB1046 rounded stencil openings")
        return `<rect x="${aperture.x - aperture.width / 2}" y="${aperture.y - aperture.height / 2}" width="${aperture.width}" height="${aperture.height}" rx="${aperture.radius}"/>`
      })
      .join("")
    const convertedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500" viewBox="-12.5 -11 25 20.5"><g fill="#696969" transform="scale(1,-1)">${apertures}</g></svg>`
    const sourcePanel = nativeSvg
      .slice(nativeSvg.indexOf("<svg"))
      .replace(/width="[^"]+"/, 'width="600"')
      .replace(/height="[^"]+"/, 'height="500"')
      .replace("<svg", '<svg x="0" y="50"')
    const convertedPanel = convertedSvg.replace("<svg", '<svg x="600" y="50"')
    const comparison = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="550"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="sans-serif" font-size="22"><text x="20" y="32">KiCad F.Paste — unchanged USB1046</text><text x="620" y="32">Converted paste layer</text></g>${sourcePanel}${convertedPanel}</svg>`
    await expect(comparison).toMatchSvgSnapshot(import.meta.path)
  } finally {
    rmSync(exportDir, { recursive: true, force: true })
  }
})

test("USB1046 import preserves all six real stencil apertures", () => {
  const paste = converter
    .getOutput()
    .filter((element) => element.type === "pcb_solder_paste")
  expect(paste).toHaveLength(6)
  expect(paste).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        shape: "pill",
        x: -6.4,
        y: 3.55,
        width: 1.2,
        height: 2.9,
        radius: 0.6,
        layer: "top",
      }),
      expect.objectContaining({
        shape: "pill",
        x: 6.4,
        y: 3.55,
        width: 1.2,
        height: 2.9,
        radius: 0.6,
        layer: "top",
      }),
    ]),
  )
  expect(paste.filter((aperture) => aperture.layer === "bottom")).toHaveLength(
    0,
  )
  expect(
    converter.getOutput().filter((element) => element.type === "pcb_port"),
  ).toHaveLength(6)
})
