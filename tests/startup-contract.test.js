import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import viteServerConfig from "../vite.config.server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

describe("local startup contract", () => {
  it("start scripts build theme bundle before launching Electron", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts.start).toContain("build:theme");
    expect(pkg.scripts["start:dev"]).toContain("build:theme");
  });

  it("dev Electron launcher passes a dedicated Node runtime to main process", () => {
    const launchJs = fs.readFileSync(path.join(ROOT, "scripts", "launch.js"), "utf-8");
    const mainCjs = fs.readFileSync(path.join(ROOT, "desktop", "main.cjs"), "utf-8");

    expect(launchJs).toContain("HANA_DEV_NODE_BIN");
    expect(mainCjs).toContain("HANA_DEV_NODE_BIN");
  });

  it("CLI and server configure the Pi SDK agent directory from HANA_HOME", () => {
    const cliSource = fs.readFileSync(path.join(ROOT, "index.js"), "utf-8");
    const serverSource = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf-8");

    expect(cliSource).toContain("ensureHanaPiSdkDirs(hanakoHome)");
    expect(cliSource).toContain("configureProcessPiSdkEnv(hanakoHome)");
    expect(serverSource).toContain("ensureHanaPiSdkDirs(hanakoHome)");
    expect(serverSource).toContain("configureProcessPiSdkEnv(hanakoHome)");
  });

  it("desktop main propagates Hana-owned Pi SDK env to the spawned server", () => {
    const mainCjs = fs.readFileSync(path.join(ROOT, "desktop", "main.cjs"), "utf-8");

    expect(mainCjs).toContain("ensureHanaPiSdkDirs(hanakoHome)");
    expect(mainCjs).toContain("configureProcessPiSdkEnv(hanakoHome)");
    expect(mainCjs).toContain("withHanaPiSdkEnv(process.env, hanakoHome)");
  });

  it("desktop main installs the client single-instance lock before app readiness", () => {
    const mainCjs = fs.readFileSync(path.join(ROOT, "desktop", "main.cjs"), "utf-8");

    expect(mainCjs).toContain("configureClientSingleInstance(app");
    expect(mainCjs).toContain("onSecondInstance: () => showPrimaryWindow()");
    expect(mainCjs.indexOf("configureClientSingleInstance(app")).toBeLessThan(
      mainCjs.indexOf("app.whenReady()"),
    );
  });

  it("desktop main reopens model setup when imported completed setup has no usable models", () => {
    const mainCjs = fs.readFileSync(path.join(ROOT, "desktop", "main.cjs"), "utf-8");
    const onboardingMain = fs.readFileSync(path.join(ROOT, "desktop", "src", "onboarding-main.tsx"), "utf-8");
    const onboardingApp = fs.readFileSync(path.join(ROOT, "desktop", "src", "react", "onboarding", "OnboardingApp.tsx"), "utf-8");

    expect(mainCjs).toContain("needsModelSetupAfterStartup");
    expect(mainCjs).toContain("/api/models");
    expect(mainCjs).toContain("wouldSkipModelSetup: setupComplete || existingConfig");
    expect(mainCjs).toContain("启动模型配置健康检查失败，将重新打开模型配置向导");
    expect(mainCjs).toContain("启动模型配置健康检查返回 ${res.status}");
    expect(mainCjs).toContain('createOnboardingWindow({ skipToModelSetup: "1" })');
    expect(onboardingMain).toContain("skipToModelSetup");
    expect(onboardingApp).toContain("skipToModelSetup ? 2 : 0");
  });

  it("desktop main does not delay first-run onboarding behind the fixed splash minimum", () => {
    const mainCjs = fs.readFileSync(path.join(ROOT, "desktop", "main.cjs"), "utf-8");

    expect(mainCjs).toContain("const opensOnboarding = forceModelSetup || !setupComplete");
    expect(mainCjs).toContain("if (!opensOnboarding && splashWindow && elapsed < minSplashMs)");
    expect(mainCjs.indexOf("const opensOnboarding = forceModelSetup || !setupComplete")).toBeLessThan(
      mainCjs.indexOf("if (!opensOnboarding && splashWindow && elapsed < minSplashMs)"),
    );
    expect(mainCjs.indexOf("if (!opensOnboarding && splashWindow && elapsed < minSplashMs)")).toBeLessThan(
      mainCjs.indexOf("if (forceModelSetup)"),
    );
  });

  it("desktop settings can reset the current data directory into a fresh onboarding environment", () => {
    const mainCjs = fs.readFileSync(path.join(ROOT, "desktop", "main.cjs"), "utf-8");
    const preloadCjs = fs.readFileSync(path.join(ROOT, "desktop", "preload.cjs"), "utf-8");

    expect(preloadCjs).toContain("resetToFreshEnvironment");
    expect(mainCjs).toContain('wrapIpcHandler("reset-to-fresh-environment"');
    expect(mainCjs).toContain("await shutdownServer()");
    expect(mainCjs).toContain("moveCurrentHanakoHomeToBackup()");
    expect(mainCjs).toContain("writeResetDeclineMarker()");
    expect(mainCjs).toContain("DECLINED_MARKER");
    expect(mainCjs).toContain("app.relaunch()");
  });

  it("keeps jsdom external in the server bundle for packaged runtime", () => {
    const external = viteServerConfig.build?.rollupOptions?.external || [];

    expect(external).toContain("jsdom");
  });
});
