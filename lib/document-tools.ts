import fs from 'fs/promises';

import {
  Type,
  validateToolCall,
  type Tool,
  type ToolCall,
} from '@earendil-works/pi-ai';

import {
  readSession,
  workspaceFilePaths,
} from '@/lib/pi-workspace';

const COMPONENT_KEYS = [
  'Airframe',
  'Engine1',
  'Engine2',
  'APU',
  'LandingGearLeft',
  'LandingGearRight',
  'LandingGearNose',
] as const;

type ComponentKey = (typeof COMPONENT_KEYS)[number];

type FieldResult = {
  name: string;
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

type ComponentResult = {
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

type SavedExtraction = {
  aircraft: {
    aircraft_type: string | number | null;
    msn: string | number | null;
    registration: string | number | null;
    reporting_period: string | number | null;
    source_file: string;
  };
  fields: FieldResult[];
  components: Record<ComponentKey, ComponentResult>;
  savedAt: string;
};

type LiteParseWord = {
  text?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
};

type LiteParseTextItem = LiteParseWord & {
  words?: unknown;
};

type LiteParsePage = {
  pageNum?: unknown;
  width?: unknown;
  height?: unknown;
  textItems?: unknown;
};

type LiteParseResult = {
  pages?: unknown;
};

const STRING_NUMBER_NULL = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Null(),
]);

const STRING_NULL = Type.Union([
  Type.String(),
  Type.Null(),
]);

const BBOX_SCHEMA = Type.Union([
  Type.Object(
    {
      page: Type.Integer({ minimum: 1 }),
      x: Type.Number(),
      y: Type.Number(),
      width: Type.Number(),
      height: Type.Number(),
      matched_text: Type.String(),
    },
    { additionalProperties: false }
  ),
  Type.Null(),
]);

const FIELD_SCHEMA = Type.Object(
  {
    name: Type.String(),
    value: STRING_NUMBER_NULL,
    confidence: Type.Number({ minimum: 0, maximum: 100 }),
  },
  { additionalProperties: false }
);

const COMPONENT_SCHEMA = Type.Object(
  {
    SerialNumber: STRING_NULL,
    TSN: STRING_NUMBER_NULL,
    CSN: STRING_NUMBER_NULL,
    MonthlyUtil_Hrs: STRING_NUMBER_NULL,
    MonthlyUtil_Cyc: STRING_NUMBER_NULL,
    attachment_status: STRING_NULL,
    derate: STRING_NULL,
    location: STRING_NULL,
    extraction_confidence: Type.Number({ minimum: 0, maximum: 1 }),
    raw_source_text: STRING_NULL,
    available: Type.Boolean(),
    TSN_raw: STRING_NULL,
    CSN_raw: STRING_NULL,
    MonthlyUtil_Hrs_raw: STRING_NULL,
    MonthlyUtil_Cyc_raw: STRING_NULL,
    source_file: STRING_NULL,
    current_aircraft: STRING_NULL,
    SerialNumber_bbox: BBOX_SCHEMA,
    TSN_bbox: BBOX_SCHEMA,
    CSN_bbox: BBOX_SCHEMA,
    MonthlyUtil_Hrs_bbox: BBOX_SCHEMA,
    MonthlyUtil_Cyc_bbox: BBOX_SCHEMA,
    location_bbox: BBOX_SCHEMA,
  },
  { additionalProperties: false }
);

export const readDocumentTool: Tool = {
  name: 'read_document',
  description:
    'Read a bounded section of the active workspace Markdown document using a character offset and limit. No file paths are accepted.',
  parameters: Type.Object(
    {
      offset: Type.Integer({ minimum: 0 }),
      limit: Type.Integer({ minimum: 1, maximum: 12000 }),
    },
    { additionalProperties: false }
  ),
};

export const grepDocumentTool: Tool = {
  name: 'grep_document',
  description:
    'Find literal case-insensitive matches in the active workspace Markdown document. Returns character offsets that can be passed directly to read_document. No file paths are accepted.',
  parameters: Type.Object(
    {
      query: Type.String({ minLength: 1, maxLength: 120 }),
      maxMatches: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20 })
      ),
    },
    { additionalProperties: false }
  ),
};

export const findTextCoordinatesTool: Tool = {
  name: 'find_text_coordinates',
  description:
    'Find source coordinates for exact text using the active workspace LiteParse JSON. Returns page/x/y/width/height/matched_text boxes. No file paths are accepted.',
  parameters: Type.Object(
    {
      text: Type.String({ minLength: 1, maxLength: 160 }),
      maxMatches: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20 })
      ),
    },
    { additionalProperties: false }
  ),
};

export const saveResultTool: Tool = {
  name: 'save_result',
  description:
    'Validate and save the final structured aircraft utilization extraction. Use null and confidence 0 when values cannot be found. Include all fixed component keys, even unavailable components.',
  parameters: Type.Object(
    {
      aircraft: Type.Object(
        {
          aircraft_type: STRING_NUMBER_NULL,
          msn: STRING_NUMBER_NULL,
          registration: STRING_NUMBER_NULL,
          reporting_period: STRING_NUMBER_NULL,
          source_file: Type.String(),
        },
        { additionalProperties: false }
      ),
      fields: Type.Array(FIELD_SCHEMA),
      components: Type.Object(
        {
          Airframe: COMPONENT_SCHEMA,
          Engine1: COMPONENT_SCHEMA,
          Engine2: COMPONENT_SCHEMA,
          APU: COMPONENT_SCHEMA,
          LandingGearLeft: COMPONENT_SCHEMA,
          LandingGearRight: COMPONENT_SCHEMA,
          LandingGearNose: COMPONENT_SCHEMA,
        },
        { additionalProperties: false }
      ),
    },
    { additionalProperties: false }
  ),
  constrainedSampling: {
    type: 'json_schema',
    strict: 'prefer',
  },
};

export const documentTools = [
  readDocumentTool,
  grepDocumentTool,
  findTextCoordinatesTool,
  saveResultTool,
];

export type ToolExecution = {
  result: unknown;
  summary: Record<string, unknown>;
  terminal: boolean;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSuspiciousPartialSerial(value: string) {
  const normalized = value.trim();

  return (
    /^P-?\d?$/i.test(normalized) ||
    /^MDG$/i.test(normalized) ||
    /^\d{1,3}$/.test(normalized) ||
    /-$/.test(normalized)
  );
}

function serialAppearsAsCompleteToken(
  document: string,
  serialNumber: string
) {
  const escaped = escapeRegExp(serialNumber.trim());
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9-])${escaped}($|[^A-Za-z0-9-])`,
    'i'
  );

  return pattern.test(document);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toNumber(value: unknown) {
  return isFiniteNumber(value) ? value : null;
}

function normalizeComparable(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function compact(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function bboxFromWords(
  page: number,
  words: Array<BoundingBox>,
  matchedText: string
): BoundingBox | null {
  if (words.length === 0) {
    return null;
  }

  const x = Math.min(...words.map((word) => word.x));
  const y = Math.min(...words.map((word) => word.y));
  const right = Math.max(
    ...words.map((word) => word.x + word.width)
  );
  const bottom = Math.max(
    ...words.map((word) => word.y + word.height)
  );

  return {
    page,
    x,
    y,
    width: right - x,
    height: bottom - y,
    matched_text: matchedText,
  };
}

function wordsForPage(page: LiteParsePage): BoundingBox[] {
  const pageNumber =
    typeof page.pageNum === 'number' ? page.pageNum : 1;

  if (!Array.isArray(page.textItems)) {
    return [];
  }

  const words: BoundingBox[] = [];

  for (const rawItem of page.textItems) {
    if (!isObject(rawItem)) {
      continue;
    }

    const item = rawItem as LiteParseTextItem;

    if (Array.isArray(item.words) && item.words.length > 0) {
      const itemWords = item.words
        .filter(isObject)
        .map((word): BoundingBox | null => {
          const text = String(word.text ?? '').trim();
          const x = toNumber(word.x);
          const y = toNumber(word.y);
          const width = toNumber(word.width);
          const height = toNumber(word.height);

          if (!text || x === null || y === null || width === null || height === null) {
            return null;
          }

          return {
            page: pageNumber,
            x,
            y,
            width,
            height,
            matched_text: text,
          };
        })
        .filter((word): word is BoundingBox => word !== null);

      if (itemWords.length > 0) {
        words.push(...itemWords);
        continue;
      }
    }

    const text = String(item.text ?? '').trim();
    const x = toNumber(item.x);
    const y = toNumber(item.y);
    const width = toNumber(item.width);
    const height = toNumber(item.height);

    if (text && x !== null && y !== null && width !== null && height !== null) {
      words.push({
        page: pageNumber,
        x,
        y,
        width,
        height,
        matched_text: text,
      });
    }
  }

  return words;
}

function findCoordinates(
  parsed: LiteParseResult,
  text: string,
  maxMatches: number
) {
  if (!Array.isArray(parsed.pages)) {
    return [];
  }

  const matches: BoundingBox[] = [];
  const targetCompact = compact(text);
  const targetNormalized = normalizeComparable(text);

  for (const rawPage of parsed.pages) {
    if (!isObject(rawPage)) {
      continue;
    }

    const page = rawPage as LiteParsePage;
    const pageNumber =
      typeof page.pageNum === 'number' ? page.pageNum : 1;
    const words = wordsForPage(page);

    for (let start = 0; start < words.length; start++) {
      let combined = '';
      const span: BoundingBox[] = [];

      for (let end = start; end < words.length; end++) {
        combined = `${combined}${words[end].matched_text}`;
        span.push(words[end]);

        const combinedCompact = compact(combined);

        if (combinedCompact === targetCompact) {
          const bbox = bboxFromWords(pageNumber, span, text);

          if (bbox) {
            matches.push(bbox);
          }

          break;
        }

        if (combinedCompact.length > targetCompact.length + 8) {
          break;
        }
      }

      if (matches.length >= maxMatches) {
        return matches;
      }
    }

    for (const word of words) {
      if (
        normalizeComparable(word.matched_text).includes(
          targetNormalized
        )
      ) {
        matches.push({
          ...word,
          matched_text: text,
        });
      }

      if (matches.length >= maxMatches) {
        return matches;
      }
    }
  }

  return matches;
}

function fieldMap(fields: FieldResult[]) {
  const map = new Map<string, FieldResult>();

  for (const field of fields) {
    map.set(field.name, field);
  }

  return map;
}

function nullIfEmpty(value: string | number | null) {
  if (typeof value === 'string' && !value.trim()) {
    return null;
  }

  return value;
}

function normalizeHourValue(
  value: string | number | null,
  raw: string | null
) {
  const candidate =
    typeof raw === 'string' && raw.trim()
      ? raw.trim()
      : typeof value === 'string'
        ? value.trim()
        : '';

  const match = candidate.match(/^(\d+):(\d{1,2})$/);

  if (!match) {
    return nullIfEmpty(value);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) {
    return nullIfEmpty(value);
  }

  return Math.round((hours + minutes / 60) * 100) / 100;
}

function normalizeComponent(
  component: ComponentResult,
  sourceFile: string,
  currentAircraft: string | null
): ComponentResult {
  return {
    ...component,
    SerialNumber: typeof component.SerialNumber === 'string'
      ? component.SerialNumber.trim()
      : null,
    TSN: normalizeHourValue(component.TSN, component.TSN_raw),
    MonthlyUtil_Hrs: normalizeHourValue(
      component.MonthlyUtil_Hrs,
      component.MonthlyUtil_Hrs_raw
    ),
    CSN: nullIfEmpty(component.CSN),
    MonthlyUtil_Cyc: nullIfEmpty(component.MonthlyUtil_Cyc),
    source_file: component.source_file ?? sourceFile,
    current_aircraft: component.current_aircraft ?? currentAircraft,
  };
}

function applyAirframeDefaults(
  extraction: SavedExtraction
) {
  const fields = fieldMap(extraction.fields);
  const airframe = extraction.components.Airframe;

  airframe.SerialNumber ??=
    extraction.aircraft.msn === null
      ? null
      : String(extraction.aircraft.msn);
  airframe.TSN ??= fields.get('Total New Time')?.value ?? null;
  airframe.CSN ??= fields.get('Total New Cycles')?.value ?? null;
  airframe.MonthlyUtil_Hrs ??=
    fields.get('Total Month Hours')?.value ?? null;
  airframe.MonthlyUtil_Cyc ??=
    fields.get('Total Month Cycles')?.value ?? null;
  airframe.available = Boolean(airframe.SerialNumber || airframe.TSN || airframe.CSN);
}

async function activePaths(workspaceId: string) {
  const session = await readSession(workspaceId);

  return {
    session,
    paths: workspaceFilePaths(
      workspaceId,
      session.originalFilename
    ),
  };
}

export async function executeWorkspaceTool(
  workspaceId: string,
  toolCall: ToolCall
): Promise<ToolExecution> {
  const args = validateToolCall(
    documentTools,
    toolCall
  ) as Record<string, unknown>;

  const { session, paths } = await activePaths(workspaceId);

  if (toolCall.name === 'read_document') {
    const offset = Number(args.offset);
    const requestedLimit = Number(args.limit);

    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1
    ) {
      throw new Error('Invalid read_document offset or limit.');
    }

    const limit = Math.min(requestedLimit, 12000);
    const document = await fs.readFile(paths.documentPath, 'utf-8');

    if (offset > document.length) {
      throw new Error('read_document offset is beyond the document length.');
    }

    const content = document.slice(offset, offset + limit);
    const nextOffset = offset + content.length;
    const endOfDocument = nextOffset >= document.length;

    return {
      result: { content, offset, nextOffset, endOfDocument },
      summary: {
        offset,
        nextOffset,
        returnedCharacters: content.length,
        endOfDocument,
      },
      terminal: false,
    };
  }

  if (toolCall.name === 'grep_document') {
    const query = String(args.query);
    const maxMatches = Math.min(Number(args.maxMatches ?? 10), 20);

    if (!Number.isInteger(maxMatches) || maxMatches < 1) {
      throw new Error('grep_document maxMatches must be a positive integer.');
    }

    if (!query.trim()) {
      throw new Error('grep_document query is required.');
    }

    const document = await fs.readFile(paths.documentPath, 'utf-8');
    const lowerDocument = document.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matches: { offset: number; excerpt: string }[] = [];
    let searchFrom = 0;

    while (matches.length < maxMatches) {
      const matchOffset = lowerDocument.indexOf(lowerQuery, searchFrom);

      if (matchOffset === -1) {
        break;
      }

      const excerptStart = Math.max(0, matchOffset - 120);
      const excerptEnd = Math.min(
        document.length,
        matchOffset + query.length + 300
      );

      matches.push({
        offset: matchOffset,
        excerpt: document.slice(excerptStart, excerptEnd),
      });

      searchFrom = matchOffset + Math.max(query.length, 1);
    }

    return {
      result: { query, matches },
      summary: {
        query,
        matchCount: matches.length,
        offsets: matches.slice(0, 10).map((match) => match.offset),
        matches: matches.slice(0, 5).map((match) => ({
          offset: match.offset,
          preview: match.excerpt.replace(/\s+/g, ' ').trim().slice(0, 180),
        })),
      },
      terminal: false,
    };
  }

  if (toolCall.name === 'find_text_coordinates') {
    const text = String(args.text);
    const maxMatches = Math.min(Number(args.maxMatches ?? 10), 20);

    if (!Number.isInteger(maxMatches) || maxMatches < 1) {
      throw new Error('find_text_coordinates maxMatches must be a positive integer.');
    }

    const raw = await fs.readFile(paths.documentJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as LiteParseResult;
    const matches = findCoordinates(parsed, text, maxMatches);

    return {
      result: { text, matches },
      summary: {
        text,
        matchCount: matches.length,
        matches: matches.slice(0, 5),
      },
      terminal: false,
    };
  }

  if (toolCall.name === 'save_result') {
    const extraction = args as unknown as SavedExtraction;
    const document = await fs.readFile(paths.documentPath, 'utf-8');

    applyAirframeDefaults(extraction);

    const currentAircraft =
      extraction.aircraft.msn === null
        ? extraction.components.Airframe.SerialNumber
        : String(extraction.aircraft.msn);

    for (const key of COMPONENT_KEYS) {
      const normalized = normalizeComponent(
        extraction.components[key],
        session.originalFilename,
        currentAircraft
      );

      extraction.components[key] = normalized;

      if (normalized.SerialNumber) {
        if (isSuspiciousPartialSerial(normalized.SerialNumber)) {
          throw new Error(
            `${key}: serial number "${normalized.SerialNumber}" appears incomplete. Verify the full value with read_document or use null.`
          );
        }

        if (!serialAppearsAsCompleteToken(document, normalized.SerialNumber)) {
          throw new Error(
            `${key}: serial number "${normalized.SerialNumber}" was not found as a complete token in the document.`
          );
        }
      }
    }

    const output: SavedExtraction = {
      ...extraction,
      savedAt: new Date().toISOString(),
    };

    await fs.writeFile(
      paths.resultPath,
      JSON.stringify(output, null, 2),
      'utf-8'
    );

    return {
      result: { saved: true },
      summary: {
        saved: true,
        fields: output.fields.map((field) => field.name),
        componentCount: COMPONENT_KEYS.length,
      },
      terminal: true,
    };
  }

  throw new Error(`Unknown tool: ${toolCall.name}`);
}
