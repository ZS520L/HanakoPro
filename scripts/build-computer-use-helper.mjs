import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function shouldBuildComputerUseHelper({ platform = process.platform } = {}) {
  return platform === "darwin";
}

export function swiftArchForNodeArch(arch = process.arch) {
  if (arch === "x64") return "x86_64";
  return arch;
}

export function resolveComputerUseHelperBuildArch({
  argv = process.argv,
  env = process.env,
  arch = process.arch,
} = {}) {
  const explicitArg = Array.isArray(argv) ? argv[2] : null;
  return explicitArg || env.HANA_COMPUTER_USE_HELPER_ARCH || arch;
}

export function computerUseHelperOutputDir({
  rootDir = path.resolve(__dirname, ".."),
  osName = "mac",
  arch = process.arch,
} = {}) {
  return path.join(rootDir, "dist-computer-use", `${osName}-${arch}`);
}

export function swiftBuildScratchPath({
  rootDir = path.resolve(__dirname, ".."),
  arch = process.arch,
} = {}) {
  return path.join(rootDir, ".cache", "computer-use-helper", "swift-build", `mac-${arch}`);
}

const CUA_APP_STATE_RELATIVE_PATH = path.join(
  "checkouts",
  "cua",
  "libs",
  "cua-driver",
  "Sources",
  "CuaDriverCore",
  "AppState",
  "AppState.swift",
);
const CUA_CLICK_TOOL_RELATIVE_PATH = path.join(
  "checkouts",
  "cua",
  "libs",
  "cua-driver",
  "Sources",
  "CuaDriverServer",
  "Tools",
  "ClickTool.swift",
);

const CUA_AX_PATCH_SENTINEL = "cuaDriverAXMessagingTimeoutSeconds";
const CUA_CLICK_PATCH_SENTINEL = '"show_default_ui": "AXShowDefaultUI"';

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`[computer-use-helper] Cua patch anchor not found: ${label}`);
  }
  return source.replace(needle, replacement);
}

export function patchCuaDriverAppStateSource(source) {
  if (source.includes(CUA_AX_PATCH_SENTINEL)) return source;
  let patched = source;

  patched = replaceRequired(
    patched,
    "extension AXObserver: @retroactive @unchecked Sendable {}\n\n/// No-op callback",
    `extension AXObserver: @retroactive @unchecked Sendable {}

private let cuaDriverAXMessagingTimeoutSeconds: Float = 0.35

@discardableResult
private func applyCuaDriverAXMessagingTimeout(_ element: AXUIElement) -> AXError {
    AXUIElementSetMessagingTimeout(element, cuaDriverAXMessagingTimeoutSeconds)
}

/// No-op callback`,
    "AX messaging timeout helpers",
  );

  patched = replaceRequired(
    patched,
    "    public static let maxDepth = 25\n",
    "    public static let maxDepth = 6\n    public static let maxActionableElements = 48\n",
    "bounded AX tree walk",
  );

  patched = replaceRequired(
    patched,
    `        let root = AXUIElementCreateApplication(pid)

        // Cue Chromium/Electron apps to turn on their web accessibility tree.
        // Non-Chromium apps ignore these attribute writes — safe no-op.
        try await activateAccessibilityIfNeeded(pid: pid, root: root)
`,
    `        let root = AXUIElementCreateApplication(pid)
        applyCuaDriverAXMessagingTimeout(root)

        // Cue Chromium/Electron apps to turn on their web accessibility tree.
        // Native AppKit apps can stall on the AXManualAccessibility writes, so
        // keep this Chromium-only instead of probing every app optimistically.
        try await activateAccessibilityIfNeeded(
            pid: pid,
            root: root,
            bundleId: running.bundleIdentifier
        )
`,
    "safe accessibility activation call",
  );

  patched = replaceRequired(
    patched,
    `    private func activateAccessibilityIfNeeded(
        pid: Int32,
        root: AXUIElement
    ) async throws {
        // Already did the one-shot pump + observer for this pid.
`,
    `    private func activateAccessibilityIfNeeded(
        pid: Int32,
        root: AXUIElement,
        bundleId: String?
    ) async throws {
        guard shouldAssertAccessibilityForAXClientSignals(
            pid: pid,
            bundleId: bundleId
        ) else { return }
        // Already did the one-shot pump + observer for this pid.
`,
    "Chromium-only accessibility activation signature",
  );

  patched = replaceRequired(
    patched,
    `        pumpRunLoopForActivation(duration: 0.5)
    }

    /// Pump the current thread's CFRunLoop for roughly \`duration\` seconds.
`,
    `        pumpRunLoopForActivation(duration: 0.5)
    }

    private nonisolated func shouldAssertAccessibilityForAXClientSignals(
        pid: Int32,
        bundleId: String?
    ) -> Bool {
        if ElectronJS.isElectron(pid: pid) { return true }
        switch bundleId {
        case "com.google.Chrome",
             "com.google.Chrome.canary",
             "com.microsoft.edgemac",
             "com.microsoft.edgemac.Canary",
             "com.brave.Browser",
             "com.operasoftware.Opera",
             "com.vivaldi.Vivaldi":
            return true
        default:
            return false
        }
    }

    /// Pump the current thread's CFRunLoop for roughly \`duration\` seconds.
`,
    "Chromium app detection helper",
  );

  patched = replaceRequired(
    patched,
    `    ) {
        guard depth <= AppStateEngine.maxDepth else { return }

        let role = attributeString(element, "AXRole") ?? "?"
`,
    `    ) {
        guard depth <= AppStateEngine.maxDepth else { return }
        guard nextIndex < AppStateEngine.maxActionableElements else { return }
        applyCuaDriverAXMessagingTimeout(element)

        let role = attributeString(element, "AXRole") ?? "?"
`,
    "renderTree guard",
  );

  patched = replaceRequired(
    patched,
    `        let enabled = attributeBool(element, "AXEnabled")
        let actions = actionNames(of: element)

        let indent = String(repeating: "  ", count: depth)
`,
    `        let enabled = attributeBool(element, "AXEnabled")
        let actions = actionNames(of: element)
        let descendantSummary =
            (role == "AXRow" && (title?.isEmpty ?? true) && (value?.isEmpty ?? true) && (description?.isEmpty ?? true))
            ? descendantLabelSummary(of: element)
            : nil

        let indent = String(repeating: "  ", count: depth)
`,
    "AXRow descendant summary",
  );

  patched = replaceRequired(
    patched,
    `        line += role
        if let t = title, !t.isEmpty { line += " \\"\\(t)\\"" }
        if let v = value, !v.isEmpty, v.count < 120 { line += " = \\"\\(v)\\"" }
`,
    `        line += role
        if let t = title, !t.isEmpty { line += " \\"\\(t)\\"" }
        else if let s = descendantSummary, !s.isEmpty { line += " \\"\\(s)\\"" }
        if let v = value, !v.isEmpty, v.count < 120 { line += " = \\"\\(v)\\"" }
`,
    "AXRow label rendering",
  );

  for (const [needle, replacement, label] of [
    [
      `    private func windows(of appRoot: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
`,
      `    private func windows(of appRoot: AXUIElement) -> [AXUIElement] {
        applyCuaDriverAXMessagingTimeout(appRoot)
        var value: CFTypeRef?
`,
      "AX timeout for windows",
    ],
    [
      `    private func isMenuOpen(_ menu: AXUIElement) -> Bool {
        var value: CFTypeRef?
`,
      `    private func isMenuOpen(_ menu: AXUIElement) -> Bool {
        applyCuaDriverAXMessagingTimeout(menu)
        var value: CFTypeRef?
`,
      "AX timeout for menu visibility",
    ],
    [
      `    private func attributeString(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
`,
      `    private func attributeString(_ element: AXUIElement, _ attribute: String) -> String? {
        applyCuaDriverAXMessagingTimeout(element)
        var value: CFTypeRef?
`,
      "AX timeout for string attributes",
    ],
    [
      `    private func attributeBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        var value: CFTypeRef?
`,
      `    private func attributeBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        applyCuaDriverAXMessagingTimeout(element)
        var value: CFTypeRef?
`,
      "AX timeout for boolean attributes",
    ],
    [
      `    private func actionNames(of element: AXUIElement) -> [String] {
        var names: CFArray?
`,
      `    private func actionNames(of element: AXUIElement) -> [String] {
        applyCuaDriverAXMessagingTimeout(element)
        var names: CFArray?
`,
      "AX timeout for action names",
    ],
    [
      `    private func children(of element: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
`,
      `    private func children(of element: AXUIElement) -> [AXUIElement] {
        applyCuaDriverAXMessagingTimeout(element)
        var value: CFTypeRef?
`,
      "AX timeout for children",
    ],
  ]) {
    patched = replaceRequired(patched, needle, replacement, label);
  }

  patched = replaceRequired(
    patched,
    `    /// Standard AX actions come through as simple strings like \`AXPress\`.
`,
    `    private func descendantLabelSummary(of element: AXUIElement) -> String? {
        var labels: [String] = []
        collectDescendantLabels(element, depth: 0, maxDepth: 2, labels: &labels)
        let joined = labels
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(4)
            .joined(separator: " ")
        return joined.isEmpty ? nil : joined
    }

    private func collectDescendantLabels(
        _ element: AXUIElement,
        depth: Int,
        maxDepth: Int,
        labels: inout [String]
    ) {
        if labels.count >= 4 || depth > maxDepth { return }
        let role = attributeString(element, "AXRole") ?? ""
        if role == "AXStaticText" || role == "AXButton" || role == "AXImage" {
            for attribute in ["AXTitle", "AXValue", "AXDescription"] {
                if let text = attributeString(element, attribute), !text.isEmpty {
                    labels.append(text)
                    if labels.count >= 4 { return }
                    break
                }
            }
        }
        if depth == maxDepth { return }
        for child in children(of: element) {
            collectDescendantLabels(child, depth: depth + 1, maxDepth: maxDepth, labels: &labels)
            if labels.count >= 4 { return }
        }
    }

    /// Standard AX actions come through as simple strings like \`AXPress\`.
`,
    "AXRow descendant label helpers",
  );

  return patched;
}

export function patchCuaDriverClickToolSource(source) {
  if (source.includes(CUA_CLICK_PATCH_SENTINEL)) return source;
  let patched = source;

  patched = replaceRequired(
    patched,
    `"enum": ["press", "show_menu", "pick", "confirm", "cancel", "open"],`,
    `"enum": ["press", "show_menu", "show_default_ui", "pick", "confirm", "cancel", "open"],`,
    "ClickTool action schema",
  );

  patched = replaceRequired(
    patched,
    `"show_menu": "AXShowMenu",
        "pick": "AXPick",`,
    `"show_menu": "AXShowMenu",
        "show_default_ui": "AXShowDefaultUI",
        "pick": "AXPick",`,
    "ClickTool AXShowDefaultUI action mapping",
  );

  patched = replaceRequired(
    patched,
    "Other values:\n                  `show_menu` (right-click equivalent), `pick` (open a",
    "Other values:\n                  `show_menu` (right-click equivalent), `show_default_ui`\n                  (select a row/list item via AXShowDefaultUI), `pick` (open a",
    "ClickTool action description",
  );

  return patched;
}

export function applyCuaDriverSourcePatches({ scratchPath } = {}) {
  const appStatePath = path.join(scratchPath, CUA_APP_STATE_RELATIVE_PATH);
  if (!fs.existsSync(appStatePath)) {
    throw new Error(`[computer-use-helper] Cua AppState.swift not found at ${appStatePath}`);
  }
  const clickToolPath = path.join(scratchPath, CUA_CLICK_TOOL_RELATIVE_PATH);
  if (!fs.existsSync(clickToolPath)) {
    throw new Error(`[computer-use-helper] Cua ClickTool.swift not found at ${clickToolPath}`);
  }

  let patchedAny = false;
  const appStateSource = fs.readFileSync(appStatePath, "utf8");
  const patchedAppState = patchCuaDriverAppStateSource(appStateSource);
  if (patchedAppState !== appStateSource) {
    fs.chmodSync(appStatePath, 0o644);
    fs.writeFileSync(appStatePath, patchedAppState);
    console.log("[computer-use-helper] patched Cua AX tree walk for bounded background snapshots");
    patchedAny = true;
  }

  const clickToolSource = fs.readFileSync(clickToolPath, "utf8");
  const patchedClickTool = patchCuaDriverClickToolSource(clickToolSource);
  if (patchedClickTool !== clickToolSource) {
    fs.chmodSync(clickToolPath, 0o644);
    fs.writeFileSync(clickToolPath, patchedClickTool);
    console.log("[computer-use-helper] patched Cua ClickTool for AXShowDefaultUI row actions");
    patchedAny = true;
  }

  return patchedAny;
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function read(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options }).trim();
}

export function buildComputerUseHelper({
  rootDir = path.resolve(__dirname, ".."),
  platform = process.platform,
  env = process.env,
  arch = env.HANA_COMPUTER_USE_HELPER_ARCH || process.arch,
} = {}) {
  if (!shouldBuildComputerUseHelper({ platform })) {
    console.log(`[computer-use-helper] skipped on ${platform}`);
    return { skipped: true };
  }

  const packageDir = path.join(rootDir, "desktop", "native", "HanaComputerUseHelper");
  const swiftArch = swiftArchForNodeArch(arch);
  const scratchPath = swiftBuildScratchPath({ rootDir, arch });
  const baseArgs = [
    "--package-path",
    packageDir,
    "--scratch-path",
    scratchPath,
    "-c",
    "release",
    "--arch",
    swiftArch,
    "--product",
    "hana-computer-use-helper",
  ];

  console.log(`[computer-use-helper] building for ${swiftArch}`);
  run("swift", ["package", "resolve", "--package-path", packageDir, "--scratch-path", scratchPath], { cwd: rootDir, env });
  applyCuaDriverSourcePatches({ scratchPath });
  run("swift", ["build", ...baseArgs], { cwd: rootDir, env });

  const binPath = read("swift", ["build", "--show-bin-path", ...baseArgs], { cwd: rootDir, env });
  const source = path.join(binPath, "hana-computer-use-helper");
  if (!fs.existsSync(source)) {
    throw new Error(`[computer-use-helper] build did not produce ${source}`);
  }

  const outDir = computerUseHelperOutputDir({ rootDir, osName: "mac", arch });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, "hana-computer-use-helper");
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  console.log(`[computer-use-helper] copied ${target}`);
  return { skipped: false, target };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    buildComputerUseHelper({ arch: resolveComputerUseHelperBuildArch() });
  } catch (err) {
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
  }
}
