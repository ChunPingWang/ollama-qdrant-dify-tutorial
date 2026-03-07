import React, { PropsWithChildren } from 'react';
import {
  Sidebar,
  SidebarDivider,
  SidebarGroup,
  SidebarItem,
  SidebarPage,
  SidebarSpace,
  useSidebarOpenState,
} from '@backstage/core-components';
import MenuIcon from '@material-ui/icons/Menu';
import SearchIcon from '@material-ui/icons/Search';
import LibraryBooksIcon from '@material-ui/icons/LibraryBooks';
import StorageIcon from '@material-ui/icons/Storage';
import CategoryIcon from '@material-ui/icons/Category';

export const Root = ({ children }: PropsWithChildren<{}>) => (
  <SidebarPage>
    <Sidebar>
      <SidebarGroup label="Menu" icon={<MenuIcon />}>
        <SidebarItem icon={LibraryBooksIcon} to="/docs-hub" text="文件中心" />
        <SidebarDivider />
        <SidebarItem icon={SearchIcon} to="/docs-hub" text="全域搜尋" />
        <SidebarDivider />
        {/* 模組快捷入口（可依 app-config 動態產生） */}
        <SidebarItem
          icon={CategoryIcon}
          to="/docs-module/microservices"
          text="微服務模式"
        />
        <SidebarItem
          icon={StorageIcon}
          to="/docs-module/banking"
          text="銀行架構"
        />
        <SidebarItem
          icon={CategoryIcon}
          to="/docs-module/devops"
          text="DevOps"
        />
      </SidebarGroup>
      <SidebarSpace />
    </Sidebar>
    {children}
  </SidebarPage>
);
