export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/__tests__/**/*.test.js'],
  preset: 'jest-playwright-preset',
  moduleNameMapper: {
    '@playwright/test': '<rootDir>/node_modules/@playwright/test'
  }
};