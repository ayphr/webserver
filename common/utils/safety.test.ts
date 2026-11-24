import { describe, expect, it } from 'bun:test';
import {
  detectSafetyCategories,
  noticeForSafetyCategories,
  safeContentForNotice,
  shouldShortCircuitPrompt,
} from './safety';

describe('safety detection', () => {
  it('does not refuse benign technical or support language', () => {
    expect(detectSafetyCategories('Please kill the process before restarting the server.')).toEqual([]);
    expect(detectSafetyCategories('Let us attack the problem from a different angle.')).toEqual([]);
    expect(detectSafetyCategories('We offer substance abuse recovery resources.')).toEqual([]);
    expect(detectSafetyCategories('We are looking for ways to prevent child abuse.')).toEqual([]);
  });

  it('still detects real threats and self-harm', () => {
    expect(detectSafetyCategories('I want to kill myself')).toContain('suicidal');
    expect(detectSafetyCategories('Someone wants to kill her')).toContain('homicidal');
    expect(detectSafetyCategories('They shared csam')).toContain('csam');
    expect(detectSafetyCategories('The plan is to bomb the building')).toContain('terrorism');
  });

  it('lets suicidal intent dominate co-occurring violence', () => {
    expect(noticeForSafetyCategories(['suicidal', 'violence', 'homicidal'])).toBe('crisis');
    expect(noticeForSafetyCategories(['homicidal', 'violence'])).toBe('refusal');
  });

  it('keeps explicit child exploitation as the highest priority', () => {
    expect(noticeForSafetyCategories(['suicidal', 'csam', 'violence'])).toBe('csam');
    expect(noticeForSafetyCategories(['suicidal', 'child_abuse'])).toBe('csam');
  });

  it('only short-circuits prompts that produce a safety notice', () => {
    expect(shouldShortCircuitPrompt(detectSafetyCategories('I want to end it all'))).toBe(true);
    expect(shouldShortCircuitPrompt(detectSafetyCategories('Summarize my devices'))).toBe(false);
  });

  it('provides canned safe content for every notice', () => {
    expect(safeContentForNotice('crisis')).toContain('988');
    expect(safeContentForNotice('csam')).toContain('NCMEC');
    expect(safeContentForNotice('refusal')).toContain("I can't help");
  });
});
