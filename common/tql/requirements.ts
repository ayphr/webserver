import type { PipelineStepAST, QueryAST } from './ast';
import { PIPELINE_LABELS } from './cost';

/**
 * Pipeline steps that need Boost mode. These do whole-dataset work that is too
 * expensive for a Standard query: deduplication, windowed analytics, and
 * multi-field/grouping reductions. Cheap, common steps such as filtering,
 * sorting, projections, and arithmetic remain available in Standard mode.
 */
export const BOOST_ONLY_PIPELINE_STEPS = new Set<PipelineStepAST['type']>([
  'distinct',
  'dedup',
  'movingAverage',
  'window',
  'resample',
  'summary',
  'groupBy',
]);

/** Names of the Boost-only steps in a parsed query, in the order they appear. */
export function getBoostRequiredSteps(ast: QueryAST): string[] {
  const steps = new Set<string>();
  for (const step of ast.pipeline) {
    if (BOOST_ONLY_PIPELINE_STEPS.has(step.type)) {
      steps.add(PIPELINE_LABELS[step.type]);
    }
  }
  return [...steps];
}

/** Shared wording for the Standard-to-Boost prompt in the UI and API errors. */
export function formatBoostRequiredMessage(steps: string[]): string {
  return `This query uses boost-only steps: ${steps.join(', ')}. Switch Query Type to Boost to continue.`;
}
