import type { AnalysisState } from '../../../state/analysis';
import { t } from '../../i18n';

/**
 * A box of a fixed height that stands where a result will be: a quiet message while the scan runs, and the reason
 * when it failed. The box keeps its size, so the result replaces it without moving the page.
 */
export function Pending({
  state,
  height,
  message,
}: {
  readonly state: AnalysisState<unknown>;
  readonly height: number;
  readonly message: string;
}) {
  const failed = state.status === 'failed';
  return (
    <div
      class={`summary-pending${failed ? ' failed' : ''}`}
      style={{ height: `${height}px` }}
      role="status"
      aria-busy={!failed}
    >
      {failed ? t('summary.failed', { reason: state.reason }) : message}
    </div>
  );
}
