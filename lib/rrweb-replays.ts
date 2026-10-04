import fs from 'fs/promises';
import path from 'path';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

import { assertWorkspaceId } from '@/lib/pi-workspace';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type RecordingMeta = {
  recordingId: string;
  startedAt: number;
  lastEventAt: number;
  chunkCount: number;
  userAgent?: string;
};

export type RecordingSegment = {
  segmentId: number;
  path: string;
  startTs: number;
  endTs: number;
  firstChunk: number;
  lastChunk: number;
};

export type ReplayRecordingSummary = {
  recordingId: string;
  startedAt: number;
  lastEventAt: number;
  durationMs: number;
  segmentCount: number;
  chunkCount: number;
};

export type ReplayRecording = {
  meta: RecordingMeta;
  segments: RecordingSegment[];
};

type RrwebEventLike = {
  timestamp?: unknown;
  [key: string]: unknown;
};

export function replaysRoot() {
  return path.resolve(process.cwd(), 'replays');
}

export function recordingsRoot() {
  return path.join(replaysRoot(), 'recordings');
}

export function recordingRoot(recordingId: string) {
  const safeRecordingId = assertWorkspaceId(recordingId);
  const root = recordingsRoot();
  const recordingPath = path.resolve(root, safeRecordingId);

  if (
    recordingPath !== path.resolve(root, safeRecordingId) ||
    !recordingPath.startsWith(`${path.resolve(root)}${path.sep}`)
  ) {
    throw new Error('Recording path escaped root.');
  }

  return recordingPath;
}

function chunksRoot(recordingId: string) {
  return path.join(recordingRoot(recordingId), 'chunks');
}

function metaPath(recordingId: string) {
  return path.join(recordingRoot(recordingId), 'meta.json');
}

function segmentsPath(recordingId: string) {
  return path.join(recordingRoot(recordingId), 'segments.json');
}

function chunkPath(recordingId: string, chunkNumber: number) {
  return path.join(
    chunksRoot(recordingId),
    `${String(chunkNumber).padStart(6, '0')}.json.gz`
  );
}

async function readJsonIfExists<T>(filePath: string, fallback: T) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');

    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return fallback;
    }

    throw error;
  }
}

function eventTimestamp(event: RrwebEventLike) {
  return typeof event.timestamp === 'number' &&
    Number.isFinite(event.timestamp)
    ? event.timestamp
    : null;
}

function eventRange(events: unknown[]) {
  const timestamps = events
    .map((event) =>
      event && typeof event === 'object'
        ? eventTimestamp(event as RrwebEventLike)
        : null
    )
    .filter((value): value is number => value !== null);

  const now = Date.now();

  return {
    startTs: timestamps[0] ?? now,
    endTs: timestamps[timestamps.length - 1] ?? now,
  };
}

function sortEvents(events: unknown[]) {
  return [...events].sort((a, b) => {
    const left =
      a && typeof a === 'object'
        ? eventTimestamp(a as RrwebEventLike)
        : null;
    const right =
      b && typeof b === 'object'
        ? eventTimestamp(b as RrwebEventLike)
        : null;

    return (left ?? 0) - (right ?? 0);
  });
}

function normalizePath(value: unknown) {
  if (typeof value !== 'string' || !value) {
    return '/';
  }

  if (value.startsWith('/')) {
    return value.split('?')[0] || '/';
  }

  try {
    return new URL(value).pathname || '/';
  } catch {
    return '/';
  }
}

export async function saveRecordingChunk({
  recordingId,
  events,
  path: pagePath,
  userAgent,
}: {
  recordingId: string;
  events: unknown[];
  path?: string;
  userAgent?: string;
}) {
  const safeRecordingId = assertWorkspaceId(recordingId);

  if (events.length === 0) {
    throw new Error('Cannot save an empty rrweb chunk.');
  }

  await fs.mkdir(chunksRoot(safeRecordingId), {
    recursive: true,
  });

  const existingMeta = await readJsonIfExists<RecordingMeta | null>(
    metaPath(safeRecordingId),
    null
  );

  const segments = await readJsonIfExists<RecordingSegment[]>(
    segmentsPath(safeRecordingId),
    []
  );

  const nextChunk = (existingMeta?.chunkCount ?? 0) + 1;
  const { startTs, endTs } = eventRange(events);
  const normalizedPath = normalizePath(pagePath);

  const chunkBuffer = await gzipAsync(
    JSON.stringify(events)
  );

  await fs.writeFile(
    chunkPath(safeRecordingId, nextChunk),
    chunkBuffer
  );

  const previousSegment = segments[segments.length - 1];

  if (previousSegment && previousSegment.path === normalizedPath) {
    previousSegment.endTs = Math.max(previousSegment.endTs, endTs);
    previousSegment.lastChunk = nextChunk;
  } else {
    segments.push({
      segmentId: segments.length + 1,
      path: normalizedPath,
      startTs,
      endTs,
      firstChunk: nextChunk,
      lastChunk: nextChunk,
    });
  }

  const meta: RecordingMeta = {
    recordingId: safeRecordingId,
    startedAt: existingMeta?.startedAt ?? startTs,
    lastEventAt: Math.max(existingMeta?.lastEventAt ?? endTs, endTs),
    chunkCount: nextChunk,
    ...(userAgent || existingMeta?.userAgent
      ? { userAgent: userAgent ?? existingMeta?.userAgent }
      : {}),
  };

  await Promise.all([
    fs.writeFile(
      metaPath(safeRecordingId),
      JSON.stringify(meta, null, 2),
      'utf-8'
    ),
    fs.writeFile(
      segmentsPath(safeRecordingId),
      JSON.stringify(segments, null, 2),
      'utf-8'
    ),
  ]);

  return {
    meta,
    segments,
    chunkNumber: nextChunk,
  };
}

export async function getRecording(
  recordingId: string
): Promise<ReplayRecording> {
  const safeRecordingId = assertWorkspaceId(recordingId);
  const [meta, segments] = await Promise.all([
    readJsonIfExists<RecordingMeta | null>(
      metaPath(safeRecordingId),
      null
    ),
    readJsonIfExists<RecordingSegment[]>(
      segmentsPath(safeRecordingId),
      []
    ),
  ]);

  if (!meta) {
    throw new Error('Recording was not found.');
  }

  return {
    meta,
    segments,
  };
}

async function readChunk(recordingId: string, chunkNumber: number) {
  const compressed = await fs.readFile(
    chunkPath(recordingId, chunkNumber)
  );
  const raw = await gunzipAsync(compressed);
  const parsed = JSON.parse(raw.toString('utf-8'));

  return Array.isArray(parsed) ? parsed : [];
}

function eventType(event: unknown) {
  return event &&
    typeof event === 'object' &&
    'type' in event
    ? (event as { type?: unknown }).type
    : undefined;
}

function hasFullSnapshot(events: unknown[]) {
  return events.some((event) => eventType(event) === 2);
}

async function readReplayInitializationEvents(recordingId: string) {
  const { meta } = await getRecording(recordingId);
  const initializationEvents: unknown[] = [];

  for (let chunk = 1; chunk <= meta.chunkCount; chunk++) {
    const events = await readChunk(recordingId, chunk);

    for (const event of events) {
      const type = eventType(event);

      if (type === 4 || type === 2) {
        initializationEvents.push(event);
      }

      if (type === 2) {
        return initializationEvents;
      }
    }
  }

  return initializationEvents;
}

export async function readEvents(
  recordingId: string,
  segmentId?: number
) {
  const safeRecordingId = assertWorkspaceId(recordingId);
  const { meta, segments } = await getRecording(safeRecordingId);

  let firstChunk = 1;
  let lastChunk = meta.chunkCount;

  if (segmentId !== undefined) {
    const segment = segments.find(
      (item) => item.segmentId === segmentId
    );

    if (!segment) {
      throw new Error('Segment was not found.');
    }

    firstChunk = segment.firstChunk;
    lastChunk = segment.lastChunk;
  }

  const chunkNumbers: number[] = [];

  for (let chunk = firstChunk; chunk <= lastChunk; chunk++) {
    chunkNumbers.push(chunk);
  }

  const chunks = await Promise.all(
    chunkNumbers.map((chunk) => readChunk(safeRecordingId, chunk))
  );

  const events = chunks.flat();

  if (segmentId !== undefined && !hasFullSnapshot(events)) {
    const initializationEvents =
      await readReplayInitializationEvents(safeRecordingId);

    return sortEvents([
      ...initializationEvents,
      ...events,
    ]);
  }

  return sortEvents(events);
}

export async function listRecordings() {
  let entries: Array<{
    isDirectory(): boolean;
    name: string;
  }>;

  try {
    entries = await fs.readdir(recordingsRoot(), {
      withFileTypes: true,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [];
    }

    throw error;
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          const recordingId = assertWorkspaceId(entry.name);
          const { meta, segments } = await getRecording(recordingId);

          return {
            recordingId,
            startedAt: meta.startedAt,
            lastEventAt: meta.lastEventAt,
            durationMs: Math.max(0, meta.lastEventAt - meta.startedAt),
            segmentCount: segments.length,
            chunkCount: meta.chunkCount,
          } satisfies ReplayRecordingSummary;
        } catch {
          return null;
        }
      })
  );

  return summaries
    .filter(
      (summary): summary is ReplayRecordingSummary =>
        summary !== null
    )
    .sort((a, b) => b.startedAt - a.startedAt);
}

export const listReplayWorkspaces = listRecordings;
