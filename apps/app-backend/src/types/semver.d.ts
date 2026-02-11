declare module "semver" {
  export function valid(version: string): string | null;
  export function satisfies(version: string, range: string): boolean;

  const semver: {
    valid: typeof valid;
    satisfies: typeof satisfies;
  };

  export default semver;
}
