import path from "path";
import { describe, expect, it } from "vitest";
import {
  computerUseHelperOutputDir,
  patchCuaDriverAppStateSource,
  patchCuaDriverClickToolSource,
  resolveComputerUseHelperBuildArch,
  shouldBuildComputerUseHelper,
  swiftBuildScratchPath,
  swiftArchForNodeArch,
} from "../scripts/build-computer-use-helper.mjs";

describe("Computer Use helper build script", () => {
  it("skips the Swift helper build outside macOS", () => {
    expect(shouldBuildComputerUseHelper({ platform: "linux" })).toBe(false);
    expect(shouldBuildComputerUseHelper({ platform: "win32" })).toBe(false);
    expect(shouldBuildComputerUseHelper({ platform: "darwin" })).toBe(true);
  });

  it("maps Node architecture names to Swift architecture names", () => {
    expect(swiftArchForNodeArch("arm64")).toBe("arm64");
    expect(swiftArchForNodeArch("x64")).toBe("x86_64");
  });

  it("lets CI choose the helper build architecture explicitly", () => {
    expect(resolveComputerUseHelperBuildArch({
      argv: ["node", "scripts/build-computer-use-helper.mjs", "x64"],
      env: { HANA_COMPUTER_USE_HELPER_ARCH: "arm64" },
      arch: "arm64",
    })).toBe("x64");
    expect(resolveComputerUseHelperBuildArch({
      argv: ["node", "scripts/build-computer-use-helper.mjs"],
      env: { HANA_COMPUTER_USE_HELPER_ARCH: "x64" },
      arch: "arm64",
    })).toBe("x64");
  });

  it("writes the macOS helper into the Electron extraResources source directory", () => {
    expect(computerUseHelperOutputDir({
      rootDir: "/repo",
      osName: "mac",
      arch: "arm64",
    })).toBe(path.join("/repo", "dist-computer-use", "mac-arm64"));
  });

  it("keeps SwiftPM checkouts in the ignored cache directory instead of the source tree", () => {
    expect(swiftBuildScratchPath({
      rootDir: "/repo",
      arch: "arm64",
    })).toBe(path.join("/repo", ".cache", "computer-use-helper", "swift-build", "mac-arm64"));
  });

  it("patches Cua AppState snapshots to stay bounded and AX-safe", () => {
    const source = `extension AXObserver: @retroactive @unchecked Sendable {}

/// No-op callback
    public static let maxDepth = 25
        let root = AXUIElementCreateApplication(pid)

        // Cue Chromium/Electron apps to turn on their web accessibility tree.
        // Non-Chromium apps ignore these attribute writes — safe no-op.
        try await activateAccessibilityIfNeeded(pid: pid, root: root)
    private func activateAccessibilityIfNeeded(
        pid: Int32,
        root: AXUIElement
    ) async throws {
        // Already did the one-shot pump + observer for this pid.
        pumpRunLoopForActivation(duration: 0.5)
    }

    /// Pump the current thread's CFRunLoop for roughly \`duration\` seconds.
    ) {
        guard depth <= AppStateEngine.maxDepth else { return }

        let role = attributeString(element, "AXRole") ?? "?"
        let enabled = attributeBool(element, "AXEnabled")
        let actions = actionNames(of: element)

        let indent = String(repeating: "  ", count: depth)
        line += role
        if let t = title, !t.isEmpty { line += " \\"\\(t)\\"" }
        if let v = value, !v.isEmpty, v.count < 120 { line += " = \\"\\(v)\\"" }
    private func windows(of appRoot: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
    private func isMenuOpen(_ menu: AXUIElement) -> Bool {
        var value: CFTypeRef?
    private func attributeString(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
    private func attributeBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        var value: CFTypeRef?
    private func actionNames(of element: AXUIElement) -> [String] {
        var names: CFArray?
    private func children(of element: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
    /// Standard AX actions come through as simple strings like \`AXPress\`.
`;

    const patched = patchCuaDriverAppStateSource(source);

    expect(patched).toContain("cuaDriverAXMessagingTimeoutSeconds");
    expect(patched).toContain("public static let maxDepth = 6");
    expect(patched).toContain("public static let maxActionableElements = 48");
    expect(patched).toContain("shouldAssertAccessibilityForAXClientSignals");
    expect(patched).toContain("descendantLabelSummary");
    expect(patchCuaDriverAppStateSource(patched)).toBe(patched);
  });

  it("patches Cua ClickTool to expose AXShowDefaultUI as a semantic action", () => {
    const source = `Other values:
                  \`show_menu\` (right-click equivalent), \`pick\` (open a
                    "action": [
                        "type": "string",
                        "enum": ["press", "show_menu", "pick", "confirm", "cancel", "open"],
                        "description":
                            "AX action name (element_index path only). Default: press.",
                    ],
    private static let axActionByName: [String: String] = [
        "press": "AXPress",
        "show_menu": "AXShowMenu",
        "pick": "AXPick",
        "confirm": "AXConfirm",
        "cancel": "AXCancel",
        "open": "AXOpen",
    ]
`;

    const patched = patchCuaDriverClickToolSource(source);

    expect(patched).toContain('"show_default_ui"');
    expect(patched).toContain('"show_default_ui": "AXShowDefaultUI"');
    expect(patchCuaDriverClickToolSource(patched)).toBe(patched);
  });
});
