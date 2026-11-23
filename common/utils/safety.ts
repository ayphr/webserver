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
  violence: [
    /\b(kill|murder|assault|stab|shoot|attack|beat(?:\s+up)?|bloodshed|harm|hurt|wound|maim|slaughter)\b/i,
  ],
  terrorism: [
    /\b(terror(?:ist|ism)?|bomb(?:ing)?|explosive|mass\s+shooting|jihad|extremist)\b/i,
  ],
  abuse: [/\b(abuse|abusive|torture|molest(?:ation)?|cruelty)\b/i],
  sexual_offences: [/\b(rape|sexual\s+assault|sexually\s+assault|molest(?:ation)?)\b/i],
  harassment: [/\b(harass(?:ment)?|stalk(?:ing)?|threaten(?:ing)?|bully(?:ing)?|intimidat(?:e|ion))\b/i],
  csam: [/\b(csam|child\s+sexual\s+abuse\s+material|child\s+porn(?:ography)?|\bcp\b)\b/i],
  child_abuse: [/\b(child\s+abuse|abuse\s+(?:a|the)\s+child|hurt\s+(?:a|the)\s+child|molest\s+(?:a|the)\s+child)\b/i],
  suicidal: [
    /\b(suicid(?:e|al)|kill\s+myself|end\s+my\s+life|end\s+it\s+all|want\s+to\s+die|don'?t\s+want\s+to\s+live|no\s+reason\s+to\s+live|self[-\s]?harm|take\s+my\s+own\s+life|better\s+off\s+dead|can'?t\s+go\s+on)\b/i,
  ],
  homicidal: [/\b(kill\s+(?:him|her|them|someone|people)|murder\s+(?:him|her|them|someone|people))\b/i],
};

export const isSafeForContext = (text: string): boolean => {
  const categories = detectSafetyCategories(text);
  return !categories.some((category) =>
    ['violence', 'terrorism', 'abuse', 'sexual_offences', 'harassment', 'csam', 'child_abuse', 'homicidal'].includes(category),
  );
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

export const SAFETY_REFUSAL_MESSAGE = `I can't help with violence, threats, abuse, sexual harm, or anything involving children. I can help with safety planning, de-escalation, reporting resources, or support options instead.`;

export const CSAM_ZERO_TOLERANCE_MESSAGE = `I can't engage with or provide any content involving child sexual abuse material or the exploitation of minors. If you've encountered suspected CSAM, report it to the appropriate authorities (in the U.S., NCMEC's CyberTipline) and local law enforcement.`;