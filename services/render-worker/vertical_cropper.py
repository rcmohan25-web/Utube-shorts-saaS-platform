"""Face-centered 9:16 vertical crop. §6.3."""
import cv2

SAMPLE_POINTS = (0.10, 0.25, 0.50, 0.75)


def _video_duration(path: str) -> float:
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    cap.release()
    return (frames / fps) if fps else 0.0


def compute_crop_center(video_path: str, duration: float):
    cap = cv2.VideoCapture(video_path)
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    face_centers = []

    for t in SAMPLE_POINTS:  # sample 4 moments
        cap.set(cv2.CAP_PROP_POS_MSEC, t * duration * 1000)
        ret, frame = cap.read()
        if not ret:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 4)
        for (x, y, w, h) in faces:
            face_centers.append((x + w // 2, y + h // 2))

    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
    cap.release()

    if face_centers:
        cx = int(sum(c[0] for c in face_centers) / len(face_centers))
        cy = int(sum(c[1] for c in face_centers) / len(face_centers))
        return cx, cy, frame_w, frame_h

    return frame_w // 2, frame_h // 2, frame_w, frame_h  # fallback: center


def build_vertical_crop_command(in_path: str, out_path: str) -> list[str]:
    duration = _video_duration(in_path)
    cx, _cy, orig_w, orig_h = compute_crop_center(in_path, duration)

    crop_w = orig_h * 9 // 16
    crop_x = max(0, min(cx - crop_w // 2, orig_w - crop_w))

    return [
        "ffmpeg", "-y", "-i", in_path,
        "-vf", f"crop={crop_w}:{orig_h}:{crop_x}:0,scale=1080:1920",
        "-c:a", "copy",
        out_path,
    ]
