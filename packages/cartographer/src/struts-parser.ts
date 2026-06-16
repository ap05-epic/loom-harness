import { XMLParser } from 'fast-xml-parser';

export type StrutsForward = { name: string; path: string; redirect: boolean };
export type StrutsAction = {
  path: string;
  type?: string;
  name?: string;
  scope?: string;
  validate?: boolean;
  input?: string;
  forwards: StrutsForward[];
};
export type StrutsFormBean = { name: string; type: string };
export type StrutsConfig = {
  formBeans: StrutsFormBean[];
  actions: StrutsAction[];
  globalForwards: { name: string; path: string }[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // struts-config has a DOCTYPE; fast-xml-parser ignores it by default.
});

/** Coerce a fast-xml-parser node (object | array | undefined) into an array. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

type AttrNode = Record<string, unknown>;
const attr = (node: AttrNode, name: string): string | undefined => {
  const v = node[`@_${name}`];
  return v === undefined ? undefined : String(v);
};

/** Parse a Struts 1.x `struts-config.xml` into a structured model (pure). */
export function parseStrutsConfig(xml: string): StrutsConfig {
  const root = (parser.parse(xml) as Record<string, AttrNode>)['struts-config'] ?? {};

  const formBeans = asArray<AttrNode>(
    (root['form-beans'] as AttrNode | undefined)?.['form-bean'] as
      | AttrNode
      | AttrNode[]
      | undefined,
  ).map((fb) => ({ name: attr(fb, 'name') ?? '', type: attr(fb, 'type') ?? '' }));

  const globalForwards = asArray<AttrNode>(
    (root['global-forwards'] as AttrNode | undefined)?.['forward'] as
      | AttrNode
      | AttrNode[]
      | undefined,
  ).map((f) => ({ name: attr(f, 'name') ?? '', path: attr(f, 'path') ?? '' }));

  const actions = asArray<AttrNode>(
    (root['action-mappings'] as AttrNode | undefined)?.['action'] as
      | AttrNode
      | AttrNode[]
      | undefined,
  ).map((a) => {
    const forwards = asArray<AttrNode>(a['forward'] as AttrNode | AttrNode[] | undefined).map(
      (f) => ({
        name: attr(f, 'name') ?? '',
        path: attr(f, 'path') ?? '',
        redirect: attr(f, 'redirect') === 'true',
      }),
    );
    const validate = attr(a, 'validate');
    return {
      path: attr(a, 'path') ?? '',
      type: attr(a, 'type'),
      name: attr(a, 'name'),
      scope: attr(a, 'scope'),
      validate: validate === undefined ? undefined : validate === 'true',
      input: attr(a, 'input'),
      forwards,
    };
  });

  return { formBeans, actions, globalForwards };
}
