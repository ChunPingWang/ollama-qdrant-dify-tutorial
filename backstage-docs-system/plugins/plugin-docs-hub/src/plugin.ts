import {
  createPlugin,
  createRoutableExtension,
  createApiFactory,
  discoveryApiRef,
} from '@backstage/core-plugin-api';
import { docsHubApiRef, DocsHubClient } from './api/docsHubApi';
import { rootRouteRef } from './routes';

export const docsHubPlugin = createPlugin({
  id: 'docs-hub',
  routes: {
    root: rootRouteRef,
  },
  apis: [
    createApiFactory({
      api: docsHubApiRef,
      deps: { discoveryApi: discoveryApiRef },
      factory: ({ discoveryApi }) =>
        new DocsHubClient({
          baseUrl: discoveryApi.getBaseUrl('docs-hub') as unknown as string,
        }),
    }),
  ],
});

export const DocsHubPage = docsHubPlugin.provide(
  createRoutableExtension({
    name: 'DocsHubPage',
    component: () =>
      import('./components/DocsHubPage').then((m) => m.DocsHubPage),
    mountPoint: rootRouteRef,
  }),
);
