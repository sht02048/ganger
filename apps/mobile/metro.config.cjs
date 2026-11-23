const path = require("node:path");
const expoMetro = require("expo/metro-config");

const apiSource = path.join(__dirname, "..", "..", "packages", "api", "src") + path.sep;
const config = expoMetro.getDefaultConfig(__dirname);

/**
 * @typedef {object} ApiResolutionContext
 * @property {string} originModulePath
 * @property {(context: ApiResolutionContext, name: string, platform: string | null) => object} resolveRequest
 */

/**
 * @param {ApiResolutionContext} context
 * @param {string} moduleName
 * @param {string | null} platform
 * @returns {object}
 */
function resolveApiSiblings(context, moduleName, platform) {
  const isApiSibling =
    context.originModulePath.startsWith(apiSource) &&
    moduleName.startsWith("./") &&
    moduleName.endsWith(".js");
  const resolvedName = isApiSibling ? `${moduleName.slice(0, -".js".length)}.ts` : moduleName;
  return context.resolveRequest(context, resolvedName, platform);
}

config.resolver.resolveRequest = resolveApiSiblings;

module.exports = config;
