import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { fetchSequence, guessService, looksLikeIdentifier, NetError, SERVICE_NAMES } from '../net';
import { workspace } from '../state/documents';
import { loadInputs, notice, openFilesFromPicker, sfx } from './actions';
import { t } from './i18n';
import { DatabaseSearch } from './views/libraries/DatabaseSearch';
import { ExamplePresets } from './views/libraries/ExamplePresets';
import { netErrorMessage } from './views/libraries/lookup';

function Card({
  title,
  headingId,
  badge,
  wide,
  children,
}: {
  title: string;
  headingId?: string;
  badge?: { text: string; tone: 'accent' | 'cyan' };
  wide?: boolean;
  children: ComponentChildren;
}) {
  return (
    <section class={wide ? 'bracket-box lib-card wide' : 'bracket-box lib-card'}>
      <div class="bracket-inner" />
      <div class="lib-header">
        <h2 class="lib-title" id={headingId}>
          {title}
        </h2>
        {badge && <span class={`lib-badge ${badge.tone}`}>{badge.text}</span>}
      </div>
      {children}
    </section>
  );
}

/** The "+" view: paste, open or drop a sequence, presets and database search (spec 3.3, 3.5). */
export function NewSequenceView() {
  const [text, setText] = useState('');
  const [lookup, setLookup] = useState<{ id: string; service: string } | { error: NetError } | null>(null);

  /** A bare accession is fetched from its database; the answer opens as a document. */
  const fetchAccession = async (id: string) => {
    const service = guessService(id);
    setLookup({ id, service: SERVICE_NAMES[service] });
    try {
      workspace.open(await fetchSequence(service, id));
      notice.value = null;
      sfx('loaded');
      setText('');
      setLookup(null);
    } catch (error) {
      sfx('error');
      setLookup({ error: error instanceof NetError ? error : new NetError(service, 'unreachable') });
    }
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (looksLikeIdentifier(trimmed)) {
      await fetchAccession(trimmed);
      return;
    }
    setLookup(null);
    if (await loadInputs([{ kind: 'text', text }])) setText('');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit(event);
  };

  return (
    <div class="new-seq-view">
      <div class="new-seq-hero">
        <h1 class="hero-title">{t('newSeq.title')}</h1>
        <p class="hero-sub">
          <span class="arrow" aria-hidden="true">
            →
          </span>
          <span>{t('newSeq.subtitle')}</span>
        </p>
      </div>

      <div class="lib-grid">
        <Card
          title={t('newSeq.pasteLabel')}
          headingId="paste-heading"
          badge={{ text: t('newSeq.badgeOffline'), tone: 'accent' }}
          wide
        >
          <form class="paste-form" onSubmit={submit}>
            <textarea
              id="paste-input"
              aria-labelledby="paste-heading"
              class="paste-input"
              value={text}
              placeholder={t('newSeq.pastePlaceholder')}
              spellcheck={false}
              autocomplete="off"
              rows={7}
              onInput={(event) => setText(event.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <div class="paste-actions">
              <button type="submit" class="primary-btn">
                {t('newSeq.load')}
              </button>
              <button type="button" class="secondary" onClick={() => void openFilesFromPicker()}>
                {t('newSeq.openFile')}
              </button>
              <span class="drop-hint">
                <span class="drop-hint-title">{t('newSeq.dropTitle')}</span>
                <span>{t('newSeq.formats')}</span>
              </span>
            </div>
            <div role="status" aria-live="polite">
              {lookup && 'id' in lookup && <p class="lib-status">{t('lib.paste.fetching', lookup)}</p>}
              {lookup && 'error' in lookup && (
                <p class="lib-status lib-error">{netErrorMessage(lookup.error)}</p>
              )}
            </div>
          </form>
        </Card>

        <Card
          title={t('newSeq.presetsTitle')}
          badge={{ text: t('newSeq.badgeOffline'), tone: 'accent' }}
          wide
        >
          <ExamplePresets variant="chips" />
          <p class="lib-status">{t('newSeq.presetsNote')}</p>
        </Card>

        <Card title={t('newSeq.dbTitle')} badge={{ text: t('newSeq.badgeNetwork'), tone: 'cyan' }} wide>
          <DatabaseSearch compact />
          <p class="lib-status">{t('newSeq.dbNote')}</p>
        </Card>
      </div>
    </div>
  );
}
