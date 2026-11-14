import { expect, test } from "bun:test"
import { getKicadNetClass } from "../../lib/stages/pcb/get-kicad-net-class"
import type { KicadProjectNetSettings } from "../../lib/types"

// Net classes and patterns of the Allwinner H616 devboard project, in the
// order KiCad 8 saved them.
const netSettings: KicadProjectNetSettings = {
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

function getNetClassName(kicadNetName: string) {
  return getKicadNetClass({ netSettings, kicadNetName })?.name
}

test("KiCad net class: wildcard patterns match the whole name", () => {
  expect(getNetClassName("/DRAM/SA12")).toBe("DDR3_ADDR")
  expect(getNetClassName("/DRAM/SCKP")).toBe("DDR3_DIFF")
  // "?" is exactly one character, so SCKE0 falls through to /DRAM/SCKE*.
  expect(getNetClassName("/DRAM/SCKE0")).toBe("DDR3_OTHER")
  expect(getNetClassName("/DRAM/SCAS")).toBe("DDR3_OTHER")
  // "*D+*" is not a valid regular expression, only a wildcard.
  expect(getNetClassName("/USB-UART/UART_D+")).toBe("USB")
})

test("KiCad net class: regular expression patterns match", () => {
  expect(getNetClassName("/DRAM/DQ8")).toBe("DDR3_DATA_HB")
  expect(getNetClassName("/DRAM/DQ0")).toBe("DDR3_DATA_LB")
  // "/DRAM/DQ[1]|[0-9]" reads as "^/DRAM/DQ[1]" or "[0-9]$". It matches DQ15
  // from the start of the name, but DQ0 only at its last character.
  expect(getNetClassName("/DRAM/DQ15")).toBe("DDR3_DATA_HB")
})

test("KiCad net class: unmatched nets are in the Default class", () => {
  expect(getNetClassName("GND")).toBe("Default")
  expect(getNetClassName("/DRAM/SDQ16")).toBe("Default")
})

test("KiCad net class: an explicit assignment wins over patterns", () => {
  const assignedNetSettings: KicadProjectNetSettings = {
    ...netSettings,
    // KiCad 8 saves one class name per net, KiCad 9 a list of them.
    netclass_assignments: {
      "/DRAM/SA12": "USB",
      "/DRAM/SA13": ["DDR3_DIFF"],
      "/DRAM/SA14": "Missing",
    },
  }
  const netNames = ["/DRAM/SA12", "/DRAM/SA13", "/DRAM/SA14", "/DRAM/SA15"]
  const netClasses = netNames.map((kicadNetName) =>
    getKicadNetClass({ netSettings: assignedNetSettings, kicadNetName }),
  )

  // KiCad uses the Default class when the assigned class does not exist, and
  // /DRAM/SA15 has no assignment, so its pattern still applies.
  expect(netClasses.map((netClass) => netClass?.name)).toEqual([
    "USB",
    "DDR3_DIFF",
    "Default",
    "DDR3_ADDR",
  ])
})
