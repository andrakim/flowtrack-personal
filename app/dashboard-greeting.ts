type GreetingIdentity = {
  displayName?: string | null;
  email?: string | null;
  fullName?: string | null;
};

export function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 18) return "Добрый день";
  if (hour >= 18 && hour < 23) return "Добрый вечер";
  return "Доброй ночи";
}

export function greetingName(identity: GreetingIdentity) {
  const candidates = [identity.fullName, identity.displayName];

  for (const candidate of candidates) {
    const normalized = candidate?.trim().replace(/\s+/g, " ");
    if (!normalized || normalized.includes("@")) continue;
    return normalized.split(" ")[0];
  }

  return null;
}

export function dashboardGreeting(
  identity: GreetingIdentity,
  hour: number,
) {
  const greeting = greetingForHour(hour);
  const name = greetingName(identity);
  return name ? `${greeting}, ${name}` : greeting;
}
