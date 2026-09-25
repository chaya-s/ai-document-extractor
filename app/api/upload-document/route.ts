import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        'File uploads to an AI provider are not used in the pi-ai version. Use /api/read-document to extract document text first.',
    },
    { status: 410 }
  );
}
