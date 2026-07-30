export type FlowTrackRole = "owner" | "member";

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function roleForIdentity(
  email: string,
  configuredOwnerEmail: string | null,
  fallbackRole: FlowTrackRole,
): FlowTrackRole {
  const ownerEmail = configuredOwnerEmail
    ? normalizeEmail(configuredOwnerEmail)
    : "";

  if (!ownerEmail) return fallbackRole;
  return normalizeEmail(email) === ownerEmail ? "owner" : "member";
}
