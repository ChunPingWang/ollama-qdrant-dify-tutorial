import {
  createPlugin,
  createRoutableExtension,
  createApiFactory,
  discoveryApiRef,
} from '@backstage/core-plugin-api';
import { docsModuleApiRef, DocsModuleClient } from './api/docsModuleApi';
import { rootRouteRef } from './routes';

export const docsModulePlugin = createPlugin({
  id: 'docs-module',
  routes: {
    root: rootRouteRef,
  },
  apis: [
    createApiFactory({
      api: docsModuleApiRef,
      deps: { discoveryApi: discoveryApiRef },
      factory: ({ discoveryApi }) =>
        new DocsModuleClient({
          baseUrl: discoveryApi.getBaseUrl('docs-module') as unknown as string,
        }),
    }),
  ],
});

export const DocsModulePage = docsModulePlugin.provide(
  createRoutableExtension({
    name: 'DocsModulePage',
    component: () =>
      import('./components/DocsModulePage').then((m) => m.DocsModulePage),
    mountPoint: rootRouteRef,
  }),
);
