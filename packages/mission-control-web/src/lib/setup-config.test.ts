import { describe, expect, test } from 'vitest';
import { genConfig, looksLikeValueNotName, type SetupData } from './setup-config';

const base: SetupData = {
  projectName: 'BAA-Test-3',
  appType: 'struts',
  strutsConfig: '/home/devpod/app/WEB-INF/struts-config.xml',
  baseUrl: 'http://localhost:8080/BAA/',
  startPath: 'jsp/login.jsp',
  provider: 'openai',
  model: 'gpt-5.4',
  apiKeyEnv: 'LLM_API_KEY',
  baseUrlEnv: 'LLM_BASE_URL',
};

describe('genConfig', () => {
  test('emits a schema-valid config referencing env-var NAMES (never the secret values)', () => {
    const c = genConfig(base);
    expect(c).toContain('project: BAA-Test-3');
    expect(c).toContain('driver: openai');
    expect(c).toContain('model: gpt-5.4');
    expect(c).toContain('apiKeyEnv: LLM_API_KEY');
    expect(c).toContain('baseUrlEnv: LLM_BASE_URL');
    expect(c).toContain('strutsConfig: /home/devpod/app/WEB-INF/struts-config.xml');
    expect(c).toContain('baseUrl: http://localhost:8080/BAA/');
    expect(c).toContain('startPath: jsp/login.jsp');
  });

  test('omits empty optional sections', () => {
    const c = genConfig({ ...base, strutsConfig: '', baseUrl: '', startPath: '' });
    expect(c).not.toContain('source:');
    expect(c).not.toContain('app:');
    expect(c).not.toContain('crawl:');
    expect(c).toContain('project: BAA-Test-3'); // the llm block still lands
  });
});

describe('looksLikeValueNotName', () => {
  test('flags a URL pasted into an env-var-name field', () => {
    expect(looksLikeValueNotName('https://x.openai.azure.com/openai/v1/')).toBe(true);
  });
  test('flags an actual key (an sk- prefix)', () => {
    expect(looksLikeValueNotName('sk-fake-not-a-real-key')).toBe(true);
  });
  test('flags a value with whitespace', () => {
    expect(looksLikeValueNotName('my key')).toBe(true);
  });
  test('accepts a normal env-var name (and empty = no warning)', () => {
    expect(looksLikeValueNotName('LLM_API_KEY')).toBe(false);
    expect(looksLikeValueNotName('OPENAI_BASE_URL')).toBe(false);
    expect(looksLikeValueNotName('')).toBe(false);
  });
});
