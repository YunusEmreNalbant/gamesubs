// tizen.systeminfo VIDEOSOURCE ile bağlı kaynakları listeler.
import { describeError } from "./log";

export function listVideoSources(): Promise<VideoSourceList> {
  return new Promise((resolve, reject) => {
    const si = window.tizen && window.tizen.systeminfo;
    if (!si) return reject(new Error("tizen.systeminfo yok"));
    try {
      si.getPropertyValue(
        "VIDEOSOURCE",
        (v) => resolve(v as VideoSourceList),
        (e) => reject(new Error(describeError(e)))
      );
    } catch (e) {
      reject(new Error(describeError(e)));
    }
  });
}

export const isHdmi = (s: VideoSourceInfo) => s.type === "HDMI";
export const label = (s: VideoSourceInfo) => `${s.type} ${s.number}`;
