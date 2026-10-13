import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FocusTrap } from '../src/design/components/FocusTrap';

describe('FocusTrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('automatically focuses the first focusable element after mounting', () => {
    render(
      <FocusTrap>
        <button>First Button</button>
        <button>Second Button</button>
      </FocusTrap>,
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    const first = screen.getByRole('button', { name: 'First Button' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps focus from last to first element on Tab', () => {
    render(
      <FocusTrap>
        <button>First</button>
        <button>Middle</button>
        <button>Last</button>
      </FocusTrap>,
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(first);
  });

  it('wraps focus from first to last element on Shift+Tab', () => {
    render(
      <FocusTrap>
        <button>First</button>
        <button>Middle</button>
        <button>Last</button>
      </FocusTrap>,
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn();
    render(
      <FocusTrap onClose={handleClose}>
        <button>Inside Button</button>
      </FocusTrap>,
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    const btn = screen.getByRole('button', { name: 'Inside Button' });
    fireEvent.keyDown(btn, { key: 'Escape' });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to previous active element on unmount', () => {
    function HostComponent() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button id="trigger" onClick={() => setIsOpen(true)}>
            Open Trap
          </button>
          {isOpen && (
            <FocusTrap onClose={() => setIsOpen(false)}>
              <button id="inside" onClick={() => setIsOpen(false)}>
                Close Trap
              </button>
            </FocusTrap>
          )}
        </div>
      );
    }

    render(<HostComponent />);

    const trigger = screen.getByRole('button', { name: 'Open Trap' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    const inside = screen.getByRole('button', { name: 'Close Trap' });
    expect(document.activeElement).toBe(inside);

    // Click close inside trap to unmount it
    fireEvent.click(inside);

    expect(screen.queryByRole('button', { name: 'Close Trap' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not trap or autofocus when active is false', () => {
    render(
      <FocusTrap active={false}>
        <button>Disabled Trap Button</button>
      </FocusTrap>,
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    const btn = screen.getByRole('button', { name: 'Disabled Trap Button' });
    expect(document.activeElement).not.toBe(btn);
  });
});
