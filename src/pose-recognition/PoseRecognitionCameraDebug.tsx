import { Button, Card } from 'animal-island-ui'
import { useEffect, useRef, useState } from 'react'
import { PoseHoldTracker } from './pose-hold-tracker'
import { TeachableMachinePoseRecognizer } from './teachable-machine-pose-recognizer'
import type {
  ContinuousPoseResult,
  MovementId,
  PoseRecognitionResult,
} from './types'

const movementIds: readonly MovementId[] = [
  'side-leg-move',
  'mini-squat',
  'cross-body-knee-reach',
  'double-arm-raise',
  'side-to-side-foot-tap',
  'frontal-raise',
  'knee-lift-extension',
  'lateral-raise',
  'arm-above-head',
  'rowing',
]

const predictionIntervalMs = 200
const captureWidth = 640

type DebugStatus = 'loading-models' | 'ready' | 'starting-camera' | 'running' | 'error'

export function PoseRecognitionCameraDebug() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | undefined>(undefined)
  const animationFrameRef = useRef<number | undefined>(undefined)
  const predictionRunningRef = useRef(false)
  const lastPredictionAtRef = useRef(0)
  const targetMovementRef = useRef<MovementId>('mini-squat')
  const recognizerRef = useRef(new TeachableMachinePoseRecognizer())
  const holdTrackerRef = useRef(new PoseHoldTracker())
  const [targetMovement, setTargetMovement] = useState<MovementId>('mini-squat')
  const [status, setStatus] = useState<DebugStatus>('loading-models')
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<PoseRecognitionResult>()
  const [continuousResult, setContinuousResult] = useState<ContinuousPoseResult>()

  useEffect(() => {
    let active = true

    recognizerRef.current.load()
      .then(() => {
        if (active) setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(toErrorMessage(cause))
        setStatus('error')
      })

    return () => {
      active = false
      stopCamera()
    }
  }, [])

  function changeTargetMovement(nextMovement: MovementId) {
    targetMovementRef.current = nextMovement
    setTargetMovement(nextMovement)
    holdTrackerRef.current.reset()
    setResult(undefined)
    setContinuousResult(undefined)
  }

  async function startCamera() {
    if (status !== 'ready') return

    setError(undefined)
    setStatus('starting-camera')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user' },
      })
      const video = videoRef.current

      if (!video) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error('Camera preview is unavailable')
      }

      streamRef.current = stream
      video.srcObject = stream
      await video.play()
      setStatus('running')
      animationFrameRef.current = requestAnimationFrame(runPredictionLoop)
    } catch (cause) {
      setError(toErrorMessage(cause))
      setStatus('error')
    }
  }

  function stopCamera() {
    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = undefined
    }

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = undefined
    predictionRunningRef.current = false

    if (videoRef.current) videoRef.current.srcObject = null
    setStatus((current) => current === 'running' || current === 'starting-camera' ? 'ready' : current)
  }

  function runPredictionLoop(now: number) {
    animationFrameRef.current = requestAnimationFrame(runPredictionLoop)

    if (
      predictionRunningRef.current
      || now - lastPredictionAtRef.current < predictionIntervalMs
    ) {
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { willReadFrequently: true })

    if (!video || !canvas || !context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return
    }

    const aspectRatio = video.videoHeight / video.videoWidth
    canvas.width = captureWidth
    canvas.height = Math.round(captureWidth * aspectRatio)
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)

    predictionRunningRef.current = true
    lastPredictionAtRef.current = now

    recognizerRef.current.predict(imageData, targetMovementRef.current)
      .then((nextResult) => {
        setResult(nextResult)
        setContinuousResult(holdTrackerRef.current.add(nextResult))
      })
      .catch((cause: unknown) => {
        setError(toErrorMessage(cause))
        stopCamera()
        setStatus('error')
      })
      .finally(() => {
        predictionRunningRef.current = false
      })
  }

  const canStart = status === 'ready'
  const isRunning = status === 'running'

  return (
    <main className="pose-debug-page">
      <header className="pose-debug-header">
        <div>
          <span className="pose-debug-eyebrow">Developer tool</span>
          <h1>Pose recognition camera test</h1>
          <p>Select a target movement, start the camera, and perform the movement in frame.</p>
        </div>
        <a href="/">Return to application</a>
      </header>

      <section className="pose-debug-grid">
        <Card className="pose-debug-preview-card" color="app-green" pattern="app-green">
          <div className="pose-debug-video-wrap">
            <video ref={videoRef} aria-label="Live camera preview" muted playsInline />
            {!isRunning ? <span>{statusLabel(status)}</span> : null}
          </div>
          <canvas ref={canvasRef} hidden />

          <label className="pose-debug-field">
            <span>Target movement</span>
            <select
              disabled={status === 'loading-models' || status === 'starting-camera'}
              value={targetMovement}
              onChange={(event) => changeTargetMovement(event.target.value as MovementId)}
            >
              {movementIds.map((movementId) => (
                <option key={movementId} value={movementId}>{movementId}</option>
              ))}
            </select>
          </label>

          <div className="pose-debug-actions">
            <Button block disabled={!canStart} htmlType="button" size="large" type="primary" onClick={startCamera}>
              Start camera
            </Button>
            <Button block disabled={!isRunning} htmlType="button" size="large" onClick={stopCamera}>
              Stop camera
            </Button>
          </div>
          {error ? <p className="pose-debug-error" role="alert">{error}</p> : null}
        </Card>

        <Card className="pose-debug-result-card" color="app-yellow" pattern="app-yellow">
          <h2>Live result</h2>
          <div className={`pose-debug-verdict ${result?.isMatching ? 'is-matching' : ''}`}>
            {result ? (result.isMatching ? 'Matching' : 'Not matching') : 'Waiting for a frame'}
          </div>
          <dl className="pose-debug-values">
            <DebugValue label="Target" value={result?.targetMovement ?? targetMovement} />
            <DebugValue label="Decision source" value={result?.matchSource ?? '—'} />
            <DebugValue label="Detected movement" value={result?.detectedMovement ?? '—'} />
            <DebugValue label="Target confidence" value={formatPercent(result?.targetConfidence)} />
            <DebugValue label="Detected confidence" value={formatPercent(result?.detectedConfidence)} />
            <DebugValue
              label="Rule measurement"
              value={result?.measurement
                ? `${result.measurement.type}: ${result.measurement.value.toFixed(2)}`
                : '—'}
            />
            <DebugValue label="Hold progress" value={formatPercent(continuousResult?.progress)} />
            <DebugValue label="Hold completed" value={continuousResult?.completed ? 'Yes' : 'No'} />
          </dl>
          <p className="pose-debug-note">Frames are analysed at up to five predictions per second. Only one prediction runs at a time.</p>
        </Card>
      </section>
    </main>
  )
}

function DebugValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(1)}%`
}

function statusLabel(status: DebugStatus): string {
  if (status === 'loading-models') return 'Loading pose models…'
  if (status === 'starting-camera') return 'Starting camera…'
  if (status === 'error') return 'Camera test stopped'
  return 'Camera is off'
}

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'An unknown camera or recognition error occurred'
}
