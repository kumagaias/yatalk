import { readFileSync } from "node:fs";

export const syntheticWebm = readFileSync(new URL("./synthetic-voice.webm", import.meta.url));
export const syntheticOgg = readFileSync(new URL("./synthetic-voice.ogg", import.meta.url));

function readVint(data: Buffer, offset: number, isId: boolean) {
  const first = data[offset];
  if (first === undefined || first === 0) return null;
  let marker = 0x80;
  let length = 1;
  while (length <= 8 && (first & marker) === 0) { marker >>= 1; length += 1; }
  if (length > 8 || offset + length > data.length) return null;
  let value = BigInt(isId ? first : first & (marker - 1));
  for (let index = 1; index < length; index += 1) value = (value << 8n) | BigInt(data[offset + index]!);
  return { value: Number(value), length, unknown: !isId && value === (1n << BigInt(7 * length)) - 1n };
}

function readElement(data: Buffer, offset: number, limit: number) {
  const id = readVint(data, offset, true);
  if (!id) return null;
  const size = readVint(data, offset + id.length, false);
  if (!size) return null;
  const start = offset + id.length + size.length;
  const end = size.unknown ? limit : start + size.value;
  if (end < start || end > limit) return null;
  return { id: id.value, offset, start, end, idLength: id.length, sizeLength: size.length, unknown: size.unknown };
}

function encodeSizeVint(value: number, width: number): Buffer {
  const encoded = (1n << BigInt(width * 7)) | BigInt(value);
  const bytes = Buffer.alloc(width);
  for (let index = width - 1; index >= 0; index -= 1) {
    bytes[index] = Number(encoded >> BigInt((width - 1 - index) * 8) & 0xffn);
  }
  return bytes;
}

function markUnknownSize(data: Buffer, offset: number, idLength: number, sizeLength: number) {
  const first = (1 << (8 - sizeLength + 1)) - 1;
  data[offset + idLength] = first;
  data.fill(0xff, offset + idLength + 1, offset + idLength + sizeLength);
}

export function overlongWebmSample(): Buffer {
  const audio = Buffer.from(syntheticWebm);
  const durationId = audio.indexOf(Buffer.from([0x44, 0x89]));
  if (durationId < 0 || (audio[durationId + 2]! & 0x7f) !== 8) throw new Error("WebM fixture has no 64-bit duration element");
  audio.writeDoubleBE(21_000, durationId + 3);
  return audio;
}

export function webmWithoutDurationAtRelativeOffset(offsetMs: number): Buffer {
  const audio = Buffer.from(syntheticWebm);
  const durationId = audio.indexOf(Buffer.from([0x44, 0x89]));
  if (durationId < 0 || (audio[durationId + 2]! & 0x7f) !== 8) throw new Error("WebM fixture has no 64-bit duration element");
  audio.writeDoubleBE(0, durationId + 3);
  const header = readElement(audio, 0, audio.length);
  const segment = header && readElement(audio, header.end, audio.length);
  if (!segment || segment.id !== 0x18538067) throw new Error("Invalid WebM fixture segment");
  for (let offset = segment.start; offset < segment.end;) {
    const element = readElement(audio, offset, segment.end);
    if (!element) throw new Error("Invalid WebM fixture element");
    if (element.id === 0x1f43b675) {
      for (let childOffset = element.start; childOffset < element.end;) {
        const child = readElement(audio, childOffset, element.end);
        if (!child) throw new Error("Invalid WebM cluster fixture");
        if (child.id === 0xa3) {
          shiftBlockTimecode(audio, child, offsetMs);
        } else if (child.id === 0xa0) {
          for (let blockOffset = child.start; blockOffset < child.end;) {
            const block = readElement(audio, blockOffset, child.end);
            if (!block) throw new Error("Invalid WebM block group fixture");
            if (block.id === 0xa1) shiftBlockTimecode(audio, block, offsetMs);
            blockOffset = block.end;
          }
        }
        childOffset = child.end;
      }
      return audio;
    }
    offset = element.end;
  }
  throw new Error("WebM fixture has no cluster");
}

function shiftBlockTimecode(audio: Buffer, block: { start: number; end: number }, offsetMs: number) {
  const track = readVint(audio, block.start, false);
  if (!track) throw new Error("Invalid WebM block track");
  const timestampOffset = block.start + track.length;
  const shifted = audio.readInt16BE(timestampOffset) + offsetMs;
  if (shifted < -32_768 || shifted > 32_767) throw new Error("Test offset does not fit WebM block timecode");
  audio.writeInt16BE(shifted, timestampOffset);
}

export function duplicateClusterTimecodeWebmSample(): Buffer {
  const header = readElement(syntheticWebm, 0, syntheticWebm.length);
  const segment = header && readElement(syntheticWebm, header.end, syntheticWebm.length);
  if (!segment || segment.id !== 0x18538067) throw new Error("Invalid WebM fixture segment");
  for (let offset = segment.start; offset < segment.end;) {
    const cluster = readElement(syntheticWebm, offset, segment.end);
    if (!cluster) throw new Error("Invalid WebM fixture element");
    if (cluster.id === 0x1f43b675) {
      let clusterEnd = cluster.end;
      if (cluster.unknown) {
        const levelIds = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1254c367, 0x1043a770, 0x1941a469]);
        for (let childOffset = cluster.start; childOffset < segment.end;) {
          const child = readElement(syntheticWebm, childOffset, segment.end);
          if (!child) throw new Error("Invalid WebM cluster fixture");
          if (levelIds.has(child.id)) { clusterEnd = child.offset; break; }
          clusterEnd = child.end;
          childOffset = child.end;
        }
      }
      let timecode = null;
      for (let childOffset = cluster.start; childOffset < clusterEnd;) {
        const child = readElement(syntheticWebm, childOffset, clusterEnd);
        if (!child) throw new Error("Invalid WebM cluster fixture");
        if (child.id === 0xe7) { timecode = child; break; }
        childOffset = child.end;
      }
      if (!timecode) throw new Error("Unexpected WebM cluster timecode");
      const duplicate = Buffer.from(syntheticWebm.subarray(timecode.offset, timecode.end));
      const increasedSize = clusterEnd - cluster.start + duplicate.length;
      const sizeBytes = encodeSizeVint(increasedSize, cluster.sizeLength);
      return Buffer.concat([
        syntheticWebm.subarray(0, cluster.offset + cluster.idLength),
        sizeBytes,
        syntheticWebm.subarray(cluster.start, timecode.end),
        duplicate,
        syntheticWebm.subarray(timecode.end, clusterEnd),
        syntheticWebm.subarray(clusterEnd),
      ]);
    }
    offset = cluster.end;
  }
  throw new Error("WebM fixture has no cluster");
}

export function unknownClusterWebmSample(): Buffer {
  const header = readElement(syntheticWebm, 0, syntheticWebm.length);
  if (!header) throw new Error("Invalid WebM fixture header");
  const segment = readElement(syntheticWebm, header.end, syntheticWebm.length);
  if (!segment || segment.id !== 0x18538067) throw new Error("Invalid WebM fixture segment");
  let cluster = null;
  for (let offset = segment.start; offset < segment.end;) {
    const element = readElement(syntheticWebm, offset, segment.end);
    if (!element) throw new Error("Invalid WebM fixture element");
    if (element.id === 0x1f43b675) { cluster = element; break; }
    offset = element.end;
  }
  if (!cluster) throw new Error("WebM fixture has no cluster");
  const first = Buffer.from(syntheticWebm.subarray(cluster.offset, cluster.end));
  markUnknownSize(first, 0, cluster.idLength, cluster.sizeLength);
  let second = Buffer.from(first);
  for (let offset = 4 + cluster.sizeLength; offset < second.length;) {
    const child = readElement(second, offset, second.length);
    if (!child) throw new Error("Invalid WebM cluster fixture");
    if (child.id === 0xe7) {
      const timestampLength = child.end - child.start;
      if (timestampLength < 2) {
        const timestamp = Buffer.alloc(2);
        timestamp.writeUInt16BE(21_000);
        second = Buffer.concat([second.subarray(0, child.start), timestamp, second.subarray(child.end)]);
        second[child.offset + child.idLength] = 0x82;
      } else second.writeUIntBE(21_000, child.start, timestampLength);
      break;
    }
    offset = child.end;
  }
  const segmentHeader = Buffer.from(syntheticWebm.subarray(0, segment.start));
  markUnknownSize(segmentHeader, segment.offset, segment.idLength, segment.sizeLength);
  return Buffer.concat([
    segmentHeader,
    syntheticWebm.subarray(segment.start, cluster.offset),
    first,
    second,
    syntheticWebm.subarray(cluster.end, segment.end),
  ]);
}
