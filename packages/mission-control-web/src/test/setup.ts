// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument) on Vitest's `expect`,
// and lets React Testing Library auto-clean the DOM between tests (Vitest globals are on).
import '@testing-library/jest-dom/vitest';
