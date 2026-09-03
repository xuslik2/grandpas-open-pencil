// Slideshow-style presentation mode: fullscreen, click/arrow-key through
// each page's top-level frames as slides, in reading order (top-to-bottom,
// then left-to-right within a page; pages in document order). This is
// deliberately not Figma's interactive prototyping engine — no frame
// connections, triggers, or transitions — it reuses the existing canvas
// renderer and viewport (zoomToBounds) rather than rendering slides
// independently, so it stays cheap and doesn't need any new data model.
import { computed, ref } from 'vue'

import { useEditorStore, type EditorStore } from '@/app/editor/active-store'

export interface PresentSlide {
  id: string
  pageId: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export const isPresenting = ref(false)
export const currentSlideIndex = ref(0)
const slides = ref<PresentSlide[]>([])

export const presentSlides = computed(() => slides.value)
export const slideCount = computed(() => slides.value.length)
export const currentSlide = computed<PresentSlide | null>(
  () => slides.value[currentSlideIndex.value] ?? null
)
export const canGoNext = computed(() => currentSlideIndex.value < slides.value.length - 1)
export const canGoPrevious = computed(() => currentSlideIndex.value > 0)

function collectSlides(store: EditorStore): PresentSlide[] {
  const result: PresentSlide[] = []
  for (const page of store.graph.getPages()) {
    const frames = store.graph
      .getChildren(page.id)
      .filter((node) => node.type === 'FRAME' && node.visible !== false)
      .map((node) => {
        const abs = store.graph.getAbsolutePosition(node.id)
        return {
          id: node.id,
          pageId: page.id,
          name: node.name,
          x: abs.x,
          y: abs.y,
          width: node.width,
          height: node.height
        }
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
    result.push(...frames)
  }
  return result
}

async function showSlide(store: EditorStore, index: number): Promise<void> {
  const slide = slides.value[index]
  if (!slide) return
  currentSlideIndex.value = index
  if (store.state.currentPageId !== slide.pageId) {
    await store.switchPage(slide.pageId)
  }
  // Zero padding: fill the screen with the frame, like a real slide,
  // instead of the small margin zoomToFit/zoomToSelection normally leave.
  store.zoomToBounds(slide.x, slide.y, slide.x + slide.width, slide.y + slide.height, 0)
}

let previousShowUI = true

export function hasPresentableSlides(): boolean {
  const store = useEditorStore()
  return collectSlides(store).length > 0
}

// Captures arrow/space/escape while presenting so they navigate slides
// instead of triggering the editor's normal shortcuts (nudge, deselect,
// etc). Registered only for the lifetime of a presentation, not globally.
function handleKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case ' ':
    case 'PageDown':
      event.preventDefault()
      void nextSlide()
      return
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      event.preventDefault()
      void previousSlide()
      return
    case 'Escape':
      event.preventDefault()
      void exitPresentMode()
  }
}

// Browser-native fullscreen can be left without going through our exit
// button (OS Escape handling, F11, swiping away on a trackpad) — keep
// isPresenting in sync when that happens instead of leaving a phantom
// "still presenting" state with no way back to the fullscreen it expects.
function handleFullscreenChange(): void {
  if (!document.fullscreenElement && isPresenting.value) void exitPresentMode()
}

export async function enterPresentMode(): Promise<void> {
  const store = useEditorStore()
  slides.value = collectSlides(store)
  if (slides.value.length === 0) return

  previousShowUI = store.state.showUI
  store.state.showUI = false
  store.clearSelection()
  isPresenting.value = true
  window.addEventListener('keydown', handleKeydown, true)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  await showSlide(store, 0)

  if (document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      // Fullscreen can be denied (no user-gesture, embedded context,
      // etc.) — presentation still works fine windowed.
    }
  }
}

export async function exitPresentMode(): Promise<void> {
  if (!isPresenting.value) return
  isPresenting.value = false
  slides.value = []
  window.removeEventListener('keydown', handleKeydown, true)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  const store = useEditorStore()
  store.state.showUI = previousShowUI
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen()
    } catch {
      // Already left fullscreen some other way (Esc, OS chrome) — fine.
    }
  }
}

export async function goToSlide(index: number): Promise<void> {
  if (index < 0 || index >= slides.value.length) return
  await showSlide(useEditorStore(), index)
}

export async function nextSlide(): Promise<void> {
  if (!canGoNext.value) return
  await showSlide(useEditorStore(), currentSlideIndex.value + 1)
}

export async function previousSlide(): Promise<void> {
  if (!canGoPrevious.value) return
  await showSlide(useEditorStore(), currentSlideIndex.value - 1)
}
