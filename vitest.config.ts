import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    // No test may reach the real API, even when the developer's shell has a key. Tests that want AI inject a fake model.
    // An exported HOST (zsh sets it to the machine name) must not change where a test server binds.
    env: { ANTHROPIC_API_KEY: '', HOST: '' },
  },
});
