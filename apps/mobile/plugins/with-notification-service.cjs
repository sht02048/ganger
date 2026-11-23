/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return */
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const SWIFT_FILE = "NotificationService.swift";
const SOURCE = path.join(__dirname, "..", "ios-extension", SWIFT_FILE);
const DEPLOYMENT_TARGET = "16.0";

function localNetworkingEntry(allowLocalNetworking) {
  return allowLocalNetworking
    ? `<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>`
    : "";
}

function infoPlist({ keychainAccessGroup, allowLocalNetworking }, version, buildNumber) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key><string>Ganger Notifications</string>
  <key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key><string>XPC!</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${buildNumber}</string>
  <key>GangerKeychainAccessGroup</key><string>${keychainAccessGroup}</string>
  ${localNetworkingEntry(allowLocalNetworking)}
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.usernotifications.service</string>
    <key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).NotificationService</string>
  </dict>
</dict>
</plist>
`;
}

function entitlements({ keychainAccessGroup }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>keychain-access-groups</key>
  <array><string>${keychainAccessGroup}</string></array>
</dict>
</plist>
`;
}

function withExtensionFiles(config, options) {
  return withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const directory = path.join(modConfig.modRequest.platformProjectRoot, options.targetName);
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(SOURCE, path.join(directory, SWIFT_FILE));
      fs.writeFileSync(
        path.join(directory, "Info.plist"),
        infoPlist(options, modConfig.version ?? "1.0.0", modConfig.ios?.buildNumber ?? "1"),
      );
      fs.writeFileSync(
        path.join(directory, `${options.targetName}.entitlements`),
        entitlements(options),
      );
      return modConfig;
    },
  ]);
}

function isUnset(value) {
  return value === undefined || value === "undefined";
}

function cleanFileReferences(project, targetName) {
  for (const reference of Object.values(project.pbxFileReferenceSection())) {
    if (typeof reference !== "object") continue;
    for (const key of Object.keys(reference)) {
      if (isUnset(reference[key])) delete reference[key];
    }
    const name = String(reference.path ?? "").replaceAll('"', "");
    if (name === `${targetName}.entitlements`) {
      reference.lastKnownFileType = "text.plist.entitlements";
    }
    if (name === `${targetName}.appex`) reference.explicitFileType = '"wrapper.app-extension"';
  }
}

function removeUnusedBuildFiles(project, targetName) {
  const section = project.pbxBuildFileSection();
  const unused = [`Info.plist in Resources`, `${targetName}.entitlements in Resources`];
  for (const key of Object.keys(section)) {
    if (key.endsWith("_comment") || !unused.includes(section[`${key}_comment`])) continue;
    delete section[key];
    delete section[`${key}_comment`];
  }
}

function withExtensionTarget(config, options) {
  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const { targetName, bundleIdentifier, teamId } = options;
    if (project.pbxTargetByName(targetName)) return modConfig;
    const group = project.addPbxGroup(
      [SWIFT_FILE, "Info.plist", `${targetName}.entitlements`],
      targetName,
      targetName,
    );
    const rootGroup = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, rootGroup);
    const target = project.addTarget(targetName, "app_extension", targetName, bundleIdentifier);
    project.addBuildPhase([SWIFT_FILE], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    cleanFileReferences(project, targetName);
    removeUnusedBuildFiles(project, targetName);
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};
    project.addTargetDependency(project.getFirstTarget().uuid, [target.uuid]);
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      const settings = entry.buildSettings;
      if (settings === undefined || settings.PRODUCT_NAME !== `"${targetName}"`) continue;
      Object.assign(settings, {
        CODE_SIGN_ENTITLEMENTS: `${targetName}/${targetName}.entitlements`,
        CODE_SIGN_STYLE: "Automatic",
        DEVELOPMENT_TEAM: teamId,
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${targetName}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
        PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}"`,
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: `"1"`,
      });
    }
    return modConfig;
  });
}

module.exports = function withNotificationService(config, options) {
  return withExtensionTarget(withExtensionFiles(config, options), options);
};
