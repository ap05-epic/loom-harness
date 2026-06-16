/** A `<%@ taglib %>` declaration. */
export type JspTaglib = { uri: string; prefix: string };

/** A single form input recovered from a JSP (Struts html: tags). */
export type JspFormField = {
  /** The html: tag local name — text | password | select | textarea | checkbox | radio | hidden | file. */
  tag: string;
  property: string;
  /** Option values, for select fields. */
  options?: string[];
};

export type JspForm = {
  action: string;
  method: string;
  fields: JspFormField[];
};

export type JspIterate = { name: string; type: string };

/** What the cartographer recovers from one JSP file. */
export type JspInfo = {
  taglibs: JspTaglib[];
  /** Direct includes (`<%@ include file %>` and `<jsp:include page>`). */
  includes: string[];
  forms: JspForm[];
  /** Action targets referenced for navigation (html:link / html:rewrite / html:forward). */
  links: string[];
  iterations: JspIterate[];
};

const FIELD_TAGS = 'text|password|textarea|checkbox|radio|hidden|file';

function attr(source: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(source);
  return m ? m[1] : undefined;
}

function taglibs(jsp: string): JspTaglib[] {
  const out: JspTaglib[] = [];
  for (const m of jsp.matchAll(/<%@\s*taglib\b([^%]*?)%>/g)) {
    const uri = attr(m[1]!, 'uri');
    const prefix = attr(m[1]!, 'prefix');
    if (uri && prefix) out.push({ uri, prefix });
  }
  return out;
}

function includes(jsp: string): string[] {
  const out: string[] = [];
  for (const m of jsp.matchAll(/<%@\s*include\b[^%]*?\bfile\s*=\s*["']([^"']+)["']/g))
    out.push(m[1]!);
  for (const m of jsp.matchAll(/<jsp:include\b[^>]*?\bpage\s*=\s*["']([^"']+)["']/g))
    out.push(m[1]!);
  return out;
}

function fields(body: string): JspFormField[] {
  const found: { index: number; field: JspFormField }[] = [];
  const simple = new RegExp(
    `<html:(${FIELD_TAGS})\\b([^>]*?)\\bproperty\\s*=\\s*["']([^"']+)["']`,
    'g',
  );
  for (const m of body.matchAll(simple)) {
    found.push({ index: m.index, field: { tag: m[1]!, property: m[3]! } });
  }
  for (const m of body.matchAll(/<html:select\b([^>]*)>([\s\S]*?)<\/html:select>/g)) {
    const property = attr(m[1]!, 'property');
    if (!property) continue;
    const options = [...m[2]!.matchAll(/<html:option\b[^>]*?\bvalue\s*=\s*["']([^"']*)["']/g)].map(
      (o) => o[1]!,
    );
    found.push({ index: m.index, field: { tag: 'select', property, options } });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.field);
}

function forms(jsp: string): JspForm[] {
  const out: JspForm[] = [];
  for (const m of jsp.matchAll(/<html:form\b([^>]*)>([\s\S]*?)<\/html:form>/g)) {
    const action = attr(m[1]!, 'action');
    if (!action) continue;
    out.push({
      action,
      method: (attr(m[1]!, 'method') ?? 'post').toLowerCase(),
      fields: fields(m[2]!),
    });
  }
  return out;
}

function links(jsp: string): string[] {
  const out: string[] = [];
  for (const m of jsp.matchAll(
    /<html:(?:link|rewrite|forward)\b[^>]*?\baction\s*=\s*["']([^"']+)["']/g,
  )) {
    out.push(m[1]!);
  }
  return out;
}

function iterations(jsp: string): JspIterate[] {
  const out: JspIterate[] = [];
  for (const m of jsp.matchAll(/<logic:iterate\b([^>]*)>/g)) {
    const name = attr(m[1]!, 'name');
    const type = attr(m[1]!, 'type');
    if (name && type) out.push({ name, type });
  }
  return out;
}

/**
 * Recover the structure of a legacy JSP — taglibs, includes, Struts forms and
 * their fields, navigation links, and table iterations. Regex-based and
 * dependency-free: a focused custom parser for the specific JSP/Struts-taglib
 * constructs the cartographer cares about (no full grammar needed).
 */
export function parseJsp(content: string): JspInfo {
  return {
    taglibs: taglibs(content),
    includes: includes(content),
    forms: forms(content),
    links: links(content),
    iterations: iterations(content),
  };
}
