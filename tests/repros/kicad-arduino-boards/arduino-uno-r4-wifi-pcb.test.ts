import { testKicadArduinoBoardSnapshot } from "./kicad-arduino-board-snapshot"

testKicadArduinoBoardSnapshot({
  name: "arduino-uno-r4-wifi",
  path: "KiCad Projects/Uno/Arduino UNO R4 WiFi/Arduino UNO R4 WiFi.kicad_pcb",
  testFilePath: import.meta.path,
})
