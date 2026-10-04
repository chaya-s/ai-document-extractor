import Link from 'next/link';

import { listRecordings } from '@/lib/rrweb-replays';
import { isSessionReplayEnabled } from '@/lib/session-replay';

export const dynamic = 'force-dynamic';

function formatStarted(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(
    0,
    Math.floor(durationMs / 1000)
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export default async function ReplaysPage() {
  const replayEnabled = isSessionReplayEnabled();
  const recordings = replayEnabled
    ? await listRecordings()
    : [];

  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-medium text-gray-500">
          Session replay
        </p>

        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold text-gray-900">
            Replays
          </h1>

          <Link
            href="/"
            className="rounded-xl bg-[#e0e7ff] px-6 py-3 text-sm font-medium text-[#6366f1] transition hover:bg-[#c7d2fe]"
          >
            Back to app
          </Link>
        </div>

        <div className="mt-8 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          {!replayEnabled ? (
            <div className="p-6 text-sm text-gray-500">
              Session replay is disabled.
            </div>
          ) : recordings.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">
              No replay recordings found.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-600">
                    Recording
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-600">
                    Started
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-600">
                    Duration
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-600">
                    Pages / Segments
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-600">
                    Play
                  </th>
                </tr>
              </thead>

              <tbody>
                {recordings.map((recording) => (
                  <tr
                    key={recording.recordingId}
                    className="border-t border-gray-100"
                  >
                    <td className="break-all px-4 py-4 font-mono text-xs text-gray-800">
                      {recording.recordingId}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {formatStarted(new Date(recording.startedAt).toISOString())}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {formatDuration(recording.durationMs)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                      {recording.segmentCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <Link
                        href={`/replays/${recording.recordingId}`}
                        className="rounded-xl bg-[#e0e7ff] px-4 py-2 font-medium text-[#6366f1] transition hover:bg-[#c7d2fe]"
                      >
                        Play
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
