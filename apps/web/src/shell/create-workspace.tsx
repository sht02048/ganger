import { showToast } from "@ganger/ui";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { ChangeKind } from "@ganger/db/change-events-model";
import { createWorkspace, getWorkspaceProjectChoices } from "../server/onboarding-functions";
import { openEditorField } from "../settings/blocked-editor";
import { invalidateChanged } from "../settings/settings-query";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";
import { isAtCreatedWorkspace } from "./create-workspace-model";
import type {
  CreateWorkspaceInput,
  CreateWorkspaceResult,
  ProjectChoices,
} from "./create-workspace-dialog";

const WORKSPACE_CREATED: ReadonlyArray<ChangeKind> = ["workspace"];
const PROJECTS_HEADING_ID = "projects-heading";

function workspaceProjectChoicesQuery(session: number) {
  return queryOptions({
    queryKey: ["workspace-project-choices", session],
    queryFn: () => getWorkspaceProjectChoices(),
    staleTime: 0,
    gcTime: 0,
  });
}

export type OpenCreateWorkspace = (focusBack: HTMLElement | null) => void;

const OpenCreateWorkspaceContext = createContext<OpenCreateWorkspace | null>(null);

export function useOpenCreateWorkspace(): OpenCreateWorkspace {
  const open = useContext(OpenCreateWorkspaceContext);
  if (open === null) throw new Error("CreateWorkspaceProvider is missing");
  return open;
}

export function CreateWorkspaceProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("shell.workspace.create");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const focusBack = useRef<HTMLElement | null>(null);
  const created = useRef(false);
  const choicesQuery = useQuery({ ...workspaceProjectChoicesQuery(session), enabled: open });
  const { mutateAsync } = useMutation({
    mutationFn: (data: CreateWorkspaceInput) => createWorkspace({ data }),
    onSuccess: async (result) => {
      if (result.ok) await invalidateChanged(queryClient, WORKSPACE_CREATED);
    },
  });

  const openDialog = useCallback<OpenCreateWorkspace>((element) => {
    focusBack.current = element;
    created.current = false;
    setSession((current) => current + 1);
    setOpen(true);
  }, []);

  const choices = useMemo((): ProjectChoices => {
    if (choicesQuery.data !== undefined) return { kind: "ready", groups: choicesQuery.data };
    return choicesQuery.isError ? { kind: "failed" } : { kind: "loading" };
  }, [choicesQuery.data, choicesQuery.isError]);

  const create = async (input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> => {
    const result = await mutateAsync(input);
    if (!result.ok) {
      if (result.reason === "taken") void choicesQuery.refetch();
      return result;
    }
    showToast(t("created", { name: result.name }));
    created.current = true;
    setOpen(false);
    void navigate({ to: "/settings", search: { ws: result.id }, hash: "projects" }).then(() => {
      if (isAtCreatedWorkspace(window.location.href, result.id)) {
        document.getElementById(PROJECTS_HEADING_ID)?.focus();
      }
    });
    return result;
  };

  return (
    <OpenCreateWorkspaceContext.Provider value={openDialog}>
      {children}
      <CreateWorkspaceDialog
        key={session}
        open={open}
        onOpenChange={setOpen}
        finalFocus={() =>
          (created.current
            ? (openEditorField() ?? document.getElementById(PROJECTS_HEADING_ID))
            : null) ?? focusBack.current
        }
        choices={choices}
        onRetry={() => void choicesQuery.refetch()}
        onCreate={create}
        renderSettingsLink={(props) => (
          <Link to="/settings" onClick={() => setOpen(false)} {...props} />
        )}
      />
    </OpenCreateWorkspaceContext.Provider>
  );
}
