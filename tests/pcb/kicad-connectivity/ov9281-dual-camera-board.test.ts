import { test } from "bun:test"
import { convertKicadPcbToCircuitJson } from "../../fixtures/kicad-convert"
import {
  expectCircuitJsonConnectivityMatchesKicadDrc,
  expectCircuitJsonConnectivityMatchesKicadGencad,
  hasKicadCli,
} from "../../fixtures/kicad-gencad-netlist"
import { expectCircuitJsonTraceEndpointsMatchKicadIpc2581 } from "../../fixtures/kicad-ipc2581-physical-connectivity"

const kicadPcbPath =
  "tests/repros/ov9281-dual-camera-board/ov9281-dual-camera-board.kicad_pcb"
const kicadCliTest = hasKicadCli() ? test : test.skip

kicadCliTest(
  "OV9281 Dual Camera Board connectivity matches KiCad exports",
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

    expectCircuitJsonConnectivityMatchesKicadGencad(gencadConnectivityCheck)
    expectCircuitJsonConnectivityMatchesKicadDrc(drcConnectivityCheck)
    expectCircuitJsonTraceEndpointsMatchKicadIpc2581(
      ipc2581PhysicalConnectivityCheck,
    )
  },
  180_000,
)
