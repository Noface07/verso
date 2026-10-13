import { useRef, useState, type DragEvent } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { BookOpen, Home, Library, NotebookPen, Plus } from 'lucide-react'
import { ACCEPT, importFiles } from '../lib/importBook'
import { Toast } from './ui'

export interface ShellContext {
  openImport: () => void
  importing: boolean
}

const NAV = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/notebook', label: 'Notebook', icon: NotebookPen },
]

export default function Shell() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState<{ id: number; message: string; detail?: string } | null>(null)

  const openImport = () => inputRef.current?.click()

  async function handleFiles(files: File[]) {
    if (!files.length) return
    setImporting(true)
    try {
      const r = await importFiles(files)
      const parts: string[] = []
      if (r.added) parts.push(`${r.added} added`)
      if (r.skipped) parts.push(`${r.skipped} already in your library`)
      if (r.failed.length) parts.push(`${r.failed.length} couldn't be opened`)
      setToast({
        id: Date.now(),
        message: parts.join(' · ') || 'Nothing imported',
        detail: r.failed.length ? r.failed.map((f) => `${f.name}: ${f.error}`).join('\n') : undefined,
      })
    } finally {
      setImporting(false)
    }
  }

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragging(true)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void handleFiles([...e.dataTransfer.files])
  }

  return (
    <div
      className="app"
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={onDrop}
    >
      <nav className="rail">
        <div className="rail-logo" aria-hidden="true"><BookOpen size={22} /></div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`} title={label}>
            <Icon size={21} />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="rail-spacer" />
        <button className="rail-item" onClick={openImport} title="Add books" disabled={importing}>
          <Plus size={21} />
          <span>{importing ? 'Adding…' : 'Add'}</span>
        </button>
      </nav>

      <main className="app-main">
        <Outlet context={{ openImport, importing } satisfies ShellContext} />
      </main>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => { void handleFiles([...(e.target.files ?? [])]); e.target.value = '' }}
      />
      {toast && <Toast key={toast.id} message={toast.message} detail={toast.detail} onDone={() => setToast(null)} />}
      {dragging && <div className="drop-overlay">Drop books to add them</div>}
    </div>
  )
}