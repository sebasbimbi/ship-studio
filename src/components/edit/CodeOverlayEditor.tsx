/**
 * A textarea with live syntax highlighting — the standard "transparent textarea
 * over a highlighted <pre>" technique. The textarea owns editing + the caret;
 * the highlight layer (Shiki) sits behind it, scroll-synced, with the text drawn
 * transparent on top so the colors show through. Used by the element HTML editor
 * and the CSS-mode Code view.
 */

import { useEffect, useRef, useState } from 'react';
import { highlightCode, type HighlightLang } from '../../lib/highlight';

interface Props {
  value: string;
  onChange: (value: string) => void;
  lang: HighlightLang;
  className?: string;
  placeholder?: string;
}

export function CodeOverlayEditor({ value, onChange, lang, className, placeholder }: Props) {
  const [highlighted, setHighlighted] = useState('');
  const hlRef = useRef<HTMLDivElement>(null);

  // Re-highlight on every change (un-debounced so a just-typed character is never
  // briefly invisible — Shiki is fast on a small snippet once initialized; the
  // `is-plain` class keeps text visible before the first highlight loads).
  useEffect(() => {
    let cancelled = false;
    void highlightCode(value, lang)
      .then((html) => {
        if (!cancelled) setHighlighted(html);
      })
      .catch(() => {
        // Highlighting is non-essential — the textarea stays plain (is-plain).
      });
    return () => {
      cancelled = true;
    };
  }, [value, lang]);

  return (
    <div className={`ss-codeedit${className ? ` ${className}` : ''}`}>
      <div
        className="ss-codeedit__hl"
        aria-hidden
        ref={hlRef}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
      <textarea
        className={`ss-codeedit__area${highlighted ? '' : ' is-plain'}`}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          const el = hlRef.current;
          if (el) {
            el.scrollTop = e.currentTarget.scrollTop;
            el.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
      />
    </div>
  );
}
