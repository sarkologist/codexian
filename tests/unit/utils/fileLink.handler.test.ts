import { registerDiffLineHandler, registerFileLinkHandler } from '@/utils/fileLink';

describe('registerFileLinkHandler', () => {
  it('opens data-href target when present', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
      },
    };

    const link: any = {
      dataset: { href: 'note#section' },
      getAttribute: jest.fn().mockReturnValue('note'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = {
      target: link,
      preventDefault: jest.fn(),
    } as any;

    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => {
        cb(event);
      },
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note#section', '', 'tab');
  });

  it('falls back to href when data-href is missing', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
      },
    };

    const link: any = {
      dataset: {},
      getAttribute: jest.fn().mockReturnValue('note^block'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = {
      target: link,
      preventDefault: jest.fn(),
    } as any;

    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => {
        cb(event);
      },
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note^block', '', 'tab');
  });

  it('opens at the line when the link carries data-line', () => {
    const file = { path: 'notes/doc.md', basename: 'doc' };
    const openLinkText = jest.fn().mockResolvedValue(undefined);
    const app = {
      vault: { getAbstractFileByPath: jest.fn().mockReturnValue(file) },
      metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue(null) },
      workspace: { openLinkText },
    };

    const link: any = {
      dataset: { href: 'notes/doc.md', line: '42' },
      getAttribute: jest.fn().mockReturnValue('notes/doc.md'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = { target: link, preventDefault: jest.fn() } as any;
    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => cb(event),
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', 'tab', { eState: { line: 41 } });
  });

  it('derives the line from the href when data-line is absent', () => {
    const file = { path: 'notes/doc.md', basename: 'doc' };
    const openLinkText = jest.fn().mockResolvedValue(undefined);
    const app = {
      vault: { getAbstractFileByPath: jest.fn().mockReturnValue(file) },
      metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue(null) },
      workspace: { openLinkText },
    };

    const link: any = {
      dataset: { href: 'notes/doc.md:42' },
      getAttribute: jest.fn().mockReturnValue('notes/doc.md:42'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = { target: link, preventDefault: jest.fn() } as any;
    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => cb(event),
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', 'tab', { eState: { line: 41 } });
  });

  it('falls back to openLinkText when a line link target does not resolve', () => {
    const openLinkText = jest.fn();
    const app = {
      vault: { getAbstractFileByPath: jest.fn().mockReturnValue(null) },
      metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue(null) },
      workspace: { openLinkText },
    };

    const link: any = {
      dataset: { href: 'missing.md:42' },
      getAttribute: jest.fn().mockReturnValue('missing.md:42'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = { target: link, preventDefault: jest.fn() } as any;
    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => cb(event),
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(openLinkText).toHaveBeenCalledWith('missing.md:42', '', 'tab');
  });

  it('opens a heading link via openLinkText rather than as a line', () => {
    const openLinkText = jest.fn();
    const app = { workspace: { openLinkText } };

    const link: any = {
      dataset: { href: 'note#Sprint:2' },
      getAttribute: jest.fn().mockReturnValue('note#Sprint:2'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = { target: link, preventDefault: jest.fn() } as any;
    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => cb(event),
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(openLinkText).toHaveBeenCalledWith('note#Sprint:2', '', 'tab');
  });

  it('opens and selects the range when the link carries data-end-line', async () => {
    const file = { path: 'notes/doc.md', basename: 'doc' };
    const openLinkText = jest.fn().mockResolvedValue(undefined);
    const editor = {
      lineCount: () => 6,
      getLine: (i: number) => ['a', 'b', 'c', 'd', 'e', 'f'][i] ?? '',
      setSelection: jest.fn(),
      scrollIntoView: jest.fn(),
    };
    const app = {
      vault: { getAbstractFileByPath: jest.fn().mockReturnValue(file) },
      metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue(null) },
      workspace: { openLinkText, getActiveViewOfType: jest.fn().mockReturnValue({ getMode: () => 'source', editor }) },
    };

    const link: any = {
      dataset: { href: 'notes/doc.md', line: '2', endLine: '5' },
      getAttribute: jest.fn().mockReturnValue('notes/doc.md'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = { target: link, preventDefault: jest.fn() } as any;
    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => cb(event),
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', 'tab', { eState: { line: 1 } });
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

  function run(
    app: unknown,
    container: HTMLElement,
    line: any,
  ): { preventDefault: jest.Mock } {
    const event = { target: line, preventDefault: jest.fn() } as any;
    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (e: MouseEvent) => void) => cb(event),
    };
    registerDiffLineHandler(app as any, container, component as any);
    return event;
  }

  it('opens the file at the clicked line', () => {
    const file = { path: 'notes/todo.md', basename: 'todo' };
    const { app, openLinkText } = makeApp(file);
    const line: any = {
      dataset: { filePath: 'notes/todo.md', line: '7' },
      closest: jest.fn(),
    };
    line.closest.mockReturnValue(line);

    const event = run(app, makeContainer(), line);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(openLinkText).toHaveBeenCalledWith('notes/todo.md', '', 'tab', { eState: { line: 6 } });
  });

  it('ignores clicks outside a clickable diff line', () => {
    const { app, openLinkText } = makeApp({ path: 'a.md', basename: 'a' });
    const target: any = { dataset: {}, closest: jest.fn().mockReturnValue(null) };

    run(app, makeContainer(), target);

    expect(openLinkText).not.toHaveBeenCalled();
  });

  it('does not navigate when there is an active text selection', () => {
    const { app, openLinkText } = makeApp({ path: 'a.md', basename: 'a' });
    const line: any = {
      dataset: { filePath: 'a.md', line: '2' },
      closest: jest.fn(),
    };
    line.closest.mockReturnValue(line);

    run(app, makeContainer(false), line);

    expect(openLinkText).not.toHaveBeenCalled();
  });
});
