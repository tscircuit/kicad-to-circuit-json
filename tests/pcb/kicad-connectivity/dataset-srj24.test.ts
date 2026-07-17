import { test } from "bun:test"
import { convertKicadPcbToCircuitJson } from "../../fixtures/kicad-convert"
import {
  expectCircuitJsonConnectivityMatchesKicadDrc,
  expectCircuitJsonConnectivityMatchesKicadGencad,
  hasKicadCli,
} from "../../fixtures/kicad-gencad-netlist"
import { expectCircuitJsonTraceEndpointsMatchKicadIpc2581 } from "../../fixtures/kicad-ipc2581-physical-connectivity"
import {
  expectCircuitJsonConnectivityMatchesKicadPcbnewPhysical,
  hasKicadPcbnewPhysicalConnectivity,
} from "../../fixtures/kicad-pcbnew-physical-connectivity"

const boards = [
  {
    name: "SRJ24 Jetson Nano Baseboard",
    file: "sample001-jetson-nano-baseboard.kicad_pcb",
  },
  {
    name: "SRJ24 HDMI to MIPI CSI-2 Bridge",
    file: "sample002-hdmi-mipi-bridge.kicad_pcb",
  },
  {
    name: "SRJ24 SDI to MIPI CSI-2 Bridge",
    file: "sample003-sdi-mipi-bridge.kicad_pcb",
  },
  {
    name: "SRJ24 Thunderbolt to PCIe Adapter",
    file: "sample004-thunderbolt-pcie-adapter.kicad_pcb",
  },
  {
    name: "SRJ24 M.2 to PCIe x4 Adapter",
    file: "sample005-m2-pcie-adapter.kicad_pcb",
  },
  {
    name: "SRJ24 CM4 Baseboard LVDS Adapter",
    file: "sample006-cm4-lvds-adapter.kicad_pcb",
  },
  {
    name: "SRJ24 PMOD I3C Sensor Board",
    file: "sample007-pmod-i3c-sensor-board.kicad_pcb",
  },
  {
    name: "SRJ24 D1600E PSU Breakout Board",
    file: "sample008-d1600e-psu-breakout.kicad_pcb",
  },
  {
    name: "SRJ24 M.2 to OCuLink Adapter",
    file: "sample009-m2-oculink-adapter.kicad_pcb",
  },
  {
    name: "SRJ24 Dual I-PEX CSI Interposer",
    file: "sample010-dual-ipex-csi-interposer.kicad_pcb",
  },
] as const

const kicadConnectivityTest =
  hasKicadCli() && hasKicadPcbnewPhysicalConnectivity() ? test : test.skip

for (const board of boards) {
  const kicadPcbPath = `tests/assets/dataset-srj24/${board.file}`

  kicadConnectivityTest(
    `${board.name} connectivity matches KiCad exports`,
    () => {
      const circuitJson = convertKicadPcbToCircuitJson(kicadPcbPath)
      const gencadConnectivityCheck = {
        kicadPcbPath,
        circuitJson,
      }
      const drcConnectivityCheck = {
        kicadPcbPath,
        circuitJson,
      }
      const ipc2581PhysicalConnectivityCheck = {
        kicadPcbPath,
        circuitJson,
      }
      const pcbnewPhysicalConnectivityCheck = {
        kicadPcbPath,
        circuitJson,
      }

      expectCircuitJsonConnectivityMatchesKicadGencad(gencadConnectivityCheck)
      expectCircuitJsonConnectivityMatchesKicadPcbnewPhysical(
        pcbnewPhysicalConnectivityCheck,
      )
      expectCircuitJsonConnectivityMatchesKicadDrc(drcConnectivityCheck)
      expectCircuitJsonTraceEndpointsMatchKicadIpc2581(
        ipc2581PhysicalConnectivityCheck,
      )
    },
    600_000,
  )
}
