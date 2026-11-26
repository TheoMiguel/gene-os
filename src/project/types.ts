import type { SearchMode } from '../engine/search';
import type { Frame } from '../engine/translate';
import type { SeqRecord, Strand } from '../engine/types';
import type { AnalysisTab } from '../state/documents';
import type { OverlayKind } from '../state/view';

/** Marker that tells a GENE_OS project file from any other JSON file. */
export const PROJECT_FORMAT = 'gene-os-project';

/**
 * Version of the project file and of the stored session. Raise it when a field changes meaning, and add a
 * migration for the old version in `parse.ts`. A reader refuses a version above this one.
 */
export const PROJECT_VERSION = 1;

/** The part of a document's view the user would expect to find again: selection, search, overlays, line length. */
export interface ViewConfig {
  readonly selection: { readonly start: number; readonly end: number; readonly strand: Strand } | null;
  readonly caret: number;
  readonly search: { readonly query: string; readonly mode: SearchMode };
  readonly overlays: Readonly<Record<OverlayKind, boolean>>;
  readonly lineLength: number;
  readonly frames: readonly Frame[];
}

/** One open document as a project holds it. `sections` carries what other views register (primers, cloning). */
export interface ProjectDocument {
  readonly record: SeqRecord;
  readonly activeTab: AnalysisTab;
  readonly view: ViewConfig;
  readonly sections: Readonly<Record<string, unknown>>;
}

/** The whole workspace: what a project file holds and what a session restore rebuilds. */
export interface ProjectData {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: number;
  readonly app: 'GENE_OS';
  readonly name: string;
  /** ISO 8601 time of the save. */
  readonly savedAt: string;
  /** Index into `documents` of the document that was active, or null for the new-sequence view. */
  readonly activeIndex: number | null;
  readonly documents: readonly ProjectDocument[];
}

/** Why a project could not be read. The interface translates each code. */
export type ProjectRefusal = 'notJson' | 'notProject' | 'newerVersion' | 'unsupportedVersion' | 'damaged';

export type ProjectParse =
  | {
      readonly ok: true;
      readonly data: ProjectData;
      /** Documents dropped because their record was damaged. */
      readonly skipped: number;
    }
  | { readonly ok: false; readonly reason: ProjectRefusal; readonly version?: number };
