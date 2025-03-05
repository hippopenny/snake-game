export default {
  testEnvironment: 'jsdom',
  transform: {},
  testMatch: ['**/__tests__/**/*.test.js'],
  preset: 'jest-playwright-preset',
  moduleNameMapper: {
    '@playwright/test': '<rootDir>/node_modules/@playwright/test'
  }
};
