import { ref } from 'vue'
import type { Project } from '@/app/hosted/hierarchy/api'

// A single global selection is enough for now — the dashboard is one view,
// not per-tab navigation state. Revisit if/when multiple dashboard tabs
// become a real feature (see HOSTED.md's Phase 3 note on this tradeoff).
export const selectedProject = ref<Project | null>(null)
