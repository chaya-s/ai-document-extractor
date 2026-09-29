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

// --------------------------------
// Common field schema
// --------------------------------

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

// --------------------------------
// Component schema
// --------------------------------

const COMPONENT_SCHEMA = Type.Object(
  {
    type: Type.String(),

    serialNumber: Type.Union([
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

// --------------------------------
// read_document
// --------------------------------

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

// --------------------------------
// grep_document
// --------------------------------

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

// --------------------------------
// save_result
// --------------------------------

export const saveResultTool: Tool = {
  name: 'save_result',

  description:
    'Validate and save the final aircraft extraction. Extract reporting period, aircraft serial number, aircraft utilization fields, aircraft type, and all identifiable aircraft components. Use null and confidence 0 when a value cannot be found.',

  parameters: Type.Object(
    {
      // NEW
      'Reporting Period': FIELD_SCHEMA,

      // NEW
      'Aircraft Serial Number':
        FIELD_SCHEMA,

      // Existing
      'Aircraft Type': FIELD_SCHEMA,

      'Total Month Cycles':
        FIELD_SCHEMA,

      'Total Month Hours':
        FIELD_SCHEMA,

      'Total New Cycles':
        FIELD_SCHEMA,

      'Total New Time':
        FIELD_SCHEMA,

      // NEW
      'Component List': Type.Array(
        COMPONENT_SCHEMA
      ),
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

// --------------------------------
// Tools exposed to Pi
// --------------------------------

export const documentTools = [
  readDocumentTool,
  grepDocumentTool,
  saveResultTool,
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSuspiciousPartialSerial(
  value: string
) {
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
  const escaped = escapeRegExp(
    serialNumber.trim()
  );

  const pattern = new RegExp(
    `(^|[^A-Za-z0-9-])${escaped}($|[^A-Za-z0-9-])`,
    'i'
  );

  return pattern.test(document);
}

// --------------------------------
// Tool result type
// --------------------------------

export type ToolExecution = {
  result: unknown;

  summary: Record<
    string,
    unknown
  >;

  terminal: boolean;
};

// --------------------------------
// Execute workspace tool
// --------------------------------

export async function executeWorkspaceTool(
  workspaceId: string,
  toolCall: ToolCall
): Promise<ToolExecution> {

  const args =
    validateToolCall(
      documentTools,
      toolCall
    ) as Record<
      string,
      unknown
    >;

  // =================================
  // read_document
  // =================================

  if (
    toolCall.name ===
    'read_document'
  ) {

    const offset =
      Number(args.offset);

    const requestedLimit =
      Number(args.limit);

    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(
        requestedLimit
      ) ||
      requestedLimit < 1
    ) {
      throw new Error(
        'Invalid read_document offset or limit.'
      );
    }

    const limit =
      Math.min(
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

    if (
      offset >
      document.length
    ) {
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
      offset +
      content.length;

    const endOfDocument =
      nextOffset >=
      document.length;

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

  // =================================
  // grep_document
  // =================================

  if (
    toolCall.name ===
    'grep_document'
  ) {

    const query =
      String(args.query);

    const maxMatches =
      Math.min(
        Number(
          args.maxMatches ??
          10
        ),
        20
      );

    if (
      !Number.isInteger(
        maxMatches
      ) ||
      maxMatches < 1
    ) {
      throw new Error(
        'grep_document maxMatches must be a positive integer.'
      );
    }

    if (
      !query.trim()
    ) {
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
      matches.length <
      maxMatches
    ) {

      const matchOffset =
        lowerDocument.indexOf(
          lowerQuery,
          searchFrom
        );

      if (
        matchOffset === -1
      ) {
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
        offset:
          matchOffset,

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

        offsets:
          matches
            .slice(0, 10)
            .map((match) =>
              match.offset
            ),

        matches:
          matches
            .slice(0, 5)
            .map((match) => ({
              offset:
                match.offset,

              preview:
                match.excerpt
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 180),
            })),
      },

      terminal: false,
    };
  }

  // =================================
  // save_result
  // =================================

  if (
    toolCall.name ===
    'save_result'
  ) {

    const expectedFields = [
      'Reporting Period',
      'Aircraft Serial Number',
      'Aircraft Type',
      'Total Month Cycles',
      'Total Month Hours',
      'Total New Cycles',
      'Total New Time',
    ];

    // --------------------------------
    // Validate normal fields
    // --------------------------------

    for (
      const fieldName
      of expectedFields
    ) {

      const field =
        args[
          fieldName
        ] as {
          value:
            string |
            null;

          confidence:
            number;
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

    // --------------------------------
    // Validate component list
    // --------------------------------

    const components =
      args[
        'Component List'
      ] as Array<{
        type: string;

        serialNumber:
          string |
          null;

        confidence:
          number;
      }>;

    if (
      !Array.isArray(
        components
      )
    ) {
      throw new Error(
        'Component List must be an array.'
      );
    }

    const documentPathForValidation =
      resolveWorkspacePath(
        workspaceId,
        'uploads',
        'document.md'
      );

    const documentTextForValidation =
      await fs.readFile(
        documentPathForValidation,
        'utf-8'
      );

    for (
      const component
      of components
    ) {

      if (
        !component.type
      ) {
        throw new Error(
          'Component type is required.'
        );
      }

      if (
        component.serialNumber ===
          null &&
        component.confidence !==
          0
      ) {
        throw new Error(
          `${component.type}: null serial number must use confidence 0.`
        );
      }

      if (
        typeof component.serialNumber ===
          'string'
      ) {
        const serialNumber =
          component.serialNumber.trim();

        if (!serialNumber) {
          throw new Error(
            `${component.type}: empty serial number must use null and confidence 0.`
          );
        }

        if (
          isSuspiciousPartialSerial(
            serialNumber
          )
        ) {
          throw new Error(
            `${component.type}: serial number "${serialNumber}" appears incomplete. Verify the full value with read_document or use null with confidence 0.`
          );
        }

        if (
          !serialAppearsAsCompleteToken(
            documentTextForValidation,
            serialNumber
          )
        ) {
          throw new Error(
            `${component.type}: serial number "${serialNumber}" was not found as a complete token in the document. Verify the full value with read_document or use null with confidence 0.`
          );
        }
      }

      if (
        component.confidence < 0 ||
        component.confidence > 100
      ) {
        throw new Error(
          `${component.type}: confidence must be between 0 and 100.`
        );
      }
    }

    // --------------------------------
    // Save AI extraction
    // --------------------------------

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

        componentCount:
          components.length,
      },

      terminal: true,
    };
  }

  throw new Error(
    `Unknown tool: ${toolCall.name}`
  );
}