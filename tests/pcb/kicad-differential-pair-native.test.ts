import { expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isKicadDifferentialPairNet } from "../../lib/stages/pcb/get-kicad-differential-pair-partner-name"

// Nets with and without a polarity, and with and without their partner.
const kicadNetNames = [
  ...["/DRAM/SDQS0P", "/DRAM/SDQS0N", "/DRAM/SCKP", "/DRAM/SCKE0"],
  ...["USB_D+", "USB_D-", "D+", "CLK_P", "CLK_N", "LONE_P", "LONE+"],
  ...["TX_P1", "TX_N1", "RX_N_2", "RX_P_2", "X_P1", "X_N2", "DP", "DN"],
  ...["HDMI_TX2P", "HDMI_TX2N", "MIX_P", "MIX-", "clk_p", "clk_n"],
  ...["RESET_N", "RESET", "P", "N", "P1", "A1", "42", "GND", "/DRAM/DQ9"],
]

const getTrackUuid = (netIndex: number) =>
  `00000000-0000-4000-8000-${String(netIndex).padStart(12, "0")}`

const kicadProject = {
  meta: { filename: "probe.kicad_pro", version: 3 },
  net_settings: {
    meta: { version: 4 },
    classes: [
      {
        name: "Default",
        priority: 2147483647,
        clearance: 0.2,
        track_width: 0.2,
        diff_pair_width: 0.2,
        via_diameter: 0.6,
        via_drill: 0.3,
      },
    ],
  },
}

// One track per net.
const kicadPcb = [
  `(kicad_pcb (version 20240108) (generator "pcbnew") (generator_version "8.0")`,
  `(general (thickness 1.6))`,
  `(paper "A4")`,
  `(layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))`,
  `(setup (pad_to_mask_clearance 0))`,
  `(net 0 "")`,
  ...kicadNetNames.map(
    (netName, netIndex) => `(net ${netIndex + 1} "${netName}")`,
  ),
  ...kicadNetNames.map(
    (_, netIndex) =>
      `(segment (start 0 ${netIndex}) (end 5 ${netIndex}) (width 0.2) (layer "F.Cu") (net ${netIndex + 1}) (uuid "${getTrackUuid(netIndex)}"))`,
  ),
  `(gr_rect (start -5 -5) (end 10 ${kicadNetNames.length + 5}) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid "00000000-0000-4000-8000-ffffffffffff"))`,
  `)`,
].join("\n")

// A custom rule whose assertion fails for every item of a net that KiCad
// treats as one side of a differential pair. The condition is the one of
// KiCad's implicit "netclass (diff pair)" rules.
const kicadRules = [
  `(version 1)`,
  `(rule "probe_pair" (condition "A.inDiffPair('*')") (constraint assertion "A.hasNetclass('NO_SUCH_CLASS')"))`,
].join("\n")

interface KicadDrcReport {
  violations: {
    type: string
    description: string
    items: { uuid: string }[]
  }[]
}

test("KiCad differential pair: nets are paired the way KiCad itself pairs them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kicad-differential-pair-"))
  try {
    const boardPath = join(dir, "probe.kicad_pcb")
    const reportPath = join(dir, "probe-drc.json")
    await writeFile(boardPath, kicadPcb)
    await writeFile(join(dir, "probe.kicad_pro"), JSON.stringify(kicadProject))
    await writeFile(join(dir, "probe.kicad_dru"), kicadRules)
    await $`kicad-cli pcb drc --format json --severity-all --output ${reportPath} ${boardPath}`.quiet()
    const report: KicadDrcReport = JSON.parse(
      await readFile(reportPath, "utf8"),
    )

    const kicadPairedNetNames = new Set<string>()
    for (const violation of report.violations) {
      if (violation.type !== "assertion_failure") continue
      if (!violation.description.includes("probe_pair")) continue
      const netIndex = Number(violation.items[0]?.uuid.slice(-12))
      const kicadNetName = kicadNetNames[netIndex]
      if (kicadNetName) kicadPairedNetNames.add(kicadNetName)
    }

    // The probe rule ran: KiCad pairs the strobe nets and leaves GND alone.
    expect(kicadPairedNetNames.has("/DRAM/SDQS0P")).toBe(true)
    expect(kicadPairedNetNames.has("GND")).toBe(false)

    const boardNetNames = new Set(kicadNetNames)
    for (const kicadNetName of kicadNetNames) {
      const isImportedAsPaired = isKicadDifferentialPairNet({
        kicadNetName,
        kicadNetNames: boardNetNames,
      })

      expect([kicadNetName, isImportedAsPaired]).toEqual([
        kicadNetName,
        kicadPairedNetNames.has(kicadNetName),
      ])
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
