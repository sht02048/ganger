import { createMiddleware, createStart } from "@tanstack/react-start";
import { checkBuildOnFailure, serverBuild } from "./shell/server-build";

const serverBuildCheck = createMiddleware({ type: "function" }).client(({ next }) =>
  typeof window === "undefined" ? next() : checkBuildOnFailure(() => next(), serverBuild.check),
);

export const startInstance = createStart(() => ({ functionMiddleware: [serverBuildCheck] }));
