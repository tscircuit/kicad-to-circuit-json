import { testKicadArduinoBoardSnapshot } from "./kicad-arduino-board-snapshot"

testKicadArduinoBoardSnapshot({
  name: "arduino-uno-r3",
  path: "KiCad Projects/Uno/Arduino Uno/Arduino UNO.kicad_pcb",
  testFilePath: import.meta.path,
})
