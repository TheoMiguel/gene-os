import { helix } from './helix';
import { hexgrid } from './hexgrid';
import { particles } from './particles';
import { rain } from './rain';
import type { SceneFactory, SceneId } from './scene';
import { telemetry } from './telemetry';

/** Every background scene, keyed by the setting that selects it. */
export const SCENES: Record<SceneId, SceneFactory> = { particles, helix, hexgrid, telemetry, rain };
