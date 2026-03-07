declare module "semver" {
  export function valid(version: string): string | null;
  export function satisfies(version: string, range: string): boolean;
  export function lte(version: string, compared: string): boolean;
  export function gt(version: string, compared: string): boolean;

  const semver: {
    valid: typeof valid;
    satisfies: typeof satisfies;
    lte: typeof lte;
    gt: typeof gt;
  };

  export default semver;
}
