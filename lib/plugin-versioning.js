function parseVersionPart(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parsePluginVersion(version) {
  const text = String(version || "0.0.0").trim();
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!match) return null;
  return {
    major: parseVersionPart(match[1]),
    minor: parseVersionPart(match[2]),
    patch: parseVersionPart(match[3]),
    prerelease: match[4] || "",
    raw: text,
  };
}

function comparePrerelease(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const left = a.split(".");
  const right = b.split(".");
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l) ? Number.parseInt(l, 10) : null;
    const rn = /^\d+$/.test(r) ? Number.parseInt(r, 10) : null;
    if (ln !== null && rn !== null && ln !== rn) return ln > rn ? 1 : -1;
    if (ln !== null && rn === null) return -1;
    if (ln === null && rn !== null) return 1;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

export function comparePluginVersions(a, b) {
  const left = parsePluginVersion(a);
  const right = parsePluginVersion(b);
  if (!left && !right) return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true });
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function semverGte(a, b) {
  return comparePluginVersions(a, b) >= 0;
}

export function isVersionCompatible(appVersion, compatibility = {}) {
  const minAppVersion = compatibility?.minAppVersion;
  if (!minAppVersion) return true;
  return semverGte(appVersion || "0.0.0", minAppVersion);
}

export function sortVersionRecordsDesc(records = []) {
  return [...records].sort((a, b) => comparePluginVersions(b?.version, a?.version));
}
