import { describe, expect, it } from 'bun:test';
import { getSafeRedirect, stripInviteParam, withInviteParam } from './redirects';

describe('getSafeRedirect', () => {
  it('allows known internal paths', () => {
    expect(getSafeRedirect('/dashboard')).toBe('/dashboard');
    expect(getSafeRedirect('/dashboard/devices/42?tab=logs')).toBe('/dashboard/devices/42?tab=logs');
    expect(getSafeRedirect('/link')).toBe('/link');
    expect(getSafeRedirect('/policies')).toBe('/policies');
  });

  it('rejects external, encoded and malformed redirects', () => {
    expect(getSafeRedirect('https://evil.com')).toBe('/dashboard');
    expect(getSafeRedirect('//evil.com')).toBe('/dashboard');
    expect(getSafeRedirect('/%2f%2fevil.com')).toBe('/dashboard');
    expect(getSafeRedirect('/dashboard/../../evil')).toBe('/dashboard');
    expect(getSafeRedirect('/dashboard\\evil.com')).toBe('/dashboard');
    expect(getSafeRedirect('/settings')).toBe('/dashboard');
  });

  it('falls back to a safe custom path, never an unsafe one', () => {
    expect(getSafeRedirect(null, '/link')).toBe('/link');
    expect(getSafeRedirect('http://evil.com', '//evil.com')).toBe('/dashboard');
  });
});

describe('invite query param helpers', () => {
  it('adds, replaces and removes the invite token without losing other params', () => {
    const path = '/dashboard/team?tab=members#audit';
    const withToken = withInviteParam(path, 'abc 123');
    expect(withToken).toBe('/dashboard/team?tab=members&invite=abc+123#audit');
    expect(withInviteParam(withToken, 'new')).toBe('/dashboard/team?tab=members&invite=new#audit');
    expect(withInviteParam(withToken, 'abc 123')).toBe(withToken);
    expect(stripInviteParam(withToken)).toBe('/dashboard/team?tab=members#audit');
    expect(stripInviteParam(path)).toBe(path);
  });

  it('handles paths without a query string or hash', () => {
    expect(withInviteParam('/dashboard', 'token')).toBe('/dashboard?invite=token');
    expect(stripInviteParam('/dashboard?invite=token')).toBe('/dashboard');
  });
});
