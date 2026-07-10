import {
  KicadFootprintToCircuitJsonConverter,
  KicadSymbolToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "@project-lib"
import type { SimpleRouteJson } from "@tscircuit/core"
import {
  type ChangeEvent,
  type DragEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react"

type CircuitJson = ReturnType<KicadToCircuitJsonConverter["getOutput"]>
type ConversionStats = NonNullable<
  ReturnType<KicadToCircuitJsonConverter["getStats"]>
>
type SupportedKiCadInputKind =
  | "footprint"
  | "pcb"
  | "schematic"
  | "symbol-library"

const statLabels: Record<string, string> = {
  components: "Components",
  copper_pours: "Copper pours",
  labels: "Labels",
  pads: "Pads",
  traces: "Traces",
  vias: "Vias",
}
const runframeStandalonePreviewUrl =
  "https://unpkg.com/@tscircuit/runframe@0.0.1799/dist/standalone-preview.min.js"

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [circuitJson, setCircuitJson] = useState<CircuitJson | null>(null)
  const [simpleRouteJson, setSimpleRouteJson] =
    useState<SimpleRouteJson | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [isFrameLoading, setIsFrameLoading] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [stats, setStats] = useState<ConversionStats>({})
  const deferredCircuitJson = useDeferredValue(circuitJson)

  useEffect(() => {
    if (!deferredCircuitJson) {
      setFrameUrl(null)
      setIsFrameLoading(false)
      return
    }

    const inputKind = inferInputKind(fileName)
    const html = createRunframeHtml({
      circuitJson: deferredCircuitJson,
      defaultActiveTab:
        inputKind === "pcb" || inputKind === "footprint" ? "pcb" : "schematic",
      projectName: getOutputBaseName(fileName),
    })
    const nextFrameUrl = URL.createObjectURL(
      new Blob([html], { type: "text/html" }),
    )

    setFrameUrl(nextFrameUrl)
    setIsFrameLoading(true)

    return () => {
      URL.revokeObjectURL(nextFrameUrl)
    }
  }, [deferredCircuitJson, fileName])

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const [file] = Array.from(event.dataTransfer.files)
    if (file) {
      void convertFile(file)
    }
  }

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    if (file) {
      void convertFile(file)
    }
    event.target.value = ""
  }

  const convertFile = async (file: File) => {
    const nextFileName = file.name
    const inputKind = inferInputKind(nextFileName)

    setIsConverting(true)
    setErrorMessage(null)
    setIsDragging(false)

    if (!inputKind) {
      startTransition(() => {
        setCircuitJson(null)
        setSimpleRouteJson(null)
        setErrorMessage(
          "Drop a .kicad_mod, .kicad_pcb, .kicad_sch, or .kicad_sym file.",
        )
        setFileName(nextFileName)
        setFrameUrl(null)
        setWarnings([])
        setStats({})
      })
      setIsConverting(false)
      return
    }

    try {
      const fileContents = await file.text()

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve())
      })

      const converter =
        inputKind === "footprint"
          ? new KicadFootprintToCircuitJsonConverter()
          : inputKind === "symbol-library"
            ? new KicadSymbolToCircuitJsonConverter()
            : new KicadToCircuitJsonConverter()
      converter.addFile(nextFileName, fileContents)
      converter.runUntilFinished()

      const nextCircuitJson = converter.getOutput()
      const nextWarnings = [...converter.getWarnings()]
      let nextSimpleRouteJson: SimpleRouteJson | null = null

      try {
        const { getSimpleRouteJsonFromCircuitJson } = await import(
          "@tscircuit/core"
        )
        nextSimpleRouteJson = getSimpleRouteJsonFromCircuitJson({
          circuitJson: stripRoutesForSimpleRouteExport(nextCircuitJson),
          ignoreExistingTopLevelPcbRouteState: true,
        }).simpleRouteJson
      } catch (error) {
        nextWarnings.push(
          `Simple Route JSON export unavailable: ${
            error instanceof Error ? error.message : "Unknown error."
          }`,
        )
      }

      startTransition(() => {
        setCircuitJson(nextCircuitJson)
        setSimpleRouteJson(nextSimpleRouteJson)
        setErrorMessage(null)
        setFileName(nextFileName)
        setWarnings(nextWarnings)
        setStats(converter.getStats())
      })
    } catch (error) {
      startTransition(() => {
        setCircuitJson(null)
        setSimpleRouteJson(null)
        setErrorMessage(
          error instanceof Error ? error.message : "Conversion failed.",
        )
        setFileName(nextFileName)
        setFrameUrl(null)
        setWarnings([])
        setStats({})
      })
    } finally {
      setIsConverting(false)
    }
  }

  const statsEntries = Object.entries(stats).filter(
    ([, value]) => typeof value === "number",
  )
  const outputBaseName = getOutputBaseName(fileName)

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="eyebrow">KiCad to Circuit JSON</div>
        <h1>Convert KiCad to Circuit JSON in browser</h1>
        <p className="lede">
          This viewer reads <code>.kicad_mod</code>, <code>.kicad_pcb</code>,{" "}
          <code>.kicad_sch</code>, and <code>.kicad_sym</code> files, converts
          them with the local library source, and opens the result in the
          tscircuit runframe preview.
        </p>

        <div
          className={`dropzone${isDragging ? " dropzone-dragging" : ""}`}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".kicad_mod,.kicad_pcb,.kicad_sch,.kicad_sym"
            onChange={handleFileSelection}
          />
          <div className="dropzone-copy">
            <span className="dropzone-badge">Drag and drop</span>
            <strong>
              KiCad footprint, PCB, schematic, or symbol library files
            </strong>
            <p>
              or browse for a local footprint, board, schematic, or library file
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </button>
        </div>

        <div className="meta-grid">
          <article className="meta-card">
            <span className="meta-label">Source</span>
            <strong>{fileName ?? "No file loaded"}</strong>
          </article>
          <article className="meta-card">
            <span className="meta-label">Elements</span>
            <strong>{circuitJson?.length ?? 0}</strong>
          </article>
          <article className="meta-card">
            <span className="meta-label">Warnings</span>
            <strong>{warnings.length}</strong>
          </article>
        </div>

        {circuitJson ? (
          <section className="panel">
            <div className="panel-header">
              <h2>Downloads</h2>
            </div>
            <div className="download-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  downloadJsonFile(
                    circuitJson,
                    `${outputBaseName}.circuit.json`,
                  )
                }
              >
                Download Circuit JSON
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!simpleRouteJson}
                onClick={() => {
                  if (!simpleRouteJson) return
                  downloadJsonFile(
                    simpleRouteJson,
                    `${outputBaseName}.simple-route.json`,
                  )
                }}
              >
                Download Simple Route JSON
              </button>
            </div>
          </section>
        ) : null}

        {isConverting ? (
          <section className="notice-panel">
            <strong>Converting KiCad file…</strong>
            <p>Large KiCad files can take a moment in the main thread.</p>
          </section>
        ) : null}

        {errorMessage ? (
          <section className="notice-panel notice-panel-error">
            <strong>Conversion error</strong>
            <p>{errorMessage}</p>
          </section>
        ) : null}

        {statsEntries.length > 0 ? (
          <section className="panel">
            <div className="panel-header">
              <h2>Extracted elements</h2>
            </div>
            <div className="stats-list">
              {statsEntries.map(([key, value]) => (
                <div className="stat-chip" key={key}>
                  <span>{statLabels[key] ?? key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {warnings.length > 0 ? (
          <section className="panel">
            <div className="panel-header">
              <h2>Warnings</h2>
            </div>
            <ul className="warning-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>

      <section className="viewer-panel">
        {frameUrl ? (
          <div className="viewer-frame-shell">
            {isFrameLoading ? (
              <div className="viewer-loading">Rendering runframe preview…</div>
            ) : null}
            <iframe
              className="viewer-iframe"
              title="Circuit JSON preview"
              src={frameUrl}
              sandbox="allow-downloads allow-same-origin allow-scripts"
              onLoad={() => setIsFrameLoading(false)}
            />
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-state-badge">Preview idle</span>
            <h2>The converted Circuit JSON will appear here.</h2>
            <p>
              Load a KiCad footprint, PCB, schematic, or symbol library file to
              open the schematic, PCB, CAD, and raw Circuit JSON tabs in the
              embedded viewer.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

function stripRoutesForSimpleRouteExport(
  circuitJson: CircuitJson,
): CircuitJson {
  return circuitJson.filter(
    (element) =>
      element?.type !== "pcb_trace" &&
      element?.type !== "pcb_copper_pour" &&
      element?.type !== "pcb_via",
  )
}

function createRunframeHtml({
  circuitJson,
  defaultActiveTab,
  projectName,
}: {
  circuitJson: CircuitJson
  defaultActiveTab: "pcb" | "schematic"
  projectName: string
}) {
  const serializedCircuitJson = serializeForInlineScript(circuitJson)
  const serializedPreviewProps = serializeForInlineScript({
    availableTabs: ["schematic", "pcb", "cad", "circuit_json"],
    autoRotate3dViewerDisabled: true,
    defaultActiveTab,
    isWebEmbedded: true,
    projectName,
    showCodeTab: false,
    showFileMenu: false,
    showJsonTab: true,
    showRightHeaderContent: false,
    showToggleFullScreen: true,
  })

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body, #root {
        height: 100%;
        margin: 0;
      }

      body {
        background: #f8fafb;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.CIRCUIT_JSON = ${serializedCircuitJson};
      window.CIRCUIT_JSON_PREVIEW_PROPS = ${serializedPreviewProps};
    </script>
    <script src="${runframeStandalonePreviewUrl}"></script>
  </body>
</html>`
}

function serializeForInlineScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
}

function getOutputBaseName(fileName: string | null) {
  if (!fileName) return "board"
  return fileName.replace(/\.(kicad_mod|kicad_pcb|kicad_sch|kicad_sym)$/i, "")
}

function inferInputKind(
  fileName: string | null,
): SupportedKiCadInputKind | null {
  if (!fileName) return null
  const normalizedFileName = fileName.toLowerCase()
  if (normalizedFileName.endsWith(".kicad_mod")) return "footprint"
  if (normalizedFileName.endsWith(".kicad_pcb")) return "pcb"
  if (normalizedFileName.endsWith(".kicad_sch")) return "schematic"
  if (normalizedFileName.endsWith(".kicad_sym")) return "symbol-library"
  return null
}

function downloadJsonFile(data: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = fileName
  link.click()

  URL.revokeObjectURL(url)
}
