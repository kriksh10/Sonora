import { Fragment, type ReactNode } from "react";

// Renders a small Markdown subset as React elements. Never injects HTML; links are shown as plain text.
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { t: "p"; v: string }
  | { t: "h"; v: string }
  | { t: "code"; v: string }
  | { t: "ul" | "ol"; v: string[] };

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) blocks.push({ t: "p", v: para.join("\n") }); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ t: "code", v: code.join("\n") });
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(l);
    if (h) { flush(); blocks.push({ t: "h", v: h[1] }); continue; }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.t === (ordered ? "ol" : "ul")) (prev as { v: string[] }).v.push(li[2]);
      else blocks.push({ t: ordered ? "ol" : "ul", v: [li[2]] });
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    para.push(l);
  }
  flush();
  return blocks;
}

export default function SafeMarkdown({ text, className = "", testId }: { text: string; className?: string; testId?: string }) {
  return (
    <div className={`lsv-md ${className}`} data-testid={testId}>
      {parse(text).map((b, i) => {
        const k = `b${i}`;
        if (b.t === "code") return <pre key={k}><code>{b.v}</code></pre>;
        if (b.t === "h") return <p key={k} className="lsv-md-h">{inline(b.v, k)}</p>;
        if (b.t === "ul") return <ul key={k}>{b.v.map((x, j) => <li key={j}>{inline(x, `${k}-${j}`)}</li>)}</ul>;
        if (b.t === "ol") return <ol key={k}>{b.v.map((x, j) => <li key={j}>{inline(x, `${k}-${j}`)}</li>)}</ol>;
        return <p key={k}>{String(b.v).split("\n").map((x, j) => <Fragment key={j}>{j > 0 && <br />}{inline(x, `${k}-${j}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}
