import { NextResponse } from 'next/server';

import { LiteParse } from '@llamaindex/liteparse';

import mammoth from 'mammoth';
import fs from 'fs/promises';
import path from 'path';

import {
  createWorkspace,
  writeSession,
} from '@/lib/pi-workspace';

export const runtime = 'nodejs';

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
]);

function getUploadExtension(file: File) {
  const extension = path
    .extname(file.name)
    .toLowerCase();

  if (SUPPORTED_EXTENSIONS.has(extension)) {
    return extension;
  }

  if (file.type === 'application/pdf') {
    return '.pdf';
  }

  if (
    file.type ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return '.docx';
  }

  return '';
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: 'No file uploaded',
        },
        {
          status: 400,
        }
      );
    }

    const extension =
      getUploadExtension(file);

    if (!extension) {
      return NextResponse.json(
        {
          error:
            'Only PDF and DOCX files are supported',
        },
        {
          status: 400,
        }
      );
    }

    // --------------------------------
    // Create isolated workspace
    // --------------------------------
    const workspace =
      await createWorkspace(
        file.name,
        extension
      );

    // --------------------------------
    // Save original uploaded document
    // --------------------------------
    const arrayBuffer =
      await file.arrayBuffer();

    const buffer =
      Buffer.from(arrayBuffer);

    await fs.writeFile(
      workspace.originalFilePath,
      buffer
    );

    // --------------------------------
    // Extract document as Markdown
    // --------------------------------
    let markdownContent = '';

    if (extension === '.pdf') {
      const parser = new LiteParse({
        outputFormat: 'markdown',

        imageMode: 'off',

        extractLinks: true,

        emitWordBoxes: true,

        extractBlocks: true,

        extractDocumentMetadata: true,

        extractContentBounds: true,

        // Your current aircraft PDFs have text.
        // Keep OCR off unless you later need scanned PDFs.
        ocrEnabled: false,
      });

      const result =
        await parser.parse(buffer);

      markdownContent =
        result.text;

      await fs.writeFile(
        workspace.documentJsonPath,
        JSON.stringify(
          result,
          null,
          2
        ),
        'utf-8'
      );
    } else if (
      extension === '.docx'
    ) {
      const result =
        await mammoth.extractRawText({
          buffer,
        });

      const text =
        result.value;

      markdownContent =
        `# ${file.name}\n\n${text}\n`;

      await fs.writeFile(
        workspace.documentJsonPath,
        JSON.stringify(
          {
            totalPages: 0,
            pages: [],
            text,
          },
          null,
          2
        ),
        'utf-8'
      );
    }

    if (
      !markdownContent.trim()
    ) {
      return NextResponse.json(
        {
          error:
            'No text could be extracted from the document',
        },
        {
          status: 400,
        }
      );
    }

    // --------------------------------
    // Save Markdown inside workspace
    // --------------------------------
    await fs.writeFile(
      workspace.documentPath,
      markdownContent,
      'utf-8'
    );

    // --------------------------------
    // Create persisted Pi session
    // --------------------------------
    const now =
      new Date().toISOString();

    await writeSession({
      workspaceId:
        workspace.workspaceId,

      sessionId:
        workspace.sessionId,

      originalFilename:
        file.name,

      status:
        'ready',

      createdAt:
        now,

      updatedAt:
        now,

      context: {
        systemPrompt: `
You are an aircraft document extraction agent.

Your job is to extract aircraft utilization, aircraft identification, and aircraft component information.

Extract:

1. Reporting Period
2. Aircraft Serial Number / MSN
3. Registration when present
4. Aircraft Type
5. Total Month Cycles
6. Total Month Hours
7. Total New Cycles
8. Total New Time
9. Component details for Airframe, Engine1, Engine2, APU, LandingGearLeft, LandingGearRight, and LandingGearNose

For Component List, search for supported aircraft components such as:

- Airframe
- Engine1
- Engine2
- APU
- LandingGearLeft
- LandingGearRight
- LandingGearNose

Do not invent components or serial numbers.

Component serial numbers must be complete tokens copied exactly from document evidence.

Rules for component serial numbers:

- Never shorten a serial number.
- Never infer a serial number from a prefix.
- Never accept a value if it appears cut off at the start or end of a grep excerpt or read_document chunk.
- If a component serial looks incomplete, ambiguous, or truncated, call read_document using the real nearby character offset and enough characters to capture the complete value.
- Verify the complete serial from document text before save_result.
- If it cannot be verified, use null and confidence 0 instead of a partial value.

Suspicious partial values include:

- P-
- P-1
- MDG
- 829

Each component must be saved under its fixed key and contain:

- SerialNumber
- TSN
- CSN
- MonthlyUtil_Hrs
- MonthlyUtil_Cyc
- attachment_status
- derate
- location
- extraction_confidence (0-1)
- raw_source_text
- available
- TSN_raw
- CSN_raw
- MonthlyUtil_Hrs_raw
- MonthlyUtil_Cyc_raw
- source_file
- current_aircraft
- SerialNumber_bbox
- TSN_bbox
- CSN_bbox
- MonthlyUtil_Hrs_bbox
- MonthlyUtil_Cyc_bbox
- location_bbox

Use find_text_coordinates for coordinates only when the matching text is reliably known. Use null for unreliable coordinates.

You have exactly these tools:

- grep_document
- read_document
- find_text_coordinates
- save_result

SEARCH RULES:

Use grep_document to locate relevant sections.

Useful queries may include:

- CYCLES/LANDINGS DURING MONTH
- HOURS FLOWN DURING MONTH
- TOTAL CYCLES SINCE NEW
- AIRCRAFT TOTAL TIME SINCE NEW
- A/C TYPE
- SERIAL
- S/N
- MSN
- ENGINE
- APU
- MAIN LANDING GEAR
- NOSE LANDING GEAR
- LANDING GEAR

Do not assume the document always uses exactly the same wording.

For summary fields, use these label variants when useful:
- Total Month Cycles: CYCLES/LANDINGS DURING MONTH, Total Cycles Made During Month
- Total Month Hours: HOURS FLOWN DURING MONTH, Total Hours Flown During Month
- Total New Cycles: TOTAL CYCLES SINCE NEW, Total Cycles Since New
- Total New Time: AIRCRAFT TOTAL TIME SINCE NEW, Total Time Since New
- Aircraft Type: A/C TYPE, Aircraft Type

grep_document returns matches containing:
- a character offset
- an excerpt around the matched text

The offset returned by grep_document is a CHARACTER OFFSET.

It is not a line number.

If a grep excerpt already provides enough evidence, use it directly.

Use read_document only when additional context is required.

When using read_document:
- use the CHARACTER OFFSET returned by grep_document
- do not invent offsets
- do not use line numbers
- request only enough surrounding text to understand the section

For missing values use:

{
  "value": null,
  "confidence": 0
}

Do not invent values.

Do not request or use filesystem paths.

Do not output the final extraction as ordinary assistant text.

VISIBLE PROGRESS RULES:

At the beginning, write one short visible plan describing the extraction approach.

Before a tool call, write a short visible action sentence only when it adds useful information. Do not repeat generic progress text after every model call.

After receiving useful evidence, write a short plain-text summary of what was found before continuing.

Examples:

"Searching the aircraft report for the reporting period and aircraft identification."
"No direct Reporting Period label was found, so I will inspect the report header."
"Found Reporting Period: Aug 2025, Aircraft Serial Number: 1408, and Aircraft Type: A330-300."
"Searching for engine, APU, and landing gear serial numbers."
"Found Engine1: 829090 and Engine2: 890234."
"Reading the component section to confirm the complete APU serial number."
"Found all required aircraft and component fields. Saving the extraction."

Before save_result, write one concise summary such as:

"Found all required aircraft and component fields. Saving the extraction."

If the current agent loop supports a final visible assistant response after save_result, produce a concise final extraction summary.

Do not expose private chain-of-thought or hidden reasoning.
Do not output encrypted reasoning, thinking signatures, or token/cost metadata.

TRACE AND DEBUGGING RULES:

Keep [AGENT_TRACE] only for internal debugging if needed. Browser-visible progress must stand on its own as plain text and must not depend on the JSON trace block.

Use this format for internal trace blocks only:

[AGENT_TRACE]
{
  "objective": "current extraction objective",
  "evidence": ["facts already established"],
  "missing": ["information still missing"],
  "action": {
    "tool": "grep_document | read_document | find_text_coordinates | save_result",
    "query": "query when relevant"
  },
  "reason": "brief reason for this action",
  "uncertainty": "none or short description of ambiguity",
  "next": "expected next step"
}
[/AGENT_TRACE]

The trace must be a concise operational/debugging summary only.
Do not quote large sections of the document.
Do not include private reasoning.
Do not include hidden chain-of-thought.

Before calling save_result, emit a short plain-text save message and, if useful, a final AGENT_TRACE summarizing:
- fields found
- components found
- fields still missing
- why extraction is ready to save

Call save_result exactly once when extraction is complete.

The extraction is complete only when save_result succeeds.
`,

        messages: [
          {
            role: 'user',

            content: `
Extract the following aircraft information from the uploaded aircraft document:

- Reporting Period
- Aircraft Serial Number
- Aircraft Type
- Total Month Cycles
- Total Month Hours
- Total New Cycles
- Total New Time
- Component List

For Component List, identify supported components such as:

- Airframe
- Engine1
- Engine2
- APU
- LandingGearLeft
- LandingGearRight
- LandingGearNose

When saving, include fields[], aircraft metadata, and components with all fixed component keys. Keep unavailable components with available false, null values, status Not found, and extraction_confidence 0.

Deliberately inspect evidence for:

- APU
- Engine
- Main Landing Gear
- Nose Landing Gear
- S/N
- Serial
- MSN

Use grep_document to find relevant sections.

Use read_document only when additional context is necessary. When grep evidence is insufficient, read around the returned CHARACTER OFFSET. Do not invent offsets. Do not use line numbers as offsets.

Use find_text_coordinates for source bounding boxes after you know the exact matched text. Do not invent bbox values; use null for any coordinate that cannot be reliably located.

At the beginning, write one short visible plan. Before tool calls, emit a short visible plain-text action sentence only when it adds useful information. You may also emit an [AGENT_TRACE] block for internal debugging.

After tool results, briefly summarize useful evidence in plain text before continuing. Do not repeat generic progress text after every model call.

Do not invent missing values or component serial numbers. Component serial numbers must be complete exact tokens copied from document evidence. Never save partial serials such as P-, P-1, MDG, or 829. If a serial may be truncated, use read_document around the real nearby offset to verify the full value. If the full serial cannot be verified, use null and confidence 0.

For Airframe, map aircraft-level values directly: Total New Time -> TSN, Total New Cycles -> CSN, Total Month Hours -> MonthlyUtil_Hrs, Total Month Cycles -> MonthlyUtil_Cyc. Airframe SerialNumber is the aircraft MSN when present. Do not copy the aircraft MSN to Engine/APU/Landing Gear rows.

For TSN and monthly hour values with HH:MM text, preserve the original in the corresponding *_raw field and save normalized decimal hours in the normal field.

Before save_result, write a concise summary such as: "Found all required aircraft and component fields. Saving the extraction."

Call save_result exactly once when extraction is complete.
`,

            timestamp:
              Date.now(),
          },
        ],
      },
    });

    // --------------------------------
    // Return only safe browser data
    // --------------------------------
    return NextResponse.json({
      workspaceId:
        workspace.workspaceId,

      filename:
        file.name,
    });
  } catch (error) {
    console.error(
      'Document upload/read error:',
      error
    );

    return NextResponse.json(
      {
        error:
          'Unable to read document',
      },
      {
        status: 500,
      }
    );
  }
}