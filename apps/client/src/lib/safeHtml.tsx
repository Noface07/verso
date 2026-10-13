import React, { type ReactNode } from 'react';

const ALLOWED_TAGS = new Set([
  'p', 'b', 'i', 'strong', 'em', 'br', 'span', 'ul', 'ol', 'li',
  'blockquote', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div',
]);

function domNodeToReact(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const el = node as Element;
  const tagName = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tagName)) {
    // Render text content of disallowed wrapper tags without dangerous markup
    return Array.from(el.childNodes).map((child, idx) =>
      domNodeToReact(child, `${key}-${idx}`),
    );
  }

  const children = Array.from(el.childNodes).map((child, idx) =>
    domNodeToReact(child, `${key}-${idx}`),
  );

  if (tagName === 'br') {
    return <br key={key} />;
  }

  if (tagName === 'a') {
    const rawHref = el.getAttribute('href') || '';
    let safeHref = '';
    try {
      const parsed = new URL(rawHref, 'http://localhost');
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        safeHref = rawHref;
      }
    } catch {
      // Invalid URL
    }

    return (
      <a
        key={key}
        href={safeHref || undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent)] underline hover:opacity-80 transition-opacity"
      >
        {children}
      </a>
    );
  }

  return React.createElement(tagName, { key }, children);
}

/**
 * Safely parse external HTML using DOMParser and convert to React elements.
 * Adheres to rule 5: Never use dangerouslySetInnerHTML.
 */
export function safeHtml(html: string | undefined | null): ReactNode {
  if (!html) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const nodes = Array.from(doc.body.childNodes);
    return nodes.map((n, idx) => domNodeToReact(n, `safe-${idx}`));
  } catch {
    return html;
  }
}
