import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as posedetection from '@tensorflow-models/pose-detection'
import '@tensorflow/tfjs-backend-webgl'

type Classification = {
  label: 'good' | 'slouched' | 'no_person' | 'uncertain'
  confidence: number
}

type Summary = {
  uprightRatio: number
  totalEvents: number
}

function useConsent() {
  const [consent, setConsent] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  useEffect(() => {
    fetch('/api/consent')
      .then(r => r.json())
      .then(d => setConsent(Boolean(d.consent)))
      .finally(() => setLoading(false))
  }, [])
  const update = useCallback(async (value: boolean) => {
    setLoading(true)
    await fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: value })
    })
    const d = await (await fetch('/api/consent')).json()
    setConsent(Boolean(d.consent))
    setLoading(false)
  }, [])
  return { consent, loading, update }
}

function useSummary(period: 'daily' | 'weekly', refreshKey: number) {
  const [summary, setSummary] = useState<Summary>({ uprightRatio: 0, totalEvents: 0 })
  useEffect(() => {
    fetch(`/api/summary?period=${period}`)
      .then(r => r.json())
      .then(d => setSummary({ uprightRatio: Number(d.uprightRatio ?? 0), totalEvents: Number(d.totalEvents ?? 0) }))
      .catch(() => setSummary({ uprightRatio: 0, totalEvents: 0 }))
  }, [period, refreshKey])
  return summary
}

export const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [running, setRunning] = useState<boolean>(false)
  const [last, setLast] = useState<Classification | null>(null)
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily')
  const [refresh, setRefresh] = useState<number>(0)
  const { consent, loading, update } = useConsent()

  const summary = useSummary(period, refresh)

  useEffect(() => {
    let stream: MediaStream | null = null
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setRunning(true)
        }
      } catch (e) {
        console.error('Camera error', e)
        setRunning(false)
      }
    }
    start()
    return () => {
      stream?.getTracks().forEach(t => t.stop())
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let detector: posedetection.PoseDetector | null = null

    const init = async () => {
      try {
        await posedetection.createDetector(posedetection.SupportedModels.MoveNet, {
          modelType: 'Lightning'
        } as posedetection.MoveNetModelConfig).then(d => { detector = d })
      } catch (e) {
        console.error('Detector init failed', e)
      }
    }

    const classifyFromPose = (poses: posedetection.Pose[]): Classification => {
      if (!poses || poses.length === 0) return { label: 'no_person', confidence: 0 }
      const keypoints = poses[0].keypoints
      const w = videoRef.current?.videoWidth || 640
      const h = videoRef.current?.videoHeight || 480
      const get = (name: posedetection.Keypoint['name']) => keypoints.find(k => k.name === name)
      const nose = get('nose')
      const ls = get('left_shoulder')
      const rs = get('right_shoulder')
      const lh = get('left_hip')
      const rh = get('right_hip')
      if (!nose || !ls || !rs || !lh || !rh) return { label: 'uncertain', confidence: 0.3 }
      const shoulderCenter = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
      const hipCenter = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
      const torsoXDrift = Math.abs(shoulderCenter.x - hipCenter.x) / w
      const headForward = Math.abs(nose.x - shoulderCenter.x) / w
      const vertical = Math.abs(shoulderCenter.y - hipCenter.y) / h
      let uprightScore = 0
      if (vertical > 0.12) uprightScore += 0.4
      if (torsoXDrift < 0.05) uprightScore += 0.3
      if (headForward < 0.06) uprightScore += 0.3
      if (uprightScore >= 0.75) return { label: 'good', confidence: Math.min(0.5 + uprightScore / 2, 0.95) }
      let slouchScore = 0
      if (vertical <= 0.1) slouchScore += 0.4
      if (torsoXDrift >= 0.08) slouchScore += 0.3
      if (headForward >= 0.1) slouchScore += 0.3
      if (slouchScore >= 0.75) return { label: 'slouched', confidence: Math.min(0.5 + slouchScore / 2, 0.95) }
      return { label: 'uncertain', confidence: 0.3 }
    }

    const loop = async () => {
      raf = requestAnimationFrame(loop)
      if (!videoRef.current || !canvasRef.current || !detector) return
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        const poses = await detector.estimatePoses(video)
        const data = classifyFromPose(poses)
        setLast(data)
        if (consent && (data.label === 'good' || data.label === 'slouched') && data.confidence >= 0.6) {
          // store aggregate event
          fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {})
        }
      } catch (e) {
        // fail safe
      }
    }

    init().then(() => { raf = requestAnimationFrame(loop) })
    return () => { cancelAnimationFrame(raf); detector?.dispose() }
  }, [consent])

  useEffect(() => {
    const id = setInterval(() => setRefresh(v => v + 1), 15000)
    return () => clearInterval(id)
  }, [])

  const statusText = useMemo(() => {
    if (!running) return 'Camera off or unavailable'
    if (!last) return 'Analyzing...'
    switch (last.label) {
      case 'good': return `Upright (${Math.round(last.confidence * 100)}%)`
      case 'slouched': return `Slouched (${Math.round(last.confidence * 100)}%)`
      case 'no_person': return 'No person detected'
      default: return 'Unable to classify, please adjust'
    }
  }, [running, last])

  const nudge = useMemo(() => {
    if (!last) return null
    if (last.label === 'slouched' && last.confidence >= 0.6) {
      return 'Straighten up: align ears over shoulders, relax shoulders.'
    }
    return null
  }, [last])

  return (
    <div style={{ fontFamily: 'Inter, system-ui, Arial', padding: 16, maxWidth: 960, margin: '0 auto' }}>
      <h2>PostureBuddy</h2>
      <p style={{ color: '#555' }}>Lightweight AI posture coach. No images stored. Aggregate labels only if you consent.</p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <video ref={videoRef} style={{ width: 480, height: 360, background: '#000', borderRadius: 8 }} muted playsInline />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Status</div>
            <div>{statusText}</div>
            {nudge && (
              <div style={{ marginTop: 8, background: '#fff4e5', border: '1px solid #ffd8a8', padding: 8, borderRadius: 6 }}>
                {nudge}
              </div>
            )}
          </div>

          <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>Consent to store aggregate posture events</div>
                <div style={{ fontSize: 12, color: '#666' }}>Stores only labels (good/slouched) with timestamps. No images.</div>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={e => update(e.target.checked)}
                  disabled={loading}
                />
                <span>{consent ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>
          </div>

          <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={() => setPeriod('daily')} disabled={period === 'daily'}>Daily</button>
              <button onClick={() => setPeriod('weekly')} disabled={period === 'weekly'}>Weekly</button>
              <button onClick={() => setRefresh(v => v + 1)}>Refresh</button>
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary</div>
            <div>Upright: {Math.round(summary.uprightRatio * 100)}%</div>
            <div>Total events: {summary.totalEvents}</div>
          </div>
        </div>
      </div>

      <div style={{ color: '#666', fontSize: 12, marginTop: 16 }}>
        Not medical advice. For educational/awareness only. System fails safe for unclear inputs.
      </div>
    </div>
  )
}

