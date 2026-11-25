import { Link } from "@tanstack/react-router";
import {
  SETTINGS_PAGE_PATHS,
  type SettingsLinkProps,
  type SettingsLinkTarget,
} from "./settings-page";

export function routerSettingsLink(target: SettingsLinkTarget, props: SettingsLinkProps) {
  switch (target.kind) {
    case "project":
      return (
        <Link
          to="/settings/projects/$connectionId/$projectId"
          params={{ connectionId: target.connectionId, projectId: target.projectId }}
          {...props}
        />
      );
    case "connection":
      return (
        <Link
          to="/settings/connections/$connectionId"
          params={{ connectionId: target.connectionId }}
          {...props}
        />
      );
    case "page":
      return (
        <Link
          to={SETTINGS_PAGE_PATHS[target.page]}
          activeOptions={{ exact: true }}
          {...(target.rowId === undefined ? {} : { hash: target.rowId })}
          {...props}
        />
      );
  }
}
