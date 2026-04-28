import { test, expect } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib/KicadToCircuitJsonConverter"
import { takeKicadSnapshot } from "../fixtures/take-kicad-snapshot"
import { takeCircuitJsonSnapshot } from "../fixtures/take-circuit-json-snapshot"
import { stackCircuitJsonKicadPngs } from "../fixtures/stackCircuitJsonKicadPngs"
import "../fixtures/png-matcher"

test("repro: JST-XH-AM mounting hole with npth alias", async () => {
  const kicadPcb = `(kicad_pcb (version 20211014) (generator pcbnew)
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive")
    (33 "F.Adhes" user "F.Adhesive")
    (34 "B.Paste" user)
    (35 "F.Paste" user)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user)
    (39 "F.Mask" user)
    (40 "Dwgs.User" user "User.Drawings")
    (41 "Cmts.User" user "User.Comments")
    (42 "Eco1.User" user "User.Eco1")
    (43 "Eco2.User" user "User.Eco2")
    (44 "Edge.Cuts" user)
    (45 "Margin" user)
    (46 "B.CrtYd" user "B.Courtyard")
    (47 "F.CrtYd" user "F.Courtyard")
    (48 "B.Fab" user)
    (49 "F.Fab" user)
  )
  (footprint "Connector_JST:JST_XH_B3B-XH-AM_1x03_P2.50mm_Vertical" (layer "F.Cu")
    (at 100 100)
    (tstamp "uuid-123")
    (descr "JST XH series connector, B3B-XH-AM, with boss (http://www.jst-mfg.com/product/pdf/eng/eXH.pdf), generated with kicad-footprint-generator")
    (tags "connector JST XH vertical boss")
    (fp_text reference "REF**" (at 2.5 -3.55) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_text value "JST_XH_B3B-XH-AM_1x03_P2.50mm_Vertical" (at 2.5 4.6) (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_line (start -2.45 -2.35) (end -2.45 3.4) (layer "F.Fab") (width 0.1))
    (fp_line (start -2.45 3.4) (end 7.45 3.4) (layer "F.Fab") (width 0.1))
    (fp_line (start 7.45 3.4) (end 7.45 -2.35) (layer "F.Fab") (width 0.1))
    (fp_line (start 7.45 -2.35) (end -2.45 -2.35) (layer "F.Fab") (width 0.1))
    (fp_line (start -2.56 -2.46) (end -2.56 3.51) (layer "F.SilkS") (width 0.12))
    (fp_line (start -2.56 3.51) (end 7.56 3.51) (layer "F.SilkS") (width 0.12))
    (fp_line (start 7.56 3.51) (end 7.56 -2.46) (layer "F.SilkS") (width 0.12))
    (fp_line (start 7.56 -2.46) (end -2.56 -2.46) (layer "F.SilkS") (width 0.12))
    (fp_line (start -2.95 -2.85) (end -2.95 3.9) (layer "F.CrtYd") (width 0.05))
    (fp_line (start -2.95 3.9) (end 7.95 3.9) (layer "F.CrtYd") (width 0.05))
    (fp_line (start 7.95 3.9) (end 7.95 -2.85) (layer "F.CrtYd") (width 0.05))
    (fp_line (start 7.95 -2.85) (end -2.95 -2.85) (layer "F.CrtYd") (width 0.05))
    (fp_line (start -0.625 -2.35) (end 0 -1.35) (layer "F.Fab") (width 0.1))
    (fp_line (start 0 -1.35) (end 0.625 -2.35) (layer "F.Fab") (width 0.1))
    (fp_line (start 0.75 -2.45) (end 0.75 -1.7) (layer "F.SilkS") (width 0.12))
    (fp_line (start 0.75 -1.7) (end 4.25 -1.7) (layer "F.SilkS") (width 0.12))
    (fp_line (start 4.25 -1.7) (end 4.25 -2.45) (layer "F.SilkS") (width 0.12))
    (fp_line (start 4.25 -2.45) (end 0.75 -2.45) (layer "F.SilkS") (width 0.12))
    (fp_line (start -2.55 -2.45) (end -2.55 -1.7) (layer "F.SilkS") (width 0.12))
    (fp_line (start -2.55 -1.7) (end -0.75 -1.7) (layer "F.SilkS") (width 0.12))
    (fp_line (start -0.75 -1.7) (end -0.75 -2.45) (layer "F.SilkS") (width 0.12))
    (fp_line (start -0.75 -2.45) (end -2.55 -2.45) (layer "F.SilkS") (width 0.12))
    (fp_line (start 5.75 -2.45) (end 5.75 -1.7) (layer "F.SilkS") (width 0.12))
    (fp_line (start 5.75 -1.7) (end 7.55 -1.7) (layer "F.SilkS") (width 0.12))
    (fp_line (start 7.55 -1.7) (end 7.55 -2.45) (layer "F.SilkS") (width 0.12))
    (fp_line (start 7.55 -2.45) (end 5.75 -2.45) (layer "F.SilkS") (width 0.12))
    (fp_line (start -2.55 -0.2) (end -1.8 -0.2) (layer "F.SilkS") (width 0.12))
    (fp_line (start -1.8 -0.2) (end -1.8 1.14) (layer "F.SilkS") (width 0.12))
    (fp_line (start 2.5 2.75) (end -0.74 2.75) (layer "F.SilkS") (width 0.12))
    (fp_line (start 7.55 -0.2) (end 6.8 -0.2) (layer "F.SilkS") (width 0.12))
    (fp_line (start 6.8 -0.2) (end 6.8 2.75) (layer "F.SilkS") (width 0.12))
    (fp_line (start 6.8 2.75) (end 2.5 2.75) (layer "F.SilkS") (width 0.12))
    (fp_line (start -1.6 -2.75) (end -2.85 -2.75) (layer "F.SilkS") (width 0.12))
    (fp_line (start -2.85 -2.75) (end -2.85 -1.5) (layer "F.SilkS") (width 0.12))
    (pad "1" thru_hole roundrect (at 0 0) (size 1.7 1.95) (drill 0.95) (layers "*.Cu" "*.Mask") (roundrect_rratio 0.147059))
    (pad "2" thru_hole oval (at 2.5 0) (size 1.7 1.95) (drill 0.95) (layers "*.Cu" "*.Mask"))
    (pad "3" thru_hole oval (at 5 0) (size 1.7 1.95) (drill 0.95) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at -1.6 2) (size 1.2 1.2) (drill 1.2) (layers "*.Cu" "*.Mask"))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("board.kicad_pcb", kicadPcb)
  const output = converter.getOutput()

  // Add Circuit JSON snapshot
  const fs = await import("node:fs/promises")
  await fs.mkdir("tests/repros/__snapshots__", { recursive: true })
  await fs.writeFile(
    "tests/repros/__snapshots__/jst-xh-am-mounting-hole-circuit-json.json",
    JSON.stringify(output, null, 2),
  )

  // Take snapshots
  const kicadSnapshot = await takeKicadSnapshot({
    kicadFileContent: kicadPcb,
    kicadFileType: "pcb",
  })
  const kicadPng = Object.values(kicadSnapshot.generatedFileContent)[0]!

  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: output as any,
    outputType: "pcb",
  })

  // Export SVG for inspection
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(output as any)
  await fs.writeFile(
    "tests/repros/__snapshots__/jst-xh-am-mounting-hole-circuit-json.svg",
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)

  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "jst-xh-am-mounting-hole",
  )
})
