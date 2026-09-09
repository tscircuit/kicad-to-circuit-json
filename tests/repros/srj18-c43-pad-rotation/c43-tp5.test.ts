import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("SRJ18 C43 and TP5: KiCad copper beside imported copper", async () => {
  const source = readFileSync(`${import.meta.dir}/c43-tp5.kicad_pcb`, "utf8")
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("c43-tp5.kicad_pcb", source)
  converter.runUntilFinished()
  const output = converter.getOutput()
  const pads = output.filter((element) => element.type === "pcb_smtpad")
  expect(pads).toHaveLength(2)
  const c43 = pads[0]!
  const tp5 = pads[1]!
  if (c43.shape !== "rect" || tp5.shape !== "circle") {
    throw new Error("Expected C43 rectangle and TP5 circle")
  }

  // Record observed conversion, including the bug on the baseline branch.
  // The fix must update this snapshot together with the comparison image.
  expect({
    c43: { shape: c43.shape, width: c43.width, height: c43.height },
    tp5CopperGap: Number(
      (tp5.y - tp5.radius - (c43.y + c43.height / 2)).toFixed(6),
    ),
  }).toMatchSnapshot()

  const native = await takeKicadSnapshot({
    kicadFileContent: source,
    kicadFileType: "pcb",
    generatePng: false,
  })
  const nativeSvg = native.generatedFileContent["temp_file.svg"]
  if (!nativeSvg) throw new Error("KiCad did not export temp_file.svg")
  // The fixture's Edge.Cuts rectangle is exactly 8 x 7 mm. Use that common
  // viewport instead of KiCad's rounded page extent; copper paths are untouched.
  const sourceSvg = nativeSvg
    .toString()
    .replace(
      /width="[^"]+" height="[^"]+" viewBox="[^"]+"/,
      'width="640" height="560" viewBox="0 0 8 7"',
    )
  expect(sourceSvg).toContain('viewBox="0 0 8 7"')
  const convertedSvg = convertCircuitJsonToPcbSvg(
    output.filter((el) => el.type === "pcb_board" || el.type === "pcb_smtpad"),
    {
      width: 640,
      height: 560,
      drawPaddingOutsideBoard: false,
      showSolderMask: false,
      includeVersion: false,
      backgroundColor: "#000000",
    },
  )
  const labelledSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="710">
    <rect width="1280" height="710" fill="#101923"/>
    <g fill="#ffffff" font-family="sans-serif" font-size="24">
      <text x="24" y="42">KiCad source</text>
      <text x="664" y="42">circuit-to-svg conversion</text>
    </g>
    <path d="M640 0V624" stroke="#64748b"/>
    <g fill="#dbe7f1" font-family="sans-serif" font-size="20">
      <text x="24" y="658">SRJ18 sample016: C43 upper pad (VCIN), TP5 circle (+5V)</text>
      <text x="24" y="690">Same scale: 8 x 7 mm per panel. Source pad: 2.5 x 5.3 mm at 270 degrees.</text>
    </g>
  </svg>`
  const sourcePng = await sharp(Buffer.from(sourceSvg))
    .flatten({ background: "#000000" })
    .png()
    .toBuffer()
  const convertedPng = await sharp(Buffer.from(convertedSvg)).png().toBuffer()
  const comparisonPng = await sharp(Buffer.from(labelledSvg))
    .composite([
      { input: sourcePng, left: 0, top: 64 },
      { input: convertedPng, left: 640, top: 64 },
    ])
    .png()
    .toBuffer()
  await expect(comparisonPng).toMatchPngSnapshot(
    import.meta.path,
    "c43-tp5-kicad-vs-converted",
  )
})
