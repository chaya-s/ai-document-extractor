import { NextResponse } from 'next/server';
import {
  createModels,
  Type,
  validateToolCall,
  type Tool,
} from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';

import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

const models = createModels();

models.setProvider(openrouterProvider());

const extractionTool: Tool = {
  name: 'extract_aircraft_fields',

  description:
    'Extract the five required aircraft utilization fields from the document.',

  parameters: Type.Object(
    {
      fields: Type.Array(
        Type.Object(
          {
            name: Type.String(),
            value: Type.String(),
            confidence: Type.Number(),
          },
          {
            additionalProperties: false,
          }
        )
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

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const documentText = body.documentText;

    if (
      typeof documentText !== 'string' ||
      !documentText.trim()
    ) {
      return NextResponse.json(
        {
          error: 'Document text is required.',
        },
        {
          status: 400,
        }
      );
    }

    const model = models.getModel(
      'openrouter',
      'openai/gpt-4o-mini'
    );

    if (!model) {
      return NextResponse.json(
        {
          error: 'OpenRouter model was not found.',
        },
        {
          status: 500,
        }
      );
    }

    const response = await models.complete(model, {
      systemPrompt: `
You extract structured aircraft utilization data from documents.

Extract exactly these five fields:

1. Total Month Cycles
2. Total Month Hours
3. Total New Cycles
4. Total New Time
5. Aircraft Type

For every field return:

- name
- value
- confidence

The confidence must be a number from 0 to 100.

Use the field names exactly as listed above.

Do not invent values.

Only extract values supported by the document.

Call the extract_aircraft_fields tool exactly once.
`,

      tools: [extractionTool],

      messages: [
        {
          role: 'user',

          content: `
Read the following aircraft document.

Extract exactly these fields:

- Total Month Cycles
- Total Month Hours
- Total New Cycles
- Total New Time
- Aircraft Type

Return each field with:

- name
- value
- confidence

DOCUMENT:

${documentText}
`,

          timestamp: Date.now(),
        },
      ],
    });

    if (response.stopReason === 'error') {
      return NextResponse.json(
        {
          error:
            response.errorMessage ||
            'The AI provider returned an error.',
        },
        {
          status: 500,
        }
      );
    }

    const toolCall = response.content.find(
      (
        block
      ): block is Extract<
        typeof block,
        { type: 'toolCall' }
      > =>
        block.type === 'toolCall' &&
        block.name === extractionTool.name
    );

    if (!toolCall) {
      return NextResponse.json(
        {
          error:
            'The model did not return structured aircraft data.',
        },
        {
          status: 500,
        }
      );
    }

    const extractedData = validateToolCall(
      [extractionTool],
      toolCall
    );

    // Save JSON result locally
    const outputDir = path.join(
      process.cwd(),
      'output'
    );

    await fs.mkdir(outputDir, {
      recursive: true,
    });

    const outputPath = path.join(
      outputDir,
      'result.json'
    );

    await fs.writeFile(
      outputPath,
      JSON.stringify(extractedData, null, 2),
      'utf-8'
    );

    console.log(
      'JSON result saved at:',
      outputPath
    );

    return NextResponse.json(extractedData);
  } catch (error) {
    console.error(
      'Extraction error:',
      error
    );

    return NextResponse.json(
      {
        error:
          'Unable to extract document information.',
      },
      {
        status: 500,
      }
    );
  }
}