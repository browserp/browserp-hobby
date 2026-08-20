const normalize = (value) => String(value ?? "").normalize("NFKC").trim();

const spamSignals = [
  /free\s+(coins?|nitro|currency)/i,
  /guaranteed\s+(players?|members?|money)/i,
  /(click|join)\s+(immediately|now){1,}/i,
  /(.)\1{9,}/,
  /https?:\/\/(?:bit\.ly|tinyurl\.com|t\.co)\//i
];

const unsafeLinkSignals = [
  /discord(?:app)?\.gift/i,
  /(?:login|verify)[-.]discord/i,
  /(?:password|token|recovery)[^\n]{0,24}(?:send|share|paste)/i
];

const blockedProfileNameWords = new Set([
  "fuck", "fucker", "fucking", "shit", "cunt", "bitch",
  "porn", "porno", "nude", "nudes", "rape", "rapist",
  "pedo", "paedo", "pedophile", "paedophile",
  "nigger", "nigga", "faggot"
]);

function leetNormalise(value) {
  return value.toLocaleLowerCase("en-GB")
    .replaceAll("0", "o").replaceAll("1", "i").replaceAll("3", "e")
    .replaceAll("4", "a").replaceAll("5", "s").replaceAll("7", "t")
    .replaceAll("@", "a").replaceAll("$", "s").replaceAll("!", "i");
}

export function assessDisplayName(value) {
  const name = sanitizePlainText(value, 48);
  if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name)) {
    return { allowed: false, value: name, reason: "Use between 2 and 48 letters or numbers." };
  }

  const lowered = leetNormalise(name);
  const words = lowered.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const compact = lowered.replace(/[^a-z0-9]+/g, "");
  const externalContact = /(?:https?:\/\/|www\.|discord\.(?:gg|com\/invite)|@\s*(?:everyone|here))/i.test(name);
  const highRiskEvasion = /(nigger|nigga|faggot|pedophile|paedophile)/.test(compact);
  const impersonation = /browserp(?:admin|staff|owner|support|official)|(?:admin|staff|owner|support|official)browserp|discord(?:admin|staff|support|moderator|official)/.test(compact);

  if (externalContact || highRiskEvasion || impersonation || words.some((word) => blockedProfileNameWords.has(word))) {
    return { allowed: false, value: name, reason: "That display name contains unsafe, explicit or impersonating wording." };
  }
  return { allowed: true, value: name, reason: null };
}

export function assessContent(fields) {
  const text = Object.values(fields).map(normalize).join("\n");
  const reasons = [];
  let score = 0;

  if (text.length > 8_000) {
    score += 35;
    reasons.push("Content exceeds the normal review length.");
  }

  if (spamSignals.some((pattern) => pattern.test(text))) {
    score += 35;
    reasons.push("Promotional or spam-like language needs review.");
  }

  if (unsafeLinkSignals.some((pattern) => pattern.test(text))) {
    score += 90;
    reasons.push("A link or credential-request pattern is high risk.");
  }

  const urls = text.match(/https?:\/\/[^\s]+/gi) || [];
  if (urls.length > 5) {
    score += 25;
    reasons.push("Unusually high number of links.");
  }

  const confidence = score >= 85
    ? "blocked"
    : score >= 65
      ? "high_risk"
      : score >= 35
        ? "review_recommended"
        : score >= 15
          ? "likely_safe"
          : "safe";

  return {
    confidence,
    score: Math.min(score, 100),
    reasons,
    action: confidence === "blocked" ? "reject" : confidence === "safe" ? "accept" : "queue"
  };
}

export function sanitizePlainText(value, maxLength = 500) {
  return normalize(value)
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, maxLength)
    .trim();
}
