"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { record } from "@rrweb/record";

import { isSessionReplayEnabled } from "@/lib/session-replay";

type WorkspaceEvent = CustomEvent<{
  workspaceId: string;
}>;

const RRWEB_BATCH_SIZE = 20;
const RRWEB_FLUSH_INTERVAL_MS = 2000;

function isReplayPath(pathname: string) {
  return (
    pathname === "/replay" ||
    pathname.startsWith("/replay/") ||
    pathname === "/replays" ||
    pathname.startsWith("/replays/")
  );
}

export default function RrwebRecorder() {
  const pathname = usePathname();
  const eventBufferRef = useRef<unknown[]>([]);
  const pendingEventsRef = useRef<unknown[]>([]);
  const workspaceIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!isSessionReplayEnabled()) {
      eventBufferRef.current = [];
      pendingEventsRef.current = [];
      workspaceIdRef.current = null;
      sendingRef.current = false;

      console.log("RRWEB RECORDING DISABLED BY FEATURE FLAG");

      return;
    }

    if (isReplayPath(pathname)) {
      eventBufferRef.current = [];
      pendingEventsRef.current = [];
      workspaceIdRef.current = null;
      sendingRef.current = false;

      console.log("RRWEB RECORDING DISABLED ON REPLAY ROUTE:", {
        pathname,
      });

      return;
    }

    async function flushEvents() {
      const workspaceId = workspaceIdRef.current;

      if (!workspaceId || sendingRef.current) {
        return;
      }

      const eventsToSend = pendingEventsRef.current.splice(
        0,
        RRWEB_BATCH_SIZE
      );

      if (eventsToSend.length === 0) {
        return;
      }

      sendingRef.current = true;

      try {
        const response = await fetch("/api/rrweb-events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId,
            recordingId: workspaceId,
            path: window.location.pathname,
            userAgent: window.navigator.userAgent,
            events: eventsToSend,
          }),
        });

        if (!response.ok) {
          throw new Error(
            "Unable to save rrweb event batch."
          );
        }

        const result = await response.json();

        console.log("RRWEB EVENTS SAVED:", {
          workspaceId,
          sentEvents: eventsToSend.length,
          pendingEvents: pendingEventsRef.current.length,
          chunkNumber: result.chunkNumber,
          chunkCount: result.chunkCount,
          segmentCount: result.segmentCount,
        });
      } catch (error) {
        pendingEventsRef.current = [
          ...eventsToSend,
          ...pendingEventsRef.current,
        ];

        console.error("RRWEB EVENTS SAVE FAILED:", error);
      } finally {
        sendingRef.current = false;

        if (pendingEventsRef.current.length > 0) {
          void flushEvents();
        }
      }
    }

    function handleWorkspaceReady(event: Event) {
      const workspaceEvent = event as WorkspaceEvent;
      const workspaceId = workspaceEvent.detail?.workspaceId;

      workspaceIdRef.current = workspaceId || null;

      console.log("RRWEB WORKSPACE CONNECTED:", {
        workspaceId: workspaceIdRef.current,
        bufferedEvents: eventBufferRef.current.length,
        pendingEvents: pendingEventsRef.current.length,
      });

      void flushEvents();
    }

    window.addEventListener(
      "rrweb:workspace-ready",
      handleWorkspaceReady
    );

    const flushInterval = window.setInterval(() => {
      void flushEvents();
    }, RRWEB_FLUSH_INTERVAL_MS);

    const stopRecording = record({
      emit(event) {
        eventBufferRef.current.push(event);
        pendingEventsRef.current.push(event);

        console.log("RRWEB EVENT BUFFERED:", {
          workspaceId: workspaceIdRef.current,
          bufferedEvents: eventBufferRef.current.length,
          pendingEvents: pendingEventsRef.current.length,
          event,
        });

        if (
          pendingEventsRef.current.length >= RRWEB_BATCH_SIZE
        ) {
          void flushEvents();
        }
      },

      maskAllInputs: true,
    });

    return () => {
      window.removeEventListener(
        "rrweb:workspace-ready",
        handleWorkspaceReady
      );

      window.clearInterval(flushInterval);

      stopRecording?.();
      eventBufferRef.current = [];
      pendingEventsRef.current = [];
      workspaceIdRef.current = null;
      sendingRef.current = false;
    };
  }, [pathname]);

  return null;
}
