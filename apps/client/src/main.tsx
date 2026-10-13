import { useEffect, lazy, Suspense } from 'react'
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
  useEffect(() => {
    const cleanupDesktop = initTauriDesktopIntegration((path) => navigate(path))
    const cleanupAndroid = initAndroidIntegration(
      (path) => navigate(path),
      () => navigate(-1),
    )
    return () => {
      cleanupDesktop()
      cleanupAndroid()
    }
  }, [navigate])

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