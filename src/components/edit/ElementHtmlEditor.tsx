/**
 * Edit a selected element's source HTML by hand. Resolves the element to its
 * source markup span (open tag → close tag), shows it in a highlighted editor,
 * and writes the edited markup back on Save (drift-guarded against the resolved
 * baseline).
 *
 * Mounted keyed by the selection in the tree panel's Code view, so a new
 * selection remounts and re-resolves once.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '../primitives/Button';
import { CodeOverlayEditor } from './CodeOverlayEditor';
import { useOptionalToast } from '../../contexts/ToastContext';
import { resolveElementHtml, applyElementHtml } from '../../lib/edit-html';
import type { ElementSignature } from '../../lib/edit';

interface Props {
  projectPath: string;
  signature: ElementSignature;
}

export function ElementHtmlEditor({ projectPath, signature }: Props) {
  const { showToast } = useOptionalToast();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const baselineRef = useRef('');
  const sigRef = useRef(signature);
  sigRef.current = signature;

  // Resolve once on mount (the parent remounts on a new selection).
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    resolveElementHtml(projectPath, sigRef.current)
      .then((res) => {
        if (cancelled) return;
        baselineRef.current = res.html;
        setText(res.html);
        setStatus('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  if (status === 'loading') return <div className="ss-tree-panel__empty">Loading markup…</div>;
  if (status === 'error')
    return (
      <div className="ss-tree-html__error">
        This element can’t be edited as markup{error ? `: ${error}` : ''}.
      </div>
    );

  const dirty = text !== baselineRef.current;
  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await applyElementHtml(projectPath, sigRef.current, baselineRef.current, text);
      baselineRef.current = text;
      showToast('Markup saved', 'success');
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ss-tree-html">
      <CodeOverlayEditor value={text} onChange={setText} lang="html" />
      <div className="ss-tree-html__actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty}
          onClick={() => setText(baselineRef.current)}
        >
          Revert
        </Button>
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
