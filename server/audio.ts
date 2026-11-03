import type { SupportedAudioMimeType } from "./services/ai.js";

export const MAX_AUDIO_BYTES = 256 * 1024;
export const MAX_AUDIO_SECONDS = 20;
const EBML_HEADER = 0x1a45dfa3;
const EBML_SEGMENT = 0x18538067;
const MAX_OPUS_PACKET_SECONDS = 0.12;

type Vint = { value: bigint; length: number; unknown: boolean };
type EbmlElement = { id: number; start: number; end: number; unknown: boolean };
const segmentLevelIds = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1254c367, 0x1043a770, 0x1941a469]);

function readVint(data: Buffer, offset: number, forId: boolean): Vint | null {
  const first = data[offset];
  if (first === undefined || first === 0) return null;
  let marker = 0x80;
  let length = 1;
  while (length <= 8 && (first & marker) === 0) { marker >>= 1; length += 1; }
  if (length > 8 || offset + length > data.length) return null;
  let value = BigInt(forId ? first : first & (marker - 1));
  for (let index = 1; index < length; index += 1) value = (value << 8n) | BigInt(data[offset + index]!);
  const unknown = !forId && value === (1n << BigInt(7 * length)) - 1n;
  return { value, length, unknown };
}

function readElement(data: Buffer, offset: number, limit: number): EbmlElement | null {
  const id = readVint(data, offset, true);
  if (!id) return null;
  const size = readVint(data, offset + id.length, false);
  if (!size) return null;
  const start = offset + id.length + size.length;
  const end = size.unknown ? limit : start + Number(size.value);
  if (!Number.isSafeInteger(end) || end < start || end > limit) return null;
  return { id: Number(id.value), start, end, unknown: size.unknown };
}

function readSegmentChildren(data: Buffer, segment: EbmlElement): EbmlElement[] | null {
  const children: EbmlElement[] = [];
  for (let offset = segment.start; offset < segment.end;) {
    let child = readElement(data, offset, segment.end);
    if (!child) return null;
    if (child.id === 0x1f43b675 && child.unknown) {
      let boundary = child.start;
      while (boundary < segment.end) {
        const candidate = readElement(data, boundary, segment.end);
        if (!candidate) return null;
        if (segmentLevelIds.has(candidate.id)) break;
        boundary = candidate.end;
      }
      child = { ...child, end: boundary };
    }
    children.push(child);
    offset = child.end;
  }
  return children;
}

function readUnsigned(data: Buffer, start: number, end: number): number | null {
  const length = end - start;
  if (length < 1 || length > 8) return null;
  let value = 0n;
  for (let index = start; index < end; index += 1) value = (value << 8n) | BigInt(data[index]!);
  return Number(value);
}

function parseDocType(data: Buffer, header: EbmlElement): boolean {
  for (let offset = header.start; offset < header.end;) {
    const element = readElement(data, offset, header.end);
    if (!element) return false;
    if (element.id === 0x4282 && data.toString("ascii", element.start, element.end) === "webm") return true;
    offset = element.end;
  }
  return false;
}

function parseInfo(data: Buffer, info: EbmlElement): { scale: number; durationSeconds: number | null } | null {
  let scale = 1_000_000;
  let durationTicks: number | null = null;
  for (let offset = info.start; offset < info.end;) {
    const element = readElement(data, offset, info.end);
    if (!element) return null;
    if (element.id === 0x2ad7b1) {
      const parsed = readUnsigned(data, element.start, element.end);
      if (!parsed || !Number.isFinite(parsed)) return null;
      scale = parsed;
    } else if (element.id === 0x4489) {
      const size = element.end - element.start;
      if (size === 4) durationTicks = data.readFloatBE(element.start);
      else if (size === 8) durationTicks = data.readDoubleBE(element.start);
      else return null;
      if (!Number.isFinite(durationTicks) || durationTicks < 0) return null;
    }
    offset = element.end;
  }
  return { scale, durationSeconds: durationTicks === null ? null : durationTicks * scale / 1_000_000_000 };
}

function audioTrackNumbers(data: Buffer, tracks: EbmlElement): Map<number, string | null> | null {
  const audioTracks = new Map<number, string | null>();
  for (let offset = tracks.start; offset < tracks.end;) {
    const entry = readElement(data, offset, tracks.end);
    if (!entry) return null;
    if (entry.id === 0xae) {
      let trackNumber: number | null = null;
      let trackType: number | null = null;
      let codecId: string | null = null;
      for (let childOffset = entry.start; childOffset < entry.end;) {
        const child = readElement(data, childOffset, entry.end);
        if (!child) return null;
        if (child.id === 0xd7) trackNumber = readUnsigned(data, child.start, child.end);
        else if (child.id === 0x83) trackType = readUnsigned(data, child.start, child.end);
        else if (child.id === 0x86) codecId = data.toString("ascii", child.start, child.end);
        childOffset = child.end;
      }
      if (trackType === 2 && trackNumber !== null) audioTracks.set(trackNumber, codecId);
    }
    offset = entry.end;
  }
  return audioTracks;
}

function opusPacketDuration(data: Buffer, block: EbmlElement, trackLength: number): number | null {
  const flagsOffset = block.start + trackLength + 2;
  if (flagsOffset >= block.end) return null;
  const laceMode = (data[flagsOffset]! & 0x06) >> 1;
  if (laceMode !== 0) return null;
  const packetOffset = flagsOffset + 1;
  if (packetOffset >= block.end) return null;
  const toc = data[packetOffset]!;
  const config = toc >> 3;
  const code = toc & 0x03;
  const frameDurationMs = config < 12 ? [10, 20, 40, 60][config % 4]!
    : config < 16 ? [10, 20][(config - 12) % 2]!
      : [2.5, 5, 10, 20][(config - 16) % 4]!;
  let frameCount = code === 0 ? 1 : 2;
  if (code === 3) {
    if (packetOffset + 1 >= block.end) return null;
    frameCount = data[packetOffset + 1]! & 0x3f;
  }
  const duration = frameDurationMs * frameCount / 1000;
  return frameCount > 0 && duration <= MAX_OPUS_PACKET_SECONDS ? duration : null;
}

function parseBlockTimestamp(data: Buffer, block: EbmlElement, codecId: string | null): { track: number; relative: number; duration: number | null } | null {
  const track = readVint(data, block.start, false);
  if (!track || block.start + track.length + 3 > block.end) return null;
  return { track: Number(track.value), relative: data.readInt16BE(block.start + track.length),
    duration: codecId === "A_OPUS" ? opusPacketDuration(data, block, track.length) : null };
}

function parseCluster(data: Buffer, cluster: EbmlElement, audioTracks: Map<number, string | null>, scale: number): number | null {
  let timecode: number | null = null;
  const blocks: EbmlElement[] = [];
  for (let offset = cluster.start; offset < cluster.end;) {
    const element = readElement(data, offset, cluster.end);
    if (!element) return null;
    if (element.id === 0xe7) {
      if (timecode !== null) return null;
      timecode = readUnsigned(data, element.start, element.end);
    }
    else if (element.id === 0xa3) blocks.push(element);
    else if (element.id === 0xa0) {
      for (let childOffset = element.start; childOffset < element.end;) {
        const child = readElement(data, childOffset, element.end);
        if (!child) return null;
        if (child.id === 0xa1) blocks.push(child);
        childOffset = child.end;
      }
    }
    offset = element.end;
  }
  if (timecode === null || blocks.length === 0) return null;
  let latest: number | null = null;
  for (const block of blocks) {
    const parsedTrack = readVint(data, block.start, false);
    if (!parsedTrack) return null;
    const timestamp = parseBlockTimestamp(data, block, audioTracks.get(Number(parsedTrack.value)) ?? null);
    if (!timestamp) return null;
    if (audioTracks.has(timestamp.track)) {
      const startSeconds = Math.max(0, timecode + timestamp.relative) * scale / 1_000_000_000;
      latest = Math.max(latest ?? 0, startSeconds + (timestamp.duration ?? MAX_OPUS_PACKET_SECONDS));
    }
  }
  return latest;
}

function webmDuration(data: Buffer): number | null {
  let offset = 0;
  let validHeader = false;
  const audioTracks = new Map<number, string | null>();
  let scale = 1_000_000;
  let infoDuration: number | null = null;
  let latestBlockTicks: number | null = null;
  while (offset < data.length) {
    const element = readElement(data, offset, data.length);
    if (!element) return null;
    if (element.id === EBML_HEADER) validHeader = parseDocType(data, element);
    else if (element.id === EBML_SEGMENT) {
      const children = readSegmentChildren(data, element);
      if (!children) return null;
      for (const child of children) {
        if (child.id === 0x1549a966) {
          const info = parseInfo(data, child);
          if (!info) return null;
          scale = info.scale;
          infoDuration = info.durationSeconds;
        } else if (child.id === 0x1654ae6b) {
          const tracks = audioTrackNumbers(data, child);
          if (tracks === null) return null;
          tracks.forEach((codec, track) => audioTracks.set(track, codec));
        }
      }
      for (const child of children) {
        if (child.id === 0x1f43b675) {
          const latest = parseCluster(data, child, audioTracks, scale);
          if (latest === null) return null;
          latestBlockTicks = Math.max(latestBlockTicks ?? 0, latest * 1_000_000_000 / scale);
        }
      }
    }
    offset = element.end;
  }
  if (!validHeader || audioTracks.size === 0 || latestBlockTicks === null || scale <= 0) return null;
  const latestBlockEnd = Math.max(0, latestBlockTicks) * scale / 1_000_000_000;
  return Math.max(infoDuration ?? 0, latestBlockEnd);
}

const oggCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value << 24;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x80000000) !== 0 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  return crc >>> 0;
});

function oggChecksum(data: Buffer, start: number, end: number): number {
  let crc = 0;
  for (let index = start; index < end; index += 1) {
    const byte = index >= start + 22 && index < start + 26 ? 0 : data[index]!;
    crc = ((crc << 8) ^ oggCrcTable[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return crc;
}

function oggDuration(data: Buffer): number | null {
  let offset = 0;
  let serial: number | null = null;
  let sampleRate: number | null = null;
  let preSkip = 0;
  let lastGranule: bigint | null = null;
  let expectedPageSequence = 0;
  const firstPacketParts: Buffer[] = [];
  let firstPacketDone = false;
  while (offset < data.length) {
    if (offset + 27 > data.length || data.toString("ascii", offset, offset + 4) !== "OggS" || data[offset + 4] !== 0) return null;
    const pageSerial = data.readUInt32LE(offset + 14);
    if (serial === null) serial = pageSerial;
    else if (serial !== pageSerial) return null;
    if (data.readUInt32LE(offset + 18) !== expectedPageSequence++) return null;
    const segmentCount = data[offset + 26]!;
    const tableStart = offset + 27;
    const payloadStart = tableStart + segmentCount;
    if (payloadStart > data.length) return null;
    const payloadLength = data.subarray(tableStart, payloadStart).reduce((sum, size) => sum + size, 0);
    const pageEnd = payloadStart + payloadLength;
    if (pageEnd > data.length) return null;
    if (oggChecksum(data, offset, pageEnd) !== data.readUInt32LE(offset + 22)) return null;
    const granule = data.readBigUInt64LE(offset + 6);
    if (granule !== 0xffffffffffffffffn) {
      if (lastGranule !== null && granule < lastGranule) return null;
      lastGranule = granule;
    }
    let packetOffset = payloadStart;
    for (let index = 0; index < segmentCount; index += 1) {
      const length = data[tableStart + index]!;
      if (!firstPacketDone) firstPacketParts.push(data.subarray(packetOffset, packetOffset + length));
      packetOffset += length;
      if (!firstPacketDone && length < 255) {
        const packet = Buffer.concat(firstPacketParts);
        if (packet.subarray(0, 8).toString("ascii") === "OpusHead" && packet.length >= 19) {
          sampleRate = 48_000;
          preSkip = packet.readUInt16LE(10);
        } else if (packet.length >= 30 && packet[0] === 1 && packet.subarray(1, 7).toString("ascii") === "vorbis") {
          sampleRate = packet.readUInt32LE(12);
        } else return null;
        firstPacketDone = true;
      }
    }
    offset = pageEnd;
  }
  if (!firstPacketDone || !sampleRate || !lastGranule || lastGranule <= BigInt(preSkip)) return null;
  return Number(lastGranule) / sampleRate;
}

export function getAudioDurationSeconds(audio: Buffer, mimeType: SupportedAudioMimeType): number | null {
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) return null;
  if (mimeType === "audio/webm") return webmDuration(audio);
  if (audio.toString("ascii", 0, 4) !== "OggS") return null;
  return oggDuration(audio);
}
