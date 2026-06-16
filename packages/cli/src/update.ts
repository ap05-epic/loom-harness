const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function parts(tag: string): [number, number, number] | null {
  const m = SEMVER_TAG.exec(tag);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemverTags(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

/**
 * Pick the tag `loom update` should move to: the explicit target if given
 * (must exist), otherwise the highest plain vX.Y.Z tag.
 */
export function resolveTargetTag(tags: string[], explicitTarget?: string): string {
  if (explicitTarget) {
    if (!tags.includes(explicitTarget)) {
      throw new Error(`Requested tag ${explicitTarget} does not exist in this repository`);
    }
    return explicitTarget;
  }
  const releases = tags.filter((t) => SEMVER_TAG.test(t)).sort(compareSemverTags);
  const latest = releases.at(-1);
  if (!latest) throw new Error('No release tags (vX.Y.Z) found — has a release been published?');
  return latest;
}
