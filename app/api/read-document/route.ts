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
      workspace.originalPath,
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

        // Your current aircraft PDFs have text.
        // Keep OCR off unless you later need scanned PDFs.
        ocrEnabled: false,
      });

      const result =
        await parser.parse(buffer);

      markdownContent =
        result.text;
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

You must extract exactly these five fields:

1. Total Month Cycles
2. Total Month Hours
3. Total New Cycles
4. Total New Time
5. Aircraft Type

You have exactly these tools:

- grep_document
- read_document
- save_result

IMPORTANT TOOL RULES:

You have a strict tool-call budget.

Start by making only these five grep_document searches:

1. CYCLES/LANDINGS DURING MONTH
2. HOURS FLOWN DURING MONTH
3. TOTAL CYCLES SINCE NEW
4. AIRCRAFT TOTAL TIME SINCE NEW
5. A/C TYPE

Do not make multiple alternative searches for the same field unless the required search returns no useful match.

Do not repeat the same query.

grep_document returns matches containing:
- a character offset
- an excerpt around the matched text

The offset returned by grep_document is a CHARACTER OFFSET.

It is not a line number.

If the grep excerpt already contains the required value, use that value directly.

Do not call read_document when the grep excerpt already provides enough evidence.

Only use read_document when the value is genuinely unclear from the grep result.

If read_document is required:
- use the CHARACTER OFFSET returned by grep_document
- do not invent an offset
- do not use a line number as the offset
- request only enough characters to inspect nearby context

After the five grep searches, inspect the returned excerpts.

If the five required values are visible, call save_result immediately.

Do not perform extra searches just to confirm a value that is already clearly visible.

Do not keep reading after all required values are known.

Call save_result exactly once.

For fields that cannot be found after reasonable searching, use:

{
  "value": null,
  "confidence": 0
}

Do not invent values.

Do not request or use filesystem paths.

Do not output the final extraction as ordinary assistant text.

The extraction is complete only when save_result succeeds.
`,

        messages: [
          {
            role: 'user',

            content: `
Extract exactly these five fields from the uploaded aircraft document:

- Total Month Cycles
- Total Month Hours
- Total New Cycles
- Total New Time
- Aircraft Type

Begin with exactly these five grep_document queries:

1. CYCLES/LANDINGS DURING MONTH
2. HOURS FLOWN DURING MONTH
3. TOTAL CYCLES SINCE NEW
4. AIRCRAFT TOTAL TIME SINCE NEW
5. A/C TYPE

Do not search alternative phrases unless one of those queries produces no useful match.

If the grep excerpts already contain the required values, do not call read_document.

If additional context is genuinely necessary, use read_document with the character offset returned by grep_document.

Once you have the five values, call save_result immediately.

Do not continue searching after that.
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