import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeContext,
  reportCrash,
  isCrashReportingEnabled,
  setCrashReportingEnabled,
  getRecentCrashReports,
  clearCrashReports,
} from '../src/lib/crashReporter';
import { safeHtml } from '../src/lib/safeHtml';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

// Component that throws on demand
function BrokenWidget({ shouldCrash }: { shouldCrash: boolean }) {
  if (shouldCrash) {
    throw new Error('Test crash in widget');
  }
  return <div>Widget OK</div>;
}

describe('Phase 13: Hardening, Security, and Error Boundaries', () => {
  describe('P13.2: Error Boundary & Crash Reporting', () => {
    it('catches render errors and renders accessible recovery UI', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { rerender } = render(
        <ErrorBoundary fallbackTitle="Widget failed">
          <BrokenWidget shouldCrash={false} />
        </ErrorBoundary>,
      );

      expect(screen.getByText('Widget OK')).toBeInTheDocument();

      // Trigger crash
      rerender(
        <ErrorBoundary fallbackTitle="Widget failed">
          <BrokenWidget shouldCrash={true} />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Widget failed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reload this view/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Return to Home/i })).toBeInTheDocument();

      consoleError.mockRestore();
    });

    it('redacts tokens, passwords, and sensitive context in crash reports', () => {
      const rawContext = {
        userId: '12345',
        authToken: 'secret_token_abc',
        apiPassword: 'super_secret_pw',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
        nested: {
          sessionToken: 'xyz789',
          normalData: 'readable text',
        },
      };

      const sanitized = sanitizeContext(rawContext) as {
        userId: string;
        authToken: string;
        apiPassword: string;
        authorization: string;
        nested: { sessionToken: string; normalData: string };
      };
      expect(sanitized.userId).toBe('12345');
      expect(sanitized.authToken).toBe('[REDACTED]');
      expect(sanitized.apiPassword).toBe('[REDACTED]');
      expect(sanitized.authorization).toContain('[REDACTED]');
      expect(sanitized.nested.sessionToken).toBe('[REDACTED]');
      expect(sanitized.nested.normalData).toBe('readable text');
    });

    it('respects opt-in crash reporting setting (default off)', () => {
      clearCrashReports();
      setCrashReportingEnabled(false);
      expect(isCrashReportingEnabled()).toBe(false);

      const disReport = reportCrash(new Error('Silent error'), { token: 'secret' });
      // When disabled, does not return a dispatched report object
      expect(disReport).toBeNull();

      // But records in local diagnostic ring buffer
      const localLogs = getRecentCrashReports();
      expect(localLogs.length).toBeGreaterThanOrEqual(1);
      expect(localLogs[0].message).toBe('Silent error');
      expect(localLogs[0].context?.token).toBe('[REDACTED]');

      // Enable opt-in
      setCrashReportingEnabled(true);
      expect(isCrashReportingEnabled()).toBe(true);

      const enReport = reportCrash(new Error('Opted-in error'));
      expect(enReport).not.toBeNull();
      expect(enReport?.message).toBe('Opted-in error');

      // Cleanup
      setCrashReportingEnabled(false);
      clearCrashReports();
    });
  });

  describe('P13.4: Security Verification (HTML Sanitization & No Raw Script Injection)', () => {
    it('safeHtml parses external HTML into React nodes safely without script execution', () => {
      const maliciousHtml = `
        <div>
          <p>Valid text</p>
          <script>window.__pwned = true;</script>
          <img src="x" onerror="window.__pwned = true;" />
        </div>
      `;

      const result = safeHtml(maliciousHtml);
      render(<div data-testid="safe-container">{result}</div>);

      const container = screen.getByTestId('safe-container');
      expect(container.textContent).toContain('Valid text');
      // Scripts are not rendered as executable elements
      expect(container.querySelector('script')).toBeNull();
      expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    });
  });
});
