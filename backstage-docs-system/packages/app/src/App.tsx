import React from 'react';
import { Route } from 'react-router-dom';
import { createApp } from '@backstage/app-defaults';
import { FlatRoutes } from '@backstage/core-app-api';
import {
  AlertDisplay,
  OAuthRequestDialog,
  SignInPage,
} from '@backstage/core-components';
import { AppRouter } from '@backstage/core-app-api';
import { DocsHubPage } from '@backstage-docs/plugin-docs-hub';
import { DocsModulePage } from '@backstage-docs/plugin-docs-module';
import { Root } from './components/Root';

const app = createApp({
  components: {
    SignInPage: (props) => <SignInPage {...props} auto providers={['guest']} />,
  },
});

/**
 * Backstage App 路由設定
 *
 * /docs-hub          -> 中央文件管理首頁（跨模組搜尋、模組總覽）
 * /docs-module/:id   -> 個別模組頁面（文件列表、上傳、模組內搜尋）
 */
const routes = (
  <FlatRoutes>
    <Route path="/" element={<DocsHubPage />} />
    <Route path="/docs-hub" element={<DocsHubPage />} />
    <Route path="/docs-module/:moduleId" element={<DocsModulePage />} />
  </FlatRoutes>
);

export default app.createRoot(
  <>
    <AlertDisplay />
    <OAuthRequestDialog />
    <AppRouter>
      <Root>{routes}</Root>
    </AppRouter>
  </>,
);
