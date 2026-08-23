/**
 * A deliberately small markdown renderer for the three legal documents.
 *
 * Why not a dependency: this renders exactly three files we author ourselves,
 * and the alternative — transcribing the copy into JSX — creates a second
 * version that drifts from the one a human lawyer actually reviewed. Keeping
 * the markdown authoritative is the point (§8).
 *
 * Supported subset, which is all the legal copy uses: ATX headings, paragraphs,
 * unordered lists, blockquotes, pipe tables, horizontal rules, and inline
 * `code`, **bold**, *italic* and [links](…). Anything else renders as text.
 *
 * Input is repo-authored, never user-supplied, and every value goes through
 * React's normal escaping — there is no dangerouslySetInnerHTML here.
 */
import { Fragment, type ReactNode } from 'react';
import { Link } from './router';

type Block =
  | { k: 'h'; level: number; text: string }
  | { k: 'p'; text: string }
  | { k: 'ul'; items: string[] }
  | { k: 'quote'; lines: string[] }
  | { k: 'table'; head: string[]; rows: string[][] }
  | { k: 'hr' };

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ k: 'p', text: para.join(' ') });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      blocks.push({ k: 'h', level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push({ k: 'hr' });
      continue;
    }

    // Pipe table: a header row followed by a divider row.
    if (trimmed.includes('|') && isTableDivider(lines[i + 1] ?? '')) {
      flushPara();
      const head = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').trim().includes('|')) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      i--;
      blocks.push({ k: 'table', head, rows });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        quote.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i++;
      }
      i--;
      blocks.push({ k: 'quote', lines: quote.filter(Boolean) });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, '').trim());
        i++;
      }
      i--;
      blocks.push({ k: 'ul', items });
      continue;
    }

    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

/** Inline spans: `code`, **bold**, *italic*, [text](href). */
export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;

  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${n++}`;

    if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-ink/10 px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const [, label, href] = link;
      out.push(
        href!.startsWith('/') ? (
          <Link key={key} to={href!} className="underline underline-offset-2">
            {label}
          </Link>
        ) : (
          <a key={key} href={href} className="underline underline-offset-2" rel="noreferrer">
            {label}
          </a>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const H_CLASS: Record<number, string> = {
  1: 'font-display text-3xl font-extrabold mt-2',
  2: 'font-display text-xl font-extrabold mt-8',
  3: 'font-display text-base font-extrabold mt-6',
};

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.k) {
          case 'h': {
            const Tag = (`h${Math.min(b.level, 6)}` as unknown) as 'h2';
            return (
              <Tag key={i} className={H_CLASS[b.level] ?? 'font-bold mt-4'}>
                {renderInline(b.text, `h${i}`)}
              </Tag>
            );
          }
          case 'p':
            return (
              <p key={i} className="opacity-85">
                {renderInline(b.text, `p${i}`)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 opacity-85">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `l${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'quote':
            return (
              <blockquote key={i} className="rounded-2xl border-l-4 border-fanta bg-ink/5 px-4 py-3 text-sm opacity-90">
                {b.lines.map((l, j) => (
                  <p key={j}>{renderInline(l, `q${i}-${j}`)}</p>
                ))}
              </blockquote>
            );
          case 'table':
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-sm">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} className="border-b-2 border-ink/20 px-2 py-2 text-left font-bold">
                          {renderInline(h, `th${i}-${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="border-b border-ink/10 px-2 py-2 align-top opacity-85">
                            {renderInline(c, `td${i}-${j}-${k}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'hr':
            return <hr key={i} className="my-6 border-ink/15" />;
          default:
            return <Fragment key={i} />;
        }
      })}
    </div>
  );
}
