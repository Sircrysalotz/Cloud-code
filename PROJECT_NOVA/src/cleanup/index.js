/**
 * Cleanup pipeline runner — applies all 9 passes in order.
 *
 * Each pass is immutable (returns a new grid). Pass 8 is diagnostic-only
 * and doesn't modify the grid but returns flags.
 */

import { pass1Orphan }           from './pass1_orphan.js';
import { pass2OutlineThin }      from './pass2_outline_thin.js';
import { pass3OutlineRepair }    from './pass3_outline_repair.js';
import { pass4HighlightCluster } from './pass4_highlight_cluster.js';
import { pass5SinglePixel }      from './pass5_single_pixel.js';
import { pass6BandSkip }         from './pass6_band_skip.js';
import { pass7HighlightArea }    from './pass7_highlight_area.js';
import { pass8MidDiagnostic }    from './pass8_mid_diagnostic.js';
import { pass9ContactShadow }    from './pass9_contact_shadow.js';

/**
 * Run the full cleanup pipeline on a grid.
 * @param {Uint8Array[]} grid
 * @returns {{ grid: Uint8Array[], flags: string[], passResults: object[] }}
 */
export function runCleanup(grid) {
  const passResults = [];

  function step(name, fn) {
    const before = grid;
    grid = fn(grid);
    passResults.push({ pass: name, grid });
    return grid;
  }

  step('pass1_orphan',           pass1Orphan);
  step('pass2_outline_thin',     pass2OutlineThin);
  step('pass3_outline_repair',   pass3OutlineRepair);
  step('pass4_highlight_cluster',pass4HighlightCluster);
  step('pass5_single_pixel',     pass5SinglePixel);
  step('pass6_band_skip',        pass6BandSkip);
  step('pass7_highlight_area',   pass7HighlightArea);

  // Pass 8 is diagnostic — captures flags but grid is unchanged
  const { grid: diagGrid, flags, ratios } = pass8MidDiagnostic(grid);
  grid = diagGrid;
  passResults.push({ pass: 'pass8_mid_diagnostic', grid, flags, ratios });

  step('pass9_contact_shadow', pass9ContactShadow);

  return { grid, flags: flags ?? [], passResults };
}

export {
  pass1Orphan,
  pass2OutlineThin,
  pass3OutlineRepair,
  pass4HighlightCluster,
  pass5SinglePixel,
  pass6BandSkip,
  pass7HighlightArea,
  pass8MidDiagnostic,
  pass9ContactShadow,
};
