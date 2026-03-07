import type { Config } from 'jest';

const config: Config = {
  projects: [
    // Backend tests
    {
      displayName: 'backend',
      testMatch: ['<rootDir>/packages/backend/src/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
      },
      testEnvironment: 'node',
      moduleNameMapper: {
        '^@backstage-docs/(.*)$': '<rootDir>/plugins/$1/src',
      },
    },
    // Plugin docs-hub tests
    {
      displayName: 'plugin-docs-hub',
      testMatch: ['<rootDir>/plugins/plugin-docs-hub/src/**/*.test.{ts,tsx}'],
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
      },
      testEnvironment: 'jsdom',
      moduleNameMapper: {
        '^@backstage-docs/(.*)$': '<rootDir>/plugins/$1/src',
      },
    },
    // Plugin docs-module tests
    {
      displayName: 'plugin-docs-module',
      testMatch: ['<rootDir>/plugins/plugin-docs-module/src/**/*.test.{ts,tsx}'],
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
      },
      testEnvironment: 'jsdom',
      moduleNameMapper: {
        '^@backstage-docs/(.*)$': '<rootDir>/plugins/$1/src',
      },
      setupFilesAfterSetup: [],
    },
  ],
};

export default config;
