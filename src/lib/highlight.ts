/**
 * Lazy Shiki highlighter for the small inline code editors (the element HTML
 * editor and the CSS-mode Code view). Returns Shiki's `<pre class="shiki">…</pre>`
 * markup; the consumer overlays it behind a transparent textarea and overrides
 * the background (see `CodeOverlayEditor`).
 *
 * The heavier per-file CodeViewer keeps its own highlighter; this one is scoped
 * to the inline editors' languages.
 */

export type HighlightLang = 'html' | 'css';

let highlighterPromise: Promise<import('shiki').Highlighter> | null = null;

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({ themes: ['github-dark'], langs: ['html', 'css'] })
    );
  }
  return highlighterPromise;
}

/** Highlight code to Shiki `<pre>` markup (github-dark). */
export async function highlightCode(code: string, lang: HighlightLang): Promise<string> {
  const hl = await getHighlighter();
  return hl.codeToHtml(code, { lang, theme: 'github-dark' });
}
