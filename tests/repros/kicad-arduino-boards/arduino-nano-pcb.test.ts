import { testKicadArduinoBoardSnapshot } from "./kicad-arduino-board-snapshot"

testKicadArduinoBoardSnapshot({
  name: "arduino-nano",
  path: "KiCad Projects/Arduino Nano/Arduino Nano.kicad_pcb",
  testFilePath: import.meta.path,
})
