"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import rrwebPlayer from "rrweb-player";

import type { RecordingSegment } from "@/lib/rrweb-replays";

type RrwebReplayViewerProps = {
  recordingId: string;
  segments: RecordingSegment[];
};

type RrwebEventsResponse = {
  events?: unknown[];
  totalEvents?: number;
  error?: string;
};

type PlayerInstance = InstanceType<typeof rrwebPlayer>;
type DestroyablePlayer = PlayerInstance & {
  $destroy?: () => void;
};

type RrwebEventLike = {
  type?: unknown;
  timestamp?: unknown;
};

function playerSize(container: HTMLDivElement) {
  const containerWidth = container.clientWidth || 960;
  const width = Math.max(320, Math.min(containerWidth, 1100));
  const height = Math.max(420, Math.round(width * 0.6));

  return {
    width,
    height,
  };
}

function eventType(event: unknown) {
  return event && typeof event === "object"
    ? (event as RrwebEventLike).type
    : undefined;
}

function hasReplaySnapshot(events: unknown[]) {
  return events.some((event) => eventType(event) === 2);
}

function hasValidTimestamps(events: unknown[]) {
  return events.every((event) => {
    if (!event || typeof event !== "object") {
      return false;
    }

    const timestamp = (event as RrwebEventLike).timestamp;

    return typeof timestamp === "number" && Number.isFinite(timestamp);
  });
}

export default function RrwebReplayViewer({
  recordingId,
  segments,
}: RrwebReplayViewerProps) {
  const playerRootRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<PlayerInstance | null>(null);
  const loadIdRef = useRef(0);
  const [status, setStatus] = useState("Loading replay...");
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [activeSegment, setActiveSegment] = useState<number | null>(null);

  const destroyPlayer = useCallback(() => {
    const player = playerRef.current as DestroyablePlayer | null;

    if (player) {
      player.$destroy?.();
      playerRef.current = null;
    }

    if (playerRootRef.current) {
      playerRootRef.current.innerHTML = "";
    }
  }, []);

  const loadReplay = useCallback(
    async (segmentId?: number) => {
      const target = playerRootRef.current;
      const loadId = loadIdRef.current + 1;

      loadIdRef.current = loadId;

      if (!target) {
        setStatus("Replay failed: player container was not found.");
        return;
      }

      setStatus(
        segmentId
          ? `Loading segment ${segmentId}...`
          : "Loading replay..."
      );
      setEventCount(null);

      try {
        const params = new URLSearchParams({
          recordingId,
        });

        if (segmentId) {
          params.set("segment", String(segmentId));
        }

        const response = await fetch(
          `/api/rrweb-events?${params.toString()}`
        );

        const data =
          (await response.json()) as RrwebEventsResponse;

        if (loadIdRef.current !== loadId) {
          return;
        }

        if (!response.ok) {
          throw new Error(
            data.error ?? "Unable to load replay events."
          );
        }

        const events = Array.isArray(data.events) ? data.events : [];

        setEventCount(events.length);
        setActiveSegment(segmentId ?? null);

        if (events.length === 0) {
          destroyPlayer();
          setStatus("No replay events found.");
          return;
        }

        if (!hasValidTimestamps(events)) {
          destroyPlayer();
          setStatus("Replay failed: recording contains invalid event timestamps.");
          return;
        }

        if (!hasReplaySnapshot(events)) {
          destroyPlayer();
          setStatus("Replay failed: recording does not contain a full rrweb snapshot.");
          return;
        }

        destroyPlayer();

        const { width, height } = playerSize(target);

        playerRef.current = new rrwebPlayer({
          target,
          props: {
            events: events as never,
            width,
            height,
            autoPlay: true,
            showController: true,
            skipInactive: true,
            speed: 1,
            speedOption: [0.5, 1, 2, 4, 8],
          },
        });

        setStatus(
          segmentId
            ? `Playing segment ${segmentId}.`
            : "Playing replay."
        );
      } catch (error) {
        if (loadIdRef.current !== loadId) {
          return;
        }

        destroyPlayer();
        setEventCount(null);
        setStatus(
          `Replay failed: ${
            error instanceof Error
              ? error.message
              : "Unable to load replay."
          }`
        );
      }
    },
    [destroyPlayer, recordingId]
  );

  useEffect(() => {
    void loadReplay();

    return () => {
      loadIdRef.current += 1;
      destroyPlayer();
    };
  }, [destroyPlayer, loadReplay]);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => loadReplay()}
          className={`rounded-xl px-6 py-3 font-medium transition ${
            activeSegment === null
              ? "bg-[#c7d2fe] text-[#4f46e5]"
              : "bg-[#e0e7ff] text-[#6366f1] hover:bg-[#c7d2fe]"
          }`}
        >
          Full session
        </button>
      </div>

      <p className="mt-4 text-sm text-gray-500">
        {status}
      </p>

      {eventCount !== null && (
        <p className="mt-1 text-sm text-gray-400">
          Loaded events: {eventCount}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div
          ref={playerRootRef}
          className="min-h-[420px] w-full overflow-auto"
        />
      </div>

      <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800">
          Segments
        </h2>

        {segments.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            No segments found.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {segments.map((segment) => (
              <button
                key={segment.segmentId}
                type="button"
                onClick={() => loadReplay(segment.segmentId)}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                  activeSegment === segment.segmentId
                    ? "border-[#6366f1] bg-[#eef2ff] text-[#4f46e5]"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="font-semibold">
                  Segment {segment.segmentId}
                </span>
                <span className="ml-2 text-gray-400">
                  {segment.path}
                </span>
                <span className="ml-2 text-gray-400">
                  chunks {segment.firstChunk}-{segment.lastChunk}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
