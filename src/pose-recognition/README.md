# Pose Recognition

This module accepts a decoded image frame, checks it against a requested movement, and returns a stable application-level result. It does not own camera access, video playback, frame capture, or React state.

## Camera debug page

For manual browser testing, start the development server and open the standalone debug page:

```bash
pnpm dev
```

```text
http://localhost:5173/pose-recognition-debug
```

Select any of the ten supported movement IDs, allow camera access, and press **Start camera**. The page captures up to five frames per second and displays the single-frame decision, rule or model source, confidence values, rule measurement, and continuous-hold progress. Switching the target movement resets the displayed result and hold tracker.

Camera access requires `localhost` or HTTPS and explicit browser permission. This page is only an adapter for manual testing; camera ownership remains outside the pose-recognition module.

## Responsibilities

The caller is responsible for:

- obtaining an image, video, or camera frame;
- converting the frame to `ImageData`;
- choosing the target `MovementId`;
- controlling the prediction rate and handling asynchronous errors;
- passing single-frame results to `PoseHoldTracker` when continuous hold detection is required.

The module is responsible for:

- loading the seated and standing Teachable Machine Pose models;
- extracting body keypoints from `ImageData` with PoseNet;
- evaluating the target movement's keypoint rule first;
- using the Teachable Machine classifier as a fallback when the rule fails;
- returning stable single-frame and continuous-hold result types.

## Public API

Public types are defined in [`types.ts`](./types.ts).

### Input

```ts
type PoseInput = ImageData
```

The input must be one decoded frame. The recognizer does not accept a URL, `Blob`, `File`, camera, or video stream directly.

Example canvas capture:

```ts
const context = canvas.getContext('2d')

if (!context) {
  throw new Error('Canvas 2D context is unavailable')
}

context.drawImage(videoOrImage, 0, 0, canvas.width, canvas.height)
const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
```

### Movement IDs

```ts
type MovementId =
  | 'side-leg-move'
  | 'mini-squat'
  | 'cross-body-knee-reach'
  | 'double-arm-raise'
  | 'side-to-side-foot-tap'
  | 'frontal-raise'
  | 'knee-lift-extension'
  | 'lateral-raise'
  | 'arm-above-head'
  | 'rowing'
```

Callers must use these stable IDs rather than Teachable Machine class labels. The recognizer selects the seated or standing model from the target movement automatically.

### Single-frame result

```ts
type PoseRecognitionResult = {
  targetMovement: MovementId
  isMatching: boolean
  matchSource: 'rule' | 'model' | 'none'
  timestamp: number

  measurement?: {
    type: MeasurementType
    value: number
    keypointConfidence: number
  }

  targetConfidence?: number
  detectedMovement?: MovementId
  detectedConfidence?: number
}
```

- `targetMovement`: the movement requested by the caller.
- `isMatching`: the primary field consumers should use to determine success.
- `matchSource`: `rule` when the rule passed, `model` when the fallback classifier passed, or `none` when both rejected the frame.
- `timestamp`: a monotonic `performance.now()` timestamp in milliseconds.
- `measurement`: the angle or normalized ratio measured by the rule, plus the lowest relevant keypoint confidence.
- `targetConfidence`: raw TM confidence for the requested class.
- `detectedMovement`: stable movement ID for the TM Top 1 class.
- `detectedConfidence`: raw confidence for the TM Top 1 class.

The three model fields are optional because a successful rule returns immediately without running the classifier.

Rule-success example:

```ts
{
  targetMovement: 'mini-squat',
  isMatching: true,
  matchSource: 'rule',
  measurement: {
    type: 'knee-angle',
    value: 132.4,
    keypointConfidence: 0.91,
  },
  timestamp: 12840.5,
}
```

Model-fallback example:

```ts
{
  targetMovement: 'rowing',
  targetConfidence: 0.82,
  detectedMovement: 'rowing',
  detectedConfidence: 0.82,
  isMatching: true,
  matchSource: 'model',
  measurement: {
    type: 'elbow-angle',
    value: 171.2,
    keypointConfidence: 0.68,
  },
  timestamp: 13102.7,
}
```

## Loading and single-frame usage

```ts
import { TeachableMachinePoseRecognizer } from './pose-recognition/teachable-machine-pose-recognizer'
import type { MovementId, PoseRecognizer } from './pose-recognition/types'

const recognizer: PoseRecognizer = new TeachableMachinePoseRecognizer()

// Call once before prediction. Concurrent or repeated calls do not reload the models.
await recognizer.load()

async function analyseFrame(imageData: ImageData, targetMovement: MovementId) {
  const result = await recognizer.predict(imageData, targetMovement)

  if (result.isMatching) {
    console.log('Movement accepted', result.matchSource)
  }

  return result
}
```

Optional configuration:

```ts
const recognizer = new TeachableMachinePoseRecognizer({
  // TM fallback threshold. Defaults to 0.7 and does not affect rule evaluation.
  confidenceThreshold: 0.7,

  // Defaults to Vite's import.meta.env.BASE_URL.
  modelBaseUrl: '/',
})
```

The model files must be available at:

```text
{modelBaseUrl}/models/seated/model.json
{modelBaseUrl}/models/seated/metadata.json
{modelBaseUrl}/models/seated/weights.bin
{modelBaseUrl}/models/standing/model.json
{modelBaseUrl}/models/standing/metadata.json
{modelBaseUrl}/models/standing/weights.bin
```

Do not build an unbounded queue of old frames while `predict()` is running. For real-time use, keep at most one prediction in flight and retain only the newest pending frame.

## Decision pipeline

Each `predict()` call follows this order:

```text
ImageData
  ↓
PoseNet extracts body keypoints and classifier features
  ↓
Evaluate the target movement rule
  ├─ Pass: isMatching=true, matchSource='rule', return immediately
  └─ Fail
       ↓
     Run the Teachable Machine classifier
       ├─ Target confidence > 0.7: isMatching=true, matchSource='model'
       └─ Otherwise: isMatching=false, matchSource='none'
```

### 1. Model fallback

The module loads two local Teachable Machine Pose models:

- the standing model contains the five standing movements;
- the seated model contains the five seated movements.

Internal schema mapping converts TM class labels into stable `MovementId` values. The classifier runs only when the movement rule fails. By default, the requested class must have a confidence strictly greater than 70%.

### 2. Movement rules

Every rule requires all relevant keypoints to have a minimum confidence of `0.3`.

| Movement ID | Rule |
| --- | --- |
| `side-leg-move` | Using the hip centre as the vertex, measure separation between both knees and both ankles. Use the reliable pair with the larger separation; the angle must be greater than `10°`. |
| `mini-squat` | Use the leg with clearer keypoints and measure its hip-knee-ankle knee angle. The angle must be between `80°` and `165°`. |
| `cross-body-knee-reach` | One foot must be raised by at least 10% of leg length, and the opposite wrist must be no more than one shoulder width from the raised knee. |
| `double-arm-raise` | Both wrists must be above their corresponding shoulders. |
| `side-to-side-foot-tap` | Knee or ankle separation from the hip centre must be greater than `10°`. Its current static-frame rule is intentionally similar to `side-leg-move`. |
| `frontal-raise` | Both upper arms must form an angle with the torso; the smaller side must be greater than `10°`. |
| `knee-lift-extension` | One ankle must be raised by at least 10% of leg length, or one knee must have an extension angle of at least `135°`. |
| `lateral-raise` | Both upper arms must form an angle with the torso; the smaller side must be greater than `10°`. Its current 2D rule is the same as `frontal-raise`. |
| `arm-above-head` | Both wrists must be above their corresponding shoulders. |
| `rowing` | Use the arm with clearer keypoints. Its upper arm-to-torso angle must exceed `10°`, and its elbow angle must be between `30°` and `165°`. |

These rules use 2D keypoints. They cannot reliably measure depth toward or away from the camera, and a single frame cannot determine direction, speed, or repetition count. Use continuous-frame logic for temporal requirements.

## Continuous hold detection

`PoseHoldTracker` does not read images or run a model. It aggregates sequential `PoseRecognitionResult` values.

Defaults:

- a two-second hold window;
- at least eight samples;
- at least 80% matching frames in the window;
- `completed=true` once, followed by an automatic internal reset;
- automatic reset when `targetMovement` changes.

```ts
import { PoseHoldTracker } from './pose-recognition/pose-hold-tracker'

const tracker = new PoseHoldTracker()

async function analyseContinuousFrame(
  imageData: ImageData,
  targetMovement: MovementId,
) {
  const frameResult = await recognizer.predict(imageData, targetMovement)
  return tracker.add(frameResult)
}
```

```ts
type ContinuousPoseResult = {
  targetMovement: MovementId
  isHolding: boolean
  progress: number
  completed: boolean
}
```

Reset a cancelled or restarted movement explicitly:

```ts
tracker.reset()
```

## Error handling

Both `load()` and `predict()` may reject. Callers must handle these failures:

```ts
try {
  await recognizer.load()
  return await recognizer.predict(imageData, targetMovement)
} catch (error) {
  console.error('Pose recognition failed', error)
  // The UI may retry, fall back to manual confirmation, or stop recognition.
}
```

Common failures include:

- calling `predict()` before `load()` completes;
- inaccessible model or metadata files;
- metadata missing a required schema label;
- PoseNet pose estimation failure;
- a TM response missing the requested class or returning an unknown label.

## Real-image flow testing

The flow test loads the real models, decodes PNG fixtures into `ImageData`, calls the public recognizer, and checks `isMatching` against the directory expectation.

### Fixture directories

Place PNG images under [`test-images`](./test-images):

- `test-images/correct/`: the image should match the target movement;
- `test-images/incorrect/`: a person is present but should not match the target movement;
- `test-images/none/`: no usable target pose is present.

### File naming

Every filename must begin with its target `MovementId`, followed by `--` and any description:

```text
test-images/correct/mini-squat--front-view-01.png
test-images/incorrect/mini-squat--standing-still-01.png
test-images/none/mini-squat--empty-room-01.png
```

Supported filename prefixes:

```text
side-leg-move
mini-squat
cross-body-knee-reach
double-arm-raise
side-to-side-foot-tap
frontal-raise
knee-lift-extension
lateral-raise
arm-above-head
rowing
```

An unsupported prefix or a filename without the `--` separator fails test discovery with a clear error.

### Test commands

Run only the real-image flow test:

```bash
pnpm test src/pose-recognition/pose-recognition.flow.test.ts
```

The flow test serves `public/models` through a temporary local HTTP server. Teachable Machine also downloads its base PoseNet checkpoint while loading, so the first real-image run requires network access and permission to listen on localhost.
