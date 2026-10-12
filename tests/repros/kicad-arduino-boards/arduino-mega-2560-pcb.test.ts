import { testKicadArduinoBoardSnapshot } from "./kicad-arduino-board-snapshot"

testKicadArduinoBoardSnapshot({
  name: "arduino-mega-2560",
  path: "KiCad Projects/Arduino Mega 2560/Arduino Mega 2560.kicad_pcb",
  testFilePath: import.meta.path,
})
