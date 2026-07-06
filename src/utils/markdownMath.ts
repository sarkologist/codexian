interface FenceState {
  marker: '`' | '~';
  length: number;
}

export const CLAUDIAN_MATH_SOURCE_ATTR = 'data-claudian-math-source';

function getFenceRun(line: string): string | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return match?.[1] ?? null;
}

function isClosingFence(line: string, fence: FenceState): boolean {
  const run = getFenceRun(line);
  return !!run && run[0] === fence.marker && run.length >= fence.length;
}

function isHtmlTagStart(line: string, index: number): boolean {
  const next = line[index + 1];
  return !!next && /[A-Za-z/!?]/.test(next);
}

function readBacktickRun(line: string, index: number): number {
  let length = 0;
  while (line[index + length] === '`') {
    length += 1;
  }
  return length;
}

function readCharRun(text: string, index: number, char: string): number {
  let length = 0;
  while (text[index + length] === char) {
    length += 1;
  }
  return length;
}

function getLineEnd(markdown: string, index: number): number {
  const newlineIndex = markdown.indexOf('\n', index);
  return newlineIndex === -1 ? markdown.length : newlineIndex + 1;
}

function getLineWithoutNewline(markdown: string, index: number): string {
  const lineEnd = getLineEnd(markdown, index);
  const line = markdown.slice(index, lineEnd);
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

function isLineStart(markdown: string, index: number): boolean {
  return index === 0 || markdown[index - 1] === '\n';
}

function findClosingMathDelimiter(
  markdown: string,
  startIndex: number,
  delimiter: '$' | '$$'
): number {
  for (let index = startIndex; index < markdown.length; index += 1) {
    const char = markdown[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (delimiter === '$' && char === '\n') {
      return -1;
    }
    if (markdown.startsWith(delimiter, index)) {
      return index;
    }
  }
  return -1;
}

function escapeMathDelimitersInLine(line: string): string {
  let escaped = '';
  let inlineCodeRunLength = 0;
  let inHtmlTag = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '`') {
      const runLength = readBacktickRun(line, index);
      escaped += line.slice(index, index + runLength);
      index += runLength - 1;
      if (inlineCodeRunLength === 0) {
        inlineCodeRunLength = runLength;
      } else if (runLength === inlineCodeRunLength) {
        inlineCodeRunLength = 0;
      }
      continue;
    }

    if (inlineCodeRunLength > 0) {
      escaped += char;
      continue;
    }

    if (inHtmlTag) {
      escaped += char;
      if (char === '>') {
        inHtmlTag = false;
      }
      continue;
    }

    if (char === '<' && isHtmlTagStart(line, index)) {
      inHtmlTag = true;
      escaped += char;
      continue;
    }

    if (char === '\\' && line[index + 1] === '$') {
      escaped += '\\$';
      index += 1;
      continue;
    }

    escaped += char === '$' ? '\\$' : char;
  }

  return escaped;
}

/**
 * Escapes dollar math delimiters outside code spans and fenced code blocks.
 * Used only for transient streaming renders so MarkdownRenderer does not hand
 * incomplete math to Obsidian's math renderer on every frame.
 */
export function escapeMathDelimitersForStreaming(markdown: string): string {
  if (!markdown.includes('$')) {
    return markdown;
  }

  let result = '';
  let fence: FenceState | null = null;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart);
    const lineEnd = newlineIndex === -1 ? markdown.length : newlineIndex + 1;
    const line = markdown.slice(lineStart, lineEnd);
    const lineWithoutNewline = line.endsWith('\n') ? line.slice(0, -1) : line;

    if (fence) {
      result += line;
      if (isClosingFence(lineWithoutNewline, fence)) {
        fence = null;
      }
    } else {
      const fenceRun = getFenceRun(lineWithoutNewline);
      if (fenceRun) {
        result += line;
        fence = {
          marker: fenceRun[0] as '`' | '~',
          length: fenceRun.length,
        };
      } else {
        result += escapeMathDelimitersInLine(line);
      }
    }

    lineStart = lineEnd;
  }

  return result;
}

export function hasStreamingMathDelimiters(markdown: string): boolean {
  if (!markdown.includes('$')) {
    return false;
  }

  return escapeMathDelimitersForStreaming(markdown) !== markdown;
}

/**
 * Extracts dollar-delimited math sources in the same source order Obsidian's
 * MarkdownRenderer emits rendered math nodes.
 */
export function extractMarkdownMathSources(markdown: string): string[] {
  if (!markdown.includes('$')) {
    return [];
  }

  const sources: string[] = [];
  let fence: FenceState | null = null;
  let inlineCodeRunLength = 0;
  let inHtmlTag = false;
  let index = 0;

  while (index < markdown.length) {
    if (isLineStart(markdown, index)) {
      const lineWithoutNewline = getLineWithoutNewline(markdown, index);
      if (fence) {
        if (isClosingFence(lineWithoutNewline, fence)) {
          fence = null;
        }
        index = getLineEnd(markdown, index);
        inlineCodeRunLength = 0;
        inHtmlTag = false;
        continue;
      }

      const fenceRun = getFenceRun(lineWithoutNewline);
      if (fenceRun) {
        fence = {
          marker: fenceRun[0] as '`' | '~',
          length: fenceRun.length,
        };
        index = getLineEnd(markdown, index);
        inlineCodeRunLength = 0;
        inHtmlTag = false;
        continue;
      }
    }

    const char = markdown[index];

    if (char === '`') {
      const runLength = readBacktickRun(markdown, index);
      index += runLength;
      if (inlineCodeRunLength === 0) {
        inlineCodeRunLength = runLength;
      } else if (runLength === inlineCodeRunLength) {
        inlineCodeRunLength = 0;
      }
      continue;
    }

    if (inlineCodeRunLength > 0) {
      index += 1;
      continue;
    }

    if (inHtmlTag) {
      if (char === '>') {
        inHtmlTag = false;
      }
      index += 1;
      continue;
    }

    if (char === '<' && isHtmlTagStart(markdown, index)) {
      inHtmlTag = true;
      index += 1;
      continue;
    }

    if (char === '\\') {
      index += 2;
      continue;
    }

    if (char === '$') {
      const dollarRunLength = readCharRun(markdown, index, '$');
      if (dollarRunLength > 2) {
        index += dollarRunLength;
        continue;
      }
      const delimiter: '$' | '$$' = dollarRunLength >= 2 ? '$$' : '$';
      const closingIndex = findClosingMathDelimiter(
        markdown,
        index + delimiter.length,
        delimiter
      );

      if (closingIndex !== -1) {
        sources.push(markdown.slice(index, closingIndex + delimiter.length));
        index = closingIndex + delimiter.length;
        continue;
      }
    }

    index += 1;
  }

  return sources;
}

export function extractRenderedMathSource(el: HTMLElement): string {
  const claudianSource = el.getAttribute(CLAUDIAN_MATH_SOURCE_ATTR)?.trim();
  if (claudianSource) return claudianSource;

  const annotation = el.querySelector(
    'annotation[encoding="application/x-tex"], annotation[encoding="application/tex"], annotation[encoding="TeX"]'
  );
  const annotationText = annotation?.textContent?.trim();
  if (annotationText) return annotationText;

  for (const attr of ['data-source', 'data-tex', 'data-latex', 'aria-label', 'title']) {
    const value = el.getAttribute(attr)?.trim();
    if (value) return value;
  }

  const assistiveText = el.querySelector('mjx-assistive-mml, math')?.textContent?.trim();
  if (assistiveText) return assistiveText;

  return el.textContent?.trim() ?? '';
}

export function collectRenderedMathElements(container: HTMLElement): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const candidates = container.querySelectorAll<HTMLElement>(
    `.math, mjx-container, [${CLAUDIAN_MATH_SOURCE_ATTR}]`
  );

  candidates.forEach((candidate) => {
    const mathWrapper = candidate.closest<HTMLElement>('.math');
    const root = mathWrapper && container.contains(mathWrapper) ? mathWrapper : candidate;
    if (roots.includes(root) || roots.some(existing => existing.contains(root))) return;
    roots.push(root);
  });

  return roots;
}
