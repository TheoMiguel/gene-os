import type { MessageKey } from '../ui/i18n';

/** The messages of the report. They live in the interface dictionaries, so the report follows the language. */
export type ReportKey = Extract<MessageKey, `report.${string}` | `alphabet.${string}` | `topology.${string}`>;

/** Report messages as plain strings. A function cannot cross into a Web Worker, so the report takes this table. */
export type ReportLabels = Readonly<Record<ReportKey, string>>;

/** Fills the `{name}` placeholders of a message. */
function fill(message: string, params?: Readonly<Record<string, string | number>>): string {
  return params
    ? message.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
    : message;
}

/** The report's translate function over a label table. */
export function reportText(
  labels: ReportLabels,
): (key: ReportKey, params?: Readonly<Record<string, string | number>>) => string {
  return (key, params) => fill(labels[key], params);
}

export type ReportText = ReturnType<typeof reportText>;

/** Picks the report's messages out of a full dictionary. */
export function pickReportLabels(dictionary: Readonly<Record<string, string>>): ReportLabels {
  return Object.fromEntries(
    Object.entries(dictionary).filter(([key]) => /^(report|alphabet|topology)\./.test(key)),
  ) as ReportLabels;
}
