module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  // The two layers under a coverage target. Barrels and the test
  // doubles are excluded: re-exports and fixtures inflate a figure without
  // saying anything about the code under test.
  collectCoverageFrom: ['domain/**/*.ts', 'application/**/*.ts', '!**/index.ts'],
  coverageDirectory: '../coverage',
  coverageThreshold: {
    './src/domain/': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/application/': { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
