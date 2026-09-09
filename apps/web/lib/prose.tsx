import type { ReactNode } from 'react';

/**
 * The generator descriptions are the only prose in the product that is written
 * as Markdown, and they only ever use paragraphs and bold. A full Markdown
 * parser would be a dependency and an XSS surface for the sake of two
 * constructs, so this handles exactly those two and nothing else.
 */
export function renderProse(markdown: string): ReactNode[] {
  return markdown
    .trim()
    .split(/\n{2,}/)
    .map((para, i) => <p key={i}>{inline(para.replace(/\n/g, ' '))}</p>);
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${m.index}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
