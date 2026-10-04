function plainRichText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function answerCandidates(answerHtml: string) {
  const answer = plainRichText(answerHtml);
  const withoutQualifier = answer.replace(/\s*(?:\([^)]*\)|\[[^\]]*\])\s*$/, "").trim();
  const withoutInfinitive = withoutQualifier.replace(/^to\s+/i, "").trim();
  return Array.from(new Set([answer, withoutQualifier, withoutInfinitive].filter((value) => value.length > 0)))
    .sort((a, b) => b.length - a.length);
}

export function maskExampleAnswer(exampleHtml: string, answerHtml: string) {
  for (const candidate of answerCandidates(answerHtml)) {
    const expression = escapeRegExp(candidate).replace(/\s+/g, "\\s+");
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${expression}(?=$|[^\\p{L}\\p{N}])`, "giu");
    let changed = false;
    const masked = exampleHtml
      .split(/(<[^>]+>)/g)
      .map((part) => {
        if (part.startsWith("<")) return part;
        return part.replace(pattern, (_match, prefix: string) => {
          changed = true;
          return `${prefix}*`;
        });
      })
      .join("");
    if (changed) return masked;
  }
  return exampleHtml;
}

export function splitInlineExample(value: string) {
  const marker = /\s+(?:Example|Esempio)\s*:\s*(.+)$/i.exec(value);
  if (!marker || marker.index <= 0) return { back: value.trim(), example: "" };
  return {
    back: value.slice(0, marker.index).trim(),
    example: marker[1].trim(),
  };
}
