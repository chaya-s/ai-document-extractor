import Link from 'next/link';

import RrwebReplayViewer from '@/components/RrwebReplayViewer';
import { getRecording } from '@/lib/rrweb-replays';
import { isSessionReplayEnabled } from '@/lib/session-replay';

type ReplayPageProps = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export default async function ReplayPage({
  params,
}: ReplayPageProps) {
  const { workspaceId } = await params;
  const replayEnabled = isSessionReplayEnabled();
  const recording = replayEnabled
    ? await getRecording(workspaceId).catch(() => null)
    : null;

  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-medium text-gray-500">
          Session replay
        </p>

        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="break-all text-3xl font-bold text-gray-900">
            {workspaceId}
          </h1>

          <Link
            href="/replays"
            className="rounded-xl bg-[#e0e7ff] px-6 py-3 text-sm font-medium text-[#6366f1] transition hover:bg-[#c7d2fe]"
          >
            Back to replays
          </Link>
        </div>

        {!replayEnabled ? (
          <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
            Session replay is disabled.
          </div>
        ) : !recording ? (
          <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
            Recording was not found.
          </div>
        ) : (
          <RrwebReplayViewer
            recordingId={recording.meta.recordingId}
            segments={recording.segments}
          />
        )}
      </div>
    </main>
  );
}
