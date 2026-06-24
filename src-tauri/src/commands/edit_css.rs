//! # Visual editor — CSS Mode (class-based rule editing for HTML/CSS projects)
//!
//! A second style engine for the visual editor. Where the Tailwind path
//! (`edit.rs`) mutates the *class-attribute string* with utility tokens, CSS
//! Mode edits the **CSS rule** a class points at — `padding: 24px`, any
//! property, any value — and writes it surgically back into the stylesheet.
//!
//! ## Reliability via convention, not heroic parsing
//! We do not try to robustly handle arbitrary CSS. We narrow the input space to
//! a convention (external, class-based stylesheets; one rule per editable class;
//! a fixed `@media (min-width: …)` breakpoint set) and an out-of-band agent prep
//! prompt conforms off-spec projects into it. The engine here is therefore
//! **strict and fail-closed**: when the source doesn't match the convention it
//! returns a typed status (`Multiple`, `NotFound`, `Inline`, `NeedsClass`) and
//! refuses to guess — it never silently writes the wrong rule.
//!
//! ## Locator, not a parser
//! A heavyweight CSS parser reserializes whole files, which kills minimal-diff
//! edits and trashes formatting/comments. Instead we hand-roll a small,
//! comment/string/brace-aware locator that records, for each style rule, its
//! selector, the byte span of its declaration block, the source line, and the
//! enclosing `@media` prelude. Writes are then surgical span replacements,
//! preserving everything else byte-for-byte — the same philosophy as `i18n.rs`.
//!
//! See `docs/visual-editor-css-mode.md` for the full design and phasing.

use crate::commands::edit::Location;
use crate::errors::CommandError;
use crate::utils::validate_project_path;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Skip stylesheets larger than this (bytes) — almost certainly generated /
/// minified bundles, not hand-authored convention-conforming CSS.
const MAX_CSS_BYTES: u64 = 2 * 1024 * 1024;

/// How long a parsed-stylesheets snapshot stays fresh. Resolving runs on every
/// element select / edit; without this each one re-walks, re-reads, and re-parses
/// the whole project. Matches the Tailwind index TTL (`edit::INDEX_TTL`) so the
/// CSS editor is as snappy. Writes invalidate the entry so edits are seen at once.
const SHEET_CACHE_TTL: Duration = Duration::from_secs(10);

/// A discovered stylesheet with its rules pre-indexed. Caching the parsed rules
/// (not just the raw text) means a click resolves against memory — no re-walk,
/// re-read, or re-parse — the same shape as the Tailwind editor's `Arc`-cached
/// occurrence index.
#[derive(Clone)]
struct SheetIndex {
    rel: String,
    content: String,
    rules: Vec<RuleSpan>,
}

impl SheetIndex {
    fn parse(rel: String, content: String) -> Self {
        let rules = index_rules(&content);
        Self {
            rel,
            content,
            rules,
        }
    }
}

#[allow(clippy::type_complexity)]
static SHEET_CACHE: LazyLock<Mutex<HashMap<PathBuf, (Instant, Arc<Vec<SheetIndex>>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Parsed, cached stylesheets for `root`. Returns a cheap `Arc` clone on a hit;
/// only a cold miss walks + parses.
fn cached_sheets(root: &Path) -> Arc<Vec<SheetIndex>> {
    if let Ok(cache) = SHEET_CACHE.lock() {
        if let Some((at, sheets)) = cache.get(root) {
            if at.elapsed() < SHEET_CACHE_TTL {
                return sheets.clone();
            }
        }
    }
    let sheets = Arc::new(
        discover_stylesheets(root)
            .into_iter()
            .map(|(rel, content)| SheetIndex::parse(rel, content))
            .collect::<Vec<_>>(),
    );
    if let Ok(mut cache) = SHEET_CACHE.lock() {
        cache.insert(root.to_path_buf(), (Instant::now(), sheets.clone()));
    }
    sheets
}

/// Drop the cached snapshot for `root` after a write, so the next resolve reads
/// the just-saved CSS.
fn invalidate_sheet_cache(root: &Path) {
    if let Ok(mut cache) = SHEET_CACHE.lock() {
        cache.remove(root);
    }
}

// ───────────────────────────── Types ─────────────────────────────

/// A single CSS declaration (`property: value`), as reported to / from the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Declaration {
    pub property: String,
    pub value: String,
    #[serde(default)]
    pub important: bool,
}

/// Signature of the clicked element for CSS resolution. camelCase to match the
/// in-iframe selection script's `postMessage` payload.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CssSignature {
    /// The element's full `class` attribute (may hold several tokens).
    pub class_name: String,
    /// Lowercased DOM tag name (reserved for future disambiguation).
    #[serde(default)]
    pub tag_name: String,
    /// Which class token the user means to edit. When absent we pick the sole
    /// token, or the last one (the most specific by convention).
    #[serde(default)]
    pub target_class: Option<String>,
    /// Whether the element carries an inline `style="…"` attribute. Drives the
    /// `Inline` status (managed styling should live in a class, not inline).
    #[serde(default)]
    pub has_inline_style: bool,
    /// A pseudo-class / state to target, without the leading colon (e.g.
    /// "hover", "focus", "focus-visible"). Appended to the class selector so the
    /// editor resolves `.class:hover` — states ARE selectors in CSS.
    #[serde(default)]
    pub pseudo: Option<String>,
}

/// Whether a pseudo selector is safe to append (any state CSS allows — simple
/// `:hover`, functional `:nth-child(2n+1)`, `:not(.x)`, pseudo-elements
/// `::before`) while forbidding structural chars that could break out of the
/// selector (`{`, `}`, `;`). Must start with `:`, have balanced parens, and
/// contain a letter.
fn is_safe_pseudo(s: &str) -> bool {
    if !s.starts_with(':') {
        return false;
    }
    let mut depth = 0i32;
    let mut saw_alpha = false;
    for c in s.chars() {
        match c {
            ':' | '-' | '_' | '+' | '.' | '#' | '%' => {}
            // `,` and ` ` group/combine selectors — only legal inside a
            // functional pseudo (`:is(.a, .b)`, `:not(.x .y)`). At the top level
            // they'd break out of the appended selector.
            ',' | ' ' if depth > 0 => {}
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            c if c.is_ascii_alphanumeric() => {
                if c.is_ascii_alphabetic() {
                    saw_alpha = true;
                }
            }
            _ => return false,
        }
    }
    depth == 0 && saw_alpha
}

/// The sanitized pseudo suffix for a signature, or "" for the default state.
/// The pseudo may carry its own colon(s) (`::before`); a bare name gets one.
fn pseudo_suffix(sig: &CssSignature) -> String {
    match sig.pseudo.as_deref() {
        Some(p) => {
            let t = p.trim();
            if t.is_empty() {
                return String::new();
            }
            let with_colon = if t.starts_with(':') {
                t.to_string()
            } else {
                format!(":{t}")
            };
            if is_safe_pseudo(&with_colon) {
                with_colon
            } else {
                String::new()
            }
        }
        None => String::new(),
    }
}

/// Result of resolving an element to a CSS rule.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CssResolution {
    /// Exactly one rule defines this class at the requested breakpoint.
    Resolved {
        /// Project-relative POSIX stylesheet path.
        file: String,
        /// The class selector we resolved (e.g. `.hero-title`).
        selector: String,
        /// 1-based line of the rule's selector.
        line: usize,
        /// The `min-width` of the enclosing `@media`, if any.
        media_min_px: Option<u32>,
        /// The rule's current declarations.
        declarations: Vec<Declaration>,
    },
    /// The class is defined by more than one rule — read-only, never guessed.
    Multiple {
        selector: String,
        locations: Vec<Location>,
    },
    /// The element is styled via an inline `style` attribute, not a class.
    Inline { reason: String },
    /// The element has no class to anchor a rule to (offer "create class").
    NeedsClass { reason: String },
    /// The class exists but no rule defines it yet (offer "create rule").
    NotFound { selector: String },
}

/// One located style rule and the byte span of its declaration block.
#[derive(Debug, Clone, PartialEq)]
struct RuleSpan {
    /// Full selector prelude, trimmed (may be a comma group).
    selector: String,
    /// `@media` prelude (e.g. `(min-width: 768px)`) if nested, else `None`.
    media: Option<String>,
    /// Byte offset just inside the opening `{`.
    block_inner_start: usize,
    /// Byte offset of the closing `}`.
    block_inner_end: usize,
    /// 1-based line of the selector.
    selector_line: usize,
}

/// A located declaration within a rule's block, with byte offsets into the
/// original stylesheet so edits can be surgical.
#[derive(Debug, Clone, PartialEq)]
struct DeclSpan {
    property: String,
    property_lc: String,
    /// First non-whitespace byte of the property name.
    decl_start: usize,
    /// First non-whitespace byte of the value.
    value_start: usize,
    /// Exclusive end of the value (trimmed; before any `;`).
    value_end: usize,
    /// Position just past the terminating `;`, or `value_end` if unterminated.
    decl_end: usize,
    /// Whether a `;` terminated this declaration.
    terminated: bool,
}

// ───────────────────────── Low-level helpers ─────────────────────────

/// 1-based line number of the given byte index.
fn line_of(src: &str, byte_idx: usize) -> usize {
    src.as_bytes()[..byte_idx.min(src.len())]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
        + 1
}

/// Leading whitespace of the line containing `pos`.
fn indent_of_line(src: &str, pos: usize) -> String {
    let bytes = src.as_bytes();
    let mut start = pos.min(bytes.len());
    while start > 0 && bytes[start - 1] != b'\n' {
        start -= 1;
    }
    let mut end = start;
    while end < bytes.len() && (bytes[end] == b' ' || bytes[end] == b'\t') {
        end += 1;
    }
    src[start..end].to_string()
}

/// Trim a byte range to its non-whitespace core, returning `(start, end)`.
fn trim_range(src: &str, mut start: usize, mut end: usize) -> (usize, usize) {
    let bytes = src.as_bytes();
    while start < end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    (start, end)
}

/// Remove `/* … */` comments from a string, preserving everything else
/// (including UTF-8 — cuts only on the ASCII comment delimiters).
fn strip_css_comments(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut seg = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            out.push_str(&s[seg..i]);
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            seg = i;
            continue;
        }
        i += 1;
    }
    out.push_str(&s[seg..]);
    out
}

/// Byte offset of the first non-whitespace, non-comment character in
/// `[start, end)` (used for a rule's true selector line).
fn first_significant(css: &str, start: usize, end: usize) -> usize {
    let bytes = css.as_bytes();
    let mut i = start;
    while i < end {
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if bytes[i] == b'/' && i + 1 < end && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < end && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(end);
            continue;
        }
        return i;
    }
    end
}

/// Extract the `min-width` pixel value from an `@media` prelude.
fn media_min_px(prelude: &str) -> Option<u32> {
    let low = prelude.to_ascii_lowercase();
    let idx = low.find("min-width")?;
    let after = &low[idx + "min-width".len()..];
    let after = after.split(':').nth(1)?;
    let digits: String = after
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Does a rule's media context match the requested breakpoint? Base edits
/// (`None`) match only un-mediated rules; a breakpoint edit matches only the
/// `@media` block with that exact `min-width`.
fn media_matches(media: &Option<String>, bp: Option<u32>) -> bool {
    match (media, bp) {
        (None, None) => true,
        (Some(m), Some(px)) => media_min_px(m) == Some(px),
        _ => false,
    }
}

/// Does a (possibly comma-grouped) selector contain `target` as one of its
/// parts exactly? Strictness is intentional — descendant/compound selectors
/// don't match, so we never edit a rule that also styles other elements
/// implicitly.
fn selector_has_part(selector: &str, target: &str) -> bool {
    selector.split(',').any(|p| p.trim() == target)
}

// ───────────────────────────── Locator ─────────────────────────────

/// Index every top-level (and single-level `@media`-nested) style rule in a
/// stylesheet. Comments, strings, `@keyframes`/`@font-face`/`@supports` bodies,
/// and nested blocks are skipped rather than mis-read as rules.
fn index_rules(css: &str) -> Vec<RuleSpan> {
    enum Frame {
        Media(String),
        /// Any at-rule we don't index into (keyframes, font-face, supports) or a
        /// nested/malformed block.
        Other,
        /// A style rule; payload is its index in `rules`.
        Rule(usize),
    }

    let bytes = css.as_bytes();
    let n = bytes.len();
    let mut rules: Vec<RuleSpan> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut prelude_start = 0usize;
    let mut i = 0usize;

    while i < n {
        let c = bytes[i];

        // Comment
        if c == b'/' && i + 1 < n && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < n && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(n);
            continue;
        }
        // String
        if c == b'"' || c == b'\'' {
            i += 1;
            while i < n && bytes[i] != c {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            i = (i + 1).min(n);
            continue;
        }

        if c == b'{' {
            let prelude_clean = strip_css_comments(&css[prelude_start..i]);
            let prelude = prelude_clean.trim();
            let inside_rule = matches!(stack.last(), Some(Frame::Rule(_)));
            let inside_other = stack.iter().any(|f| matches!(f, Frame::Other));

            if inside_rule || inside_other {
                stack.push(Frame::Other);
            } else if let Some(rest) = prelude.strip_prefix('@') {
                if rest.to_ascii_lowercase().starts_with("media") {
                    let media_prelude = rest["media".len()..].trim().to_string();
                    stack.push(Frame::Media(media_prelude));
                } else {
                    stack.push(Frame::Other);
                }
            } else if !prelude.is_empty() {
                let media = stack.iter().rev().find_map(|f| match f {
                    Frame::Media(m) => Some(m.clone()),
                    _ => None,
                });
                let selector_line = line_of(css, first_significant(css, prelude_start, i));
                let idx = rules.len();
                rules.push(RuleSpan {
                    selector: prelude.to_string(),
                    media,
                    block_inner_start: i + 1,
                    block_inner_end: i + 1,
                    selector_line,
                });
                stack.push(Frame::Rule(idx));
            } else {
                stack.push(Frame::Other);
            }
            i += 1;
            prelude_start = i;
            continue;
        }

        if c == b'}' {
            if let Some(Frame::Rule(idx)) = stack.pop() {
                rules[idx].block_inner_end = i;
            }
            i += 1;
            prelude_start = i;
            continue;
        }

        i += 1;
    }

    rules
}

/// Locate every declaration inside a rule's block `[inner_start, inner_end)`,
/// with byte offsets into the original stylesheet.
fn locate_declarations(css: &str, inner_start: usize, inner_end: usize) -> Vec<DeclSpan> {
    let bytes = css.as_bytes();
    let mut out = Vec::new();
    let mut seg_start = inner_start;
    let mut i = inner_start;
    let mut depth = 0i32;

    let flush = |seg_start: usize, seg_end: usize, terminated: bool, out: &mut Vec<DeclSpan>| {
        let (ds, de) = trim_range(css, seg_start, seg_end);
        if ds >= de {
            return;
        }
        // Find the property/value colon, ignoring strings/parens.
        let seg = &css.as_bytes()[ds..de];
        let mut colon: Option<usize> = None;
        let mut d = 0i32;
        let mut j = 0usize;
        while j < seg.len() {
            let ch = seg[j];
            if ch == b'"' || ch == b'\'' {
                j += 1;
                while j < seg.len() && seg[j] != ch {
                    if seg[j] == b'\\' {
                        j += 1;
                    }
                    j += 1;
                }
                j += 1;
                continue;
            }
            match ch {
                b'(' => d += 1,
                b')' => d -= 1,
                b':' if d == 0 => {
                    colon = Some(ds + j);
                    break;
                }
                _ => {}
            }
            j += 1;
        }
        let Some(colon) = colon else { return };
        let (vs, ve) = trim_range(css, colon + 1, de);
        if vs >= ve {
            return;
        }
        let property = css[ds..colon].trim().to_string();
        let decl_end = if terminated {
            (seg_end + 1).min(inner_end)
        } else {
            ve
        };
        out.push(DeclSpan {
            property_lc: property.to_ascii_lowercase(),
            property,
            decl_start: ds,
            value_start: vs,
            value_end: ve,
            decl_end,
            terminated,
        });
    };

    while i < inner_end {
        let c = bytes[i];
        if c == b'/' && i + 1 < inner_end && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < inner_end && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(inner_end);
            continue;
        }
        if c == b'"' || c == b'\'' {
            i += 1;
            while i < inner_end && bytes[i] != c {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            i = (i + 1).min(inner_end);
            continue;
        }
        match c {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b';' if depth == 0 => {
                flush(seg_start, i, true, &mut out);
                seg_start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    flush(seg_start, inner_end, false, &mut out);
    out
}

/// Parse a rule block into `Declaration`s (with `!important` split out of value).
fn declarations_in(css: &str, rule: &RuleSpan) -> Vec<Declaration> {
    locate_declarations(css, rule.block_inner_start, rule.block_inner_end)
        .into_iter()
        .map(|d| {
            let raw = css[d.value_start..d.value_end].trim();
            let (value, important) = match raw.to_ascii_lowercase().rfind("!important") {
                Some(idx) => (raw[..idx].trim().to_string(), true),
                None => (raw.to_string(), false),
            };
            Declaration {
                property: d.property,
                value,
                important,
            }
        })
        .collect()
}

// ─────────────────────── Surgical declaration write ───────────────────────

/// Set, add, or remove (`value: None`) a single declaration inside the rule
/// block `[inner_start, inner_end)`, preserving all surrounding formatting.
fn set_declaration_in_block(
    css: &str,
    inner_start: usize,
    inner_end: usize,
    property: &str,
    value: Option<&str>,
) -> String {
    let decls = locate_declarations(css, inner_start, inner_end);
    let prop_lc = property.to_ascii_lowercase();
    let existing = decls.iter().find(|d| d.property_lc == prop_lc);

    match (existing, value) {
        // Update an existing declaration's value in place. Preserve a trailing
        // `!important` the UI doesn't round-trip (it tracks the flag separately
        // and sends only the value), so editing a property never silently drops
        // its importance.
        (Some(d), Some(v)) => {
            let existing = css[d.value_start..d.value_end].trim_end();
            let keep_important = existing.to_ascii_lowercase().ends_with("!important")
                && !v.to_ascii_lowercase().contains("!important");
            let mut out = String::with_capacity(css.len());
            out.push_str(&css[..d.value_start]);
            out.push_str(v);
            if keep_important {
                out.push_str(" !important");
            }
            out.push_str(&css[d.value_end..]);
            out
        }
        // Remove a declaration, taking its whole line with it.
        (Some(d), None) => {
            let bytes = css.as_bytes();
            // Back up over the indentation to the line start.
            let mut rs = d.decl_start;
            while rs > inner_start && (bytes[rs - 1] == b' ' || bytes[rs - 1] == b'\t') {
                rs -= 1;
            }
            // Swallow one trailing newline so we don't leave a blank line.
            let mut re = d.decl_end;
            while re < inner_end && (bytes[re] == b' ' || bytes[re] == b'\t') {
                re += 1;
            }
            if re < inner_end && bytes[re] == b'\n' {
                re += 1;
            } else if rs > inner_start && bytes[rs - 1] == b'\n' {
                // No trailing newline (last decl) — drop the leading one instead.
                rs -= 1;
            }
            let mut out = String::with_capacity(css.len());
            out.push_str(&css[..rs]);
            out.push_str(&css[re..]);
            out
        }
        // Append a new declaration after the last one.
        (None, Some(v)) => {
            if let Some(last) = decls.last() {
                let insert_at = last.decl_end;
                let indent = indent_of_line(css, last.decl_start);
                let mut ins = String::new();
                if !last.terminated {
                    ins.push(';');
                }
                ins.push('\n');
                ins.push_str(&indent);
                ins.push_str(property);
                ins.push_str(": ");
                ins.push_str(v);
                ins.push(';');
                let mut out = String::with_capacity(css.len() + ins.len());
                out.push_str(&css[..insert_at]);
                out.push_str(&ins);
                out.push_str(&css[insert_at..]);
                out
            } else {
                // Empty block — lay out a fresh multi-line body.
                let rule_indent = indent_of_line(css, inner_start);
                let decl_indent = format!("{rule_indent}  ");
                let body = format!("\n{decl_indent}{property}: {v};\n{rule_indent}");
                let mut out = String::with_capacity(css.len() + body.len());
                out.push_str(&css[..inner_start]);
                out.push_str(&body);
                out.push_str(&css[inner_end..]);
                out
            }
        }
        // Nothing to remove.
        (None, None) => css.to_string(),
    }
}

/// Render a new rule (optionally wrapped in an `@media` block) ready to append.
fn build_rule_text(selector: &str, declarations: &[Declaration], min_px: Option<u32>) -> String {
    let (base, decl_indent) = match min_px {
        Some(_) => ("  ", "    "),
        None => ("", "  "),
    };
    let mut body = String::new();
    body.push_str(base);
    body.push_str(selector);
    body.push_str(" {\n");
    for d in declarations {
        body.push_str(decl_indent);
        body.push_str(&d.property);
        body.push_str(": ");
        body.push_str(&d.value);
        if d.important {
            body.push_str(" !important");
        }
        body.push_str(";\n");
    }
    body.push_str(base);
    body.push('}');

    match min_px {
        Some(px) => format!("@media (min-width: {px}px) {{\n{body}\n}}"),
        None => body,
    }
}

// ───────────────────────── Resolution core (pure) ─────────────────────────

/// Pick the class token the user means to edit.
fn pick_class(sig: &CssSignature) -> Option<String> {
    if let Some(t) = sig.target_class.as_ref().map(|s| s.trim()) {
        if !t.is_empty() {
            return Some(t.trim_start_matches('.').to_string());
        }
    }
    let toks: Vec<&str> = sig.class_name.split_whitespace().collect();
    toks.last().map(|s| s.to_string())
}

/// Resolve against already-indexed stylesheets — the testable core of
/// [`resolve_css_rule`], free of filesystem and path validation. Filters the
/// pre-parsed rules (no re-parse), so a click is an in-memory scan.
fn resolve_in_sheets(sheets: &[SheetIndex], sig: &CssSignature, bp: Option<u32>) -> CssResolution {
    let class = match pick_class(sig) {
        Some(c) => c,
        None => {
            return if sig.has_inline_style {
                CssResolution::Inline {
                    reason: "styled inline; add a class to edit it as a rule".into(),
                }
            } else {
                CssResolution::NeedsClass {
                    reason: "no class to anchor a rule to".into(),
                }
            };
        }
    };
    let selector = format!(".{class}{}", pseudo_suffix(sig));

    let mut hits: Vec<(&str, &str, &RuleSpan)> = Vec::new();
    for sheet in sheets {
        for rule in &sheet.rules {
            if selector_has_part(&rule.selector, &selector) && media_matches(&rule.media, bp) {
                hits.push((sheet.rel.as_str(), sheet.content.as_str(), rule));
            }
        }
    }

    match hits.len() {
        0 => CssResolution::NotFound { selector },
        1 => {
            let (rel, content, rule) = &hits[0];
            CssResolution::Resolved {
                file: (*rel).to_string(),
                selector,
                line: rule.selector_line,
                media_min_px: rule.media.as_deref().and_then(media_min_px),
                declarations: declarations_in(content, rule),
            }
        }
        _ => CssResolution::Multiple {
            selector,
            locations: hits
                .iter()
                .map(|(rel, _, rule)| Location {
                    file: (*rel).to_string(),
                    line: rule.selector_line,
                    column: 1,
                })
                .collect(),
        },
    }
}

/// Apply a declaration edit to one stylesheet's source — the testable core of
/// [`set_css_declaration`]. Errors (fail-closed) when the rule can't be pinned
/// to a single block.
fn apply_declaration_to_source(
    src: &str,
    selector: &str,
    bp: Option<u32>,
    property: &str,
    value: Option<&str>,
) -> Result<String, CommandError> {
    let matches: Vec<RuleSpan> = index_rules(src)
        .into_iter()
        .filter(|r| selector_has_part(&r.selector, selector) && media_matches(&r.media, bp))
        .collect();

    match matches.len() {
        0 => Err(CommandError::Validation {
            field: "selector".into(),
            reason: "rule no longer matches — reselect the element".into(),
        }),
        1 => Ok(set_declaration_in_block(
            src,
            matches[0].block_inner_start,
            matches[0].block_inner_end,
            property,
            value,
        )),
        _ => Err(CommandError::Validation {
            field: "selector".into(),
            reason: "class is defined by multiple rules — not editable".into(),
        }),
    }
}

// ───────────────────────── Stylesheet discovery ─────────────────────────

/// Walk the project for hand-authored `.css` files (skipping build output and
/// oversized/minified bundles), returning `(project-relative POSIX path,
/// contents)` for each.
fn discover_stylesheets(root: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    // Use the `ignore` walker — it honors .gitignore and skips hidden/VCS dirs,
    // the same walker the source indexer uses (`edit::index_occurrences`). A
    // hand-rolled denylist can't know about `.vercel`, `.turbo`, `.svelte-kit`,
    // asset dumps, etc., so it descended into huge generated trees and made every
    // cache-miss resolve crawl on large projects.
    let walker = ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .build();
    for entry in walker.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("css") {
            continue;
        }
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_CSS_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        out.push((rel, content));
    }
    out
}

/// Resolve `file` to an absolute path proven to live inside `root`.
fn safe_join(root: &Path, file: &str) -> Result<std::path::PathBuf, CommandError> {
    let abs = root.join(file);
    let canon_root = root.canonicalize().map_err(CommandError::from)?;
    let canon_file = abs.canonicalize().map_err(CommandError::from)?;
    if !canon_file.starts_with(&canon_root) {
        return Err(CommandError::Validation {
            field: "file".into(),
            reason: "edit target is outside the project".into(),
        });
    }
    Ok(abs)
}

// ───────────────────────── Write validation ─────────────────────────
//
// Edits are written verbatim and surgically, so a value/property/selector that
// contains block-structure characters (a typo, or a paste) would break out of
// the rule and corrupt the stylesheet. The engine is fail-closed: refuse them
// rather than write something that silently destroys the file.

/// A CSS property name is a plain identifier (`padding`, `--brand-color`).
fn property_is_safe(property: &str) -> bool {
    let p = property.trim();
    !p.is_empty()
        && p.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A value is safe when it can't terminate the declaration or close the block:
/// `{`/`}` never appear outside a quoted string, and `;` only inside quotes or
/// parentheses (e.g. a `url(data:…;…)` or `content: ";"`). Unbalanced quotes or
/// parens are rejected too — they'd swallow following source.
fn value_is_safe(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut i = 0usize;
    let mut quote = 0u8;
    let mut depth = 0i32;
    while i < bytes.len() {
        let c = bytes[i];
        if quote != 0 {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == quote {
                quote = 0;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' | b'\'' => quote = c,
            b'(' => depth += 1,
            b')' => depth -= 1,
            b'{' | b'}' => return false,
            b';' if depth == 0 => return false,
            _ => {}
        }
        i += 1;
    }
    quote == 0 && depth == 0
}

/// Reject a property/value pair that would corrupt the stylesheet. `None` value
/// is a removal — only the property is checked.
fn validate_declaration(property: &str, value: Option<&str>) -> Result<(), CommandError> {
    if !property_is_safe(property) {
        return Err(CommandError::Validation {
            field: "property".into(),
            reason: format!("\"{property}\" isn't a valid CSS property name"),
        });
    }
    if let Some(v) = value {
        if !value_is_safe(v) {
            return Err(CommandError::Validation {
                field: "value".into(),
                reason: "value contains characters that would break the stylesheet".into(),
            });
        }
    }
    Ok(())
}

/// A selector written into a new rule must not carry block braces.
fn validate_selector(selector: &str) -> Result<(), CommandError> {
    if selector.trim().is_empty() || selector.contains('{') || selector.contains('}') {
        return Err(CommandError::Validation {
            field: "selector".into(),
            reason: "invalid selector".into(),
        });
    }
    Ok(())
}

// ───────────────────────────── Commands ─────────────────────────────

/// Resolve a clicked element to the CSS rule that styles its class, at the
/// given breakpoint (`None` = base). Returns a typed status the UI branches on.
#[tauri::command]
#[tracing::instrument(skip(signature), fields(project = %project_path))]
pub fn resolve_css_rule(
    project_path: String,
    signature: CssSignature,
    breakpoint_min_px: Option<u32>,
) -> Result<CssResolution, CommandError> {
    let root = validate_project_path(&project_path)?;
    let sheets = cached_sheets(&root);
    Ok(resolve_in_sheets(&sheets, &signature, breakpoint_min_px))
}

/// Surgically set (or remove, when `value` is `None`) one declaration on the
/// rule for `selector` at the given breakpoint. Fail-closed if the rule can't
/// be pinned to a single block.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path, file = %file, selector = %selector, property = %property))]
pub fn set_css_declaration(
    project_path: String,
    file: String,
    selector: String,
    breakpoint_min_px: Option<u32>,
    property: String,
    value: Option<String>,
) -> Result<(), CommandError> {
    validate_declaration(&property, value.as_deref())?;
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;
    let updated = apply_declaration_to_source(
        &src,
        &selector,
        breakpoint_min_px,
        &property,
        value.as_deref(),
    )?;
    if updated != src {
        std::fs::write(&abs, updated).map_err(CommandError::from)?;
        invalidate_sheet_cache(&root);
    }
    Ok(())
}

/// Append a new rule for `selector` (optionally inside an `@media` block) to the
/// authored stylesheet. The class-attribute attach on the element itself is
/// handled separately (Phase 2). Fail-closed if the rule already exists.
#[tauri::command]
#[tracing::instrument(skip(declarations), fields(project = %project_path, file = %file, selector = %selector))]
pub fn create_css_class(
    project_path: String,
    file: String,
    selector: String,
    declarations: Vec<Declaration>,
    breakpoint_min_px: Option<u32>,
) -> Result<(), CommandError> {
    validate_selector(&selector)?;
    for d in &declarations {
        validate_declaration(&d.property, Some(&d.value))?;
    }
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;

    let already = index_rules(&src).into_iter().any(|r| {
        selector_has_part(&r.selector, &selector) && media_matches(&r.media, breakpoint_min_px)
    });
    if already {
        return Err(CommandError::Validation {
            field: "selector".into(),
            reason: "a rule for this selector already exists".into(),
        });
    }

    let rule = build_rule_text(&selector, &declarations, breakpoint_min_px);
    let mut out = src.clone();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&rule);
    out.push('\n');
    std::fs::write(&abs, out).map_err(CommandError::from)?;
    invalidate_sheet_cache(&root);
    Ok(())
}

/// List hand-authored stylesheets in the project (project-relative POSIX
/// paths), so the UI can offer an authored-sheet target for new rules.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub fn list_stylesheets(project_path: String) -> Result<Vec<String>, CommandError> {
    let root = validate_project_path(&project_path)?;
    Ok(cached_sheets(&root).iter().map(|s| s.rel.clone()).collect())
}

/// Every class name referenced in any rule selector (`.foo .bar:hover` → foo,
/// bar). Powers the class bar's search-and-create combobox.
fn class_names_in(selector: &str) -> Vec<String> {
    let bytes = selector.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'.' {
            let start = i + 1;
            let mut j = start;
            while j < bytes.len()
                && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'-' || bytes[j] == b'_')
            {
                j += 1;
            }
            if j > start {
                out.push(selector[start..j].to_string());
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

/// All class names defined across the project's stylesheets, sorted & unique.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub fn list_css_classes(project_path: String) -> Result<Vec<String>, CommandError> {
    let root = validate_project_path(&project_path)?;
    let mut set = std::collections::BTreeSet::new();
    for sheet in cached_sheets(&root).iter() {
        for rule in &sheet.rules {
            for c in class_names_in(&rule.selector) {
                set.insert(c);
            }
        }
    }
    Ok(set.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(class: &str) -> CssSignature {
        CssSignature {
            class_name: class.to_string(),
            tag_name: "div".into(),
            target_class: None,
            has_inline_style: false,
            pseudo: None,
        }
    }

    /// Build the parsed sheet index `resolve_in_sheets` now takes.
    fn idx(list: Vec<(String, String)>) -> Vec<SheetIndex> {
        list.into_iter()
            .map(|(r, c)| SheetIndex::parse(r, c))
            .collect()
    }

    #[test]
    fn extracts_class_names_from_selectors() {
        assert_eq!(
            class_names_in(".hero .hero-title:hover"),
            vec!["hero", "hero-title"]
        );
        assert_eq!(class_names_in("section.cta > .btn"), vec!["cta", "btn"]);
        assert!(class_names_in("div > a:hover").is_empty());
    }

    #[test]
    fn pseudo_allows_functional_and_pseudo_elements() {
        let mut s = sig("x");
        s.pseudo = Some("nth-child(even)".into());
        assert_eq!(pseudo_suffix(&s), ":nth-child(even)");
        s.pseudo = Some("::before".into());
        assert_eq!(pseudo_suffix(&s), "::before");
        s.pseudo = Some(":not(.foo)".into());
        assert_eq!(pseudo_suffix(&s), ":not(.foo)");
        // Reject injection.
        s.pseudo = Some("hover{}body".into());
        assert_eq!(pseudo_suffix(&s), "");
    }

    #[test]
    fn pseudo_rejects_top_level_comma_and_space_but_allows_them_in_parens() {
        let mut s = sig("x");
        // Top-level comma/space would break out into a selector list.
        s.pseudo = Some("hover, .evil".into());
        assert_eq!(pseudo_suffix(&s), "");
        s.pseudo = Some("hover .evil".into());
        assert_eq!(pseudo_suffix(&s), "");
        // Inside a functional pseudo they're legal.
        s.pseudo = Some(":is(.a, .b)".into());
        assert_eq!(pseudo_suffix(&s), ":is(.a, .b)");
        s.pseudo = Some(":not(.x .y)".into());
        assert_eq!(pseudo_suffix(&s), ":not(.x .y)");
    }

    #[test]
    fn validates_property_and_value_against_block_break_out() {
        assert!(property_is_safe("padding"));
        assert!(property_is_safe("--brand-color"));
        assert!(!property_is_safe("color; }"));
        assert!(!property_is_safe(""));
        assert!(!property_is_safe("a:b"));

        assert!(value_is_safe("24px"));
        assert!(value_is_safe("rgba(0, 0, 0, 0.5)"));
        assert!(value_is_safe("url(data:image/svg+xml;base64,abc)")); // ; inside parens
        assert!(value_is_safe("\"a;b{c}\"")); // structural chars inside a string
        assert!(!value_is_safe("red }")); // closes the block
        assert!(!value_is_safe("red; .evil { color: blue")); // injects a rule
        assert!(!value_is_safe("\"unterminated")); // dangling quote
        assert!(!value_is_safe("rgb(0,0,0")); // unbalanced parens

        assert!(validate_declaration("color", Some("red }")).is_err());
        assert!(validate_declaration("color", Some("red")).is_ok());
        assert!(validate_declaration("color", None).is_ok());
        assert!(validate_selector(".hero:hover").is_ok());
        assert!(validate_selector(".hero { } .evil").is_err());
    }

    #[test]
    fn editing_a_value_preserves_existing_important() {
        let css = ".x {\n  color: red !important;\n}";
        let out = set_declaration_in_block(
            css,
            css.find('{').unwrap() + 1,
            css.rfind('}').unwrap(),
            "color",
            Some("blue"),
        );
        assert!(out.contains("color: blue !important;"), "got: {out}");
    }

    #[test]
    fn resolves_pseudo_class_rule() {
        let css = ".btn { color: red; }\n.btn:hover { color: blue; }";
        let sheets = idx(vec![("s.css".to_string(), css.to_string())]);
        let mut s = sig("btn");
        s.pseudo = Some("hover".into());
        match resolve_in_sheets(&sheets, &s, None) {
            CssResolution::Resolved {
                selector,
                declarations,
                ..
            } => {
                assert_eq!(selector, ".btn:hover");
                assert_eq!(declarations[0].value, "blue");
            }
            other => panic!("expected hover rule, got {other:?}"),
        }
        // Default state still resolves the base rule.
        match resolve_in_sheets(&sheets, &sig("btn"), None) {
            CssResolution::Resolved { selector, .. } => assert_eq!(selector, ".btn"),
            other => panic!("expected base rule, got {other:?}"),
        }
    }

    // ── Locator ──

    #[test]
    fn indexes_basic_rules() {
        let css = ".a { color: red; }\n.b { color: blue; }";
        let rules = index_rules(css);
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].selector, ".a");
        assert_eq!(rules[0].selector_line, 1);
        assert_eq!(rules[1].selector, ".b");
        assert_eq!(rules[1].selector_line, 2);
        assert!(rules[0].media.is_none());
    }

    #[test]
    fn indexes_media_nested_rules() {
        let css = ".a { color: red; }\n@media (min-width: 768px) {\n  .a { color: green; }\n}";
        let rules = index_rules(css);
        assert_eq!(rules.len(), 2);
        assert!(rules[0].media.is_none());
        assert_eq!(rules[1].media.as_deref(), Some("(min-width: 768px)"));
        assert_eq!(media_min_px(rules[1].media.as_deref().unwrap()), Some(768));
    }

    #[test]
    fn skips_keyframes_inner_blocks() {
        let css = "@keyframes spin { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }\n.real { color: red; }";
        let rules = index_rules(css);
        // Only `.real` is a style rule; the keyframe stops are not.
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].selector, ".real");
    }

    #[test]
    fn ignores_braces_in_comments_and_strings() {
        let css = "/* .fake { } */\n.real { content: \"}{\"; color: red; }";
        let rules = index_rules(css);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].selector, ".real");
        let decls = declarations_in(css, &rules[0]);
        assert_eq!(decls.len(), 2);
        assert_eq!(decls[0].property, "content");
        assert_eq!(decls[0].value, "\"}{\"");
    }

    #[test]
    fn grouped_selector_matches_each_part() {
        let css = ".a, .b { color: red; }";
        let rules = index_rules(css);
        assert!(selector_has_part(&rules[0].selector, ".a"));
        assert!(selector_has_part(&rules[0].selector, ".b"));
        assert!(!selector_has_part(&rules[0].selector, ".c"));
    }

    // ── Declarations ──

    #[test]
    fn parses_declarations_with_important_and_no_trailing_semicolon() {
        let css = ".a { color: red !important;\n  margin: 0 auto }";
        let rules = index_rules(css);
        let decls = declarations_in(css, &rules[0]);
        assert_eq!(decls.len(), 2);
        assert_eq!(decls[0].property, "color");
        assert_eq!(decls[0].value, "red");
        assert!(decls[0].important);
        assert_eq!(decls[1].property, "margin");
        assert_eq!(decls[1].value, "0 auto");
        assert!(!decls[1].important);
    }

    #[test]
    fn does_not_split_on_semicolons_inside_functions_or_strings() {
        let css = ".a { background: url(\"a;b.png\"); color: red; }";
        let rules = index_rules(css);
        let decls = declarations_in(css, &rules[0]);
        assert_eq!(decls.len(), 2);
        assert_eq!(decls[0].property, "background");
        assert_eq!(decls[0].value, "url(\"a;b.png\")");
    }

    // ── Surgical writes ──

    #[test]
    fn updates_existing_declaration_in_place() {
        let css = ".hero {\n  padding: 8px;\n  color: red;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "padding",
            Some("24px"),
        );
        assert_eq!(out, ".hero {\n  padding: 24px;\n  color: red;\n}");
    }

    #[test]
    fn property_match_is_case_insensitive() {
        let css = ".hero {\n  Padding: 8px;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "padding",
            Some("24px"),
        );
        assert_eq!(out, ".hero {\n  Padding: 24px;\n}");
    }

    #[test]
    fn appends_new_declaration_matching_indentation() {
        let css = ".hero {\n  padding: 8px;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "margin",
            Some("0 auto"),
        );
        assert_eq!(out, ".hero {\n  padding: 8px;\n  margin: 0 auto;\n}");
    }

    #[test]
    fn appends_into_empty_block() {
        let css = ".hero {}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "color",
            Some("red"),
        );
        assert_eq!(out, ".hero {\n  color: red;\n}");
    }

    #[test]
    fn appends_after_unterminated_last_declaration() {
        let css = ".hero {\n  padding: 8px\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "color",
            Some("red"),
        );
        assert_eq!(out, ".hero {\n  padding: 8px;\n  color: red;\n}");
    }

    #[test]
    fn removes_a_middle_declaration_cleanly() {
        let css = ".hero {\n  padding: 8px;\n  color: red;\n  margin: 0;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "color",
            None,
        );
        assert_eq!(out, ".hero {\n  padding: 8px;\n  margin: 0;\n}");
    }

    #[test]
    fn removing_absent_declaration_is_noop() {
        let css = ".hero {\n  padding: 8px;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "color",
            None,
        );
        assert_eq!(out, css);
    }

    // ── Resolution ──

    #[test]
    fn resolves_single_rule() {
        let sheets = idx(vec![(
            "styles.css".to_string(),
            ".hero { color: red; }".to_string(),
        )]);
        let res = resolve_in_sheets(&sheets, &sig("hero"), None);
        match res {
            CssResolution::Resolved {
                file,
                selector,
                declarations,
                ..
            } => {
                assert_eq!(file, "styles.css");
                assert_eq!(selector, ".hero");
                assert_eq!(declarations.len(), 1);
                assert_eq!(declarations[0].property, "color");
            }
            other => panic!("expected resolved, got {other:?}"),
        }
    }

    #[test]
    fn resolves_last_class_token_by_default() {
        let sheets = idx(vec![(
            "s.css".to_string(),
            ".card { color: red; }\n.card-title { font-weight: 700; }".to_string(),
        )]);
        let res = resolve_in_sheets(&sheets, &sig("card card-title"), None);
        match res {
            CssResolution::Resolved { selector, .. } => assert_eq!(selector, ".card-title"),
            other => panic!("expected resolved, got {other:?}"),
        }
    }

    #[test]
    fn duplicate_rules_resolve_to_multiple() {
        let sheets = idx(vec![
            ("a.css".to_string(), ".hero { color: red; }".to_string()),
            ("b.css".to_string(), ".hero { color: blue; }".to_string()),
        ]);
        let res = resolve_in_sheets(&sheets, &sig("hero"), None);
        match res {
            CssResolution::Multiple { locations, .. } => assert_eq!(locations.len(), 2),
            other => panic!("expected multiple, got {other:?}"),
        }
    }

    #[test]
    fn missing_rule_resolves_to_not_found() {
        let sheets = idx(vec![(
            "s.css".to_string(),
            ".other { color: red; }".to_string(),
        )]);
        let res = resolve_in_sheets(&sheets, &sig("hero"), None);
        assert_eq!(
            res,
            CssResolution::NotFound {
                selector: ".hero".into()
            }
        );
    }

    #[test]
    fn no_class_resolves_to_needs_class_or_inline() {
        let sheets: Vec<SheetIndex> = vec![];
        assert!(matches!(
            resolve_in_sheets(&sheets, &sig(""), None),
            CssResolution::NeedsClass { .. }
        ));
        let mut s = sig("");
        s.has_inline_style = true;
        assert!(matches!(
            resolve_in_sheets(&sheets, &s, None),
            CssResolution::Inline { .. }
        ));
    }

    #[test]
    fn breakpoint_resolves_into_matching_media_block() {
        let css =
            ".hero { color: red; }\n@media (min-width: 768px) {\n  .hero { color: green; }\n}";
        let sheets = idx(vec![("s.css".to_string(), css.to_string())]);

        let base = resolve_in_sheets(&sheets, &sig("hero"), None);
        match base {
            CssResolution::Resolved { declarations, .. } => {
                assert_eq!(declarations[0].value, "red")
            }
            other => panic!("expected base resolved, got {other:?}"),
        }
        let md = resolve_in_sheets(&sheets, &sig("hero"), Some(768));
        match md {
            CssResolution::Resolved {
                declarations,
                media_min_px,
                ..
            } => {
                assert_eq!(declarations[0].value, "green");
                assert_eq!(media_min_px, Some(768));
            }
            other => panic!("expected media resolved, got {other:?}"),
        }
    }

    // ── apply_declaration_to_source ──

    #[test]
    fn apply_to_source_updates_correct_media_layer() {
        let css =
            ".hero {\n  color: red;\n}\n@media (min-width: 768px) {\n  .hero {\n    color: green;\n  }\n}";
        let out = apply_declaration_to_source(css, ".hero", Some(768), "color", Some("blue"))
            .expect("edit applies");
        assert!(out.contains("color: red;")); // base untouched
        assert!(out.contains("color: blue;")); // media updated
        assert!(!out.contains("color: green;"));
    }

    #[test]
    fn apply_to_source_fails_closed_on_missing_rule() {
        let css = ".other { color: red; }";
        let err = apply_declaration_to_source(css, ".hero", None, "color", Some("blue"));
        assert!(matches!(err, Err(CommandError::Validation { .. })));
    }

    #[test]
    fn apply_to_source_fails_closed_on_ambiguous_rule() {
        let css = ".hero { color: red; }\n.hero { color: blue; }";
        let err = apply_declaration_to_source(css, ".hero", None, "color", Some("green"));
        assert!(matches!(err, Err(CommandError::Validation { .. })));
    }

    // ── build_rule_text ──

    #[test]
    fn builds_base_rule_text() {
        let decls = vec![
            Declaration {
                property: "color".into(),
                value: "red".into(),
                important: false,
            },
            Declaration {
                property: "padding".into(),
                value: "24px".into(),
                important: true,
            },
        ];
        let out = build_rule_text(".hero", &decls, None);
        assert_eq!(
            out,
            ".hero {\n  color: red;\n  padding: 24px !important;\n}"
        );
    }

    #[test]
    fn builds_media_wrapped_rule_text() {
        let decls = vec![Declaration {
            property: "color".into(),
            value: "red".into(),
            important: false,
        }];
        let out = build_rule_text(".hero", &decls, Some(768));
        assert_eq!(
            out,
            "@media (min-width: 768px) {\n  .hero {\n    color: red;\n  }\n}"
        );
    }
}
