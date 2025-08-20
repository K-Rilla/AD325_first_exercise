## PostureBuddy (MVP)

Lightweight AI-powered posture coach that works with your webcam.

### Tech
- Frontend: React (Vite)
- Backend: FastAPI (Python)
- ML: TensorFlow.js MoveNet + heuristic classifier (runs fully in-browser; no images stored)
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

- POST `/api/track` with JSON `{ label: 'good' | 'slouched', confidence?: number }`
  - Stores an aggregate posture event only if user consent is enabled. Returns `{ stored: boolean }`.
- GET `/api/summary?period=daily|weekly` → `{ uprightRatio: number (0..1), totalEvents: number }`
- GET `/api/consent` → `{ consent: boolean }`
- POST `/api/consent` with JSON `{ consent: boolean }` → `{ consent: boolean }`

---

## Notes
- Posture detection runs client-side using TensorFlow.js MoveNet. We apply geometric heuristics around head/shoulder/hip alignment. No frames leave the browser.
- The system fails safe: if confidence is low or person not detected, UI shows `uncertain`/`no_person` and does not nudge or store events.

