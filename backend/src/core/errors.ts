export class Problem extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  value: unknown,
  code: string,
  message: string,
  status = 409,
): asserts value {
  if (!value) throw new Problem(status, code, message);
}
export const unavailable = (name: string) =>
  new Problem(
    503,
    "integration_unavailable",
    `${name} is not configured or available`,
  );
