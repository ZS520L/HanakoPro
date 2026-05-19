import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockContactUserGet = vi.fn();
const mockImageGet = vi.fn();
const mockMessageResourceGet = vi.fn();
const mockMessageCreate = vi.fn();
const mockMessageUpdate = vi.fn();
const mockImageCreate = vi.fn();
const mockFileCreate = vi.fn();
const mockWsStart = vi.fn();

let registeredHandlers = {};

vi.mock("@larksuiteoapi/node-sdk", () => {
  class MockEventDispatcher {
    register(handlers) {
      registeredHandlers = handlers;
      return this;
    }
  }

  class MockWSClient {
    constructor() {
      this.wsConfig = { wsInstance: { readyState: 1 } };
    }

    start(...args) {
      return mockWsStart(...args);
    }

    close() {}
  }

  class MockClient {
    constructor() {
      this.contact = {
        user: {
          get: mockContactUserGet,
        },
      };
      this.im = {
        image: {
          get: mockImageGet,
          create: mockImageCreate,
        },
        file: {
          create: mockFileCreate,
        },
        messageResource: {
          get: mockMessageResourceGet,
        },
        message: {
          create: mockMessageCreate,
          update: mockMessageUpdate,
        },
      };
    }
  }

  return {
    Client: MockClient,
    EventDispatcher: MockEventDispatcher,
    WSClient: MockWSClient,
    LoggerLevel: { warn: "warn" },
  };
});

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => null,
}));

import { createFeishuAdapter } from "../lib/bridge/feishu-adapter.js";

function markdownPostContent(text) {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: "md", text }]],
    },
  });
}

describe("createFeishuAdapter", () => {
  beforeEach(() => {
    registeredHandlers = {};
    mockContactUserGet.mockReset();
    mockImageGet.mockReset();
    mockMessageResourceGet.mockReset();
    mockMessageCreate.mockReset();
    mockMessageUpdate.mockReset();
    mockImageCreate.mockReset();
    mockFileCreate.mockReset();
    mockWsStart.mockReset();

    mockWsStart.mockResolvedValue(undefined);
    mockContactUserGet.mockResolvedValue({
      data: {
        user: {
          nickname: "TestUser",
          avatar: { avatar_240: "https://example.com/avatar.png" },
        },
      },
    });
  });

  it("keeps message_id on inbound image attachments", async () => {
    const onMessage = vi.fn();

    createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage,
    });

    await registeredHandlers["im.message.receive_v1"]({
      message: {
        message_id: "om_fake_msg_001",
        message_type: "image",
        content: JSON.stringify({ image_key: "img_fake_key_001" }),
        chat_id: "oc_fake_chat_001",
        chat_type: "p2p",
      },
      sender: {
        sender_type: "user",
        sender_id: {
          open_id: "ou_123",
          user_id: "ou_123",
        },
      },
    });

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      platform: "feishu",
      sessionKey: "fs_dm_ou_123@hana",
      attachments: [
        expect.objectContaining({
          type: "image",
          platformRef: "img_fake_key_001",
          _messageId: "om_fake_msg_001",
        }),
      ],
    }));
  });

  it("downloads inbound images via message resource API", async () => {
    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockMessageResourceGet.mockResolvedValue({
      getReadableStream: () => Readable.from([imageBuffer]),
    });
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    const buffer = await adapter.downloadImage(
      "img_fake_key_001",
      "om_fake_msg_001",
    );

    expect(buffer).toEqual(imageBuffer);
    expect(mockMessageResourceGet).toHaveBeenCalledWith({
      path: {
        message_id: "om_fake_msg_001",
        file_key: "img_fake_key_001",
      },
      params: { type: "image" },
    });
    expect(mockImageGet).not.toHaveBeenCalled();
  });

  it("downloads self-uploaded images through the SDK stream wrapper", async () => {
    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockImageGet.mockResolvedValue({
      getReadableStream: () => Readable.from([imageBuffer]),
    });
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    const buffer = await adapter.downloadImage("img_uploaded_key_001");

    expect(buffer).toEqual(imageBuffer);
    expect(mockImageGet).toHaveBeenCalledWith({
      path: { image_key: "img_uploaded_key_001" },
    });
    expect(mockMessageResourceGet).not.toHaveBeenCalled();
  });

  it("downloads inbound files via the SDK stream wrapper", async () => {
    const fileBuffer = Buffer.from("hello");
    mockMessageResourceGet.mockResolvedValue({
      getReadableStream: () => Readable.from([fileBuffer]),
    });
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    const buffer = await adapter.downloadFile("om_fake_msg_001", "file_key_001");

    expect(buffer).toEqual(fileBuffer);
    expect(mockMessageResourceGet).toHaveBeenCalledWith({
      path: {
        message_id: "om_fake_msg_001",
        file_key: "file_key_001",
      },
      params: { type: "file" },
    });
  });

  it("uploads image buffers and sends image_key messages", async () => {
    mockImageCreate.mockResolvedValue({ image_key: "img_key_001" });
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    await adapter.sendMediaBuffer("oc_chat", buffer, {
      mime: "image/png",
      filename: "image.png",
    });

    expect(mockImageCreate).toHaveBeenCalledWith({
      data: { image_type: "message", image: buffer },
    });
    expect(mockMessageCreate).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_chat",
        msg_type: "image",
        content: JSON.stringify({ image_key: "img_key_001" }),
      },
    });
  });

  it("uploads document buffers and sends file_key messages", async () => {
    mockFileCreate.mockResolvedValue({ file_key: "file_key_001" });
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });
    const buffer = Buffer.from("hello");

    await adapter.sendMediaBuffer("oc_chat", buffer, {
      mime: "text/plain",
      filename: "note.txt",
    });

    expect(mockFileCreate).toHaveBeenCalledWith({
      data: {
        file_type: "stream",
        file_name: "note.txt",
        file: buffer,
      },
    });
    expect(mockMessageCreate).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_chat",
        msg_type: "file",
        content: JSON.stringify({ file_key: "file_key_001" }),
      },
    });
  });

  it("sends MP4 buffers as Feishu media messages", async () => {
    mockFileCreate.mockResolvedValue({ file_key: "file_key_mp4" });
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });
    const buffer = Buffer.from("mp4");

    await adapter.sendMediaBuffer("oc_chat", buffer, {
      mime: "video/mp4",
      filename: "clip.mp4",
    });

    expect(mockFileCreate).toHaveBeenCalledWith({
      data: {
        file_type: "mp4",
        file_name: "clip.mp4",
        file: buffer,
      },
    });
    expect(mockMessageCreate).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_chat",
        msg_type: "media",
        content: JSON.stringify({ file_key: "file_key_mp4" }),
      },
    });
  });

  it("sends OPUS buffers as Feishu audio messages", async () => {
    mockFileCreate.mockResolvedValue({ file_key: "file_key_opus" });
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });
    const buffer = Buffer.from("opus");

    await adapter.sendMediaBuffer("oc_chat", buffer, {
      mime: "audio/opus",
      filename: "voice.opus",
    });

    expect(mockFileCreate).toHaveBeenCalledWith({
      data: {
        file_type: "opus",
        file_name: "voice.opus",
        file: buffer,
      },
    });
    expect(mockMessageCreate).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_chat",
        msg_type: "audio",
        content: JSON.stringify({ file_key: "file_key_opus" }),
      },
    });
  });

  it("rejects empty image uploads before calling Feishu", async () => {
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await expect(adapter.sendMediaBuffer("oc_chat", Buffer.alloc(0), {
      mime: "image/png",
      filename: "empty.png",
    })).rejects.toThrow(/文件大小不能为 0/);

    expect(mockImageCreate).not.toHaveBeenCalled();
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it("rejects image upload responses without image_key", async () => {
    mockImageCreate.mockResolvedValue({});
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await expect(adapter.sendMediaBuffer("oc_chat", Buffer.from("png"), {
      mime: "image/png",
      filename: "image.png",
    })).rejects.toThrow(/未返回 image_key/);

    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it("wraps Feishu upload API failures with code and log id", async () => {
    const err = new Error("Request failed with status code 400");
    err.response = {
      data: {
        code: 234011,
        msg: "Can't regonnize the image format.",
        error: { log_id: "202605150001" },
      },
    };
    mockImageCreate.mockRejectedValue(err);
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await expect(adapter.sendMediaBuffer("oc_chat", Buffer.from("not-image"), {
      mime: "image/png",
      filename: "broken.png",
    })).rejects.toThrow(/飞书图片上传失败.*234011.*202605150001/);

    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it("wraps Feishu message send API failures with code and log id", async () => {
    mockImageCreate.mockResolvedValue({ image_key: "img_key_001" });
    const err = new Error("Request failed with status code 400");
    err.response = {
      data: {
        code: 230002,
        msg: "The bot can not be outside the group.",
        error: { log_id: "202605150002" },
      },
    };
    mockMessageCreate.mockRejectedValue(err);
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await expect(adapter.sendMediaBuffer("oc_chat", Buffer.from("png"), {
      mime: "image/png",
      filename: "image.png",
    })).rejects.toThrow(/飞书消息发送失败.*230002.*202605150002/);
  });

  it("sends plain and block replies as Feishu post markdown messages", async () => {
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    await adapter.sendReply("oc_chat", "**bold**");
    await adapter.sendBlockReply("oc_chat", "- item");

    expect(mockMessageCreate).toHaveBeenNthCalledWith(1, {
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_chat",
        msg_type: "post",
        content: markdownPostContent("**bold**"),
      },
    });
    expect(mockMessageCreate).toHaveBeenNthCalledWith(2, {
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_chat",
        msg_type: "post",
        content: markdownPostContent("- item"),
      },
    });
  });

  it("declares Feishu edit-message streaming and updates the same post markdown message", async () => {
    mockMessageCreate.mockResolvedValue({ data: { message_id: "om_stream_001" } });
    const adapter = createFeishuAdapter({
      appId: "app-id",
      appSecret: "app-secret",
      agentId: "hana",
      onMessage: vi.fn(),
    });

    expect(adapter.streamingCapabilities).toMatchObject({
      mode: "edit_message",
      scopes: ["dm"],
      maxChars: 150_000,
    });

    const state = await adapter.startStreamReply("oc_chat", "first");
    await adapter.updateStreamReply("oc_chat", state, "second");
    await adapter.finishStreamReply("oc_chat", state, "final");

    expect(state).toEqual({ messageId: "om_stream_001" });
    expect(mockMessageCreate).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_chat",
        msg_type: "post",
        content: markdownPostContent("first"),
      },
    });
    expect(mockMessageUpdate).toHaveBeenNthCalledWith(1, {
      path: { message_id: "om_stream_001" },
      data: {
        msg_type: "post",
        content: markdownPostContent("second"),
      },
    });
    expect(mockMessageUpdate).toHaveBeenNthCalledWith(2, {
      path: { message_id: "om_stream_001" },
      data: {
        msg_type: "post",
        content: markdownPostContent("final"),
      },
    });
  });
});
