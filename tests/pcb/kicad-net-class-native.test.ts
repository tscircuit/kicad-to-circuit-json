import { expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  getKicadNetClasses,
  isNetClassRegexSupported,
} from "../../lib/stages/pcb/get-kicad-net-class"

// One net class per pattern, so that KiCad's own answer shows which patterns
// match each net.
const patterns = [
  "/DRAM/SA*",
  "/DRAM/SCK?",
  "/DRAM/DQ[1]|[0-9]",
  "/DRAM/DQ[0-7]",
  "*D+*",
  "/DDR3/~{[CR]A?S}",
  "Net-(U1-Pad1)",
  "NET.1",
  "GND|VCC",
  "usb_d[pn]",
  "NET\\$",
  ".*_[PN]",
  // PCRE2-only syntax: KiCad matches it, the importer reports it instead.
  "(?i)clk_.*",
]
const kicadNetNames = [
  ...["/DRAM/S", "/DRAM/SA12", "/DRAM/SC", "/DRAM/SCKP", "/DRAM/SCKE0"],
  ...["/DRAM/DQ0", "/DRAM/DQ1", "/DRAM/DQ8", "/DRAM/DQ15", "/USB/D+", "D-"],
  ...["/DDR3/~{CAS}", "/DDR3/~{RS}", "/DDR3/~{WE}", "Net-(U1-Pad1)"],
  ...["Net-U1-Pad1", "NET.1", "NETx1", "NET$", "NET$1", "NET", "GND", "GNDA"],
  ...["AGND", "VCC", "AVCC", "USB_DP", "usb_dp", "CLK_P", "clk_n", "/PWR/VBUS"],
]

const getClassName = (patternIndex: number) =>
  `PATTERN${String(patternIndex).padStart(2, "0")}`
const getTrackUuid = (netIndex: number) =>
  `00000000-0000-4000-8000-${String(netIndex).padStart(12, "0")}`

// A KiCad 9 project: every assignment and every matching pattern adds a class.
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
        via_diameter: 0.6,
        via_drill: 0.3,
      },
      ...patterns.map((_, patternIndex) => ({
        name: getClassName(patternIndex),
        priority: patternIndex,
      })),
      { name: "ASSIGNED", priority: patterns.length },
    ],
    netclass_assignments: { "/PWR/VBUS": ["ASSIGNED"] },
    netclass_patterns: patterns.map((pattern, patternIndex) => ({
      netclass: getClassName(patternIndex),
      pattern,
    })),
  },
}
const classNames = kicadProject.net_settings.classes
  .map((netClass) => netClass.name)
  .filter((className) => className !== "Default")
const unsupportedClassNames = patterns.flatMap((pattern, patternIndex) =>
  isNetClassRegexSupported(pattern) ? [] : [getClassName(patternIndex)],
)

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

// A custom rule per class whose assertion fails for every item of a net in
// that class. KiCad reports each failed assertion with the rule name.
const kicadRules = [
  `(version 1)`,
  ...classNames.map(
    (className) =>
      `(rule "probe_${className}" (condition "A.hasNetclass('${className}')") (constraint assertion "A.hasNetclass('NO_SUCH_CLASS')"))`,
  ),
].join("\n")

interface KicadDrcReport {
  violations: {
    type: string
    description: string
    items: { uuid: string }[]
  }[]
}

test("KiCad net class: classes match what KiCad itself resolves", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kicad-net-class-"))
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

    const kicadClassNamesByNetName: Record<string, string[]> = {}
    for (const violation of report.violations) {
      if (violation.type !== "assertion_failure") continue
      const className = /probe_(\w+)/.exec(violation.description)?.[1]
      const netIndex = Number(violation.items[0]?.uuid.slice(-12))
      const kicadNetName = kicadNetNames[netIndex]
      if (!className || !kicadNetName) continue
      kicadClassNamesByNetName[kicadNetName] ??= []
      kicadClassNamesByNetName[kicadNetName].push(className)
    }

    // The unsupported pattern is one KiCad does match.
    expect(kicadClassNamesByNetName.clk_n).toEqual(unsupportedClassNames)

    for (const kicadNetName of kicadNetNames) {
      const kicadClassNames = (kicadClassNamesByNetName[kicadNetName] ?? [])
        .filter((className) => !unsupportedClassNames.includes(className))
        .sort()
      const importedClassNames = getKicadNetClasses({
        netSettings: kicadProject.net_settings,
        kicadNetName,
      })
        .map((netClass) => netClass.name)
        .filter((className) => className !== "Default")
        .sort()

      expect([kicadNetName, importedClassNames]).toEqual([
        kicadNetName,
        kicadClassNames,
      ])
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
