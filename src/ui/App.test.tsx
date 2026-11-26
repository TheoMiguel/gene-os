// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { workspace } from '../state/documents';
import { bindThemeToDocument, SETTINGS_STORAGE_KEY, settings, updateSettings } from '../state/settings';
import { App } from './App';

beforeAll(() => {
  // jsdom has no 2D canvas; the background then renders an empty canvas.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

beforeEach(() => {
  updateSettings({ language: 'en' });
});

afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
});

async function paste(fasta: string) {
  fireEvent.input(screen.getByRole('textbox', { name: 'Sequence or accession' }), {
    target: { value: fasta },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Load sequence' }));
}

const headerTabs = () =>
  within(screen.getByRole('tablist', { name: 'Open sequences' })).queryAllByRole('tab');
const selectedHeaderTab = () => headerTabs().find((tab) => tab.getAttribute('aria-selected') === 'true');

async function openTwo() {
  render(<App />);
  await paste('>alpha\nACGTACGT');
  await screen.findByRole('heading', { name: 'alpha', level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
  await paste('>beta\nGGCCAATT');
  await screen.findByRole('heading', { name: 'beta', level: 1 });
}

describe('sequence tabs', () => {
  it('shows the new-sequence view when nothing is open', () => {
    render(<App />);
    expect(headerTabs()).toHaveLength(0);
    expect(screen.getByRole('textbox', { name: 'Sequence or accession' })).toBeTruthy();
  });

  it('opens a tab per loaded sequence and activates the newest', async () => {
    await openTwo();
    expect(headerTabs().map((tab) => tab.textContent)).toEqual(['alpha', 'beta']);
    expect(selectedHeaderTab()?.textContent).toBe('beta');
    expect(screen.getByText('8 bp · Linear · DNA')).toBeTruthy();
  });

  it('switches tabs by click and by arrow keys', async () => {
    await openTwo();
    fireEvent.click(headerTabs()[0] as HTMLElement);
    expect(await screen.findByRole('heading', { name: 'alpha', level: 1 })).toBeTruthy();

    fireEvent.keyDown(headerTabs()[0] as HTMLElement, { key: 'ArrowRight' });
    expect(await screen.findByRole('heading', { name: 'beta', level: 1 })).toBeTruthy();
    expect(document.activeElement).toBe(headerTabs()[1]);
  });

  it('closes a tab with its × button and activates the neighbour', async () => {
    await openTwo();
    fireEvent.click(headerTabs()[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
    await waitFor(() => expect(headerTabs().map((tab) => tab.textContent)).toEqual(['beta']));
    expect(selectedHeaderTab()?.textContent).toBe('beta');
  });

  it('Ctrl+W closes the active tab and Ctrl+N opens the new-sequence view', async () => {
    await openTwo();
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    await waitFor(() => expect(headerTabs().map((tab) => tab.textContent)).toEqual(['alpha']));

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(await screen.findByRole('textbox', { name: 'Sequence or accession' })).toBeTruthy();
    expect(selectedHeaderTab()).toBeUndefined();
  });

  it('keeps one sub-tab selection per document', async () => {
    await openTwo();
    fireEvent.click(screen.getByRole('tab', { name: '04 // Primers & PCR' }));
    expect(screen.getByRole('tab', { name: '04 // Primers & PCR' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    fireEvent.click(headerTabs()[0] as HTMLElement);
    await screen.findByRole('heading', { name: 'alpha', level: 1 });
    expect(screen.getByRole('tab', { name: '01 // Summary' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(headerTabs()[1] as HTMLElement);
    await screen.findByRole('heading', { name: 'beta', level: 1 });
    expect(screen.getByRole('tab', { name: '04 // Primers & PCR' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('opens a dropped file and reports text that is not a sequence', async () => {
    render(<App />);
    const file = new File(['>dropped\nATGC'], 'dropped.fasta');
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(await screen.findByRole('heading', { name: 'dropped', level: 1 })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    await paste('this is not DNA');
    expect(
      await screen.findByText('The text contains characters that are not DNA or RNA bases.'),
    ).toBeTruthy();
    expect(headerTabs()).toHaveLength(1);
  });
});

describe('settings panel', () => {
  it('opens from the gear, closes on Escape and returns focus to the gear', async () => {
    render(<App />);
    const gear = screen.getByRole('button', { name: 'Settings' });
    gear.focus();
    fireEvent.click(gear);
    const dialog = await screen.findByRole('dialog', { name: 'System config' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(gear);
  });

  it('switches the language at once and persists the choice', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Español' }));

    expect(await screen.findByRole('dialog', { name: 'Configuración del sistema' })).toBeTruthy();
    expect(settings.value.language).toBe('es');
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').language).toBe('es');
  });

  it('sets the luminosity on the document root for the design tokens', async () => {
    const unbind = bindThemeToDocument(document.documentElement);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Dusk' }));
    expect(document.documentElement.dataset.luminosity).toBe('dusk');
    unbind();
  });
});
