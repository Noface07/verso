import { useEffect, useRef, lazy, Suspense } from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { ThemeProvider } from './design/theme'
import Shell from './components/Shell'
import Home from './pages/Home'
import { TitleBar } from './components/TitleBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TooltipProvider } from './design/components/Tooltip'
import { initTauriDesktopIntegration } from './lib/tauriIntegration'
import { initAndroidIntegration } from './lib/androidIntegration'
import { syncEngine } from './features/sync/engine'
import './design/tokens.css'

// Lazy loaded routes for bundle splitting (< 350 KB gzip initial bundle)
const Library = lazy(() => import('./pages/Library'))
const Notebook = lazy(() => import('./pages/Notebook'))
const Store = lazy(() => import('./pages/Store'))
const SeriesDetail = lazy(() => import('./pages/SeriesDetail'))
const MangaReader = lazy(() => import('./features/manga/MangaReader'))
const Reader = lazy(() => import('./pages/Reader'))
const Stats = lazy(() => import('./pages/Stats'))
const Updates = lazy(() => import('./pages/Updates'))
const Settings = lazy(() => import('./pages/Settings'))
const DevComponents = lazy(() => import('./pages/DevComponents'))

function PageFallback() {
  return (
    <div
      role="status"
      aria-label="Loading page content"
      className="w-full h-full min-h-[250px] flex items-center justify-center bg-[var(--surface-base)] text-[var(--text-muted)]"
    >
      <div className="w-7 h-7 border-2 border-[var(--border-subtle)] border-t-[var(--accent)] rounded-full animate-spin" />
    </div>
  )
}

syncEngine.init()

function AppRoutes() {
  const navigate = useNavigate()
  // navigate() gets a new identity on every route change. Reading it through a ref
  // keeps the native listeners (Android back, file open) registered once; re-adding
  // them on each navigation left gaps where back fell through to Android (app exit).
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  })
  useEffect(() => {
    const cleanupDesktop = initTauriDesktopIntegration((path) => navigateRef.current(path))
    const cleanupAndroid = initAndroidIntegration(
      (path) => navigateRef.current(path),
      () => {
        // Nothing left to close: go back a page, then to Home, then leave the app.
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
        if (idx > 0) {
          navigateRef.current(-1)
          return
        }
        if ((window.location.hash.replace(/^#/, '') || '/') !== '/') {
          navigateRef.current('/', { replace: true })
          return
        }
        void import('@tauri-apps/plugin-process').then(({ exit }) => exit(0))
      },
    )
    return () => {
      cleanupDesktop()
      cleanupAndroid()
    }
  }, [])

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <TitleBar />
      <div className="flex-1 w-full h-full overflow-hidden relative">
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<Shell />}>
                <Route path="/" element={<Home />} />
                <Route path="/library" element={<Library />} />
                <Route path="/notebook" element={<Notebook />} />
                <Route path="/store" element={<Store />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/updates" element={<Updates />} />
                <Route path="/series/:id" element={<SeriesDetail />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/dev/components" element={<DevComponents />} />
              </Route>
              <Route path="/read/:id" element={<Reader />} />
              <Route path="/read/manga/:seriesId/:chapterId" element={<MangaReader />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)