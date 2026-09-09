import type { ReactNode } from 'react';

/**
 * The generator descriptions are the only prose in the product written as
 * Markdown, and they only ever use paragraphs, bold and italic. A full Markdown
 * parser would be a dependency and an injection surface for the sake of three
 * constructs, so this handles exactly those three and nothing else. Anything it
 * does not understand is rendered as the literal text it is.
 */
export function renderProse(markdown: string): ReactNode[] {
  return markdown
    .trim()
    .split(/\n{2,}/)
    .map((para, i) => <p key={i}>{inline(para.replace(/\n/g, ' '))}</p>);
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={m.index}>{m[1]}</strong>);
    else out.push(<em key={m.index}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
