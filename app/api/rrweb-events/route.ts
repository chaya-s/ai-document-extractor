import { NextResponse } from 'next/server';

import { assertWorkspaceId, readSession } from '@/lib/pi-workspace';
import {
  getRecording,
  readEvents,
  saveRecordingChunk,
} from '@/lib/rrweb-replays';
import { isSessionReplayEnabled } from '@/lib/session-replay';

export const runtime = 'nodejs';

const MAX_EVENTS_PER_BATCH = 500;

type RrwebEventsBody = {
  workspaceId?: unknown;
  recordingId?: unknown;
  events?: unknown;
  path?: unknown;
  userAgent?: unknown;
};

function parseSegment(value: string | null) {
  if (!value) {
    return undefined;
  }

  const segmentId = Number(value);

  if (
    !Number.isInteger(segmentId) ||
    segmentId < 1
  ) {
    throw new Error('Invalid segment ID.');
  }

  return segmentId;
}

export async function GET(request: Request) {
  if (!isSessionReplayEnabled()) {
    return NextResponse.json(
      {
        error: 'Session replay is disabled.',
      },
      {
        status: 403,
      }
    );
  }

  try {
    const { searchParams } = new URL(request.url);

    const recordingId = assertWorkspaceId(
      searchParams.get('recordingId') ??
        searchParams.get('workspaceId')
    );

    const segmentId = parseSegment(
      searchParams.get('segment')
    );

    const [{ meta, segments }, events] =
      await Promise.all([
        getRecording(recordingId),
        readEvents(recordingId, segmentId),
      ]);

    return NextResponse.json({
      meta,
      segments,
      events,
      totalEvents: events.length,
    });
  } catch (error) {
    console.error(
      'rrweb event load error:',
      error
    );

    return NextResponse.json(
      {
        error: 'Unable to load rrweb events.',
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(request: Request) {
  if (!isSessionReplayEnabled()) {
    return NextResponse.json(
      {
        error: 'Session replay is disabled.',
      },
      {
        status: 403,
      }
    );
  }

  try {
    const body =
      (await request.json()) as RrwebEventsBody;

    const recordingId = assertWorkspaceId(
      body.recordingId ?? body.workspaceId
    );

    if (!Array.isArray(body.events)) {
      return NextResponse.json(
        {
          error: 'events must be an array.',
        },
        {
          status: 400,
        }
      );
    }

    if (
      body.events.length === 0 ||
      body.events.length > MAX_EVENTS_PER_BATCH
    ) {
      return NextResponse.json(
        {
          error: `events must contain 1-${MAX_EVENTS_PER_BATCH} items.`,
        },
        {
          status: 400,
        }
      );
    }

    // recordingId is the existing workspaceId. Confirm it exists.
    await readSession(recordingId);

    const saved = await saveRecordingChunk({
      recordingId,
      events: body.events,
      path:
        typeof body.path === 'string'
          ? body.path
          : '/',
      userAgent:
        typeof body.userAgent === 'string'
          ? body.userAgent
          : undefined,
    });

    return NextResponse.json({
      saved: true,
      recordingId,
      receivedEvents: body.events.length,
      chunkNumber: saved.chunkNumber,
      chunkCount: saved.meta.chunkCount,
      segmentCount: saved.segments.length,
    });
  } catch (error) {
    console.error(
      'rrweb event save error:',
      error
    );

    return NextResponse.json(
      {
        error: 'Unable to save rrweb events.',
      },
      {
        status: 500,
      }
    );
  }
}
