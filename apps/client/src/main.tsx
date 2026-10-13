import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './design/theme'
import Shell from './components/Shell'
import Home from './pages/Home'
import Library from './pages/Library'
import Notebook from './pages/Notebook'
import Store from './pages/Store'
import SeriesDetail from './pages/SeriesDetail'
import MangaReader from './features/manga/MangaReader'
import Reader from './pages/Reader'
import Stats from './pages/Stats'
import DevComponents from './pages/DevComponents'
import { syncEngine } from './features/sync/engine'
import './design/tokens.css'

syncEngine.init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/notebook" element={<Notebook />} />
            <Route path="/store" element={<Store />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/series/:id" element={<SeriesDetail />} />
            <Route path="/dev/components" element={<DevComponents />} />
          </Route>
          <Route path="/read/:id" element={<Reader />} />
          <Route path="/read/manga/:seriesId/:chapterId" element={<MangaReader />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  </StrictMode>,
)