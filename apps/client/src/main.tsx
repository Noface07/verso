import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './design/theme'
import Shell from './components/Shell'
import Home from './pages/Home'
import Library from './pages/Library'
import Notebook from './pages/Notebook'
import Reader from './pages/Reader'
import DevComponents from './pages/DevComponents'
import './design/tokens.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/notebook" element={<Notebook />} />
            <Route path="/dev/components" element={<DevComponents />} />
          </Route>
          <Route path="/read/:id" element={<Reader />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  </StrictMode>,
)