import { readFile } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528

interface FrameRange {
  start: number
  end: number
}

function scanCompleteFrames(buffer: Buffer): FrameRange[] {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`Corrupt DSH zstd session artifact: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`Corrupt DSH zstd session artifact: reserved frame header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    let torn = false
    for (;;) {
      if (buffer.length - offset < 3) {
        torn = true
        break
      }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`Corrupt DSH zstd session artifact: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) {
        torn = true
        break
      }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (torn) break
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

export async function readSessionArtifact(path: string): Promise<Buffer> {
  const content = await readFile(path)
  if (path.endsWith('.zstd')) {
    try {
      const frames = scanCompleteFrames(content)
      if (frames.length === 0) throw new Error('artifact has no complete Zstandard frame')
      return Buffer.concat(frames.map(({ start, end }) => zstdDecompressSync(content.subarray(start, end))))
    } catch (error) {
      throw new Error(`Unable to decode DSH zstd session artifact: ${(error as Error).message}`, { cause: error })
    }
  }
  return content
}
