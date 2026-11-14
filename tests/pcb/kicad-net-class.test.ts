import { expect, test } from "bun:test"
import {
  getKicadNetClasses,
  isNetClassRegexSupported,
} from "../../lib/stages/pcb/get-kicad-net-class"
import type { KicadNetSettings } from "../../lib/types"

// Net classes and patterns of the Allwinner H616 devboard project, in the
// order KiCad 8 saved them.
const h616NetSettings: KicadNetSettings = {
  meta: { version: 3 },
  classes: [
    { name: "Default", track_width: 0.1 },
    { name: "DDR3_ADDR", track_width: 0.0975 },
    { name: "DDR3_DATA_HB", track_width: 0.0975 },
    { name: "DDR3_DATA_LB", track_width: 0.0975 },
    { name: "DDR3_DIFF", track_width: 0.25 },
    { name: "DDR3_OTHER", track_width: 0.0975 },
    { name: "USB", track_width: 0.1 },
  ],
  netclass_assignments: null,
  netclass_patterns: [
    { netclass: "DDR3_ADDR", pattern: "/DRAM/SA*" },
    { netclass: "DDR3_DIFF", pattern: "/DRAM/SCK?" },
    { netclass: "DDR3_DIFF", pattern: "/DRAM/SDQS*" },
    { netclass: "DDR3_DATA_HB", pattern: "/DRAM/DQ[1]|[0-9]" },
    { netclass: "DDR3_OTHER", pattern: "/DRAM/SBA*" },
    { netclass: "DDR3_OTHER", pattern: "/DRAM/SCKE*" },
    { netclass: "DDR3_OTHER", pattern: "/DRAM/SR*" },
    { netclass: "DDR3_OTHER", pattern: "/DRAM/SCAS" },
    { netclass: "DDR3_OTHER", pattern: "/DRAM/SCS*" },
    { netclass: "DDR3_OTHER", pattern: "/DRAM/SWE" },
    { netclass: "DDR3_OTHER", pattern: "/DRAM/SODT*" },
    { netclass: "DDR3_OTHER", pattern: "/DRAM/SDQM*" },
    { netclass: "DDR3_DATA_HB", pattern: "/DRAM/DQ[8-9]" },
    { netclass: "DDR3_DATA_LB", pattern: "/DRAM/DQ[0-7]" },
    { netclass: "USB", pattern: "*D+*" },
    { netclass: "USB", pattern: "*D-*" },
  ],
}

function getClassNames(kicadNetName: string, netSettings = h616NetSettings) {
  const netClasses = getKicadNetClasses({ netSettings, kicadNetName })
  return netClasses.map((netClass) => netClass.name)
}

test("KiCad net class: wildcard patterns match the whole name", () => {
  expect(getClassNames("/DRAM/SA12")).toEqual(["DDR3_ADDR", "Default"])
  expect(getClassNames("/DRAM/SCKP")).toEqual(["DDR3_DIFF", "Default"])
  // "?" is exactly one character, so SCKE0 falls through to /DRAM/SCKE*.
  expect(getClassNames("/DRAM/SCKE0")).toEqual(["DDR3_OTHER", "Default"])
  expect(getClassNames("/DRAM/SCAS")).toEqual(["DDR3_OTHER", "Default"])
  // "*D+*" is not a valid regular expression, only a wildcard.
  expect(getClassNames("/USB-UART/UART_D+")).toEqual(["USB", "Default"])
})

test("KiCad net class: regular expression patterns match", () => {
  expect(getClassNames("/DRAM/DQ8")).toEqual(["DDR3_DATA_HB", "Default"])
  expect(getClassNames("/DRAM/DQ0")).toEqual(["DDR3_DATA_LB", "Default"])
  // "/DRAM/DQ[1]|[0-9]" reads as "^/DRAM/DQ[1]" or "[0-9]$". It matches DQ15
  // from the start of the name, but DQ0 only at its last character.
  expect(getClassNames("/DRAM/DQ15")).toEqual(["DDR3_DATA_HB", "Default"])
})

test("KiCad net class: unmatched nets are in the Default class", () => {
  expect(getClassNames("GND")).toEqual(["Default"])
  expect(getClassNames("/DRAM/SDQ16")).toEqual(["Default"])
})

test("KiCad 7 and 8: a net has one class", () => {
  const netSettings: KicadNetSettings = {
    ...h616NetSettings,
    netclass_assignments: { "/DRAM/SA12": "USB", "/DRAM/SA14": "Missing" },
  }

  // DQ1 matches two patterns: the first one wins.
  expect(getClassNames("/DRAM/DQ1")).toEqual(["DDR3_DATA_HB", "Default"])
  // An assignment wins over patterns, even when its class does not exist.
  expect(getClassNames("/DRAM/SA12", netSettings)).toEqual(["USB", "Default"])
  expect(getClassNames("/DRAM/SA14", netSettings)).toEqual(["Default"])
  expect(getClassNames("/DRAM/SA15", netSettings)).toEqual([
    "DDR3_ADDR",
    "Default",
  ])
})

test("KiCad 9+: a net has every matching class, by priority", () => {
  const netSettings: KicadNetSettings = {
    ...h616NetSettings,
    meta: { version: 4 },
    classes: [
      { name: "Default", priority: 2147483647, track_width: 0.1 },
      { name: "DDR3_DATA_HB", priority: 1 },
      { name: "DDR3_DATA_LB", priority: 0, track_width: 0.0975 },
      { name: "Wide", priority: 2, track_width: 0.3 },
      { name: "Alpha", priority: 2, track_width: 0.2 },
    ],
    netclass_assignments: {
      "/DRAM/DQ1": ["Wide", "Alpha", "Missing"],
      "/DRAM/DQ15": ["Wide"],
    },
  }

  // Both patterns and every assignment apply. The lowest priority number
  // comes first, equal priorities are ordered by name.
  expect(getClassNames("/DRAM/DQ1", netSettings)).toEqual([
    "DDR3_DATA_LB",
    "DDR3_DATA_HB",
    "Alpha",
    "Wide",
    "Default",
  ])
  // DDR3_DATA_HB sets no track width, so KiCad takes the next class that does.
  const netClasses = getKicadNetClasses({
    netSettings,
    kicadNetName: "/DRAM/DQ15",
  })
  expect(netClasses.map((netClass) => netClass.track_width)).toEqual([
    undefined,
    0.3,
    0.1,
  ])
})

test("KiCad 6: a class lists its nets", () => {
  const netSettings: KicadNetSettings = {
    meta: { version: 2 },
    classes: [
      { name: "Default", track_width: 0.254, nets: [] },
      { name: "DDR3_Signal", track_width: 0.1143, nets: ["/DDR3 16x1/SA0"] },
    ],
  }

  expect(getClassNames("/DDR3 16x1/SA0", netSettings)).toEqual([
    "DDR3_Signal",
    "Default",
  ])
  expect(getClassNames("/DDR3 16x1/SA1", netSettings)).toEqual(["Default"])
})

const netNames = [
  ...["GND", "GNDA", "AGND", "VCC", "AVCC", "gnd", "+3V3", "µC_RESET"],
  ...["NET", "NET1", "NET.1", "NETx1", "NET$", "NET$1", "USB_DP", "usb_dp"],
  ...["/DRAM/S", "/DRAM/SA", "/DRAM/SA12", "/DRAM/SC", "/DRAM/SCKP"],
  ...["/DRAM/SCKE0", "/DRAM/DQ0", "/DRAM/DQ1", "/DRAM/DQ8", "/DRAM/DQ15"],
  ...["/USB/D+", "D-", "/DDR3/~{CAS}", "/DDR3/~{RS}", "/DDR3/~{WE}"],
  ...["Net-(U1-Pad1)", "Net-U1-Pad1", "CLK_P", "CLK_N"],
]

function getMatchingNetNames(pattern: string) {
  const netSettings: KicadNetSettings = {
    meta: { version: 3 },
    classes: [{ name: "Probe" }],
    netclass_patterns: [{ netclass: "Probe", pattern }],
  }
  const matchingNetNames = netNames.filter(
    (kicadNetName) =>
      getKicadNetClasses({ netSettings, kicadNetName }).length > 0,
  )
  return matchingNetNames.join(" ")
}

// The names KiCad's own matcher accepts for each pattern, out of netNames.
// Produced by a port of EDA_COMBINED_MATCHER (CTX_NETCLASS) on PCRE2, the
// regular expression engine KiCad uses, with wxWidgets' compile options.
const kicadMatchesByPattern: [string, string][] = [
  ["GND", "GND"],
  ["GN", ""],
  ["^GND", "GND"],
  ["GND$", "GND"],
  // A top-level "|" splits the anchors: "^GND" or "VCC$" from the start.
  ["GND|VCC", "GND GNDA VCC"],
  ["(GND|VCC)", "GND VCC"],
  ["VCC|", "VCC"],
  ["(?:A|)GND", "GND AGND"],
  // "." is any character as a regular expression, a dot as a wildcard.
  ["NET.1", "NET.1 NETx1 NET$1"],
  ["NET?", "NET NET1 NET$"],
  ["NET*", "NET NET1 NET.1 NETx1 NET$ NET$1"],
  // A pattern that ends in "$", even an escaped one, is not end-anchored.
  ["NET\\$", "NET$ NET$1"],
  ["NET(?!1).*", "NET NET.1 NETx1 NET$ NET$1"],
  // "A*" is also "zero or more A" and "K?" also "an optional K".
  ["/DRAM/SA*", "/DRAM/S /DRAM/SA /DRAM/SA12"],
  ["/DRAM/SCK?", "/DRAM/SC /DRAM/SCKP"],
  ["/DRAM/DQ[1]|[0-9]", "/DRAM/DQ1 /DRAM/DQ15"],
  ["/DRAM/DQ[0-7]", "/DRAM/DQ0 /DRAM/DQ1"],
  ["*D+*", "/USB/D+"],
  ["*D-*", "D-"],
  // Braces that are not a quantifier are literal.
  ["/DDR3/~{[CR]A?S}", "/DDR3/~{CAS} /DDR3/~{RS}"],
  ["/DDR3/~{WE}", "/DDR3/~{WE}"],
  // Parentheses are a group as a regular expression, literal as a wildcard.
  ["Net-(U1-Pad1)", "Net-(U1-Pad1) Net-U1-Pad1"],
  ["Net-\\(U1-Pad1\\)", "Net-(U1-Pad1)"],
  // Matching is case sensitive.
  ["usb_d[pn]", "usb_dp"],
  ["CLK_[PN]", "CLK_P CLK_N"],
  [".*_[PN]", "CLK_P CLK_N"],
  // A wildcard with a character class is neither a wildcard nor a regex.
  ["*_[PN]", ""],
  ["+3V3", "+3V3"],
  ["\\+3V3", "+3V3"],
  ["µC_*", "µC_RESET"],
  [
    "\\w+",
    "GND GNDA AGND VCC AVCC gnd NET NET1 NETx1 USB_DP usb_dp CLK_P CLK_N",
  ],
  ["[A-Z]{3}", "GND VCC NET"],
  ["*", netNames.join(" ")],
]

test("KiCad net class: patterns match the names KiCad matches", () => {
  for (const [pattern, kicadMatches] of kicadMatchesByPattern) {
    expect(isNetClassRegexSupported(pattern)).toBe(true)
    expect([pattern, getMatchingNetNames(pattern)]).toEqual([
      pattern,
      kicadMatches,
    ])
  }
})

// Regular expression syntax that only PCRE2 understands, with KiCad's matches.
// The importer reports these patterns and applies only their wildcard reading.
const unsupportedKicadMatchesByPattern: [string, string][] = [
  ["(?i)gnd", "GND gnd"],
  ["[[:upper:]]+", "GND GNDA AGND VCC AVCC NET"],
  ["CLK_\\w++", "CLK_P CLK_N"],
  ["\\AGND\\z", "GND"],
]

test("KiCad net class: PCRE2-only syntax is not evaluated", () => {
  for (const [pattern] of unsupportedKicadMatchesByPattern) {
    expect([pattern, isNetClassRegexSupported(pattern)]).toEqual([
      pattern,
      false,
    ])
    expect(getMatchingNetNames(pattern)).toBe("")
  }
})
