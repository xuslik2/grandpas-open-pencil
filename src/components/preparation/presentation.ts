import type { EditorPreparation, EditorPreparationProgress } from '@/app/editor/preparation/types'

export const preparationPhaseLabels = {
  reading: 'Reading document',
  decoding: 'Decoding Figma document',
  materializing: 'Preparing layers',
  'populating-page': 'Preparing page',
  'resolving-fonts': 'Resolving fonts',
  'resolving-fallbacks': 'Finalizing typography',
  layout: 'Computing layout',
  'preparing-render': 'Preparing canvas'
} satisfies Record<EditorPreparation['phase'], string>

export function preparationLabel(preparation: EditorPreparation | null): string {
  return preparation ? preparationPhaseLabels[preparation.phase] : 'Loading…'
}

export function preparationPercent(progress: EditorPreparationProgress | null): number | null {
  if (!progress || progress.total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((progress.completed / progress.total) * 100)))
}

// The order phases actually run in, used to show meaningful progress for
// the stretches that report no counts of their own. Opening a large
// document spends most of its time in phases with nothing to count
// (notably 'preparing-render'), where a purely indeterminate bar leaves
// no way to tell "working" from "wedged".
const PREPARATION_PHASE_ORDER: EditorPreparation['phase'][] = [
  'reading',
  'decoding',
  'materializing',
  'populating-page',
  'resolving-fonts',
  'resolving-fallbacks',
  'layout',
  'preparing-render'
]

export interface PreparationStep {
  index: number
  total: number
  percent: number
}

export function preparationStep(preparation: EditorPreparation | null): PreparationStep | null {
  if (!preparation) return null
  const index = PREPARATION_PHASE_ORDER.indexOf(preparation.phase)
  if (index === -1) return null
  const total = PREPARATION_PHASE_ORDER.length
  return { index: index + 1, total, percent: Math.round(((index + 1) / total) * 100) }
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
