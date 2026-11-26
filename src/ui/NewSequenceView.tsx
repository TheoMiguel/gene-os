import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { loadInputs, openFilesFromPicker } from './actions';
import { t } from './i18n';

/** Example names for the preset list; the records arrive with the offline library (spec 6.2). */
const PRESET_NAMES = ['pUC19', 'pET-28a(+)', 'pBR322', 'Lambda phage', 'EGFP'] as const;

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

  const submit = async (event: Event) => {
    event.preventDefault();
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
          </form>
        </Card>

        <Card title={t('newSeq.presetsTitle')} badge={{ text: t('newSeq.badgeOffline'), tone: 'accent' }}>
          <div class="lib-chips">
            {PRESET_NAMES.map((name) => (
              <button key={name} type="button" class="chip-btn" disabled>
                {name}
              </button>
            ))}
          </div>
          <p class="lib-status">{t('newSeq.presetsNote')}</p>
        </Card>

        <Card title={t('newSeq.dbTitle')} badge={{ text: t('newSeq.badgeNetwork'), tone: 'cyan' }}>
          <form class="db-form" onSubmit={(event) => event.preventDefault()}>
            <label class="field-label" for="db-query">
              {t('newSeq.dbLabel')}
            </label>
            <div class="db-row">
              <input id="db-query" type="search" placeholder={t('newSeq.dbPlaceholder')} disabled />
              <button type="submit" class="secondary" disabled>
                {t('newSeq.dbSearch')}
              </button>
            </div>
          </form>
          <p class="lib-status">{t('newSeq.dbNote')}</p>
        </Card>
      </div>
    </div>
  );
}
