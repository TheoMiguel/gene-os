import { useId, useState } from 'preact/hooks';
import { type DatabaseHit, SERVICE_NAMES, SERVICES, type ServiceId } from '../../../net';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { netErrorMessage, preferredService, useLookup } from './lookup';
import './libraries.css';

type Mode = 'id' | 'search';

function columns(): TableColumn<DatabaseHit>[] {
  return [
    { id: 'id', header: t('lib.db.col.id'), value: (hit) => hit.id, width: 120 },
    { id: 'name', header: t('lib.db.col.name'), value: (hit) => hit.name, width: 130 },
    { id: 'description', header: t('lib.db.col.description'), value: (hit) => hit.description, width: 360 },
    { id: 'organism', header: t('lib.db.col.organism'), value: (hit) => hit.organism, width: 170 },
    {
      id: 'length',
      header: t('lib.db.col.length'),
      value: (hit) => hit.length,
      type: 'number',
      width: 90,
      format: (value) => (typeof value === 'number' ? value.toLocaleString() : ''),
    },
  ];
}

/**
 * Database lookup (spec 6.1): fetch a record by identifier from NCBI, ENA or UniProt, or search them by keyword
 * and open results from a table. It is the only part of the app that uses the network, and it says so: offline,
 * timeout, rate limit and a refusing service each have their own message, and none looks like an empty result.
 */
export function DatabaseSearch({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const [mode, setMode] = useState<Mode>('id');
  const [identifier, setIdentifier] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<readonly number[]>([]);
  const lookup = useLookup();
  const service = preferredService.value;
  const { state } = lookup;
  const busy = state.phase === 'working';

  const submit = (event: Event) => {
    event.preventDefault();
    setSelected([]);
    if (mode === 'id') {
      if (identifier.trim() !== '') void lookup.fetchById(service, identifier.trim());
    } else if (query.trim() !== '') void lookup.search(service, query.trim());
  };

  const retry = () => {
    if (mode === 'id') void lookup.fetchById(service, identifier.trim());
    else void lookup.search(service, query.trim());
  };

  const hits = state.phase === 'results' ? state.hits : [];
  const name = (target: ServiceId) => SERVICE_NAMES[target];

  return (
    <div class="db-panel">
      <form class="db-form" onSubmit={submit}>
        <div class="db-controls">
          <div class="db-field">
            <label class="field-label" for={`${id}-service`}>
              {t('lib.db.service')}
            </label>
            <select
              id={`${id}-service`}
              value={service}
              onChange={(event) => {
                const next = SERVICES.find((candidate) => candidate === event.currentTarget.value);
                if (next) preferredService.value = next;
                lookup.reset();
              }}
            >
              {SERVICES.map((option) => (
                <option key={option} value={option}>
                  {name(option)}
                </option>
              ))}
            </select>
          </div>
          <fieldset class="db-field db-modes">
            <legend class="field-label">{t('lib.db.mode')}</legend>
            <div class="seg-group">
              {(['id', 'search'] as const).map((option) => (
                <label key={option} class="seg-btn">
                  <input
                    type="radio"
                    class="visually-hidden"
                    name={`${id}-mode`}
                    checked={mode === option}
                    onChange={() => {
                      setMode(option);
                      lookup.reset();
                    }}
                  />
                  <span>{t(option === 'id' ? 'lib.db.mode.id' : 'lib.db.mode.search')}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <label class="field-label" for={`${id}-input`}>
          {t(mode === 'id' ? 'lib.db.idLabel' : 'lib.db.queryLabel')}
        </label>
        <div class="db-row">
          <input
            id={`${id}-input`}
            type="search"
            value={mode === 'id' ? identifier : query}
            placeholder={t(mode === 'id' ? 'lib.db.idPlaceholder' : 'lib.db.queryPlaceholder')}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) =>
              mode === 'id' ? setIdentifier(event.currentTarget.value) : setQuery(event.currentTarget.value)
            }
          />
          <button type="submit" class="primary-btn" disabled={busy}>
            {t(mode === 'id' ? 'lib.db.fetch' : 'lib.db.search')}
          </button>
        </div>
      </form>

      <div class="db-state" role="status" aria-live="polite">
        {state.phase === 'working' && (
          <p class="lib-status">
            {t(state.task === 'search' ? 'lib.db.searching' : 'lib.db.fetching', {
              service: name(state.service),
            })}
          </p>
        )}
        {state.phase === 'done' && (
          <p class="lib-status">{t('lib.db.opened', { id: state.id, service: name(state.service) })}</p>
        )}
        {state.phase === 'results' && hits.length === 0 && (
          <p class="lib-status">{t('lib.db.empty', { service: name(state.service) })}</p>
        )}
        {state.phase === 'results' && hits.length > 0 && (
          <p class="lib-status">
            {t(state.capped ? 'lib.db.resultsCapped' : 'lib.db.results', {
              count: hits.length,
              service: name(state.service),
            })}
          </p>
        )}
      </div>
      {state.phase === 'failed' && (
        <div class="lib-status lib-error" role="alert">
          <span>{netErrorMessage(state.error)}</span>
          {state.error.kind !== 'invalidIdentifier' && (
            <button type="button" class="secondary" onClick={retry}>
              {t('lib.db.retry')}
            </button>
          )}
        </div>
      )}

      {state.phase === 'results' && hits.length > 0 && (
        <>
          <div class={compact ? 'db-results compact' : 'db-results'}>
            <Table
              label={t('lib.db.table', { service: name(state.service) })}
              columns={columns()}
              rows={hits}
              exportName={`${state.service}-search`}
              onSelectionChange={setSelected}
            />
          </div>
          <div class="db-open-row">
            <button
              type="button"
              class="primary-btn"
              disabled={selected.length === 0 || busy}
              onClick={() => void lookup.openHits(selected.flatMap((index) => hits[index] ?? []))}
            >
              {t('lib.db.openSelected', { count: selected.length })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
