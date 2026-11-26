import type { SeqDocument } from '../../state/documents';
import { t } from '../i18n';
import { DatabaseSearch } from './libraries/DatabaseSearch';
import { ExamplePresets } from './libraries/ExamplePresets';
import './libraries/libraries.css';

/**
 * The libraries tab (spec 6): the offline example sequences and the online database search. Opening any record
 * adds a document; this tab belongs to the document only because every tab does.
 */
export function Panel(_props: { readonly doc: SeqDocument }) {
  return (
    <div class="libraries-panel">
      <section class="bracket-box lib-card" aria-labelledby="lib-examples-heading">
        <div class="bracket-inner" />
        <div class="lib-header">
          <h2 class="lib-title" id="lib-examples-heading">
            {t('newSeq.presetsTitle')}
          </h2>
          <span class="lib-badge accent">{t('newSeq.badgeOffline')}</span>
        </div>
        <ExamplePresets variant="cards" />
        <p class="lib-status">{t('newSeq.presetsNote')}</p>
      </section>
      <section class="bracket-box lib-card" aria-labelledby="lib-db-heading">
        <div class="bracket-inner" />
        <div class="lib-header">
          <h2 class="lib-title" id="lib-db-heading">
            {t('newSeq.dbTitle')}
          </h2>
          <span class="lib-badge cyan">{t('newSeq.badgeNetwork')}</span>
        </div>
        <DatabaseSearch />
        <p class="lib-status">{t('newSeq.dbNote')}</p>
      </section>
    </div>
  );
}
