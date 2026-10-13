import { useState } from 'react';
import {
  Heart,
  Bookmark,
  Share2,
  Trash2,
  Plus,
  BookOpen,
  Filter,
} from 'lucide-react';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';
import { ToggleButton } from '../design/components/ToggleButton';
import { SegmentedControl } from '../design/components/SegmentedControl';
import { Tabs } from '../design/components/Tabs';
import { SearchBox } from '../design/components/SearchBox';
import { Dialog } from '../design/components/Dialog';
import { Popover } from '../design/components/Popover';
import { Dropdown } from '../design/components/Dropdown';
import { ContextMenu } from '../design/components/ContextMenu';
import { Slider } from '../design/components/Slider';
import { Switch } from '../design/components/Switch';
import { Checkbox } from '../design/components/Checkbox';
import { InfoBar } from '../design/components/InfoBar';
import { ProgressBar, ProgressRing, Skeleton } from '../design/components/Progress';
import { BookCard } from '../design/components/BookCard';
import { Shelf } from '../design/components/Shelf';
import { EmptyState } from '../design/components/EmptyState';
import { FocusTrap } from '../design/components/FocusTrap';

export default function DevComponents() {
  const [togglePressed, setTogglePressed] = useState(false);
  const [segmentVal, setSegmentVal] = useState('books');
  const [tabVal, setTabVal] = useState('overview');
  const [searchVal, setSearchVal] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [trapOpen, setTrapOpen] = useState(false);
  const [sliderVal, setSliderVal] = useState([65]);
  const [switchVal, setSwitchVal] = useState(true);
  const [checkVal, setCheckVal] = useState<boolean | 'indeterminate'>(true);

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-10 space-y-12">
      <div className="border-b border-[var(--stroke)] pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-1)]">
          Mica Design System Gallery
        </h1>
        <p className="text-sm text-[var(--text-2)] mt-1">
          Interactive token and primitive showroom for Folio.
        </p>
      </div>

      {/* Buttons Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-1)]">Buttons</h2>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="accent">Accent</Button>
          <Button variant="standard">Standard</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="standard" disabled>Disabled</Button>
          <Button variant="accent" icon={<Plus className="w-4 h-4" />}>
            With Icon
          </Button>
        </div>
        <div className="flex items-center gap-4 pt-2">
          <Button size="sm">Small (28px)</Button>
          <Button size="md">Medium (32px)</Button>
          <Button size="lg">Large (40px)</Button>
        </div>
      </section>

      {/* Icon & Toggle Buttons */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-1)]">Icon & Toggle Buttons</h2>
        <div className="flex items-center gap-4">
          <IconButton label="Favorite" icon={<Heart className="w-4 h-4" />} />
          <IconButton label="Bookmark" icon={<Bookmark className="w-4 h-4" />} variant="standard" />
          <IconButton label="Share" icon={<Share2 className="w-4 h-4" />} variant="accent" />
          <IconButton label="Delete" icon={<Trash2 className="w-4 h-4" />} variant="danger" />
          <ToggleButton
            label="Favorite book"
            pressed={togglePressed}
            onPressedChange={setTogglePressed}
            icon={<Heart className="w-4 h-4" />}
            activeIcon={<Heart className="w-4 h-4 fill-current" />}
          >
            {togglePressed ? 'Favorited' : 'Favorite'}
          </ToggleButton>
        </div>
      </section>

      {/* Segmented Control & Tabs */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-1)]">Segmented Control & Tabs</h2>
        <div>
          <SegmentedControl
            options={[
              { value: 'books', label: 'Books' },
              { value: 'manga', label: 'Manga' },
              { value: 'comics', label: 'Comics' },
            ]}
            value={segmentVal}
            onChange={setSegmentVal}
          />
        </div>
        <div className="pt-2">
          <Tabs
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'specs', label: 'Specifications', badge: 'New' },
              { value: 'reviews', label: 'Reviews' },
            ]}
            value={tabVal}
            onValueChange={setTabVal}
          />
        </div>
      </section>

      {/* Inputs & Form Controls */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-1)]">Inputs & Form Controls</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <SearchBox value={searchVal} onChange={setSearchVal} placeholder="Search anything…" />
          <div className="flex items-center gap-6">
            <Switch label="Dark Mode" checked={switchVal} onCheckedChange={setSwitchVal} />
            <Checkbox label="Enable Sync" checked={checkVal} onCheckedChange={setCheckVal} />
          </div>
        </div>
        <div className="max-w-md pt-2">
          <span className="text-xs text-[var(--text-2)] mb-1 block">Volume: {sliderVal[0]}%</span>
          <Slider value={sliderVal} onValueChange={setSliderVal} />
        </div>
      </section>

      {/* Overlays & Menus */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-1)]">Dialogs, Popovers & Menus</h2>
        <div className="flex items-center gap-4">
          <Button onClick={() => setDialogOpen(true)}>Open Dialog</Button>
          <Popover
            trigger={<Button variant="standard">Open Popover</Button>}
          >
            <div className="w-60 space-y-2">
              <h4 className="font-semibold text-sm">Quick Settings</h4>
              <p className="text-xs text-[var(--text-2)]">Fluent flyout popup styled with Mica layer-solid.</p>
            </div>
          </Popover>

          <Dropdown
            trigger={<Button variant="standard" icon={<Filter className="w-4 h-4" />}>Filter</Button>}
            sections={[
              {
                title: 'Format',
                items: [
                  { key: 'all', label: 'All formats', checked: true },
                  { key: 'epub', label: 'EPUB only' },
                  { key: 'cbz', label: 'CBZ / Comics' },
                ],
              },
              {
                items: [
                  { key: 'delete', label: 'Delete collection', danger: true, icon: <Trash2 className="w-4 h-4" /> },
                ],
              },
            ]}
          />

          <ContextMenu
            sections={[
              {
                items: [
                  { key: 'open', label: 'Open reader' },
                  { key: 'details', label: 'Book details' },
                  { key: 'fav', label: 'Add to favourites' },
                ],
              },
            ]}
          >
            <div className="p-3 bg-[var(--layer-2)] border border-[var(--stroke)] rounded-[var(--r-md)] text-xs text-[var(--text-2)] select-none">
              Right-click here for ContextMenu
            </div>
          </ContextMenu>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Sample Dialog"
          description="Fluent centered modal dialog with smooth fade and scale."
          footer={
            <>
              <Button variant="subtle" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="accent" onClick={() => setDialogOpen(false)}>Confirm</Button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-2)]">
            This dialog adheres to the 560px max width and token-based layer styles.
          </p>
        </Dialog>

        <div className="pt-2">
          <Button variant="standard" onClick={() => setTrapOpen(!trapOpen)}>
            {trapOpen ? 'Close Focus Trap' : 'Open Focus Trap Demo'}
          </Button>
          {trapOpen && (
            <div className="mt-3 p-4 bg-[var(--layer-2)] border border-[var(--stroke)] rounded-[var(--r-md)] max-w-md">
              <FocusTrap onClose={() => setTrapOpen(false)} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[var(--text-1)]">Focus Trap Active</h4>
                  <span className="text-xs text-[var(--text-2)]">Press Esc to close</span>
                </div>
                <p className="text-xs text-[var(--text-2)]">
                  Tab and Shift+Tab cycle only through the buttons below. Closing restores focus to the trigger button above.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="accent">Action 1</Button>
                  <Button size="sm" variant="standard">Action 2</Button>
                  <Button size="sm" variant="subtle" onClick={() => setTrapOpen(false)}>Done</Button>
                </div>
              </FocusTrap>
            </div>
          )}
        </div>
      </section>

      {/* Feedback & Indicators */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-1)]">Feedback & Progress</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoBar severity="info" title="Information" message="Folio synced 12 new items across your devices." />
          <InfoBar severity="success" title="Success" message="Book imported and ready to read." />
          <InfoBar severity="warning" title="Warning" message="Server connection slow. Offline cache active." />
          <InfoBar severity="error" title="Error" message="Could not authenticate with server." />
        </div>
        <div className="flex items-center gap-6 pt-3">
          <ProgressRing size={28} />
          <div className="w-64">
            <ProgressBar value={72} />
          </div>
          <Skeleton className="w-32 h-8" />
        </div>
      </section>

      {/* Covers, Cards & Shelf */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-1)]">Book Covers, Cards & Shelves</h2>
        <Shelf title="Featured Books" action={<a href="#more">See all ›</a>}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="w-[140px] shrink-0">
              <BookCard
                id={`book-sample-${i}`}
                title={`Sample Masterpiece Volume ${i}`}
                author="Legendary Author"
                progressPercent={i * 20}
                isFavourite={i % 2 === 0}
              />
            </div>
          ))}
        </Shelf>
      </section>

      {/* Empty State */}
      <section className="space-y-4 border-t border-[var(--stroke)] pt-6">
        <h2 className="text-lg font-semibold text-[var(--text-1)]">Empty State</h2>
        <EmptyState
          icon={<BookOpen className="w-6 h-6" />}
          title="No books yet"
          description="Your library is currently empty. Drop an EPUB, MOBI or CBZ file here to start reading."
          action={<Button variant="accent">Import Book</Button>}
        />
      </section>
    </div>
  );
}
