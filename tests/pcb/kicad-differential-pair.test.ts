import { expect, test } from "bun:test"
import {
  getKicadDifferentialPairPartnerName,
  isKicadDifferentialPairNet,
} from "../../lib/stages/pcb/get-kicad-differential-pair-partner-name"
import {
  getKicadNetClasses,
  getKicadNetTraceWidth,
} from "../../lib/stages/pcb/get-kicad-net-class"
import type { KicadNetSettings } from "../../lib/types"

test("KiCad differential pair: the partner has the opposite polarity", () => {
  // Net name, and the partner DRC_ENGINE::MatchDpSuffix gives it.
  const partnerNameByNetName: [string, string | undefined][] = [
    ["/DRAM/SDQS0P", "/DRAM/SDQS0N"],
    ["/DRAM/SCKN", "/DRAM/SCKP"],
    ["USB_D+", "USB_D-"],
    ["D-", "D+"],
    ["CLK_P", "CLK_N"],
    ["HDMI_TX2P", "HDMI_TX2N"],
    // Digits and underscores after the polarity stay where they are.
    ["CLK_N1", "CLK_P1"],
    ["LVDS_P_12", "LVDS_N_12"],
    ["TX+_", "TX-_"],
    ["N7", "P7"],
    ["P", "N"],
    // The last character that is not a digit or an underscore decides.
    ["GND", undefined],
    ["/DRAM/DQ9", undefined],
    ["/DRAM/SDQM1", undefined],
    ["CLK_PA", undefined],
    ["D+A", undefined],
    ["RESET#", undefined],
    // The polarity is case sensitive.
    ["clk_p", undefined],
    ["42", undefined],
    ["_", undefined],
    ["", undefined],
  ]

  for (const [kicadNetName, partnerName] of partnerNameByNetName) {
    expect([
      kicadNetName,
      getKicadDifferentialPairPartnerName(kicadNetName),
    ]).toEqual([kicadNetName, partnerName])
  }
})

test("KiCad differential pair: a net is paired only when its partner is on the board", () => {
  const kicadNetNames = new Set([
    "CLK_P",
    "CLK_N",
    "RESET_N",
    "RESET",
    "TX_P1",
    "TX_N2",
    "GND",
  ])
  const pairedNetNames = [...kicadNetNames].filter((kicadNetName) =>
    isKicadDifferentialPairNet({ kicadNetName, kicadNetNames }),
  )

  // RESET_N has a polarity but no RESET_P, and TX_P1 pairs with TX_N1.
  expect(pairedNetNames).toEqual(["CLK_P", "CLK_N"])
})

const kicadNetNames = new Set(["USB_D+", "USB_D-", "USB_ID", "CLK_P", "GND"])

function getTraceWidth(netSettings: KicadNetSettings, kicadNetName: string) {
  return getKicadNetTraceWidth({
    netSettings,
    netClasses: getKicadNetClasses({ netSettings, kicadNetName }),
    isDifferentialPairNet: isKicadDifferentialPairNet({
      kicadNetName,
      kicadNetNames,
    }),
  })
}

test("KiCad differential pair: paired nets take the differential pair width", () => {
  // KiCad 7 and 8.
  const netSettings: KicadNetSettings = {
    meta: { version: 3 },
    classes: [
      { name: "Default", track_width: 0.25, diff_pair_width: 0.2 },
      { name: "USB", track_width: 0.3, diff_pair_width: 0.15 },
    ],
    netclass_patterns: [
      { netclass: "USB", pattern: "USB_*" },
      { netclass: "USB", pattern: "CLK_P" },
    ],
  }

  expect(getTraceWidth(netSettings, "USB_D+")).toBe(0.15)
  expect(getTraceWidth(netSettings, "USB_D-")).toBe(0.15)
  // In the class, but not one side of a pair.
  expect(getTraceWidth(netSettings, "USB_ID")).toBe(0.3)
  // A polarity, but CLK_N is not on the board.
  expect(getTraceWidth(netSettings, "CLK_P")).toBe(0.3)
  expect(getTraceWidth(netSettings, "GND")).toBe(0.25)
})

test("KiCad differential pair: paired nets of the Default class take its differential pair width", () => {
  const netSettings: KicadNetSettings = {
    meta: { version: 3 },
    classes: [{ name: "Default", track_width: 0.25, diff_pair_width: 0.2 }],
  }

  expect(getTraceWidth(netSettings, "USB_D+")).toBe(0.2)
  expect(getTraceWidth(netSettings, "USB_ID")).toBe(0.25)
})

test("KiCad differential pair: before KiCad 9 only the net's own class gives the width", () => {
  // KiCad 6 to 8 make the diff pair rule per class, and none for a class
  // with a zero differential pair width: the pair keeps the track width of
  // its class instead of taking the differential pair width of Default.
  const netSettings: KicadNetSettings = {
    meta: { version: 3 },
    classes: [
      { name: "Default", track_width: 0.25, diff_pair_width: 0.2 },
      { name: "USB", track_width: 0.3, diff_pair_width: 0 },
    ],
    netclass_patterns: [{ netclass: "USB", pattern: "USB_*" }],
  }

  expect(getTraceWidth(netSettings, "USB_D+")).toBe(0.3)
})

test("KiCad differential pair: KiCad 6 classes list their nets", () => {
  const netSettings: KicadNetSettings = {
    meta: { version: 2 },
    classes: [
      { name: "Default", track_width: 0.25, diff_pair_width: 0.2 },
      {
        name: "USB",
        track_width: 0.3,
        diff_pair_width: 0.15,
        nets: ["USB_D+", "USB_D-", "USB_ID"],
      },
    ],
  }

  expect(getTraceWidth(netSettings, "USB_D+")).toBe(0.15)
  expect(getTraceWidth(netSettings, "USB_ID")).toBe(0.3)
})

test("KiCad differential pair: KiCad 9+ takes the width from the first class that sets it", () => {
  const netSettings: KicadNetSettings = {
    meta: { version: 4 },
    classes: [
      { name: "Default", track_width: 0.25, diff_pair_width: 0.2 },
      // Sets a track width only.
      { name: "IMPEDANCE", priority: 0, track_width: 0.3 },
      { name: "USB", priority: 1, diff_pair_width: 0.15 },
      // Sets neither width.
      { name: "COLOR", priority: 0 },
    ],
    netclass_patterns: [
      { netclass: "USB", pattern: "USB_D?" },
      { netclass: "IMPEDANCE", pattern: "USB_*" },
      { netclass: "COLOR", pattern: "CLK_*" },
    ],
    netclass_assignments: { GND: ["COLOR"] },
  }

  expect(getTraceWidth(netSettings, "USB_D+")).toBe(0.15)
  expect(getTraceWidth(netSettings, "USB_ID")).toBe(0.3)
  // Neither a class of its own with a width nor a partner.
  expect(getTraceWidth(netSettings, "CLK_P")).toBe(0.25)

  // A paired net whose classes set no differential pair width takes the one
  // of Default.
  const pairedNetNames = new Set(["CLK_P", "CLK_N"])
  expect(
    getKicadNetTraceWidth({
      netSettings,
      netClasses: getKicadNetClasses({ netSettings, kicadNetName: "CLK_P" }),
      isDifferentialPairNet: isKicadDifferentialPairNet({
        kicadNetName: "CLK_P",
        kicadNetNames: pairedNetNames,
      }),
    }),
  ).toBe(0.2)
})
