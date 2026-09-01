import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const reference = {
  filename: "hsp-usb-led.kicad_sch",
  sha256: "425a817f1c236363eefd6ff8cb23365d2641a43d5f1e057191497046dcf20d75",
  source:
    "nushackers/hsp-pcb-intro@ad3fbd582e3915b585c453ea202f591720a1f427 (CERN-OHL-P-2.0)",
  url: "https://raw.githubusercontent.com/nushackers/hsp-pcb-intro/ad3fbd582e3915b585c453ea202f591720a1f427/src/usb_led.kicad_sch",
}

const response = await fetch(reference.url)
if (!response.ok) {
  throw new Error(
    `${reference.url} (${response.status} ${response.statusText})`,
  )
}

const bytes = new Uint8Array(await response.arrayBuffer())
const actualHash = createHash("sha256").update(bytes).digest("hex")
if (actualHash !== reference.sha256) {
  throw new Error(
    `${reference.filename} SHA-256 mismatch: expected ${reference.sha256}, got ${actualHash}`,
  )
}

const referencesDirectory = resolve(import.meta.dir, "..", "references")
await mkdir(referencesDirectory, { recursive: true })
await writeFile(resolve(referencesDirectory, reference.filename), bytes)
console.log(
  `Saved ${reference.filename} (${bytes.byteLength} bytes) from ${reference.source}`,
)
