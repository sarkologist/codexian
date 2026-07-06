import {
  escapeMathDelimitersForStreaming,
  extractMarkdownMathSources,
  hasStreamingMathDelimiters,
} from '@/utils/markdownMath';

describe('markdownMath', () => {
  describe('escapeMathDelimitersForStreaming', () => {
    it('escapes inline and display math delimiters outside code', () => {
      expect(escapeMathDelimitersForStreaming('Use $x + y$ and $$z^2$$.')).toBe(
        'Use \\$x + y\\$ and \\$\\$z^2\\$\\$.'
      );
    });

    it('escapes multiline display math delimiters outside code', () => {
      const markdown = [
        'Before',
        '$$',
        'x^2 + y^2 = z^2',
        '$$',
        'After',
      ].join('\n');

      expect(escapeMathDelimitersForStreaming(markdown)).toBe([
        'Before',
        '\\$\\$',
        'x^2 + y^2 = z^2',
        '\\$\\$',
        'After',
      ].join('\n'));
    });

    it('preserves inline code and fenced code dollars', () => {
      const markdown = [
        'Text $x$',
        '`echo $PATH`',
        '```bash',
        'echo "$HOME"',
        '```',
        'Done $$y$$',
      ].join('\n');

      expect(escapeMathDelimitersForStreaming(markdown)).toBe([
        'Text \\$x\\$',
        '`echo $PATH`',
        '```bash',
        'echo "$HOME"',
        '```',
        'Done \\$\\$y\\$\\$',
      ].join('\n'));
    });

    it('keeps already escaped dollars unchanged', () => {
      expect(escapeMathDelimitersForStreaming('Cost is \\$5, math is $x$.')).toBe(
        'Cost is \\$5, math is \\$x\\$.'
      );
    });

    it('does not alter dollars inside raw html tag attributes', () => {
      expect(escapeMathDelimitersForStreaming('<span title="$x$">value $y$</span>')).toBe(
        '<span title="$x$">value \\$y\\$</span>'
      );
    });
  });

  describe('hasStreamingMathDelimiters', () => {
    it('detects unescaped dollars outside code', () => {
      expect(hasStreamingMathDelimiters('math $x$')).toBe(true);
      expect(hasStreamingMathDelimiters('math\n$$\nx^2\n$$')).toBe(true);
      expect(hasStreamingMathDelimiters('`echo $PATH`')).toBe(false);
      expect(hasStreamingMathDelimiters('\\$5')).toBe(false);
    });
  });

  describe('extractMarkdownMathSources', () => {
    it('extracts inline and display math sources in order', () => {
      const markdown = [
        'Inline $x + y$',
        '',
        '$$',
        'x^2 + y^2 = z^2',
        '$$',
        'Then $$z^2$$.',
      ].join('\n');

      expect(extractMarkdownMathSources(markdown)).toEqual([
        '$x + y$',
        '$$\nx^2 + y^2 = z^2\n$$',
        '$$z^2$$',
      ]);
    });

    it('ignores escaped dollars, code spans, fenced blocks, and html attributes', () => {
      const markdown = [
        'Cost is \\$5 and math is $x$.',
        '`echo $PATH`',
        '<span title="$ignored$">html $kept$</span>',
        '```',
        '$ignored$',
        '```',
        '~~~',
        '$alsoIgnored$',
        '~~~',
      ].join('\n');

      expect(extractMarkdownMathSources(markdown)).toEqual(['$x$', '$kept$']);
    });

    it('does not treat unclosed inline math as a source', () => {
      expect(extractMarkdownMathSources('Before $x\nAfter $y$')).toEqual(['$y$']);
    });

    it('does not extract math from dollar delimiter runs longer than two', () => {
      expect(extractMarkdownMathSources('Before $$$x^2$$$ after')).toEqual([]);
    });
  });

});
