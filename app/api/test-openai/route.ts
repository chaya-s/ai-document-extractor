import { createModels } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';

export const runtime = 'nodejs';

const models = createModels();
models.setProvider(openrouterProvider());

export async function GET() {
  const model = models.getModel('openrouter', 'openai/gpt-4o-mini');

  if (!model) {
    return Response.json(
      { error: 'OpenRouter model was not found.' },
      { status: 500 }
    );
  }

  const response = await models.complete(model, {
    messages: [
      {
        role: 'user',
        content: 'Write a vegetarian lasagna recipe for 4 people.',
        timestamp: Date.now(),
      },
    ],
  });

  if (response.stopReason === 'error') {
    return Response.json(
      { error: response.errorMessage || 'AI request failed.' },
      { status: 500 }
    );
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return Response.json({ text });
}
