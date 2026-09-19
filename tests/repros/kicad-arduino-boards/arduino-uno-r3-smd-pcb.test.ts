import { testKicadArduinoBoardSnapshot } from "./kicad-arduino-board-snapshot"

testKicadArduinoBoardSnapshot({
  name: "arduino-uno-r3-smd",
  path: "KiCad Projects/Uno/Arduino Uno SMD/Arduino Uno SMD.kicad_pcb",
  testFilePath: import.meta.path,
})
