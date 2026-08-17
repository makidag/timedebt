import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the same build works at a GitHub Pages project subpath
// (https://user.github.io/repo/) and at the domain root.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
