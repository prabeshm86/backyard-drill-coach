// Camera choice shared by both pages: open a specific camera, remember the
// last one picked, and fill a <select> with the cameras the computer has.

const KEY = "bdc-camera";

export function savedCamera() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
export function saveCamera(id) { try { localStorage.setItem(KEY, id); } catch {} }

export function openCamera(deviceId) {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

// The camera picked last time, or the browser's default if it's gone (e.g. the iPhone isn't nearby).
export async function startCamera() {
  const id = savedCamera();
  if (id) { try { return await openCamera(id); } catch {} }
  return openCamera("");
}

export const cameraId = stream => stream?.getVideoTracks()[0]?.getSettings().deviceId || "";

// Camera names are only visible after camera permission is granted, so call this after the camera opens.
export async function fillCameraSelect(sel, stream) {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  const cur = cameraId(stream);
  sel.replaceChildren(...devs.map((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId; o.textContent = d.label || `Camera ${i + 1}`; o.selected = d.deviceId === cur;
    return o;
  }));
  sel.hidden = devs.length === 0;
}

// Wire a <select>: switching opens the new camera, hands the stream to onStream, and remembers the choice.
export function wireCameraSelect(sel, getStream, onStream, onError) {
  sel.addEventListener("change", async () => {
    const id = sel.value;
    try {
      getStream()?.getTracks().forEach(t => t.stop());
      const s = await openCamera(id);
      saveCamera(id);
      await onStream(s);
      await fillCameraSelect(sel, s);
    } catch (e) { onError(e); }
  });
  // A camera plugged in or an iPhone coming nearby shows up without reloading.
  navigator.mediaDevices?.addEventListener?.("devicechange", () => { if (getStream()) fillCameraSelect(sel, getStream()); });
}
