import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("ws", () => {
  class MockWebSocket {
    static OPEN = 1;
    readyState = 0;
    on() {}
    send() {}
    close() {}
  }
  return { default: MockWebSocket };
});

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => null,
}));

import { createQQAdapter } from "../lib/bridge/qq-adapter.js";

function jsonResponse(body) {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function emptyResponse() {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => ({}),
    text: async () => "",
  };
}

describe("createQQAdapter media delivery", () => {
  let tmpDir = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href.includes("/app/getAppAccessToken")) {
        return jsonResponse({ access_token: "qq-token", expires_in: 7200 });
      }
      if (href.endsWith("/gateway")) {
        return jsonResponse({ url: "ws://localhost/qq" });
      }
      if (href.includes("cos.example.com")) {
        return emptyResponse();
      }
      if (href.includes("/upload_prepare")) {
        return jsonResponse({
          upload_id: "upload-1",
          block_size: 5,
          parts: [
            { index: 1, presigned_url: "https://cos.example.com/part-1" },
            { index: 2, presigned_url: "https://cos.example.com/part-2" },
          ],
          concurrency: 1,
        });
      }
      if (href.includes("/upload_part_finish")) {
        return emptyResponse();
      }
      if (href.includes("/files")) {
        return jsonResponse({ file_uuid: "file-uuid", file_info: "file-info", ttl: 3600 });
      }
      return jsonResponse({});
    }));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function makeTempFile(name, content) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-qq-adapter-"));
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function md5Hex(value) {
    return crypto.createHash("md5").update(value).digest("hex");
  }

  function sha1Hex(value) {
    return crypto.createHash("sha1").update(value).digest("hex");
  }

  it("rejects local buffer media with an explicit unsupported error", async () => {
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await expect(
      adapter.sendMediaBuffer("chat-1", Buffer.from("png"), {
        mime: "image/png",
        filename: "image.png",
      }),
    ).rejects.toThrow(/QQ.*本地.*staged file/);

    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/files"),
      expect.anything(),
    );
    adapter.stop();
  });

  it("uploads local C2C staged files through QQ chunked upload before sending rich media", async () => {
    const filePath = makeTempFile("note.txt", "helloworld");
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await adapter.sendMediaFile("user-openid", filePath, {
      kind: "document",
      mime: "text/plain",
      filename: "note.txt",
      isGroup: false,
    });

    const prepareCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/users/user-openid/upload_prepare"));
    expect(prepareCall).toBeTruthy();
    expect(JSON.parse(prepareCall[1].body)).toMatchObject({
      file_type: 4,
      file_name: "note.txt",
      file_size: 10,
      md5: md5Hex("helloworld"),
      sha1: sha1Hex("helloworld"),
      md5_10m: md5Hex("helloworld"),
    });

    const putCalls = fetch.mock.calls.filter(([url]) => String(url).includes("cos.example.com"));
    expect(putCalls).toHaveLength(2);
    expect(await putCalls[0][1].body.text()).toBe("hello");
    expect(await putCalls[1][1].body.text()).toBe("world");

    const partFinishCalls = fetch.mock.calls.filter(([url]) => String(url).includes("/v2/users/user-openid/upload_part_finish"));
    expect(partFinishCalls).toHaveLength(2);
    expect(JSON.parse(partFinishCalls[0][1].body)).toMatchObject({
      upload_id: "upload-1",
      part_index: 1,
      block_size: 5,
      md5: md5Hex("hello"),
    });
    expect(JSON.parse(partFinishCalls[1][1].body)).toMatchObject({
      upload_id: "upload-1",
      part_index: 2,
      block_size: 5,
      md5: md5Hex("world"),
    });

    const completeCall = fetch.mock.calls.find(([url, init = {}]) =>
      String(url).includes("/v2/users/user-openid/files")
      && init.body
      && JSON.parse(init.body).upload_id === "upload-1"
    );
    expect(completeCall).toBeTruthy();

    const messageCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/users/user-openid/messages"));
    expect(JSON.parse(messageCall[1].body)).toMatchObject({
      msg_type: 7,
      media: { file_info: "file-info" },
    });
    adapter.stop();
  });

  it("sends QQ group text replies as passive replies with msg_id and distinct msg_seq values", async () => {
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await adapter.sendReply("group-openid", "first", {
      messageId: "qq-mid-1",
      targetType: "group",
      isGroup: true,
    });
    await adapter.sendReply("group-openid", "second", {
      messageId: "qq-mid-1",
      targetType: "group",
      isGroup: true,
    });

    const messageCalls = fetch.mock.calls.filter(([url]) => String(url).includes("/v2/groups/group-openid/messages"));
    expect(messageCalls).toHaveLength(2);
    expect(JSON.parse(messageCalls[0][1].body)).toMatchObject({
      content: "first",
      msg_id: "qq-mid-1",
      msg_seq: 1,
    });
    expect(JSON.parse(messageCalls[1][1].body)).toMatchObject({
      content: "second",
      msg_id: "qq-mid-1",
      msg_seq: 2,
    });
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/v2/users/group-openid/messages"))).toBe(false);
    adapter.stop();
  });

  it("uploads local group images through QQ group chunked upload", async () => {
    const filePath = makeTempFile("image.png", "helloworld");
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await adapter.sendMediaFile("group-openid", filePath, {
      kind: "image",
      mime: "image/png",
      filename: "image.png",
      isGroup: true,
    });

    const prepareCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/groups/group-openid/upload_prepare"));
    expect(prepareCall).toBeTruthy();
    expect(JSON.parse(prepareCall[1].body)).toMatchObject({ file_type: 1 });
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/v2/users/group-openid/upload_prepare"))).toBe(false);

    const messageCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/groups/group-openid/messages"));
    expect(JSON.parse(messageCall[1].body)).toMatchObject({
      msg_type: 7,
      media: { file_info: "file-info" },
    });
    adapter.stop();
  });

  it("sends QQ rich media replies with passive reply context", async () => {
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await adapter.sendMedia("group-openid", "https://cdn.example.com/image.png", {
      kind: "image",
      mime: "image/png",
      filename: "image.png",
      isGroup: true,
      replyContext: {
        messageId: "qq-mid-1",
        targetType: "group",
      },
    });

    const messageCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/groups/group-openid/messages"));
    expect(JSON.parse(messageCall[1].body)).toMatchObject({
      msg_type: 7,
      media: { file_info: "file-info" },
      msg_id: "qq-mid-1",
      msg_seq: 1,
    });
    adapter.stop();
  });

  it("rejects local group documents before chunked upload", async () => {
    const filePath = makeTempFile("note.txt", "helloworld");
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await expect(adapter.sendMediaFile("group-openid", filePath, {
      kind: "document",
      mime: "text/plain",
      filename: "note.txt",
      isGroup: true,
    })).rejects.toThrow(/群聊.*暂不开放文件类型/);

    expect(fetch.mock.calls.some(([url]) => String(url).includes("/upload_prepare"))).toBe(false);
    adapter.stop();
  });

  it("uses staged file metadata to choose QQ rich-media image file_type for extensionless URLs", async () => {
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await adapter.sendMedia("user-openid", "https://hana.example.com/api/bridge/media/token_123", {
      kind: "image",
      mime: "image/png",
      filename: "image.png",
    });

    const uploadCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/users/user-openid/files"));
    expect(uploadCall).toBeTruthy();
    expect(JSON.parse(uploadCall[1].body)).toMatchObject({
      file_type: 1,
      url: "https://hana.example.com/api/bridge/media/token_123",
      srv_send_msg: false,
    });
    const messageCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/users/user-openid/messages"));
    expect(JSON.parse(messageCall[1].body)).toMatchObject({
      msg_type: 7,
      media: { file_info: "file-info" },
    });
    adapter.stop();
  });

  it("sends C2C documents with QQ rich-media file_type 4", async () => {
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await adapter.sendMedia("user-openid", "https://cdn.example.com/note.txt", {
      kind: "document",
      mime: "text/plain",
      filename: "note.txt",
    });

    const uploadCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/users/user-openid/files"));
    expect(uploadCall).toBeTruthy();
    expect(JSON.parse(uploadCall[1].body)).toMatchObject({
      file_type: 4,
      url: "https://cdn.example.com/note.txt",
      srv_send_msg: false,
    });
    adapter.stop();
  });

  it("uses the group rich-media endpoint directly when Bridge knows the target is a group", async () => {
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await adapter.sendMedia("group-openid", "https://cdn.example.com/image.png", {
      kind: "image",
      mime: "image/png",
      filename: "image.png",
      isGroup: true,
    });

    expect(fetch.mock.calls.some(([url]) => String(url).includes("/v2/users/group-openid/files"))).toBe(false);
    const uploadCall = fetch.mock.calls.find(([url]) => String(url).includes("/v2/groups/group-openid/files"));
    expect(uploadCall).toBeTruthy();
    expect(JSON.parse(uploadCall[1].body)).toMatchObject({ file_type: 1 });
    adapter.stop();
  });

  it("rejects QQ group documents before upload because the official API has not opened file_type 4 for groups", async () => {
    const adapter = createQQAdapter({
      appID: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await expect(adapter.sendMedia("group-openid", "https://cdn.example.com/note.txt", {
      kind: "document",
      mime: "text/plain",
      filename: "note.txt",
      isGroup: true,
    })).rejects.toThrow(/群聊.*暂不开放文件类型/);

    expect(fetch.mock.calls.some(([url]) => String(url).includes("/v2/groups/group-openid/files"))).toBe(false);
    adapter.stop();
  });
});
