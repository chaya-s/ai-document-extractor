import { NextResponse } from 'next/server';

import { getData } from 'pdf-parse/worker';
import { PDFParse } from 'pdf-parse';

import mammoth from 'mammoth';
import fs from 'fs/promises';
import path from 'path';

PDFParse.setWorker(getData());

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Save original uploaded file
    const uploadsDir = path.join(process.cwd(), 'uploads');

    await fs.mkdir(uploadsDir, {
      recursive: true,
    });

    const safeFileName = file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );

    const filePath = path.join(
      uploadsDir,
      safeFileName
    );

    await fs.writeFile(filePath, buffer);

    console.log('File saved locally at:', filePath);

    // 2. Extract text
    let text = '';

    if (file.type === 'application/pdf') {
      const parser = new PDFParse({
        data: new Uint8Array(buffer),
      });

      try {
        const result = await parser.getText();
        text = result.text;
      } finally {
        await parser.destroy();
      }
    } else if (
      file.type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({
        buffer,
      });

      text = result.value;
    } else {
      return NextResponse.json(
        { error: 'Only PDF and DOCX files are supported' },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: 'No text could be extracted from the document' },
        { status: 400 }
      );
    }

    // 3. Save extracted text as Markdown
    const textCacheDir = path.join(
      uploadsDir,
      '.text-cache'
    );

    await fs.mkdir(textCacheDir, {
      recursive: true,
    });

    const markdownFileName =
      `${path.parse(safeFileName).name}.md`;

    const markdownPath = path.join(
      textCacheDir,
      markdownFileName
    );

    const markdownContent = `# ${file.name}

${text}
`;

    await fs.writeFile(
      markdownPath,
      markdownContent,
      'utf-8'
    );

    console.log(
      'Markdown saved locally at:',
      markdownPath
    );

    return NextResponse.json({
      filename: file.name,
      savedPath: filePath,
      markdownPath,
      text,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: 'Unable to read document' },
      { status: 500 }
    );
  }
}