import { describe, expect, it } from "vitest";
import { changedVideos, videoKey, videoState } from "./videoCheck";
import type { ProjectionItem } from "../model/show";

const video = (id: string, sha256?: string): ProjectionItem => ({ id, kind: "video", name: `${id}.mp4`, path: `video/${id}.mp4`, sha256, transition: { kind: "cut" } });

describe("video fingerprints at opening", () => {
  it("is amber only when the video is there and its fingerprint is different", () => {
    expect(videoState(false, "aa", null)).toBe("missing");
    expect(videoState(true, "AA", "aa")).toBe("ok");
    expect(videoState(true, "aa", "bb")).toBe("changed");
    expect(videoState(true, undefined, "bb")).toBe("ok");
    expect(videoState(true, "aa", null)).toBe("ok");
  });

  it("checks again when a video, its fingerprint or the show file changes", () => {
    const a = [video("v1", "aa")];
    expect(videoKey(a, "/s/Serata.tcue")).toBe(videoKey([...a], "/s/Serata.tcue"));
    expect(videoKey(a, "/s/Serata.tcue")).not.toBe(videoKey([video("v1", "bb")], "/s/Serata.tcue"));
    expect(videoKey(a, "/s/Serata.tcue")).not.toBe(videoKey(a, "/t/Serata.tcue"));
  });

  it("lists the changed videos by name", () => {
    const items = [video("v1", "aa"), video("v2", "bb")];
    expect(changedVideos(items, { v1: "ok", v2: "changed" }).map((i) => i.name)).toEqual(["v2.mp4"]);
  });
});
