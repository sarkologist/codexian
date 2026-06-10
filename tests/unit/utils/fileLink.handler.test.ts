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
