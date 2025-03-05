module.exports = {
  preset: 'jest-playwright-preset',
  testEnvironment: 'jest-playwright-preset',
  setupFiles: ['./jest.setup.js'], // Ensure this path is correct
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
};
