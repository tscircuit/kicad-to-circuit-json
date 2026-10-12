import { testKicadArduinoBoardSnapshot } from "./kicad-arduino-board-snapshot"

testKicadArduinoBoardSnapshot({
  name: "arduino-leonardo",
  path: "KiCad Projects/Arduino Leonardo/Arduino Leonardo.kicad_pcb",
  testFilePath: import.meta.path,
})
