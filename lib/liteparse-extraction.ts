import type { ParseResult, TextItem } from '@llamaindex/liteparse';

export type NormalizedWord = {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LiteParseTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  words: NormalizedWord[];
};

export type LiteParseJson = {
  document: {
    filename: string;
    totalPages: number;
  };
  pages: Array<{
    page: number;
    width: number;
    height: number;
    text: string;
    markdown: string;
    contentBounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    blocks?: unknown;
    textItems: LiteParseTextItem[];
  }>;
  words: NormalizedWord[];
};

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function wordsFromTextItem(
  page: number,
  item: TextItem
): NormalizedWord[] {
  if (Array.isArray(item.words) && item.words.length > 0) {
    const words = item.words
      .filter((word) => normalizeText(word.text))
      .map((word) => ({
        text: String(word.text),
        page,
        x: word.x,
        y: word.y,
        width: word.width,
        height: word.height,
      }));

    if (words.length > 0) {
      return words;
    }
  }

  const text = normalizeText(item.text);

  if (!text) {
    return [];
  }

  return [
    {
      text,
      page,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    },
  ];
}

export function buildLiteParseJson(
  filename: string,
  result: ParseResult
): LiteParseJson {
  const words: NormalizedWord[] = [];

  const pages = result.pages.map((page) => {
    const textItems = page.textItems.map((item) => {
      const itemWords = wordsFromTextItem(
        page.pageNum,
        item
      );

      words.push(...itemWords);

      return {
        text: String(item.text ?? ''),
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        words: itemWords,
      };
    });

    return {
      page: page.pageNum,
      width: page.width,
      height: page.height,
      text: page.text,
      markdown: page.markdown,
      ...(page.contentBounds
        ? {
            contentBounds: {
              x: page.contentBounds.x,
              y: page.contentBounds.y,
              width: page.contentBounds.width,
              height: page.contentBounds.height,
            },
          }
        : {}),
      ...(page.blocks ? { blocks: page.blocks } : {}),
      textItems,
    };
  });

  return {
    document: {
      filename,
      totalPages: result.totalPages,
    },
    pages,
    words,
  };
}
