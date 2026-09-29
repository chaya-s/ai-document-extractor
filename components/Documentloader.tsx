'use client';

import { useState } from 'react';

const FIELD_NAMES = [
  'Reporting Period',
  'Aircraft Serial Number',
  'Aircraft Type',
  'Total Month Cycles',
  'Total Month Hours',
  'Total New Cycles',
  'Total New Time',
] as const;

type FieldName = (typeof FIELD_NAMES)[number];

type ExtractedField = {
  value: string | null;
  confidence: number;
};

type ComponentField = {
  type: string;
  serialNumber: string | null;
  confidence: number;
};

type AircraftData = Record<
  FieldName,
  ExtractedField
> & {
  'Component List'?: ComponentField[];
};

type TraceEvent = {
  timestamp: string;

  type:
    | 'upload.ready'
    | 'session'
    | 'model_change'
    | 'thinking_level_change'
    | 'message'
    | 'session.started'
    | 'model.started'
    | 'agent.trace'
    | 'tool.started'
    | 'tool.completed'
    | 'result.saved'
    | 'session.completed'
    | 'session.failed';

  id?: string;
  parentId?: string | null;
  data: Record<string, unknown>;
  [key: string]: unknown;
};

type TraceContentBlock = {
  type?: unknown;
  name?: unknown;
  arguments?: unknown;
};

function formatTextValue(
  value: unknown
): string {
  if (value === null || value === undefined) {
    return 'none';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'none';
    }

    return value
      .map((item) => formatTextValue(item))
      .join(', ');
  }

  if (typeof value === 'object') {
    return Object.entries(
      value as Record<string, unknown>
    )
      .map(
        ([key, item]) =>
          `${key}: ${formatTextValue(item)}`
      )
      .join('; ');
  }

  return String(value);
}

function traceJson(
  value: unknown
) {
  return formatTextValue(value);
}

function eventData(
  event: TraceEvent
): Record<string, unknown> {
  const data =
    typeof event.data === 'object' &&
    event.data !== null
      ? event.data
      : {};

  const topLevel: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (
      key !== 'type' &&
      key !== 'id' &&
      key !== 'parentId' &&
      key !== 'timestamp' &&
      key !== 'data' &&
      key !== 'message'
    ) {
      topLevel[key] = value;
    }
  }

  return {
    ...data,
    ...topLevel,
  };
}

function eventMessage(
  event: TraceEvent
): Record<string, unknown> {
  const message = event.message;

  return typeof message === 'object' &&
    message !== null
    ? (message as Record<string, unknown>)
    : {};
}

function messageContentBlocks(
  message: Record<string, unknown>
): TraceContentBlock[] {
  if (!Array.isArray(message.content)) {
    return [];
  }

  return message.content.filter(
    (block): block is TraceContentBlock =>
      typeof block === 'object' &&
      block !== null
  );
}

function stripAgentTrace(text: string) {
  let output = text;
  const startTag = '[AGENT_TRACE]';
  const endTag = '[/AGENT_TRACE]';

  while (output.includes(startTag)) {
    const start = output.indexOf(startTag);
    const end = output.indexOf(endTag, start);

    if (end === -1) {
      output = output.slice(0, start);
      break;
    }

    output =
      output.slice(0, start) +
      output.slice(end + endTag.length);
  }

  return output.trim();
}

function textBlocksFromMessage(
  message: Record<string, unknown>
) {
  return messageContentBlocks(message)
    .filter((block) => block.type === 'text')
    .map((block) => {
      const text =
        'text' in block
          ? (block as { text?: unknown }).text
          : '';

      return typeof text === 'string'
        ? stripAgentTrace(text)
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

function toolCallsFromTraceMessage(
  message: Record<string, unknown>
) {
  return messageContentBlocks(message).filter(
    (block) => block.type === 'toolCall'
  );
}

function toolArguments(
  block: TraceContentBlock
): Record<string, unknown> {
  return typeof block.arguments === 'object' &&
    block.arguments !== null
    ? (block.arguments as Record<string, unknown>)
    : {};
}

function shortPreview(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function formatSearchResult(
  details: Record<string, unknown>
) {
  const query = String(details.query ?? 'document');
  const count = Number(details.matchCount ?? 0);

  if (!Number.isFinite(count) || count === 0) {
    return `SEARCH RESULT\nNo match found for "${query}".`;
  }

  const lines = [
    'SEARCH RESULT',
    `Found ${count} ${count === 1 ? 'match' : 'matches'} for "${query}".`,
  ];

  if (Array.isArray(details.matches)) {
    for (const match of details.matches.slice(0, 5)) {
      if (
        typeof match === 'object' &&
        match !== null &&
        'preview' in match
      ) {
        const preview = shortPreview(
          (match as { preview?: unknown }).preview
        );

        if (preview) {
          lines.push(`- ${preview}`);
        }
      }
    }
  }

  return lines.join('\n');
}

function fieldValue(
  result: Record<string, unknown>,
  field: FieldName
) {
  const value = result[field];

  if (
    typeof value === 'object' &&
    value !== null &&
    'value' in value
  ) {
    return String(
      (value as { value?: unknown }).value ?? 'Not found'
    );
  }

  return 'Not found';
}

function formatSavedResult(result: unknown) {
  if (
    typeof result !== 'object' ||
    result === null
  ) {
    return 'EXTRACTION COMPLETE';
  }

  const data = result as Record<string, unknown>;
  const lines = [
    'EXTRACTION COMPLETE',
    '',
    `Reporting Period: ${fieldValue(data, 'Reporting Period')}`,
    `Aircraft Serial Number: ${fieldValue(data, 'Aircraft Serial Number')}`,
    `Aircraft Type: ${fieldValue(data, 'Aircraft Type')}`,
    `Total Month Cycles: ${fieldValue(data, 'Total Month Cycles')}`,
    `Total Month Hours: ${fieldValue(data, 'Total Month Hours')}`,
    `Total New Cycles: ${fieldValue(data, 'Total New Cycles')}`,
    `Total New Time: ${fieldValue(data, 'Total New Time')}`,
    '',
    'Component List:',
  ];

  const components = data['Component List'];

  if (Array.isArray(components) && components.length > 0) {
    for (const component of components) {
      if (
        typeof component === 'object' &&
        component !== null
      ) {
        const item = component as ComponentField;

        lines.push(
          `- ${item.type} — Serial Number: ${item.serialNumber ?? 'Not found'} — Confidence: ${item.confidence ?? 0}%`
        );
      }
    }
  } else {
    lines.push('- None found');
  }

  return lines.join('\n');
}

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
  const data = eventData(event);

  if (event.type === 'upload.ready') {
    const filename = String(data.filename ?? 'document');

    return `[${time}] UPLOAD READY\nUploaded ${filename}`;
  }

  if (event.type === 'session') {
    return null;
  }

  if (event.type === 'session.started') {
    return `[${time}] SESSION STARTED\nDocument: ${String(
      data.originalFilename ?? 'uploaded document'
    )}`;
  }

  if (event.type === 'model_change') {
    return `[${time}] MODEL\nModel: ${String(
      data.provider ?? ''
    )}/${String(data.modelId ?? '')}`;
  }

  if (event.type === 'thinking_level_change') {
    return `[${time}] THINKING LEVEL\nThinking level: ${String(
      data.thinkingLevel ?? ''
    )}`;
  }

  if (event.type === 'model.started') {
    return null;
  }

  if (event.type === 'message') {
    const message = eventMessage(event);
    const role = String(message.role ?? '');

    if (role === 'assistant') {
      const visibleText = textBlocksFromMessage(message);

      if (visibleText) {
        return `[${time}]\n${visibleText}`;
      }

      const toolCalls = toolCallsFromTraceMessage(message);
      const toolTexts = toolCalls.map((block) => {
        const tool = String(block.name ?? '');
        const args = toolArguments(block);

        if (tool === 'grep_document') {
          return `SEARCHING: ${String(args.query ?? 'document')}`;
        }

        if (tool === 'read_document') {
          return 'READING DOCUMENT\nInspecting nearby aircraft information.';
        }

        if (tool === 'save_result') {
          return 'SAVING RESULT\nSaving extracted aircraft details.';
        }

        return `USING TOOL\n${tool}`;
      });

      if (toolTexts.length === 0) {
        return null;
      }

      return [`[${time}]`, ...toolTexts]
        .filter(Boolean)
        .join('\n');
    }

    if (role === 'toolResult') {
      const tool = String(message.toolName ?? '');

      if (message.isError) {
        return `[${time}] TOOL ERROR\n${String(
          message.error ?? 'Tool execution failed.'
        )}`;
      }

      const details =
        typeof message.details === 'object' &&
        message.details !== null
          ? (message.details as Record<string, unknown>)
          : {};

      if (tool === 'grep_document') {
        return `[${time}] ${formatSearchResult(details)}`;
      }

      if (tool === 'read_document') {
        return `[${time}] DOCUMENT READ\nRead ${String(
          details.returnedCharacters ?? '0'
        )} characters from document offset ${String(
          details.offset ?? '0'
        )}.`;
      }

      if (tool === 'save_result') {
        return `[${time}] RESULT SAVED\nAircraft extraction saved successfully.`;
      }

      return `[${time}] TOOL RESULT\n${tool} completed.`;
    }

    return `[${time}] MESSAGE\n${role || 'Received model message.'}`;
  }

  if (event.type === 'agent.trace') {
    return null;
  }

  if (event.type === 'tool.started') {
    return null;
  }

  if (event.type === 'tool.completed') {
    return null;
  }

  if (event.type === 'result.saved') {
    return `[${time}] ${formatSavedResult(data.result)}`;
  }

  if (event.type === 'session.completed') {
    return `[${time}] SESSION COMPLETE\nExtraction finished.`;
  }

  if (event.type === 'session.failed') {
    return `[${time}] SESSION FAILED\n${String(
      data.error ?? 'Extraction failed.'
    )}`;
  }

  return `[${time}] ${event.type}\n${formatTextValue(data)}`;
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
          type: 'upload.ready',
          id: crypto.randomUUID().slice(0, 8),
          parentId: null,
          timestamp:
            new Date().toISOString(),
          data: {},
          workspaceId:
            data.workspaceId,
          filename:
            data.filename,
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
              (event.result ??
                event.data?.result) as AircraftData
            );
          }

          if (
            event.type ===
            'session.failed'
          ) {
            setError(
              String(
                event.error ??
                  event.data?.error ??
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
                  ) => {
                    const formatted =
                      formatTraceEvent(
                        event
                      );

                    if (!formatted) {
                      return null;
                    }

                    return (
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
                        {formatted}
                      </div>
                    );
                  }
                )}

              </div>
            </div>
          )}

          {aircraftData && (
            <div className="mt-6">

              <h3 className="mb-4 text-lg font-semibold text-gray-700">
                AI / Pi Extraction
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