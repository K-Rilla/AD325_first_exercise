## PostureBuddy (MVP)

Lightweight AI-powered posture coach that works with your webcam.

### Tech
- Frontend: React (Vite)
- Backend: FastAPI (Python)
- ML: MediaPipe Pose + heuristic classifier (no images stored)
- Storage: SQLite (aggregate posture events only with explicit consent)

### Features (MVP)
- Real-time posture detection: good vs slouched
- Visual/audio nudges with streak detection
- Daily/weekly summary (if consented)
- Safe failure modes and clear messages for edge cases

### Privacy
- Frames are processed in-memory only; never stored
- Aggregated posture event labels are stored only when the user explicitly enables consent in the UI

---

## Local Development

### 1) Backend

Requirements: Python 3.10+

```bash
cd /workspace/backend
python3 -m venv venv && /workspace/backend/venv/bin/pip install --upgrade pip
/workspace/backend/venv/bin/pip install -r requirements.txt

# Run API
/workspace/backend/venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

API docs: `http://localhost:8000/docs`

### 2) Frontend

Requirements: Node 18+

```bash
cd /workspace/frontend
npm install
npm run dev
```

App: `http://localhost:5173`

---

## API Overview

- POST `/api/classify` (multipart/form-data with field `image`): returns posture classification
  - Response: `{ label: "good" | "slouched" | "no_person" | "uncertain", confidence: number }`
  - Query params: `store=true|false` to store aggregate label (requires user consent)

- GET `/api/summary?period=daily|weekly`: percent upright for the selected period
  - Response: `{ uprightRatio: number (0..1), totalEvents: number }`

- GET `/api/consent`: `{ consent: boolean }`
- POST `/api/consent` with JSON `{ consent: boolean }`

---

## Notes
- The classifier uses MediaPipe Pose landmarks and simple geometric heuristics around head/shoulder/hip alignment. It focuses on sitting contexts (remote workers, students, gamers).
- The system fails safe: if confidence is low or person not detected, it returns `uncertain`/`no_person` and does not nudge.

# AD325_first_exercise
Creating first repo, AD325
