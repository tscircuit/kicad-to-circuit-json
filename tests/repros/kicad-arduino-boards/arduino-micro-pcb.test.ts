import { testKicadArduinoBoardSnapshot } from "./kicad-arduino-board-snapshot"

testKicadArduinoBoardSnapshot({
  name: "arduino-micro",
  path: "KiCad Projects/Arduino Micro/Arduino Micro.kicad_pcb",
  testFilePath: import.meta.path,
})
