export function getStoredPreferencesVersionInfo(source) {
  const versionUnion = source.match(/type StoredPreferences = \{\s*version:\s*([^;]+);/)?.[1];
  const currentVersionText = source.match(/const payload: StoredPreferences = \{\s*version:\s*(\d+),\s*preferences\s*\}/)?.[1];
  const migrationVersionText = source.match(/stored\.version !==\s*(\d+)/)?.[1];
  return {
    supportedVersions: versionUnion?.split("|").map((value) => Number(value.trim())) ?? [],
    currentVersion: Number(currentVersionText),
    migrationVersion: Number(migrationVersionText),
  };
}
