export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  silent: true,
  testMatch: ['**/__tests__/**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@tautracker/moodle-client$': '<rootDir>/../../packages/moodle-client/src/index.ts',
    '^webextension-polyfill$': '<rootDir>/__tests__/__mocks__/webextensionPolyfill.ts',
    '^(.*/)?fsaHandleStore(?:\\.js)?$': '<rootDir>/__tests__/__mocks__/fsaHandleStore.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.test.json',
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
};
