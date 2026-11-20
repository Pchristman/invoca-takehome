import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    // No test may reach the real API, even when the developer's shell has a key. Tests that want AI inject a fake model.
    env: { ANTHROPIC_API_KEY: '' },
  },
});
