import { registerDiffLineHandler, registerFileLinkHandler } from '@/utils/fileLink';

/**
 * Dispatches the event only to the handler registered for its type, mirroring
 * Chromium: a middle-click arrives as `auxclick` and never as `click`.
 */
function makeComponent(event: unknown, type: 'click' | 'auxclick' = 'click') {
  return {
    registerDomEvent: (_el: HTMLElement, registeredType: string, cb: (event: MouseEvent) => void) => {
      if (registeredType === type) cb(event as MouseEvent);
    },
  };
}

function makeEvent(target: unknown, extra: Record<string, unknown> = {}): any {
  return { target, preventDefault: jest.fn(), ...extra };
}

function makeLink(dataset: Record<string, string>, href?: string): any {
  const link: any = {
    dataset,
    getAttribute: jest.fn().mockReturnValue(href ?? dataset.href ?? null),
    closest: jest.fn(),
  };
  link.closest.mockReturnValue(link);
  return link;
}

function makeVaultApp(file: unknown, view?: unknown) {
  const openLinkText = jest.fn().mockResolvedValue(undefined);
  const app = {
    vault: { getAbstractFileByPath: jest.fn().mockReturnValue(file) },
    metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue(null) },
    workspace: { openLinkText, getActiveViewOfType: jest.fn().mockReturnValue(view ?? null) },
  };
  return { app, openLinkText };
}

describe('registerFileLinkHandler', () => {
  it('opens data-href target when present', () => {
    const app = { workspace: { openLinkText: jest.fn() } };
    const event = makeEvent(makeLink({ href: 'note#section' }, 'note'));

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note#section', '', false);
  });

  it('opens in a new tab when the mod key is held', () => {
    const app = { workspace: { openLinkText: jest.fn() } };
    const event = makeEvent(makeLink({ href: 'note#section' }, 'note'), { metaKey: true });

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note#section', '', 'tab');
  });

  it('opens in a new tab on a middle-click', () => {
    const app = { workspace: { openLinkText: jest.fn() } };
    const event = makeEvent(makeLink({ href: 'note#section' }, 'note'), { button: 1 });

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event, 'auxclick') as any);

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note#section', '', 'tab');
  });

  it('leaves other auxiliary buttons alone so right-click keeps its context menu', () => {
    const app = { workspace: { openLinkText: jest.fn() } };
    const event = makeEvent(makeLink({ href: 'note#section' }, 'note'), { button: 2 });

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event, 'auxclick') as any);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(app.workspace.openLinkText).not.toHaveBeenCalled();
  });

  it('falls back to href when data-href is missing', () => {
    const app = { workspace: { openLinkText: jest.fn() } };
    const event = makeEvent(makeLink({}, 'note^block'));

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note^block', '', false);
  });

  it('opens at the line when the link carries data-line', () => {
    const { app, openLinkText } = makeVaultApp({ path: 'notes/doc.md', basename: 'doc' });
    const event = makeEvent(makeLink({ href: 'notes/doc.md', line: '42' }));

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', false, { eState: { line: 41 } });
  });

  it('opens a line link in a new tab when the mod key is held', () => {
    const { app, openLinkText } = makeVaultApp({ path: 'notes/doc.md', basename: 'doc' });
    const event = makeEvent(makeLink({ href: 'notes/doc.md', line: '42' }), { metaKey: true });

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);

    expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', 'tab', { eState: { line: 41 } });
  });

  it('derives the line from the href when data-line is absent', () => {
    const { app, openLinkText } = makeVaultApp({ path: 'notes/doc.md', basename: 'doc' });
    const event = makeEvent(makeLink({ href: 'notes/doc.md:42' }));

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);

    expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', false, { eState: { line: 41 } });
  });

  it('falls back to openLinkText when a line link target does not resolve', () => {
    const { app, openLinkText } = makeVaultApp(null);
    const event = makeEvent(makeLink({ href: 'missing.md:42' }));

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);

    expect(openLinkText).toHaveBeenCalledWith('missing.md:42', '', false);
  });

  it('opens a heading link via openLinkText rather than as a line', () => {
    const app = { workspace: { openLinkText: jest.fn() } };
    const event = makeEvent(makeLink({ href: 'note#Sprint:2' }));

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note#Sprint:2', '', false);
  });

  it('opens and selects the range when the link carries data-end-line', async () => {
    const editor = {
      lineCount: () => 6,
      getLine: (i: number) => ['a', 'b', 'c', 'd', 'e', 'f'][i] ?? '',
      setSelection: jest.fn(),
      scrollIntoView: jest.fn(),
    };
    const { app, openLinkText } = makeVaultApp(
      { path: 'notes/doc.md', basename: 'doc' },
      { getMode: () => 'source', editor },
    );
    const event = makeEvent(makeLink({ href: 'notes/doc.md', line: '2', endLine: '5' }));

    registerFileLinkHandler(app as any, {} as HTMLElement, makeComponent(event) as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', false, { eState: { line: 1 } });
    expect(editor.setSelection).toHaveBeenCalledWith({ line: 1, ch: 0 }, { line: 4, ch: 1 });
  });
});

describe('registerDiffLineHandler', () => {
  function makeApp(file: unknown) {
    const openLinkText = jest.fn().mockResolvedValue(undefined);
    const app = {
      vault: { getAbstractFileByPath: jest.fn().mockReturnValue(file) },
      workspace: { openLinkText },
    };
    return { app, openLinkText };
  }

  function makeContainer(selectionCollapsed = true): HTMLElement {
    return {
      win: { getSelection: () => ({ isCollapsed: selectionCollapsed }) },
    } as unknown as HTMLElement;
  }

  function makeDiffLine(dataset: Record<string, string>): any {
    const line: any = { dataset, closest: jest.fn() };
    line.closest.mockReturnValue(line);
    return line;
  }

  it('opens the file at the clicked line in the current tab', () => {
    const { app, openLinkText } = makeApp({ path: 'notes/todo.md', basename: 'todo' });
    const event = makeEvent(makeDiffLine({ filePath: 'notes/todo.md', line: '7' }));

    registerDiffLineHandler(app as any, makeContainer(), makeComponent(event) as any);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(openLinkText).toHaveBeenCalledWith('notes/todo.md', '', false, { eState: { line: 6 } });
  });

  it('opens the clicked line in a new tab when the mod key is held', () => {
    const { app, openLinkText } = makeApp({ path: 'notes/todo.md', basename: 'todo' });
    const event = makeEvent(makeDiffLine({ filePath: 'notes/todo.md', line: '7' }), { metaKey: true });

    registerDiffLineHandler(app as any, makeContainer(), makeComponent(event) as any);

    expect(openLinkText).toHaveBeenCalledWith('notes/todo.md', '', 'tab', { eState: { line: 6 } });
  });

  it('opens the clicked line in a new tab on a middle-click', () => {
    const { app, openLinkText } = makeApp({ path: 'notes/todo.md', basename: 'todo' });
    const event = makeEvent(makeDiffLine({ filePath: 'notes/todo.md', line: '7' }), { button: 1 });

    registerDiffLineHandler(app as any, makeContainer(), makeComponent(event, 'auxclick') as any);

    expect(openLinkText).toHaveBeenCalledWith('notes/todo.md', '', 'tab', { eState: { line: 6 } });
  });

  it('ignores clicks outside a clickable diff line', () => {
    const { app, openLinkText } = makeApp({ path: 'a.md', basename: 'a' });
    const target: any = { dataset: {}, closest: jest.fn().mockReturnValue(null) };
    const event = makeEvent(target);

    registerDiffLineHandler(app as any, makeContainer(), makeComponent(event) as any);

    expect(openLinkText).not.toHaveBeenCalled();
  });

  it('does not navigate when there is an active text selection', () => {
    const { app, openLinkText } = makeApp({ path: 'a.md', basename: 'a' });
    const event = makeEvent(makeDiffLine({ filePath: 'a.md', line: '2' }));

    registerDiffLineHandler(app as any, makeContainer(false), makeComponent(event) as any);

    expect(openLinkText).not.toHaveBeenCalled();
  });
});
