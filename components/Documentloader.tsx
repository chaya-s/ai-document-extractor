'use client';

import { useState } from 'react';

const FIELD_NAMES = [
  'Total Month Cycles',
  'Total Month Hours',
  'Total New Cycles',
  'Total New Time',
  'Aircraft Type',
] as const;

type FieldName = (typeof FIELD_NAMES)[number];

type ExtractedField = {
  value: string | null;
  confidence: number;
};

type AircraftData = Record<
  FieldName,
  ExtractedField
>;

type TraceEvent = {
  timestamp: string;

  type:
    | 'upload.ready'
    | 'session.started'
    | 'model.started'
    | 'tool.started'
    | 'tool.completed'
    | 'result.saved'
    | 'session.completed'
    | 'session.failed';

  data: Record<string, unknown>;
};

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString(
    'en-US',
    {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }
  );
}

function formatTraceEvent(event: TraceEvent) {
  const time = formatTime(event.timestamp);

  if (event.type === 'upload.ready') {
    return `[${time}] UPLOAD READY: workspace ${String(
      event.data.workspaceId ?? ''
    )}`;
  }

  if (event.type === 'session.started') {
    return `[${time}] SESSION.STARTED: ${JSON.stringify(
      {
        workspaceId: event.data.workspaceId,
        sessionId: event.data.sessionId,
      }
    )}`;
  }

  if (event.type === 'model.started') {
    return `[${time}] MODEL.STARTED: ${JSON.stringify(
      {
        model: event.data.model,
      }
    )}`;
  }

  if (event.type === 'tool.started') {
    const tool = String(event.data.tool ?? '');

    const args: Record<string, unknown> = {};

    if (event.data.query !== undefined) {
      args.query = event.data.query;
    }

    if (event.data.maxMatches !== undefined) {
      args.maxMatches = event.data.maxMatches;
    }

    if (event.data.offset !== undefined) {
      args.offset = event.data.offset;
    }

    if (event.data.limit !== undefined) {
      args.limit = event.data.limit;
    }

    if (event.data.fields !== undefined) {
      args.fields = event.data.fields;
    }

    const argsText =
      Object.keys(args).length > 0
        ? ` ${JSON.stringify(args)}`
        : '';

    return `[${time}] TOOL STARTED: ${tool}${argsText}`;
  }

  if (event.type === 'tool.completed') {
    const tool = String(event.data.tool ?? '');

    if (event.data.error) {
      return `[${time}] TOOL COMPLETED: ${tool} failed ${JSON.stringify(
        {
          error: event.data.error,
        }
      )}`;
    }

    return `[${time}] TOOL COMPLETED: ${tool} completed`;
  }

  if (event.type === 'result.saved') {
    return `[${time}] RESULT.SAVED: ${JSON.stringify(
      event.data.result ?? {}
    )}`;
  }

  if (event.type === 'session.completed') {
    return `[${time}] SESSION.COMPLETED: ${JSON.stringify(
      event.data
    )}`;
  }

  if (event.type === 'session.failed') {
    return `[${time}] SESSION.FAILED: ${JSON.stringify(
      event.data
    )}`;
  }

  return `[${time}] UNKNOWN EVENT`;
}

export default function Documentloader() {
  const [file, setFile] = useState<File | null>(
    null
  );

  const [workspaceId, setWorkspaceId] =
    useState('');

  const [aircraftData, setAircraftData] =
    useState<AircraftData | null>(null);

  const [traceEvents, setTraceEvents] =
    useState<TraceEvent[]>([]);

  const [uploading, setUploading] =
    useState(false);

  const [extracting, setExtracting] =
    useState(false);

  const [error, setError] = useState('');

  async function handleFile(
    selectedFile: File | undefined
  ) {
    if (!selectedFile) {
      return;
    }

    setFile(selectedFile);
    setWorkspaceId('');
    setAircraftData(null);
    setTraceEvents([]);
    setError('');
    setUploading(true);

    try {
      const formData = new FormData();

      formData.append(
        'file',
        selectedFile
      );

      const response = await fetch(
        '/api/read-document',
        {
          method: 'POST',
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            'Unable to read document.'
        );
      }

      setWorkspaceId(
        data.workspaceId
      );

      setTraceEvents([
        {
          timestamp:
            new Date().toISOString(),

          type: 'upload.ready',

          data: {
            workspaceId:
              data.workspaceId,
          },
        },
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong.'
      );
    } finally {
      setUploading(false);
    }
  }

  async function extractAircraftData() {
    if (!workspaceId) {
      setError(
        'Please upload a document first.'
      );

      return;
    }

    setExtracting(true);
    setAircraftData(null);
    setError('');

    try {
      const response = await fetch(
        '/api/ask-document',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            workspaceId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          'Unable to extract information.'
        );
      }

      const reader =
        response.body?.getReader();

      if (!reader) {
        throw new Error(
          'Unable to read Pi stream.'
        );
      }

      const decoder =
        new TextDecoder();

      let buffer = '';

      while (true) {
        const { value, done } =
          await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(
          value,
          {
            stream: true,
          }
        );

        const lines =
          buffer.split('\n');

        buffer =
          lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event =
            JSON.parse(
              line
            ) as TraceEvent;

          setTraceEvents(
            (current) => [
              ...current,
              event,
            ]
          );

          if (
            event.type ===
            'result.saved'
          ) {
            setAircraftData(
              event.data
                .result as AircraftData
            );
          }

          if (
            event.type ===
            'session.failed'
          ) {
            setError(
              String(
                event.data.error ||
                  'Extraction failed.'
              )
            );
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong.'
      );
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="w-full max-w-4xl">

      <label
        className="
          flex min-h-64 cursor-pointer
          flex-col items-center justify-center
          rounded-3xl
          border-2 border-dashed border-[#c7d2fe]
          bg-[#f5f7ff]
          p-10
          text-center
          transition-all
          duration-300
          hover:border-[#a5b4fc]
          hover:bg-[#eef2ff]
        "
        onDragOver={(e) =>
          e.preventDefault()
        }
        onDrop={(e) => {
          e.preventDefault();

          handleFile(
            e.dataTransfer.files[0]
          );
        }}
      >
        <input
          type="file"
          className="hidden"
          accept=".pdf,.docx"
          onChange={(e) =>
            handleFile(
              e.target.files?.[0]
            )
          }
        />

        <h2 className="text-xl font-semibold text-[#4b5563]">
          Drop your document here
        </h2>

        <p className="mt-2 text-[#9ca3af]">
          PDF or DOCX files
        </p>

        <p className="mt-5 rounded-full bg-[#e0e7ff] px-6 py-2 text-sm font-medium text-[#6366f1]">
          Browse files
        </p>
      </label>

      {uploading && (
        <p className="mt-5 text-center text-gray-500">
          Reading document...
        </p>
      )}

      {file && workspaceId && (
        <div className="mt-5 rounded-xl bg-green-50 p-4">

          <p className="font-medium text-green-700">
            Document ready
          </p>

          <p className="mt-1 text-sm text-green-600">
            {file.name}
          </p>

          <p className="mt-2 break-all text-xs text-green-500">
            Workspace:{' '}
            {workspaceId}
          </p>

        </div>
      )}

      {error && (
        <div className="mt-5 rounded-xl bg-red-50 p-4 text-red-600">
          {error}
        </div>
      )}

      {workspaceId && (
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">

          <h2 className="text-xl font-semibold text-gray-700">
            Extract Aircraft Data
          </h2>

          <p className="mt-1 text-sm text-gray-400">
            Extract structured aircraft details from the document
          </p>

          <button
            onClick={
              extractAircraftData
            }
            disabled={
              extracting ||
              !workspaceId
            }
            className="
              mt-4
              rounded-xl
              bg-[#e0e7ff]
              px-6
              py-3
              font-medium
              text-[#6366f1]
              transition
              hover:bg-[#c7d2fe]
              disabled:opacity-50
            "
          >
            {extracting
              ? 'Extracting...'
              : 'Extract Details'}
          </button>

          {traceEvents.length > 0 && (
            <div className="mt-6 rounded-xl bg-gray-950 p-5 text-white">

              <h3 className="mb-4 text-lg font-semibold">
                Pi Session Logs
              </h3>

              <div className="max-h-96 overflow-y-auto">

                {traceEvents.map(
                  (
                    event,
                    index
                  ) => (
                    <div
                      key={`${event.timestamp}-${index}`}
                      className="
                        mb-2
                        whitespace-pre-wrap
                        break-words
                        font-mono
                        text-sm
                        text-gray-200
                      "
                    >
                      {formatTraceEvent(
                        event
                      )}
                    </div>
                  )
                )}

              </div>
            </div>
          )}

          {aircraftData && (
            <div className="mt-6">

              <h3 className="mb-4 text-lg font-semibold text-gray-700">
                Extracted Aircraft Details
              </h3>

              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">

                <table className="w-full text-left">

                  <thead className="bg-gray-50">
                    <tr>

                      <th className="px-5 py-3 text-sm font-semibold text-gray-600">
                        Field
                      </th>

                      <th className="px-5 py-3 text-sm font-semibold text-gray-600">
                        Value
                      </th>

                      <th className="px-5 py-3 text-sm font-semibold text-gray-600">
                        Confidence
                      </th>

                    </tr>
                  </thead>

                  <tbody>

                    {FIELD_NAMES.map(
                      (name) => {
                        const field =
                          aircraftData[
                            name
                          ];

                        return (
                          <tr
                            key={
                              name
                            }
                            className="border-t border-gray-100"
                          >

                            <td className="px-5 py-4 font-medium text-gray-700">
                              {
                                name
                              }
                            </td>

                            <td className="px-5 py-4 text-gray-900">
                              {field
                                ?.value ||
                                'Not found'}
                            </td>

                            <td className="px-5 py-4">

                              <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                                {field
                                  ?.confidence ??
                                  0}
                                %
                              </span>

                            </td>

                          </tr>
                        );
                      }
                    )}

                  </tbody>

                </table>

              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}