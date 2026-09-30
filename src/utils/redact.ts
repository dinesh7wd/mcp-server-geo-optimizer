const SECRET_PARAMS = new Set(["key", "access_token", "token", "api_key", "apikey"]);
const SECRET_PARAM_PATTERN = /([?&](?:key|access_token|token|api_key|apikey)=)[^&#\s"'\\]*/gi;
const URL_CREDENTIALS_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@"'\\]+@/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(SECRET_PARAM_PATTERN, "$1REDACTED")
    .replace(URL_CREDENTIALS_PATTERN, "$1REDACTED@");
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username !== "" || parsed.password !== "") {
      parsed.username = "REDACTED";
      parsed.password = "";
    }
    for (const name of [...parsed.searchParams.keys()]) {
      if (SECRET_PARAMS.has(name.toLowerCase())) {
        parsed.searchParams.set(name, "REDACTED");
      }
    }
    return parsed.toString();
  } catch {
    return redactSecrets(url);
  }
}
