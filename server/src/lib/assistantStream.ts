const FALLBACK_WORD = 'lorem';

const GIBBERISH_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
];

export const generateAssistantResponse = (): string => {
  const length = (8 + Math.floor(Math.random() * 12)) * 5;
  const words: string[] = [];
  for (let i = 0; i < length; i++) {
    words.push(GIBBERISH_WORDS[Math.floor(Math.random() * GIBBERISH_WORDS.length)] ?? FALLBACK_WORD);
  }
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
};

// Keep the leading space on every token after the first so the client can
// rebuild the response by appending tokens in order.
export const splitAssistantResponseIntoTokens = (text: string): string[] =>
  text.split(' ').map((word, index) => (index === 0 ? word : ` ${word}`));
