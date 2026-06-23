/**
 * Claudian - File Link Utilities
 *
 * Detects Obsidian wikilinks [[path/to/file]] in rendered content and makes
 * them clickable to open the file in Obsidian.
 */

import type { App, Component } from 'obsidian';

import { getVaultFileByPath, openVaultFileAtLine, openVaultFileAtRange } from './obsidianCompat';

/**
 * Regex pattern to match Obsidian wikilinks in text content.
 *
 * Matches:
 * - Standard wikilinks: [[note]] or [[folder/note]]
 * - Wikilinks with display text: [[note|display text]]
 * - Wikilinks with headings: [[note#heading]]
 * - Wikilinks with block references: [[note^block]]
 *
 * Does NOT match image embeds ![[image.png]] (those are handled separately).
 */
const WIKILINK_PATTERN_SOURCE = '(?<!!)\\[\\[([^\\]|#^]+)(?:#[^\\]|]+)?(?:\\^[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]';

/** Creates a fresh regex instance to avoid global state issues */
function createWikilinkPattern(): RegExp {
  return new RegExp(WIKILINK_PATTERN_SOURCE, 'g');
}

interface WikilinkMatch {
  index: number;
  fullMatch: string;
  linkTarget: string;
  displayText: string;
  line?: number;
  endLine?: number;
}

interface LineSpec {
  path: string;
  line?: number;
  endLine?: number;
}

/**
 * Splits a trailing `:line` or `:start-end` reference off a link target.
 * Vault paths cannot legally end in `:<digits>`, so this is unambiguous.
 * A line spec never coexists with a `#heading`/`^block` subpath, so targets
 * carrying one pass through untouched (e.g. a heading named `Sprint:2`).
 */
export function extractLineSpec(target: string): LineSpec {
  if (/[#^]/.test(target)) return { path: target };

  const match = target.match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!match) return { path: target };

  return {
    path: match[1],
    line: Number(match[2]),
    endLine: match[3] !== undefined ? Number(match[3]) : undefined,
  };
}

function buildWikilinkMatch(
  fullMatch: string,
  rawPath: string,
  index: number
): WikilinkMatch {
  const pipeIndex = fullMatch.lastIndexOf('|');
  const displayText = pipeIndex > 0 ? fullMatch.slice(pipeIndex + 1, -2) : rawPath;
  const { path: linkTarget, line, endLine } = extractLineSpec(extractLinkTarget(fullMatch));

  return {
    index,
    fullMatch,
    linkTarget,
    displayText,
    line,
    endLine,
  };
}

export function extractLinkTarget(fullMatch: string): string {
  const inner = fullMatch.slice(2, -2);
  const pipeIndex = inner.indexOf('|');
  return pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
}

/**
 * Finds all wikilinks in text that exist in the vault.
 * Sorted by index descending for end-to-start processing.
 */
function findWikilinks(app: App, text: string): WikilinkMatch[] {
  const pattern = createWikilinkPattern();
  const matches: WikilinkMatch[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const rawPath = match[1];
    const { path } = extractLineSpec(rawPath);

    if (!fileExistsInVault(app, path)) continue;

    matches.push(buildWikilinkMatch(fullMatch, rawPath, match.index));
  }

  return matches.sort((a, b) => b.index - a.index);
}

function fileExistsInVault(app: App, linkPath: string): boolean {
  const file = app.metadataCache.getFirstLinkpathDest(linkPath, '');
  if (file) {
    return true;
  }

  const directFile = getVaultFileByPath(app, linkPath);
  if (directFile) {
    return true;
  }

  if (!linkPath.endsWith('.md')) {
    const withExt = getVaultFileByPath(app, linkPath + '.md');
    if (withExt) {
      return true;
    }
  }

  return false;
}

function extractLinkPathFromTarget(linkTarget: string): string {
  const subpathIndex = linkTarget.search(/[#^]/);
  return subpathIndex >= 0 ? linkTarget.slice(0, subpathIndex) : linkTarget;
}

/**
 * Creates a link element for a wikilink.
 * Click handling is done via event delegation in registerFileLinkHandler.
 */
function createWikilink(
  ownerDocument: Document,
  linkTarget: string,
  displayText: string,
  line?: number,
  endLine?: number
): HTMLElement {
  const link = ownerDocument.createElement('a');
  link.className = 'claudian-file-link internal-link';
  link.textContent = displayText;
  link.setAttribute('data-href', linkTarget);
  link.setAttribute('href', linkTarget);
  if (line !== undefined) {
    link.setAttribute('data-line', String(line));
    if (endLine !== undefined) link.setAttribute('data-end-line', String(endLine));
  }
  return link;
}

function repairEmptyInternalLink(app: App, link: HTMLAnchorElement): void {
  if ((link.textContent || '').trim()) return;

  const linkTarget = link.dataset.href || link.getAttribute('data-href') || link.getAttribute('href');
  if (!linkTarget) return;

  const linkPath = extractLinkPathFromTarget(linkTarget);
  if (!linkPath || !fileExistsInVault(app, linkPath)) return;

  link.classList.add('claudian-file-link');
  if (!link.dataset.href) {
    link.setAttribute('data-href', linkTarget);
  }
  link.textContent = linkTarget;
}

/**
 * Obsidian renders `[[note.md:42]]` as an unresolved internal link whose href
 * keeps the `:42` suffix. Rewrite it to the bare file plus line metadata so the
 * delegated click handler can jump there, and so it stops rendering unresolved.
 */
function normalizeLineSuffixLink(app: App, link: HTMLAnchorElement): void {
  if (link.dataset.line) return;

  const target = link.dataset.href || link.getAttribute('href');
  if (!target) return;

  const { path, line, endLine } = extractLineSpec(target);
  if (line === undefined || !fileExistsInVault(app, path)) return;

  link.classList.add('claudian-file-link');
  link.classList.remove('is-unresolved');
  link.setAttribute('data-href', path);
  link.setAttribute('href', path);
  link.setAttribute('data-line', String(line));
  if (endLine !== undefined) link.setAttribute('data-end-line', String(endLine));

  // Obsidian sometimes renders the anchor empty (see repairEmptyInternalLink);
  // that repair skips line links, so restore the original target as visible text.
  if (!(link.textContent || '').trim()) link.textContent = target;
}

/**
 * Registers a delegated click handler for file links on a container.
 * Should be called once on the messages container.
 * Handles both our custom .claudian-file-link and Obsidian's .internal-link.
 */
export function registerFileLinkHandler(
  app: App,
  container: HTMLElement,
  component: Component
): void {
  component.registerDomEvent(container, 'click', (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    // Handle both our links and Obsidian's internal links
    const link = target.closest('.claudian-file-link, .internal-link') as HTMLAnchorElement;
    if (!link) return;

    event.preventDefault();
    const rawTarget = link.dataset.href || link.getAttribute('href');
    if (!rawTarget) return;

    // Prefer explicit line metadata; otherwise derive it from a trailing
    // :line[-end] on the target. Obsidian-rendered internal links keep the
    // suffix in their href and never receive our data attributes.
    const { path, line, endLine } = link.dataset.line
      ? {
          path: rawTarget,
          line: Number(link.dataset.line),
          endLine: link.dataset.endLine ? Number(link.dataset.endLine) : undefined,
        }
      : extractLineSpec(rawTarget);

    // Only jump to a line when the bare file resolves; otherwise let Obsidian
    // handle the raw target (e.g. open/create an unresolved note) as before.
    if (line !== undefined && Number.isFinite(line) && fileExistsInVault(app, path)) {
      if (endLine !== undefined && Number.isFinite(endLine)) {
        void openVaultFileAtRange(app, path, line, endLine);
      } else {
        void openVaultFileAtLine(app, path, line);
      }
      return;
    }

    void app.workspace.openLinkText(rawTarget, '', 'tab');
  });
}

/**
 * Registers a delegated click handler for clickable vault-diff lines.
 * Clicking a line opens its file and jumps to the corresponding line.
 * Should be called once on the messages container.
 */
export function registerDiffLineHandler(
  app: App,
  container: HTMLElement,
  component: Component
): void {
  component.registerDomEvent(container, 'click', (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const lineEl = target.closest('.claudian-diff-line-clickable') as HTMLElement | null;
    if (!lineEl) return;

    // Don't navigate while the user is selecting diff text.
    const selection = container.win.getSelection();
    if (selection && !selection.isCollapsed) return;

    const filePath = lineEl.dataset.filePath;
    const line = Number(lineEl.dataset.line);
    if (!filePath || !Number.isFinite(line)) return;

    event.preventDefault();
    void openVaultFileAtLine(app, filePath, line);
  });
}

function buildFragmentWithLinks(ownerDocument: Document, text: string, matches: WikilinkMatch[]): DocumentFragment {
  const fragment = ownerDocument.createDocumentFragment();
  let currentIndex = text.length;

  for (const { index, fullMatch, linkTarget, displayText, line, endLine } of matches) {
    const endIndex = index + fullMatch.length;

    if (endIndex < currentIndex) {
      fragment.insertBefore(
        ownerDocument.createTextNode(text.slice(endIndex, currentIndex)),
        fragment.firstChild
      );
    }

    fragment.insertBefore(createWikilink(ownerDocument, linkTarget, displayText, line, endLine), fragment.firstChild);
    currentIndex = index;
  }

  if (currentIndex > 0) {
    fragment.insertBefore(
      ownerDocument.createTextNode(text.slice(0, currentIndex)),
      fragment.firstChild
    );
  }

  return fragment;
}

function processTextNode(app: App, node: Text): boolean {
  const text = node.textContent;
  if (!text || !text.includes('[[')) return false;

  const matches = findWikilinks(app, text);
  if (matches.length === 0) return false;

  node.parentNode?.replaceChild(buildFragmentWithLinks(node.ownerDocument, text, matches), node);
  return true;
}

/**
 * Call after MarkdownRenderer.renderMarkdown().
 * Catches wikilinks that remain as raw text after rendering, especially inline code spans.
 */
export function processFileLinks(app: App, container: HTMLElement): void {
  if (!app || !container) return;

  // Repair resolved internal links that rendered as empty anchors, and rewrite
  // links whose target carries a :line suffix (Obsidian leaves these unresolved).
  container.querySelectorAll('a.internal-link').forEach((linkEl) => {
    const link = linkEl as HTMLAnchorElement;
    repairEmptyInternalLink(app, link);
    normalizeLineSuffixLink(app, link);
  });

  // Wikilinks in inline code aren't rendered by Obsidian's MarkdownRenderer
  container.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.parentElement?.tagName === 'PRE') return;

    const text = codeEl.textContent;
    if (!text || !text.includes('[[')) return;

    const matches = findWikilinks(app, text);
    if (matches.length === 0) return;

    codeEl.textContent = '';
    codeEl.appendChild(buildFragmentWithLinks(container.ownerDocument, text, matches));
  });

  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tagName = parent.tagName.toUpperCase();
        if (tagName === 'PRE' || tagName === 'CODE' || tagName === 'A') {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest('pre, code, a, .claudian-file-link, .internal-link')) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  // Modifying DOM while walking causes issues, so collect first
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    processTextNode(app, textNode);
  }
}
