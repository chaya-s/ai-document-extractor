import fs from 'fs/promises';

import {
  Type,
  validateToolCall,
  type Tool,
  type ToolCall,
} from '@earendil-works/pi-ai';

import {
  resolveWorkspacePath,
} from '@/lib/pi-workspace';

const FIELD_SCHEMA = Type.Object(
  {
    value: Type.Union([
      Type.String(),
      Type.Null(),
    ]),

    confidence: Type.Number({
      minimum: 0,
      maximum: 100,
    }),
  },
  {
    additionalProperties: false,
  }
);

export const readDocumentTool: Tool = {
  name: 'read_document',

  description:
    'Read a bounded section of the active workspace document using a character offset and limit. No file paths are accepted.',

  parameters: Type.Object(
    {
      offset: Type.Integer({
        minimum: 0,
      }),

      limit: Type.Integer({
        minimum: 1,
        maximum: 12000,
      }),
    },
    {
      additionalProperties: false,
    }
  ),
};

export const grepDocumentTool: Tool = {
  name: 'grep_document',

  description:
    'Find literal case-insensitive matches in the active workspace document. Returns character offsets that can be passed directly to read_document. No file paths are accepted.',

  parameters: Type.Object(
    {
      query: Type.String({
        minLength: 1,
        maxLength: 120,
      }),

      maxMatches: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 20,
        })
      ),
    },
    {
      additionalProperties: false,
    }
  ),
};

export const saveResultTool: Tool = {
  name: 'save_result',

  description:
    'Validate and save the final aircraft extraction. Use null and confidence 0 when a value is not found.',

  parameters: Type.Object(
    {
      'Total Month Cycles': FIELD_SCHEMA,
      'Total Month Hours': FIELD_SCHEMA,
      'Total New Cycles': FIELD_SCHEMA,
      'Total New Time': FIELD_SCHEMA,
      'Aircraft Type': FIELD_SCHEMA,
    },
    {
      additionalProperties: false,
    }
  ),

  constrainedSampling: {
    type: 'json_schema',
    strict: 'prefer',
  },
};

export const documentTools = [
  readDocumentTool,
  grepDocumentTool,
  saveResultTool,
];

export type ToolExecution = {
  result: unknown;
  summary: Record<string, unknown>;
  terminal: boolean;
};

export async function executeWorkspaceTool(
  workspaceId: string,
  toolCall: ToolCall
): Promise<ToolExecution> {
  const args = validateToolCall(
    documentTools,
    toolCall
  ) as Record<string, unknown>;

  // --------------------------------
  // read_document
  // --------------------------------
  if (toolCall.name === 'read_document') {
    const offset = Number(args.offset);
    const requestedLimit = Number(args.limit);

    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1
    ) {
      throw new Error(
        'Invalid read_document offset or limit.'
      );
    }

    const limit = Math.min(
      requestedLimit,
      12000
    );

    const documentPath =
      resolveWorkspacePath(
        workspaceId,
        'uploads',
        'document.md'
      );

    const document =
      await fs.readFile(
        documentPath,
        'utf-8'
      );

    if (offset > document.length) {
      throw new Error(
        'read_document offset is beyond the document length.'
      );
    }

    const content =
      document.slice(
        offset,
        offset + limit
      );

    const nextOffset =
      offset + content.length;

    const endOfDocument =
      nextOffset >= document.length;

    return {
      result: {
        content,
        offset,
        nextOffset,
        endOfDocument,
      },

      summary: {
        offset,
        nextOffset,
        returnedCharacters:
          content.length,
        endOfDocument,
      },

      terminal: false,
    };
  }

  // --------------------------------
  // grep_document
  // --------------------------------
  if (toolCall.name === 'grep_document') {
    const query = String(args.query);

    const maxMatches = Math.min(
      Number(args.maxMatches ?? 10),
      20
    );

    if (
      !Number.isInteger(maxMatches) ||
      maxMatches < 1
    ) {
      throw new Error(
        'grep_document maxMatches must be a positive integer.'
      );
    }

    if (!query.trim()) {
      throw new Error(
        'grep_document query is required.'
      );
    }

    const documentPath =
      resolveWorkspacePath(
        workspaceId,
        'uploads',
        'document.md'
      );

    const document =
      await fs.readFile(
        documentPath,
        'utf-8'
      );

    const lowerDocument =
      document.toLowerCase();

    const lowerQuery =
      query.toLowerCase();

    const matches: {
      offset: number;
      excerpt: string;
    }[] = [];

    let searchFrom = 0;

    while (
      matches.length < maxMatches
    ) {
      const matchOffset =
        lowerDocument.indexOf(
          lowerQuery,
          searchFrom
        );

      if (matchOffset === -1) {
        break;
      }

      const excerptStart =
        Math.max(
          0,
          matchOffset - 120
        );

      const excerptEnd =
        Math.min(
          document.length,
          matchOffset +
            query.length +
            300
        );

      const excerpt =
        document.slice(
          excerptStart,
          excerptEnd
        );

      matches.push({
        offset: matchOffset,
        excerpt,
      });

      searchFrom =
        matchOffset +
        Math.max(
          query.length,
          1
        );
    }

    return {
      result: {
        query,
        matches,
      },

      summary: {
        query,
        matchCount:
          matches.length,
      },

      terminal: false,
    };
  }

  // --------------------------------
  // save_result
  // --------------------------------
  if (toolCall.name === 'save_result') {
    const expectedFields = [
      'Total Month Cycles',
      'Total Month Hours',
      'Total New Cycles',
      'Total New Time',
      'Aircraft Type',
    ];

    for (
      const fieldName
      of expectedFields
    ) {
      const field =
        args[fieldName] as {
          value: string | null;
          confidence: number;
        };

      if (!field) {
        throw new Error(
          `${fieldName}: field is missing.`
        );
      }

      if (
        field.value === null &&
        field.confidence !== 0
      ) {
        throw new Error(
          `${fieldName}: null value must use confidence 0.`
        );
      }

      if (
        field.confidence < 0 ||
        field.confidence > 100
      ) {
        throw new Error(
          `${fieldName}: confidence must be between 0 and 100.`
        );
      }
    }

    const resultPath =
      resolveWorkspacePath(
        workspaceId,
        'results',
        'result.json'
      );

    await fs.writeFile(
      resultPath,
      JSON.stringify(
        args,
        null,
        2
      ),
      'utf-8'
    );

    return {
      result: {
        saved: true,
      },

      summary: {
        saved: true,
        fields:
          expectedFields,
      },

      terminal: true,
    };
  }

  throw new Error(
    `Unknown tool: ${toolCall.name}`
  );
}