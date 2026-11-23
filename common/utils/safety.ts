export const SAFETY_CATEGORIES = [
  'violence',
  'terrorism',
  'abuse',
  'sexual_offences',
  'harassment',
  'csam',
  'child_abuse',
  'suicidal',
  'homicidal',
] as const;

export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

const CATEGORY_PATTERNS: Record<SafetyCategory, RegExp[]> = {
  violence: [/\b(kill|murder|assault|stab|shoot|attack|beat up|bloodshed)\b/i],
  terrorism: [/\b(terrorist|terrorism|bomb|explosive|mass shooting|jihad)\b/i],
  abuse: [/\b(abuse|abusive|torture|molest)\b/i],
  sexual_offences: [/\b(rape|sexual assault|sexually assault|molest)\b/i],
  harassment: [/\b(harass|harassment|stalk|stalking|threaten)\b/i],
  csam: [/\b(csam|child sexual abuse material|child porn|cp)\b/i],
  child_abuse: [/\b(child abuse|abuse a child|hurt a child)\b/i],
  suicidal: [/\b(suicide|suicidal|kill myself|end my life|self[- ]harm|want to die)\b/i],
  homicidal: [/\b(kill (him|her|them|someone)|murder (him|her|them|someone))\b/i],
};

export const detectSafetyCategories = (text: string): SafetyCategory[] => {
  const found = new Set<SafetyCategory>();
  for (const category of SAFETY_CATEGORIES) {
    if (CATEGORY_PATTERNS[category].some((pattern) => pattern.test(text))) {
      found.add(category);
    }
  }
  return [...found];
};

export const SUICIDE_SUPPORT_MESSAGE = `I'm really sorry you're feeling this way. You deserve support right now.

If you're in the U.S., please call or text **988** to reach the Suicide & Crisis Lifeline. If you're outside the U.S., contact your local emergency services or a crisis hotline immediately. If you think you might act on these thoughts soon, call emergency services or go to the nearest emergency department.

Please also reach out to someone you trust and let them know you need help.`;