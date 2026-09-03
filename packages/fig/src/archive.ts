import { unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate'

import type { FigPageManifestEntry } from '@open-pencil/kiwi/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { buildFigKiwi, parseFigKiwiChunks } from '@open-pencil/kiwi/fig/container'
import { decodeFigKiwiCanvas } from '@open-pencil/kiwi/fig/parse'

import { firstPageImageHashes } from './node-change/image-refs'
import { hasPNGSignature } from './thumbnail'

export interface FigImageEntry {
  name: string
  data: Uint8Array
}

export interface WriteFigArchiveInput {
  schemaDeflated: Uint8Array
  kiwiData: Uint8Array
  thumbnailPNG: Uint8Array
  metaJSON: string
  images?: FigImageEntry[]
  figKiwiVersion?: number
}

export interface FigParseResult {
  nodeChanges: NodeChange[]
  blobs: Uint8Array[]
  images: Array<[string, Uint8Array]>
  figKiwiVersion: number
  /** Deflated Kiwi schema bytes from the original file, retained for round-trip fidelity. */
  figSchemaDeflated: Uint8Array
  thumbnailPNG: Uint8Array | null
  metaJSON: string | null
}

function isLikelyAsset(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.json')
}

function findCanvasData(entries: Partial<Record<string, Uint8Array>>): Uint8Array | null {
  const canonical = entries['canvas.fig'] ?? entries.canvas
  if (canonical) return canonical

  let largest: Uint8Array | null = null
  for (const [name, data] of Object.entries(entries)) {
    if (!data || isLikelyAsset(name)) continue
    if (!largest || data.byteLength > largest.byteLength) largest = data
  }
  return largest
}

function isCanonicalCanvasEntry(name: string): boolean {
  return name === 'canvas.fig' || name === 'canvas'
}

// When `neededHashes` is given, image entries outside that set are
// skipped by fflate's unzipSync entirely — never inflated, not just
// dropped afterward — so a large file's non-first-page images never
// cost memory to open in the first place. Anything not an `images/*`
// entry (meta.json, thumbnail.png) is always kept.
function unzipEntryFilter(neededHashes: Set<string> | null) {
  return ({ name }: { name: string }) => {
    if (isCanonicalCanvasEntry(name)) return false
    if (!neededHashes || !name.startsWith('images/')) return true
    return neededHashes.has(name.slice('images/'.length))
  }
}

function parseRawFigKiwi(
  bytes: Uint8Array,
  onPages?: (pages: FigPageManifestEntry[]) => void
): FigParseResult | null {
  const chunks = parseFigKiwiChunks(bytes)
  if (!chunks) return null

  const decoded = decodeFigKiwiCanvas(bytes, onPages)
  const thumbnailPNG = chunks.slice(2).find(hasPNGSignature) ?? null
  return { ...decoded, images: [], thumbnailPNG, metaJSON: null }
}

export interface ParseFigBufferOptions {
  /**
   * Only decompress images referenced by the first page, instead of
   * every image in the file. The caller must be able to fetch the rest
   * later (see population/client.ts's registerImagesRequest in
   * packages/core) — a document opened this way will show missing
   * images on any other page until something requests them.
   */
  limitToFirstPage?: boolean
}

/** Parse a complete zipped or legacy raw `.fig` file into its protocol payload and resources. */
export function parseFigBuffer(
  buffer: ArrayBuffer,
  onPages?: (pages: FigPageManifestEntry[]) => void,
  options?: ParseFigBufferOptions
): FigParseResult {
  const bytes = new Uint8Array(buffer)
  const raw = parseRawFigKiwi(bytes, onPages)
  if (raw) return raw

  const canvasArchive = unzipSync(bytes, { filter: ({ name }) => isCanonicalCanvasEntry(name) })
  let canvasData = findCanvasData(canvasArchive)
  let archive: Unzipped
  let decoded: ReturnType<typeof decodeFigKiwiCanvas>
  if (canvasData) {
    decoded = decodeFigKiwiCanvas(canvasData, onPages)
    const neededHashes = options?.limitToFirstPage
      ? firstPageImageHashes(decoded.nodeChanges)
      : null
    archive = unzipSync(bytes, { filter: unzipEntryFilter(neededHashes) })
  } else {
    archive = unzipSync(bytes)
    canvasData = findCanvasData(archive)
    if (!canvasData) {
      throw new Error(
        `No canvas data found in .fig file. Entries: ${Object.keys(archive).join(', ')}`
      )
    }
    decoded = decodeFigKiwiCanvas(canvasData, onPages)
  }

  const metaBytes = archive['meta.json']
  const images = Object.entries(archive)
    .filter(([name]) => name.startsWith('images/') && name !== 'images/')
    .map(([name, data]) => [name.slice('images/'.length), data] as [string, Uint8Array])

  return {
    ...decoded,
    images,
    thumbnailPNG: archive['thumbnail.png'] ?? null,
    metaJSON: Object.hasOwn(archive, 'meta.json') ? new TextDecoder().decode(metaBytes) : null
  }
}

/**
 * Decompresses just the given image hashes out of a `.fig` archive's raw
 * (still-zipped) bytes — the counterpart to parseFigBuffer's
 * `limitToFirstPage`. Whoever retains the original archive bytes after
 * an initial limited parse (see session/worker.ts) can use this to
 * decompress additional images on demand, as they're actually needed,
 * rather than having decompressed nothing-in-particular being a
 * permanent gap.
 */
export function extractFigImages(
  buffer: ArrayBuffer,
  hashes: Iterable<string>
): Array<[string, Uint8Array]> {
  const wanted = new Set(hashes)
  if (wanted.size === 0) return []
  const bytes = new Uint8Array(buffer)
  const decompressed = unzipSync(bytes, {
    filter: ({ name }) => name.startsWith('images/') && wanted.has(name.slice('images/'.length))
  })
  return Object.entries(decompressed).map(([name, data]) => [name.slice('images/'.length), data])
}

/** Assemble a complete zipped `.fig` archive from an encoded Kiwi message and resources. */
export function writeFigArchive(input: WriteFigArchiveInput): Uint8Array {
  const canvasData = buildFigKiwi(input.schemaDeflated, input.kiwiData, input.figKiwiVersion)
  const entries: Zippable = {
    'canvas.fig': [canvasData, { level: 0 }],
    'thumbnail.png': [input.thumbnailPNG, { level: 0 }],
    'meta.json': new TextEncoder().encode(input.metaJSON)
  }
  for (const image of input.images ?? []) entries[image.name] = [image.data, { level: 0 }]
  return zipSync(entries)
}

/** Compatibility signature used by core while archive assembly migrates to this package. */
export function compressFigDataSync(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: FigImageEntry[],
  figKiwiVersion?: number
): Uint8Array {
  return writeFigArchive({
    schemaDeflated,
    kiwiData,
    thumbnailPNG,
    metaJSON,
    images: imageEntries,
    figKiwiVersion
  })
}
