import { Link } from "@tanstack/react-router";
import type { SettingsLinkRowRenderProps } from "@ganger/ui";
import type { SettingsLinkTarget } from "./settings-page";

export function routerSettingsLink(target: SettingsLinkTarget, props: SettingsLinkRowRenderProps) {
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
    case "runners":
      return <Link to="/runners" {...props} />;
    case "mcp":
      return <Link to="/settings/mcp" {...props} />;
    case "settings":
      return (
        <Link
          to="/settings"
          activeOptions={{ exact: true }}
          {...(target.rowId === undefined ? {} : { hash: target.rowId })}
          {...props}
        />
      );
  }
}
