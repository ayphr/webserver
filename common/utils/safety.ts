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

export type SafetyNotice = 'refusal' | 'crisis' | 'csam';

const CATEGORY_PATTERNS: Record<SafetyCategory, RegExp[]> = {
  violence: [
    /\b(kill|kills|killing|murder|assault|stab|shoot|attack|beat(?:\s+up)?|bloodshed|harm|hurt|wound|maim|slaughter)\b/i,
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

/**
 * Everyday phrases that look like moderation keywords but describe technical
 * work, problem solving, or support resources. They are blanked (rather than
 * removed) before pattern matching so neighbouring words cannot join together.
 */
const BENIGN_PHRASES: RegExp[] = [
  /\bkill\s+(?:the|this|that|your|my|a|an)\s+(?:process(?:es)?|task|job|server|service|app|application|program|daemon|thread|session|connection|lights?|power|switch|timer|build|test|command|window|music|sound|video|notification|alert|script|container|pod|request|session)\b/gi,
  /\bkill\s+(?:all|any)\s+(?:processes|tasks|jobs|sessions|connections)\b/gi,
  /\bkill\s+two\s+birds\b/gi,
  /\battack\s+(?:the|this|that|your|my|a|an)\s+(?:problem|task|issue|bug|challenge|goal|workload|question|assignment|project|deadline|conversion|traffic|market|angle)\b/gi,
  /\bsubstance\s+abuse\b/gi,
  /\b(?:alcohol|drug|prescription)\s+abuse\s+(?:prevention|treatment|recovery|awareness|screening|resources?|services?|program|support)\b/gi,
  /\babuse\s+(?:prevention|awareness|recovery|treatment|screening|advocacy|hotline|resources?|program|services?|counseling)\b/gi,
  /\b(?:child\s+abuse\s+(?:prevention|awareness|resources?|services?|hotline|advocacy|reporting)|prevent(?:ing)?\s+child\s+abuse)\b/gi,
  /\bshoot\s+for\b/gi,
  /\bbeat\s+(?:the|your|a)\s+(?:deadline|clock|record|target|time)\b/gi,
];

const withoutBenignPhrases = (text: string): string =>
  BENIGN_PHRASES.reduce(
    (result, pattern) => result.replace(pattern, (match) => ' '.repeat(match.length)),
    text,
  );

export const isSafeForContext = (text: string): boolean => {
  const categories = detectSafetyCategories(text);
  return !categories.some((category) =>
    ['violence', 'terrorism', 'abuse', 'sexual_offences', 'harassment', 'csam', 'child_abuse', 'homicidal'].includes(category),
  );
};

export const detectSafetyCategories = (text: string): SafetyCategory[] => {
  const found = new Set<SafetyCategory>();
  const candidate = withoutBenignPhrases(text);
  for (const category of SAFETY_CATEGORIES) {
    if (CATEGORY_PATTERNS[category].some((pattern) => pattern.test(candidate))) {
      found.add(category);
    }
  }
  return [...found];
};

/**
 * Chooses the single card the user should see. Suicidal intent outranks
 * co-occurring violence or homicidal wording: those phrases often describe the
 * same crisis. Explicit child exploitation always takes priority.
 */
export const noticeForSafetyCategories = (
  categories: readonly (SafetyCategory | string)[],
): SafetyNotice | undefined => {
  if (categories.includes('csam') || categories.includes('child_abuse')) return 'csam';
  if (categories.includes('suicidal')) return 'crisis';
  if (categories.some((category) => category !== 'suicidal')) return 'refusal';
  return undefined;
};

/** High-risk prompts are answered locally, without a provider call or charges. */
export const shouldShortCircuitPrompt = (categories: readonly SafetyCategory[]): boolean =>
  noticeForSafetyCategories(categories) !== undefined;

export const SUICIDE_SUPPORT_MESSAGE = `I'm really sorry you're feeling this way. You deserve support right now.

If you're in the U.S., please call or text **988** to reach the Suicide & Crisis Lifeline. If you're outside the U.S., contact your local emergency services or a crisis hotline immediately. If you think you might act on these thoughts soon, call emergency services or go to the nearest emergency department.

Please also reach out to someone you trust and let them know you need help.`;

export const SAFETY_REFUSAL_MESSAGE = `I can't help with violence, threats, abuse, sexual harm, or anything involving children. I can help with safety planning, de-escalation, reporting resources, or support options instead.`;

export const CSAM_ZERO_TOLERANCE_MESSAGE = `I can't engage with or provide any content involving child sexual abuse material or the exploitation of minors. If you've encountered suspected CSAM, report it to the appropriate authorities (in the U.S., NCMEC's CyberTipline) and local law enforcement.`;

/** Server-authored response stored with the safety card, at zero credit cost. */
export const safeContentForNotice = (notice: SafetyNotice): string => {
  if (notice === 'crisis') return SUICIDE_SUPPORT_MESSAGE;
  if (notice === 'csam') return CSAM_ZERO_TOLERANCE_MESSAGE;
  return SAFETY_REFUSAL_MESSAGE;
};
