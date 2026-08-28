const { resolve } = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const { auditPackageRoot } = require("./scripts/audit-electron-package.cjs");
const { shouldIgnoreSourcePath } = require("./electron/package-boundary.cjs");

const projectRoot = __dirname;
const iconPath = resolve(projectRoot, "assets", "amadeus.ico");
const electronVersion = require("./package.json").devDependencies.electron;
let releaseMetadata = {};
try { releaseMetadata = require("./release.local.cjs"); } catch (error) {
  if (error?.code !== "MODULE_NOT_FOUND" || !String(error?.message || "").includes("release.local.cjs")) throw error;
}
const companyName = typeof releaseMetadata.companyName === "string" && releaseMetadata.companyName.trim()
  ? releaseMetadata.companyName.trim().slice(0, 120)
  : "Amadeus Local Companion Contributors";
const releaseIconUrl = typeof releaseMetadata.iconUrl === "string" && /^https:\/\/[^\s]{1,400}$/i.test(releaseMetadata.iconUrl)
  ? releaseMetadata.iconUrl
  : `https://raw.githubusercontent.com/electron/electron/v${electronVersion}/shell/browser/resources/win/electron.ico`;

module.exports = {
  packagerConfig: {
    asar: true,
    electronZipDir: resolve(projectRoot, "downloads", "electron-cache"),
    executableName: "AmadeusLocalCompanion",
    icon: iconPath,
    ignore: absolutePath => shouldIgnoreSourcePath(absolutePath, projectRoot),
    win32metadata: {
      CompanyName: companyName,
      FileDescription: "Privacy-first local AI companion",
      OriginalFilename: "AmadeusLocalCompanion.exe",
      ProductName: "Amadeus Local Companion",
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "AmadeusLocalCompanion",
        authors: companyName,
        description: "Privacy-first local AI companion",
        setupExe: "AmadeusLocalCompanion-Setup.exe",
        setupIcon: iconPath,
        iconUrl: releaseIconUrl,
        vendorDirectory: resolve(projectRoot, "downloads", "squirrel-vendor"),
        noMsi: true,
      },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      for (const outputPath of packageResult.outputPaths || []) await auditPackageRoot(outputPath);
    },
  },
};
