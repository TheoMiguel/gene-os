import type { SeqRecord } from '../engine/types';
import { readSequenceText } from '../formats';
import { fetchRecord } from './services';
import { NetError, type RequestContext, type ServiceId } from './types';

/**
 * Fetches a record by identifier and reads it with the format readers. Throws `NetError` for a failed request,
 * and `NetError('badResponse')` when the service answered with text GENE_OS cannot read.
 */
export async function fetchSequence(
  service: ServiceId,
  id: string,
  context?: RequestContext,
): Promise<SeqRecord> {
  const { text } = await fetchRecord(service, id, context);
  const read = readSequenceText(text);
  const record = read.ok ? read.records[0] : undefined;
  if (!record) throw new NetError(service, 'badResponse');
  return record;
}
