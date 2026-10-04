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
  value: string | number | null;
  confidence: number;
};

type BoundingBox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  matched_text: string;
};

type ComponentKey =
  | 'Airframe'
  | 'Engine1'
  | 'Engine2'
  | 'APU'
  | 'LandingGearLeft'
  | 'LandingGearRight'
  | 'LandingGearNose';

type ComponentField = {
  SerialNumber: string | null;
  TSN: string | number | null;
  CSN: string | number | null;
  MonthlyUtil_Hrs: string | number | null;
  MonthlyUtil_Cyc: string | number | null;
  attachment_status: string | null;
  derate: string | null;
  location: string | null;
  extraction_confidence: number;
  raw_source_text: string | null;
  available: boolean;
  TSN_raw: string | null;
  CSN_raw: string | null;
  MonthlyUtil_Hrs_raw: string | null;
  MonthlyUtil_Cyc_raw: string | null;
  source_file: string | null;
  current_aircraft: string | null;
  SerialNumber_bbox: BoundingBox | null;
  TSN_bbox: BoundingBox | null;
  CSN_bbox: BoundingBox | null;
  MonthlyUtil_Hrs_bbox: BoundingBox | null;
  MonthlyUtil_Cyc_bbox: BoundingBox | null;
  location_bbox: BoundingBox | null;
};

type AircraftData = {
  aircraft?: {
    aircraft_type?: string | number | null;
    msn?: string | number | null;
    registration?: string | number | null;
    reporting_period?: string | number | null;
    source_file?: string | null;
  };

  fields?: Array<{
    name: string;
    value: string | number | null;
    confidence: number;
  }>;

  components?: Partial<Record<ComponentKey, ComponentField>>;
  savedAt?: string;
} & Partial<Record<FieldName, ExtractedField>> & {
    'Component List'?: Array<{
      type: string;
      serialNumber: string | null;
      confidence: number;
    }>;
  };

const COMPONENT_ROWS: Array<{
  key: ComponentKey;
  label: string;
}> = [
  { key: 'Airframe', label: 'Airframe' },
  { key: 'Engine1', label: 'Engine 1' },
  { key: 'Engine2', label: 'Engine 2' },
  { key: 'APU', label: 'APU' },
  { key: 'LandingGearLeft', label: 'Landing Gear Left' },
  { key: 'LandingGearRight', label: 'Landing Gear Right' },
  { key: 'LandingGearNose', label: 'Landing Gear Nose' },
];

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

function formatTextValue(value: unknown): string {
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

function traceJson(value: unknown) {
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

function displayValue(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '-';
  }

  return String(value);
}

function fieldValue(
  result: Record<string, unknown>,
  field: FieldName
) {
  const fields = result.fields;

  if (Array.isArray(fields)) {
    const item = fields.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'name' in entry &&
        (entry as { name?: unknown }).name === field
    ) as { value?: unknown } | undefined;

    if (item) {
      return displayValue(item.value);
    }
  }

  const value = result[field];

  if (
    typeof value === 'object' &&
    value !== null &&
    'value' in value
  ) {
    return displayValue(
      (value as { value?: unknown }).value
    );
  }

  return '-';
}

function componentConfidence(value: unknown) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return '0%';
  }

  const percent =
    numeric <= 1 ? numeric * 100 : numeric;

  return `${Math.round(percent)}%`;
}

function fieldFromData(
  data: AircraftData | null,
  name: FieldName
) {
  if (!data) {
    return null;
  }

  const fromFields = data.fields?.find(
    (field) => field.name === name
  );

  if (fromFields) {
    return fromFields;
  }

  return data[name] ?? null;
}

function legacyComponent(
  data: AircraftData,
  key: ComponentKey
): ComponentField | null {
  const legacy = data['Component List']?.find(
    (item) => item.type === key
  );

  if (!legacy) {
    return null;
  }

  return {
    SerialNumber: legacy.serialNumber,
    TSN: null,
    CSN: null,
    MonthlyUtil_Hrs: null,
    MonthlyUtil_Cyc: null,
    attachment_status: legacy.serialNumber
      ? 'Found'
      : 'Not found',
    derate: null,
    location: null,
    extraction_confidence:
      legacy.confidence / 100,
    raw_source_text: null,
    available: Boolean(legacy.serialNumber),
    TSN_raw: null,
    CSN_raw: null,
    MonthlyUtil_Hrs_raw: null,
    MonthlyUtil_Cyc_raw: null,
    source_file: null,
    current_aircraft: null,
    SerialNumber_bbox: null,
    TSN_bbox: null,
    CSN_bbox: null,
    MonthlyUtil_Hrs_bbox: null,
    MonthlyUtil_Cyc_bbox: null,
    location_bbox: null,
  };
}

function componentFromData(
  data: AircraftData,
  key: ComponentKey
) {
  return (
    data.components?.[key] ??
    legacyComponent(data, key)
  );
}

function formatSavedResult(result: unknown) {
  const lines = [
    'RESULT SAVED',
    'Aircraft extraction saved successfully.',
  ];

  if (
    typeof result !== 'object' ||
    result === null
  ) {
    return lines.join('\n');
  }

  const data = result as Record<string, unknown>;

  lines.push(
    `Reporting Period: ${fieldValue(
      data,
      'Reporting Period'
    )}`,
    `Aircraft Serial Number: ${fieldValue(
      data,
      'Aircraft Serial Number'
    )}`,
    `Aircraft Type: ${fieldValue(
      data,
      'Aircraft Type'
    )}`
  );

  return lines.join('\n');
}

function formatToolStarted(
  data: Record<string, unknown>
) {
  const tool = String(data.tool ?? 'tool');

  if (tool === 'grep_document') {
    return `SEARCHING\nLooking for ${String(
      data.query ?? 'document'
    )}`;
  }

  if (tool === 'read_document') {
    const offset = data.offset;
    const limit = data.limit;
    const range =
      offset !== undefined || limit !== undefined
        ? `\nOffset: ${String(offset ?? 0)}; limit: ${String(
            limit ?? 'default'
          )}`
        : '';

    return `READING DOCUMENT\nInspecting nearby aircraft information.${range}`;
  }

  if (tool === 'find_text_coordinates') {
    return `FINDING COORDINATES\nLooking for coordinates for ${String(
      data.text ?? 'text'
    )}`;
  }

  if (tool === 'save_result') {
    return 'SAVING RESULT\nSaving extracted aircraft details.';
  }

  return `USING TOOL\n${tool}`;
}

function formatToolCompleted(
  data: Record<string, unknown>
) {
  const tool = String(data.tool ?? 'tool');

  if (data.error) {
    return `TOOL FAILED\n${String(data.error)}`;
  }

  if (tool === 'grep_document') {
    return formatSearchResult(data);
  }

  if (tool === 'read_document') {
    return `DOCUMENT READ\nRead ${String(
      data.returnedCharacters ?? '0'
    )} characters from document offset ${String(
      data.offset ?? '0'
    )}.`;
  }

  if (tool === 'find_text_coordinates') {
    return `COORDINATES\nFound ${String(
      data.matchCount ?? '0'
    )} coordinate matches for "${String(
      data.text ?? 'text'
    )}".`;
  }

  if (tool === 'save_result') {
    return 'RESULT SAVED\nAircraft extraction saved successfully.';
  }

  return `TOOL COMPLETE\n${tool} completed.`;
}

function formatTraceList(
  label: string,
  value: unknown
) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const items = value
    .map((item) => shortPreview(item))
    .filter(Boolean);

  if (items.length === 0) {
    return null;
  }

  return [label, ...items.map((item) => `- ${item}`)].join('\n');
}

function formatAgentTrace(
  data: Record<string, unknown>
) {
  const lines = ['AGENT TRACE'];

  if (data.objective) {
    lines.push(`Objective: ${String(data.objective)}`);
  }

  const evidence = formatTraceList(
    'Evidence:',
    data.evidence
  );

  if (evidence) {
    lines.push(evidence);
  }

  const missing = formatTraceList(
    'Missing:',
    data.missing
  );

  if (missing) {
    lines.push(missing);
  }

  const action =
    typeof data.action === 'object' && data.action !== null
      ? (data.action as Record<string, unknown>)
      : null;

  if (action?.tool) {
    const details = [
      `Tool: ${String(action.tool)}`,
      action.query ? `query: ${String(action.query)}` : null,
      action.offset !== undefined
        ? `offset: ${String(action.offset)}`
        : null,
      action.limit !== undefined
        ? `limit: ${String(action.limit)}`
        : null,
    ].filter(Boolean);

    lines.push(`Action: ${details.join('; ')}`);
  }

  if (data.reason) {
    lines.push(`Reason: ${String(data.reason)}`);
  }

  if (data.uncertainty) {
    lines.push(`Uncertainty: ${String(data.uncertainty)}`);
  }

  if (data.next) {
    lines.push(`Next: ${String(data.next)}`);
  }

  return lines.length > 1 ? lines.join('\n') : null;
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
    const filename = String(
      data.filename ?? 'document'
    );

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
    return `[${time}] MODEL STARTED\nModel: ${String(
      data.provider ?? ''
    )}/${String(data.model ?? '')}\nMessages: ${String(
      data.messages ?? '0'
    )}`;
  }

  if (event.type === 'message') {
    const message = eventMessage(event);
    const role = String(message.role ?? '');

    if (role === 'assistant') {
      const visibleText =
        textBlocksFromMessage(message);

      if (visibleText) {
        return `[${time}]\n${visibleText}`;
      }

      const toolCalls =
        toolCallsFromTraceMessage(message);

      const toolTexts = toolCalls.map((block) => {
        const tool = String(block.name ?? '');
        const args = toolArguments(block);

        if (tool === 'grep_document') {
          return `SEARCHING\nLooking for ${String(
            args.query ?? 'document'
          )}`;
        }

        if (tool === 'read_document') {
          return 'READING DOCUMENT\nInspecting nearby aircraft information.';
        }

        if (tool === 'find_text_coordinates') {
          return `FINDING COORDINATES\nLooking for coordinates for ${String(
            args.text ?? 'text'
          )}`;
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
          message.error ??
            'Tool execution failed.'
        )}`;
      }

      const details =
        typeof message.details === 'object' &&
        message.details !== null
          ? (message.details as Record<
              string,
              unknown
            >)
          : {};

      if (tool === 'grep_document') {
        return `[${time}] ${formatSearchResult(
          details
        )}`;
      }

      if (tool === 'read_document') {
        return `[${time}] DOCUMENT READ\nRead ${String(
          details.returnedCharacters ?? '0'
        )} characters from document offset ${String(
          details.offset ?? '0'
        )}.`;
      }

      if (tool === 'find_text_coordinates') {
        return `[${time}] COORDINATES\nFound ${String(
          details.matchCount ?? '0'
        )} coordinate matches for ${String(
          details.text ?? 'text'
        )}.`;
      }

      if (tool === 'save_result') {
        return `[${time}] RESULT SAVED\nAircraft extraction saved successfully.`;
      }

      return `[${time}] TOOL RESULT\n${tool} completed.`;
    }

    return `[${time}] MESSAGE\n${
      role || 'Received model message.'
    }`;
  }

  if (event.type === 'agent.trace') {
    const formatted = formatAgentTrace(data);

    return formatted ? `[${time}] ${formatted}` : null;
  }

  if (event.type === 'tool.started') {
    return `[${time}] ${formatToolStarted(data)}`;
  }

  if (event.type === 'tool.completed') {
    return `[${time}] ${formatToolCompleted(data)}`;
  }

  if (event.type === 'result.saved') {
    return `[${time}] ${formatSavedResult(
      data.result
    )}`;
  }

  if (event.type === 'session.completed') {
    return `[${time}] SESSION COMPLETE\nExtraction finished.`;
  }

  if (event.type === 'session.failed') {
    return `[${time}] SESSION FAILED\n${String(
      data.error ?? 'Extraction failed.'
    )}`;
  }

  return `[${time}] ${event.type}\n${formatTextValue(
    data
  )}`;
}

export default function Documentloader() {
  const [file, setFile] =
    useState<File | null>(null);

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
    window.dispatchEvent(
      new CustomEvent('rrweb:workspace-ready', {
        detail: { workspaceId: '' },
      })
    );
    setAircraftData(null);
    setTraceEvents([]);
    setError('');
    setUploading(true);

    try {
      const formData = new FormData();

      formData.append('file', selectedFile);

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

      setWorkspaceId(data.workspaceId);
      window.dispatchEvent(
        new CustomEvent('rrweb:workspace-ready', {
          detail: {
            workspaceId: data.workspaceId,
          },
        })
      );

      setTraceEvents([
        {
          type: 'upload.ready',
          id: crypto.randomUUID().slice(0, 8),
          parentId: null,
          timestamp: new Date().toISOString(),
          data: {},
          workspaceId: data.workspaceId,
          filename: data.filename,
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

      const decoder = new TextDecoder();

      let buffer = '';

      while (true) {
        const { value, done } =
          await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, {
          stream: true,
        });

        const lines = buffer.split('\n');

        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = JSON.parse(
            line
          ) as TraceEvent;

          setTraceEvents((current) => [
            ...current,
            event,
          ]);

          if (
            event.type === 'result.saved'
          ) {
            setAircraftData(
              (event.result ??
                event.data
                  ?.result) as AircraftData
            );
          }

          if (
            event.type === 'session.failed'
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
        <div className="rr-mask mt-5 rounded-xl bg-green-50 p-4">
          <p className="font-medium text-green-700">
            Document ready
          </p>

          <p className="mt-1 text-sm text-green-600">
            {file.name}
          </p>

          <p className="mt-2 break-all text-xs text-green-500">
            Workspace: {workspaceId}
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
            Extract structured aircraft details
            from the document
          </p>

          <button
            onClick={extractAircraftData}
            disabled={
              extracting || !workspaceId
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
            <div className="rr-block mt-6 rounded-xl bg-gray-950 p-5 text-white">
              <h3 className="mb-4 text-lg font-semibold">
                Pi Session Logs
              </h3>

              <div className="max-h-96 overflow-y-auto">
                {traceEvents.map(
                  (event, index) => {
                    const formatted =
                      formatTraceEvent(event);

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

              <div className="rr-mask rounded-xl border border-gray-200 bg-gray-50 p-5">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Aircraft Information
                </h4>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    {
                      label:
                        'Aircraft Type',
                      value:
                        aircraftData.aircraft
                          ?.aircraft_type ??
                        fieldFromData(
                          aircraftData,
                          'Aircraft Type'
                        )?.value,
                    },
                    {
                      label: 'MSN',
                      value:
                        aircraftData.aircraft
                          ?.msn ??
                        fieldFromData(
                          aircraftData,
                          'Aircraft Serial Number'
                        )?.value,
                    },
                    {
                      label:
                        'Registration',
                      value:
                        aircraftData.aircraft
                          ?.registration,
                    },
                    {
                      label:
                        'Reporting Period',
                      value:
                        aircraftData.aircraft
                          ?.reporting_period ??
                        fieldFromData(
                          aircraftData,
                          'Reporting Period'
                        )?.value,
                    },
                    {
                      label:
                        'Source File',
                      value:
                        aircraftData.aircraft
                          ?.source_file ??
                        file?.name,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                    >
                      <p className="text-xs font-medium text-gray-400">
                        {item.label}
                      </p>

                      <p className="mt-1 text-sm font-semibold text-gray-800">
                        {displayValue(
                          item.value
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rr-mask mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {[
                        'Component',
                        'MSN / Serial Number',
                        'TSN',
                        'CSN',
                        'Monthly Hours',
                        'Monthly Cycles',
                        'Status',
                        'Location',
                        'Confidence',
                      ].map((header) => (
                        <th
                          key={header}
                          className="whitespace-nowrap px-4 py-3 font-semibold text-gray-600"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {COMPONENT_ROWS.map(
                      (row) => {
                        const component =
                          componentFromData(
                            aircraftData,
                            row.key
                          );

                        return (
                          <tr
                            key={row.key}
                            className="border-t border-gray-100"
                          >
                            <td className="whitespace-nowrap px-4 py-4 font-medium text-gray-700">
                              {row.label}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4 text-gray-900">
                              {displayValue(
                                component?.SerialNumber
                              )}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4 text-gray-900">
                              {displayValue(
                                component?.TSN
                              )}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4 text-gray-900">
                              {displayValue(
                                component?.CSN
                              )}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4 text-gray-900">
                              {displayValue(
                                component?.MonthlyUtil_Hrs
                              )}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4 text-gray-900">
                              {displayValue(
                                component?.MonthlyUtil_Cyc
                              )}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4 text-gray-900">
                              {component?.available
                                ? displayValue(
                                    component.attachment_status ??
                                      'Found'
                                  )
                                : 'Not found'}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4 text-gray-900">
                              {displayValue(
                                component?.location
                              )}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4">
                              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                                {componentConfidence(
                                  component?.extraction_confidence
                                )}
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